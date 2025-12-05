const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');

const DEFAULT_MAX_WORKERS = Math.max(1, Math.min(os.cpus().length, 6));
const workerScript = path.join(__dirname, 'workers', 'exif-worker.js');
const SPAWN_STAGGER_MS = 600;

let initialized = false;
let workers = [];
let jobQueue = [];
let activeJobs = new Map();
let jobCounter = 0;
let totalJobsScheduled = 0;
let totalJobsCompleted = 0;
let totalJobsFailed = 0;
const resultHandlers = new Set();
let sharedOptions = {
  thumbnailBaseDir: null,
  resourcesPathOverride: null,
};
const cancelledJobIds = new Set();
let logHandler = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function initProcessingQueue(options = {}) {
  if (initialized) {
    return;
  }

  sharedOptions.thumbnailBaseDir = options.thumbnailBaseDir || sharedOptions.thumbnailBaseDir;
  sharedOptions.resourcesPathOverride =
    options.resourcesPathOverride || sharedOptions.resourcesPathOverride;
  const workerCount = options.workerCount || DEFAULT_MAX_WORKERS;
  initialized = true;
  bootstrapWorkers(workerCount);
}

async function bootstrapWorkers(workerCount) {
  for (let i = 0; i < workerCount; i += 1) {
    const { warmReady } = spawnWorker();
    try {
      await warmReady;
    } catch (_error) {
      // Ignore warm failures; replaceWorker will spawn a new one if needed
    }
    if (i < workerCount - 1) {
      await sleep(SPAWN_STAGGER_MS);
    }
  }
}

function spawnWorker() {
  const worker = new Worker(workerScript, {
    workerData: {
      thumbnailBaseDir: sharedOptions.thumbnailBaseDir,
      resourcesPath: sharedOptions.resourcesPathOverride || process.resourcesPath,
    },
  });
  console.info('[processing-queue] Spawned worker with data:', {
    thumbnailBaseDir: sharedOptions.thumbnailBaseDir,
    resourcesPath: sharedOptions.resourcesPathOverride || process.resourcesPath,
  });
  const info = { worker, busy: true, currentJobId: null, expectedExit: false };
  let warmResolved = false;
  const resolveWarm = () => {
    if (warmResolved) {
      return;
    }
    warmResolved = true;
    info.busy = false;
    dispatchJobs();
  };
  const warmReady = new Promise((resolve) => {
    const onWarmReady = (message) => {
      if (message && message.type === 'warm-ready') {
        worker.off('message', onWarmReady);
        resolveWarm();
        resolve(true);
      }
    };
    worker.on('message', onWarmReady);
  });

  worker.on('message', (message) => {
    handleWorkerMessage(info, message);
  });

  worker.on('error', (error) => {
    console.error('EXIF worker error', error);
    info.busy = false;
    resolveWarm();
    requeueJobById(info.currentJobId);
    replaceWorker(info);
  });

  worker.on('exit', (code) => {
    if (info.expectedExit) {
      return;
    }
    if (code !== 0) {
      console.warn('EXIF worker exited unexpectedly with code', code);
      requeueJobById(info.currentJobId);
      replaceWorker(info);
    }
    resolveWarm();
  });

  workers.push(info);
  try {
    worker.postMessage({ type: 'warm' });
  } catch (error) {
    console.warn('Failed to warm EXIF worker', error);
    resolveWarm();
  }

  return { info, warmReady };
}

function replaceWorker(info) {
  const index = workers.indexOf(info);
  if (index >= 0) {
    workers.splice(index, 1);
  }
  info.expectedExit = true;
  info.worker.terminate().catch(() => {});
  const spawned = spawnWorker();
  if (spawned && spawned.warmReady) {
    spawned.warmReady.catch(() => {});
  }
  dispatchJobs();
}

function enqueueJob(volumeId, filePath, options = {}) {
  if (!initialized) {
    initProcessingQueue();
  }
  const metadataSignature = options.metadataSignature || null;
  const jobId = `job_${Date.now()}_${jobCounter++}`;
  jobQueue.push({ id: jobId, volumeId, filePath, metadataSignature });
  totalJobsScheduled += 1;
  dispatchJobs();
  return jobId;
}

