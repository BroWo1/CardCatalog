<template>
  <div class="album-page-root" :class="{ 'is-mac-layout': isMacLayout }">
    <!-- Header -->
    <header class="app-header">
      <div class="app-header-drag-handle" aria-hidden="true"></div>
      <div class="app-header-container">
        <div class="app-header-left">
          <img
            src="../../assets/cardcatelog.png"
            alt="CardCatalog Logo"
            class="app-logo cursor-pointer"
            @click="activateAllVolumesScope"
          />
          <div class="app-header-search">
            <UInput
              class="window-no-drag search-input"
              v-model="globalSearchQuery"
              icon="i-heroicons-magnifying-glass"
              placeholder="Search photos or keywords..."
              size="sm"
              :ui="{ trailing: 'pe-1' }"
            >
              <template v-if="globalSearchQuery?.length" #trailing>
                <UButton
                  color="neutral"
                  variant="link"
                  size="sm"
                  icon="i-heroicons-x-circle"
                  aria-label="Clear search"
                  @click="globalSearchQuery = ''"
                />
              </template>
            </UInput>
            <UButton
              class="window-no-drag search-mode-toggle"
              size="sm"
              :color="isSemanticSearchMode ? 'primary' : 'gray'"
              :variant="isSemanticSearchMode ? 'soft' : 'outline'"
              :icon="isSemanticSearchMode ? 'i-heroicons-sparkles' : 'i-heroicons-adjustments-horizontal'"
              :aria-pressed="isSemanticSearchMode ? 'true' : 'false'"
              :title="searchModeTooltip"
              @click="toggleSearchMode"
            >
              {{ isSemanticSearchMode ? 'Context' : 'Regular' }}
            </UButton>
          </div>
        </div>
        <div class="app-header-right">
          <div class="app-status-badges">
            <div class="status-item volume-status" style="flex-direction: row; align-items: flex-start; gap: 0.25rem; align-items: center;">
              <span class="status-label" style="margin-right: 0.25rem;">Library</span>
              <div class="volume-controls" style="align-items: center;">
                <USelectMenu
                  class="window-no-drag"
                  :ui="{ base: 'min-w-[150px] shrink-0' }"
                  v-model="volumeScopeModel"
                  :items="volumeScopeOptions"
                  placeholder="Choose library view"
                  size="sm"
                  :disabled="!hasBridge"
                  value-key="value"
                  label-key="label"
                />
                <UButton
                  class="window-no-drag"
                  color="primary"
                  size="sm"
                  icon="i-heroicons-folder-plus"
                  :disabled="!hasBridge"
                  @click="chooseFolderVolume"
                >
                  Scan Folder
                </UButton>
              </div>
            </div>
            <div class="status-item">
              <span class="status-label">Scan</span>
              <UBadge :color="statusIntent" variant="soft" size="xs">{{ scanState.status?.toUpperCase() || 'IDLE' }}</UBadge>
            </div>
          </div>
          <UButton
            class="window-no-drag"
            color="gray"
            variant="ghost"
            icon="i-heroicons-computer-desktop"
            size="sm"
            :disabled="!hasBridge"
            @click="debugConsoleOpen = true"
          >
            Console
          </UButton>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <div class="app-main">
      <UContainer class="app-container">
        <div class="app-layout">
          <!-- Left Column -->
          <div class="app-left-column">
            <!-- Sidebar -->
            <aside class="app-sidebar">
              <nav class="sidebar-nav">
                <button
                  v-for="item in navigationItems"
                  :key="item.value"
                  type="button"
                  class="nav-item"
                  :class="{ 'nav-item-active': activePrimaryTab === item.value }"
                  @click="activePrimaryTab = item.value"
                >
                  <UIcon :name="item.icon" class="nav-item-icon" />
                  <span class="nav-item-label">{{ item.label }}</span>
                </button>
              </nav>

              <transition
                name="sidebar-collapse"
                @before-enter="sidebarCollapseTransition.beforeEnter"
                @enter="sidebarCollapseTransition.enter"
                @after-enter="sidebarCollapseTransition.afterEnter"
                @before-leave="sidebarCollapseTransition.beforeLeave"
                @leave="sidebarCollapseTransition.leave"
                @after-leave="sidebarCollapseTransition.afterLeave"
              >
                <div v-show="sidebarExpanded" class="sidebar-extra">
                  <div class="sidebar-summary">
                    <p class="summary-count">{{ albumLoadedCountLabel }}</p>
                    <p class="summary-date">{{ albumSummaryDateRange || '—' }}</p>
                  </div>

                  <div class="sidebar-actions">
                    <div v-if="filterState.volumeId" class="mb-2 space-y-2">
                      <UButton
                        v-if="canResumeCurrentScan"
                        block
                        color="primary"
                        variant="soft"
                        icon="i-heroicons-play-pause"
                        size="sm"
                        class="cursor-pointer"
                        @click="resumeScan"
                      >
                        Resume Scan
                      </UButton>
                      <UButton
                        v-else-if="scanState.status !== 'scanning' && scanState.status !== 'stopping'"
                        block
                        color="primary"
                        variant="soft"
                        icon="i-heroicons-play"
                        size="sm"
                        class="cursor-pointer"
                        @click="startScan(filterState.volumeId)"
                      >
                        Trigger Scan
                      </UButton>
                      <UButton
                        v-else-if="scanState.volumeId === filterState.volumeId"
                        block
                        color="red"
                        variant="soft"
                        icon="i-heroicons-stop"
                        size="sm"
                        class="cursor-pointer"
                        :loading="scanState.status === 'stopping'"
                        @click="stopScan"
                      >
                        Stop Scan
                      </UButton>
                    </div>

                    <UButton
                      block
                      color="gray"
                      variant="soft"
                      icon="i-heroicons-arrow-path"
                      size="sm"
                      class="cursor-pointer"
                      :loading="albumLoading"
                      :disabled="!hasBridge || (!filterState.volumeId && !showAllVolumes.value)"
                      @click="scheduleAlbumReload(true)"
                    >
                      Reload Album
                    </UButton>
                  </div>
                </div>
              </transition>
            </aside>

            <!-- Filters Column -->
            <div class="filters-column">
              <FilterPanel
                v-model="filterExpanded"
                :camera-options="cameraOptions"
                :lens-options="lensOptions"
              />
            </div>
          </div>

          <!-- Main Content Area -->
          <div class="app-content">
            <div class="content-grid">
              <!-- Center Column -->
              <div class="center-column">
                <!-- Album View -->
                <section
                  v-if="activePrimaryTab === 'collections' && albumCollectionsDisplay.length"
                  class="collections-section"
                >
                  <div class="collections-section-header">
                    <div>
                      <p class="collections-section-label">Albums</p>
                      <p class="collections-section-subtext">Curate photos into custom collections</p>
                    </div>
                    <div class="collections-section-actions">
                      <UButton
                        size="xs"
                        color="gray"
                        variant="ghost"
                        class="window-no-drag cursor-pointer"
                        :icon="collapsedCollections.albums ? 'i-heroicons-arrows-pointing-out' : 'i-heroicons-arrows-pointing-in'"
                        @click="toggleCollectionsSection('albums')"
                      >
                        {{ collapsedCollections.albums ? 'Expand' : 'Collapse' }}
                      </UButton>
                      <UButton
                        v-if="isAlbumCollectionView"
                        size="xs"
                        color="gray"
                        variant="soft"
                        icon="i-heroicons-photo"
                        class="window-no-drag cursor-pointer"
                        @click="clearAlbumView"
                      >
                        Show full library
                      </UButton>
                    </div>
                  </div>
                  <div
                    class="collections-strip"
                    :class="{ 'collections-strip-collapsed': collapsedCollections.albums }"
                  >
                    <button
                      type="button"
                      class="collection-card"
                      @click="volumeScopeModel = 'scope:favorites'"
                    >
                      <div class="collection-thumb">
                        <div class="collection-thumb-placeholder">
                          <UIcon name="i-heroicons-star" class="text-yellow-400 w-8 h-8" />
                        </div>
                      </div>
                      <div class="collection-meta">
                        <p class="collection-name">Favorites</p>
                        <p class="collection-count">Fixed Album</p>
                      </div>
                    </button>

                    <div
                      v-for="album in albumCollectionsDisplay"
                      :key="album.id"
                      class="collection-card-wrapper relative group"
                    >
                      <button
                        type="button"
                        class="collection-card w-full h-full"
                        @click="viewAlbumCollection(album.id)"
                      >
                        <div class="collection-thumb">
                          <img
                            v-if="getAlbumCoverUrl(album)"
                            :src="getAlbumCoverUrl(album)"
                            :alt="album.name"
                          >
                          <div v-else class="collection-thumb-placeholder">No cover</div>
                        </div>
                        <div class="collection-card-meta">
                          <div class="collection-card-meta-content">
                            <p class="collection-name">{{ album.name }}</p>
                            <p class="collection-count">{{ album.photos.length }} photos</p>
                          </div>
                          <UDropdownMenu :items="[[{ label: 'Delete album', icon: 'i-heroicons-trash', onSelect: () => handleDeleteAlbum(album.id) }]]">
                            <button
                              type="button"
                              class="photo-menu-trigger"
                              aria-label="Album actions"
                              @click.stop
                            >
                              <UIcon name="i-heroicons-ellipsis-vertical" class="w-4 h-4" />
                            </button>
                          </UDropdownMenu>
                        </div>
                      </button>
                    </div>
                  </div>
                </section>
                <section
                  v-if="activePrimaryTab === 'collections'"
                  class="collections-section ai-collections-section"
                >
                  <div class="collections-section-header">
                    <div>
                      <p class="collections-section-label">AI Discovery</p>
                      <p class="collections-section-subtext">
                        Browse automatically generated keyword collections
                      </p>
                    </div>
                    <div class="collections-section-actions">
                      <UButton
                        size="xs"
                        color="gray"
                        variant="ghost"
                        class="window-no-drag cursor-pointer"
                        :icon="collapsedCollections.ai ? 'i-heroicons-arrows-pointing-out' : 'i-heroicons-arrows-pointing-in'"
                        @click="toggleCollectionsSection('ai')"
                      >
                        {{ collapsedCollections.ai ? 'Expand' : 'Collapse' }}
                      </UButton>
                      <UButton
                        size="xs"
                        color="gray"
                        variant="soft"
                        icon="i-heroicons-arrow-path"
                        class="window-no-drag cursor-pointer"
                        :loading="loadingAiCollections"
                        @click="loadAiCollections"
                      >
                        Refresh
                      </UButton>
                    </div>
                  </div>
                  <div v-if="loadingAiCollections" class="ai-collections-empty">
                    <ULoader size="sm" class="mr-2" />
                    <span>Analyzing AI labels…</span>
                  </div>
                  <div v-else-if="!aiCollections.length" class="ai-collections-empty">
                    <span>No AI collections yet. Scan photos to generate CLIP keywords.</span>
                  </div>
                  <div
                    v-else
                    class="collections-strip ai-collections-grid"
                    :class="{ 'collections-strip-collapsed': collapsedCollections.ai }"
                  >
                    <button
                      v-for="collection in aiCollections"
                      :key="collection.label"
                      type="button"
                      class="collection-card ai-collection-card"
                      :class="{ 'ai-collection-active': activeAiCollection === collection.label }"
                      @click="viewAiCollection(collection.label)"
                    >
                      <div class="collection-thumb">
                        <img
                          v-if="getAiCollectionThumbnail(collection)"
                          :src="getAiCollectionThumbnail(collection)"
                          :alt="collection.label"
                        >
                        <div v-else class="collection-thumb-placeholder ai-collection-thumb">
                          <UIcon name="i-heroicons-sparkles" class="w-8 h-8 text-primary-500" />
                        </div>
                      </div>
                      <div class="collection-card-meta">
                        <div class="collection-card-meta-content">
                          <p class="collection-name">{{ collection.label }}</p>
                          <p class="collection-count">{{ collection.count }} photos</p>
                        </div>
                        <!--
                        <span class="inline-flex items-center gap-1 text-xs text-primary-600">
                          View photos
                          <UIcon name="i-heroicons-arrow-right" class="w-3 h-3" />
                        </span>
                        -->
                      </div>
                    </button>
                  </div>
                </section>

                <section
                  v-if="activePrimaryTab === 'collections'"
                  class="collections-section city-collections-section"
                >
                  <div class="collections-section-header">
                    <div>
                      <p class="collections-section-label">Cities</p>
                      <p class="collections-section-subtext">
                        Top locations with at least 10 tagged photos
                      </p>
                    </div>
                    <div class="collections-section-actions">
                      <UButton
                        size="xs"
                        color="gray"
                        variant="ghost"
                        class="window-no-drag cursor-pointer"
                        :icon="collapsedCollections.cities ? 'i-heroicons-arrows-pointing-out' : 'i-heroicons-arrows-pointing-in'"
                        @click="toggleCollectionsSection('cities')"
                      >
                        {{ collapsedCollections.cities ? 'Expand' : 'Collapse' }}
                      </UButton>
                      <UButton
                        size="xs"
                        color="gray"
                        variant="soft"
                        icon="i-heroicons-arrow-path"
                        class="window-no-drag cursor-pointer"
                        :loading="loadingCityCollections"
                        @click="loadCityCollections"
                      >
                        Refresh
                      </UButton>
                    </div>
                  </div>
                  <div v-if="loadingCityCollections" class="ai-collections-empty city-collections-empty">
                    <ULoader size="sm" class="mr-2" />
                    <span>Gathering city stats…</span>
                  </div>
                  <div v-else-if="!cityCollections.length" class="ai-collections-empty city-collections-empty">
                    <span>Need more geotagged photos to build city collections.</span>
                  </div>
                  <div
                    v-else
                    class="collections-strip city-collections-grid"
                    :class="{ 'collections-strip-collapsed': collapsedCollections.cities }"
                  >
                    <button
                      v-for="collection in cityCollections"
                      :key="collection.label"
                      type="button"
                      class="collection-card city-collection-card"
                      :class="{ 'city-collection-active': activeCityCollection === collection.label }"
                      @click="viewCityCollection(collection)"
                    >
                      <div class="collection-thumb">
                        <img
                          v-if="getCityCollectionThumbnail(collection)"
                          :src="getCityCollectionThumbnail(collection)"
                          :alt="collection.label"
                        >
                        <div v-else class="collection-thumb-placeholder city-collection-thumb">
                          <UIcon name="i-heroicons-map-pin" class="w-8 h-8 text-rose-500" />
                        </div>
                      </div>
                      <div class="collection-card-meta">
                        <div class="collection-card-meta-content">
                          <p class="collection-name">
                            {{ collection.city || collection.label }}
                          </p>
                          <p class="collection-count">
                            <span v-if="collection.country">{{ collection.country }} · </span>
                            {{ collection.count.toLocaleString() }} photos
                          </p>
                        </div>
                      </div>
                    </button>
                  </div>
                </section>

                <div
                  v-if="isAlbumCollectionView || activeAiCollection || isFavoritesScope || isCityCollectionView"
                  class="album-banner"
                >
                  <div>
                    <p class="album-banner-label">
                      <template v-if="isAlbumCollectionView">Album View</template>
                      <template v-else-if="isFavoritesScope">Favorites</template>
                      <template v-else-if="activeAiCollection">AI Collection</template>
                      <template v-else-if="isCityCollectionView">City Collection</template>
                    </p>
                    <h2 class="album-banner-title">
                      <template v-if="isAlbumCollectionView">
                        {{ activeAlbum?.name || 'Album' }}
                        <span v-if="activeAlbum?.photos?.length" class="album-banner-count">
                          ({{ activeAlbum.photos.length }} photos)
                        </span>
                      </template>
                      <template v-else-if="isFavoritesScope">
                        Favorite Photos
                        <span v-if="albumTotalCount" class="album-banner-count">
                          ({{ albumTotalCount.toLocaleString() }} photos)
                        </span>
                      </template>
                      <template v-else-if="activeAiCollection">
                        {{ activeAiCollection }}
                        <span v-if="albumTotalCount" class="album-banner-count">
                          ({{ albumTotalCount.toLocaleString() }} photos)
                        </span>
                      </template>
                      <template v-else-if="isCityCollectionView">
                        {{ activeCityCollection }}
                        <span v-if="albumTotalCount" class="album-banner-count">
                          ({{ albumTotalCount.toLocaleString() }} photos)
                        </span>
                      </template>
                    </h2>
                  </div>
                  <UButton
                    color="gray"
                    variant="soft"
                    icon="i-heroicons-arrow-uturn-left"
                    class="window-no-drag cursor-pointer"
                    @click="isAlbumCollectionView ? clearAlbumView() : activateAllVolumesScope()"
                  >
                    Back to Library
                  </UButton>
                </div>
                <AlbumStream
                  v-if="activePrimaryTab === 'album'"
                  ref="albumStreamRef"
                  :photos="displayedAlbumPhotos"
                  :loading="albumLoading"
                  :has-more="albumHasMore"
                  :empty-message="albumEmptyMessage"
                  :format-date-label="formatDateOnly"
                  :format-time-label="formatTimeOnly"
                  :format-camera="formatCamera"
                  :get-thumbnail-url="getThumbnailUrl"
                  :showing-all-volumes="showAllVolumes"
                  :available-volume-ids="availableVolumeIds"
                  @load-more="handleAlbumLoadMore"
                  @select-photo="openPhotoModal"
                  @visible-date-change="handleVisibleDateChange"
                  @toggle-favorite="togglePhotoFavorite"
                  @copy-photo="handleCopyPhotoAction"
                  @add-to-album="handleAddPhotoToAlbum"
                  @remove-from-album="handleRemoveFromAlbum"
                  :active-album-id="activeAlbumId"
                />

                <!-- Timeline Rail (inside center column) -->
                <TimelineRail
                  v-if="activePrimaryTab === 'album'"
                  :timeline="timelineData"
                  :selected-date-key="albumVisibleDateKey"
                  :format-date-label="formatDateOnly"
                  @jump-to-date="handleTimelineJump"
                />

                <!-- Statistics View -->
                <div v-if="activePrimaryTab === 'statistics'" class="stats-view">
                  <div class="stats-header">
                    <div>
                      <h2 class="stats-title">Photo Statistics</h2>
                      <p class="stats-subtitle">Charts reflect your current filters</p>
                    </div>
                    <UButton
                      icon="i-heroicons-chart-bar-square"
                      :loading="loadingStats"
                      :disabled="!hasBridge"
                      @click="fetchStats"
                    >
                      Refresh Stats
                    </UButton>
                  </div>
                  <div v-if="stats" class="stats-info">
                    {{ stats.totalPhotos.toLocaleString() }} photos analyzed
                  </div>
                  <StatsCharts :stats="stats" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </UContainer>
    </div>
  <transition name="fade">
    <div v-if="message.text" class="toast-container">
      <UAlert
        :color="message.tone === 'error' ? 'red' : message.tone === 'success' ? 'green' : 'blue'"
        variant="solid"
        :title="message.text"
        icon="i-heroicons-sparkles"
        @close="message.text = ''"
        closeable
      />
    </div>
  </transition>

  <UModal v-model:open="albumModalOpen" :ui="{ width: 'max-w-md' }">
    <template #content>
      <div class="album-modal-panel">
        <div>
          <h3 class="album-modal-title">Add to Album</h3>
          <p class="album-modal-subtitle">Choose an existing album or create a new one for this photo.</p>
        </div>
        <div class="album-modal-body">
        <UFormGroup label="Existing albums" description="Select an album to reuse" :ui="{ label: 'font-medium text-sm text-slate-600' }">
          <USelectMenu
            v-model="albumModalSelectedId"
            :items="albumCollectionOptions"
            placeholder="Select album"
            clearable
            :disabled="!albumCollectionOptions.length"
            value-key="value"
            label-key="label"
          />
        </UFormGroup>
        <UDivider label="or" />
        <UFormGroup label="New album name" description="Create a new collection" :ui="{ label: 'font-medium text-sm text-slate-600' }">
          <UInput v-model="albumModalName" placeholder="E.g. Yosemite Trip" />
        </UFormGroup>
      </div>
        <div class="album-modal-actions">
          <UButton color="gray" variant="ghost" @click="closeAlbumModal">Cancel</UButton>
          <UButton color="primary" :disabled="!canConfirmAlbumModal" @click="confirmAlbumModal">
            Add photo
          </UButton>
        </div>
      </div>
    </template>
  </UModal>

  <DebugConsoleModal
      v-model="debugConsoleOpen"
      :has-bridge="hasBridge"
      :volumes="volumes"
      :scan-state="scanState"
      :selected-volume-id="selectedVolumeId"
      :scan-volume-label="scanVolumeLabel"
      :loading-volumes="loadingVolumes"
      :clearing-db="clearingDb"
      @load-volumes="loadVolumes"
      @clear-database="clearDatabase"
      @start-scan="startScan"
      @select-volume="selectVolume"
      @delete-volume-data="deleteVolumeData"
    />

    <PhotoViewerModal
      v-model="photoModalOpen"
      :photo="selectedPhoto"
      :photos="displayedAlbumPhotos"
      @details-saved="handlePhotoDetailsSaved"
      @navigate-photo="openPhotoModal"
    />
  </div>
