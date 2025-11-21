const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const SCHEMA_VERSION = 8;
const PERSIST_DEBOUNCE_MS = 1000;

let SQL = null;
let dbInstance = null;
let dbPath = null;
let persistTimer = null;
let isDirty = false;

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const DEFAULT_MIN_SEMANTIC_SCORE = 0.25;
const DEFAULT_AI_COLLECTION_MIN_COUNT = 10;
const DEFAULT_CITY_COLLECTION_MIN_COUNT = 10;

function canonicalizeLocationLabel(rawLabel) {
  if (!rawLabel || typeof rawLabel !== 'string') {
    return null;
  }
  const trimmed = rawLabel.trim();
  if (!trimmed) {
    return null;
  }
  const parts = trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) {
    return null;
  }
  const city = parts[0];
  const country = parts.length > 1 ? parts[parts.length - 1] : null;
  const label = country ? `${city}, ${country}` : city;
  const keyParts = [city.toLowerCase()];
  if (country) {
    keyParts.push(country.toLowerCase());
  }
  return {
    key: keyParts.join('::'),
    city,
    country,
    label,
    raw: trimmed,
  };
}

const SORT_CLAUSES = {
  date_desc: `
    ORDER BY
      CASE WHEN shoot_datetime IS NULL THEN 1 ELSE 0 END,
      shoot_datetime DESC,
      id DESC
  `,
  date_asc: `
    ORDER BY
      CASE WHEN shoot_datetime IS NULL THEN 1 ELSE 0 END,
      shoot_datetime ASC,
      id ASC
  `,
  name: `
    ORDER BY
      file_name COLLATE NOCASE ASC,
      id ASC
  `,
  size: `
    ORDER BY
      file_size_bytes DESC,
      id DESC
  `,
};

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function normalizeTagArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean);
      }
    } catch (_error) {
      return value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function normalizeAiLabelArray(value) {
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
      const score = Number(entry.score);
      const normalizedScore = Number.isFinite(score) ? Number(score.toFixed(4)) : null;
      return {
        label,
        score: normalizedScore,
      };
    })
    .filter((entry) => entry && entry.label && entry.score != null);
}

function serializeTags(tags) {
  const normalized = normalizeTagArray(tags);
  if (!normalized.length) {
    return null;
  }
  return JSON.stringify(normalized);
}

function deserializeTags(value) {
  return normalizeTagArray(value);
}

function deserializeAiLabels(value) {
  return normalizeAiLabelArray(value);
}

