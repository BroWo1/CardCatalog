const fs = require('fs');
const path = require('path');
const { parentPort } = require('worker_threads');

const CLIP_MODEL_ID = 'Xenova/clip-vit-base-patch32';
const DEFAULT_MIN_SCORE = 0.16;
const DEFAULT_MAX_KEYWORDS = 6;

let manualResourcesPath = null;

function setResourcesPath(path) {
  manualResourcesPath = path;
  emitClipWorkerLog('info', 'resourcesPath override set', { path });
}

/**
 * Get the path to the bundled CLIP model.
 * In production, models are in app.asar.unpacked/resources/models/clip
 * In development, models are in project_root/models/clip
 */
function getBundledModelPath() {
  const runningInAsar = __dirname.includes('app.asar');
  const isDevelopment = !runningInAsar;

  if (isDevelopment) {
    // Development: models are in project root
    // This file is in src/main/workers/, so go up 3 levels
    return path.join(__dirname, '..', '..', '..', 'models', 'clip');
  } else {
    // Production: models are in resources/models/clip
    // Use manually provided resources path if available (for worker threads)
    let resPath = manualResourcesPath || process.resourcesPath;

    if (!resPath) {
      // Fallback: try to derive from __dirname in case we are in app.asar
      // Typical structure: .../Contents/Resources/app.asar/src/main/workers
      // We want: .../Contents/Resources
      // Go up 4 levels: workers -> main -> src -> app.asar -> Resources
      resPath = path.resolve(__dirname, '..', '..', '..', '..');
      emitClipWorkerLog('warn', 'process.resourcesPath missing, derived fallback', { resPath });
    }

    return path.join(resPath || '', 'models', 'clip');
  }
}

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.bmp',
  '.gif',
  '.webp',
  '.tif',
  '.tiff',
]);

const KEYWORD_CANDIDATES = [
  // --- LIGHTING & ATMOSPHERE (The "Vibe") ---
  'golden hour lighting',     // Warm, sunrise/sunset glow
  'blue hour dusk',           // The deep blue just after sunset
  'night photography',        // General night shots
  'starry night sky',         // Astro/stars
  'overcast diffused light',  // Soft, cloudy light
  'foggy mist',               // Moody atmosphere
  'silhouettes',              // High contrast backlighting
  'black and white photo',    // Monochrome

  // --- NATURE & LANDSCAPES ---
  'mountain landscape',
  'forest woodland',
  'green lush nature',
  'autumn foliage',           // Fall colors
  'snowy winter scene',
  'desert landscape',
  'beach coast',
  'ocean seascape',
  'waterfall long exposure',  // Smooth water effect
  'lake reflection',
  'flower macro',             // Close up plants

  // --- URBAN & TRAVEL ---
  'city skyline',             // Wide city views
  'urban street photography', // Candid city life
  'modern architecture',      // Glass/Steel buildings
  'historic architecture',    // Old buildings/Ruins
  'night cityscape',          // City lights at night
  'street lights neon',       // Cyberpunk/Night vibes
  'bridge structure',
  'market stall',             // Street markets/Travel

  // --- TRANSPORTATION (Enthusiast Focus) ---
  'car automotive',
  'motorcycle motorbike',
  'train railway',
  'airplane aviation',
  'boat ship vessel',
  'bicycle cycling',

  // --- PEOPLE & MOMENTS ---
  'portrait close-up',        // Headshots
  'candid street portrait',   // Natural, unposed
  'group photo friends',
  'crowd gathering',
  'wedding ceremony',
  'stage performance',        // Concerts/Theater

  // --- SUBJECTS & MACRO ---
  'wildlife animal',
  'bird in flight',
  'pet dog',
  'pet cat',
  'macro close-up',           // General small details
  'food gourmet',
  'coffee cafe',
  'abstract pattern'          // Textures/Lines
];

let clipResourcesPromise = null;
let clipTokenizerPromise = null;
let clipModelReadyLogged = false;
let transformersEnvConfigured = false;

