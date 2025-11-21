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
 * @typedef {import('./types').VolumeInfo} VolumeInfo
 * @typedef {import('./types').ScanProgress} ScanProgress
 * @typedef {import('./types').PhotoDTO} PhotoDTO
 * @typedef {import('./types').PhotoQuery} PhotoQuery
 * @typedef {import('./types').PhotoFilter} PhotoFilter
 * @typedef {import('./types').PhotoResults} PhotoResults
 * @typedef {import('./types').StatsPayload} StatsPayload
 * @typedef {import('./types').AiCollection} AiCollection
 * @typedef {import('./types').CityCollection} CityCollection
 * @typedef {import('./types').VolumeChangeEvent} VolumeChangeEvent
 */

/**
 * @typedef {Object} PhotoAlbumApi
 * @property {() => Promise<VolumeInfo[]>} listVolumes
 * @property {() => Promise<VolumeInfo|null>} pickFolderVolume
 * @property {(volumeId: string) => Promise<{deletedCount: number}>} deleteVolumeData
 * @property {(volumeId: string) => Promise<void>} startScan
 * @property {(callback: (progress: ScanProgress) => void) => () => void} onScanProgress
 * @property {(filter?: PhotoFilter) => Promise<PhotoResults>} fetchPhotos
 * @property {(filter: PhotoFilter) => Promise<StatsPayload>} fetchStats
 * @property {(options?: { minCount?: number }) => Promise<AiCollection[]>} fetchAiCollections
 * @property {(options?: { minCount?: number }) => Promise<CityCollection[]>} fetchCityCollections
  * @property {(callback: (change: VolumeChangeEvent) => void) => () => void} onVolumesChanged
 * @property {() => Promise<void>} clearDatabase
 * @property {(photoId: string|number, patch: { description?: string|null, tags?: string[], rating?: number|null }) => Promise<void>} updatePhotoDetails
 * @property {(photoIds: Array<string|number>) => Promise<{deletedCount: number}>} deletePhotos
 * @property {(filePath: string) => Promise<boolean>} copyImageToClipboard
 */

module.exports = {
  IPC_CHANNELS,
};
