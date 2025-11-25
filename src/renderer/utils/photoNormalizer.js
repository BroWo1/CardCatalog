const RAW_FORMATS = ['arw', 'cr2', 'cr3', 'nef', 'orf', 'raf', 'rw2', 'dng', 'srw'];

export function normalizePhotoFromServer(photo) {
  if (!photo || typeof photo !== 'object') {
    return null;
  }
  const normalizedTags = coerceTagsArray(photo.tags);
  const aiLabels = coerceAiLabelArray(photo.aiLabels ?? photo.ai_labels);
  const lat = Number(photo.gpsLat);
  const lng = Number(photo.gpsLng);
  const format = typeof photo.format === 'string' ? photo.format.toLowerCase() : '';
  const derivedRaw = RAW_FORMATS.includes(format);
  const isRaw = photo.isRaw != null ? Boolean(photo.isRaw) : derivedRaw;
  return {
    ...photo,
    description: typeof photo.description === 'string' ? photo.description : photo.description ?? null,
    tags: normalizedTags,
    aiLabels,
    gpsLat: Number.isFinite(lat) ? lat : null,
    gpsLng: Number.isFinite(lng) ? lng : null,
    locationLabel: typeof photo.locationLabel === 'string' ? photo.locationLabel : null,
    isRaw,
    rating: normalizeRatingValue(photo.rating),
  };
}

export function coerceTagsArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean);
  }
  if (typeof value === 'string' && value.length) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean);
      }
    } catch (_error) {
      // Fall through to comma-delimited parsing
    }
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

export function coerceAiLabelArray(value) {
  if (!value) {
    return [];
  }
  let entries = [];
  if (Array.isArray(value)) {
    entries = value;
  } else if (typeof value === 'string' && value.length) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        entries = parsed;
      }
    } catch (_error) {
      return [];
    }
  }
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const label = typeof entry.label === 'string' ? entry.label.trim() : '';
      if (!label) {
        return null;
      }
      const scoreValue = Number(entry.score);
      if (!Number.isFinite(scoreValue)) {
        return null;
      }
      return {
        label,
        score: Number(scoreValue.toFixed(4)),
      };
    })
    .filter(Boolean);
}

export function normalizeRatingValue(value) {
  if (value == null || value === '') {
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  return Math.max(0, Math.min(5, Math.round(num)));
}
