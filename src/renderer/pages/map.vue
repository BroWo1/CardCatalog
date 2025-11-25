<template>
  <div class="map-page-root" :class="{ 'is-mac-layout': isMacLayout }">
    <header class="app-header map-page-header">
      <div class="app-header-drag-handle" aria-hidden="true"></div>
      <div class="app-header-container">
        <div class="map-header-left">
          <UButton
            class="window-no-drag"
            color="gray"
            variant="soft"
            size="sm"
            icon="i-heroicons-arrow-left"
            to="/"
          >
            Library
          </UButton>
          <div class="map-title-block window-no-drag">
            <p class="map-title-label">Photo Map</p>
            <p class="map-title-subtitle">{{ headerSubtitle }}</p>
          </div>
        </div>
        <div class="map-header-actions">
          <UButton
            class="window-no-drag"
            color="primary"
            size="sm"
            icon="i-heroicons-arrow-path"
            :loading="isLoading"
            :disabled="!hasBridge"
            @click="reloadLocations"
          >
            Refresh
          </UButton>
        </div>
      </div>
    </header>

    <main class="map-page-main">
      <div class="map-stage">
        <div ref="mapContainer" class="map-canvas"></div>

        <transition name="fade">
          <div v-if="isLoading" class="map-loading window-no-drag">
            <UIcon name="i-heroicons-arrow-path" class="spinner" />
            <span>Loading geotagged photos…</span>
          </div>
        </transition>

        <div v-if="overlayMessage" class="map-overlay window-no-drag">
          <p>{{ overlayMessage }}</p>
          <UButton
            v-if="showRetry"
            color="gray"
            variant="soft"
            icon="i-heroicons-arrow-path"
            @click="reloadLocations"
          >
            Try again
          </UButton>
        </div>
        <!--
        <div class="map-footer-overlay window-no-drag">
          <div class="map-footer-stat">
            <UIcon name="i-heroicons-map-pin" />
            <span>{{ photoCountLabel }}</span>
          </div>
          <p class="map-footer-hint">
            Scroll or pinch to zoom. Click clusters to dive into dense areas and tap a photo pin to open it.
          </p>
        </div>
        -->
      </div>
    </main>
    <UModal v-model:open="clusterModalOpen" :ui="clusterModalUi">
      <template #content>
        <div class="cluster-modal-panel">
          <div class="cluster-modal-header">
            <div>
              <h2 class="cluster-modal-title">{{ clusterModalTitle }}</h2>
              <p class="cluster-modal-subtitle">Photos near this map area</p>
            </div>
            <button type="button" class="cluster-modal-close" @click="closeClusterModal">
              <UIcon name="i-heroicons-x-mark" class="w-5 h-5" />
            </button>
          </div>
          <div class="cluster-modal-body">
            <div v-if="clusterError" class="cluster-modal-error">
              <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5" />
              <span>{{ clusterError }}</span>
            </div>
            <AlbumStream
              v-else
              :photos="clusterPhotos"
              :loading="clusterLoading"
              :has-more="clusterHasMore"
              empty-message="No photos found in this cluster."
              :format-date-label="formatDateOnly"
              :format-time-label="formatTimeOnly"
              :format-camera="formatCamera"
              :get-thumbnail-url="getThumbnailUrl"
              :show-actions="false"
              @load-more="handleClusterLoadMore"
              @select-photo="handleClusterPhotoSelected"
            />
          </div>
        </div>
      </template>
    </UModal>
    <PhotoViewerModal
      v-model="photoModalOpen"
      :photo="selectedPhoto"
      :photos="modalPhotoList"
      @navigate-photo="handleNavigatePhoto"
      @details-saved="handlePhotoDetailsSaved"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import Supercluster from 'supercluster';
import 'leaflet/dist/leaflet.css';
import PhotoViewerModal from '../components/PhotoViewerModal.vue';
import AlbumStream from '../components/AlbumStream.vue';
import { usePhotoFormatter } from '../composables/usePhotoFormatter';
import {
  normalizePhotoFromServer,
  coerceTagsArray,
  normalizeRatingValue,
} from '../utils/photoNormalizer';

