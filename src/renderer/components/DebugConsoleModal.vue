<template>
  <UModal v-model:open="isOpen" fullscreen :ui="{ body: 'p-0 bg-white text-gray-900 h-full' }">
    <template #content>
    <div class="debug-modal h-full overflow-y-auto bg-gray-50">
      <!-- Header Bar -->
      <div class="debug-header bg-white border-b border-gray-200">
        <div class="debug-header-container">
          <div class="debug-header-left">
            <h1 class="debug-title text-gray-900">Debug Console</h1>
            <UBadge color="gray" variant="soft" size="xs">Developer Tools</UBadge>
          </div>
          <button
            type="button"
            class="debug-close-button hover:bg-gray-100 text-gray-500 hover:text-gray-900"
            @click="isOpen = false"
          >
            <UIcon name="i-heroicons-x-mark" class="w-5 h-5" />
          </button>
        </div>
      </div>

      <UContainer class="py-8 space-y-6">
        <div class="flex flex-col gap-3">
          <div>
            <p class="text-gray-500 text-sm max-w-2xl">
              Live Vue 3 + Nuxt UI surface for testing the Electron IPC bridge. Plug in cards, trigger scans,
              and inspect results in real time.
            </p>
          </div>
          <UAlert
            v-if="!hasBridge"
            color="orange"
            icon="i-heroicons-information-circle"
            description="The preload bridge is unavailable. Launch via Electron to access window.photoAlbum."
          />
        </div>

        <div class="flex flex-col gap-4">
          <UCard :ui="{ body: { base: 'bg-white' }, header: { base: 'bg-white border-b border-gray-100' } }">
            <template #header>
              <div class="flex items-center justify-between gap-4">
                <div>
                  <p class="text-xl font-medium text-gray-900">Volumes</p>
                  <p class="text-sm text-gray-500">Hot-plug removable media to watch changes stream in.</p>
                </div>
                <div class="flex items-center gap-2">
                  <UButton icon="i-heroicons-arrow-path" color="white" :loading="loadingVolumes" @click="$emit('load-volumes')">
                    Refresh
                  </UButton>
                  <UButton color="red" variant="soft" icon="i-heroicons-trash" :loading="clearingDb" @click="$emit('clear-database')">
                    Clear DB
                  </UButton>
                </div>
              </div>
            </template>

            <div v-if="!volumes.length" class="text-sm text-gray-500">
              No removable volumes detected yet. Connect an SD card or reader.
            </div>

            <div v-else class="space-y-3">
              <div
                v-for="volume in volumes"
                :key="volume.id"
                class="border border-gray-200 rounded-xl p-4 flex flex-col gap-3 bg-gray-50"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p class="text-lg font-semibold text-gray-900">{{ volume.displayLabel || volume.label || volume.id }}</p>
                    <p class="text-xs text-gray-500 break-all">{{ volume.path }}</p>
                  </div>
                  <div class="flex flex-wrap gap-2 text-xs">
                    <UBadge v-if="volume.isLikelySdCard" color="amber" variant="soft">Likely SD</UBadge>
                    <UBadge v-else-if="volume.isRemovable" color="emerald" variant="soft">Removable</UBadge>
                    <UBadge v-if="volume.isSystem" color="rose" variant="soft">System</UBadge>
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                  <span v-if="volume.sizeBytes">{{ formatBytes(volume.sizeBytes) }} total</span>
                  <span v-if="volume.freeBytes">{{ formatBytes(volume.freeBytes) }} free</span>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <UButton
                    size="sm"
                    icon="i-heroicons-play"
                    color="primary"
                    :disabled="!canScanVolume(volume) || !hasBridge"
                    @click="$emit('start-scan', volume.id)"
                  >
                    Start Scan
                  </UButton>
                  <UButton
                    size="sm"
                    color="white"
                    :disabled="selectedVolumeId === volume.id"
                    @click="$emit('select-volume', volume.id)"
                  >
                    Set as Active
                  </UButton>
                  <UButton
                    size="sm"
                    color="red"
                    variant="ghost"
                    icon="i-heroicons-trash"
                    :disabled="!hasBridge"
                    @click="$emit('delete-volume-data', volume.id)"
                  >
                    Delete Volume Data
                  </UButton>
                </div>
              </div>
            </div>
          </UCard>

          <UCard :ui="{ body: { base: 'bg-white' }, header: { base: 'bg-white border-b border-gray-100' } }">
            <template #header>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p class="text-xl font-medium text-gray-900">Scan Progress</p>
                  <p class="text-sm text-gray-500">Triggered scans stream precise counts from the main process.</p>
                </div>
                <div class="flex items-center gap-2 text-sm text-gray-500">
                  <span>Active volume:</span>
                  <UBadge color="gray" variant="soft">
                    {{ scanVolumeLabel || '—' }}
                  </UBadge>
                </div>
              </div>
            </template>

            <div class="space-y-3">
              <div class="flex items-center gap-3">
                <UBadge :color="statusIntent" variant="solid">{{ scanState.status?.toUpperCase() }}</UBadge>
                <span class="text-sm text-gray-500">{{ scanCountsLabel }}</span>
              </div>
              <UProgress :value="progressPercent" :max="100" :ui="{ rounded: 'rounded-full', size: 'h-3' }" />
              <UCode class="block text-xs bg-gray-50 text-gray-700" :code="JSON.stringify(scanState, null, 2)" />
            </div>
          </UCard>
        </div>
      </UContainer>
    </div>
    </template>
  </UModal>