</template>

<script setup>
import StatsCharts from '../components/StatsCharts.vue';
import FilterPanel from '../components/FilterPanel.vue';
import AlbumStream from '../components/AlbumStream.vue';
import TimelineRail from '../components/TimelineRail.vue';
import PhotoViewerModal from '../components/PhotoViewerModal.vue';
import DebugConsoleModal from '../components/DebugConsoleModal.vue';
import { usePhotoFilters } from '../composables/usePhotoFilters';
import { usePhotoFormatter } from '../composables/usePhotoFormatter';
import { usePhotoZoom } from '../composables/usePhotoZoom';
import { usePhotoLocation } from '../composables/usePhotoLocation';
import { createCollapseTransition } from '../utils/collapseTransition';

const nuxtApp = useNuxtApp();
const photoAlbum = computed(() => nuxtApp.$photoAlbum || null);
const isMacLayout = ref(false);

const VOLUME_SCOPE_ALL = 'scope:all';
const VOLUME_SCOPE_FAVORITES = 'scope:favorites';
const volumeScopeValueForId = (id) => (id != null ? `volume:${id}` : null);
const isVolumeScopeValue = (value) => typeof value === 'string' && value.startsWith('volume:');
const extractVolumeIdFromScope = (value) => (isVolumeScopeValue(value) ? value.split(':')[1] : null);

