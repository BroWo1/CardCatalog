const fs = require('fs');
const path = require('path');

const fsp = fs.promises;

// RAW file extensions
const RAW_EXTENSIONS = new Set([
  '.dng',
  '.cr2',
  '.cr3',
  '.nef',
  '.arw',
  '.orf',
  '.raf',
  '.srw',
  '.rw2',
  '.pef',
  '.srw',
]);

// JPEG and processed image extensions
const JPEG_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
]);

// Other supported raster formats
const OTHER_RASTER_EXTENSIONS = new Set([
  '.png',
  '.tif',
  '.tiff',
]);

const SUPPORTED_EXTENSIONS = new Set([
  ...JPEG_EXTENSIONS,
  ...OTHER_RASTER_EXTENSIONS,
  ...RAW_EXTENSIONS,
]);

const SKIP_DIRECTORY_NAMES = new Set([
  'System Volume Information',
  '$RECYCLE.BIN',
  'FOUND.000',
  'FOUND.001',
  'FOUND.002',
  'LOST.DIR',
  '__MACOSX',
]);

const PROGRESS_EMIT_INTERVAL_MS = 400;
const STAT_CONCURRENCY = 32;

function createLimiter(limit) {
  const queue = [];
  let activeCount = 0;

  const next = () => {
    while (activeCount < limit && queue.length) {
      const { fn, resolve, reject } = queue.shift();
      activeCount += 1;
      Promise.resolve()
        .then(fn)
        .then(
          (value) => {
            activeCount -= 1;
            resolve(value);
            next();
          },
          (error) => {
            activeCount -= 1;
            reject(error);
            next();
          },
        );
    }
  };

  return function enqueue(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  };
}

const statLimiter = createLimiter(STAT_CONCURRENCY);