function normalizeDescription(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function toNumberOrNull(value) {
  if (value == null || value === '') {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeRating(value) {
  const num = toNumberOrNull(value);
  if (num == null) {
    return null;
  }
  const clamped = Math.max(0, Math.min(5, Math.round(num)));
  return clamped;
}

function clampLimit(limit) {
  const parsed = toNumberOrNull(limit);
  if (parsed == null) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.max(1, Math.min(Math.floor(parsed), MAX_PAGE_SIZE));
}

function clampSimilarityThreshold(value) {
  const parsed = toNumberOrNull(value);
  if (parsed == null) {
    return DEFAULT_MIN_SEMANTIC_SCORE;
  }
  const normalized = Math.max(0, Math.min(Number(parsed), 1));
  return Number.isFinite(normalized) ? normalized : DEFAULT_MIN_SEMANTIC_SCORE;
}

function buildSortClause(sortBy) {
  if (sortBy && SORT_CLAUSES[sortBy]) {
    return SORT_CLAUSES[sortBy];
  }
  return SORT_CLAUSES.date_desc;
}

function buildFilterClause(filter = {}) {
  const conditions = [];
  const params = [];

  if (filter.volumeId) {
    conditions.push('volume_id = ?');
    params.push(canonicalizeVolumeId(filter.volumeId));
  }

  const cameraModels = normalizeStringArray(filter.cameraModels);
  if (cameraModels.length) {
    const placeholders = cameraModels.map(() => '?').join(', ');
    conditions.push(`camera_model IN (${placeholders})`);
    params.push(...cameraModels);
  }

  const lensModels = normalizeStringArray(filter.lensModels);
  if (lensModels.length) {
    const placeholders = lensModels.map(() => '?').join(', ');
    conditions.push(`lens_model IN (${placeholders})`);
    params.push(...lensModels);
  }

  const dateFrom = toNumberOrNull(filter.dateFrom);
  if (dateFrom != null) {
    conditions.push('shoot_datetime >= ?');
    params.push(dateFrom);
  }

  const dateTo = toNumberOrNull(filter.dateTo);
  if (dateTo != null) {
    conditions.push('shoot_datetime <= ?');
    params.push(dateTo);
  }

  const isoMin = toNumberOrNull(filter.isoMin);
  if (isoMin != null) {
    conditions.push('iso >= ?');
    params.push(isoMin);
  }

  const isoMax = toNumberOrNull(filter.isoMax);
  if (isoMax != null) {
    conditions.push('iso <= ?');
    params.push(isoMax);
  }

  const apertureMin = toNumberOrNull(filter.apertureMin);
  if (apertureMin != null) {
    conditions.push('aperture >= ?');
    params.push(apertureMin);
  }

  const apertureMax = toNumberOrNull(filter.apertureMax);
  if (apertureMax != null) {
    conditions.push('aperture <= ?');
    params.push(apertureMax);
  }

  const focalMin = toNumberOrNull(filter.focalMin);
  if (focalMin != null) {
    conditions.push('focal_length_mm >= ?');
    params.push(focalMin);
  }

  const focalMax = toNumberOrNull(filter.focalMax);
  if (focalMax != null) {
    conditions.push('focal_length_mm <= ?');
    params.push(focalMax);
  }

  const searchText = typeof filter.searchText === 'string' ? filter.searchText.trim().toLowerCase() : '';
  const legacyText = typeof filter.text === 'string' ? filter.text.trim().toLowerCase() : '';
  const text = searchText || legacyText;
  if (text) {
    conditions.push(`
      (
        LOWER(file_name) LIKE '%' || ? || '%' OR
        LOWER(camera_model) LIKE '%' || ? || '%' OR
        LOWER(lens_model) LIKE '%' || ? || '%' OR
        LOWER(COALESCE(tags, '')) LIKE '%' || ? || '%' OR
        LOWER(COALESCE(ai_labels, '')) LIKE '%' || ? || '%' OR
        LOWER(COALESCE(location_label, '')) LIKE '%' || ? || '%'
      )
    `);
    params.push(text, text, text, text, text, text);
  }

  const aiLabel = typeof filter.aiLabel === 'string' ? filter.aiLabel.trim().toLowerCase() : '';
  if (aiLabel) {
    conditions.push(`LOWER(COALESCE(ai_labels, '')) LIKE '%' || ? || '%'`);
    params.push(aiLabel);
  }

  const tagFilters = normalizeStringArray(filter.tags);
  if (tagFilters.length) {
    tagFilters.forEach((tag) => {
      if (!tag) {
        return;
      }
      conditions.push(`LOWER(COALESCE(tags, '')) LIKE '%' || ? || '%'`);
      params.push(tag.toLowerCase());
    });
  }

  const locationFilters = normalizeStringArray(filter.locationIds).map((value) => value.toLowerCase());
  if (locationFilters.length) {
    const locationClause = locationFilters
      .map(() => "LOWER(TRIM(COALESCE(location_label, ''))) = ?")
      .join(' OR ');
    conditions.push(`(${locationClause})`);
    params.push(...locationFilters);
  }

  // Favorites filter (photos with rating >= 4)
  if (filter.favoritesOnly === true) {
    conditions.push('rating >= ?');
    params.push(4);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

function canonicalizeVolumeId(volumeId) {
  if (typeof volumeId !== 'string') {
    return volumeId;
  }
  const separatorIndex = volumeId.indexOf('|');
  if (separatorIndex === -1) {
    return volumeId;
  }
  return volumeId.slice(separatorIndex + 1);
}

async function initDb(app) {
  if (dbInstance) {
    return dbInstance;
  }

  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  SQL = await initSqlJs({
    locateFile: (file) => {
      if (file === 'sql-wasm.wasm') {
        return wasmPath;
      }
      return path.join(path.dirname(wasmPath), file);
    },
  });

  const userDataPath = app.getPath('userData');
  dbPath = path.join(userDataPath, 'photoalbum.db');

  if (fs.existsSync(dbPath)) {
    const fileData = fs.readFileSync(dbPath);
    dbInstance = new SQL.Database(new Uint8Array(fileData));
  } else {
    dbInstance = new SQL.Database();
    createSchema();
    persistDb();
  }

  ensureSchema();
  return dbInstance;
}

function ensureSchema() {
  if (!tableExists('schema_info')) {
    createSchema();
    persistDb();
    return;
  }

  const version = getSchemaVersion();
  if (version < SCHEMA_VERSION) {
    migrateSchema(version);
    persistDb();
  }
}

function tableExists(tableName) {
  const stmt = dbInstance.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?;",
  );
  stmt.bind([tableName]);
  const exists = stmt.step();
  stmt.free();
  return exists;
}

function getSchemaVersion() {
  const stmt = dbInstance.prepare('SELECT version FROM schema_info LIMIT 1;');
  const version = stmt.step() ? stmt.getAsObject().version : 0;
  stmt.free();
  return version || 0;
}

function createSchema() {
  dbInstance.run(`
    CREATE TABLE schema_info (
      version INTEGER NOT NULL
    );
  `);

  dbInstance.run(`
    CREATE TABLE photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      volume_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      created_at_fs INTEGER,
      mtime_ms INTEGER NOT NULL,
      format TEXT,
      hash TEXT,
      metadata_signature TEXT,
      raw_file_path TEXT,
      camera_make TEXT,
      camera_model TEXT,
      lens_model TEXT,
      focal_length_mm REAL,
      aperture REAL,
      shutter_speed_s REAL,
      iso INTEGER,
      shoot_datetime INTEGER,
      gps_lat REAL,
      gps_lng REAL,
      width_px INTEGER,
      height_px INTEGER,
      orientation INTEGER,
      thumbnail_path TEXT,
      ai_labels TEXT,
      description TEXT,
      tags TEXT,
      location_label TEXT,
      rating INTEGER,
      embedding BLOB,
      imported_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(volume_id, file_path)
    );
  `);

  dbInstance.run(`
    CREATE INDEX idx_photos_volume_path ON photos(volume_id, file_path);
  `);
  dbInstance.run(`
    CREATE INDEX idx_photos_shoot_datetime ON photos(shoot_datetime);
  `);
  dbInstance.run(`
    CREATE INDEX idx_photos_camera_model ON photos(camera_model);
  `);
  dbInstance.run(`
    CREATE INDEX idx_photos_iso ON photos(iso);
  `);
  dbInstance.run(`
    CREATE INDEX idx_photos_focal_length ON photos(focal_length_mm);
  `);

  dbInstance.run('INSERT INTO schema_info(version) VALUES (?);', [SCHEMA_VERSION]);
}

function migrateSchema(currentVersion) {
  if (currentVersion < 2) {
    // Add raw_file_path column for RAW+JPEG pairing
    dbInstance.run('ALTER TABLE photos ADD COLUMN raw_file_path TEXT;');
  }
  if (currentVersion < 3) {
    dbInstance.run('ALTER TABLE photos ADD COLUMN metadata_signature TEXT;');
  }
  if (currentVersion < 4) {
    migrateVolumeIdsToMountPath();
  }
  if (currentVersion < 5) {
    dbInstance.run('ALTER TABLE photos ADD COLUMN description TEXT;');
    dbInstance.run('ALTER TABLE photos ADD COLUMN tags TEXT;');
  }
  if (currentVersion < 6) {
    dbInstance.run('ALTER TABLE photos ADD COLUMN location_label TEXT;');
  }
  if (currentVersion < 7) {
    dbInstance.run('ALTER TABLE photos ADD COLUMN rating INTEGER;');
  }
  if (currentVersion < 8) {
    dbInstance.run('ALTER TABLE photos ADD COLUMN embedding BLOB;');
  }
  dbInstance.run('UPDATE schema_info SET version = ?;', [SCHEMA_VERSION]);
}

function formatFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  return ext || null;
}

function upsertPhotoBasic(fileInfo) {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  if (!fileInfo || !fileInfo.volumeId || !fileInfo.path) {
    return;
  }
  const normalizedVolumeId = canonicalizeVolumeId(fileInfo.volumeId);
  if (!normalizedVolumeId) {
    return;
  }

  const timestamp = Date.now();
  const payload = [
    normalizedVolumeId,
    fileInfo.path,
    path.basename(fileInfo.path),
    fileInfo.size ?? 0,
    fileInfo.birthtimeMs ?? null,
    fileInfo.mtimeMs ?? timestamp,
    formatFromPath(fileInfo.path),
    fileInfo.rawFilePath ?? null,
    timestamp,
    timestamp,
  ];

  dbInstance.run(
    `
      INSERT INTO photos (
        volume_id,
        file_path,
        file_name,
        file_size_bytes,
        created_at_fs,
        mtime_ms,
        format,
        raw_file_path,
        imported_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(volume_id, file_path) DO UPDATE SET
        file_name = excluded.file_name,
        file_size_bytes = excluded.file_size_bytes,
        mtime_ms = excluded.mtime_ms,
        format = excluded.format,
        raw_file_path = excluded.raw_file_path,
        updated_at = excluded.updated_at
    `,
    payload,
  );

  schedulePersist();
}

function updatePhotoMetadataByPath(volumeId, filePath, patch = {}) {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  const normalizedVolumeId = canonicalizeVolumeId(volumeId);

  const columns = {
    camera_make: 'camera_make',
    camera_model: 'camera_model',
    lens_model: 'lens_model',
    focal_length_mm: 'focal_length_mm',
    aperture: 'aperture',
    shutter_speed_s: 'shutter_speed_s',
    iso: 'iso',
    shoot_datetime: 'shoot_datetime',
    gps_lat: 'gps_lat',
    gps_lng: 'gps_lng',
    width_px: 'width_px',
    height_px: 'height_px',
    orientation: 'orientation',
    thumbnail_path: 'thumbnail_path',
    hash: 'hash',
    metadata_signature: 'metadata_signature',
    ai_labels: 'ai_labels',
    description: 'description',
    tags: 'tags',
    location_label: 'location_label',
    embedding: 'embedding',
  };

  const setClauses = [];
  const params = [];

  Object.entries(patch).forEach(([key, value]) => {
    const column = columns[key];
    if (!column) {
      return;
    }
    if (key === 'ai_labels' && value && typeof value !== 'string') {
      value = JSON.stringify(value);
    }
    if (key === 'embedding' && Array.isArray(value)) {
      value = JSON.stringify(value);
    }
    if (key === 'tags') {
      value = serializeTags(value);
    }
    if (key === 'description') {
      value = normalizeDescription(value);
    }
    setClauses.push(`${column} = ?`);
    params.push(value);
  });

  if (!setClauses.length) {
    return 0;
  }

  setClauses.push('updated_at = ?');
  params.push(Date.now());
  params.push(normalizedVolumeId, filePath);

  const sql = `
    UPDATE photos
    SET ${setClauses.join(', ')}
    WHERE volume_id = ? AND file_path = ?
  `;

  const stmt = dbInstance.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();

  schedulePersist();
  return dbInstance.getRowsModified();
}

function updatePhotoDetails(photoId, patch = {}) {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  const numericId = Number(photoId);
  if (!Number.isFinite(numericId)) {
    throw new Error('photoId is required to update details');
  }

  const setClauses = [];
  const params = [];

  if ('description' in patch) {
    const normalized = normalizeDescription(patch.description);
    setClauses.push('description = ?');
    params.push(normalized);
  }

  if ('tags' in patch) {
    const serializedTags = serializeTags(patch.tags);
    setClauses.push('tags = ?');
    params.push(serializedTags);
  }

  if ('locationLabel' in patch || 'location_label' in patch) {
    const value = patch.locationLabel ?? patch.location_label;
    const normalizedLocation = normalizeDescription(value);
    setClauses.push('location_label = ?');
    params.push(normalizedLocation);
  }

  if ('rating' in patch) {
    const normalizedRating = normalizeRating(patch.rating);
    setClauses.push('rating = ?');
    params.push(normalizedRating);
  }

  if (!setClauses.length) {
    return 0;
  }

  setClauses.push('updated_at = ?');
  params.push(Date.now());
  params.push(numericId);

  const stmt = dbInstance.prepare(
    `
      UPDATE photos
      SET ${setClauses.join(', ')}
      WHERE id = ?
    `,
  );
  stmt.bind(params);
  stmt.step();
  stmt.free();

  schedulePersist();
  return dbInstance.getRowsModified();
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function getPhotos(filter = {}) {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }

  const safeFilter = filter && typeof filter === 'object' ? filter : {};
  const { whereClause, params } = buildFilterClause(safeFilter);
  const sortClause = buildSortClause(safeFilter.sortBy);
  const limit = clampLimit(safeFilter.limit);
  const cursorValue = toNumberOrNull(safeFilter.cursor);
  const offsetValue = toNumberOrNull(safeFilter.offset);
  let offset = 0;
  if (cursorValue != null && cursorValue >= 0) {
    offset = Math.floor(cursorValue);
  } else if (offsetValue != null && offsetValue > 0) {
    offset = Math.floor(offsetValue);
  }

  // Vector search path
  if (safeFilter.embedding && Array.isArray(safeFilter.embedding)) {
    const queryEmbedding = safeFilter.embedding;
    
    // For vector search, we want to find photos that match the *meaning* of the query,
    // even if they don't contain the exact text keywords.
    // So we exclude the text search params from the SQL filter, relying on the embedding for relevance.
    // We still respect other filters (date, camera, etc).
    const vectorFilter = { ...safeFilter };
    const similarityThreshold = clampSimilarityThreshold(vectorFilter.minSimilarity);
    delete vectorFilter.minSimilarity;
    delete vectorFilter.searchText;
    delete vectorFilter.text;
    
    const { whereClause, params } = buildFilterClause(vectorFilter);
    
    // Fetch all candidates (id + embedding) that match other filters
    const candidateStmt = dbInstance.prepare(
      `
        SELECT
          id,
          embedding
        FROM photos
        ${whereClause}
      `,
    );
    candidateStmt.bind(params);
    
    const candidates = [];
    while (candidateStmt.step()) {
      const row = candidateStmt.getAsObject();
      if (row.embedding) {
        try {
          const vec = JSON.parse(row.embedding);
          if (Array.isArray(vec)) {
            candidates.push({ id: row.id, embedding: vec });
          }
        } catch (e) {
          // Ignore invalid embeddings
        }
      }
    }
    candidateStmt.free();

    // Compute scores
    candidates.forEach(c => {
      c.score = cosineSimilarity(queryEmbedding, c.embedding);
    });

    const filteredCandidates = candidates
      .filter((candidate) => candidate.score >= similarityThreshold)
      .sort((a, b) => b.score - a.score);

    const total = filteredCandidates.length;
    const slice = filteredCandidates.slice(offset, offset + limit);
    const ids = slice.map(c => c.id);

    if (!ids.length) {
      return {
        items: [],
        photos: [],
        total,
        totalCount: total,
        nextOffset: null,
        nextCursor: null,
      };
    }

    // Fetch full details for the page
    const placeholders = ids.map(() => '?').join(',');
    const detailStmt = dbInstance.prepare(
      `
        SELECT
          id,
          volume_id AS volumeId,
          file_path AS filePath,
          file_name AS fileName,
          file_size_bytes AS fileSizeBytes,
          raw_file_path AS rawFilePath,
          thumbnail_path AS thumbnailPath,
          shoot_datetime AS shootDateTime,
          camera_make AS cameraMake,
          camera_model AS cameraModel,
          lens_model AS lensModel,
          iso,
          focal_length_mm AS focalLengthMm,
          aperture,
          shutter_speed_s AS shutterSpeedSeconds,
          format,
          gps_lat AS gpsLat,
          gps_lng AS gpsLng,
          description,
          tags,
          ai_labels AS aiLabels,
          location_label AS locationLabel,
          rating,
          CASE
            WHEN raw_file_path IS NOT NULL THEN 1
            WHEN format IS NOT NULL AND LOWER(format) IN ('arw','cr2','cr3','nef','orf','raf','rw2','dng','srw') THEN 1
            ELSE 0
          END AS isRaw
        FROM photos
        WHERE id IN (${placeholders})
      `
    );
    detailStmt.bind(ids);
    
    const rowsMap = new Map();
    while (detailStmt.step()) {
      const row = detailStmt.getAsObject();
      if (row) {
        row.tags = deserializeTags(row.tags);
        row.aiLabels = deserializeAiLabels(row.aiLabels);
        row.description = row.description || null;
        row.locationLabel = row.locationLabel || null;
        row.rating = row.rating != null ? Number(row.rating) : null;
        row.isRaw = Boolean(row.isRaw);
        rowsMap.set(row.id, row);
      }
    }
    detailStmt.free();

    // Reorder to match sorted IDs
    const rows = ids.map(id => rowsMap.get(id)).filter(Boolean);

    const nextOffset = offset + rows.length;
    const hasMore = nextOffset < total;
    const nextCursor = hasMore ? String(nextOffset) : null;

    return {
      items: rows,
      photos: rows,
      total,
      totalCount: total,
      nextOffset: hasMore ? nextOffset : null,
      nextCursor,
    };
  }

  const stmt = dbInstance.prepare(
    `
      SELECT
        id,
        volume_id AS volumeId,
        file_path AS filePath,
        file_name AS fileName,
        file_size_bytes AS fileSizeBytes,
        raw_file_path AS rawFilePath,
        thumbnail_path AS thumbnailPath,
        shoot_datetime AS shootDateTime,
        camera_make AS cameraMake,
        camera_model AS cameraModel,
        lens_model AS lensModel,
        iso,
        focal_length_mm AS focalLengthMm,
        aperture,
        shutter_speed_s AS shutterSpeedSeconds,
        format,
        gps_lat AS gpsLat,
        gps_lng AS gpsLng,
        description,
        tags,
        ai_labels AS aiLabels,
        location_label AS locationLabel,
        rating,
        CASE
          WHEN raw_file_path IS NOT NULL THEN 1
          WHEN format IS NOT NULL AND LOWER(format) IN ('arw','cr2','cr3','nef','orf','raf','rw2','dng','srw') THEN 1
          ELSE 0
        END AS isRaw
      FROM photos
      ${whereClause}
      ${sortClause}
      LIMIT ? OFFSET ?
    `,
  );

  stmt.bind([...params, limit, offset]);
  const rows = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    if (row) {
      row.tags = deserializeTags(row.tags);
      row.aiLabels = deserializeAiLabels(row.aiLabels);
      row.description = row.description || null;
      row.locationLabel = row.locationLabel || null;
      row.rating = row.rating != null ? Number(row.rating) : null;
      row.isRaw = Boolean(row.isRaw);
    }
    rows.push(row);
  }
  stmt.free();

  const total = countPhotos(safeFilter);
  const nextOffset = offset + rows.length;
  const hasMore = nextOffset < total;
  const nextCursor = hasMore ? String(nextOffset) : null;

  return {
    items: rows,
    photos: rows,
    total,
    totalCount: total,
    nextOffset: hasMore ? nextOffset : null,
    nextCursor,
  };
}

function deletePhotos(photoIds) {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  if (!Array.isArray(photoIds) || !photoIds.length) {
    return 0;
  }

  const placeholders = photoIds.map(() => '?').join(', ');
  const stmt = dbInstance.prepare(`DELETE FROM photos WHERE id IN (${placeholders});`);
  stmt.bind(photoIds);
  stmt.step();
  stmt.free();
  const deleted = dbInstance.getRowsModified();
  if (deleted) {
    schedulePersist();
  }
  return deleted;
}

function deletePhotosForVolume(volumeId) {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  const normalizedVolumeId = canonicalizeVolumeId(volumeId);
  const stmt = dbInstance.prepare('DELETE FROM photos WHERE volume_id = ?;');
  stmt.bind([normalizedVolumeId]);
  stmt.step();
  stmt.free();
  const deleted = dbInstance.getRowsModified();
  if (deleted) {
    schedulePersist();
  }
  return deleted;
}

function clearDatabase() {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  dbInstance.run('DELETE FROM photos;');
  schedulePersist();
}

function pruneMissingVolumePhotos(volumeId, currentFilePaths = []) {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  const normalizedVolumeId = canonicalizeVolumeId(volumeId);
  const normalizedPaths = Array.isArray(currentFilePaths)
    ? currentFilePaths
    : Array.from(currentFilePaths || []);
  const keepSet = new Set(
    normalizedPaths.filter((filePath) => typeof filePath === 'string' && filePath.length),
  );

  const stmt = dbInstance.prepare('SELECT file_path FROM photos WHERE volume_id = ?;');
  stmt.bind([normalizedVolumeId]);
  const stalePaths = [];
  while (stmt.step()) {
    const record = stmt.getAsObject();
    const filePath = record.file_path;
    if (!keepSet.has(filePath)) {
      stalePaths.push(filePath);
    }
  }
  stmt.free();

  if (!stalePaths.length) {
    return 0;
  }

  const deleteStmt = dbInstance.prepare('DELETE FROM photos WHERE volume_id = ? AND file_path = ?;');
  let removed = 0;
  try {
    stalePaths.forEach((filePath) => {
      deleteStmt.bind([normalizedVolumeId, filePath]);
      deleteStmt.step();
      removed += dbInstance.getRowsModified();
      deleteStmt.reset();
    });
  } finally {
    deleteStmt.free();
  }

  if (removed) {
    schedulePersist();
  }
  return removed;
}

function getAiKeywordCollections(minCount = DEFAULT_AI_COLLECTION_MIN_COUNT) {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  const threshold = Math.max(1, Number(minCount) || DEFAULT_AI_COLLECTION_MIN_COUNT);
  const stmt = dbInstance.prepare(`
    SELECT
      id,
      ai_labels AS aiLabels,
      thumbnail_path AS thumbnailPath,
      file_path AS filePath
    FROM photos
    WHERE ai_labels IS NOT NULL AND TRIM(ai_labels) != ''
    ORDER BY id DESC
  `);

  const buckets = new Map();

  while (stmt.step()) {
    const row = stmt.getAsObject();
    const labels = deserializeAiLabels(row.aiLabels);
    labels.forEach((entry) => {
      const label = typeof entry?.label === 'string' ? entry.label.trim() : '';
      if (!label) {
        return;
      }
      const key = label.toLowerCase();
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          label,
          count: 0,
          latestPhoto: null,
        };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      if (!bucket.latestPhoto) {
        bucket.latestPhoto = {
          id: row.id,
          thumbnailPath: row.thumbnailPath || null,
          filePath: row.filePath || null,
        };
      }
    });
  }
  stmt.free();

  return Array.from(buckets.values())
    .filter((entry) => entry.count >= threshold)
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.label.localeCompare(b.label);
    });
}

