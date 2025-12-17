const fs = require('fs');
const path = require('path');

let HierarchicalNSW = null;
let hnswlibLoadAttempted = false;

function getHierarchicalNSW(logger = console) {
  if (hnswlibLoadAttempted) {
    return HierarchicalNSW;
  }
  hnswlibLoadAttempted = true;
  try {
    ({ HierarchicalNSW } = require('hnswlib-node'));
  } catch (error) {
    HierarchicalNSW = null;
    if (logger && typeof logger.warn === 'function') {
      logger.warn('[hnsw] hnswlib-node unavailable; vector index disabled', error);
    }
  }
  return HierarchicalNSW;
}

const INDEX_VERSION = 1;
const DEFAULT_NUM_DIMENSIONS = 512;
const DEFAULT_MAX_ELEMENTS = 100000;
const DEFAULT_BATCH_SIZE = 400;
const SAVE_DEBOUNCE_MS = 2000;
const SYNC_DEBOUNCE_MS = 200;

let activeManager = null;

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

class HnswIndexManager {
  constructor(options = {}) {
    this.space = options.space || 'cosine';
    this.numDimensions = options.numDimensions || DEFAULT_NUM_DIMENSIONS;
    this.maxElements = options.maxElements || DEFAULT_MAX_ELEMENTS;
    this.m = options.m ?? 16;
    this.efConstruction = options.efConstruction ?? 200;
    this.efSearch = options.efSearch ?? 50;
    this.batchSize = Math.max(50, options.batchSize || DEFAULT_BATCH_SIZE);
    this.indexFilePath = options.indexFilePath;
    this.logger = options.logger || console;
    this.providers = options.providers || {};
    this.indexVersion = options.indexVersion || INDEX_VERSION;
    this.allowReplaceDeleted = true;

    this.index = null;
    this.knownIds = new Set();
    this.deletedIds = new Set();
    this.enabled = true;
    this.initialized = false;
    this.saveTimer = null;
    this.savePromise = null;
    this.syncTimer = null;
    this.syncPromise = null;
  }

  async initialize() {
    if (this.initialized) {
      return this;
    }
    if (!this.indexFilePath) {
      throw new Error('HNSW index requires an index file path');
    }
    try {
      fs.mkdirSync(path.dirname(this.indexFilePath), { recursive: true });
    } catch (error) {
      this.logger.warn('[hnsw] Unable to ensure index directory', error);
    }
    await this.loadOrRebuild();
    this.initialized = true;
    await this.syncPendingEmbeddings();
    return this;
  }

  async loadOrRebuild() {
    const storedVersion = await this.getMetadata('indexVersion');
    const indexExists = fs.existsSync(this.indexFilePath);
    if (storedVersion === String(this.indexVersion) && indexExists) {
      const loaded = await this.loadFromDisk();
      if (loaded) {
        return;
      }
    }
    await this.rebuildFromDatabase();
  }

  async loadFromDisk() {
    try {
      const HNSW = getHierarchicalNSW(this.logger);
      if (!HNSW) {
        throw new Error('hnswlib-node is unavailable');
      }
      this.index = new HNSW(this.space, this.numDimensions);
      this.index.readIndexSync(this.indexFilePath, this.allowReplaceDeleted);
      this.index.setEf(this.efSearch);
      const ids = this.index.getIdsList();
      this.knownIds = new Set(ids.map((id) => Number(id)));
      this.deletedIds.clear();
      this.logger.info('[hnsw] Loaded index from disk', {
        count: this.index.getCurrentCount(),
      });
      return true;
    } catch (error) {
      this.logger.warn('[hnsw] Failed to load index from disk, rebuilding', error);
      try {
        fs.unlinkSync(this.indexFilePath);
      } catch (unlinkError) {
        if (this.logger.debug) {
          this.logger.debug('[hnsw] Unable to remove corrupt index file', unlinkError);
        }
      }
      this.index = null;
      this.knownIds.clear();
      return false;
    }
  }

  async rebuildFromDatabase() {
    this.logger.info('[hnsw] Rebuilding index from database');
    const HNSW = getHierarchicalNSW(this.logger);
    if (!HNSW) {
      throw new Error('hnswlib-node is unavailable');
    }
    this.index = new HNSW(this.space, this.numDimensions);
    this.index.initIndex(this.maxElements, this.m, this.efConstruction, undefined, this.allowReplaceDeleted);
    this.index.setEf(this.efSearch);
    this.knownIds.clear();
    this.deletedIds.clear();
    if (this.providers.resetIndexFlags) {
      await Promise.resolve(this.providers.resetIndexFlags());
    }

    let afterId = null;
    let total = 0;
    while (true) {
      const batch = await this.fetchEmbeddingBatch({ limit: this.batchSize, afterId });
      if (!batch.length) {
        break;
      }
      await this.addBatchToIndex(batch);
      total += batch.length;
      afterId = batch[batch.length - 1].id;
      if (batch.length < this.batchSize) {
        break;
      }
    }

    await this.saveIndex();
    await this.setMetadata('indexVersion', String(this.indexVersion));
    await this.setMetadata('indexSize', String(total));
    await this.setMetadata('indexBuiltAt', String(Date.now()));
    this.logger.info('[hnsw] Rebuild completed', { total });
  }