async function readFileStats(filePaths) {
  if (!filePaths || !filePaths.length) {
    return new Map();
  }
  const entries = await Promise.all(
    filePaths.map(async (filePath) => {
      const stats = await statLimiter(async () => {
        try {
          return await fsp.stat(filePath);
        } catch (error) {
          console.warn(`Unable to stat file ${filePath}`, error);
          return null;
        }
      });
      return [filePath, stats];
    }),
  );
  return entries.reduce((map, [filePath, stats]) => {
    if (stats) {
      map.set(filePath, stats);
    }
    return map;
  }, new Map());
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function isHiddenEntry(name) {
  return name.startsWith('.') || SKIP_DIRECTORY_NAMES.has(name);
}

/**
 * @param {string} fileName
 * @returns {boolean}
 */
function hasSupportedExtension(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * @param {string} fileName
 * @returns {boolean}
 */
function isRawFile(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return RAW_EXTENSIONS.has(ext);
}

/**
 * @param {string} fileName
 * @returns {boolean}
 */
function isJpegFile(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return JPEG_EXTENSIONS.has(ext);
}

/**
 * Get the base name of a file without extension
 * @param {string} filePath
 * @returns {string}
 */
function getBaseName(filePath) {
  const fullName = path.basename(filePath);
  const ext = path.extname(fullName);
  return fullName.slice(0, -ext.length);
}

/**
 * Recursively scan a directory tree for supported image files.
 *
 * @param {string} rootPath
 * @param {string} volumeId
 * @param {(payload: { type: 'fileFound' | 'progress', data: any }) => void} [onUpdate]
 * @param {{ ignoreHidden?: boolean, maxDepth?: number|null, shouldAbort?: () => boolean }} [options]
 * @returns {Promise<{ files: import('../shared/types').FileInfo[], totalFiles: number }>}
 */
async function scanVolume(rootPath, volumeId, onUpdate = () => {}, options = {}) {
  const opts = {
    ignoreHidden: true,
    maxDepth: null,
    shouldAbort: () => false,
    ...options,
  };

  const rootStats = await fsp.stat(rootPath);
  if (!rootStats.isDirectory()) {
    throw new Error(`Scan root is not a directory: ${rootPath}`);
  }

  const files = [];
  let totalFiles = 0;
  let processedFiles = 0;
  let lastProgressEmit = 0;

  const emitProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressEmit < PROGRESS_EMIT_INTERVAL_MS) {
      return;
    }
    lastProgressEmit = now;
    onUpdate({
      type: 'progress',
      data: {
        totalFiles,
        processedFiles,
      },
    });
  };

  const walk = async (dirPath, depth) => {
    if (opts.maxDepth !== null && depth > opts.maxDepth) {
      return;
    }

    if (opts.shouldAbort()) {
      throw new Error('Scan aborted');
    }

    let entries;
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      console.warn(`Unable to read directory ${dirPath}`, error);
      return;
    }

    // Collect all image files in this directory first
    const imageFiles = [];
    const subdirs = [];

    for (const entry of entries) {
      if (opts.shouldAbort()) {
        throw new Error('Scan aborted');
      }

      const entryName = entry.name;
      if (opts.ignoreHidden && isHiddenEntry(entryName)) {
        continue;
      }

      const entryPath = path.join(dirPath, entryName);

      if (entry.isSymbolicLink?.()) {
        continue;
      }

      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORY_NAMES.has(entryName)) {
          subdirs.push(entryPath);
        }
      } else if (entry.isFile()) {
        if (hasSupportedExtension(entryName)) {
          imageFiles.push(entryPath);
        }
      }
    }

    // Group files by base name to detect RAW+JPEG pairs
    const filesByBaseName = new Map();
    for (const filePath of imageFiles) {
      const baseName = getBaseName(filePath);
      if (!filesByBaseName.has(baseName)) {
        filesByBaseName.set(baseName, []);
      }
      filesByBaseName.get(baseName).push(filePath);
    }

    // Process each group of files
    for (const [baseName, filePaths] of filesByBaseName.entries()) {
      if (opts.shouldAbort()) {
        throw new Error('Scan aborted');
      }

      // Separate RAW and JPEG files
      const rawFiles = filePaths.filter(isRawFile);
      const jpegFiles = filePaths.filter(isJpegFile);
      const otherFiles = filePaths.filter(
        (f) => !isRawFile(f) && !isJpegFile(f),
      );

      // If both RAW and JPEG exist, only process JPEG and link to RAW
      if (rawFiles.length > 0 && jpegFiles.length > 0) {
        // Process the JPEG file(s) with RAW file reference
        const statsMap = await readFileStats(jpegFiles);
        for (const jpegPath of jpegFiles) {
          const fileStats = statsMap.get(jpegPath);
          if (!fileStats) {
            continue;
          }

          const fileInfo = {
            path: jpegPath,
            size: fileStats.size,
            mtimeMs: fileStats.mtimeMs,
            volumeId,
            rawFilePath: rawFiles[0], // Use first RAW file if multiple
          };

          files.push(fileInfo);
          totalFiles += 1;
          processedFiles = totalFiles;

          onUpdate({
            type: 'fileFound',
            data: {
              file: fileInfo,
              totalFiles,
              processedFiles,
            },
          });

          emitProgress();
        }
        // Skip processing RAW files when JPEG exists
      } else {
        // Process all files normally (RAW only, JPEG only, or other formats)
        const statsMap = await readFileStats(filePaths);
        for (const filePath of filePaths) {
          const fileStats = statsMap.get(filePath);
          if (!fileStats) {
            continue;
          }

          const fileInfo = {
            path: filePath,
            size: fileStats.size,
            mtimeMs: fileStats.mtimeMs,
            volumeId,
          };

          files.push(fileInfo);
          totalFiles += 1;
          processedFiles = totalFiles;

          onUpdate({
            type: 'fileFound',
            data: {
              file: fileInfo,
              totalFiles,
              processedFiles,
            },
          });

          emitProgress();
        }
      }
    }

    // Recursively process subdirectories
    for (const subdirPath of subdirs) {
      await walk(subdirPath, depth + 1);
    }
  };

  await walk(rootPath, 0);

  emitProgress(true);

  return {
    files,
    totalFiles,
  };
}

module.exports = {
  scanVolume,
  SUPPORTED_EXTENSIONS: Array.from(SUPPORTED_EXTENSIONS),
};