onMounted(() => {
  const platformLabel = navigator?.userAgent || navigator?.platform || '';
  isMacLayout.value = /mac/i.test(platformLabel);
});

const hasBridge = computed(() => Boolean(photoAlbum.value));

// Composables
const {
  formatBytes,
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

const {
  imageZoom,
  imagePan,
  imageTransformStyles,
  photoZoomContainerRef,
  photoZoomImageRef,
  zoomIn,
  zoomOut,
  resetZoom,
  handleWheelZoom,
  startImagePan,
  handleImagePan,
  endImagePan,
} = usePhotoZoom();

const {
  getPhotoLocation,
  lookupCityFromGps,
  formatLatLng,
  buildMapEmbedUrl,
} = usePhotoLocation();

const volumes = ref([]);
const selectedVolumeId = ref(null);
const showAllVolumes = ref(true);
const activeAiCollection = ref(null);
const activeCityCollection = ref(null);
const aiCollections = ref([]);
const cityCollections = ref([]);
const loadingAiCollections = ref(false);
const loadingCityCollections = ref(false);
const AI_COLLECTION_MIN_COUNT = 10;
const CITY_COLLECTION_MIN_COUNT = 10;
const { filterState, resetFilters, toPayload, setFilter, defaultLimit } = usePhotoFilters();
const FILTER_DEBOUNCE_MS = 350;
let filterFetchTimer = null;

const cameraCatalog = ref([]);
const lensCatalog = ref([]);

const scanState = ref({
  status: 'idle',
  totalFiles: 0,
  processedFiles: 0,
  volumeId: null,
});

const photos = ref([]);
const photosTotal = ref(0);
const hasFetchedPhotos = ref(false);
const stats = ref(null);
const albumPhotos = ref([]);
const albumTotalCount = ref(0);
const albumNextCursor = ref(null);
const albumLoading = ref(false);
const albumInitialLoad = ref(false);
const albumVisibleDateKey = ref(null);
const activePrimaryTab = ref('album');
const albumStreamRef = ref(null);
const albumPageSize = 200;
const albumCollections = ref([]);
const activeAlbumId = ref(null);
const lastUsedAlbumName = ref('');
const ALBUM_STORAGE_KEY = 'cardcatalog.albums';
const albumsLoadedFromStorage = ref(false);
const albumModalOpen = ref(false);
const albumModalPhoto = ref(null);
const albumModalSelectedId = ref(null);
const albumModalName = ref('');
const debugConsoleOpen = ref(false);
const filterExpanded = ref(false);
const sidebarExpanded = ref(true);
const sidebarCollapseTransition = createCollapseTransition({ duration: 260, opacityDuration: 200 });

const loadingVolumes = ref(false);
const loadingPhotos = ref(false);
const loadingStats = ref(false);
const clearingDb = ref(false);

const message = reactive({ text: '', tone: 'info' });
const collapsedCollections = reactive({
  albums: true,
  ai: true,
  cities: true,
});

let unsubscribeScan;
let unsubscribeVolumes;
let albumReloadTimer = null;
let globalSearchDebounce = null;

const cameraOptions = computed(() =>
  cameraCatalog.value.map((label) => ({ label, value: label })),
);
const lensOptions = computed(() =>
  lensCatalog.value.map((label) => ({ label, value: label })),
);
const volumeScopeOptions = computed(() => {
  const volumeItems = volumes.value.map((volume) => ({
    label: volume.displayLabel || volume.label || volume.id,
    value: volumeScopeValueForId(volume.id),
  }));

  const libraryScopeChoices = [
    {
      label: 'All Photos',
      value: VOLUME_SCOPE_ALL,
      icon: 'i-heroicons-rectangle-stack',
    },
    {
      label: 'Favorite Photos',
      value: VOLUME_SCOPE_FAVORITES,
      icon: 'i-heroicons-star',
    },
  ];

  if (!volumeItems.length) {
    return [libraryScopeChoices];
  }

  return [
    libraryScopeChoices,
    [
      { type: 'label', label: 'Volumes' },
      ...volumeItems,
    ],
  ];
});
const availableVolumeIds = computed(() => volumes.value.map((volume) => volume.id));
const albumCollectionOptions = computed(() =>
  albumCollections.value.map((album) => ({ label: album.name, value: album.id })),
);
const canConfirmAlbumModal = computed(() => Boolean(albumModalName.value.trim() || albumModalSelectedId.value));

const scanVolumeLabel = computed(() => getVolumeLabel(scanState.value.volumeId));
const scanCountsLabel = computed(
  () => `${scanState.value.processedFiles ?? 0} / ${scanState.value.totalFiles ?? 0} files`,
);
const statusIntent = computed(() => {
  switch (scanState.value.status) {
    case 'completed':
      return 'green';
    case 'error':
      return 'red';
    case 'scanning':
      return 'amber';
    case 'stopping':
      return 'amber';
    case 'stopped':
      return 'gray';
    default:
      return 'gray';
  }
});
const progressPercent = computed(() => {
  const total = scanState.value.totalFiles || 0;
  if (!total) {
    return scanState.value.status === 'completed' ? 100 : 0;
  }
  return Math.min(Math.round((scanState.value.processedFiles / total) * 100), 100);
});
const canResumeCurrentScan = computed(() => {
  return (
    scanState.value.status === 'stopped' &&
    Boolean(scanState.value.volumeId) &&
    scanState.value.volumeId === filterState.volumeId
  );
});

const isFavoritesScope = computed(() => showAllVolumes.value && Boolean(filterState.favoritesOnly));

const volumeScopeModel = computed({
  get: () => {
    if (isFavoritesScope.value) {
      return VOLUME_SCOPE_FAVORITES;
    }
    if (showAllVolumes.value) {
      return VOLUME_SCOPE_ALL;
    }
    return selectedVolumeId.value ? volumeScopeValueForId(selectedVolumeId.value) : null;
  },
  set: (value) => {
    if (value === VOLUME_SCOPE_FAVORITES) {
      activateFavoriteScope();
      return;
    }
    if (value === VOLUME_SCOPE_ALL || value == null) {
      activateAllVolumesScope();
      return;
    }
    if (isVolumeScopeValue(value)) {
      const volumeId = extractVolumeIdFromScope(value);
      if (volumeId) {
        selectVolume(volumeId);
      }
    }
  },
});

const photoModalOpen = ref(false);
const selectedPhoto = ref(null);
const showInfoPanel = ref(true);
const globalSearchQuery = ref('');
const isSemanticSearchMode = computed(() => Boolean(filterState.semanticSearch));
const searchModeTooltip = computed(() => (
  isSemanticSearchMode.value
    ? 'Context search uses CLIP embeddings for semantic matches'
    : 'Regular search matches filenames, tags, descriptions, cities, and AI labels'
));

const RAW_FORMATS = ['arw', 'cr2', 'cr3', 'nef', 'orf', 'raf', 'rw2', 'dng', 'srw'];
const activeAlbum = computed(() => albumCollections.value.find((album) => album.id === activeAlbumId.value) || null);
const isAlbumCollectionView = computed(() => Boolean(activeAlbum.value));
const isCityCollectionView = computed(() => Boolean(activeCityCollection.value));
const displayedAlbumPhotos = computed(() => (activeAlbum.value ? activeAlbum.value.photos : albumPhotos.value));
const albumCollectionsDisplay = computed(() =>
  [...albumCollections.value].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
);
const albumHasMore = computed(() => !isAlbumCollectionView.value && Boolean(albumNextCursor.value));
const albumLoadedCountLabel = computed(() => {
  const source = displayedAlbumPhotos.value;
  if (!source.length) {
    return isAlbumCollectionView.value ? 'Album is empty' : 'No photos loaded';
  }
  if (isAlbumCollectionView.value) {
    return `${source.length.toLocaleString()} photos in album`;
  }
  const loaded = source.length.toLocaleString();
  const total = albumTotalCount.value ? albumTotalCount.value.toLocaleString() : null;
  if (total) {
    return `${loaded} / ${total} photos`;
  }
  return `${loaded} photos`;
});
const albumEmptyMessage = computed(() => {
  if (!filterState.volumeId && !showAllVolumes.value && !isAlbumCollectionView.value) {
    return 'Choose a library view to start browsing.';
  }
  if (!albumInitialLoad.value && albumLoading.value) {
    return 'Preparing album...';
  }
  if (!displayedAlbumPhotos.value.length) {
    if (isAlbumCollectionView.value) {
      return 'This album does not have any photos yet.';
    }
    if (isFavoritesScope.value) {
      return 'No favorite photos yet. Rate shots 4+ stars to feature them here.';
    }
    if (isCityCollectionView.value) {
      return 'No photos found for this city yet.';
    }
    if (showAllVolumes.value) {
      return 'No photos found across all volumes.';
    }
    return 'No photos match your filters yet.';
  }
  return '';
});
const timelineData = computed(() => {
  if (isAlbumCollectionView.value) {
    return buildTimelineFromPhotos(displayedAlbumPhotos.value);
  }
  const timeline = stats.value?.timeline;
  if (timeline && Object.keys(timeline).length) {
    return timeline;
  }
  return buildTimelineFromPhotos(albumPhotos.value);
});
const albumSummaryDateRange = computed(() => {
  if (!stats.value?.dateRange) {
    return '';
  }
  const { earliestShoot, latestShoot } = stats.value.dateRange;
  if (!earliestShoot && !latestShoot) {
    return '';
  }
  const start = earliestShoot ? formatDateOnly(earliestShoot) : 'Unknown';
  const end = latestShoot ? formatDateOnly(latestShoot) : 'Unknown';
  return `${start} → ${end}`;
});

const navigationItems = [
  {
    label: 'Album',
    value: 'album',
    icon: 'i-heroicons-photo',
  },
  {
    label: 'Collections',
    value: 'collections',
    icon: 'i-heroicons-folder-open',
  },
  {
    label: 'Statistics',
    value: 'statistics',
    icon: 'i-heroicons-chart-bar-square',
  },
];

watch(
  () => filterState.searchText,
  (value) => {
    const next = value || '';
    if (next !== globalSearchQuery.value) {
      globalSearchQuery.value = next;
    }
  },
  { immediate: true },
);

watch(
  displayedAlbumPhotos,
  (list) => {
    if (!selectedPhoto.value) {
      return;
    }
    const stillExists = list.some((photo) => photo.id === selectedPhoto.value.id);
    if (!stillExists) {
      closePhotoModal();
    }
  },
  { deep: true },
);

watch(
  () => globalSearchQuery.value,
  (value, prev) => {
    if (value === prev) {
      return;
    }
    if (globalSearchDebounce) {
      clearTimeout(globalSearchDebounce);
    }
    globalSearchDebounce = setTimeout(() => {
      setFilter('searchText', value || '');
    }, 300);
  },
);

watch(filterExpanded, (isExpanded) => {
  sidebarExpanded.value = !isExpanded;
});

const selectedPhotoLocation = computed(() => {
  if (!selectedPhoto.value) {
    return null;
  }
  return getPhotoLocation(selectedPhoto.value);
});

const galleryEmptyMessage = computed(() => {
  if (isAlbumCollectionView.value) {
    const album = activeAlbum.value;
    if (!album) {
      return 'Select an album to view photos.';
    }
    if (!album.photos.length) {
      return 'This album is empty.';
    }
  }
  if (!filterState.volumeId) {
    return showAllVolumes.value
      ? 'Choose filters to find matching photos.'
      : 'Select a library view to load photos.';
  }
  if (loadingPhotos.value) {
    return 'Loading photos...';
  }
  if (!hasFetchedPhotos.value) {
    return 'Adjust filters or click Load Photos.';
  }
  if (!photosTotal.value) {
    return 'No photos match your current filters.';
  }
  return 'No photos on this page. Try a different page or filter.';
});
watch(
  filterState,
  () => {
    if (!hasBridge.value || (!filterState.volumeId && !showAllVolumes.value)) {
      return;
    }
    scheduleFilterRefresh();
    scheduleAlbumReload();
  },
  { deep: true },
);

watch(
  () => filterState.volumeId,
  (volumeId) => {
    if (activeAlbumId.value) {
      activeAlbumId.value = null;
    }
    if (!volumeId && !showAllVolumes.value) {
      photos.value = [];
      photosTotal.value = 0;
      hasFetchedPhotos.value = false;
      resetAlbumStream();
    }
    if (!isAlbumCollectionView.value && (volumeId || showAllVolumes.value) && activePrimaryTab.value === 'album') {
      scheduleAlbumReload(true);
    }
  },
);

watch(
  () => showAllVolumes.value,
  (isAllVolumes) => {
    if (!hasBridge.value) {
      return;
    }
    if (!isAllVolumes && activeAlbumId.value) {
      activeAlbumId.value = null;
    }
    // When toggling All Volumes mode, trigger reload
    if (!isAlbumCollectionView.value && (isAllVolumes || filterState.volumeId)) {
      scheduleFilterRefresh(true);
      if (activePrimaryTab.value === 'album') {
        scheduleAlbumReload(true);
      }
    }
  },
  { immediate: true },
);

watch(
  () => stats.value,
  (next) => {
    if (!next) {
      return;
    }
    mergeFacetOptions(cameraCatalog, next.byCameraModel);
    mergeFacetOptions(lensCatalog, next.byLensModel);
  },
);

watch(
  albumCollections,
  (value) => {
    if (activeAlbumId.value && !value.some((album) => album.id === activeAlbumId.value)) {
      activeAlbumId.value = null;
    }
    if (albumsLoadedFromStorage.value) {
      persistAlbumCollections(value);
    }
  },
  { deep: true },
);

watch(albumModalOpen, (isOpen) => {
  if (!isOpen) {
    albumModalPhoto.value = null;
    albumModalSelectedId.value = null;
    albumModalName.value = '';
  }
});

watch(
  hasBridge,
  (isReady) => {
    if (!isReady) {
      return;
    }
    if (showAllVolumes.value) {
      scheduleFilterRefresh(true);
      if (activePrimaryTab.value === 'album') {
        scheduleAlbumReload(true);
      }
    }
  },
  { immediate: true },
);

watch(
  activePrimaryTab,
  (tab) => {
    if (tab === 'album') {
      if (!isAlbumCollectionView.value && !albumPhotos.value.length && (filterState.volumeId || showAllVolumes.value)) {
        scheduleAlbumReload(true);
      }
    } else if (tab === 'statistics') {
      ensureStatsData();
    } else if (tab === 'collections') {
      loadAiCollections();
      loadCityCollections();
    }
  },
  { immediate: true },
);

watch(
  () => ({
    status: scanState.value.status,
    volumeId: scanState.value.volumeId,
  }),
  (next, prev) => {
    if (!next.volumeId) {
      return;
    }
    const prevStatus = prev?.status;
    const prevVolume = prev?.volumeId;
    const justCompleted =
      next.status === 'completed' && (prevStatus !== 'completed' || prevVolume !== next.volumeId);
    if (justCompleted && (filterState.volumeId === next.volumeId || showAllVolumes.value)) {
      scheduleAlbumReload(true);
    }
    
    // Auto-reload album while scanning
    if (next.status === 'scanning' && (filterState.volumeId === next.volumeId || showAllVolumes.value)) {
      // Debounce the reload to avoid UI stutter
      if (!albumReloadTimer) {
        scheduleAlbumReload();
      }
    }
  },
);

watch(
  photos,
  (list) => {
    if (!selectedPhoto.value) {
      return;
    }
    const stillExists = list.some((photo) => photo.id === selectedPhoto.value.id);
    if (!stillExists) {
      closePhotoModal();
    }
  },
  { deep: true },
);

watch(photoModalOpen, (isOpen) => {
  if (!isOpen) {
    selectedPhoto.value = null;
    showInfoPanel.value = true;
    resetZoom();
  }
});


const canScanVolume = (volume) => Boolean(
  volume && (volume.isRemovable || volume.isLikelySdCard || volume.isManual),
);

function setMessage(text, tone = 'info') {
  message.text = text;
  message.tone = tone;
  setTimeout(() => {
    if (message.text === text) {
      message.text = '';
    }
  }, 4000);
}

function toggleSearchMode() {
  const next = !isSemanticSearchMode.value;
  setFilter('semanticSearch', next);
  setMessage(next ? 'Context search enabled.' : 'Regular search enabled.', 'info');
}

function toggleCollectionsSection(sectionKey) {
  if (!(sectionKey in collapsedCollections)) {
    return;
  }
  collapsedCollections[sectionKey] = !collapsedCollections[sectionKey];
}

function mergeFacetOptions(targetRef, buckets = {}) {
  if (!buckets) {
    return;
  }
  const current = Array.isArray(targetRef.value) ? targetRef.value : [];
  const merged = new Set(current);
  Object.keys(buckets).forEach((key) => {
    if (key) {
      merged.add(key);
    }
  });
  targetRef.value = Array.from(merged).sort((a, b) => a.localeCompare(b));
}

function clearFacetOptions() {
  cameraCatalog.value = [];
  lensCatalog.value = [];
  photosTotal.value = 0;
  hasFetchedPhotos.value = false;
}

function openPhotoModal(photo) {
  if (!photo) {
    return;
  }
  const normalized = normalizePhotoFromServer(photo);
  if (!normalized) {
    return;
  }
  selectedPhoto.value = {
    ...normalized,
    tags: Array.isArray(normalized.tags) ? [...normalized.tags] : [],
  };
  photoModalOpen.value = true;
  showInfoPanel.value = true;
  resetZoom();
}

function closePhotoModal() {
  photoModalOpen.value = false;
  selectedPhoto.value = null;
  showInfoPanel.value = true;
  resetZoom();
}

function toggleInfoPanel() {
  showInfoPanel.value = !showInfoPanel.value;
}

function handlePhotoDetailsSaved(payload) {
  if (!payload || !payload.id) {
    return;
  }
  const description = typeof payload.description === 'string'
    ? payload.description.trim()
    : payload.description ?? '';
  const tags = Array.isArray(payload.tags) ? payload.tags : [];
  const rating = normalizeRatingValue(payload.rating);
  applyPhotoPatch(payload.id, {
    description: description || null,
    tags,
    rating,
  });
  setMessage('Details saved.', 'success');
}

async function togglePhotoFavorite(photo) {
  if (!photoAlbum.value) {
    setMessage('Electron bridge unavailable.', 'error');
    return;
  }
  if (!photo) {
    return;
  }
  try {
    const currentRating = photo.rating || 0;
    const newRating = currentRating >= 4 ? null : 5;

    await photoAlbum.value.updatePhotoDetails(photo.id, {
      rating: newRating,
    });

    applyPhotoPatch(photo.id, {
      rating: newRating,
    });

    setMessage(newRating ? 'Added to favorites' : 'Removed from favorites', 'success');
  } catch (error) {
    console.error('[togglePhotoFavorite] Error:', error);
    setMessage('Unable to update favorite status.', 'error');
  }
}

async function handleCopyPhotoAction(photo) {
  if (!photo) {
    return;
  }
  if (!photoAlbum.value) {
    setMessage('Electron bridge unavailable.', 'error');
    return;
  }
  const filePath = photo.filePath || photo.file_path;
  if (!filePath) {
    setMessage('Photo path unavailable.', 'error');
    return;
  }
  try {
    await photoAlbum.value.copyImageToClipboard(filePath);
    setMessage('Copied photo to clipboard.', 'success');
  } catch (error) {
    console.error('[handleCopyPhotoAction] Error:', error);
    setMessage('Unable to copy photo.', 'error');
  }
}

function handleRemoveFromAlbum(photo) {
  if (!activeAlbumId.value || !photo) return;
  
  const album = albumCollections.value.find(a => a.id === activeAlbumId.value);
  if (!album) return;

  const updatedAlbum = {
    ...album,
    photos: album.photos.filter(p => p.id !== photo.id)
  };
  
  // Update cover if needed
  if (updatedAlbum.coverPhotoId === photo.id) {
    updatedAlbum.coverPhotoId = updatedAlbum.photos[0]?.id || null;
  }

  albumCollections.value = albumCollections.value.map(a => 
    a.id === album.id ? updatedAlbum : a
  );
  
  setMessage('Removed from album', 'success');
}

function handleDeleteAlbum(albumId) {
  if (!confirm('Are you sure you want to delete this album?')) return;
  
  albumCollections.value = albumCollections.value.filter(a => a.id !== albumId);
  if (activeAlbumId.value === albumId) {
    activeAlbumId.value = null;
  }
  setMessage('Album deleted', 'success');
}

function handleAddPhotoToAlbum(photo) {
  if (!photo) {
    return;
  }
  albumModalPhoto.value = { ...photo };
  const lastAlbumMatch = lastUsedAlbumName.value
    ? albumCollections.value.find((album) => album.name === lastUsedAlbumName.value)
    : null;
  albumModalSelectedId.value = (lastAlbumMatch || albumCollections.value[0] || null)?.id || null;
  albumModalName.value = albumCollectionOptions.value.length ? '' : (lastUsedAlbumName.value || 'My album');
  albumModalOpen.value = true;
}

function confirmAlbumModal() {
  if (!albumModalPhoto.value) {
    setMessage('Select a photo first.', 'error');
    return;
  }
  const trimmed = albumModalName.value.trim();
  if (trimmed) {
    addPhotoToAlbumCollectionByName(trimmed, albumModalPhoto.value);
    closeAlbumModal();
    return;
  }
  if (albumModalSelectedId.value) {
    addPhotoToAlbumCollectionById(albumModalSelectedId.value, albumModalPhoto.value);
    closeAlbumModal();
    return;
  }
  setMessage('Enter or select an album first.', 'error');
}

function closeAlbumModal() {
  albumModalOpen.value = false;
}

function addPhotoToAlbumCollectionById(albumId, photo) {
  if (!albumId || !photo) {
    return;
  }
  const target = albumCollections.value.find((album) => album.id === albumId);
  if (!target) {
    setMessage('Album not found.', 'error');
    return;
  }
  if (target.photos.some((item) => item.id === photo.id)) {
    setMessage('Photo already in album.', 'info');
    return;
  }
  const updatedAlbum = {
    ...target,
    photos: [{ ...photo }, ...target.photos],
    coverPhotoId: target.coverPhotoId || photo.id,
  };
  albumCollections.value = albumCollections.value.map((album) => (album.id === updatedAlbum.id ? updatedAlbum : album));
  lastUsedAlbumName.value = target.name;
  setMessage(`Added to ${target.name}`, 'success');
}

function addPhotoToAlbumCollectionByName(name, photo) {
  if (!name || !photo) {
    return;
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return;
  }
  const normalizedKey = trimmed.toLowerCase();
  let existing = albumCollections.value.find((album) => album.name.toLowerCase() === normalizedKey);
  if (!existing) {
    existing = {
      id: createAlbumId(trimmed),
      name: trimmed,
      createdAt: Date.now(),
      photos: [],
      coverPhotoId: null,
    };
    albumCollections.value = [...albumCollections.value, existing];
  }
  addPhotoToAlbumCollectionById(existing.id, photo);
}

function viewAlbumCollection(albumId) {
  if (!albumId) {
    return;
  }
  activeAlbumId.value = albumId;
  albumVisibleDateKey.value = null;
  activePrimaryTab.value = 'album';
}

function clearAlbumView() {
  activeAlbumId.value = null;
  albumVisibleDateKey.value = null;
}

function getAlbumCoverUrl(album) {
  if (!album || !Array.isArray(album.photos) || !album.photos.length) {
    return '';
  }
  const cover = album.photos.find((photo) => photo.id === album.coverPhotoId) || album.photos[0];
  return getThumbnailUrl(cover);
}

function getAiCollectionThumbnail(collection) {
  const latest = collection?.latestPhoto || null;
  if (!latest) {
    return null;
  }
  if (latest.thumbnailPath) {
    return toFileUrl(latest.thumbnailPath);
  }
  if (latest.filePath) {
    return toFileUrl(latest.filePath);
  }
  return null;
}

function getCityCollectionThumbnail(collection) {
  const latest = collection?.latestPhoto || null;
  if (!latest) {
    return null;
  }
  if (latest.thumbnailPath) {
    return toFileUrl(latest.thumbnailPath);
  }
  if (latest.filePath) {
    return toFileUrl(latest.filePath);
  }
  return null;
}

function scheduleAlbumReload(immediate = false) {
  if (isAlbumCollectionView.value) {
    return;
  }
  if (!hasBridge.value || (!filterState.volumeId && !showAllVolumes.value)) {
    return;
  }
  if (activePrimaryTab.value !== 'album' && !immediate) {
    return;
  }
  // Prevent auto-reload if photo modal is open to avoid closing it or jarring UX
  if (photoModalOpen.value) {
    return;
  }
  if (albumReloadTimer) {
    clearTimeout(albumReloadTimer);
    albumReloadTimer = null;
  }
  const run = () => {
    loadAlbumPage({ refreshStats: true, replace: true });
  };
  if (immediate) {
    run();
    return;
  }
  albumReloadTimer = setTimeout(() => {
    albumReloadTimer = null;
    run();
  }, FILTER_DEBOUNCE_MS);
}

function resetAlbumStream() {
  albumPhotos.value = [];
  albumTotalCount.value = 0;
  albumNextCursor.value = null;
  albumVisibleDateKey.value = null;
  albumInitialLoad.value = false;
}

async function loadAlbumPage(options = {}) {
  if (isAlbumCollectionView.value) {
    return false;
  }
  if (!photoAlbum.value || albumLoading.value) {
    return false;
  }
  if (!filterState.volumeId && !showAllVolumes.value) {
    return false;
  }

  const isReload = options.replace || false;

  const payload = {
    ...toPayload(),
    limit: options.limit ?? albumPageSize,
    sortBy: options.sortBy || 'date_desc',
  };
  
  if (isReload) {
    payload.cursor = null;
    payload.offset = 0;
    // Reset visible date key on reload so we jump to the top/newest
    albumVisibleDateKey.value = null;
  } else if (albumNextCursor.value != null) {
    payload.cursor = albumNextCursor.value;
    delete payload.offset;
  } else {
    payload.cursor = null;
    payload.offset = 0;
  }

  albumLoading.value = true;
  let fetched = false;
  try {
    const response = await photoAlbum.value.fetchPhotos(payload);
    const items = Array.isArray(response?.photos)
      ? response.photos
      : Array.isArray(response?.items)
        ? response.items
        : response?.rows || [];
    const normalized = items.map((item) => normalizePhotoFromServer(item)).filter(Boolean);
    
    if (isReload) {
      albumPhotos.value = normalized;
    } else {
      albumPhotos.value = albumPhotos.value.concat(normalized);
    }

    if (normalized.length) {
      fetched = true;
    }
    if (!albumVisibleDateKey.value && albumPhotos.value.length) {
      albumVisibleDateKey.value = formatDayKeyFromValue(albumPhotos.value[0]?.shootDateTime);
    }
    albumTotalCount.value = typeof response?.totalCount === 'number'
      ? response.totalCount
      : typeof response?.total === 'number'
        ? response.total
        : albumPhotos.value.length;
    const nextCursor = response?.nextCursor ?? response?.nextOffset;
    albumNextCursor.value = nextCursor != null ? String(nextCursor) : null;
    albumInitialLoad.value = true;
    if (
      options.refreshStats ||
      !stats.value ||
      stats.value.volumeId !== payload.volumeId
    ) {
      await fetchStats({ filter: payload, silent: true });
    }
  } catch (error) {
    console.error('[loadAlbumPage] Error:', error);
    setMessage('Unable to load album.', 'error');
  } finally {
    albumLoading.value = false;
  }
  return fetched;
}

function handleAlbumLoadMore() {
  if (isAlbumCollectionView.value || !albumHasMore.value || albumLoading.value) {
    return;
  }
  loadAlbumPage();
}

const hasPhotoForDateKey = (dateKey) => {
  if (!dateKey) {
    return false;
  }
  const source = isAlbumCollectionView.value ? displayedAlbumPhotos.value : albumPhotos.value;
  return source.some((photo) => formatDayKeyFromValue(photo?.shootDateTime) === dateKey);
};

function waitForAlbumIdle() {
  if (!albumLoading.value) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const stop = watch(
      albumLoading,
      (loading) => {
        if (!loading) {
          stop();
          resolve();
        }
      },
      { immediate: false },
    );
  });
}

