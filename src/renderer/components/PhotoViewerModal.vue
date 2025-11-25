<template>
  <UModal v-model:open="isOpen" fullscreen :ui="{ body: 'h-full p-0' }">
    <template #content>
    <div v-if="photo" class="h-full flex">
      <!-- Left side: Photo -->
      <div class="flex-1 bg-black flex items-center justify-center relative overflow-hidden">
        <button
          type="button"
          class="modal-icon-button absolute top-14 left-4 z-10"
          @click="closeModal"
        >
          <UIcon name="i-heroicons-arrow-left" class="w-6 h-6 text-white" />
        </button>

        <!-- Navigation arrows -->
        <button
          v-if="canGoPrevious"
          type="button"
          class="nav-arrow nav-arrow-left"
          @click="navigatePrevious"
          title="Previous photo (←)"
        >
          <UIcon name="i-heroicons-chevron-left" class="w-8 h-8 text-white" />
        </button>
        <button
          v-if="canGoNext"
          type="button"
          class="nav-arrow nav-arrow-right"
          @click="navigateNext"
          title="Next photo (→)"
        >
          <UIcon name="i-heroicons-chevron-right" class="w-8 h-8 text-white" />
        </button>

        <!-- Zoom controls -->
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-gray-900/80 rounded-full px-3 py-2">
          <button type="button" class="modal-icon-button p-1" @click="zoomOut">
            <UIcon name="i-heroicons-minus" class="w-4 h-4 text-white" />
          </button>
          <span class="text-white text-sm min-w-[3rem] text-center">{{ Math.round(imageZoom * 100) }}%</span>
          <button type="button" class="modal-icon-button p-1" @click="zoomIn">
            <UIcon name="i-heroicons-plus" class="w-4 h-4 text-white" />
          </button>
          <button
            v-if="imageZoom !== 1"
            type="button"
            class="modal-icon-button p-1 ml-1"
            @click="resetZoom"
          >
            <UIcon name="i-heroicons-arrow-path" class="w-4 h-4 text-white" />
          </button>
        </div>

        <!-- Toggle info button (when panel is hidden) -->
        <button
          v-if="!showInfoPanel"
          type="button"
          class="modal-icon-button absolute top-14 right-4 z-10"
          @click="toggleInfoPanel"
        >
          <UIcon name="i-heroicons-information-circle" class="w-6 h-6 text-white" />
        </button>

        <div
          ref="photoZoomContainerRef"
          class="photo-zoom-container w-full h-full flex items-center justify-center p-8"
          @wheel.prevent="handleWheelZoom"
          @pointerdown="startImagePan"
          @pointermove="handleImagePan"
          @pointerup="endImagePan"
          @pointerleave="endImagePan"
          @pointercancel="endImagePan"
        >
          <img
            v-if="imageUrl"
            ref="photoZoomImageRef"
            :src="imageUrl"
            :alt="photo.fileName"
            draggable="false"
            :style="imageTransformStyles"
            class="max-w-full max-h-full object-contain transition-transform duration-200 select-none"
          />
          <div v-else class="text-white text-lg">
            No preview available
          </div>
        </div>
      </div>

      <!-- Right side: EXIF Info Panel -->
      <transition
        name="photo-info-panel"
        @before-enter="infoPanelTransition.beforeEnter"
        @enter="infoPanelTransition.enter"
        @after-enter="infoPanelTransition.afterEnter"
        @before-leave="infoPanelTransition.beforeLeave"
        @leave="infoPanelTransition.leave"
        @after-leave="infoPanelTransition.afterLeave"
      >
        <div 
          v-show="showInfoPanel" 
          class="w-80 bg-white overflow-y-auto flex flex-col border-l border-gray-200"
          @click.stop
        >
          <!-- Header -->
          <div class="p-4 border-b border-gray-200">
            <button
              type="button"
              class="modal-icon-button float-right"
              @click="toggleInfoPanel"
            >
              <UIcon name="i-heroicons-x-mark" class="w-5 h-5 text-gray-700" />
            </button>
            <h2 class="text-lg font-semibold text-gray-900">Info</h2>
          </div>

          <!-- Details editor -->
          <div class="p-4 border-b border-gray-200 space-y-4 details-editor">
            <UFormField label="Description">
              <UTextarea
                v-model="detailsForm.description"
                rows="3"
                placeholder="Add a short note..."
                variant="outline"
                class="w-full"
                :ui="{ color: { gray: { outline: 'bg-white' } } }"
                @blur="saveDetails"
                @keydown.meta.enter="saveDetails"
              />
            </UFormField>

            <div v-if="aiKeywords.length" class="space-y-2">
              <div class="flex items-start gap-2">
                <UIcon name="i-heroicons-sparkles" class="w-4 h-4 text-gray-600 mt-0.5" />
                <div class="flex-1">
                  <div class="ai-keyword-list">
                    <span
                      v-for="(keyword, index) in aiKeywords"
                      :key="`ai-keyword-${keyword.label}-${index}`"
                      class="ai-keyword-chip"
                    >
                      {{ keyword.label }}
                      <span class="ai-keyword-score">{{ formatKeywordScore(keyword.score) }}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Details Section -->
          <div class="p-4 space-y-4 flex-1">
            <!-- Date/Time -->
            <div class="space-y-1">
              <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Details</h3>
              <div class="flex items-start gap-2">
                <UIcon name="i-heroicons-calendar" class="w-4 h-4 text-gray-600 mt-0.5" />
                <div class="flex-1">
                  <p class="text-sm text-gray-900">{{ formatDateOnly(photo.shootDateTime) }}</p>
                  <p class="text-xs text-gray-600">{{ formatTimeOnly(photo.shootDateTime) }}</p>
                </div>
              </div>
            </div>

            <!-- File Info -->
            <div class="space-y-1">
              <div class="flex items-start gap-2">
                <UIcon name="i-heroicons-photo" class="w-4 h-4 text-gray-600 mt-0.5" />
                <div class="flex-1">
                  <p class="text-sm text-gray-900">{{ photo.fileName }}</p>
                  <p class="text-xs text-gray-600">{{ formatFileSize(photo) }}</p>
                </div>
              </div>
            </div>

            <!-- Camera Info -->
            <div class="space-y-1">
              <div class="flex items-start gap-2">
                <UIcon name="i-heroicons-camera" class="w-4 h-4 text-gray-600 mt-0.5" />
                <div class="flex-1">
                  <p class="text-sm text-gray-900 font-medium">{{ formatCamera(photo) }}</p>
                  <div class="text-xs text-gray-600 space-y-0.5 mt-1">
                    <p>{{ formatExposureSettings(photo) }}</p>
                    <p>{{ formatIsoFocal(photo) }}</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Lens -->
            <div v-if="photo.lensModel" class="space-y-1">
              <div class="flex items-start gap-2">
                <UIcon name="i-heroicons-eye" class="w-4 h-4 text-gray-600 mt-0.5" />
                <div class="flex-1">
                  <p class="text-sm text-gray-900">{{ photo.lensModel }}</p>
                </div>
              </div>
            </div>

            <!-- Location (if available) -->
            <div v-if="photoLocation" class="space-y-2">
              <div class="flex items-start gap-2">
                <UIcon name="i-heroicons-map-pin" class="w-4 h-4 text-gray-600 mt-0.5" />
                <div class="flex-1">
                  <p class="text-sm text-gray-900">
                    {{ photoLocation.city || photo.locationLabel || photoLocation.label }}
                  </p>
                  <p class="text-xs text-gray-600">{{ photoLocation.coordinates }}</p>
                  <p v-if="photoLocation.timezone" class="text-xs text-gray-500">
                    {{ photoLocation.timezone }}
                  </p>
                </div>
              </div>
              <div v-if="photoLocation.mapUrl" class="photo-map" @click="openMapPage">
                <div ref="mapContainer" class="photo-map-preview"></div>
              </div>
            </div>

            <!-- Album -->
            <div v-if="albums && albums.length > 0" class="space-y-3">
              <div v-for="album in albums" :key="album.id" class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-md overflow-hidden bg-gray-100 shrink-0 border border-gray-200">
                   <img v-if="getAlbumCover(album)" :src="getAlbumCover(album)" :alt="album.name" class="w-full h-full object-cover" />
                   <div v-else class="w-full h-full flex items-center justify-center text-gray-400">
                     <UIcon name="i-heroicons-folder" class="w-5 h-5" />
                   </div>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-sm text-gray-900 font-medium truncate">{{ album.name }}</p>
                  <p class="text-xs text-gray-500">Album</p>
                </div>
              </div>
            </div>

            <!-- Tags -->
            <div class="space-y-3 pt-2 border-t border-gray-100">
              <UFormField label="Tags">
                <div class="tag-editor">
                  <div
                    v-for="(tag, index) in detailsForm.tags"
                    :key="`${tag}-${index}`"
                    class="tag-chip"
                  >
                    <span>{{ tag }}</span>
                    <button
                      type="button"
                      class="tag-chip-remove"
                      :aria-label="`Remove tag ${tag}`"
                      @click.stop="handleRemoveTag(index)"
                    >
                      <UIcon name="i-heroicons-x-mark" class="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input
                    v-model="detailsForm.newTag"
                    type="text"
                    class="tag-input-field"
                    placeholder="Add tag"
                    @keydown="handleTagInputKeydownWrapper"
                    @blur="handleCommitTag"
                  />
                </div>
              </UFormField>
            </div>
            
          </div>

          <!-- Actions -->
          <div class="p-4 border-t border-gray-200 space-y-2">
            <UButton
              v-if="photo.rawFilePath"
              block
              color="primary"
              variant="soft"
              icon="i-heroicons-photo"
              class="cursor-pointer"
              @click="openRawFile"
            >
              Open RAW in Photoshop
            </UButton>
            <UButton
              block
              color="gray"
              variant="soft"
              icon="i-heroicons-arrow-top-right-on-square"
              class="cursor-pointer"
              @click="openOriginalFile"
            >
              Open in Preview
            </UButton>
            <UButton
              block
              color="gray"
              variant="soft"
              icon="i-heroicons-clipboard"
              class="cursor-pointer"
              :disabled="!imageUrl || copyingImage"
              @click="copyImageToClipboard"
            >
              Copy Image
            </UButton>
            <p v-if="copyFeedback" class="copy-feedback">{{ copyFeedback }}</p>
          </div>
        </div>
      </transition>
    </div>
    <div v-else class="h-full flex items-center justify-center text-gray-500">
      Select a photo to view its details.
    </div>
    </template>
  </UModal>
