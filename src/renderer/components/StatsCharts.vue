<template>
  <div v-if="stats" class="space-y-6">
    <!-- Summary Cards -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
        <div class="text-sm text-gray-500">Total Photos</div>
        <div class="text-3xl font-bold text-gray-900">{{ stats.totalPhotos.toLocaleString() }}</div>
      </div>
      <div class="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
        <div class="text-sm text-gray-500">Date Range</div>
        <div class="text-lg font-semibold text-gray-900">{{ formatDateRange() }}</div>
      </div>
      <div class="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
        <div class="text-sm text-gray-500">Most Used Camera</div>
        <div class="text-lg font-semibold text-gray-900 truncate">{{ getMostUsedCamera() }}</div>
      </div>
    </div>

    <!-- Charts Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <!-- ISO Distribution -->
      <div class="chart-container">
        <h3 class="chart-title">ISO Distribution</h3>
        <Bar :data="isoChartData" :options="barChartOptions" />
      </div>

      <!-- Aperture Distribution -->
      <div class="chart-container">
        <h3 class="chart-title">Aperture Distribution</h3>
        <Bar :data="apertureChartData" :options="barChartOptions" />
      </div>

      <!-- Shutter Speed Distribution -->
      <div class="chart-container">
        <h3 class="chart-title">Shutter Speed Distribution</h3>
        <Bar :data="shutterChartData" :options="barChartOptions" />
      </div>

      <!-- Focal Length Distribution -->
      <div class="chart-container">
        <h3 class="chart-title">Focal Length Distribution</h3>
        <Bar :data="focalChartData" :options="barChartOptions" />
      </div>
    </div>

    <!-- Camera Models -->
    <div class="chart-container-wide" v-if="Object.keys(stats.byCameraModel).length > 0">
      <h3 class="chart-title">Camera Models</h3>
      <Bar :data="cameraChartData" :options="horizontalBarOptions" />
    </div>

    <!-- Timeline -->
    <div class="chart-container-wide" v-if="Object.keys(stats.timeline).length > 0">
      <h3 class="chart-title">Photo Timeline</h3>
      <Bar :data="timelineChartData" :options="timelineOptions" />
    </div>
  </div>
  <div v-else class="text-center text-gray-400 py-12">
    No stats loaded yet.
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { Bar } from 'vue-chartjs';
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  BarElement,
  CategoryScale,
  LinearScale,
} from 'chart.js';

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale);

const props = defineProps({
  stats: {
    type: Object,
    default: null,
  },
});

// Chart color palette
const colors = {
  blue: 'rgba(59, 130, 246, 0.8)',
  purple: 'rgba(139, 92, 246, 0.8)',
  green: 'rgba(34, 197, 94, 0.8)',
  orange: 'rgba(251, 146, 60, 0.8)',
  pink: 'rgba(236, 72, 153, 0.8)',
  cyan: 'rgba(6, 182, 212, 0.8)',
};

// Helper functions
function formatDateRange() {
  if (!props.stats?.dateRange) return 'N/A';
  const { earliestShoot, latestShoot } = props.stats.dateRange;
  if (!earliestShoot || !latestShoot) return 'N/A';
  const earliest = new Date(earliestShoot).toLocaleDateString();
  const latest = new Date(latestShoot).toLocaleDateString();
  return earliestShoot === latestShoot ? earliest : `${earliest} - ${latest}`;
}

function getMostUsedCamera() {
  if (!props.stats?.byCameraModel) return 'N/A';
  const cameras = Object.entries(props.stats.byCameraModel);
  if (cameras.length === 0) return 'N/A';
  const [camera] = cameras.sort((a, b) => b[1] - a[1])[0];
  return camera;
}

// ISO Chart Data
const isoChartData = computed(() => ({
  labels: ['0-199', '200-399', '400-799', '800-1599', '1600-3199', '3200+'],
  datasets: [
    {
      label: 'Photos',
      backgroundColor: colors.blue,
      data: props.stats?.isoHistogram
        ? [
            props.stats.isoHistogram.ISO_0_199,
            props.stats.isoHistogram.ISO_200_399,
            props.stats.isoHistogram.ISO_400_799,
            props.stats.isoHistogram.ISO_800_1599,
            props.stats.isoHistogram.ISO_1600_3199,
            props.stats.isoHistogram.ISO_3200_plus,
          ]
        : [],
    },
  ],
}));

