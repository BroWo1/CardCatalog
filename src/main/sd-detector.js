const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const fsSync = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const drivelist = require('drivelist');

const execAsync = promisify(exec);

const POLL_INTERVAL_MS = 5000;
const MIN_SD_CARD_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB
const MAX_SD_CARD_BYTES = 2 * 1024 * 1024 * 1024 * 1024; // 2 TB
const SD_KEYWORDS = ['sd', 'card', 'canon', 'nikon', 'fuji', 'fujifilm', 'sony', 'lumix', 'eos'];
const SD_CARD_PROTOCOLS = ['SD Card', 'Secure Digital', 'USB'];
const SD_CARD_TYPES = ['Generic SD', 'Mass Storage Device', 'SD/MMC'];
const DATA_DIR = path.join(os.homedir(), '.cardcatalog');
const MANUAL_VOLUMES_PATH = path.join(DATA_DIR, 'manual-volumes.json');

const state = {
  lastVolumes: [],
  monitorTimer: null,
  hasBroadcastInitial: false,
  manualVolumes: [],
};
let manualVolumesLoaded = false;
let manualVolumesLoadPromise = null;

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    if (error && error.code !== 'EEXIST') {
      console.warn('Unable to ensure data directory for manual volumes', error);
    }
  }
}

function sanitizeManualVolume(volume = {}) {
  if (!volume || typeof volume !== 'object') {
    return null;
  }
  const safePath = typeof volume.path === 'string' ? volume.path : typeof volume.id === 'string' ? volume.id : null;
  if (!safePath) {
    return null;
  }
  const label = typeof volume.label === 'string' ? volume.label : path.basename(safePath) || safePath;
  return {
    id: safePath,
    path: safePath,
    label,
    isRemovable: Boolean(volume.isRemovable),
    isSystem: Boolean(volume.isSystem),
    sizeBytes: typeof volume.sizeBytes === 'number' ? volume.sizeBytes : undefined,
    isLikelySdCard: Boolean(volume.isLikelySdCard),
    isManual: true,
  };
}

async function loadManualVolumesFromDisk() {
  if (manualVolumesLoaded) {
    return;
  }
  if (manualVolumesLoadPromise) {
    return manualVolumesLoadPromise;
  }
  manualVolumesLoadPromise = (async () => {
    try {
      await ensureDataDir();
      if (!fsSync.existsSync(MANUAL_VOLUMES_PATH)) {
        manualVolumesLoaded = true;
        manualVolumesLoadPromise = null;
        return;
      }
      const raw = await fs.readFile(MANUAL_VOLUMES_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        state.manualVolumes = parsed
          .map((item) => sanitizeManualVolume(item))
          .filter(Boolean);
      }
    } catch (error) {
      console.warn('Failed to load manual volumes', error);
    } finally {
      manualVolumesLoaded = true;
      manualVolumesLoadPromise = null;
    }
  })();
  return manualVolumesLoadPromise;
}

async function persistManualVolumes() {
  try {
    await ensureDataDir();
    await fs.writeFile(MANUAL_VOLUMES_PATH, JSON.stringify(state.manualVolumes, null, 2), 'utf-8');
  } catch (error) {
    console.warn('Failed to persist manual volumes', error);
  }
}

async function ensureManualVolumesLoaded() {
  if (manualVolumesLoaded) {
    return;
  }
  await loadManualVolumesFromDisk();
}

function pickPrimaryMountpoint(drive) {
  if (!Array.isArray(drive.mountpoints)) {
    return null;
  }
  const target = drive.mountpoints.find((entry) => entry && entry.path);
  return target || null;
}

function parseDiskutilInfo(output) {
  const info = {};
  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.includes('Protocol:')) {
      info.protocol = trimmed.split(':')[1]?.trim();
    }
    if (trimmed.includes('Removable Media:')) {
      info.removable = trimmed.toLowerCase().includes('yes');
    }
    if (trimmed.includes('Device / Media Name:')) {
      info.mediaName = trimmed.split(':')[1]?.trim();
    }
    if (trimmed.includes('Volume Name:')) {
      info.volumeName = trimmed.split(':')[1]?.trim();
    }
    if (trimmed.includes('SD Card Reader:')) {
      info.isSDCardReader = trimmed.toLowerCase().includes('yes');
    }
  }

  return info;
}

