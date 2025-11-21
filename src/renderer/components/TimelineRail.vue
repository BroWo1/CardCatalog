<template>
  <div class="timeline-rail">
    <div v-if="!keyMarkers.length" class="timeline-empty">
      <p></p>
    </div>
    <div
      v-else
      ref="trackRef"
      class="timeline-track"
      @click="handleTrackClick"
      @mousemove="handleTrackMouseMove"
      @mouseleave="handleTrackMouseLeave"
    >
      <div class="timeline-line"></div>
      <div
        v-for="marker in keyMarkers"
        :key="marker.key"
        class="timeline-marker"
        :class="{ 'timeline-marker--year': marker.isYear }"
        :style="{ top: `${marker.position}%` }"
        @click.stop="handleMarkerClick(marker)"
      >
        <div v-if="marker.isYear" class="marker-label">{{ marker.label }}</div>
        <div class="marker-dot" :class="{ 'marker-dot--year': marker.isYear }"></div>
        
      </div>

      <!-- Ghost Indicator -->
      <div
        v-if="hoverPosition !== null"
        class="timeline-ghost"
        :style="{ top: `${hoverPosition}%` }"
      >
        <div class="ghost-label">{{ hoverLabel }}</div>
        <div class="ghost-dot"></div>
      </div>

      <div
        v-if="currentPosition !== null"
        class="timeline-indicator"
        :style="{ top: `${currentPosition}%` }"
      >
        
        <div v-if="selectedLabel" class="indicator-label">{{ selectedLabel }}</div>
        <div class="indicator-dot"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  timeline: {
    type: Object,
    default: () => ({}),
  },
  selectedDateKey: {
    type: String,
    default: null,
  },
  formatDateLabel: {
    type: Function,
    default: (key) => key,
  },
});

const emit = defineEmits(['jump-to-date']);

const trackRef = ref(null);
const hoverPosition = ref(null);
const hoverLabel = ref(null);
const MONTH_MARKER_STEP = 1; // every other month gets a dot

// Get all date entries sorted
const entries = computed(() => {
  const timeline = props.timeline || {};
  return Object.keys(timeline)
    .sort()
    .map((key) => ({
      key,
      count: timeline[key] || 0,
      timestamp: parseDateKey(key),
    }))
    .filter((entry) => entry.timestamp !== null);
});

// Calculate date range
const dateRange = computed(() => {
  if (!entries.value.length) {
    return { min: null, max: null, span: 0 };
  }
  const timestamps = entries.value.map((e) => e.timestamp);
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  return { min, max, span: max - min || 1 };
});

// Build a density model so marker spacing reflects scroll height (photo volume)
const photoDensity = computed(() => {
  if (!entries.value.length) {
    return { total: 0, nodes: [] };
  }
  const sorted = [...entries.value]
    .map((entry) => ({
      timestamp: entry.timestamp,
      weight: Math.max(Number(entry.count) || 0, 0),
    }))
    .filter((item) => item.weight > 0)
    .sort((a, b) => b.timestamp - a.timestamp);

  const nodes = [];
  let total = 0;
  sorted.forEach((item) => {
    nodes.push({
      timestamp: item.timestamp,
      weight: item.weight,
      heightAbove: total,
    });
    total += item.weight;
  });

  return { total, nodes };
});

// Generate evenly spaced markers across the entire range
const keyMarkers = computed(() => {
  if (!entries.value.length || !dateRange.value.min) {
    return [];
  }
  const markers = [];
  const minDate = new Date(dateRange.value.min);
  const maxDate = new Date(dateRange.value.max);
  const minYear = minDate.getFullYear();
  const maxYear = maxDate.getFullYear();

  for (let year = minYear; year <= maxYear; year++) {
    const yearStart = new Date(year, 0, 1).getTime();
    if (yearStart >= dateRange.value.min && yearStart <= dateRange.value.max) {
      markers.push({
        key: `year-${year}`,
        label: String(year),
        position: calculatePosition(yearStart),
        timestamp: yearStart,
        isYear: true,
      });
    }
    // Month dots (no labels)
    for (let month = 0; month < 12; month += MONTH_MARKER_STEP) {
      const monthTimestamp = new Date(year, month, 1).getTime();
      if (monthTimestamp <= dateRange.value.min || monthTimestamp >= dateRange.value.max) {
        continue;
      }
      markers.push({
        key: `month-${year}-${month}`,
        label: '',
        position: calculatePosition(monthTimestamp),
        timestamp: monthTimestamp,
        isYear: false,
      });
    }
  }

  return markers.sort((a, b) => a.timestamp - b.timestamp);
});