const nuxtApp = useNuxtApp();
const route = useRoute();
const photoAlbum = computed(() => nuxtApp.$photoAlbum || null);
const hasBridge = computed(() => Boolean(photoAlbum.value));
const isMacLayout = ref(false);

const mapContainer = ref(null);
const mapInstance = shallowRef(null);
const markerLayer = shallowRef(null);
const clusterIndex = shallowRef(null);
let resizeFrameId = null;

const locationPoints = ref([]);
const isLoading = ref(false);
const loadError = ref(null);
const lastLoadedAt = ref(null);
const photoModalOpen = ref(false);
const selectedPhoto = ref(null);
const photoViewerContext = ref('single');
const modalPhotoList = computed(() => {
  if (!selectedPhoto.value) {
    return [];
  }
  if (photoViewerContext.value === 'cluster') {
    return clusterPhotos.value;
  }
  return [selectedPhoto.value];
});
const clusterModalOpen = ref(false);
const clusterPhotos = ref([]);
const clusterLoading = ref(false);
const clusterHasMore = ref(false);
const clusterMeta = ref({
  id: null,
  total: 0,
  title: '',
  lat: null,
  lng: null,
});
const clusterLeafOffset = ref(0);
const clusterError = ref('');
const CLUSTER_PAGE_SIZE = 60;
let pendingPhotoRequestId = 0;
const clusterModalUi = {
  content:
    'max-w-none sm:max-w-none w-[min(100vw-2rem,1100px)] max-h-[90vh] p-0 bg-transparent shadow-none border-none ring-0 mx-auto my-auto',
};

const {
  formatDateOnly,
  formatTimeOnly,
  formatCamera,
  getThumbnailUrl,
  toFileUrl,
} = usePhotoFormatter();

let Leaflet = null;
let pendingFit = false;
const refreshTimeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

const headerSubtitle = computed(() => {
  if (!hasBridge.value) {
    return 'Launch the desktop app to explore your photo map.';
  }
  if (isLoading.value) {
    return 'Loading geotagged photos…';
  }
  if (!locationPoints.value.length) {
    return 'No photos with GPS metadata yet.';
  }
  return `${locationPoints.value.length.toLocaleString()} geotagged photos pinned`;
});

const photoCountLabel = computed(() => {
  if (!locationPoints.value.length) {
    return 'No pins yet';
  }
  const prefix = locationPoints.value.length.toLocaleString();
  if (!lastLoadedAt.value) {
    return `${prefix} photo pins`;
  }
  return `${prefix} photo pins · Updated ${refreshTimeFormatter.format(lastLoadedAt.value)}`;
});

const clusterModalTitle = computed(() => {
  if (!clusterMeta.value.id) {
    return 'Cluster photos';
  }
  const total = clusterMeta.value.total || clusterPhotos.value.length;
  if (!total) {
    return 'Cluster photos';
  }
  return `${total.toLocaleString()} photo${total === 1 ? '' : 's'}`;
});

const overlayMessage = computed(() => {
  if (!hasBridge.value) {
    return 'The interactive map is only available while running CardCatalog inside Electron.';
  }
  if (loadError.value) {
    return loadError.value;
  }
  if (!isLoading.value && !locationPoints.value.length) {
    return 'No photos with GPS metadata were found.';
  }
  return '';
});

const showRetry = computed(() => hasBridge.value && Boolean(loadError.value));

async function ensureLeaflet() {
  if (Leaflet) {
    return Leaflet;
  }
  const module = await import('leaflet');
  Leaflet = module.default;
  return Leaflet;
}