function getCityCollections(minCount = DEFAULT_CITY_COLLECTION_MIN_COUNT) {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  const threshold = Math.max(1, Number(minCount) || DEFAULT_CITY_COLLECTION_MIN_COUNT);
  const stmt = dbInstance.prepare(`
    SELECT
      id,
      location_label AS locationLabel,
      thumbnail_path AS thumbnailPath,
      file_path AS filePath
    FROM photos
    WHERE location_label IS NOT NULL AND TRIM(location_label) != ''
    ORDER BY id DESC
  `);

  const buckets = new Map();

  while (stmt.step()) {
    const row = stmt.getAsObject();
    const canonical = canonicalizeLocationLabel(row.locationLabel);
    if (!canonical) {
      continue;
    }
    const key = canonical.key;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        label: canonical.label,
        city: canonical.city,
        country: canonical.country,
        count: 0,
        latestPhoto: null,
        locationLabels: new Set(),
      };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.locationLabels.add(canonical.raw);
    if (!bucket.latestPhoto) {
      bucket.latestPhoto = {
        id: row.id,
        thumbnailPath: row.thumbnailPath || null,
        filePath: row.filePath || null,
      };
    }
  }

  stmt.free();

  return Array.from(buckets.values())
    .filter((entry) => entry.count >= threshold)
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.city.localeCompare(b.city);
    })
    .map((entry) => ({
      ...entry,
      locationLabels: Array.from(entry.locationLabels),
    }));
}

