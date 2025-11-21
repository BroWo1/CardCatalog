#!/usr/bin/env node

/**
 * Setup script to download and process GeoNames city database
 *
 * This script downloads the GeoNames cities15000.txt file (cities with population > 15,000)
 * and converts it to a compact JSON format for use with PhotoGeocodingService.
 *
 * Usage: node scripts/setup-geonames.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import https from 'https';
import zlib from 'zlib';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'src', 'renderer', 'data');
const TEMP_DIR = path.join(DATA_DIR, 'temp');

// GeoNames data URLs
const GEONAMES_URLS = {
  // cities15000: ~25,000 cities with population > 15,000 (~5MB compressed)
  cities15000: 'http://download.geonames.org/export/dump/cities15000.zip',
  // cities5000: ~50,000 cities with population > 5,000 (~12MB compressed)
  cities5000: 'http://download.geonames.org/export/dump/cities5000.zip',
  // cities1000: ~140,000 cities with population > 1,000 (~30MB compressed)
  cities1000: 'http://download.geonames.org/export/dump/cities1000.zip',
};

function printHelp() {
  console.log(`GeoNames setup usage:`);
  console.log(`  node scripts/setup-geonames.js [dataset] [--txt=relative-or-abs-path]`);
  console.log(``);
  console.log(`Examples:`);
  console.log(`  node scripts/setup-geonames.js                # download default cities15000`);
  console.log(`  node scripts/setup-geonames.js cities1000   # download cities1000.zip`);
  console.log(`  node scripts/setup-geonames.js cities1000 --txt=src/renderer/data/cities1000.txt`);
  console.log(``);
  console.log(`Datasets: ${Object.keys(GEONAMES_URLS).join(', ')}`);
}

// Parse CLI arguments
const args = process.argv.slice(2);
let dataset = 'cities15000';
let localTxtPath = null;

for (const arg of args) {
  if (arg.startsWith('--txt=')) {
    const [, rawPath] = arg.split('=');
    if (rawPath) {
      localTxtPath = path.resolve(PROJECT_ROOT, rawPath);
    }
  } else if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  } else if (!arg.startsWith('--')) {
    dataset = arg;
  }
}

const DATASET = dataset;
const DOWNLOAD_URL = localTxtPath ? null : GEONAMES_URLS[DATASET];

if (!localTxtPath) {
  if (!DOWNLOAD_URL) {
    console.error(`Invalid dataset: ${DATASET}`);
    console.error(`Available options: ${Object.keys(GEONAMES_URLS).join(', ')}`);
    process.exit(1);
  }
  console.log(`\n📍 GeoNames City Database Setup\n`);
  console.log(`Dataset: ${DATASET}`);
  console.log(`URL: ${DOWNLOAD_URL}\n`);
} else {
  if (!fs.existsSync(localTxtPath)) {
    console.error(`Local TXT file not found: ${localTxtPath}`);
    process.exit(1);
  }
  console.log(`\n📍 GeoNames City Database Setup\n`);
  console.log(`Dataset: ${DATASET}`);
  console.log(`Using local TXT file: ${path.relative(PROJECT_ROOT, localTxtPath)}\n`);
}

// Create directories
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Download file from URL
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    console.log(`⬇️  Downloading ${url}...`);

    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);

    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Handle redirect
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      const totalBytes = parseInt(response.headers['content-length'], 10);
      let downloadedBytes = 0;
      let lastPercent = 0;

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const percent = Math.floor((downloadedBytes / totalBytes) * 100);
        if (percent > lastPercent && percent % 10 === 0) {
          console.log(`   ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(1)} MB)`);
          lastPercent = percent;
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log(`✅ Download complete: ${(downloadedBytes / 1024 / 1024).toFixed(1)} MB\n`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

/**
 * Extract ZIP file
 */