async function initMap() {
  if (!import.meta.client || mapInstance.value || !mapContainer.value) {
    return;
  }
  const L = await ensureLeaflet();
  mapInstance.value = L.map(mapContainer.value, {
    center: [30, 0],
    zoom: 2,
    minZoom: 2,
    maxZoom: 18,
    zoomControl: false,
    worldCopyJump: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(mapInstance.value);

  L.control.zoom({ position: 'bottomright' }).addTo(mapInstance.value);
  markerLayer.value = L.layerGroup().addTo(mapInstance.value);

  mapInstance.value.on('moveend', handleMapChanged);
  mapInstance.value.on('zoomend', handleMapChanged);
  scheduleMapResize();

  if (locationPoints.value.length) {
    pendingFit = true;
    nextTick(() => {
      fitMapToLocations();
      updateVisibleClusters();
    });
  }
}

function handleMapChanged() {
  updateVisibleClusters();
}

function scheduleMapResize() {
  if (!mapInstance.value) {
    return;
  }
  if (typeof window === 'undefined') {
    mapInstance.value.invalidateSize();
    return;
  }
  if (resizeFrameId) {
    window.cancelAnimationFrame(resizeFrameId);
  }
  resizeFrameId = window.requestAnimationFrame(() => {
    resizeFrameId = null;
    mapInstance.value?.invalidateSize();
  });
}

const handleWindowResize = () => scheduleMapResize();

onMounted(async () => {
  const platformLabel = navigator?.userAgent || navigator?.platform || '';
  isMacLayout.value = /mac/i.test(platformLabel);

  if (import.meta.client) {
    await initMap();
    window.addEventListener('resize', handleWindowResize, { passive: true });
  }
  if (hasBridge.value) {
    loadLocations();
  }
});

onBeforeUnmount(() => {
  if (mapInstance.value) {
    mapInstance.value.off('moveend', handleMapChanged);
    mapInstance.value.off('zoomend', handleMapChanged);
    mapInstance.value.remove();
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', handleWindowResize);
  }
});

watch(hasBridge, (ready) => {
  if (ready && !locationPoints.value.length && !isLoading.value) {
    loadLocations();
  }
});

watch(locationPoints, (points, previous) => {
  if (!points.length) {
    clusterIndex.value = null;
    if (markerLayer.value) {
      markerLayer.value.clearLayers();
    }
    return;
  }

  const features = points.map((point) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [point.lng, point.lat],
    },
    properties: {
      id: point.id,
      thumbnail: point.thumbnail,
      sourceUrl: point.sourceUrl,
      shootDateTime: point.shootDateTime,
    },
  }));

  clusterIndex.value = new Supercluster({
    radius: 72,
    maxZoom: 18,
    minPoints: 2,
  }).load(features);

  if (!previous?.length) {
    const { lat, lng, zoom } = route.query;
    if (lat && lng) {
      pendingFit = false;
      nextTick(() => {
        if (mapInstance.value) {
          mapInstance.value.setView([Number(lat), Number(lng)], Number(zoom) || 16);
        }
      });
    } else {
      pendingFit = true;
    }
  }

  nextTick(() => {
    if (pendingFit) {
      fitMapToLocations();
    }
    updateVisibleClusters();
  });
});

function resetClusterData() {
  clusterPhotos.value = [];
  clusterHasMore.value = false;
  clusterMeta.value = { id: null, total: 0, title: '', lat: null, lng: null };
  clusterLeafOffset.value = 0;
  clusterError.value = '';
}

watch(photoModalOpen, (open) => {
  if (!open) {
    selectedPhoto.value = null;
    photoViewerContext.value = 'single';
    if (!clusterModalOpen.value) {
      resetClusterData();
    }
  }
});

watch(clusterModalOpen, (open) => {
  if (!open && photoViewerContext.value !== 'cluster') {
    resetClusterData();
  }
});

async function loadLocations() {
  if (!photoAlbum.value || isLoading.value) {
    return;
  }
  isLoading.value = true;
  loadError.value = null;

  try {
    const response = await photoAlbum.value.fetchPhotoLocations();
    const records = Array.isArray(response?.items)
      ? response.items
      : Array.isArray(response)
        ? response
        : [];

    const normalized = records
      .map((record) => {
        const lat = Number(record.gpsLat);
        const lng = Number(record.gpsLng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return null;
        }
        return {
          id: record.id,
          volumeId: record.volumeId,
          lat,
          lng,
          sourceUrl: toFileUrl(record.filePath) || null,
          thumbnail: toFileUrl(record.thumbnailPath) || toFileUrl(record.filePath) || null,
          shootDateTime: record.shootDateTime ? Number(record.shootDateTime) : null,
        };
      })
      .filter(Boolean);

    locationPoints.value = normalized;
    lastLoadedAt.value = Date.now();
  } catch (error) {
    console.error('[Map] Failed to load locations', error);
    loadError.value = error?.message || 'Unable to fetch geotagged photos.';
  } finally {
    isLoading.value = false;
  }
}

