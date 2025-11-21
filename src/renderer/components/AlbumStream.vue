<template>
  <div class="album-stream">
      <div v-if="loading" class="loading-overlay">
        <div class="loading-backdrop"></div>
        <div class="loading-pill">
          <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin" />
        </div>
      </div>

    <div
      v-if="!sections.length && !loading"
      class="album-stream-empty"
    >
      <slot name="empty">
        <p>{{ emptyMessage }}</p>
      </slot>
    </div>

    <div
      v-for="section in sections"
      :key="section.key"
      class="album-section"
      :data-section-key="section.key"
      :ref="(el) => setSectionRef(section.key, el)"
    >
      <div class="album-section-header">
        <div>
          <p class="album-section-title">{{ section.label }}</p>
          <p class="album-section-subtitle">{{ section.photos.length }} photo<span v-if="section.photos.length !== 1">s</span></p>
        </div>
      </div>
      <div class="album-photo-grid">
        <button
          v-for="photo in section.photos"
          :key="photo.id"
          type="button"
          class="album-photo-card"
          @click="$emit('select-photo', photo)"
        >
          <div class="album-photo-thumb">
            <img
              v-if="getThumbnailSrc(photo)"
              :src="getThumbnailSrc(photo)"
              :alt="photo.fileName"
              loading="lazy"
            />
            <div v-else class="album-photo-placeholder">
              <span>No thumbnail</span>
            </div>
            <span
              v-if="getPhotoBadgeLabel(photo)"
              class="album-photo-badge"
              :class="{ 'album-photo-badge-unavailable': isUnavailableBadge(photo) }"
            >
              {{ getPhotoBadgeLabel(photo) }}
            </span>
            <button
              type="button"
              class="favorite-button"
              :class="{ 'favorite-active': isFavorite(photo) }"
              @click.stop="toggleFavorite(photo)"
              :title="isFavorite(photo) ? 'Remove from favorites' : 'Add to favorites'"
            >
              <UIcon
                :name="isFavorite(photo) ? 'i-heroicons-heart-solid' : 'i-heroicons-heart'"
                class="w-5 h-5"
              />
            </button>
          </div>
          <div class="album-photo-meta">
            
            <div class="album-photo-meta-content">
              <p class="album-photo-name">{{ photo.fileName }}</p>
              <p class="album-photo-subtitle">{{ formatTime(photo.shootDateTime) }}</p>
            </div>
            <UDropdownMenu :items="getPhotoMenuItems(photo)">
              <button
                type="button"
                class="photo-menu-trigger"
                aria-label="Photo actions"
                @click.stop
              >
                <UIcon name="i-heroicons-ellipsis-vertical" class="w-4 h-4" />
              </button>
            </UDropdownMenu>
          </div>
        </button>
      </div>
    </div>

    <div class="album-stream-footer">
      <div v-if="loading" class="album-stream-spinner">
        <UIcon name="i-heroicons-arrow-path" class="w-5 h-5 animate-spin" />
        <span>Loading...</span>
      </div>
      <div
        v-else-if="!hasMore && sections.length"
        class="album-stream-end"
      >
        <span>End of results</span>
      </div>
      <div
        v-else
        ref="sentinelRef"
        class="album-stream-sentinel"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
const props = defineProps({
  photos: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
  hasMore: {
    type: Boolean,
    default: false,
  },
  emptyMessage: {
    type: String,
    default: 'No photos found.',
  },
  formatDateLabel: {
    type: Function,
    default: (key) => key,
  },
  formatTimeLabel: {
    type: Function,
    default: (value) => value,
  },
  formatCamera: {
    type: Function,
    default: () => '',
  },
  getThumbnailUrl: {
    type: Function,
    default: () => '',
  },
  showingAllVolumes: {
    type: Boolean,
    default: false,
  },
  availableVolumeIds: {
    type: Array,
    default: () => [],
  },
  activeAlbumId: {
    type: [String, Number],
    default: null,
  },
});

