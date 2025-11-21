const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parentPort, workerData } = require('worker_threads');
const exifr = require('exifr');
const Jimp = require('jimp').Jimp;
const {
  generateClipKeywords,
  generateClipData,
  isSupportedImageFile,
  ensureClipModelReady,
  setResourcesPath,
} = require('./clip-keywords');
const { PhotoGeocodingService } = require('../geocoding-service');
const fallbackCities = require('../../renderer/data/cities.json');

process.on('uncaughtException', (err) => {
  console.error('Worker uncaughtException:', err);
  if (parentPort) {
    try {
      parentPort.postMessage({ type: 'error', error: err.message });
    } catch (e) {
      // Ignore
    }
  }
});

// Initialize resources path for CLIP model if provided
if (workerData?.resourcesPath) {
  setResourcesPath(workerData.resourcesPath);
}

const geocodingService = new PhotoGeocodingService();
try {
  geocodingService.loadCities(fallbackCities);
} catch (err) {
  console.error('Failed to load cities for geocoding:', err);
}

const thumbnailBaseDir = workerData?.thumbnailBaseDir || null;
let thumbnailDirReady = false;

if (!parentPort) {
  throw new Error('EXIF worker must be run as a worker thread');
}

parentPort.on('message', async (message) => {
  if (!message) {
    return;
  }
  if (message.type === 'warm') {
    warmClipModel();
    return;
  }
  if (message.type !== 'process') {
    return;
  }

  const { jobId, volumeId, filePath, metadataSignature } = message;

  try {
    const metadata = await parseMetadata(filePath);
    const thumbnailPath = thumbnailBaseDir
      ? await generateThumbnail(volumeId, filePath)
      : null;
    if (thumbnailPath) {
      metadata.thumbnail_path = thumbnailPath;
    }

    // Reverse geocoding
    if (metadata.gps_lat != null && metadata.gps_lng != null) {
      const location = geocodingService.findNearestCity(metadata.gps_lat, metadata.gps_lng);
      if (location) {
        // Format: "City, Country" or just "Country"
        const parts = [];
        if (location.city) parts.push(location.city);
        if (location.country) parts.push(location.country);
        if (parts.length > 0) {
          metadata.location_label = parts.join(', ');
        }
      }
    }

    const { keywords: aiKeywords, embedding } = await analyzeKeywords(filePath, thumbnailPath);
    if (aiKeywords.length) {
      metadata.ai_labels = aiKeywords;
    }
    if (embedding) {
      metadata.embedding = embedding;
    }
    parentPort.postMessage({
      type: 'result',
      jobId,
      volumeId,
      filePath,
      metadataSignature,
      success: true,
      metadata,
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'result',
      jobId,
      volumeId,
      filePath,
      metadataSignature,
      success: false,
      error: error?.message || 'Unknown EXIF error',
    });
  }
});

async function parseMetadata(filePath) {
  const tags = await exifr.parse(filePath, {
    translateValues: false,
    reviveValues: false,
    tiff: true,
    ifd0: true,
    exif: true,
    gps: true,
    xmp: false,
  });

  if (!tags || typeof tags !== 'object') {
    return {};
  }

  return {
    camera_make: tags.Make || tags.make || null,
    camera_model: tags.Model || tags.model || null,
    lens_model: tags.LensModel || tags.lensModel || null,
    focal_length_mm: normalizeNumber(tags.FocalLength || tags.focalLength),
    aperture: normalizeNumber(tags.FNumber || tags.ApertureValue || tags.fNumber),
    shutter_speed_s: normalizeShutter(tags.ExposureTime || tags.exposureTime),
    iso: normalizeNumber(tags.ISO || tags.iso),
    shoot_datetime: normalizeDate(tags.DateTimeOriginal || tags.CreateDate || tags.dateTimeOriginal),
    gps_lat: normalizeNumber(tags.latitude || tags.GPSLatitude),
    gps_lng: normalizeNumber(tags.longitude || tags.GPSLongitude),
    width_px: normalizeNumber(
      tags.ExifImageWidth || tags.ImageWidth || tags.PixelXDimension || tags.imageWidth,
    ),
    height_px: normalizeNumber(
      tags.ExifImageHeight || tags.ImageHeight || tags.PixelYDimension || tags.imageHeight,
    ),
    orientation: normalizeNumber(tags.Orientation || tags.orientation),
  };
}

async function generateThumbnail(volumeId, filePath) {
  try {
    ensureThumbnailDir();
  } catch (error) {
    console.warn('Unable to prepare thumbnail directory', error);
    return null;
  }

  const thumbnailPath = getThumbnailPath(volumeId, filePath);
  const ext = path.extname(filePath).toLowerCase();
  const isJpeg = ext === '.jpg' || ext === '.jpeg';
  const isSupportedRaster = ['.png', '.tif', '.tiff', '.bmp', '.gif'].includes(ext);

  if (!isJpeg && !isSupportedRaster) {
    return null;
  }

  try {
    const image = await Jimp.read(filePath);
    // Default alignment is already center/middle, so no need to specify
    image.cover({ w: 384, h: 384 });
    await image.write(thumbnailPath, { quality: 85 });
    return thumbnailPath;
  } catch (error) {
    console.warn('Failed to generate thumbnail', filePath, error.message);
    return null;
  }
}

function getThumbnailPath(volumeId, filePath) {
  const hash = crypto
    .createHash('sha1')
    .update(`${volumeId}|${filePath}`)
    .digest('hex');
  return path.join(thumbnailBaseDir, `thumb_${hash}.jpg`);
}

function ensureThumbnailDir() {
  if (thumbnailDirReady || !thumbnailBaseDir) {
    return;
  }
  fs.mkdirSync(thumbnailBaseDir, { recursive: true });
  thumbnailDirReady = true;
}

function normalizeNumber(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'object' && typeof value.numerator === 'number' && typeof value.denominator === 'number') {
    if (value.denominator === 0) {
      return null;
    }
    return value.numerator / value.denominator;
  }
  return null;
}

function normalizeShutter(value) {
  const number = normalizeNumber(value);
  if (number != null) {
    return number;
  }
  if (typeof value === 'string') {
    if (value.includes('/')) {
      const [num, den] = value.split('/').map((part) => Number(part));
      if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
        return num / den;
      }
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const sanitized = trimmed.replace(/\s+/g, ' ');
    const isoFriendly = sanitized.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
    const needsT = !isoFriendly.includes('T');
    const isoCandidate = needsT ? isoFriendly.replace(' ', 'T') : isoFriendly;
    const parsed = Date.parse(isoCandidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    const fallback = Date.parse(trimmed);
    if (Number.isFinite(fallback)) {
      return fallback;
    }
    return null;
  }
  return null;
}

async function analyzeKeywords(originalFilePath, thumbnailPath) {
  const candidatePaths = [thumbnailPath, originalFilePath].filter(
    (entry) => typeof entry === 'string' && entry.length,
  );
  for (const candidate of candidatePaths) {
    if (!isSupportedImageFile(candidate)) {
      continue;
    }
    const { keywords, embedding } = await generateClipData(candidate);
    if (keywords.length || embedding) {
      return { keywords, embedding };
    }
  }
  return { keywords: [], embedding: null };
}

async function warmClipModel() {
  try {
    await ensureClipModelReady();
    console.info('[exif-worker] CLIP model warmed.');
  } catch (error) {
    console.warn('[exif-worker] Failed to warm CLIP model', error);
  }
}
