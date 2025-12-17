const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { fileURLToPath } = require('node:url');
const exifr = require('exifr');
const { Jimp } = require('jimp');
const { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, shell } = require('electron');
const { IPC_CHANNELS } = require('../shared/ipc-api');
const sdDetector = require('./sd-detector');
const fileScanner = require('./file-scanner');
const db = require('./db');
const processingQueue = require('./processing-queue');
const statsAggregator = require('./stats-aggregator');
const { generateTextEmbedding } = require('./workers/clip-keywords');
const hnswIndex = require('./hnsw-index');

let mainWindow;
let volumeMonitoringStarted = false;
let activeScan = null;
let lastScanProgressEvent = 0;
let hasHandledInitialVolumeBroadcast = false;
const pendingAutoScanVolumeIds = [];
let autoScanQueueProcessing = false;
let hnswManager = null;

const SCAN_PROGRESS_EVENT_INTERVAL_MS = 400;
const isMac = process.platform === 'darwin';
const RENDERER_DEV_URL = process.env.RENDERER_URL || null;
const RENDERER_DIST_ENTRY = path.join(__dirname, '../renderer/.output/public/index.html');
const CLIP_MODEL_SUBDIR = path.join('models', 'clip');
const CLIP_MODEL_REQUIRED_FILE = path.join('Xenova', 'clip-vit-base-patch32', 'onnx', 'model_quantized.onnx');
const CLIP_LOG_CHANNEL = 'clip:log';
const CLIP_LOG_BUFFER_LIMIT = 200;

const clipLogBuffer = [];

function broadcastClipLog(entry) {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(CLIP_LOG_CHANNEL, entry);
    }
  });
}

function logClip(level, message, context = null) {
  const entry = {
    level: level || 'info',
    message,
    context: context ?? null,
    timestamp: Date.now(),
  };
  const method = entry.level === 'error'
    ? console.error
    : entry.level === 'warn'
      ? console.warn
      : entry.level === 'debug'
        ? console.debug
        : console.info;
  method(`[clip-model] ${message}`, context ?? '');
  clipLogBuffer.push(entry);
  if (clipLogBuffer.length > CLIP_LOG_BUFFER_LIMIT) {
    clipLogBuffer.shift();
  }
  broadcastClipLog(entry);
}

function replayClipLogsToWindow(window) {
  if (!window || window.isDestroyed()) {
    return;
  }
  clipLogBuffer.forEach((entry) => {
    window.webContents.send(CLIP_LOG_CHANNEL, entry);
  });
}

const demoVolumes = [
  {
    id: 'vol-alpha',
    path: path.join(os.homedir(), 'Pictures', 'AlphaCard'),
    label: 'Alpha SD',
    isRemovable: true,
    totalSizeBytes: 64 * 1024 * 1024 * 1024,
    freeBytes: 42 * 1024 * 1024 * 1024,
  },
  {
    id: 'vol-beta',
    path: path.join(os.homedir(), 'Pictures', 'BetaCard'),
    label: 'Home Pictures',
    isRemovable: false,
    totalSizeBytes: 512 * 1024 * 1024 * 1024,
    freeBytes: 120 * 1024 * 1024 * 1024,
  },
];

const demoPhotos = Array.from({ length: 8 }).map((_, index) => {
  const volume = index % 2 === 0 ? demoVolumes[0] : demoVolumes[1];
  const shotDate = new Date(2024, index % 12, (index + 1) * 2);
  const id = index + 1;
  return {
    id,
    filePath: path.join(volume.path, `IMG_${String(id).padStart(4, '0')}.JPG`),
    fileName: `IMG_${String(id).padStart(4, '0')}.JPG`,
    volumeId: volume.id,
    thumbnailPath: path.join(os.tmpdir(), `thumb_${id}.jpg`),
    shootDateTime: shotDate.toISOString(),
    cameraModel: index % 2 === 0 ? 'Fujifilm X100V' : 'Canon EOS R5',
  };
});

function clipModelDirHasAssets(dirPath) {
  if (!dirPath) {
    return false;
  }
  const hasFile = fs.existsSync(path.join(dirPath, CLIP_MODEL_REQUIRED_FILE));
  if (!hasFile) {
    logClip('debug', 'Missing required CLIP model file', { dirPath });
  }
  return hasFile;
}