  async fetchEmbeddingBatch(options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit) || this.batchSize, 2000));
    const afterId = toNumber(options.afterId);
    const onlyPending = Boolean(options.onlyPending);
    const provider = onlyPending
      ? this.providers.fetchPendingEmbeddings || this.providers.fetchEmbeddingsBatch
      : this.providers.fetchEmbeddingsBatch;
    if (typeof provider !== 'function') {
      return [];
    }
    const result = await Promise.resolve(provider({ limit, afterId, onlyPending }));
    if (!Array.isArray(result)) {
      return [];
    }
    return result
      .map((record) => {
        if (!record || record.id == null) {
          return null;
        }
        const vector = this.normalizeEmbedding(record.embedding);
        if (!vector) {
          return null;
        }
        return {
          id: Number(record.id),
          embedding: vector,
        };
      })
      .filter(Boolean);
  }

  normalizeEmbedding(raw) {
    if (!raw) {
      return null;
    }
    let vector = null;
    if (Array.isArray(raw)) {
      vector = raw;
    } else if (raw instanceof Uint8Array || Buffer.isBuffer(raw)) {
      const text = Buffer.from(raw).toString('utf8');
      try {
        vector = JSON.parse(text);
      } catch (_error) {
        return null;
      }
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) {
        return null;
      }
      try {
        vector = JSON.parse(trimmed);
      } catch (_error) {
        return null;
      }
    }
    if (!Array.isArray(vector)) {
      return null;
    }
    if (vector.length !== this.numDimensions) {
      return null;
    }
    const normalized = vector.map((value) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : 0;
    });
    return normalized;
  }

  async addBatchToIndex(batch) {
    if (!this.index || !Array.isArray(batch) || !batch.length) {
      return 0;
    }
    const addedIds = [];
    const ensureCapacity = () => {
      const required = this.index.getCurrentCount() + batch.length + 1;
      const maxElements = this.index.getMaxElements();
      if (required > maxElements) {
        const nextSize = Math.max(required, Math.ceil(maxElements * 1.2));
        try {
          this.index.resizeIndex(nextSize);
        } catch (error) {
          this.logger.warn('[hnsw] Failed to resize index', error);
        }
      }
    };
    ensureCapacity();
    batch.forEach((record) => {
      const id = Number(record.id);
      if (!Number.isFinite(id)) {
        return;
      }
      const wasKnown = this.knownIds.has(id);
      const wasDeleted = this.deletedIds.has(id);
      try {
        this.tryAddPoint(record.embedding, id, wasKnown || wasDeleted);
        this.knownIds.add(id);
        this.deletedIds.delete(id);
        addedIds.push(id);
      } catch (error) {
        this.logger.warn('[hnsw] Failed to add point to index', {
          id,
          error: error?.message || error,
        });
      }
    });
    if (addedIds.length && typeof this.providers.markIndexed === 'function') {
      await Promise.resolve(this.providers.markIndexed(addedIds, true));
    }
    if (addedIds.length) {
      this.scheduleSave();
    }
    return addedIds.length;
  }

  tryAddPoint(embedding, id, replaceExisting = false) {
    try {
      this.index.addPoint(embedding, id, replaceExisting);
      return true;
    } catch (error) {
      if (!this.isDeletedReplacementError(error)) {
        throw error;
      }
      this.index.unmarkDelete(id);
      this.index.addPoint(embedding, id, true);
      return true;
    }
  }

  isDeletedReplacementError(error) {
    const message = error?.message;
    if (typeof message !== 'string') {
      return false;
    }
    return message.includes("Can't use addPoint to update deleted elements");
  }

  scheduleSave() {
    if (this.saveTimer) {
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveIndex().catch((error) => {
        this.logger.warn('[hnsw] Failed to save index', error);
      });
    }, SAVE_DEBOUNCE_MS);
  }

  async saveIndex() {
    if (!this.index) {
      return;
    }
    if (this.savePromise) {
      await this.savePromise;
      return;
    }
    this.savePromise = (async () => {
      try {
        await this.index.writeIndex(this.indexFilePath);
        await this.setMetadata('indexSavedAt', String(Date.now()));
      } catch (error) {
        this.logger.warn('[hnsw] Unable to persist index', error);
      } finally {
        this.savePromise = null;
      }
    })();
    await this.savePromise;
  }

  async syncPendingEmbeddings() {
    if (!this.initialized) {
      return 0;
    }
    if (this.syncPromise) {
      return this.syncPromise;
    }
    this.syncPromise = (async () => {
      let processed = 0;
      while (true) {
        const batch = await this.fetchEmbeddingBatch({ limit: this.batchSize, onlyPending: true });
        if (!batch.length) {
          break;
        }
        processed += await this.addBatchToIndex(batch);
        if (batch.length < this.batchSize) {
          break;
        }
      }
      return processed;
    })()
      .catch((error) => {
        this.logger.warn('[hnsw] Failed to sync pending embeddings', error);
        return 0;
      })
      .finally(() => {
        this.syncPromise = null;
      });
    return this.syncPromise;
  }

  requestSync() {
    if (!this.initialized) {
      return;
    }
    if (this.syncTimer) {
      return;
    }
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.syncPendingEmbeddings().catch((error) => {
        this.logger.warn('[hnsw] Incremental sync failed', error);
      });
    }, SYNC_DEBOUNCE_MS);
  }

  isReady() {
    return Boolean(this.index) && this.initialized;
  }

  isEnabledForSearch() {
    if (!this.enabled || !this.isReady()) {
      return false;
    }
    const count = this.index.getCurrentCount();
    return Number.isFinite(count) && count > 0;
  }

  setEnabled(flag) {
    this.enabled = Boolean(flag);
  }

  search(queryEmbedding, options = {}) {
    if (!this.isEnabledForSearch()) {
      return null;
    }
    const vector = this.normalizeEmbedding(queryEmbedding);
    if (!vector) {
      return null;
    }
    const currentCount = this.index.getCurrentCount();
    if (!currentCount) {
      return [];
    }
    const k = Math.max(1, Math.min(Number(options.k) || 100, currentCount));
    try {
      if (this.index.getEf && this.index.getEf() !== this.efSearch) {
        this.index.setEf(this.efSearch);
      }
    } catch (_error) {
      // Ignore if getEf not supported
    }
    try {
      const result = this.index.searchKnn(vector, k);
      if (!result || !Array.isArray(result.neighbors)) {
        return [];
      }
      return result.neighbors.map((neighborId, index) => {
        const distance = Array.isArray(result.distances) ? Number(result.distances[index]) : null;
        const similarity = distance == null ? null : 1 - distance;
        return {
          id: Number(neighborId),
          distance,
          score: similarity,
        };
      });
    } catch (error) {
      this.logger.warn('[hnsw] search failed', error);
      return null;
    }
  }

  handlePhotosRemoved(photoIds = []) {
    if (!this.index || !Array.isArray(photoIds) || !photoIds.length) {
      return;
    }
    let removed = 0;
    photoIds.forEach((id) => {
      const numericId = Number(id);
      if (!Number.isFinite(numericId) || !this.knownIds.has(numericId)) {
        return;
      }
      try {
        this.index.markDelete(numericId);
        this.knownIds.delete(numericId);
        this.deletedIds.add(numericId);
        removed += 1;
      } catch (_error) {
        // Ignore deletion failures for entries that may not exist
      }
    });
    if (removed) {
      this.scheduleSave();
    }
  }

  async handleDatabaseCleared() {
    this.knownIds.clear();
    this.deletedIds.clear();
    this.index = null;
    if (fs.existsSync(this.indexFilePath)) {
      try {
        fs.unlinkSync(this.indexFilePath);
      } catch (error) {
        this.logger.warn('[hnsw] Failed to clear index file', error);
      }
    }
    await this.setMetadata('indexVersion', null);
    this.initialized = false;
    await this.loadOrRebuild();
    this.initialized = true;
  }

  async shutdown() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.syncPromise) {
      try {
        await this.syncPromise;
      } catch (_error) {
        // Ignore errors during shutdown
      }
    }
    await this.saveIndex();
  }

  async getMetadata(key) {
    if (typeof this.providers.getMetadata === 'function') {
      return Promise.resolve(this.providers.getMetadata(key));
    }
    return null;
  }

  async setMetadata(key, value) {
    if (typeof this.providers.setMetadata === 'function') {
      return Promise.resolve(this.providers.setMetadata(key, value));
    }
    return null;
  }
}

async function initializeHnswIndexManager(options = {}) {
  if (!getHierarchicalNSW(options.logger || console)) {
    activeManager = null;
    return null;
  }
  const manager = new HnswIndexManager(options);
  await manager.initialize();
  activeManager = manager;
  return manager;
}

function getHnswIndexManager() {
  return activeManager;
}

async function shutdownHnswIndex() {
  if (activeManager) {
    await activeManager.shutdown();
  }
}

module.exports = {
  initializeHnswIndexManager,
  getHnswIndexManager,
  shutdownHnswIndex,
};