function createAlbumId(name = 'album') {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'album';
  return `${slug}-${Date.now().toString(36)}`;
}

function normalizeAlbumFromStorage(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const photos = Array.isArray(entry.photos) ? entry.photos : [];
  return {
    id: entry.id || createAlbumId(entry.name || 'album'),
    name: entry.name || 'Untitled album',
    createdAt: entry.createdAt || Date.now(),
    coverPhotoId: entry.coverPhotoId || (photos[0]?.id ?? null),
    photos,
  };
}

function loadAlbumCollectionsFromStorage() {
  if (albumsLoadedFromStorage.value || typeof window === 'undefined') {
    return;
  }
  const raw = window.localStorage.getItem(ALBUM_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const normalized = parsed.map((entry) => normalizeAlbumFromStorage(entry)).filter(Boolean);
        albumCollections.value = normalized;
      }
    } catch (error) {
      console.warn('Failed to parse stored albums', error);
    }
  }
  albumsLoadedFromStorage.value = true;
}

function persistAlbumCollections(value) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(ALBUM_STORAGE_KEY, JSON.stringify(value));
  } catch (error) {
    console.warn('Failed to persist albums', error);
  }
}

async function ensurePhotosCoverDate(dateKey) {
  if (isAlbumCollectionView.value) {
    return hasPhotoForDateKey(dateKey);
  }
  const MAX_BATCHES = 30;
  let batches = 0;
  while (!hasPhotoForDateKey(dateKey) && albumHasMore.value && batches < MAX_BATCHES) {
    await waitForAlbumIdle();
    const fetched = await loadAlbumPage();
    if (!fetched) {
      break;
    }
    batches += 1;
  }
  return hasPhotoForDateKey(dateKey);
}

