# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CardCatalog is an Electron desktop application for cataloging and organizing photos from SD cards. It uses AI-powered image classification (CLIP model) to automatically generate searchable labels for photos, extracts EXIF metadata, and provides a visual browsing interface with filtering capabilities.

## Development Commands

### Running the Application

Two separate processes are required for development:

```bash
# Terminal 1: Start the Nuxt renderer dev server (runs on port 3333)
npm run dev:renderer

# Terminal 2: Start Electron main process (connects to renderer at localhost:3333)
npm run dev
```

The renderer dev server must be running before starting Electron in dev mode.

### Building

```bash
# Build the Nuxt renderer for production (generates static files in src/renderer/.output/public)
npm run build:renderer

# Download CLIP model files (required before packaging)
npm run download-models

# Package the application (automatically downloads models first)
npm run package

# Create distributable installers (automatically downloads models first)
npm run make
```

### Other Commands

```bash
# Start with production build of renderer (requires build:renderer first)
npm start
```

## Architecture

### Main Process (src/main/)

The Electron main process handles all backend operations:

- **main.js**: Application entry point, window management, IPC handler registration, and orchestration of scanning/processing workflows
- **db.js**: SQLite database operations using sql.js (in-memory database with periodic persistence to disk). Schema includes photos table with EXIF metadata, AI labels, user tags, ratings, and descriptions
- **sd-detector.js**: Detects and monitors removable volumes (SD cards), handles volume changes, and manages manual folder selection
- **file-scanner.js**: Recursively scans volumes for image files, reports progress, and identifies photos to process
- **processing-queue.js**: Manages worker threads for parallel processing of EXIF extraction and AI label generation
- **stats-aggregator.js**: Computes statistics for photos (camera models, lenses, ISO ranges, etc.)
- **workers/**: Worker thread implementations
  - **exif-worker.js**: Extracts EXIF metadata from images using exifr, generates thumbnails with Jimp
  - **clip-keywords.js**: Generates AI labels using CLIP model (@xenova/transformers)

### Renderer Process (src/renderer/)

Nuxt 4 single-page application (SSR disabled, hash routing enabled):

- **nuxt.config.js**: Configures Nuxt for Electron compatibility (hash routing, relative asset paths, custom base URL)
- **pages/index.vue**: Main application page with photo grid, filters, and modal viewers
- **components/**: Vue components for UI
  - **AlbumStream.vue**: Virtual scrolling photo grid
  - **PhotoViewerModal.vue**: Full-screen photo viewer with metadata display and editing
  - **FilterPanel.vue**: Photo filtering controls (date, camera, lens, ISO, aperture, etc.)
  - **TimelineRail.vue**: Timeline visualization of photos by date
  - **StatsCharts.vue**: Charts for photo statistics
- **composables/**: Vue composables for shared logic (filters, location, formatting, details, zoom)
- **services/**: Frontend service layer for IPC communication
- **plugins/photo-album.client.js**: Exposes IPC API to Nuxt app via plugin

### Shared Code (src/shared/)

- **ipc-api.js**: Defines IPC channel names and TypeScript type definitions for communication between main and renderer processes

### Preload Script (src/preload/)

- **preload.js**: Exposes safe IPC communication methods to renderer via contextBridge

## Key Workflows

### Photo Scanning Flow

1. User adds volume (SD card detection or manual folder selection)
2. `file-scanner.js` recursively finds image files
3. For each image:
   - Basic file info inserted into database
   - If metadata is outdated (based on file signature = size:mtime), job is queued
4. `processing-queue.js` distributes jobs to worker threads:
   - `exif-worker.js` extracts EXIF data and generates thumbnail
   - `clip-keywords.js` generates AI labels using CLIP model
5. Results are written back to database via main process
6. After scan completes, photos without AI labels are automatically queued for AI processing

### AI Label Generation

- Uses CLIP vision-language model (Xenova/clip-vit-base-patch32)
- Model files downloaded during `npm run download-models` and bundled as extra resources
- Workers run CLIP inference in separate threads to avoid blocking main process
- Labels stored as JSON array with scores in database

### Database Schema

Photos table includes:
- File metadata: path, name, size, modification time
- EXIF data: shoot datetime, camera model, lens model, ISO, aperture, shutter speed, focal length
- Location: GPS coordinates, location labels
- AI-generated labels (JSON array with label/score pairs)
- User-editable fields: description, tags, rating (0-5 stars)
- Metadata signature for detecting file changes

## Important Notes

### Model Files

The CLIP model (~90MB) must be downloaded before packaging. The `prepackage` and `premake` scripts automatically run `download-models`. Model files are stored in `models/` directory and included as `extraResource` in forge.config.js.

\
### Renderer Build for Production

Before running `npm start`, `npm run package`, or `npm run make`, you must build the renderer:
```bash
npm run build:renderer
```

The production Electron app loads from `src/renderer/.output/public/index.html` (static files generated by Nuxt).

### Hash Routing

The renderer uses hash-based routing (`#/`) instead of history mode to work correctly when loaded from `file://` protocol in packaged Electron app.

### IPC Communication Pattern

All communication between renderer and main process goes through:
1. Renderer calls `window.photoAlbum.method()`
2. Preload script forwards to IPC channel
3. Main process handles via `ipcMain.handle()`
4. Main process broadcasts events via `window.webContents.send()` for scan progress and volume changes

### SQLite Persistence

The database uses sql.js (SQLite compiled to WebAssembly) running in the main process. It maintains an in-memory database with debounced writes to disk (1 second after changes). Call `db.shutdown()` before app quit to ensure final persist.

### File Signature for Change Detection

Photos are reprocessed only if their file signature changes. Signature format: `${fileSize}:${mtimeMs}`. This avoids redundant EXIF/AI processing on every scan.