function reloadLocations() {
  if (!hasBridge.value) {
    return;
  }
  loadLocations();
}

function fitMapToLocations() {
  if (!mapInstance.value || !Leaflet || !locationPoints.value.length) {
    return;
  }
  const latLngs = locationPoints.value.map((point) => [point.lat, point.lng]);
  const bounds = Leaflet.latLngBounds(latLngs);
  mapInstance.value.fitBounds(bounds, { padding: [50, 50], maxZoom: 8 });
  pendingFit = false;
  scheduleMapResize();
}

function updateVisibleClusters() {
  if (!mapInstance.value || !markerLayer.value) {
    return;
  }
  markerLayer.value.clearLayers();
  if (!clusterIndex.value || !Leaflet) {
    return;
  }

  const map = mapInstance.value;
  const bounds = map.getBounds();
  const zoom = Math.round(map.getZoom());
  const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
  const clusters = clusterIndex.value.getClusters(bbox, zoom);

  clusters.forEach((feature) => {
    const [lng, lat] = feature.geometry.coordinates;
    if (feature.properties.cluster) {
      createClusterMarker(lat, lng, feature);
    } else {
      createPhotoMarker(lat, lng, feature.properties);
    }
  });

  scheduleMapResize();
}

function createClusterMarker(lat, lng, feature) {
  if (!Leaflet || !markerLayer.value) {
    return;
  }
  const count = feature.properties.point_count;
  const size = getClusterSize(count);

  const baseColor = getClusterColor(count);
  const setAlpha = (rgba, alpha) => rgba.replace(/[\d.]+\)$/, `${alpha})`);

  const style = [
    `--cluster-bg: ${baseColor}`,
    `--cluster-shadow: ${setAlpha(baseColor, 0.25)}`,
    `--cluster-bg-hover: ${setAlpha(baseColor, 0.85)}`,
    `--cluster-shadow-hover: ${setAlpha(baseColor, 0.4)}`,
  ].join(';');

  const icon = Leaflet.divIcon({
    html: `<div class="photo-cluster" style="${style}"><span>${formatClusterCount(count)}</span></div>`,
    className: 'photo-cluster-icon',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
  const marker = Leaflet.marker([lat, lng], { icon, interactive: true });
  marker.on('click', () => openClusterAlbum(lat, lng, feature));
  marker.addTo(markerLayer.value);
}

function createPhotoMarker(lat, lng, properties) {
  if (!Leaflet || !markerLayer.value) {
    return;
  }
  const imageSource = properties.thumbnail || properties.sourceUrl;
  let icon;
  if (imageSource) {
    icon = Leaflet.divIcon({
      html: `<div class="photo-map-pin" style="background-image: url('${imageSource}')"></div>`,
      className: 'photo-pin-container',
      iconSize: [52, 52],
      iconAnchor: [26, 26],
    });
  } else {
    icon = Leaflet.divIcon({
      html: '<div class="photo-pin-placeholder"></div>',
      className: 'photo-pin-fallback',
      iconSize: [52, 52],
      iconAnchor: [26, 26],
    });
  }

  const marker = Leaflet.marker([lat, lng], { icon, riseOnHover: true });
  marker.on('click', () => openPhotoFromMarker(properties.id));
  marker.addTo(markerLayer.value);
}

function openClusterAlbum(lat, lng, feature) {
  if (!feature?.id || !clusterIndex.value || !photoAlbum.value) {
    return;
  }
  const pointCount = Number(feature?.properties?.point_count) || 0;
  clusterMeta.value = {
    id: feature.id,
    total: pointCount,
    title: '',
    lat,
    lng,
  };
  clusterPhotos.value = [];
  clusterLeafOffset.value = 0;
  clusterHasMore.value = false;
  clusterError.value = '';
  clusterModalOpen.value = true;
  loadClusterPhotos(true);
}

async function loadClusterPhotos(reset = false) {
  if (!photoAlbum.value || !clusterIndex.value || !clusterMeta.value.id) {
    return;
  }
  if (clusterLoading.value) {
    return;
  }
  clusterLoading.value = true;
  clusterError.value = '';
  try {
    if (reset) {
      clusterLeafOffset.value = 0;
      clusterPhotos.value = [];
    }
    const offset = clusterLeafOffset.value;
    const leaves = clusterIndex.value.getLeaves(
      clusterMeta.value.id,
      CLUSTER_PAGE_SIZE,
      offset,
    );
    const ids = Array.isArray(leaves)
      ? leaves
          .map((leaf) => leaf?.properties?.id)
          .filter((value) => value != null)
      : [];
    clusterLeafOffset.value = offset + (Array.isArray(leaves) ? leaves.length : 0);
    const totalPoints = clusterMeta.value.total || clusterLeafOffset.value;
    clusterHasMore.value = clusterLeafOffset.value < totalPoints;
    if (!ids.length) {
      return;
    }
    const response = await photoAlbum.value.fetchPhotos({ ids });
    const collection = Array.isArray(response?.items)
      ? response.items
      : Array.isArray(response?.photos)
        ? response.photos
        : Array.isArray(response)
          ? response
          : [];
    const normalizedMap = new Map();
    collection.forEach((record) => {
      const normalized = normalizePhotoFromServer(record);
      if (normalized) {
        normalizedMap.set(normalized.id, normalized);
      }
    });
    const ordered = ids
      .map((id) => {
        const normalized = normalizedMap.get(id);
        if (!normalized) {
          return null;
        }
        return {
          ...normalized,
          tags: Array.isArray(normalized.tags) ? [...normalized.tags] : [],
        };
      })
      .filter(Boolean);
    clusterPhotos.value = reset ? ordered : [...clusterPhotos.value, ...ordered];
  } catch (error) {
    console.error('[Map] Failed to load cluster photos', error);
    clusterError.value = error?.message || 'Unable to load photos for this area.';
  } finally {
    clusterLoading.value = false;
  }
}

function handleClusterLoadMore() {
  if (!clusterHasMore.value || clusterLoading.value) {
    return;
  }
  loadClusterPhotos(false);
}

function handleClusterPhotoSelected(photo) {
  if (!photo) {
    return;
  }
  selectedPhoto.value = {
    ...photo,
    tags: Array.isArray(photo.tags) ? [...photo.tags] : [],
  };
  photoViewerContext.value = 'cluster';
  photoModalOpen.value = true;
}

function closeClusterModal() {
  clusterModalOpen.value = false;
}

function applyClusterPhotoPatch(photoId, patch = {}) {
  if (!photoId || !clusterPhotos.value.length) {
    return;
  }
  clusterPhotos.value = clusterPhotos.value.map((item) => {
    if (item.id !== photoId) {
      return item;
    }
    return {
      ...item,
      ...patch,
    };
  });
}

async function openPhotoFromMarker(photoId) {
  if (!photoAlbum.value || !photoId) {
    return;
  }
  const requestId = ++pendingPhotoRequestId;
  try {
    const response = await photoAlbum.value.fetchPhotos({
      ids: [photoId],
      limit: 1,
    });
    const collection = Array.isArray(response?.items)
      ? response.items
      : Array.isArray(response?.photos)
        ? response.photos
        : Array.isArray(response)
          ? response
          : [];
    const record = collection[0];
    if (!record || requestId !== pendingPhotoRequestId) {
      return;
    }
    const normalized = normalizePhotoFromServer(record);
    if (!normalized) {
      return;
    }
    selectedPhoto.value = {
      ...normalized,
      tags: Array.isArray(normalized.tags) ? [...normalized.tags] : [],
    };
    photoViewerContext.value = 'single';
    photoModalOpen.value = true;
  } catch (error) {
    if (requestId === pendingPhotoRequestId) {
      console.error('[Map] Failed to open photo viewer', error);
    }
  }
}

function handlePhotoDetailsSaved(payload) {
  if (!payload || !payload.id || !selectedPhoto.value || payload.id !== selectedPhoto.value.id) {
    return;
  }
  const updatedTags = coerceTagsArray(payload.tags);
  const description =
    typeof payload.description === 'string'
      ? payload.description.trim() || null
      : payload.description ?? null;
  const nextRating =
    Object.prototype.hasOwnProperty.call(payload, 'rating')
      ? normalizeRatingValue(payload.rating)
      : selectedPhoto.value.rating;
  selectedPhoto.value = {
    ...selectedPhoto.value,
    description,
    tags: updatedTags,
    rating: nextRating,
  };
  if (photoViewerContext.value === 'cluster') {
    applyClusterPhotoPatch(payload.id, {
      description,
      tags: updatedTags,
      rating: nextRating,
    });
  }
}

function handleNavigatePhoto(nextPhoto) {
  if (!nextPhoto || !nextPhoto.id || nextPhoto.id === selectedPhoto.value?.id) {
    return;
  }
  if (photoViewerContext.value === 'cluster') {
    const match = clusterPhotos.value.find((photo) => photo.id === nextPhoto.id);
    if (match) {
      selectedPhoto.value = {
        ...match,
        tags: Array.isArray(match.tags) ? [...match.tags] : [],
      };
      return;
    }
  }
  openPhotoFromMarker(nextPhoto.id);
}

function getClusterSize(count) {
  if (count < 10) return 32;
  if (count < 50) return 40;
  if (count < 200) return 48;
  if (count < 1000) return 56;
  return 72;
}

function getClusterColor(count) {
  if (count < 10) return 'rgba(0, 201, 81, 0.65)'; // Green
  if (count < 50) return 'rgba(234, 179, 8, 0.75)'; // Yellow
  if (count < 200) return 'rgba(249, 115, 22, 0.75)'; // Orange
  if (count < 1000) return 'rgba(239, 68, 68, 0.75)'; // Red
  return 'rgba(236, 72, 153, 0.75)'; // Pink
}

function formatClusterCount(count) {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
  }
  return count;
}
</script>