async function handleTimelineJump(dateKey) {
  if (!dateKey) {
    return;
  }
  const ensureAvailable = hasPhotoForDateKey(dateKey)
    ? Promise.resolve(true)
    : ensurePhotosCoverDate(dateKey);
  const available = await ensureAvailable;
  if (!available) {
    setMessage('No photos available for that date yet.', 'info');
    return;
  }
  if (!albumStreamRef.value) {
    console.warn('[index.vue] Album stream ref not available');
    return;
  }
  albumStreamRef.value.scrollToDateKey(dateKey);
}

function handleVisibleDateChange(dateKey) {
  if (!dateKey) {
    return;
  }
  albumVisibleDateKey.value = dateKey;
}

function ensureStatsData(options = {}) {
  if (!hasBridge.value || (!filterState.volumeId && !showAllVolumes.value)) {
    return;
  }
  if (loadingStats.value) {
    return;
  }
  // In All Volumes mode, check if stats.volumeId is null, otherwise check if it matches
  const statsMatches = showAllVolumes.value
    ? stats.value?.volumeId === null
    : stats.value?.volumeId === filterState.volumeId;

  if (!options.force && stats.value && statsMatches) {
    return;
  }
  fetchStats({ silent: options.silent !== false });
}

function openOriginalFile() {
  if (!selectedPhoto.value) {
    return;
  }
  const url = getFullImageUrl(selectedPhoto.value);
  if (url) {
    window.open(url, '_blank');
  } else {
    setMessage('Full-size image unavailable for this photo.', 'error');
  }
}