function findBundledClipModelDir() {
  const candidates = [
    path.join(process.resourcesPath, CLIP_MODEL_SUBDIR),
    path.join(process.resourcesPath, 'app.asar.unpacked', CLIP_MODEL_SUBDIR),
    path.join(__dirname, '..', '..', CLIP_MODEL_SUBDIR),
  ];
  const found = candidates.find((candidate) => clipModelDirHasAssets(candidate)) || null;
  logClip('info', 'Evaluated CLIP model search candidates', { candidates, found });
  return found;
}

async function initializeHnswIndex() {
  try {
    const userDataPath = app.getPath('userData');
    const indexPath = path.join(userDataPath, 'hnsw-index.bin');
    const storedPreference = db.getHnswMetadata('useHnsw');
    const photoCount = db.countPhotos();
    let enableHnsw = storedPreference == null ? photoCount > 1000 : storedPreference === '1';
    if (storedPreference == null) {
      db.setHnswMetadata('useHnsw', enableHnsw ? '1' : '0');
    }
    hnswManager = await hnswIndex.initializeHnswIndexManager({
      indexFilePath: indexPath,
      space: 'cosine',
      numDimensions: 512,
      maxElements: 100000,
      m: 16,
      efConstruction: 200,
      efSearch: 50,
      providers: {
        fetchEmbeddingsBatch: (options) => db.getPhotoEmbeddingsBatch(options),
        fetchPendingEmbeddings: (options = {}) =>
          db.getPhotoEmbeddingsBatch({ ...options, onlyPending: true }),
        markIndexed: (ids) => db.markPhotosHnswIndexed(ids, true),
        resetIndexFlags: () => db.resetHnswIndexFlags(),
        getMetadata: (key) => db.getHnswMetadata(key),
        setMetadata: (key, value) => db.setHnswMetadata(key, value),
      },
    });
    if (hnswManager && typeof hnswManager.setEnabled === 'function') {
      hnswManager.setEnabled(enableHnsw);
    }
    console.info('[HNSW] Index initialized', {
      enabled: enableHnsw,
      photoCount,
    });
  } catch (error) {
    console.warn('[HNSW] Failed to initialize vector index', error);
  }
}

async function ensureClipModelResourcesRoot(appInstance) {
  if (!appInstance.isPackaged) {
    logClip('info', 'Development build detected, using project CLIP directory.');
    return null;
  }
  logClip('info', 'Ensuring packaged CLIP assets exist.');
  const targetRoot = appInstance.getPath('userData');
  const targetClipDir = path.join(targetRoot, CLIP_MODEL_SUBDIR);
  if (clipModelDirHasAssets(targetClipDir)) {
    logClip('info', 'Existing CLIP assets found in userData', { targetClipDir });
    return targetRoot;
  }

  const sourceDir = findBundledClipModelDir();
  if (!sourceDir) {
    logClip('warn', 'Unable to locate bundled CLIP model directory.');
    return null;
  }

  try {
    logClip('info', 'Copying CLIP assets', { sourceDir, targetClipDir });
    await fsp.rm(targetClipDir, { recursive: true, force: true });
    await fsp.mkdir(targetClipDir, { recursive: true });
    await fsp.cp(sourceDir, targetClipDir, { recursive: true });
    logClip('info', 'CLIP assets copied successfully', { targetClipDir });
    return targetRoot;
  } catch (error) {
    logClip('error', 'Failed to copy CLIP assets', { error: error?.message || error });
    throw error;
  }
}

function createFileSignature(fileInfo = {}) {
  const size = Number.isFinite(fileInfo.size) ? fileInfo.size : 0;
  const mtime = Number.isFinite(fileInfo.mtimeMs) ? Math.round(fileInfo.mtimeMs) : 0;
  return `${size}:${mtime}`;
}