function onJobResult(handler) {
  resultHandlers.add(handler);
  return () => resultHandlers.delete(handler);
}

function dispatchJobs() {
  for (const info of workers) {
    if (info.busy) {
      continue;
    }
    const job = jobQueue.shift();
    if (!job) {
      break;
    }
    info.busy = true;
    info.currentJobId = job.id;
    activeJobs.set(job.id, job);
    info.worker.postMessage({
      type: 'process',
      jobId: job.id,
      volumeId: job.volumeId,
      filePath: job.filePath,
      metadataSignature: job.metadataSignature,
    });
  }
}

function onLog(handler) {
  logHandler = handler;
}

function handleWorkerMessage(workerInfo, message) {
  if (!message) {
    return;
  }
  if (message.type === 'log') {
    if (typeof logHandler === 'function') {
      try {
        logHandler(message);
      } catch (error) {
        console.warn('Log handler threw an error', error);
      }
    }
    return;
  }
  if (message.type !== 'result') {
    return;
  }

  const job = activeJobs.get(message.jobId);
  const wasCancelled = cancelledJobIds.has(message.jobId);
  if (job) {
    activeJobs.delete(message.jobId);
  }

  workerInfo.busy = false;
  workerInfo.currentJobId = null;

  if (wasCancelled) {
    cancelledJobIds.delete(message.jobId);
    dispatchJobs();
    return;
  }

  if (message.success) {
    totalJobsCompleted += 1;
  } else {
    totalJobsFailed += 1;
  }

  resultHandlers.forEach((handler) => {
    try {
      handler(message, job || null);
    } catch (error) {
      console.error('Error in job result handler', error);
    }
  });

  dispatchJobs();
}

function cancelJobsForVolume(volumeId) {
  if (!volumeId) {
    return { cancelledQueued: 0, cancelledActive: 0 };
  }

  let cancelledQueued = 0;
  jobQueue = jobQueue.filter((job) => {
    if (job.volumeId === volumeId) {
      cancelledQueued += 1;
      return false;
    }
    return true;
  });

  let cancelledActive = 0;
  const workerSnapshot = [...workers];
  for (const info of workerSnapshot) {
    const jobId = info.currentJobId;
    if (!jobId) {
      continue;
    }
    const job = activeJobs.get(jobId);
    if (!job || job.volumeId !== volumeId) {
      continue;
    }
    cancelledActive += 1;
    activeJobs.delete(jobId);
    cancelledJobIds.add(jobId);
    info.busy = false;
    info.currentJobId = null;
    info.expectedExit = true;

    const terminatePromise = info.worker.terminate();
    terminatePromise.catch(() => {});
    terminatePromise.finally(() => {
      cancelledJobIds.delete(jobId);
    }).catch(() => {});

    const index = workers.indexOf(info);
    if (index >= 0) {
      workers.splice(index, 1);
    }
  }

  for (let i = 0; i < cancelledActive; i += 1) {
    const spawned = spawnWorker();
    if (spawned && spawned.warmReady) {
      spawned.warmReady.catch(() => {});
    }
  }

  if (cancelledQueued || cancelledActive) {
    dispatchJobs();
  }

  return { cancelledQueued, cancelledActive };
}

function getStats() {
  return {
    scheduled: totalJobsScheduled,
    completed: totalJobsCompleted,
    failed: totalJobsFailed,
    queued: jobQueue.length,
    inFlight: activeJobs.size,
  };
}

function shutdown() {
  workers.forEach((info) => {
    info.expectedExit = true;
    info.worker.terminate().catch(() => {});
  });
  workers = [];
  jobQueue = [];
  activeJobs.clear();
  initialized = false;
}

module.exports = {
  initProcessingQueue,
  enqueueJob,
  onJobResult,
  onLog,
  getStats,
  cancelJobsForVolume,
  shutdown,
};

function requeueJobById(jobId) {
  if (!jobId) {
    return;
  }
  const job = activeJobs.get(jobId);
  if (job) {
    activeJobs.delete(jobId);
    jobQueue.unshift(job);
  }
}