function isMetadataOutdated(volumeId, filePath, signature) {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  if (!signature) {
    return true;
  }
  const normalizedVolumeId = canonicalizeVolumeId(volumeId);
  const stmt = dbInstance.prepare(
    'SELECT metadata_signature FROM photos WHERE volume_id = ? AND file_path = ? LIMIT 1;',
  );
  stmt.bind([normalizedVolumeId, filePath]);
  const needsUpdate = !stmt.step() || stmt.getAsObject().metadata_signature !== signature;
  stmt.free();
  return needsUpdate;
}

function migrateVolumeIdsToMountPath() {
  if (!dbInstance) {
    return;
  }

  const stmt = dbInstance.prepare("SELECT id, volume_id, file_path, updated_at FROM photos WHERE instr(volume_id, '|') > 0;");
  const records = [];
  while (stmt.step()) {
    records.push(stmt.getAsObject());
  }
  stmt.free();

  if (!records.length) {
    return;
  }

  const deleteStmt = dbInstance.prepare('DELETE FROM photos WHERE id = ?;');
  const updateStmt = dbInstance.prepare('UPDATE photos SET volume_id = ? WHERE id = ?;');
  const keepers = new Map();

  records.forEach((record) => {
    const normalizedId = canonicalizeVolumeId(record.volume_id);
    const key = `${normalizedId}::${record.file_path}`;
    const existing = keepers.get(key);
    if (existing) {
      if (record.updated_at > existing.updated_at) {
        deleteStmt.bind([existing.id]);
        deleteStmt.step();
        deleteStmt.reset();
        keepers.set(key, {
          id: record.id,
          normalizedId,
          updated_at: record.updated_at,
        });
      } else {
        deleteStmt.bind([record.id]);
        deleteStmt.step();
        deleteStmt.reset();
      }
    } else {
      keepers.set(key, {
        id: record.id,
        normalizedId,
        updated_at: record.updated_at,
      });
    }
  });
  deleteStmt.free();

  keepers.forEach((entry) => {
    updateStmt.bind([entry.normalizedId, entry.id]);
    updateStmt.step();
    updateStmt.reset();
  });
  updateStmt.free();
}