async function listMacOSVolumes() {
  if (process.platform !== 'darwin') {
    return [];
  }

  try {
    const volumesPath = '/Volumes';
    const entries = await fs.readdir(volumesPath, { withFileTypes: true });

    const volumes = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(volumesPath, entry.name);
        try {
          const stats = await fs.stat(fullPath);
          volumes.push({
            name: entry.name,
            path: fullPath,
            stats,
          });
        } catch (err) {
          // Skip volumes we can't stat
        }
      }
    }

    return volumes;
  } catch (error) {
    console.error('Failed to list /Volumes:', error);
    return [];
  }
}

function inferLabel(mountpoint, drive) {
  if (!mountpoint) {
    return null;
  }
  if (mountpoint.label) {
    return mountpoint.label;
  }
  const mountPath = mountpoint.path;

  if (process.platform === 'win32') {
    return mountPath;
  }

  if (mountPath && typeof mountPath === 'string') {
    return path.basename(mountPath);
  }

  if (drive && drive.description) {
    return drive.description;
  }

  return 'External Volume';
}

function looksLikeSdCard({ isRemovable, sizeBytes, label, path: mountPath, diskInfo }) {
  // Enhanced macOS SD card detection - check macOS-specific indicators first
  if (diskInfo) {
    // Check if it's explicitly an SD card reader
    if (diskInfo.isSDCardReader) {
      return true;
    }

    // Check protocol
    if (diskInfo.protocol) {
      const protocol = diskInfo.protocol.toLowerCase();
      if (SD_CARD_PROTOCOLS.some(p => protocol.includes(p.toLowerCase()))) {
        // SD Card protocol is a strong indicator
        if (protocol.includes('sd card') || protocol.includes('secure digital')) {
          return true;
        }
      }
    }

    // Check media name and volume name
    const macOSHaystack = [diskInfo.mediaName, diskInfo.volumeName]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (macOSHaystack) {
      const macOSKeywordHit = SD_KEYWORDS.some((keyword) => macOSHaystack.includes(keyword));
      if (macOSKeywordHit) {
        return true;
      }
      // Check for SD card types
      if (SD_CARD_TYPES.some(type => macOSHaystack.includes(type.toLowerCase()))) {
        return true;
      }
    }
  }

  // Check if removable and within size range
  if (isRemovable) {
    const withinSizeRange =
      typeof sizeBytes === 'number' &&
      sizeBytes >= MIN_SD_CARD_BYTES &&
      sizeBytes <= MAX_SD_CARD_BYTES;

    const haystack = [label, mountPath]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const keywordHit = SD_KEYWORDS.some((keyword) => haystack.includes(keyword));

    if (withinSizeRange || keywordHit) {
      return true;
    }
  }

  return false;
}

function normalizeDriveToVolumeInfo(drive, macOSDiskInfo = {}) {
  const mountpoint = pickPrimaryMountpoint(drive);
  if (!mountpoint || !mountpoint.path) {
    return null;
  }

  const label = inferLabel(mountpoint, drive);
  const isSystem = Boolean(drive.system);
  const isRemovable = !isSystem;
  const sizeBytes = typeof drive.size === 'number' ? drive.size : undefined;
  const mountPath = mountpoint.path;
  const id = mountPath;

  // Get macOS-specific disk info for this drive
  const diskInfo = macOSDiskInfo[drive.device];

  const volume = {
    id,
    path: mountPath,
    label,
    isRemovable,
    isSystem,
    sizeBytes,
    isLikelySdCard: looksLikeSdCard({
      isRemovable,
      sizeBytes,
      label,
      path: mountPath,
      diskInfo,
    }),
    raw: drive.device,
  };

  // Add macOS-specific metadata if available
  if (diskInfo) {
    volume.macOSInfo = {
      protocol: diskInfo.protocol,
      mediaName: diskInfo.mediaName,
      isSDCardReader: diskInfo.isSDCardReader,
    };
  }

  // The boot/system volume sometimes reports as removable=false but still helpful to show.
  if (!volume.label && mountPath === os.homedir()) {
    volume.label = 'Home Directory';
  }

  volume.displayLabel = volume.label || mountPath || id;
  return volume;
}

