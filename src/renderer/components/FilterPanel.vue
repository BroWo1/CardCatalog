<template>
  <UCard
    class="filter-panel"
    :ui="{
      root: 'border-0 shadow-none bg-white flex flex-col',
      divide: 'divide-y-0',
      body: '!p-0 flex-1 min-h-0 overflow-y-auto',
      header: 'px-5 py-4 shrink-0'
    }"
  >
    <!-- Header -->
    <template #header>
      <div class="flex flex-col cursor-pointer select-none group" @click="isExpanded = !isExpanded">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <p class="text-base font-bold text-gray-900">Filters</p>
            <!-- Chevron rotates smoothly -->
            <UIcon
              name="i-heroicons-chevron-down"
              class="w-4 h-4 text-gray-400 transition-transform duration-300"
              :class="{ 'rotate-180': isExpanded }"
            />
          </div>
          <!-- Stop propagation to prevent toggling when clicking reset -->
          <div @click.stop>
             <transition name="fade">
              <UButton
                v-if="hasActiveFilters"
                size="xs"
                color="gray"
                variant="link"
                icon="i-heroicons-arrow-path"
                class="text-gray-500 hover:text-gray-900 p-0"
                @click="handleReset"
              >
                Reset
              </UButton>
            </transition>
          </div>
        </div>
      </div>
    </template>

    <!-- Collapsible Body -->
    <transition
      name="filter-collapse"
      @before-enter="filterCollapseTransition.beforeEnter"
      @enter="filterCollapseTransition.enter"
      @after-enter="filterCollapseTransition.afterEnter"
      @before-leave="filterCollapseTransition.beforeLeave"
      @leave="filterCollapseTransition.leave"
      @after-leave="filterCollapseTransition.afterLeave"
    >
      <!-- 
        CRITICAL FIX: 
        1. v-show must be on the direct child of transition.
        2. 'overflow-hidden' prevents content from rendering outside during animation.
      -->
      <div v-show="isExpanded" class="filter-wrapper overflow-hidden">
        <!-- 
          CRITICAL FIX: 
          Padding is applied here, not on the transitioning wrapper.
          Space-y handles vertical rhythm without collapsing margins causing jumps.
        -->
        <div class="p-5 pt-2 space-y-6">
          
          <!-- SECTION 1: Main Selectors (Stacked) -->
          <div class="space-y-4">
            <UFormField label="Camera Models" class="w-full" :ui="{ label: 'text-xs font-medium text-gray-700' }">
              <USelectMenu
                v-model="cameraModelsModel"
                :items="cameraOptions"
                placeholder="Select camera..."
                icon="i-heroicons-camera"
                multiple
                searchable
                class="w-full"
                size="sm"
              />
            </UFormField>

            <UFormField label="Lens Models" class="w-full" :ui="{ label: 'text-xs font-medium text-gray-700' }">
              <USelectMenu
                v-model="lensModelsModel"
                :items="lensOptions"
                placeholder="Select lens..."
                icon="i-heroicons-adjustments-horizontal"
                multiple
                searchable
                class="w-full"
                size="sm"
              />
            </UFormField>
          </div>

          <!-- SECTION 2: Dates (Grid for compact view, but distinct) -->
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Date From" :ui="{ label: 'text-xs font-medium text-gray-700' }">
              <UInput v-model="dateFromModel" type="date" class="w-full" size="sm" :ui="{ icon: { trailing: { pointer: '' } } }" />
            </UFormField>
            <UFormField label="Date To" :ui="{ label: 'text-xs font-medium text-gray-700' }">
              <UInput v-model="dateToModel" type="date" class="w-full" size="sm" />
            </UFormField>
          </div>

          <UDivider />

          <!-- SECTION 3: Metadata Ranges -->
          <div class="space-y-4">
            <div class="flex items-center gap-2 mb-1">
              <UIcon name="i-heroicons-chart-bar-square" class="w-4 h-4 text-gray-400" />
              <span class="text-sm font-semibold text-gray-900">Metadata Ranges</span>
            </div>

            <!-- 
              Grid layout for ranges:
              Using 'grid-cols-2' ensures the Min and Max inputs 
              take up exactly 50% width each, preventing layout shifts.
            -->
            
            <!-- ISO -->
            <div class="space-y-1">
              <label class="metadata-range-label">ISO</label>
              <div class="grid grid-cols-2 gap-2">
                <UInput 
                  v-model="isoMinModel" 
                  type="number" 
                  placeholder="Min" 
                  size="xs"
                  class="metadata-input"
                />
                <UInput 
                  v-model="isoMaxModel" 
                  type="number" 
                  placeholder="Max" 
                  size="xs"
                  class="metadata-input"
                />
              </div>
            </div>

            <!-- Aperture -->
            <div class="space-y-1">
              <label class="metadata-range-label">Aperture (f/)</label>
              <div class="grid grid-cols-2 gap-2">
                <UInput 
                  v-model="apertureMinModel" 
                  type="number" 
                  step="0.1" 
                  placeholder="Min" 
                  size="xs"
                  class="metadata-input"
                />
                <UInput 
                  v-model="apertureMaxModel" 
                  type="number" 
                  step="0.1" 
                  placeholder="Max" 
                  size="xs"
                  class="metadata-input"
                />
              </div>
            </div>

            <!-- Focal Length -->
            <div class="space-y-1">
              <label class="metadata-range-label">Focal Length (mm)</label>
              <div class="grid grid-cols-2 gap-2">
                <UInput 
                  v-model="focalMinModel" 
                  type="number" 
                  placeholder="Min" 
                  size="xs"
                  class="metadata-input"
                />
                <UInput 
                  v-model="focalMaxModel" 
                  type="number" 
                  placeholder="Max" 
                  size="xs"
                  class="metadata-input"
                />
              </div>
            </div>
          </div>
          
          <!-- Bottom padding spacer to ensure last element isn't cut off -->
          <div class="h-1"></div>
        </div>
      </div>
    </transition>
  </UCard>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { usePhotoFilters } from '../composables/usePhotoFilters';