function getPhotosForStats(filter = {}) {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  const safeFilter = filter && typeof filter === 'object' ? filter : {};
  const { whereClause, params } = buildFilterClause(safeFilter);
  const stmt = dbInstance.prepare(
    `
      SELECT
        shoot_datetime,
        camera_model,
        lens_model,
        iso,
        aperture,
        shutter_speed_s,
        focal_length_mm
      FROM photos
      ${whereClause}
    `,
  );
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function countPhotos(filter = {}) {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  const safeFilter = filter && typeof filter === 'object' ? filter : {};
  const { whereClause, params } = buildFilterClause(safeFilter);
  const stmt = dbInstance.prepare(
    `
      SELECT COUNT(1) AS total
      FROM photos
      ${whereClause}
    `,
  );
  stmt.bind(params);
  let total = 0;
  if (stmt.step()) {
    const row = stmt.getAsObject();
    total = Number(row.total) || 0;
  }
  stmt.free();
  return total;
}

function schedulePersist() {
  isDirty = true;
  if (persistTimer) {
    return;
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (isDirty) {
      persistDb();
    }
  }, PERSIST_DEBOUNCE_MS);
}

function persistDb() {
  if (!dbInstance || !dbPath) {
    return;
  }
  const data = dbInstance.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
  isDirty = false;
}