</template>

<script setup>
import { createCollapseTransition } from '../utils/collapseTransition';
import { usePhotoFormatter } from '../composables/usePhotoFormatter';
import { usePhotoZoom } from '../composables/usePhotoZoom';
import { usePhotoDetails } from '../composables/usePhotoDetails';
import { usePhotoLocation } from '../composables/usePhotoLocation';
import 'leaflet/dist/leaflet.css';

const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true,
  },
  photo: {
    type: Object,
    default: null,
  },
  photos: {
    type: Array,
    default: () => [],
  },
  albums: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(['update:modelValue', 'details-saved', 'navigate-photo']);

const nuxtApp = useNuxtApp();
const photoAlbumBridge = computed(() => nuxtApp.$photoAlbum || null);

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

// Photo formatter composable
const {
  formatDateOnly,
  formatTimeOnly,
  formatFileSize,
  formatCamera,
  formatExposureSettings,
  formatIsoFocal,
  getThumbnailUrl,
  getFullImageUrl,
  toFileUrl,
} = usePhotoFormatter();

// Photo zoom composable
const {
  imageZoom,
  imagePan,
  imageTransformStyles,
  photoZoomContainerRef,
  photoZoomImageRef,
  zoomIn,
  zoomOut,
  resetZoom: resetZoomState,
  handleWheelZoom,
  startImagePan,
  handleImagePan,
  endImagePan,
} = usePhotoZoom();