function createWindow() {
  const windowOptions = {
    width: 1100,
    height: 720,
    minWidth: 1024,
    minHeight: 720,
    title: 'CardCatalog',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    // Enable transparency for frosted glass effect
    transparent: true,
    // Fully transparent background color
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/preload.js'),
    },
  };

  if (isMac) {
    windowOptions.trafficLightPosition = { x: 16, y: 20 };
    windowOptions.fullscreenWindowTitleVisibility = 'hidden';
    // macOS vibrancy for frosted glass effect
    windowOptions.vibrancy = 'under-window';
  }

  mainWindow = new BrowserWindow(windowOptions);
  replayClipLogsToWindow(mainWindow);

  if (RENDERER_DEV_URL) {
    mainWindow.loadURL(RENDERER_DEV_URL);
    openDevTools(mainWindow);
  } else {
    loadRendererFromDisk(mainWindow);
  }
}

function openDevTools(window) {
  try {
    window.webContents.openDevTools({ mode: 'detach' });
  } catch (error) {
    console.warn('Unable to open DevTools automatically', error);
  }
}

function loadRendererFromDisk(window) {
  if (!fs.existsSync(RENDERER_DIST_ENTRY)) {
    console.warn('Renderer build not found. Run `npm run build:renderer` before starting Electron.');
  }
  window.loadFile(RENDERER_DIST_ENTRY, { hash: '/' });
}

function withErrorLogging(channel, handler) {
  return async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (error) {
      console.error(`IPC handler error [${channel}]`, error);
      throw error;
    }
  };
}

function normalizeDeleteRequest(payload) {
  if (Array.isArray(payload)) {
    const photoIds = payload.filter((value) => typeof value === 'number' || typeof value === 'string');
    return { photoIds, deleteFiles: false };
  }
  if (payload && typeof payload === 'object') {
    const photoIds = Array.isArray(payload.photoIds)
      ? payload.photoIds.filter((value) => typeof value === 'number' || typeof value === 'string')
      : [];
    const deleteFiles = Boolean(payload.deleteFiles);
    return { photoIds, deleteFiles };
  }
  return { photoIds: [], deleteFiles: false };
}

async function deleteFilesForRecords(records = []) {
  const removed = [];
  const failed = [];
  const seen = new Set();

  for (const record of records) {
    const candidates = [
      record?.filePath,
      record?.rawFilePath,
      record?.thumbnailPath,
    ];

    for (const candidate of candidates) {
      const filePath = typeof candidate === 'string' ? candidate : '';
      if (!filePath || seen.has(filePath)) {
        continue;
      }
      seen.add(filePath);
      try {
        await fsp.rm(filePath, { force: true });
        removed.push(filePath);
      } catch (error) {
        console.warn('[DeletePhotos] Failed to remove file', filePath, error);
        failed.push({ path: filePath, error: error?.message || String(error) });
      }
    }
  }

  return { removed, failed };
}

async function getExifRotation(filePath) {
  try {
    const rotation = await exifr.rotation(filePath);
    const deg = Number(rotation?.deg ?? 0);
    const scaleX = Number(rotation?.scaleX ?? 1);
    const scaleY = Number(rotation?.scaleY ?? 1);
    const dimensionSwapped = Boolean(rotation?.dimensionSwapped);

    if (!Number.isFinite(deg) || !Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
      return null;
    }

    return {
      deg,
      scaleX,
      scaleY,
      dimensionSwapped,
    };
  } catch (error) {
    console.warn('[Clipboard] Failed to read EXIF rotation', error);
    return null;
  }
}

function applyExifRotationToJimp(image, rotation) {
  if (!rotation) {
    return;
  }

  if (rotation.deg) {
    // Jimp rotates counter-clockwise; EXIF rotation instructions are expressed as clockwise degrees.
    image.rotate(-rotation.deg);
  }
  if (rotation.scaleX === -1) {
    image.flip(true, false);
  }
  if (rotation.scaleY === -1) {
    image.flip(false, true);
  }
}