function shutdown() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (isDirty) {
    persistDb();
  }
}

function getDb() {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  return dbInstance;
}

function getPhotosWithoutAiLabels(volumeId, limit = 100) {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }

  const normalizedVolumeId = canonicalizeVolumeId(volumeId);
  const stmt = dbInstance.prepare(`
    SELECT
      id,
      volume_id,
      file_path,
      file_size_bytes,
      mtime_ms
    FROM photos
    WHERE volume_id = ?
      AND ai_labels IS NULL
    ORDER BY id ASC
    LIMIT ?
  `);

  stmt.bind([normalizedVolumeId, limit]);

  const photos = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    photos.push({
      id: row.id,
      volumeId: row.volume_id,
      path: row.file_path,
      size: row.file_size_bytes,
      mtimeMs: row.mtime_ms,
    });
  }

  stmt.free();
  return photos;
}

module.exports = {
  initDb,
  getDb,
  upsertPhotoBasic,
  updatePhotoMetadataByPath,
  updatePhotoDetails,
  getPhotos,
  deletePhotos,
  deletePhotosForVolume,
  pruneMissingVolumePhotos,
  isMetadataOutdated,
  getPhotosForStats,
  countPhotos,
  getPhotosWithoutAiLabels,
  getAiKeywordCollections,
  getCityCollections,
  clearDatabase,
  shutdown,
};