function tensorToFirstRowArray(tensor) {
  if (!tensor) {
    return null;
  }
  try {
    if (typeof tensor.tolist === 'function') {
      const list = tensor.tolist();
      if (Array.isArray(list)) {
        return Array.isArray(list[0]) ? list[0] : list;
      }
    }
  } catch (error) {
    emitClipWorkerLog('warn', 'tensor.tolist() failed', { error: error?.message || String(error) });
  }

  const data = tensor?.data ?? tensor;
  if (Array.isArray(data)) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    return Array.from(data);
  }
  return null;
}

function applySoftmax(values) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }
  const maxVal = Math.max(...values);
  const exps = values.map((value) => Math.exp((Number.isFinite(value) ? value : Number(value) || 0) - maxVal));
  const sum = exps.reduce((acc, value) => acc + value, 0);
  if (!sum) {
    return null;
  }
  return exps.map((value) => value / sum);
}

function tensorSoftmaxRow(tensor) {
  if (tensor && typeof tensor.softmax === 'function') {
    try {
      const list = tensor.softmax().tolist();
      if (Array.isArray(list)) {
        return Array.isArray(list[0]) ? list[0] : list;
      }
    } catch (error) {
      emitClipWorkerLog('warn', 'Tensor.softmax conversion failed', {
        error: error?.message || String(error),
      });
    }
  }
  const logits = tensorToFirstRowArray(tensor);
  return applySoftmax(logits);
}

function tensorRowToArray(tensor) {
  const row = tensorToFirstRowArray(tensor);
  if (!Array.isArray(row)) {
    return null;
  }
  return row.map((value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  });
}

function emitClipWorkerLog(level, message, context = null) {
  const entry = {
    type: 'log',
    level,
    message,
    context,
    timestamp: Date.now(),
  };
  try {
    parentPort?.postMessage(entry);
  } catch (error) {
    // Ignore if logging channel unavailable
  }
  const method = level === 'error'
    ? console.error
    : level === 'warn'
      ? console.warn
      : level === 'debug'
        ? console.debug
        : console.info;
  method(`[clip-keywords] ${message}`, context ?? '');
}

function ensureBundledClipModelPath() {
  const bundledModelPath = getBundledModelPath();
  if (!fs.existsSync(bundledModelPath)) {
    throw new Error(
      `Bundled CLIP model not found at ${bundledModelPath}. ` +
      `Please run 'npm run download-models' before packaging the app.`
    );
  }
  return bundledModelPath;
}

function configureTransformersEnv(env, bundledModelPath) {
  if (!env || transformersEnvConfigured) {
    return;
  }

  env.cacheDir = bundledModelPath;
  env.localModelPath = bundledModelPath;
  env.allowLocalModels = true;
  emitClipWorkerLog('info', 'Transformers env configured', {
    cacheDir: env.cacheDir,
    localModelPath: env.localModelPath,
  });

  env.allowRemoteModels = false;
  emitClipWorkerLog('info', 'Transformers env remote downloads disabled');
  transformersEnvConfigured = true;
}

async function loadClipTokenizer(transformersLib = null, bundledModelPath = null) {
  if (!clipTokenizerPromise) {
    clipTokenizerPromise = (async () => {
      const clipPath = bundledModelPath || ensureBundledClipModelPath();
      const { AutoTokenizer, env } = transformersLib || (await import('@xenova/transformers'));
      configureTransformersEnv(env, clipPath);
      return AutoTokenizer.from_pretrained(CLIP_MODEL_ID, {
        local_files_only: true,
      });
    })();
  }
  return clipTokenizerPromise;
}

async function loadClipModel() {
  if (!clipResourcesPromise) {
    clipResourcesPromise = (async () => {
      const bundledModelPath = ensureBundledClipModelPath();
      emitClipWorkerLog('info', 'Attempting to load CLIP model', { bundledModelPath });

      const transformersLib = await import('@xenova/transformers');
      const { AutoModel, AutoProcessor, env } = transformersLib;
      configureTransformersEnv(env, bundledModelPath);

      const [model, processor, tokenizer] = await Promise.all([
        AutoModel.from_pretrained(CLIP_MODEL_ID, {
          quantized: true,
          local_files_only: true,
        }),
        AutoProcessor.from_pretrained(CLIP_MODEL_ID, {
          quantized: true,
          local_files_only: true,
        }),
        loadClipTokenizer(transformersLib, bundledModelPath),
      ]);

      if (!clipModelReadyLogged) {
        clipModelReadyLogged = true;
        emitClipWorkerLog('info', 'CLIP model and processor ready', { bundledModelPath });
      }

      return { model, processor, tokenizer };
    })();
  }
  return clipResourcesPromise;
}