const emit = defineEmits(['load-more', 'select-photo', 'visible-date-change', 'toggle-favorite', 'copy-photo', 'add-to-album', 'remove-from-album']);

const sections = computed(() => groupByDay(props.photos));

// Debug loading state
watch(
  () => props.loading,
  (newVal) => {
    console.log('[AlbumStream] Loading state changed:', newVal);
  }
);
const availableVolumeSet = computed(() => new Set(Array.isArray(props.availableVolumeIds) ? props.availableVolumeIds : []));
const sentinelRef = ref(null);
const sectionRefs = new Map();
const sectionObserverEntries = new Map();
let sentinelObserver = null;
let sectionObserver = null;

function groupByDay(list = []) {
  const groups = [];
  const bucket = new Map();
  list.forEach((photo) => {
    const key = getDateKey(photo?.shootDateTime);
    if (!key) {
      return;
    }
    if (!bucket.has(key)) {
      bucket.set(key, { key, label: formatDateLabel(key), photos: [] });
      groups.push(bucket.get(key));
    }
    bucket.get(key).photos.push(photo);
  });
  return groups;
}

function getDateKey(input) {
  if (!input) {
    return 'unknown';
  }
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) {
    return 'unknown';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(key) {
  if (!key || key === 'unknown') {
    return 'Unknown date';
  }
  return props.formatDateLabel ? props.formatDateLabel(key) : key;
}

function formatTime(value) {
  return props.formatTimeLabel ? props.formatTimeLabel(value) : value;
}

function formatCameraInfo(photo) {
  return props.formatCamera ? props.formatCamera(photo) : '';
}

function getThumbnailSrc(photo) {
  return props.getThumbnailUrl ? props.getThumbnailUrl(photo) : '';
}

function isPhotoAvailable(photo) {
  if (!props.showingAllVolumes) {
    return true;
  }
  if (availableVolumeSet.value.size === 0) {
    return true;
  }
  return availableVolumeSet.value.has(photo.volumeId);
}

function getPhotoBadgeLabel(photo) {
  if (props.showingAllVolumes && !isPhotoAvailable(photo)) {
    return 'Unavailable';
  }
  if (photo.isRaw) {
    return 'RAW';
  }
  return '';
}

function isUnavailableBadge(photo) {
  if (!props.showingAllVolumes) {
    return false;
  }
  if (availableVolumeSet.value.size === 0) {
    return false;
  }
  return !availableVolumeSet.value.has(photo.volumeId);
}

function isFavorite(photo) {
  return photo.rating && photo.rating >= 4;
}

function toggleFavorite(photo) {
  emit('toggle-favorite', photo);
}

function getPhotoMenuItems(photo) {
  const items = [
    {
      label: 'Copy photo',
      icon: 'i-heroicons-document-duplicate',
      onSelect: () => emit('copy-photo', photo),
    },
    {
      label: 'Add to album',
      icon: 'i-heroicons-folder-plus',
      onSelect: () => emit('add-to-album', photo),
    },
  ];

  if (props.activeAlbumId) {
    items.push({
      label: 'Remove from album',
      icon: 'i-heroicons-trash',
      class: 'text-red-500',
      iconClass: 'text-red-500',
      onSelect: () => emit('remove-from-album', photo),
    });
  }

  return [items];
}

function getSectionMenuItems(section) {
  return [
    [
      {
        label: 'Delete all photos',
        icon: 'i-heroicons-trash',
        class: 'text-red-500',
        iconClass: 'text-red-500',
        onSelect: () => emit('delete-section', section.photos),
      },
    ],
  ];
}

function setSectionRef(key, el) {
  const prev = sectionRefs.get(key);
  if (prev && sectionObserver) {
    sectionObserver.unobserve(prev);
  }
  if (!el) {
    sectionRefs.delete(key);
    sectionObserverEntries.delete(key);
    return;
  }
  sectionRefs.set(key, el);
  ensureSectionObserver();
  sectionObserver?.observe(el);
}

function ensureSectionObserver() {
  if (sectionObserver) {
    return;
  }
  sectionObserver = new IntersectionObserver(handleSectionIntersections, {
    root: null,
    threshold: [0, 0.1, 0.25, 0.5, 0.75],
  });
}

function handleSectionIntersections(entries) {
  entries.forEach((entry) => {
    const key = entry.target.dataset.sectionKey;
    if (!key) {
      return;
    }
    if (entry.intersectionRatio <= 0) {
      sectionObserverEntries.delete(key);
    } else {
      sectionObserverEntries.set(key, {
        top: entry.boundingClientRect.top,
        ratio: entry.intersectionRatio,
      });
    }
  });
  const nextKey = pickVisibleDateKey();
  if (nextKey) {
    emit('visible-date-change', nextKey);
  }
}

function pickVisibleDateKey() {
  if (!sectionObserverEntries.size) {
    return null;
  }
  let candidate = null;
  let minTop = Infinity;
  sectionObserverEntries.forEach((value, key) => {
    if (value.top < minTop) {
      minTop = value.top;
      candidate = key;
    }
  });
  return candidate;
}

function ensureSentinelObserver() {
  if (sentinelObserver) {
    return;
  }
  sentinelObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        console.log('[AlbumStream] Sentinel intersection:', {
          isIntersecting: entry.isIntersecting,
          hasMore: props.hasMore,
          loading: props.loading
        });
        if (entry.isIntersecting && props.hasMore && !props.loading) {
          console.log('[AlbumStream] Emitting load-more event');
          emit('load-more');
        }
      });
    },
    {
      root: null,
      rootMargin: '50% 0px',
      threshold: 0.01,
    },
  );
}