function openRawFile() {
  if (!selectedPhoto.value || !selectedPhoto.value.rawFilePath) {
    return;
  }
  const url = toFileUrl(selectedPhoto.value.rawFilePath);
  if (url) {
    window.open(url, '_blank');
  } else {
    setMessage('RAW file unavailable.', 'error');
  }
}

function applyVolumeScopeChange({ volumeId = null, favoritesOnly = false, aiLabel = null, cityLabel = null, cityLocations = [], message = null } = {}) {
  selectedVolumeId.value = volumeId;
  showAllVolumes.value = !volumeId || favoritesOnly || Boolean(aiLabel) || Boolean(cityLabel);
  activeAiCollection.value = aiLabel || null;
  activeCityCollection.value = cityLabel || null;
  if (activeAlbumId.value) {
    activeAlbumId.value = null;
  }
  stats.value = null;
  photos.value = [];
  clearFacetOptions();
  hasFetchedPhotos.value = false;
  resetFilters(volumeId);
  if (favoritesOnly) {
    setFilter('favoritesOnly', true);
  }
  setFilter('aiLabel', aiLabel || null);
  if (cityLabel) {
    const variants = Array.isArray(cityLocations) && cityLocations.length ? cityLocations : [cityLabel];
    setFilter('locationIds', variants);
  } else {
    setFilter('locationIds', []);
  }
  resetAlbumStream();
  if (message) {
    setMessage(message, 'info');
  }
  if (hasBridge.value) {
    scheduleFilterRefresh(true);
    if (activePrimaryTab.value === 'album') {
      scheduleAlbumReload(true);
    }
  }
}

function selectVolume(id) {
  applyVolumeScopeChange({ volumeId: id });
}

function activateAllVolumesScope() {
  applyVolumeScopeChange({ volumeId: null, favoritesOnly: false, message: 'Viewing photos from all volumes' });
}

function activateFavoriteScope() {
  applyVolumeScopeChange({ volumeId: null, favoritesOnly: true, message: 'Viewing favorite photos' });
  activePrimaryTab.value = 'album';
}

function activateAiCollection(label) {
  if (!label) {
    activateAllVolumesScope();
    return;
  }
  applyVolumeScopeChange({
    volumeId: null,
    favoritesOnly: false,
    aiLabel: label,
    message: `Viewing photos tagged "${label}"`,
  });
  activePrimaryTab.value = 'album';
}

function viewAiCollection(label) {
  activateAiCollection(label);
}

function activateCityCollection(collection) {
  const label = typeof collection === 'string' ? collection : collection?.label;
  const cityLocations = Array.isArray(collection?.locationLabels) ? collection.locationLabels : [];
  if (!label) {
    activateAllVolumesScope();
    return;
  }
  applyVolumeScopeChange({
    volumeId: null,
    favoritesOnly: false,
    cityLabel: label,
    cityLocations,
    message: `Viewing photos from ${label}`,
  });
  activePrimaryTab.value = 'album';
}

function viewCityCollection(collection) {
  activateCityCollection(collection);
}

async function chooseFolderVolume() {
  if (!photoAlbum.value) {
    setMessage('Electron bridge unavailable.', 'error');
    return;
  }
  try {
    const result = await photoAlbum.value.pickFolderVolume();
    if (!result || !result.id) {
      return;
    }
    selectVolume(result.id);
    setMessage(`Ready to scan ${result.displayLabel || result.label || 'selected folder'}.`, 'info');
    await startScan(result.id);
  } catch (error) {
    console.error('[chooseFolderVolume] Error:', error);
    setMessage(error.message || 'Unable to add folder.', 'error');
  }
}

async function deleteVolumeData(volumeId) {
  if (!volumeId) {
    return;
  }

  const volume = volumes.value.find(v => v.id === volumeId);
  const volumeLabel = volume?.displayLabel || volume?.label || volumeId;

  const confirmed = confirm(
    `Delete all photos for "${volumeLabel}" from the database?\n\n` +
    `This will remove all photo records for this volume from the database, ` +
    `but will NOT delete the actual files on disk.\n\n` +
    `You can re-scan the volume to add the photos back.\n\n` +
    `Continue?`
  );

  if (!confirmed) {
    return;
  }

  try {
    const result = await photoAlbum.value.deleteVolumeData(volumeId);
    const count = result?.deletedCount || 0;
    setMessage(`Deleted ${count} photo record(s) for "${volumeLabel}"`, 'info');

    // Reload the current view if this is the selected volume
    if (volumeId === selectedVolumeId.value) {
      stats.value = null;
      photos.value = [];
      albumPhotos.value = [];
      photosTotal.value = 0;
      albumTotalCount.value = 0;
      hasFetchedPhotos.value = false;
      resetAlbumStream();

      if (hasBridge.value) {
        scheduleFilterRefresh(true);
        if (activePrimaryTab.value === 'album') {
          scheduleAlbumReload(true);
        }
      }
    } else if (showAllVolumes.value) {
      // If in All Volumes mode, reload to reflect the deletion
      if (hasBridge.value && activePrimaryTab.value === 'album') {
        scheduleAlbumReload(true);
      }
    }
  } catch (error) {
    console.error('[deleteVolumeData] Error:', error);
    setMessage(error.message || 'Failed to delete volume data.', 'error');
  }
}

async function loadVolumes() {
  if (!photoAlbum.value) {
    setMessage('Electron bridge unavailable.', 'error');
    return;
  }
  loadingVolumes.value = true;
  try {
    const list = await photoAlbum.value.listVolumes();
    volumes.value = list;
    if (!list.length) {
      selectedVolumeId.value = null;
      resetFilters(null);
      photos.value = [];
      photosTotal.value = 0;
      stats.value = null;
      hasFetchedPhotos.value = false;
      activeAiCollection.value = null;
      activeCityCollection.value = null;
      aiCollections.value = [];
      cityCollections.value = [];
      return;
    }
    const hasSelection = Boolean(filterState.volumeId);
    const selectedExists = hasSelection && list.some((vol) => vol.id === filterState.volumeId);
    if (!hasSelection && !showAllVolumes.value) {
      selectVolume(list[0].id);
    } else if (hasSelection && !selectedExists) {
      selectVolume(list[0].id);
    }
  } catch (error) {
    console.error(error);
    setMessage('Failed to load volumes.', 'error');
  } finally {
    loadingVolumes.value = false;
  }
}