function extractZip(zipPath, extractPath) {
  return new Promise((resolve, reject) => {
    console.log(`📦 Extracting ${path.basename(zipPath)}...`);

    // Simple ZIP extraction for single-file archives
    // For more complex ZIP files, consider using 'adm-zip' package
    const AdmZip = require('adm-zip');
    try {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractPath, true);
      console.log(`✅ Extraction complete\n`);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Parse GeoNames text file and convert to JSON
 */
async function parseGeoNamesFile(txtPath, jsonPath) {
  console.log(`🔄 Processing GeoNames data...`);

  const fileStream = fs.createReadStream(txtPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const cities = [];
  let lineCount = 0;

  for await (const line of rl) {
    lineCount++;

    // GeoNames format (tab-separated):
    // 0: geonameid
    // 1: name
    // 2: asciiname
    // 3: alternatenames
    // 4: latitude
    // 5: longitude
    // 6: feature class
    // 7: feature code
    // 8: country code
    // 9: cc2
    // 10: admin1 code
    // 11: admin2 code
    // 12: admin3 code
    // 13: admin4 code
    // 14: population
    // 15: elevation
    // 16: dem
    // 17: timezone
    // 18: modification date

    const fields = line.split('\t');

    if (fields.length < 18) {
      continue;
    }

    const city = {
      id: parseInt(fields[0]),
      name: fields[1],
      lat: parseFloat(fields[4]),
      lng: parseFloat(fields[5]),
      country: fields[8],
      admin1: fields[10],
      population: parseInt(fields[14]) || 0,
      timezone: fields[17] || null,
    };

    // Validate coordinates
    if (Number.isFinite(city.lat) && Number.isFinite(city.lng)) {
      cities.push(city);
    }

    if (lineCount % 5000 === 0) {
      console.log(`   Processed ${lineCount} lines...`);
    }
  }

  console.log(`✅ Processed ${cities.length} cities\n`);

  // Sort by population (descending) for better search results
  cities.sort((a, b) => b.population - a.population);

  // Write to JSON file
  console.log(`💾 Writing JSON file...`);
  fs.writeFileSync(jsonPath, JSON.stringify(cities, null, 2));

  const fileSizeMB = (fs.statSync(jsonPath).size / 1024 / 1024).toFixed(2);
  console.log(`✅ Saved to ${path.basename(jsonPath)} (${fileSizeMB} MB)\n`);

  return cities;
}

/**
 * Main setup function
 */
async function main() {
  try {
    const zipPath = path.join(TEMP_DIR, `${DATASET}.zip`);
    let txtPath = localTxtPath || path.join(TEMP_DIR, `${DATASET}.txt`);
    const jsonPath = path.join(DATA_DIR, 'cities.json');

    if (!localTxtPath) {
      // Step 1: Download ZIP file
      if (!fs.existsSync(zipPath)) {
        await downloadFile(DOWNLOAD_URL, zipPath);
      } else {
        console.log(`⏭️  ZIP file already exists, skipping download\n`);
      }

      // Step 2: Extract ZIP file
      if (!fs.existsSync(txtPath)) {
        // Check if adm-zip is available
        try {
          require.resolve('adm-zip');
          await extractZip(zipPath, TEMP_DIR);
        } catch (e) {
          console.log(`📦 Please install adm-zip to extract: npm install adm-zip`);
          console.log(`   Or extract ${zipPath} manually to ${TEMP_DIR}\n`);
          process.exit(1);
        }
      } else {
        console.log(`⏭️  Text file already exists, skipping extraction\n`);
      }
    } else {
      console.log(`⏭️  Skipping download and extraction - using provided TXT file\n`);
    }

    // Step 3: Parse and convert to JSON
    const cities = await parseGeoNamesFile(txtPath, jsonPath);

    // Cleanup temp files
    console.log(`🧹 Cleaning up temporary files...`);
    if (!localTxtPath) {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      if (fs.existsSync(txtPath)) fs.unlinkSync(txtPath);
      if (fs.existsSync(TEMP_DIR) && fs.readdirSync(TEMP_DIR).length === 0) {
        fs.rmdirSync(TEMP_DIR);
      }
    } else {
      console.log(`   (Skipping removal of local TXT file)`);
      if (fs.existsSync(TEMP_DIR) && fs.readdirSync(TEMP_DIR).length === 0) {
        fs.rmdirSync(TEMP_DIR);
      }
    }
    console.log(`✅ Cleanup complete\n`);

    // Summary
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✨ Setup Complete!`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 Statistics:`);
    console.log(`   Cities loaded: ${cities.length.toLocaleString()}`);
    console.log(`   Dataset: ${DATASET}`);
    console.log(`   Output: ${path.relative(PROJECT_ROOT, jsonPath)}`);
    console.log(``);
    console.log(`🚀 The city database is ready to use!`);
    console.log(``);
    console.log(`Next steps:`);
    console.log(`   1. Install dependencies: npm install rbush`);
    console.log(`   2. The PhotoGeocodingService will automatically load the data`);
    console.log(`   3. Enjoy ${cities.length.toLocaleString()}x better city coverage!`);
    console.log(``);

  } catch (error) {
    console.error(`\n❌ Error:`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run setup
main();
