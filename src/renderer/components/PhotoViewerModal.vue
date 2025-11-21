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
        <div v-show="showInfoPanel" class="w-80 bg-white overflow-y-auto flex flex-col border-l border-gray-200">
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
          <div class="p-4 border-b border-gray-200 space-y-5 details-editor">
            <UFormField label="Description">
              <UTextarea
                v-model="detailsForm.description"
                rows="3"
                placeholder="Add a short note about this photo"
              />
            </UFormField>
            <UFormField label="Tags" description="Type a tag and press Enter">
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
                    @click="removeTagAt(index)"
                  >
                    <UIcon name="i-heroicons-x-mark" class="w-3.5 h-3.5" />
                  </button>
                </div>
                <input
                  v-model="detailsForm.newTag"
                  type="text"
                  class="tag-input-field"
                  placeholder="Add tag"
                  @keydown="handleTagInputKeydown"
                  @blur="commitTagInput"
                />
              </div>
            </UFormField>
            <!-- AI Keywords -->
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
                  <p class="text-xs text-gray-500 mt-2">
                    Auto-tagged with OpenAI CLIP.
                  </p>
                </div>
              </div>
            </div>
            <UFormField label="Rating" description="Click to rate from 1-5">
              <div class="rating-control">
                <button
                  v-for="star in ratingStars"
                  :key="star"
                  type="button"
                  class="rating-star"
                  :class="{ 'rating-star-active': star <= (detailsForm.rating || 0) }"
                  @click="setRating(star)"
                >
                  <UIcon
                    :name="star <= (detailsForm.rating || 0) ? 'i-heroicons-star-solid' : 'i-heroicons-star'"
                    class="w-5 h-5"
                  />
                </button>
                <span class="rating-value">
                  {{ ratingLabel }}
                </span>
                <button
                  v-if="detailsForm.rating"
                  type="button"
                  class="rating-clear"
                  @click="clearRating"
                >
                  Clear
                </button>
              </div>
            </UFormField>
            <div class="flex items-center justify-end gap-2 pt-2">
              <UButton
                size="sm"
                color="primary"
                :disabled="!canSaveDetails"
                :loading="isSaving"
                icon="i-heroicons-check"
                @click="saveDetails"
              >
                Save Details
              </UButton>
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
              <div v-if="photoLocation.mapUrl" class="photo-map">
                <iframe
                  :src="photoLocation.mapUrl"
                  title="Photo location map"
                  loading="lazy"
                  referrerpolicy="no-referrer"
                ></iframe>
              </div>
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
const ratingLabel = computed(() => {
  if (!detailsForm.rating) {
    return 'Not rated';
  }
  return `${detailsForm.rating} / 5`;
});

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

function closeModal() {
  isOpen.value = false;
  if (copyFeedbackTimer) {
    clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = null;
  }
  copyFeedback.value = '';
  copyingImage.value = false;
}

function setRating(value) {
  if (!value || value < 1 || value > 5) {
    detailsForm.rating = null;
    return;
  }
  detailsForm.rating = detailsForm.rating === value ? null : value;
}

function clearRating() {
  detailsForm.rating = null;
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

function openRawFile() {
  if (!props.photo || !props.photo.rawFilePath) {
    return;
  }
  const url = toFileUrl(props.photo.rawFilePath);
  if (url) {
    window.open(url, '_blank');
  }
}

watch(
  () => props.photo,
  (photo) => {
    syncDetailsForm(photo);
  },
  { immediate: true },
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
}

.photo-map iframe {
  width: 100%;
  height: 100%;
  border: 0;
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