async function loadAiCollections() {
  if (!photoAlbum.value) {
    return;
  }
  loadingAiCollections.value = true;
  try {
    const list = await photoAlbum.value.fetchAiCollections({ minCount: AI_COLLECTION_MIN_COUNT });
    aiCollections.value = Array.isArray(list) ? list : [];
    if (
      activeAiCollection.value &&
      !aiCollections.value.some((entry) => entry.label === activeAiCollection.value)
    ) {
      activeAiCollection.value = null;
      setFilter('aiLabel', null);
    }
  } catch (error) {
    console.error('[loadAiCollections] Error:', error);
  } finally {
    loadingAiCollections.value = false;
  }
}

async function loadCityCollections() {
  if (!photoAlbum.value) {
    return;
  }
  loadingCityCollections.value = true;
  try {
    const list = await photoAlbum.value.fetchCityCollections({ minCount: CITY_COLLECTION_MIN_COUNT });
    cityCollections.value = Array.isArray(list) ? list : [];
    if (
      activeCityCollection.value &&
      !cityCollections.value.some((entry) => entry.label === activeCityCollection.value)
    ) {
      activeCityCollection.value = null;
      setFilter('locationIds', []);
    }
  } catch (error) {
    console.error('[loadCityCollections] Error:', error);
  } finally {
    loadingCityCollections.value = false;
  }
}

async function startScan(volumeId) {
  if (!photoAlbum.value) {
    setMessage('Electron bridge unavailable.', 'error');
    return;
  }
  const target = volumeId || selectedVolumeId.value;
  if (!target) {
    setMessage('Select a volume before scanning.', 'error');
    return;
  }
  try {
    await photoAlbum.value.startScan(target);
    setMessage('Scan started.', 'success');
  } catch (error) {
    console.error(error);
    setMessage(error.message || 'Failed to start scan.', 'error');
  }
}

async function stopScan() {
  if (!photoAlbum.value) {
    return;
  }
  try {
    await photoAlbum.value.stopScan();
    setMessage('Scan stopping...', 'info');
  } catch (error) {
    console.error(error);
    setMessage('Failed to stop scan.', 'error');
  }
}

async function resumeScan() {
  const targetVolumeId = scanState.value.volumeId || filterState.volumeId;
  if (!targetVolumeId) {
    setMessage('Select a volume before resuming scan.', 'error');
    return;
  }
  await startScan(targetVolumeId);
}

async function fetchPhotos(options = {}) {
  if (!photoAlbum.value) {
    return;
  }
  const silent = Boolean(options.silent);
  const filterPayload = options.filter || toPayload();
  if (!filterPayload.volumeId && !showAllVolumes.value) {
    if (!silent) {
      setMessage('Choose a library view before loading photos.', 'error');
    }
    return;
  }
  loadingPhotos.value = true;
  try {
    const response = await photoAlbum.value.fetchPhotos(filterPayload);
    const responseItems = Array.isArray(response?.photos)
      ? response.photos
      : Array.isArray(response?.items)
        ? response.items
        : response?.rows || [];
    const total = typeof response?.totalCount === 'number'
      ? response.totalCount
      : typeof response?.total === 'number'
        ? response.total
        : responseItems.length;
    const normalizedItems = responseItems
      .map((item) => normalizePhotoFromServer(item))
      .filter((item) => Boolean(item));
    photos.value = normalizedItems;
    photosTotal.value = total;
    hasFetchedPhotos.value = true;
    if (!silent) {
      setMessage(`Fetched ${responseItems.length} photo(s).`, 'success');
    }
  } catch (error) {
    console.error('[fetchPhotos] Error:', error);
    if (!silent) {
      setMessage('Unable to load photos.', 'error');
    }
  } finally {
    loadingPhotos.value = false;
  }
}

async function clearDatabase() {
  if (!photoAlbum.value) {
    return;
  }
  clearingDb.value = true;
  try {
    await photoAlbum.value.clearDatabase();
    photos.value = [];
    stats.value = null;
    clearFacetOptions();
    setMessage('Database cleared.', 'success');
    await loadVolumes();
  } catch (error) {
    console.error(error);
    setMessage('Failed to clear database.', 'error');
  } finally {
    clearingDb.value = false;
  }
}

async function fetchStats(options = {}) {
  if (!photoAlbum.value) {
    return;
  }
  const silent = Boolean(options.silent);
  const filterPayload = options.filter || toPayload();
  // Allow volumeId to be null for All Volumes mode
  if (!filterPayload.volumeId && !showAllVolumes.value) {
    if (!silent) {
      setMessage('Choose a library view for stats.', 'error');
    }
    return;
  }
  loadingStats.value = true;
  try {
    const result = await photoAlbum.value.fetchStats(filterPayload);
    stats.value = result;
    if (!silent) {
      setMessage('Stats loaded.', 'success');
    }
  } catch (error) {
    console.error('[fetchStats] Error:', error);
    if (!silent) {
      setMessage('Unable to load stats.', 'error');
    }
  } finally {
    loadingStats.value = false;
  }
}

function scheduleFilterRefresh(immediate = false) {
  if (filterFetchTimer) {
    clearTimeout(filterFetchTimer);
    filterFetchTimer = null;
  }
  if (!photoAlbum.value || (!filterState.volumeId && !showAllVolumes.value)) {
    return;
  }
  if (immediate) {
    if (activePrimaryTab.value === 'statistics') {
      fetchStats({ silent: true });
    }
    return;
  }
  filterFetchTimer = setTimeout(() => {
    filterFetchTimer = null;
    if (activePrimaryTab.value === 'statistics') {
      fetchStats({ silent: true });
    }
  }, FILTER_DEBOUNCE_MS);
}

function getVolumeLabel(volumeId) {
  if (!volumeId) {
    return null;
  }
  const match = volumes.value.find((volume) => volume.id === volumeId);
  return match ? match.displayLabel || match.label || match.id : volumeId;
}

function normalizePhotoFromServer(photo) {
  if (!photo || typeof photo !== 'object') {
    return null;
  }
  const normalizedTags = coerceTagsArray(photo.tags);
  const aiLabels = coerceAiLabelArray(photo.aiLabels ?? photo.ai_labels);
  const lat = Number(photo.gpsLat);
  const lng = Number(photo.gpsLng);
  const format = typeof photo.format === 'string' ? photo.format.toLowerCase() : '';
  const derivedRaw = RAW_FORMATS.includes(format);
  const isRaw = photo.isRaw != null ? Boolean(photo.isRaw) : derivedRaw;
  return {
    ...photo,
    description: typeof photo.description === 'string' ? photo.description : photo.description ?? null,
    tags: normalizedTags,
    aiLabels,
    gpsLat: Number.isFinite(lat) ? lat : null,
    gpsLng: Number.isFinite(lng) ? lng : null,
    locationLabel: typeof photo.locationLabel === 'string' ? photo.locationLabel : null,
    isRaw,
    rating: normalizeRatingValue(photo.rating),
  };
}

function coerceTagsArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean);
  }
  if (typeof value === 'string' && value.length) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean);
      }
    } catch (_error) {
      // Fall through to comma-delimited parsing
    }
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function coerceAiLabelArray(value) {
  if (!value) {
    return [];
  }
  let entries = [];
  if (Array.isArray(value)) {
    entries = value;
  } else if (typeof value === 'string' && value.length) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        entries = parsed;
      }
    } catch (_error) {
      return [];
    }
  }
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const label = typeof entry.label === 'string' ? entry.label.trim() : '';
      if (!label) {
        return null;
      }
      const scoreValue = Number(entry.score);
      if (!Number.isFinite(scoreValue)) {
        return null;
      }
      return {
        label,
        score: Number(scoreValue.toFixed(4)),
      };
    })
    .filter(Boolean);
}

function canonicalizeTagsKeyFromArray(tags = []) {
  return coerceTagsArray(tags).join('||');
}