// Calculate current position indicator
const currentPosition = computed(() => {
  if (!props.selectedDateKey || !dateRange.value.min) {
    return null;
  }
  const timestamp = parseDateKey(props.selectedDateKey);
  if (timestamp === null) {
    return null;
  }
  return calculatePosition(timestamp);
});

const selectedLabel = computed(() => {
  if (!props.selectedDateKey) {
    return '';
  }
  if (typeof props.formatDateLabel === 'function') {
    return props.formatDateLabel(props.selectedDateKey) || props.selectedDateKey;
  }
  return props.selectedDateKey;
});

function parseDateKey(key) {
  if (!key) {
    return null;
  }
  const [year, month, day] = key.split('-').map((part) => Number(part));
  if (!year || !month || !day) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function calculatePosition(timestamp) {
  const densityPosition = calculateDensityPosition(timestamp);
  if (densityPosition !== null) {
    return densityPosition;
  }
  return calculateTimePosition(timestamp);
}

function calculateDensityPosition(timestamp) {
  const { total, nodes } = photoDensity.value;
  if (!total || !nodes.length) {
    return null;
  }
  for (const node of nodes) {
    if (timestamp >= node.timestamp) {
      return clampPercentage((node.heightAbove / total) * 100);
    }
  }
  return 100;
}

function calculateTimePosition(timestamp) {
  const { min, max, span } = dateRange.value;
  if (!min || !span) {
    return 0;
  }
  const ratio = (max - timestamp) / span;
  return clampPercentage(ratio * 100);
}

function emitNearestDateKeyFromTimestamp(timestamp) {
  if (!Number.isFinite(timestamp) || !entries.value.length) {
    return;
  }
  let nearest = entries.value[0];
  let minDiff = Math.abs(nearest.timestamp - timestamp);
  for (const entry of entries.value) {
    const diff = Math.abs(entry.timestamp - timestamp);
    if (diff < minDiff) {
      nearest = entry;
      minDiff = diff;
    }
  }
  if (nearest?.key) {
    emit('jump-to-date', nearest.key);
  }
}

function handleMarkerClick(marker) {
  if (!marker || !marker.timestamp) {
    return;
  }
  emitNearestDateKeyFromTimestamp(marker.timestamp);
}

function handleTrackClick(event) {
  if (!trackRef.value || !dateRange.value.min) {
    return;
  }

  const rect = trackRef.value.getBoundingClientRect();
  const y = event.clientY - rect.top;
  const height = rect.height || 1;
  const ratio = Math.max(0, Math.min(1, y / height));
  const timestamp = findTimestampForRatio(ratio);
  if (timestamp == null) {
    return;
  }
  emitNearestDateKeyFromTimestamp(timestamp);
}

function handleTrackMouseMove(event) {
  if (!trackRef.value || !dateRange.value.min) return;

  const rect = trackRef.value.getBoundingClientRect();
  const y = event.clientY - rect.top;
  const height = rect.height || 1;
  const ratio = Math.max(0, Math.min(1, y / height));

  hoverPosition.value = clampPercentage(ratio * 100);

  const timestamp = findTimestampForRatio(ratio);
  if (timestamp) {
    const date = new Date(timestamp);
    hoverLabel.value = date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }
}

function handleTrackMouseLeave() {
  hoverPosition.value = null;
  hoverLabel.value = null;
}

function findTimestampForRatio(ratio) {
  const densityMatch = estimateTimestampFromDensityRatio(ratio);
  if (densityMatch !== null) {
    return densityMatch;
  }
  return calculateTimestampFromTimeRatio(ratio);
}

function estimateTimestampFromDensityRatio(ratio) {
  const { total, nodes } = photoDensity.value;
  if (!total || !nodes.length) {
    return null;
  }
  const clampedRatio = Math.max(0, Math.min(0.999999, ratio));
  const targetHeight = clampedRatio * total;
  for (const node of nodes) {
    const start = node.heightAbove;
    const end = start + node.weight;
    if (targetHeight >= start && targetHeight < end) {
      return node.timestamp;
    }
  }
  return nodes[nodes.length - 1]?.timestamp ?? null;
}

function calculateTimestampFromTimeRatio(ratio) {
  const { max, span } = dateRange.value;
  if (!max || !span) {
    return null;
  }
  return max - (Math.max(0, Math.min(1, ratio)) * span);
}

function clampPercentage(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}
</script>

<style scoped>
.timeline-rail {
  position: absolute;
  right: -100px;
  top: 0;
  bottom: 0;
  width: 90px;
  pointer-events: auto;
  z-index: 20;
}

.timeline-track {
  position: sticky;
  top: var(--sticky-columns-offset, 1.5rem);
  width: 100%;
  height: calc(100vh - var(--app-header-height, 5rem) - var(--app-main-padding, 1.5rem));
  padding: 0;
  cursor: pointer;
  user-select: none;
}

.timeline-track:active .timeline-line {
  background: linear-gradient(to bottom,
    rgba(79, 70, 229, 0.3),
    rgba(79, 70, 229, 0.6) 20%,
    rgba(79, 70, 229, 0.6) 80%,
    rgba(79, 70, 229, 0.3)
  );
}

.timeline-track:hover .timeline-line {
  background: linear-gradient(to bottom,
    rgba(148, 163, 184, 0.2),
    rgba(79, 70, 229, 0.4) 20%,
    rgba(79, 70, 229, 0.4) 80%,
    rgba(148, 163, 184, 0.2)
  );
}

.timeline-line {
  position: absolute;
  right: 16px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: linear-gradient(to bottom,
    rgba(148, 163, 184, 0.1),
    rgba(148, 163, 184, 0.35) 20%,
    rgba(148, 163, 184, 0.35) 80%,
    rgba(148, 163, 184, 0.1)
  );
  pointer-events: none;
  transition: background 0.2s ease;
}


.timeline-marker {
  position: absolute;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  transform: translateY(-50%);
  cursor: pointer;
}

.timeline-marker--year {
  cursor: pointer;
}


.marker-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(148, 163, 184, 0.6);
  border: 1.5px solid white;
  flex-shrink: 0;
  margin-right: 2px; /* Center align with 10px indicator */
}