<style scoped>
.map-page-root {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: #fafafa;
  --map-header-height: 90px;
  --mac-traffic-offset: 0px;
}

.map-page-root.is-mac-layout {
  --mac-traffic-offset: 70px;
}

.app-header {
  flex: 0 0 auto;
  position: relative;
  z-index: 50;
  /* White frosted glass background - more opaque for lighter appearance */
  background: rgba(255, 255, 255, 0.85);
  /* Strong blur for frosted glass effect */
  backdrop-filter: blur(12px) saturate(180%);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  border-bottom: 1px solid rgba(229, 231, 235, 0.5);
  -webkit-app-region: no-drag;
}

.app-header::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 18px;
  pointer-events: none;
  -webkit-app-region: drag;
}

.app-header-container {
  max-width: 1920px;
  margin: 0 auto;
  padding: 1.25rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
      padding-left: calc(1.5rem + var(--mac-traffic-offset));

}

.map-header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.map-title-block {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;

}

.map-title-label {
  font-size: 1.1rem;
  font-weight: 600;
  color: #111827;
}

.map-title-subtitle {
  font-size: 0.85rem;
  color: #6b7280;
}

.map-header-actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.map-page-main {
  flex: 1;
  overflow-y: auto;
  background: #fafafa;
  padding: 1.5rem 1.5rem 1.5rem;
}