async function createNativeImageWithOrientation(filePath) {
  try {
    // Jimp auto-applies EXIF orientation on decode (attemptExifRotate), so do not rotate again here.
    const jimpImage = await Jimp.read(filePath);
    const buffer = await jimpImage.getBuffer('image/png');
    return nativeImage.createFromBuffer(buffer);
  } catch (error) {
    const rotation = await getExifRotation(filePath);
    if (!rotation || (rotation.deg === 0 && rotation.scaleX === 1 && rotation.scaleY === 1)) {
      return nativeImage.createFromPath(filePath);
    }

    try {
      const original = nativeImage.createFromPath(filePath);
      if (original && !original.isEmpty()) {
        const decodedPng = original.toPNG();
        const decodedJimp = await Jimp.read(decodedPng);
        const shouldApplyRotation = rotation.dimensionSwapped
          ? decodedJimp.bitmap.width >= decodedJimp.bitmap.height
          : true;
        if (shouldApplyRotation) {
          applyExifRotationToJimp(decodedJimp, rotation);
        }
        const buffer = await decodedJimp.getBuffer('image/png');
        return nativeImage.createFromBuffer(buffer);
      }
    } catch (fallbackError) {
      console.warn('[Clipboard] Unable to apply EXIF rotation via fallback decode, using original', fallbackError);
    }
    console.warn('[Clipboard] Unable to apply EXIF rotation, using original', error);
    return nativeImage.createFromPath(filePath);
  }
}