function normalizeRatingValue(value) {
  if (value == null || value === '') {
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  return Math.max(0, Math.min(5, Math.round(num)));
}

function applyPhotoPatch(photoId, patch = {}) {
  if (!photoId) {
    return;
  }
  const normalizedPatch = {
    ...patch,
  };
  if ('tags' in patch) {
    normalizedPatch.tags = coerceTagsArray(patch.tags);
  }
  if ('aiLabels' in patch) {
    normalizedPatch.aiLabels = coerceAiLabelArray(patch.aiLabels);
  }
  if ('locationLabel' in patch) {
    normalizedPatch.locationLabel = patch.locationLabel;
  }
  if ('rating' in patch) {
    normalizedPatch.rating = normalizeRatingValue(patch.rating);
  }
  albumPhotos.value = albumPhotos.value.map((item) => {
    if (item.id !== photoId) {
      return item;
    }
    return {
      ...item,
      ...normalizedPatch,
    };
  });
  photos.value = photos.value.map((item) => {
    if (item.id !== photoId) {
      return item;
    }
    return {
      ...item,
      ...normalizedPatch,
    };
  });
  albumCollections.value = albumCollections.value.map((album) => {
    let updated = false;
    const albumPhotosList = album.photos.map((item) => {
      if (item.id !== photoId) {
        return item;
      }
      updated = true;
      return {
        ...item,
        ...normalizedPatch,
      };
    });
    if (!updated) {
      return album;
    }
    return {
      ...album,
      photos: albumPhotosList,
    };
  });
  if (selectedPhoto.value?.id === photoId) {
    selectedPhoto.value = {
      ...selectedPhoto.value,
      ...normalizedPatch,
    };
  }
}

function buildTimelineFromPhotos(list = []) {
  return list.reduce((acc, photo) => {
    const key = formatDayKeyFromValue(photo?.shootDateTime);
    if (!key) {
      return acc;
    }
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function formatDayKeyFromValue(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

onMounted(() => {
  loadAlbumCollectionsFromStorage();
  if (!photoAlbum.value) {
    return;
  }
  loadVolumes();
  loadAiCollections();
  loadCityCollections();
  unsubscribeScan = photoAlbum.value.onScanProgress((progress) => {
    scanState.value = progress;
  });
  unsubscribeVolumes = photoAlbum.value.onVolumesChanged((change) => {
    volumes.value = change.volumes || [];
    const addedVolumes = Array.isArray(change?.added) ? change.added : [];
    if (addedVolumes.length) {
      const hardwareVolume = addedVolumes.find(
        (vol) => !vol.isManual && (vol.isLikelySdCard || vol.isRemovable),
      );
      if (hardwareVolume && filterState.volumeId !== hardwareVolume.id) {
        selectVolume(hardwareVolume.id);
        const detectedLabel = hardwareVolume.displayLabel || hardwareVolume.label || 'new SD card';
        setMessage(`Detected ${detectedLabel}. Auto-scanning...`, 'info');
        
        // Explicitly trigger scan if it's a removable volume, ensuring auto-scan happens
        // even if the backend didn't classify it as "likely SD" for its own auto-scan logic.
        // We catch errors in case the backend is already scanning it.
        startScan(hardwareVolume.id).catch(() => {
          // Ignore error if scan is already in progress
        });
      }
    }
    if (!volumes.value.length) {
      selectedVolumeId.value = null;
      showAllVolumes.value = false;
      activeAiCollection.value = null;
      activeCityCollection.value = null;
      resetFilters(null);
      setFilter('aiLabel', null);
      setFilter('locationIds', []);
      aiCollections.value = [];
      cityCollections.value = [];
      return;
    }
    const hasActive = volumes.value.some((v) => v.id === filterState.volumeId);
    if (!hasActive && !showAllVolumes.value && !activeAiCollection.value && !activeCityCollection.value) {
      selectVolume(volumes.value[0].id);
    }
    loadAiCollections();
    loadCityCollections();
  });
});

onBeforeUnmount(() => {
  if (typeof unsubscribeScan === 'function') {
    unsubscribeScan();
  }
  if (typeof unsubscribeVolumes === 'function') {
    unsubscribeVolumes();
  }
  if (filterFetchTimer) {
    clearTimeout(filterFetchTimer);
    filterFetchTimer = null;
  }
  if (albumReloadTimer) {
    clearTimeout(albumReloadTimer);
    albumReloadTimer = null;
  }
  if (globalSearchDebounce) {
    clearTimeout(globalSearchDebounce);
    globalSearchDebounce = null;
  }
});
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.toast-container {
  position: fixed;
  right: 1.5rem;
  bottom: 1.5rem;
  width: min(420px, calc(100vw - 3rem));
  min-width: 280px;
  z-index: 60;
}

.photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}

.photo-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.thumb-wrapper {
  width: 100%;
  padding-top: 70%;
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.4);
}

.thumb-wrapper img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  text-align: center;
  padding: 8px;
}

.photo-caption {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* Favorite preview section */
.collections-section {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1rem 1.25rem;
  margin-bottom: 1.25rem;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
}

.collections-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
  gap: 1rem;
}

.collections-section-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.collections-section-label {
  font-size: 0.95rem;
  font-weight: 600;
  color: #111827;
}

.collections-section-subtext {
  font-size: 0.8rem;
  color: #6b7280;
}

.collections-strip {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.75rem;
}

.collections-strip-collapsed {
  max-height: 360px;
  overflow: hidden;
}

.ai-collections-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 140px;
  border: 1px dashed #d1d5db;
  border-radius: 12px;
  font-size: 0.9rem;
  color: #6b7280;
  background: rgba(249, 250, 251, 0.8);
  gap: 0.5rem;
}

.collection-card {
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 12px;
  padding: 0.6rem;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.2s ease, transform 0.2s ease;
}

.collection-card:hover {
  border-color: rgba(79, 70, 229, 0.5);
  transform: translateY(-1px);
}

.collection-thumb {
  position: relative;
  padding-top: 65%;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(15, 23, 42, 0.04);
}

.collection-thumb img,
.collection-thumb-placeholder {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ai-collection-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(79, 70, 229, 0.08);
}

.ai-collection-card .collection-card-meta {
  align-items: flex-start;
}

.city-collection-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(244, 114, 182, 0.12);
  color: #be185d;
}

.city-collection-card.city-collection-active {
  border-color: rgba(244, 114, 182, 0.6);
  box-shadow: 0 0 0 1px rgba(244, 114, 182, 0.25);
}


.album-banner {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 0.9rem 1.25rem;
  margin-bottom: 1.25rem;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.album-banner-label {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #9ca3af;
  margin-bottom: 0.15rem;
}

.album-banner-title {
  font-size: 1.2rem;
  font-weight: 600;
  color: #111827;
}

.album-banner-count {
  font-size: 0.95rem;
  font-weight: 400;
  color: #6b7280;
  margin-left: 0.25rem;
}


.collection-thumb-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  color: #94a3b8;
}

.collection-card-meta {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.35rem;
}

.collection-card-meta-content {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  flex: 1;
  min-width: 0;
}

.collection-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.collection-count {
  font-size: 0.75rem;
  color: #6b7280;
}

.album-modal-panel {
  background: #ffffff;
  border-radius: 18px;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 320px;
}

.album-modal-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: #0f172a;
}

.album-modal-subtitle {
  font-size: 0.9rem;
  color: #6b7280;
  margin-top: 0.15rem;
}

.album-modal-body {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.album-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

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

/* Root */
.album-page-root {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: transparent; /* Changed from #fafafa to allow window vibrancy */
  --app-header-height: 5rem;
  --app-main-padding: 1.5rem;
  --sticky-columns-offset: 0px;
  --sticky-columns-height: calc(100vh - var(--app-header-height) - var(--app-main-padding));
  --mac-traffic-offset: 0px;
  --header-drag-height: 18px;
}

.album-page-root.is-mac-layout {
  --app-header-height: 5.5rem;
  --mac-traffic-offset: 70px;
  --header-drag-height: 26px;
}

.album-page-root.is-mac-layout .app-header {
  padding-top: 0.35rem;
}

.album-page-root.is-mac-layout .app-header-container {
  padding-left: calc(1.5rem + var(--mac-traffic-offset));
}

/* Header */

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
  height: var(--header-drag-height);
  pointer-events: none;
  -webkit-app-region: drag;
}

.window-no-drag,
.window-no-drag * {
  -webkit-app-region: no-drag;
}

.app-header-container {
  max-width: 1920px;
  margin: 0 auto;
  padding: 1.25rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
}

.app-header-left {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  flex: 1;
}

.app-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #111827;
  white-space: nowrap;
}
.app-logo{
  width: auto;
  height: 30px;
}
.app-header-search {
  max-width: 400px;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.app-header-search .search-input {
  flex: 1 1 auto;
}

.app-header-search .search-mode-toggle {
  flex-shrink: 0;
  white-space: nowrap;
}

.app-header-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.app-status-badges {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.volume-status {
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
}

.volume-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.status-label {
  font-size: 0.75rem;
  color: #6b7280;
  font-weight: 500;
}

@media (max-width: 768px) {
  .app-header-container {
    flex-wrap: wrap;
  }

  .app-header-left {
    width: 100%;
  }

  .app-header-search {
    max-width: none;
  }

  .app-status-badges {
    display: none;
  }

  .app-title {
    font-size: 1.125rem;
  }
}

/* Main Layout */
.app-main {
  flex: 1;
  overflow-y: auto;
  /* Apply solid background to main content area */
  background: #fafafa;
  padding: var(--app-main-padding) 0;
}

.app-container {
  max-width: 1920px;
}

.app-layout {
  display: flex;
  gap: 1.5rem;
  align-items: flex-start;
}

/* Left Column */
.app-left-column {
  width: 280px;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  position: sticky;
  top: var(--sticky-columns-offset);
  align-self: flex-start;
  max-height: calc(100vh - 6rem);
}

/* Sidebar */
.app-sidebar {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
}

@media (max-width: 1023px) {
  .app-left-column {
    width: 100%;
    position: relative;
    top: 0;
  }

  .app-layout {
    flex-direction: column;
  }

  .sidebar-summary,
  .sidebar-actions {
    display: none;
  }

  .sidebar-nav {
    flex-direction: row;
    overflow-x: auto;
  }

  .nav-item {
    white-space: nowrap;
  }
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.875rem;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: #6b7280;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  width: 100%;
  text-align: left;
}

.nav-item:hover {
  background: #f3f4f6;
  color: #111827;
}

.nav-item-active {
  background: #f3f4f6;
  color: #111827;
  font-weight: 600;
}

.nav-item-icon {
  width: 1.25rem;
  height: 1.25rem;
  flex-shrink: 0;
}

.nav-item-label {
  flex: 1;
}

.sidebar-extra {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.sidebar-summary {
  padding-top: 1rem;
  /* border-top: 1px solid #e5e7eb; */
}

.summary-count {
  font-size: 0.875rem;
  font-weight: 600;
  color: #111827;
  margin-bottom: 0.25rem;
}

.summary-date {
  font-size: 0.75rem;
  color: #6b7280;
}

.sidebar-actions {
  /*border-top: 1px solid #e5e7eb; */
  padding-top: 1rem;
}

.sidebar-collapse-enter-active,
.sidebar-collapse-leave-active {
  transition: opacity 0.2s ease;
}

.sidebar-collapse-enter-from,
.sidebar-collapse-leave-to {
  opacity: 0;
}

.sidebar-collapse-enter-to,
.sidebar-collapse-leave-from {
  opacity: 1;
}

/* Content Area */
.app-content {
  flex: 1;
  min-width: 0;
}

.content-grid {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: 1fr;
}


.filters-column {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.filters-column :deep(.filter-panel) {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.filters-column :deep(.filter-panel .filter-panel-body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.filters-column :deep(.filter-panel .filter-panel-body .filter-collapse-wrapper) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.filters-column :deep(.filter-panel .filter-panel-body .filter-collapse-wrapper .filter-content) {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.center-column {
  position: relative;
  min-height: 500px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1.5rem;
  margin-right: 100px; /* Make room for the timeline rail */
}

/* Stats View */
.stats-view {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.stats-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e5e7eb;
}

.stats-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #111827;
}

.stats-subtitle {
  font-size: 0.875rem;
  color: #6b7280;
  margin-top: 0.25rem;
}

.stats-info {
  font-size: 0.875rem;
  color: #6b7280;
  padding: 0.75rem 1rem;
  background: #f9fafb;
  border-radius: 6px;
}

.debug-modal {
  background: #020617;
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
</style>