async function queryVolumes() {
  try {
    await ensureManualVolumesLoaded();
    // On macOS, prioritize /Volumes directory for SD card detection
    if (process.platform === 'darwin') {
      const macOSVolumes = await listMacOSVolumes();
      const volumes = [];

      // Process each volume in /Volumes directory
      for (const macVol of macOSVolumes) {
        try {
          const { stdout } = await execAsync(`diskutil info "${macVol.path}"`);
          const diskInfo = parseDiskutilInfo(stdout);

          // Extract device identifier and size
          const deviceMatch = stdout.match(/Device Node:\s+(\/dev\/disk\d+)/);
          const sizeMatch = stdout.match(/Disk Size:\s+(\d+)\s+B/);
          const deviceId = deviceMatch ? deviceMatch[1] : `unknown|${macVol.path}`;
          const sizeBytes = sizeMatch ? parseInt(sizeMatch[1], 10) : undefined;

          const isRemovable = diskInfo.removable !== false;

          // Skip system volumes (like Macintosh HD)
          const isSystemVolume = macVol.path === '/' || macVol.name === 'Macintosh HD';
          if (isSystemVolume) {
            continue;
          }

          // Check if this looks like an SD card
          const isLikelySdCard = looksLikeSdCard({
            isRemovable,
            sizeBytes,
            label: macVol.name,
            path: macVol.path,
            diskInfo,
          });

          console.log(`Checking volume: ${macVol.name}`, {
            isRemovable,
            sizeBytes,
            protocol: diskInfo.protocol,
            mediaName: diskInfo.mediaName,
            isSDCardReader: diskInfo.isSDCardReader,
            isLikelySdCard,
          });

          // Include all removable external volumes, prioritizing SD cards
          if (isLikelySdCard || isRemovable) {
            volumes.push({
              id: macVol.path,
              path: macVol.path,
              label: macVol.name,
              isRemovable,
              isSystem: false,
              sizeBytes,
              isLikelySdCard,
              raw: deviceId,
              macOSInfo: {
                protocol: diskInfo.protocol,
                mediaName: diskInfo.mediaName,
                isSDCardReader: diskInfo.isSDCardReader,
              },
            });
          }
        } catch (err) {
          console.error(`Failed to get info for volume ${macVol.name}:`, err.message);
        }
      }

      const combined = volumes.concat(getManualVolumeCopies());
      return annotateVolumeLabels(combined);
    }

    // Fallback for non-macOS: use drivelist and filter for SD cards
    const drives = await drivelist.list();
    const volumes = drives
      .map((drive) => normalizeDriveToVolumeInfo(drive))
      .filter((vol) => vol && vol.isLikelySdCard);

    const combined = volumes.concat(getManualVolumeCopies());
    return annotateVolumeLabels(combined);
  } catch (error) {
    console.error('Failed to list volumes via drivelist', error);
    return [];
  }
}

function annotateVolumeLabels(volumes = []) {
  const labelCounts = new Map();
  volumes.forEach((volume) => {
    if (!volume) {
      return;
    }
    const baseLabel = typeof volume.label === 'string' ? volume.label.trim() : '';
    if (!baseLabel) {
      return;
    }
    const key = baseLabel.toLowerCase();
    labelCounts.set(key, (labelCounts.get(key) || 0) + 1);
  });

  volumes.forEach((volume) => {
    if (!volume) {
      return;
    }
    const preferredLabel = volume.label || volume.path || volume.id || 'External Volume';
    volume.displayLabel = preferredLabel;
    const normalized = typeof volume.label === 'string' ? volume.label.trim().toLowerCase() : '';
    if (!normalized) {
      return;
    }
    if ((labelCounts.get(normalized) || 0) <= 1) {
      return;
    }
    const identifier = deriveVolumeIdentifier(volume);
    if (!identifier) {
      return;
    }
    volume.displayLabel = `${preferredLabel} (${identifier})`;
  });

  return volumes;
}