// Photo details composable
const {
  detailsForm,
  isSaving,
  canSaveDetails,
  syncDetailsForm,
  saveDetails: savePhotoDetails,
  removeTagAt,
  commitTagInput,
  handleTagInputKeydown,
} = usePhotoDetails();

// Photo location composable
const { getPhotoLocation } = usePhotoLocation();

const router = useRouter();
const mapContainer = ref(null);
const mapInstance = shallowRef(null);
const markerLayer = shallowRef(null);
let Leaflet = null;

async function ensureLeaflet() {
  if (Leaflet) return Leaflet;
  const module = await import('leaflet');
  Leaflet = module.default;
  return Leaflet;
}

async function initMap() {
  if (!mapContainer.value || mapInstance.value) return;
  const L = await ensureLeaflet();

  mapInstance.value = L.map(mapContainer.value, {
    center: [0, 0],
    zoom: 14,
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    touchZoom: false,
    doubleClickZoom: false,
    scrollWheelZoom: false,
    boxZoom: false,
    keyboard: false,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(mapInstance.value);

  markerLayer.value = L.layerGroup().addTo(mapInstance.value);

  updateMapLocation();
}

function updateMapLocation() {
  if (!mapInstance.value || !photoLocation.value || !Leaflet) return;

  const { lat, lng } = photoLocation.value;
  mapInstance.value.setView([lat, lng], 14);

  markerLayer.value.clearLayers();

  const imageSource = getThumbnailUrl(props.photo);
  const icon = Leaflet.divIcon({
    html: `<div class="photo-map-pin" style="background-image: url('${imageSource}')"></div>`,
    className: 'photo-pin-container',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });

  Leaflet.marker([lat, lng], { icon }).addTo(markerLayer.value);
}

function openMapPage() {
  if (photoLocation.value) {
    router.push({
      path: '/map',
      query: {
        lat: photoLocation.value.lat,
        lng: photoLocation.value.lng,
        id: props.photo.id,
        zoom: 16
      }
    });
  } else {
    router.push('/map');
  }
  closeModal();
}

const showInfoPanel = ref(true);
const infoPanelTransition = createCollapseTransition({
  duration: 280,
  opacityDuration: 220,
  axis: 'width',
  lockFlex: true,
});

const imageUrl = computed(() => {
  if (!props.photo) {
    return null;
  }
  return getFullImageUrl(props.photo) || getThumbnailUrl(props.photo);
});

const photoLocation = computed(() => {
  if (!props.photo) {
    return null;
  }
  return getPhotoLocation(props.photo);
});

const aiKeywords = computed(() => {
  if (!props.photo || !Array.isArray(props.photo.aiLabels)) {
    return [];
  }
  return props.photo.aiLabels
    .map((entry) => ({
      label: typeof entry.label === 'string' ? entry.label : '',
      score: Number(entry.score),
    }))
    .filter((entry) => entry.label && Number.isFinite(entry.score));
});

const ratingStars = [1, 2, 3, 4, 5];

const copyingImage = ref(false);
const copyFeedback = ref('');
let copyFeedbackTimer = null;

const currentPhotoIndex = computed(() => {
  if (!props.photo || !props.photos.length) {
    return -1;
  }
  return props.photos.findIndex(p => p.id === props.photo.id);
});

const canGoPrevious = computed(() => {
  return currentPhotoIndex.value > 0;
});

const canGoNext = computed(() => {
  return currentPhotoIndex.value >= 0 && currentPhotoIndex.value < props.photos.length - 1;
});

function navigatePrevious() {
  if (!canGoPrevious.value) {
    return;
  }
  const prevPhoto = props.photos[currentPhotoIndex.value - 1];
  emit('navigate-photo', prevPhoto);
}

function navigateNext() {
  if (!canGoNext.value) {
    return;
  }
  const nextPhoto = props.photos[currentPhotoIndex.value + 1];
  emit('navigate-photo', nextPhoto);
}

function handleKeydown(event) {
  if (!isOpen.value) {
    return;
  }

  // Ignore navigation shortcuts if user is typing in an input
  const target = event.target;
  const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
  if (isInput) {
    if (event.key === 'Escape') {
      target.blur();
    }
    return;
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    navigatePrevious();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    navigateNext();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeModal();
  }
}

function toggleInfoPanel() {
  showInfoPanel.value = !showInfoPanel.value;
}

function resetZoom() {
  resetZoomState();
}

function formatKeywordScore(score) {
  if (!Number.isFinite(score)) {
    return '';
  }
  return `${Math.round(score * 100)}%`;
}

function getAlbumCover(album) {
  if (!album || !Array.isArray(album.photos) || !album.photos.length) {
    return null;
  }
  const cover = album.photos.find((photo) => photo.id === album.coverPhotoId) || album.photos[0];
  return getThumbnailUrl(cover);
}

function handleRemoveTag(index) {
  removeTagAt(index);
  saveDetails();
}

function handleCommitTag() {
  commitTagInput();
  saveDetails();
}

function handleTagInputKeydownWrapper(event) {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    handleCommitTag();
    return;
  }
  handleTagInputKeydown(event);
  if (event.key === 'Backspace' && !detailsForm.newTag) {
    // If backspace removed a tag, save
    saveDetails();
  }
}

function closeModal() {
  isOpen.value = false;
  if (copyFeedbackTimer) {
    clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = null;
  }
  copyFeedback.value = '';
  copyingImage.value = false;
}

function showCopyFeedback(message) {
  copyFeedback.value = message;
  if (copyFeedbackTimer) {
    clearTimeout(copyFeedbackTimer);
  }
  copyFeedbackTimer = setTimeout(() => {
    copyFeedback.value = '';
    copyFeedbackTimer = null;
  }, 2200);
}

async function copyImageToClipboard() {
  if (!imageUrl.value) {
    return;
  }
  copyingImage.value = true;
  try {
    const photoBridge = photoAlbumBridge.value;
    const sourcePath = props.photo?.filePath || props.photo?.rawFilePath || null;
    if (photoBridge?.copyImageToClipboard && sourcePath) {
      await photoBridge.copyImageToClipboard(sourcePath);
      showCopyFeedback('Image copied');
      return;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.clipboard ||
      typeof ClipboardItem === 'undefined'
    ) {
      showCopyFeedback('Clipboard unavailable');
      return;
    }

    const response = await fetch(imageUrl.value);
    const blob = await response.blob();
    const mimeType = blob.type || 'image/png';
    const item = new ClipboardItem({ [mimeType]: blob });
    await navigator.clipboard.write([item]);
    
    showCopyFeedback('Image copied');
  } catch (error) {
    console.error('[PhotoViewerModal] Failed to copy image', error);
    showCopyFeedback('Copy failed');
  } finally {
    copyingImage.value = false;
  }
}

async function saveDetails() {
  if (!props.photo) {
    return;
  }
  try {
    await savePhotoDetails(props.photo);
    emit('details-saved', {
      id: props.photo.id,
      description: detailsForm.description.trim() || null,
      tags: [...detailsForm.tags],
      rating: detailsForm.rating ?? null,
    });
  } catch (error) {
    console.error('[PhotoViewerModal] Failed to save details', error);
  }
}

function openOriginalFile() {
  if (!props.photo) {
    return;
  }
  const url = getFullImageUrl(props.photo);
  if (url) {
    window.open(url, '_blank');
  }
}

async function openRawFile() {
  if (!props.photo || !props.photo.rawFilePath) {
    return;
  }
  const url = toFileUrl(props.photo.rawFilePath);
  if (url) {
    if (photoAlbumBridge.value) {
      await photoAlbumBridge.value.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  }
}

watch(
  () => props.photo,
  (photo) => {
    syncDetailsForm(photo);
  },
  { immediate: true },
);

watch(
  [() => photoLocation.value, showInfoPanel],
  async ([loc, show]) => {
    if (loc && show) {
      await nextTick();
      if (!mapInstance.value) {
        await initMap();
      } else {
        mapInstance.value.invalidateSize();
        updateMapLocation();
      }
    }
  },
  { immediate: true }
);

watch(isOpen, (open) => {
  if (!open) {
    showInfoPanel.value = true;
    resetZoomState();
  }
});

watch(
  () => props.photo,
  () => {
    if (props.photo) {
      resetZoomState();
    }
  },
);

watch(isOpen, (open) => {
  if (open) {
    window.addEventListener('keydown', handleKeydown);
  } else {
    window.removeEventListener('keydown', handleKeydown);
  }
});

onBeforeUnmount(() => {
  if (mapInstance.value) {
    mapInstance.value.remove();
  }
  if (copyFeedbackTimer) {
    clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = null;
  }
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<style scoped>
.modal-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  border-radius: 9999px;
  transition: background-color 0.2s ease;
  cursor: pointer;
  background: transparent;
  border: none;
}

.modal-icon-button:hover {
  background-color: rgba(0, 0, 0, 0.05);
}

.bg-black .modal-icon-button:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.photo-zoom-container {
  touch-action: none;
}

.photo-zoom-container img {
  transform-origin: center center;
}

.tag-editor {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 10px;
  background-color: #fff;
  min-height: 42px;
}

.tag-editor:focus-within {
  border-color: rgba(79, 70, 229, 0.4);
  box-shadow: 0 0 0 1px rgba(79, 70, 229, 0.25);
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background-color: rgba(79, 70, 229, 0.12);
  color: #312e81;
  border-radius: 9999px;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 500;
}

.tag-chip-remove {
  border: none;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  color: inherit;
}

.tag-chip-remove:hover {
  color: #1e1b4b;
}

.tag-input-field {
  flex: 1;
  min-width: 140px;
  border: none;
  background: transparent;
  outline: none;
  font-size: 14px;
  color: #0f172a;
}

.tag-input-field::placeholder {
  color: rgba(15, 23, 42, 0.4);
}

.ai-keyword-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ai-keyword-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 9999px;
  background-color: rgba(14, 165, 233, 0.16);
  color: #0369a1;
  font-size: 12px;
  font-weight: 500;
}

.ai-keyword-score {
  font-size: 11px;
  opacity: 0.8;
}

.photo-map {
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.08);
  height: 180px;
  cursor: pointer;
  position: relative;
  z-index: 0;
}

.photo-map-preview {
  width: 100%;
  height: 100%;
}

:deep(.photo-pin-container) {
  background: transparent;
  border: none;
}

:deep(.photo-map-pin) {
  width: 100%;
  height: 100%;
  border-radius: 9999px;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  background: rgba(0, 201, 81, 0.65);
  background-size: cover;
  background-position: center;
  border: 1px solid rgba(255, 255, 255, 0.3);
  box-shadow: 0 4px 15px rgba(0, 201, 81, 0.25);
}

.rating-control {
  display: flex;
  align-items: center;
  gap: 6px;
}

.rating-star {
  border: none;
  background: transparent;
  padding: 2px;
  display: inline-flex;
  cursor: pointer;
  color: #cbd5f5;
}

.rating-star-active {
  color: #fbbf24;
}

.rating-value {
  font-size: 0.85rem;
  color: #475569;
  margin-left: 6px;
}

.rating-clear {
  border: none;
  background: transparent;
  color: #64748b;
  font-size: 0.75rem;
  cursor: pointer;
}

.copy-feedback {
  font-size: 0.75rem;
  color: #475569;
  text-align: center;
}

.nav-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.5);
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.nav-arrow:hover {
  background: rgba(0, 0, 0, 0.75);
  transform: translateY(-50%) scale(1.1);
}

.nav-arrow-left {
  left: 1rem;
}

.nav-arrow-right {
  right: 1rem;
}
</style>