// Aperture Chart Data
const apertureChartData = computed(() => ({
  labels: ['f/1.0-1.8', 'f/1.8-2.8', 'f/2.8-4.0', 'f/4.0-5.6', 'f/5.6+'],
  datasets: [
    {
      label: 'Photos',
      backgroundColor: colors.purple,
      data: props.stats?.apertureHistogram
        ? [
            props.stats.apertureHistogram.F_1_0_1_8,
            props.stats.apertureHistogram.F_1_8_2_8,
            props.stats.apertureHistogram.F_2_8_4_0,
            props.stats.apertureHistogram.F_4_0_5_6,
            props.stats.apertureHistogram.F_5_6_PLUS,
          ]
        : [],
    },
  ],
}));

// Shutter Speed Chart Data
const shutterChartData = computed(() => ({
  labels: ['1/8000-1/1000', '1/1000-1/250', '1/250-1/60', '1/60-1/15', '1/15-1s', '1-10s', '10s+'],
  datasets: [
    {
      label: 'Photos',
      backgroundColor: colors.green,
      data: props.stats?.shutterSpeedHistogram
        ? [
            props.stats.shutterSpeedHistogram.T_1_8000_1_1000,
            props.stats.shutterSpeedHistogram.T_1_1000_1_250,
            props.stats.shutterSpeedHistogram.T_1_250_1_60,
            props.stats.shutterSpeedHistogram.T_1_60_1_15,
            props.stats.shutterSpeedHistogram.T_1_15_1,
            props.stats.shutterSpeedHistogram.T_1_10S,
            props.stats.shutterSpeedHistogram.T_10S_PLUS,
          ]
        : [],
    },
  ],
}));

// Focal Length Chart Data
const focalChartData = computed(() => ({
  labels: ['0-24mm', '24-35mm', '35-50mm', '50-85mm', '85-135mm', '135mm+'],
  datasets: [
    {
      label: 'Photos',
      backgroundColor: colors.orange,
      data: props.stats?.focalLengthHistogram
        ? [
            props.stats.focalLengthHistogram.FL_0_24,
            props.stats.focalLengthHistogram.FL_24_35,
            props.stats.focalLengthHistogram.FL_35_50,
            props.stats.focalLengthHistogram.FL_50_85,
            props.stats.focalLengthHistogram.FL_85_135,
            props.stats.focalLengthHistogram.FL_135_PLUS,
          ]
        : [],
    },
  ],
}));

// Camera Models Chart Data
const cameraChartData = computed(() => {
  const cameras = props.stats?.byCameraModel || {};
  return {
    labels: Object.keys(cameras),
    datasets: [
      {
        label: 'Photos',
        backgroundColor: colors.pink,
        data: Object.values(cameras),
      },
    ],
  };
});

// Timeline Chart Data
const timelineChartData = computed(() => {
  const timeline = props.stats?.timeline || {};
  const sortedDates = Object.keys(timeline).sort();
  return {
    labels: sortedDates.map((date) => new Date(date).toLocaleDateString()),
    datasets: [
      {
        label: 'Photos',
        backgroundColor: colors.cyan,
        data: sortedDates.map((date) => timeline[date]),
      },
    ],
  };
});

// Chart Options
const barChartOptions = {
  responsive: true,
  maintainAspectRatio: true,
  aspectRatio: 1.5,
  plugins: {
    legend: {
      display: false,
    },
    tooltip: {
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      padding: 12,
      titleColor: '#fff',
      bodyColor: '#fff',
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      ticks: {
        color: '#374151',
      },
      grid: {
        color: '#e5e7eb',
      },
    },
    x: {
      ticks: {
        color: '#374151',
      },
      grid: {
        display: false,
      },
    },
  },
};

const horizontalBarOptions = {
  ...barChartOptions,
  indexAxis: 'y',
  aspectRatio: 2,
};

const timelineOptions = {
  ...barChartOptions,
  aspectRatio: 3,
  plugins: {
    ...barChartOptions.plugins,
    legend: {
      display: false,
    },
  },
};
</script>

<style scoped>
.chart-container,
.chart-container-wide {
  padding: 1rem;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}

.chart-title {
  margin-bottom: 1rem;
  font-size: 1.125rem;
  font-weight: 600;
  color: #111827;
}
</style>