function deriveVolumeIdentifier(volume = {}) {
  if (volume.raw) {
    return volume.raw;
  }
  if (volume.macOSInfo?.mediaName) {
    return volume.macOSInfo.mediaName;
  }
  if (volume.path) {
    return volume.path;
  }
  if (volume.id) {
    return volume.id;
  }
  return null;
}

function getManualVolumeCopies() {
  return state.manualVolumes.map((volume) => ({ ...volume }));
}

async function addManualVolume(folderPath) {
  if (!folderPath) {
    throw new Error('Folder path is required.');
  }
  await ensureManualVolumesLoaded();
  const resolvedPath = path.resolve(folderPath);
  const cached = state.lastVolumes.find((volume) => volume.id === resolvedPath);
  if (cached) {
    return cached;
  }
  const existing = state.manualVolumes.find((volume) => volume.id === resolvedPath);
  if (existing) {
    return existing;
  }
  let stats;
  try {
    stats = await fs.stat(resolvedPath);
  } catch (error) {
    throw new Error('Selected folder is not accessible.');
  }
  if (!stats.isDirectory()) {
    throw new Error('Selected path is not a folder.');
  }
  const label = path.basename(resolvedPath) || resolvedPath;
  const manualVolume = {
    id: resolvedPath,
    path: resolvedPath,
    label,
    isRemovable: false,
    isSystem: false,
    sizeBytes: undefined,
    isLikelySdCard: false,
    isManual: true,
  };
  state.manualVolumes.push(manualVolume);
  await persistManualVolumes();
  return manualVolume;
}

async function refreshVolumes() {
  const previous = state.lastVolumes.slice();
  const volumes = await queryVolumes();
  const { added, removed } = diffVolumes(previous, volumes);
  state.lastVolumes = volumes;
  return { volumes, added, removed };
}

async function listVolumes() {
  const volumes = await queryVolumes();
  state.lastVolumes = volumes;
  return volumes;
}

function diffVolumes(prev, next) {
  const prevIds = new Map(prev.map((vol) => [vol.id, vol]));
  const nextIds = new Map(next.map((vol) => [vol.id, vol]));

  const added = [];
  const removed = [];

  nextIds.forEach((vol, id) => {
    if (!prevIds.has(id)) {
      added.push(vol);
    }
  });

  prevIds.forEach((vol, id) => {
    if (!nextIds.has(id)) {
      removed.push(vol);
    }
  });

  return { added, removed };
}

function startMonitoring(onChange, options = {}) {
  if (state.monitorTimer) {
    return;
  }
  const interval = options.intervalMs || POLL_INTERVAL_MS;

  const poll = async () => {
    const previous = state.lastVolumes.slice();
    const volumes = await queryVolumes();
    const { added, removed } = diffVolumes(previous, volumes);
    const hasDiff = added.length > 0 || removed.length > 0;
    state.lastVolumes = volumes;

    if (typeof onChange === 'function' && (hasDiff || !state.hasBroadcastInitial)) {
      onChange({
        volumes,
        added,
        removed,
      });
      state.hasBroadcastInitial = true;
    }
  };

  poll().catch(() => {});
  state.monitorTimer = setInterval(() => {
    poll().catch((error) => {
      console.error('Volume monitor poll failed', error);
    });
  }, interval);
}

function stopMonitoring() {
  if (state.monitorTimer) {
    clearInterval(state.monitorTimer);
    state.monitorTimer = null;
  }
  state.hasBroadcastInitial = false;
}

async function findVolume(volumeId) {
  if (!volumeId) {
    return null;
  }
  const volumes = await listVolumes();
  return volumes.find((volume) => volume.id === volumeId) || null;
}

function getCachedVolumes() {
  return state.lastVolumes.slice();
}

module.exports = {
  listVolumes,
  startMonitoring,
  stopMonitoring,
  findVolume,
  getCachedVolumes,
  addManualVolume,
  refreshVolumes,
};