function isSupportedImageFile(filePath) {
  if (typeof filePath !== 'string' || !filePath.length) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_IMAGE_EXTENSIONS.has(ext);
}

async function generateClipData(imagePath, options = {}) {
  if (!imagePath || !isSupportedImageFile(imagePath)) {
    return { keywords: [], embedding: null };
  }
  if (!fs.existsSync(imagePath)) {
    return { keywords: [], embedding: null };
  }

  const labels = options.labels && options.labels.length ? options.labels : KEYWORD_CANDIDATES;
  if (!labels.length) {
    return { keywords: [], embedding: null };
  }

  try {
    const { model, processor, tokenizer } = await loadClipModel();
    const { RawImage } = await import('@xenova/transformers');
    
    const image = await RawImage.read(imagePath);
    
    const imageInputs = await processor(image);
    const textInputs = await tokenizer(labels, { padding: true, truncation: true });
    const modelInputs = {
      ...imageInputs,
      ...textInputs,
    };

    if (!modelInputs.pixel_values || !modelInputs.input_ids) {
      const keys = Object.keys(modelInputs);
      throw new Error(`Missing inputs for CLIP model. Keys present: ${keys.join(', ')}`);
    }

    const { logits_per_image, image_embeds } = await model(modelInputs);

    // Process keywords
    const probs = tensorSoftmaxRow(logits_per_image);
    if (!Array.isArray(probs) || probs.length !== labels.length) {
      throw new Error(
        `Unable to compute CLIP probabilities (labels=${labels.length}, probs=${probs?.length ?? 0})`,
      );
    }
    const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
    const maxKeywords = options.maxKeywords ?? DEFAULT_MAX_KEYWORDS;
    
    const keywords = labels
      .map((label, i) => ({ label, score: probs[i] }))
      .filter((entry) => typeof entry?.score === 'number' && entry.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxKeywords)
      .map((entry) => ({
        label: typeof entry.label === 'string' ? entry.label.trim() : '',
        score: Number.isFinite(entry.score) ? Number(entry.score.toFixed(4)) : null,
      }))
      .filter((entry) => entry.label && entry.score != null);

    // Process embedding
    const embedding = tensorRowToArray(image_embeds);

    return { keywords, embedding };
  } catch (error) {
    emitClipWorkerLog('warn', 'CLIP data generation failed', {
      error: error?.message || error,
      imagePath,
    });
    return { keywords: [], embedding: null };
  }
}

async function generateTextEmbedding(text) {
  if (!text || typeof text !== 'string' || !text.trim().length) {
    return null;
  }

  try {
    const { model, tokenizer } = await loadClipModel();
    const { Tensor } = await import('@xenova/transformers');
    const textInputs = await tokenizer(text, { padding: true, truncation: true });
    // Provide a zero-filled image tensor to satisfy the model's vision input requirements.
    const dummyPixelValues = new Tensor(
      'float32',
      new Float32Array(3 * 224 * 224),
      [1, 3, 224, 224],
    );
    const combinedInputs = {
      pixel_values: dummyPixelValues,
      ...textInputs,
    };
    const { text_embeds } = await model(combinedInputs);
    return tensorRowToArray(text_embeds);
  } catch (error) {
    emitClipWorkerLog('warn', 'CLIP text embedding generation failed', {
      error: error?.message || error,
      text,
    });
    return null;
  }
}

async function generateClipKeywords(imagePath, options = {}) {
  const { keywords } = await generateClipData(imagePath, options);
  return keywords;
}

async function ensureClipModelReady() {
  await loadClipModel();
  return true;
}

module.exports = {
  KEYWORD_CANDIDATES,
  SUPPORTED_IMAGE_EXTENSIONS,
  isSupportedImageFile,
  generateClipKeywords,
  generateClipData,
  generateTextEmbedding,
  ensureClipModelReady,
  setResourcesPath,
};
