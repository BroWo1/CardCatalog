const fs = require('fs');
const path = require('path');
const { pipeline, env } = require('@xenova/transformers');

const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const MODEL_DIR = path.join(__dirname, '..', 'models', 'clip');

/**
 * Check if the model is already downloaded
 */
function isModelDownloaded() {
  const modelFile = path.join(MODEL_DIR, 'Xenova', 'clip-vit-base-patch32', 'onnx', 'model_quantized.onnx');
  return fs.existsSync(modelFile);
}

async function downloadModel() {
  console.log('='.repeat(60));
  console.log('Checking CLIP model for CardCatalog...');
  console.log('='.repeat(60));
  console.log(`Model: ${MODEL_ID}`);
  console.log(`Destination: ${MODEL_DIR}`);
  console.log('');

  // Check if model already exists
  if (isModelDownloaded()) {
    console.log('✓ Model already downloaded, skipping download');
    console.log('  (Delete models/ directory to force re-download)');
    console.log('='.repeat(60));
    return;
  }

  // Create models directory
  fs.mkdirSync(MODEL_DIR, { recursive: true });

  // Configure transformers.js to download to our models directory
  env.cacheDir = MODEL_DIR;
  env.localModelPath = MODEL_DIR;
  env.allowRemoteModels = true;
  env.allowLocalModels = true;

  try {
    console.log('Downloading model files... (this may take a few minutes)');
    const startTime = Date.now();

    // Download the model by initializing the pipeline
    const classifier = await pipeline('zero-shot-image-classification', MODEL_ID, {
      quantized: true,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✓ Model downloaded successfully in ${elapsed}s`);
    console.log('');

    // List downloaded files
    console.log('Downloaded files:');
    const files = fs.readdirSync(MODEL_DIR, { recursive: true });
    let totalSize = 0;

    files.forEach((file) => {
      const filePath = path.join(MODEL_DIR, file);
      if (fs.statSync(filePath).isFile()) {
        const stats = fs.statSync(filePath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        totalSize += stats.size;
        console.log(`  - ${file}: ${sizeMB} MB`);
      }
    });

    console.log('');
    console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
    console.log('='.repeat(60));
    console.log('✓ CLIP model ready for bundling');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('');
    console.error('✗ Failed to download CLIP model:');
    console.error(error.message);
    console.error('');
    console.error('Please check your internet connection and try again.');
    process.exit(1);
  }
}

downloadModel().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