.marker-dot--year {
  width: 10px;
  height: 10px;
  background: rgba(79, 70, 229, 0.8);
  margin-right: 0;
}

.marker-label {
  font-size: 0.75rem;
  color: rgba(71, 85, 105, 0.9);
  font-weight: 600;
  white-space: nowrap;
  text-align: right;
  padding: 0.1rem 0.4rem;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 4px;
  backdrop-filter: blur(2px);
}

.timeline-indicator {
  position: absolute;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  transform: translateY(-50%);
  z-index: 2;
  pointer-events: none;
}

.indicator-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(79, 70, 229, 0.8);
  border: 2px solid white;
  box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.15);
}

.indicator-label {
  margin-right: 0.75rem;
  padding: 0.2rem 0.6rem;
  background: rgba(15, 23, 42, 0.9);
  color: white;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  white-space: nowrap;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.timeline-ghost {
  position: absolute;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  transform: translateY(-50%);
  z-index: 1;
  pointer-events: none;
  opacity: 0.8;
}

.ghost-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(148, 163, 184, 0.8);
  border: 1px solid white;
  margin-right: 2px; /* Align center with 10px indicator dot */
}

.ghost-label {
  margin-right: 0.75rem;
  padding: 0.15rem 0.5rem;
  background: rgba(255, 255, 255, 0.9);
  color: #64748b;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
  backdrop-filter: blur(4px);
}

.timeline-empty {
  position: sticky;
  top: var(--sticky-columns-offset, 1.5rem);
  width: 90px;
  font-size: 0.75rem;
  color: rgba(71, 85, 105, 0.7);
  text-align: right;
}
</style>
