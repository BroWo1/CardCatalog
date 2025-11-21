const db = require('./db');

const ISO_BUCKETS = [
  { key: 'ISO_0_199', min: 0, max: 199 },
  { key: 'ISO_200_399', min: 200, max: 399 },
  { key: 'ISO_400_799', min: 400, max: 799 },
  { key: 'ISO_800_1599', min: 800, max: 1599 },
  { key: 'ISO_1600_3199', min: 1600, max: 3199 },
  { key: 'ISO_3200_plus', min: 3200, max: Infinity },
];

const APERTURE_BUCKETS = [
  { key: 'F_1_0_1_8', min: 0, max: 1.8 },
  { key: 'F_1_8_2_8', min: 1.8, max: 2.8 },
  { key: 'F_2_8_4_0', min: 2.8, max: 4.0 },
  { key: 'F_4_0_5_6', min: 4.0, max: 5.6 },
  { key: 'F_5_6_PLUS', min: 5.6, max: Infinity },
];

const SHUTTER_BUCKETS = [
  { key: 'T_1_8000_1_1000', min: 1 / 8000, max: 1 / 1000 },
  { key: 'T_1_1000_1_250', min: 1 / 1000, max: 1 / 250 },
  { key: 'T_1_250_1_60', min: 1 / 250, max: 1 / 60 },
  { key: 'T_1_60_1_15', min: 1 / 60, max: 1 / 15 },
  { key: 'T_1_15_1', min: 1 / 15, max: 1 },
  { key: 'T_1_10S', min: 1, max: 10 },
  { key: 'T_10S_PLUS', min: 10, max: Infinity },
];

const FOCAL_BUCKETS = [
  { key: 'FL_0_24', min: 0, max: 24 },
  { key: 'FL_24_35', min: 24, max: 35 },
  { key: 'FL_35_50', min: 35, max: 50 },
  { key: 'FL_50_85', min: 50, max: 85 },
  { key: 'FL_85_135', min: 85, max: 135 },
  { key: 'FL_135_PLUS', min: 135, max: Infinity },
];

function computeStats(filter = {}) {
  // Allow volumeId to be null for "All Volumes" mode
  // if (!filter || !filter.volumeId) {
  //   throw new Error('volumeId is required to compute stats');
  // }

  const rows = db.getPhotosForStats(filter);

  const payload = {
    volumeId: filter.volumeId || null, // null means "All Volumes"
    totalPhotos: 0,
    dateRange: {
      earliestShoot: null,
      latestShoot: null,
    },
    byCameraModel: {},
    byLensModel: {},
    isoHistogram: makeBucketRecord(ISO_BUCKETS),
    apertureHistogram: makeBucketRecord(APERTURE_BUCKETS),
    shutterSpeedHistogram: makeBucketRecord(SHUTTER_BUCKETS),
    focalLengthHistogram: makeBucketRecord(FOCAL_BUCKETS),
    timeline: {},
  };

  rows.forEach((row) => {
    payload.totalPhotos += 1;
    const ts = normalizeNumber(row.shoot_datetime);
    if (ts != null) {
      if (payload.dateRange.earliestShoot === null || ts < payload.dateRange.earliestShoot) {
        payload.dateRange.earliestShoot = ts;
      }
      if (payload.dateRange.latestShoot === null || ts > payload.dateRange.latestShoot) {
        payload.dateRange.latestShoot = ts;
      }
      const dayKey = formatDayKey(ts);
      payload.timeline[dayKey] = (payload.timeline[dayKey] || 0) + 1;
    }

    if (row.camera_model) {
      const key = row.camera_model;
      payload.byCameraModel[key] = (payload.byCameraModel[key] || 0) + 1;
    }

    if (row.lens_model) {
      const key = row.lens_model;
      payload.byLensModel[key] = (payload.byLensModel[key] || 0) + 1;
    }

    const iso = normalizeNumber(row.iso);
    if (iso != null) {
      const bucket = findBucket(ISO_BUCKETS, iso);
      if (bucket) {
        payload.isoHistogram[bucket.key] += 1;
      }
    }

    const aperture = normalizeNumber(row.aperture);
    if (aperture != null) {
      const bucket = findBucket(APERTURE_BUCKETS, aperture);
      if (bucket) {
        payload.apertureHistogram[bucket.key] += 1;
      }
    }

    const shutter = normalizeNumber(row.shutter_speed_s);
    if (shutter != null && shutter > 0) {
      const bucket = findBucket(SHUTTER_BUCKETS, shutter);
      if (bucket) {
        payload.shutterSpeedHistogram[bucket.key] += 1;
      }
    }

    const focal = normalizeNumber(row.focal_length_mm);
    if (focal != null) {
      const bucket = findBucket(FOCAL_BUCKETS, focal);
      if (bucket) {
        payload.focalLengthHistogram[bucket.key] += 1;
      }
    }
  });

  return payload;
}

function computeStatsForVolume(volumeId) {
  return computeStats({ volumeId });
}

function makeBucketRecord(buckets) {
  return buckets.reduce((acc, bucket) => {
    acc[bucket.key] = 0;
    return acc;
  }, {});
}

function findBucket(buckets, value) {
  return buckets.find((bucket) => {
    const min = bucket.min ?? Number.NEGATIVE_INFINITY;
    const max = bucket.max ?? Number.POSITIVE_INFINITY;
    return value >= min && value < max;
  });
}

function normalizeNumber(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function formatDayKey(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    return 'unknown';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

module.exports = {
  computeStats,
  computeStatsForVolume,
};