watch(
  () => sentinelRef.value,
  (el, prev) => {
    if (prev && sentinelObserver) {
      sentinelObserver.unobserve(prev);
    }
    if (el) {
      ensureSentinelObserver();
      sentinelObserver?.observe(el);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (sentinelObserver) {
    sentinelObserver.disconnect();
    sentinelObserver = null;
  }
  if (sectionObserver) {
    sectionObserver.disconnect();
    sectionObserver = null;
  }
});

function scrollToDateKey(key) {
  console.log('[AlbumStream] scrollToDateKey called with:', key);
  if (!key) {
    console.warn('[AlbumStream] No key provided');
    return;
  }

  let el = sectionRefs.get(key);
  let targetKey = key;

  // If exact key not found, find nearest section
  if (!el) {
    console.log('[AlbumStream] Exact key not found, searching for nearest...');
    const availableKeys = Array.from(sectionRefs.keys()).sort();
    console.log('[AlbumStream] Available section keys:', availableKeys);

    if (availableKeys.length === 0) {
      console.warn('[AlbumStream] No sections available');
      return;
    }

    // Find the nearest date (prefer earlier date if exact match not found)
    let nearestKey = availableKeys[0];
    let minDiff = Math.abs(compareKeys(key, nearestKey));

    for (const availKey of availableKeys) {
      const diff = compareKeys(key, availKey);
      const absDiff = Math.abs(diff);

      // Prefer the closest date, and if equal distance, prefer the later one
      if (absDiff < minDiff || (absDiff === minDiff && diff < 0)) {
        minDiff = absDiff;
        nearestKey = availKey;
      }
    }

    targetKey = nearestKey;
    el = sectionRefs.get(nearestKey);
    console.log('[AlbumStream] Using nearest key:', nearestKey);
  }

  console.log('[AlbumStream] Section element for key:', targetKey, el ? 'found' : 'NOT FOUND');

  if (el) {
    console.log('[AlbumStream] Scrolling to element...');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    console.warn('[AlbumStream] Could not find section element');
  }
}

function compareKeys(key1, key2) {
  // Convert keys to comparable values (assumes YYYY-MM-DD format)
  const date1 = new Date(key1);
  const date2 = new Date(key2);
  return date1.getTime() - date2.getTime();
}

defineExpose({
  scrollToDateKey,
});
</script>

<style scoped>
.album-stream {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.album-section {
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  padding-bottom: 1.5rem;
}

.album-section-header {
  position: static;
  padding: 0.75rem 0;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  z-index: 2;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
}

.album-section-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #0f172a;
}

.album-section-subtitle {
  font-size: 0.85rem;
  color: #475569;
}

.album-photo-grid {
  margin-top: 0.75rem;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
}

.album-photo-card {
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 14px;
  background: #fff;
  text-align: left;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  transition: border-color 0.2s ease, transform 0.2s ease;
  cursor: pointer;
  pointer-events: auto;
}

.album-photo-card:hover {
  border-color: rgba(79, 70, 229, 0.5);
  transform: translateY(-1px);
}

.album-photo-card:focus-visible {
  outline: 2px solid rgba(79, 70, 229, 0.6);
  outline-offset: 2px;
}

.album-photo-thumb {
  position: relative;
  padding-top: 66%;
  border-radius: 10px;
  overflow: hidden;
  background: #f4f4f5;
}

.album-photo-thumb img,
.album-photo-placeholder {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.album-photo-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  color: #94a3b8;
}

.album-photo-badge {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  background: rgba(251, 146, 60, 0.95);
  color: #fff;
  font-size: 0.65rem;
  padding: 0.15rem 0.4rem;
  border-radius: 999px;
  font-weight: 600;
}

.album-photo-badge-unavailable {
  background: rgba(239, 68, 68, 0.92);
}

.favorite-button {
  position: absolute;
  bottom: 0.4rem;
  right: 0.4rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.5);
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
  opacity: 0;
  transform: scale(0.9);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  color: #fff;
}

