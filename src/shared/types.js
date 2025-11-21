/**
 * @typedef {Object} VolumeInfo
 * @property {string} id
 * @property {string} path
 * @property {string} [label]
 * @property {string} [displayLabel]
 * @property {boolean} isRemovable
 * @property {boolean} [isSystem]
 * @property {number} [sizeBytes]
 * @property {number} [freeBytes]
 * @property {boolean} [isLikelySdCard]
 * @property {string} [raw]
 * @property {boolean} [isManual]
 */

/**
 * @typedef {Object} FileInfo
 * @property {string} path
 * @property {number} size
 * @property {number} mtimeMs
 * @property {string} volumeId
 */

/** 
 * @typedef {'idle' | 'scanning' | 'completed' | 'error'} ScanStatus
 */

/**
 * @typedef {Object} ScanProgress
 * @property {string} volumeId
 * @property {number} totalFiles
 * @property {number} processedFiles
 * @property {ScanStatus} status
 * @property {string} [errorMessage]
 */

/**
 * @typedef {Object} PhotoDTO
 * @property {string|number} id
 * @property {string} filePath
 * @property {string} fileName
 * @property {string} volumeId
 * @property {string} [rawFilePath]
 * @property {string} [thumbnailPath]
 * @property {string} [shootDateTime]
 * @property {string} [cameraModel]
 * @property {string} [cameraMake]
 * @property {string} [lensModel]
 * @property {number} [fileSizeBytes]
 * @property {number} [iso]
 * @property {number} [aperture]
 * @property {number} [focalLengthMm]
 * @property {number} [shutterSpeedSeconds]
 * @property {string} [format]
 * @property {number} [gpsLat]
 * @property {number} [gpsLng]
 * @property {string|null} [description]
 * @property {string[]} [tags]
 * @property {AiLabel[]} [aiLabels]
 * @property {string|null} [locationLabel]
 * @property {boolean} [isRaw]
 * @property {number|null} [rating]
*/

/**
 * @typedef {Object} AiLabel
 * @property {string} label
 * @property {number} score
 */

/**
 * @typedef {Object} AiCollection
 * @property {string} label
 * @property {number} count
 * @property {{ id: number, thumbnailPath?: string|null, filePath?: string|null }|null} [latestPhoto]
 */

/**
 * @typedef {Object} CityCollection
 * @property {string} label
 * @property {string} city
 * @property {string} [country]
 * @property {number} count
 * @property {{ id: number, thumbnailPath?: string|null, filePath?: string|null }|null} [latestPhoto]
 * @property {string[]} [locationLabels]
 */

/**
 * @typedef {Object} StatsBuckets
 * @property {Record<string, number>} [byCameraModel]
 * @property {Record<string, number>} [byIsoBucket]
 * @property {Record<string, number>} [byYear]
 */

/**
 * @typedef {Object} StatsPayload
 * @property {string} volumeId
 * @property {number} totalPhotos
 * @property {StatsBuckets} [buckets]
 */

/**
 * @typedef {Object} PhotoFilter
 * @property {string} [volumeId]
 * @property {string[]} [cameraModels]
 * @property {string[]} [lensModels]
 * @property {number} [dateFrom]
 * @property {number} [dateTo]
 * @property {number} [isoMin]
 * @property {number} [isoMax]
 * @property {number} [apertureMin]
 * @property {number} [apertureMax]
 * @property {number} [focalMin]
 * @property {number} [focalMax]
 * @property {string} [text]
 * @property {string} [searchText]
 * @property {boolean} [semanticSearch]
 * @property {string} [aiLabel]
 * @property {string[]} [tags]
 * @property {string[]} [locationIds]
 * @property {string} [sortBy]
 * @property {number} [limit]
 * @property {number} [offset]
 * @property {string} [cursor]
 */

/**
 * @typedef {PhotoFilter} PhotoQuery
 */

/**
 * @typedef {Object} PhotoResults
 * @property {PhotoDTO[]} items
 * @property {number} total
 * @property {PhotoDTO[]} [photos]
 * @property {number} [totalCount]
 * @property {string|null} [nextCursor]
 * @property {number|null} [nextOffset]
 */

/**
 * @typedef {Object} VolumeChangeEvent
 * @property {VolumeInfo[]} volumes
 * @property {VolumeInfo[]} added
 * @property {VolumeInfo[]} removed
 */

module.exports = {};