.map-stage {
  position: relative;
  flex: 1;
  min-height: calc(100vh - var(--map-header-height) - 3rem);
  height: calc(100vh - var(--map-header-height) - 3rem);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
  background: #ffffff;
}

.map-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.map-loading {
  position: absolute;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 999px;
  padding: 0.5rem 1rem;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
  font-size: 0.875rem;
  color: #374151;
}

.map-loading .spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.map-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2rem;
  background: #ffffff;
  color: #6b7280;
  font-size: 0.875rem;
}


.map-footer-overlay {
  position: absolute;
  left: 50%;
  bottom: 1.5rem;
  transform: translateX(-50%);
  width: min(950px, calc(100% - 2rem));
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-radius: 8px;
  padding: 0.875rem 1.25rem;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
  gap: 1rem;
}

.map-footer-stat {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
  color: #111827;
  font-size: 0.875rem;
}

.map-footer-hint {
  font-size: 0.875rem;
  color: #6b7280;
  margin: 0;
}

:global(.photo-pin-container) {
  background: transparent;
  border: none;
}

:global(.photo-map-pin) {
  width: 100%;
  height: 100%;
  border-radius: 9999px;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  background: rgba(0, 201, 81, 0.65);
  background-size: cover;
  background-position: center;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  border: 1px solid rgba(255, 255, 255, 0.3);
  box-shadow: 0 4px 15px rgba(0, 201, 81, 0.25);
    
}