</template>

<script setup>
import { usePhotoFormatter } from '../composables/usePhotoFormatter';

const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true,
  },
  hasBridge: {
    type: Boolean,
    required: true,
  },
  volumes: {
    type: Array,
    required: true,
  },
  scanState: {
    type: Object,
    required: true,
  },
  selectedVolumeId: {
    type: String,
    default: null,
  },
  scanVolumeLabel: {
    type: String,
    default: '',
  },
  loadingVolumes: {
    type: Boolean,
    default: false,
  },
  clearingDb: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  'update:modelValue',
  'load-volumes',
  'clear-database',
  'start-scan',
  'select-volume',
  'delete-volume-data',
]);

const { formatBytes } = usePhotoFormatter();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const scanCountsLabel = computed(
  () => `${props.scanState.processedFiles ?? 0} / ${props.scanState.totalFiles ?? 0} files`,
);

const statusIntent = computed(() => {
  switch (props.scanState.status) {
    case 'completed':
      return 'green';
    case 'error':
      return 'red';
    case 'scanning':
      return 'amber';
    default:
      return 'gray';
  }
});

const progressPercent = computed(() => {
  const total = props.scanState.totalFiles || 0;
  if (!total) {
    return props.scanState.status === 'completed' ? 100 : 0;
  }
  return Math.min(Math.round((props.scanState.processedFiles / total) * 100), 100);
});

function canScanVolume(volume) {
  return Boolean(volume && (volume.isRemovable || volume.isLikelySdCard));
}
</script>

<style scoped>
.debug-modal {
  /* background: #020617; Removed dark bg */
}

.debug-header {
  position: sticky;
  top: 0;
  z-index: 10;
  /* background: #0f172a; Removed dark bg */
  /* border-bottom: 1px solid rgba(255, 255, 255, 0.1); Removed dark border */
}

.debug-header-container {
  max-width: 1920px;
  margin: 0 auto;
  padding: 1rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.debug-header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.debug-title {
  font-size: 1.25rem;
  font-weight: 600;
  /* color: #ffffff; Removed dark text */
  margin: 0;
}

.debug-close-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  background: transparent;
  border: none;
  border-radius: 0.5rem;
  /* color: #94a3b8; Removed dark text */
  cursor: pointer;
  transition: all 0.2s ease;
}

/* Removed dark hover states */
.debug-close-button:active {
  transform: scale(0.95);
}
</style>
