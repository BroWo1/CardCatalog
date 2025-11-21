const { contextBridge, ipcRenderer } = require('electron');

// IPC channel constants (inlined for sandbox compatibility)
const IPC_CHANNELS = {
  LIST_VOLUMES: 'volume:list',
  PICK_FOLDER_VOLUME: 'volume:pick-folder',
  DELETE_VOLUME_DATA: 'volume:delete-data',
  START_SCAN: 'scan:start',
  STOP_SCAN: 'scan:stop',
  SCAN_PROGRESS: 'scan:progress',
  VOLUME_CHANGED: 'volume:changed',
  FETCH_PHOTOS: 'photos:fetch',
  FETCH_STATS: 'stats:fetch',
  FETCH_AI_COLLECTIONS: 'ai:collections',
  FETCH_CITY_COLLECTIONS: 'city:collections',
  UPDATE_PHOTO: 'photo:update',
  DELETE_PHOTOS: 'photo:delete',
  COPY_IMAGE_TO_CLIPBOARD: 'photo:copy-image',
  REGENERATE_AI_LABELS: 'scan:regenerate-ai-labels',
};

/**
 * @type {import('../shared/ipc-api').PhotoAlbumApi}
 */
const photoAlbumApi = {
  async listVolumes() {
    return ipcRenderer.invoke(IPC_CHANNELS.LIST_VOLUMES);
  },
  async pickFolderVolume() {
    return ipcRenderer.invoke(IPC_CHANNELS.PICK_FOLDER_VOLUME);
  },
  async deleteVolumeData(volumeId) {
    if (!volumeId) {
      throw new Error('volumeId is required to delete volume data');
    }
    return ipcRenderer.invoke(IPC_CHANNELS.DELETE_VOLUME_DATA, volumeId);
  },
  async startScan(volumeId) {
    if (!volumeId) {
      throw new Error('volumeId is required to start a scan');
    }
    return ipcRenderer.invoke(IPC_CHANNELS.START_SCAN, { volumeId });
  },
  async stopScan() {
    return ipcRenderer.invoke(IPC_CHANNELS.STOP_SCAN);
  },
  onScanProgress(callback) {
    if (typeof callback !== 'function') {
      throw new Error('callback must be a function');
    }

    const listener = (_event, progress) => {
      try {
        callback(progress);
      } catch (err) {
        console.error('Error inside scan progress callback', err);
      }
    };

    ipcRenderer.on(IPC_CHANNELS.SCAN_PROGRESS, listener);

    return () => ipcRenderer.removeListener(IPC_CHANNELS.SCAN_PROGRESS, listener);
  },
  async fetchPhotos(filter = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.FETCH_PHOTOS, filter || {});
  },
  async fetchStats(filter = {}) {
    const safeFilter = filter || {};
    // Allow volumeId to be null for "All Volumes" mode
    // if (!safeFilter.volumeId) {
    //   throw new Error('volumeId is required to fetch stats');
    // }
    return ipcRenderer.invoke(IPC_CHANNELS.FETCH_STATS, safeFilter);
  },
  async fetchAiCollections(options = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.FETCH_AI_COLLECTIONS, options || {});
  },
  async fetchCityCollections(options = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.FETCH_CITY_COLLECTIONS, options || {});
  },
  onVolumesChanged(callback) {
    if (typeof callback !== 'function') {
      throw new Error('callback must be a function');
    }
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.VOLUME_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.VOLUME_CHANGED, listener);
  },
  async updatePhotoDetails(photoId, patch = {}) {
    if (!photoId) {
      throw new Error('photoId is required to update photo details');
    }
    const safePatch = patch && typeof patch === 'object' ? patch : {};
    return ipcRenderer.invoke(IPC_CHANNELS.UPDATE_PHOTO, {
      photoId,
      patch: safePatch,
    });
  },
  async clearDatabase() {
    return ipcRenderer.invoke('debug:clear-db');
  },
  async copyImageToClipboard(filePath) {
    if (!filePath) {
      throw new Error('filePath is required to copy an image');
    }
    return ipcRenderer.invoke(IPC_CHANNELS.COPY_IMAGE_TO_CLIPBOARD, { filePath });
  },
  async regenerateAiLabels(volumeId) {
    if (!volumeId) {
      throw new Error('volumeId is required to regenerate AI labels');
    }
    return ipcRenderer.invoke(IPC_CHANNELS.REGENERATE_AI_LABELS, { volumeId });
  },
  async deletePhotos(photoIds) {
    if (!Array.isArray(photoIds) || !photoIds.length) {
      return { deletedCount: 0 };
    }
    return ipcRenderer.invoke(IPC_CHANNELS.DELETE_PHOTOS, photoIds);
  },
};

ipcRenderer.on('clip:log', (_event, entry = {}) => {
  const level = typeof entry.level === 'string' ? entry.level.toLowerCase() : 'info';
  const method = console[level] ? console[level].bind(console) : console.info.bind(console);
  const prefix = '[CLIP]';
  if (entry.context) {
    method(prefix, entry.message ?? '', entry.context);
  } else {
    method(prefix, entry.message ?? '');
  }
});

contextBridge.exposeInMainWorld('photoAlbum', photoAlbumApi);