.album-photo-card:hover .favorite-button {
  opacity: 1;
  transform: scale(1);
}

.favorite-button:hover {
  background: rgba(0, 0, 0, 0.75);
  transform: scale(1.1);
}

.favorite-button.favorite-active {
  opacity: 1;
  background: rgba(239, 68, 68, 0.9);
  color: #fff;
}

.favorite-button.favorite-active:hover {
  background: rgba(220, 38, 38, 0.95);
}

.album-photo-meta {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.album-photo-meta-content {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
}

.photo-menu-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 9999px;
  border: none;
  background: transparent;
  color: #94a3b8;
  transition: background-color 0.2s ease, color 0.2s ease;
  cursor: pointer;
}

.photo-menu-trigger:hover {
  background: rgba(15, 23, 42, 0.08);
  color: #0f172a;
}

.photo-menu-trigger:focus-visible {
  outline: 2px solid rgba(59, 130, 246, 0.8);
  outline-offset: 2px;
}

.album-photo-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.album-photo-subtitle {
  font-size: 0.75rem;
  color: #475569;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.album-stream-footer {
  display: flex;
  justify-content: center;
  padding-bottom: 2rem;
  padding-top: 1rem;
}

.album-stream-spinner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: #475569;
}

.album-stream-end {
  font-size: 0.85rem;
  color: #475569;
}

.album-stream-sentinel {
  width: 100%;
  height: 1px;
}

.album-stream-empty {
  padding: 3rem;
  text-align: center;
  color: #94a3b8;
  border: 1px dashed rgba(15, 23, 42, 0.12);
  border-radius: 16px;
}

.loading-overlay {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 100;
  pointer-events: none;
}

.loading-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: transparent;

}

.loading-pill {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.75rem;
  background: #ffffff;
  border-radius: 9999px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(0, 0, 0, 0.08);
  color: #4f46e5;
}

/* Smooth continuous spinner animation */
:deep(.animate-spin) {
  animation: spin 1s linear infinite;
  will-change: transform;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

</style>