:global(.photo-pin-container:hover .photo-map-pin) {
  transform: scale(1.2);
    box-shadow: 0 8px 25px rgba(0, 201, 81, 0.4);
  border-color: rgba(255, 255, 255, 0.6);
}

:global(.photo-cluster-icon) {
  border: none;
  background: transparent;
}

:global(.photo-cluster) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 9999px;
  background: var(--cluster-bg, rgba(0, 201, 81, 0.65));
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  color: white;
  font-weight: 600;
  font-size: 0.9rem;
  border: 1px solid rgba(255, 255, 255, 0.3);
  box-shadow: 0 4px 15px var(--cluster-shadow, rgba(0, 201, 81, 0.25));
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

:global(.photo-cluster:hover) {
  transform: scale(1.2);
  background: var(--cluster-bg-hover, rgba(0, 201, 81, 0.85));
  box-shadow: 0 8px 25px var(--cluster-shadow-hover, rgba(0, 201, 81, 0.4));
  border-color: rgba(255, 255, 255, 0.6);
}

:global(.photo-pin-fallback) {
  background: transparent;
  border: none;
}

:global(.photo-pin-placeholder) {
  width: 52px;
  height: 52px;
  border-radius: 9999px;
  background: radial-gradient(circle at 30% 30%, #f87171, #db2777);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  box-shadow: 0 4px 15px rgba(0, 201, 81, 0.25);
    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

:global(.photo-pin-fallback:hover .photo-pin-placeholder) {
  transform: scale(1.2);
  box-shadow: 0 8px 25px rgba(0, 201, 81, 0.4);
  border-color: rgba(255, 255, 255, 0.6);
}

.cluster-modal-panel {
  width: min(1100px, calc(100vw - 5rem));
  max-height: 85vh;
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
  border: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  margin: auto;
}

.cluster-modal-header {
  padding: 1.5rem;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  background: #fafafa;
}

.cluster-modal-close {
  border: none;
  background: #f3f4f6;
  width: 36px;
  height: 36px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.15s ease;
}

.cluster-modal-close:hover {
  background: #e5e7eb;
  color: #111827;
}

.cluster-modal-label {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6b7280;
  margin-bottom: 0.15rem;
}

.cluster-modal-title {
  font-size: 1.35rem;
  font-weight: 600;
  margin: 0;
  color: #111827;
}

.cluster-modal-subtitle {
  margin: 0.15rem 0 0;
  color: #6b7280;
  font-size: 0.9rem;
}

.cluster-modal-body {
  padding: 1rem 1.5rem 1.5rem;
  overflow-y: auto;
}

.cluster-modal-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  padding: 0.75rem 1rem;
  border-radius: 6px;
  font-size: 0.875rem;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.window-no-drag,
.window-no-drag * {
  -webkit-app-region: no-drag;
}

@media (max-width: 768px) {
  .app-header-container {
    flex-wrap: wrap;
  }

  .map-header-left {
    width: 100%;
  }

  .map-page-main {
    padding: 1rem;
  }

  .map-footer-overlay {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