import { createCollapseTransition } from '../utils/collapseTransition';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  cameraOptions: { type: Array, default: () => [] },
  lensOptions: { type: Array, default: () => [] },
});

const emit = defineEmits(['update:modelValue']);

const isExpanded = ref(props.modelValue);

// Adjusted animation for smoothness
const filterCollapseTransition = createCollapseTransition({
  duration: 300, 
  opacityDuration: 150, 
  lockFlex: true // Keep this true to prevent parent flex jitter
});

watch(() => props.modelValue, (val) => isExpanded.value = val);
watch(isExpanded, (val) => emit('update:modelValue', val));

const { filterState, setFilter, resetFilters } = usePhotoFilters();

// Check if any filter is actually active to show/hide Reset button
const hasActiveFilters = computed(() => {
  return filterState.cameraModels?.length > 0 || 
         filterState.lensModels?.length > 0 ||
         filterState.dateFrom || 
         filterState.dateTo ||
         filterState.isoMin || filterState.isoMax ||
         filterState.apertureMin || filterState.apertureMax ||
         filterState.focalMin || filterState.focalMax;
});

// --- Filter Logic (Same as before) ---
const cameraModelsModel = computed({
  get: () => filterState.cameraModels,
  set: (val) => setFilter('cameraModels', Array.isArray(val) ? val : []),
});

const lensModelsModel = computed({
  get: () => filterState.lensModels,
  set: (val) => setFilter('lensModels', Array.isArray(val) ? val : []),
});

const dateFromModel = computed({
  get: () => formatDateInput(filterState.dateFrom),
  set: (val) => setFilter('dateFrom', parseDateInput(val)),
});

const dateToModel = computed({
  get: () => formatDateInput(filterState.dateTo),
  set: (val) => setFilter('dateTo', parseDateInput(val, true)),
});

const isoMinModel = createNumericModel('isoMin');
const isoMaxModel = createNumericModel('isoMax');
const apertureMinModel = createNumericModel('apertureMin', { decimals: true });
const apertureMaxModel = createNumericModel('apertureMax', { decimals: true });
const focalMinModel = createNumericModel('focalMin');
const focalMaxModel = createNumericModel('focalMax');

function createNumericModel(key, options = {}) {
  const allowDecimals = Boolean(options.decimals);
  return computed({
    get: () => (filterState[key] ?? ''),
    set: (value) => {
      if (value === '' || value == null) {
        setFilter(key, null);
        return;
      }
      const numeric = allowDecimals ? Number(value) : parseInt(value, 10);
      setFilter(key, Number.isFinite(numeric) ? numeric : null);
    },
  });
}

function formatDateInput(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}

function parseDateInput(value, isEnd = false) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  isEnd ? date.setHours(23, 59, 59, 999) : date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function handleReset() {
  resetFilters(filterState.volumeId);
}
</script>

<style scoped>
/* 
  Standard Fade Transition for the Reset Button
*/
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 
  Ensure the wrapper doesn't have flex-grow issues 
*/
.filter-wrapper {
  display: block;
  will-change: height;
}

.metadata-range-label {
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6b7280;
}

:deep(.metadata-input input) {
  font-size: 0.7rem;
  height: 1.75rem;
  padding: 0.15rem 0.4rem;
}

:deep(.metadata-input input::placeholder) {
  color: #9ca3af;
  font-size: 0.7rem;
}
</style>