function registerIpcHandlers() {
  ipcMain.handle(
    IPC_CHANNELS.LIST_VOLUMES,
    withErrorLogging(IPC_CHANNELS.LIST_VOLUMES, async () => {
      const volumes = await sdDetector.listVolumes();
      if (!volumes.length) {
        console.warn('No removable volumes detected yet.');
      }
      return volumes;
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PICK_FOLDER_VOLUME,
    withErrorLogging(IPC_CHANNELS.PICK_FOLDER_VOLUME, async () => {
      const dialogOptions = {
        properties: ['openDirectory'],
      };
      const result = await dialog.showOpenDialog(dialogOptions);
      if (result.canceled || !result.filePaths || !result.filePaths.length) {
        return null;
      }
      const folderPath = result.filePaths[0];
      const manualVolume = await sdDetector.addManualVolume(folderPath);
      const change = await sdDetector.refreshVolumes();
      broadcastVolumeChanges(change);
      const enriched = change.volumes.find((vol) => vol.id === manualVolume.id) || manualVolume;
      return enriched;
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.DELETE_VOLUME_DATA,
    withErrorLogging(IPC_CHANNELS.DELETE_VOLUME_DATA, async (_event, volumeId) => {
      if (!volumeId) {
        throw new Error('volumeId is required');
      }
      const deletedCount = db.deletePhotosForVolume(volumeId);
      return { deletedCount };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.START_SCAN,
    withErrorLogging(IPC_CHANNELS.START_SCAN, async (event, { volumeId }) => {
      if (!volumeId) {
        throw new Error('volumeId is required');
      }
      if (activeScan && activeScan.status === 'scanning') {
        throw new Error('Another scan is already running. Please wait for it to finish.');
      }
      const volume = await sdDetector.findVolume(volumeId);
      if (!volume) {
        throw new Error(`Unknown volumeId: ${volumeId}`);
      }
      if (!volume.isRemovable && !volume.isLikelySdCard && !volume.isManual) {
        throw new Error('Scanning is limited to removable media for now.');
      }
      startVolumeScan(volume);
      return undefined;
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.STOP_SCAN,
    withErrorLogging(IPC_CHANNELS.STOP_SCAN, async () => {
      if (!activeScan || !activeScan.volumeId) {
        return { stopped: false };
      }
      const volumeId = activeScan.volumeId;
      const scanPhaseActive = !activeScan.scanPhaseCompleted;
      const canAbortScanPhase = Boolean(
        activeScan.status === 'scanning' &&
          scanPhaseActive &&
          activeScan.abortController &&
          !activeScan.abortController.signal.aborted,
      );
      const cancellationSummary = processingQueue.cancelJobsForVolume(volumeId);

      const cancelledCount = Number(cancellationSummary.cancelledQueued || 0) +
        Number(cancellationSummary.cancelledActive || 0);
      if (Number.isFinite(activeScan.totalFiles)) {
        const adjustedTotal = Math.max(
          activeScan.processedFiles,
          activeScan.totalFiles - cancelledCount,
        );
        activeScan.totalFiles = adjustedTotal;
      }

      activeScan.scanPhaseCompleted = false;
      activeScan.errorMessage = null;

      if (canAbortScanPhase) {
        activeScan.abortController.abort();
        activeScan.status = 'stopping';
        emitScanProgress(true);
      } else {
        markActiveScanStopped();
      }

      return {
        stopped: true,
        cancelled: cancellationSummary,
      };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.FETCH_PHOTOS,
    withErrorLogging(IPC_CHANNELS.FETCH_PHOTOS, async (_event, filter = {}) => {
      const safeFilter = filter && typeof filter === 'object' ? filter : {};
      
      // If search text is present and semantic mode is enabled, try to generate embedding
      const wantsSemanticSearch = Boolean(safeFilter.semanticSearch);
      if (
        wantsSemanticSearch &&
        safeFilter.searchText &&
        typeof safeFilter.searchText === 'string' &&
        safeFilter.searchText.trim().length > 0
      ) {
        try {
          // Only attempt semantic search if we have a valid query
          const embedding = await generateTextEmbedding(safeFilter.searchText);
          if (embedding) {
            safeFilter.embedding = embedding;
          }
        } catch (error) {
          console.warn('Failed to generate text embedding for search', error);
        }
      }

      return db.getPhotos(safeFilter);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.FETCH_PHOTO_LOCATIONS,
    withErrorLogging(IPC_CHANNELS.FETCH_PHOTO_LOCATIONS, async (_event, filter = {}) => {
      const safeFilter = filter && typeof filter === 'object' ? filter : {};
      return db.getPhotoLocations(safeFilter);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.FETCH_STATS,
    withErrorLogging(IPC_CHANNELS.FETCH_STATS, async (_event, filter = {}) => {
      const safeFilter = filter && typeof filter === 'object' ? filter : {};
      // Allow volumeId to be null for "All Volumes" mode
      // if (!safeFilter.volumeId) {
      //   throw new Error('volumeId is required for stats:fetch');
      // }
      return statsAggregator.computeStats(safeFilter);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.FETCH_AI_COLLECTIONS,
    withErrorLogging(IPC_CHANNELS.FETCH_AI_COLLECTIONS, async (_event, options = {}) => {
      const minCount = Number(options?.minCount);
      return db.getAiKeywordCollections(minCount);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.FETCH_CITY_COLLECTIONS,
    withErrorLogging(IPC_CHANNELS.FETCH_CITY_COLLECTIONS, async (_event, options = {}) => {
      const minCount = Number(options?.minCount);
      return db.getCityCollections(minCount);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.UPDATE_PHOTO,
    withErrorLogging(IPC_CHANNELS.UPDATE_PHOTO, async (_event, payload = {}) => {
      const photoId = payload?.photoId;
      const patch = payload?.patch || {};
      if (!photoId) {
        throw new Error('photoId is required to update metadata');
      }
      db.updatePhotoDetails(photoId, patch);
      return { success: true };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.COPY_IMAGE_TO_CLIPBOARD,
    withErrorLogging(IPC_CHANNELS.COPY_IMAGE_TO_CLIPBOARD, async (_event, payload = {}) => {
      const filePath = payload?.filePath;
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('filePath is required');
      }
      let resolvedPath = filePath;
      if (filePath.startsWith('file://')) {
        try {
          resolvedPath = fileURLToPath(filePath);
        } catch (error) {
          console.warn('Unable to convert file URL for clipboard copy', error);
        }
      }
      if (!fs.existsSync(resolvedPath)) {
        throw new Error('Image file not found.');
      }
      const image = await createNativeImageWithOrientation(resolvedPath);
      if (!image || image.isEmpty()) {
        throw new Error('Unable to read image data.');
      }
      clipboard.writeImage(image);
      return true;
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REGENERATE_AI_LABELS,
    withErrorLogging(IPC_CHANNELS.REGENERATE_AI_LABELS, async (_event, { volumeId }) => {
      if (!volumeId) {
        throw new Error('volumeId is required');
      }

      const volume = await sdDetector.findVolume(volumeId);
      if (!volume) {
        throw new Error(`Unknown volumeId: ${volumeId}`);
      }

      // Queue photos without AI labels
      queuePhotosWithoutAiLabels(volumeId);

      return { success: true };
    }),
  );

  ipcMain.handle(
    'debug:clear-db',
    withErrorLogging('debug:clear-db', async () => {
      db.clearDatabase();
      return true;
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.DELETE_PHOTOS,
    withErrorLogging(IPC_CHANNELS.DELETE_PHOTOS, async (_event, payload) => {
      const { photoIds, deleteFiles } = normalizeDeleteRequest(payload);
      if (!photoIds.length) {
        return { deletedCount: 0, removedFiles: 0, failedFiles: [] };
      }

      let removedFiles = [];
      let failedFiles = [];

      if (deleteFiles) {
        const fileRecords = db.getPhotoFilePaths(photoIds);
        const results = await deleteFilesForRecords(fileRecords);
        removedFiles = results.removed;
        failedFiles = results.failed;
      }

      const deletedCount = db.deletePhotos(photoIds);
      return {
        deletedCount,
        removedFiles: removedFiles.length,
        failedFiles,
      };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.OPEN_EXTERNAL,
    withErrorLogging(IPC_CHANNELS.OPEN_EXTERNAL, async (_event, url) => {
      if (!url || typeof url !== 'string') {
        throw new Error('URL is required');
      }
      await shell.openExternal(url);
      return true;
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.EXPORT_PHOTOS,
    withErrorLogging(IPC_CHANNELS.EXPORT_PHOTOS, async (_event, { photoIds }) => {
      if (!Array.isArray(photoIds) || !photoIds.length) {
        return { exported: 0, failed: 0, cancelled: true };
      }

      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Export Destination',
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Export Here',
      });

      if (result.canceled || !result.filePaths.length) {
        return { exported: 0, failed: 0, cancelled: true };
      }

      const destDir = result.filePaths[0];
      const photos = db.getPhotoFilePaths(photoIds);

      let exported = 0;
      let failed = 0;

      for (const photo of photos) {
        const filesToCopy = [photo.filePath];
        if (photo.rawFilePath) {
          filesToCopy.push(photo.rawFilePath);
        }

        for (const srcPath of filesToCopy) {
          try {
            const fileName = path.basename(srcPath);
            const destPath = path.join(destDir, fileName);
            await fsp.copyFile(srcPath, destPath);
            exported++;
          } catch (err) {
            console.error(`Failed to export ${srcPath}:`, err.message);
            failed++;
          }
        }
      }

      return { exported, failed, cancelled: false };
    }),
  );
}

function startVolumeScan(volume) {
  runVolumeScan(volume).catch((error) => {
    console.error(`Scan failed for volume ${volume.id}`, error);
  });
}

async function runVolumeScan(volume) {
  const abortController = new AbortController();
  activeScan = {
    volumeId: volume.id,
    status: 'scanning',
    totalFiles: 0,
    processedFiles: 0,
    startedAt: Date.now(),
    finishedAt: null,
    errorMessage: null,
    scanPhaseCompleted: false,
    abortController,
  };
  lastScanProgressEvent = 0;
  emitScanProgress(true);

  try {
    const scanResult = await fileScanner.scanVolume(
      volume.path,
      volume.id,
      (update) => {
        handleScanUpdate(volume.id, update);
      },
      {
        shouldAbort: () => abortController.signal.aborted,
      },
    );

    const scannedPaths = Array.isArray(scanResult?.files)
      ? scanResult.files.map((file) => file.path)
      : [];
    try {
      const removed = db.pruneMissingVolumePhotos(volume.id, scannedPaths);
      if (removed > 0) {
        console.info(`Pruned ${removed} stale photo(s) for volume ${volume.id}`);
      }
    } catch (reconcileError) {
      console.warn(`Failed to reconcile photo records for volume ${volume.id}`, reconcileError);
    }

    if (!activeScan || activeScan.volumeId !== volume.id) {
      return;
    }

    activeScan.scanPhaseCompleted = true;
    finalizeScanIfComplete();
    emitScanProgress(true);
  } catch (error) {
    const aborted = error?.message === 'Scan aborted';
    if (activeScan && activeScan.volumeId === volume.id) {
      if (aborted) {
        markActiveScanStopped('Scan stopped by user');
      } else {
        activeScan.status = 'error';
        activeScan.errorMessage = error.message;
        activeScan.finishedAt = Date.now();
        emitScanProgress(true);
      }
    }
    triggerAutoScanQueueProcessing();
    if (!aborted) {
      throw error;
    }
  }
}

function handleScanUpdate(volumeId, update) {
  if (!activeScan || activeScan.volumeId !== volumeId || !update) {
    return;
  }

  if (update.type === 'fileFound' && update.data?.file) {
    const file = update.data.file;
    const fileSignature = createFileSignature(file);
    try {
      db.upsertPhotoBasic({
        ...file,
        volumeId,
      });
    } catch (error) {
      console.error('Failed to persist photo info', error);
    }

    let needsProcessing = true;
    try {
      needsProcessing = db.isMetadataOutdated(volumeId, file.path, fileSignature);
    } catch (error) {
      console.error('Failed to decide if metadata refresh is needed', error);
    }

    if (needsProcessing) {
      activeScan.totalFiles += 1;
      processingQueue.enqueueJob(volumeId, file.path, { metadataSignature: fileSignature });
      emitScanProgress();
    }
    return;
  }

  emitScanProgress();
}

function handleMetadataResult(result) {
  if (!result || result.type !== 'result') {
    return;
  }

  if (result.success && result.metadata) {
    try {
      const patch = { ...result.metadata };
      if (result.metadataSignature) {
        patch.metadata_signature = result.metadataSignature;
      }
      db.updatePhotoMetadataByPath(result.volumeId, result.filePath, patch);
      if (Array.isArray(result.metadata.embedding) && hnswManager && typeof hnswManager.requestSync === 'function') {
        hnswManager.requestSync();
      }
    } catch (error) {
      console.error('Failed to update photo metadata', error);
    }
  } else if (!result.success) {
    console.warn('EXIF extraction failed', result.filePath, result.error);
  }

  if (activeScan && activeScan.volumeId === result.volumeId) {
    activeScan.processedFiles = Math.min(
      activeScan.totalFiles,
      activeScan.processedFiles + 1,
    );
    finalizeScanIfComplete();
    emitScanProgress();
  }
}

function finalizeScanIfComplete() {
  if (!activeScan) {
    return;
  }
  if (activeScan.status !== 'scanning') {
    return;
  }
  if (activeScan.scanPhaseCompleted && activeScan.processedFiles >= activeScan.totalFiles) {
    activeScan.status = 'completed';
    activeScan.finishedAt = Date.now();

    // After scan completes, queue photos without AI labels for processing
    queuePhotosWithoutAiLabels(activeScan.volumeId);

    triggerAutoScanQueueProcessing();
  }
}

function queuePhotosWithoutAiLabels(volumeId) {
  if (!volumeId) {
    return;
  }

  try {
    // Get photos without AI labels (process in batches of 100)
    const photosToProcess = db.getPhotosWithoutAiLabels(volumeId, 100);

    if (photosToProcess.length === 0) {
      return;
    }

    console.info(
      `[AI Auto-Scan] Found ${photosToProcess.length} photos without AI labels for volume ${volumeId}`,
    );

    // Queue each photo for AI label generation
    photosToProcess.forEach((photo) => {
      const fileSignature = createFileSignature({
        size: photo.size,
        mtimeMs: photo.mtimeMs,
      });

      // Queue for metadata processing (which includes AI label generation)
      processingQueue.enqueueJob(volumeId, photo.path, {
        metadataSignature: fileSignature,
      });

      // Update scan totals to include these photos
      if (activeScan && activeScan.volumeId === volumeId) {
        activeScan.totalFiles += 1;
      }
    });

    console.info(`[AI Auto-Scan] Queued ${photosToProcess.length} photos for AI label generation`);
    emitScanProgress();
  } catch (error) {
    console.error('[AI Auto-Scan] Failed to queue photos without AI labels:', error);
  }
}

function emitScanProgress(force = false) {
  if (!activeScan) {
    return;
  }

  const now = Date.now();
  if (!force && now - lastScanProgressEvent < SCAN_PROGRESS_EVENT_INTERVAL_MS) {
    return;
  }
  lastScanProgressEvent = now;

  const payload = {
    volumeId: activeScan.volumeId,
    totalFiles: activeScan.totalFiles,
    processedFiles: activeScan.processedFiles,
    status: activeScan.status,
    errorMessage: activeScan.errorMessage,
  };

  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.SCAN_PROGRESS, payload);
    }
  });
}

function markActiveScanStopped(message = 'Scan stopped by user') {
  if (!activeScan) {
    return;
  }
  activeScan.status = 'stopped';
  activeScan.errorMessage = message;
  activeScan.finishedAt = Date.now();
  emitScanProgress(true);
}

function broadcastVolumeChanges(change) {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.VOLUME_CHANGED, change);
    }
  });
}

function ensureVolumeMonitoring() {
  if (volumeMonitoringStarted) {
    return;
  }
  volumeMonitoringStarted = true;
  sdDetector.startMonitoring((change) => {
    broadcastVolumeChanges(change);
    if (hasHandledInitialVolumeBroadcast) {
      handleAutoScanVolumeChange(change);
    }
    hasHandledInitialVolumeBroadcast = true;
  });
}

function handleAutoScanVolumeChange(change) {
  if (!change || !Array.isArray(change.added) || !change.added.length) {
    return;
  }
  change.added.forEach((volume) => {
    if (volume && volume.isLikelySdCard) {
      queueAutoScanVolume(volume.id);
    }
  });
}

function queueAutoScanVolume(volumeId) {
  if (!volumeId) {
    return;
  }
  const alreadyQueued = pendingAutoScanVolumeIds.includes(volumeId);
  const currentlyScanning = Boolean(
    activeScan && activeScan.status === 'scanning' && activeScan.volumeId === volumeId,
  );
  if (alreadyQueued || currentlyScanning) {
    return;
  }
  pendingAutoScanVolumeIds.push(volumeId);
  triggerAutoScanQueueProcessing();
}

function triggerAutoScanQueueProcessing() {
  processPendingAutoScanQueue().catch((error) => {
    console.error('Failed to process auto-scan queue', error);
  });
}

async function processPendingAutoScanQueue() {
  if (autoScanQueueProcessing) {
    return;
  }
  if (activeScan && activeScan.status === 'scanning') {
    return;
  }
  if (!pendingAutoScanVolumeIds.length) {
    return;
  }
  autoScanQueueProcessing = true;
  try {
    while (pendingAutoScanVolumeIds.length) {
      const volumeId = pendingAutoScanVolumeIds.shift();
      let volume = null;
      try {
        volume = await sdDetector.findVolume(volumeId);
      } catch (error) {
        console.warn(`Auto-scan unable to locate volume ${volumeId}`, error);
      }
      if (!volume) {
        continue;
      }
      console.info(`Auto-scan starting for volume ${volume.label || volume.id}`);
      startVolumeScan(volume);
      return;
    }
  } finally {
    autoScanQueueProcessing = false;
  }
}

app.whenReady().then(async () => {
  try {
    await db.initDb(app);
    await initializeHnswIndex();
  } catch (error) {
    console.error('Failed to initialize database', error);
    app.quit();
    return;
  }

  const thumbnailBaseDir = path.join(app.getPath('userData'), 'thumbnails');
  let resourcesPathOverride = null;
  try {
    resourcesPathOverride = await ensureClipModelResourcesRoot(app);
  } catch (error) {
    logClip('error', 'Failed to prepare CLIP model directory', { error: error?.message || error });
  }
  if (resourcesPathOverride) {
    logClip('info', 'Workers configured to load CLIP models from user data', { resourcesPathOverride });
  } else {
    logClip('info', 'Workers will fall back to default resourcesPath');
  }

  processingQueue.initProcessingQueue({
    thumbnailBaseDir,
    resourcesPathOverride: resourcesPathOverride || null,
  });
  processingQueue.onJobResult((result) => {
    handleMetadataResult(result);
  });
  processingQueue.onLog((entry) => {
    if (entry?.message) {
      logClip(entry.level || 'info', entry.message, entry.context || null);
    }
  });

  createWindow();
  registerIpcHandlers();
  ensureVolumeMonitoring();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on('browser-window-created', (_event, window) => {
    replayClipLogsToWindow(window);
  });
});

app.on('before-quit', () => {
  hnswIndex.shutdownHnswIndex().catch((error) => {
    console.warn('[HNSW] Failed to flush index before exit', error);
  });
  db.shutdown();
  processingQueue.shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    sdDetector.stopMonitoring();
    app.quit();
  }
});
