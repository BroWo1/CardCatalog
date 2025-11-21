# AI Keyword Extraction

CardCatalog now auto-labels supported photos with OpenAI CLIP via [Transformers.js](https://github.com/xenova/transformers.js). The worker thread that already handles EXIF parsing uses the quantized `Xenova/clip-vit-base-patch32` model (149 MB) and runs zero-shot image classification against a curated set of prompts defined in [`src/main/workers/clip-keywords.js`](../src/main/workers/clip-keywords.js).

- Keywords are generated for JPEG/PNG/BMP/GIF/WebP/TIFF files (or for the generated thumbnail) and saved in the `photos.ai_labels` column as JSON `{ label, score }` objects.
- The renderer automatically receives the parsed `aiLabels` array, displays the values inside the EXIF side panel, and includes them in both the global search box and the advanced filter text search.
- To tweak the vocabulary or thresholds, edit `KEYWORD_CANDIDATES`, `DEFAULT_MIN_SCORE`, or `DEFAULT_MAX_KEYWORDS` in `clip-keywords.js`.

## Bundled Model (No Downloads)

**The CLIP model is pre-bundled into the app** - no internet connection is required at runtime!

- The model is downloaded during the build process via `npm run download-models`
- Model files (149 MB) are bundled into the app package as extra resources
- The app is configured to **never download from the internet** (`allowRemoteModels: false`)
- Works completely offline after installation

### For Developers

When building the app:
1. `npm run package` or `npm run make` automatically downloads the model first (via `prepackage`/`premake` hooks)
2. If the model already exists in `models/`, it skips the download (fast subsequent builds)
3. To force re-download, delete the `models/` directory

## Auto-Processing Existing Photos

**Photos without AI labels are automatically processed!**

When you scan a volume:
1. New photos are scanned and get AI labels immediately
2. After the scan completes, the app automatically finds photos in the database without AI labels
3. These old photos are queued for AI label generation (up to 100 at a time)
4. The processing happens in the background using the same worker threads

This means:
- ✅ **First-time scans**: All photos get AI labels
- ✅ **Re-scans**: Only new photos and photos without labels are processed
- ✅ **Old databases**: Scanning a volume will backfill AI labels for existing photos
- ✅ **No manual intervention needed**: Happens automatically after each scan

### Manual Trigger (Optional)

You can also trigger AI label generation manually via IPC:
```javascript
window.photoAlbumApi.regenerateAiLabels(volumeId)
```

This will queue up to 100 photos without AI labels for processing.
