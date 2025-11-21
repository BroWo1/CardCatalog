import { reactive } from 'vue';

function createDefaultFilter() {
  return {
    volumeId: null,
    cameraModels: [],
    lensModels: [],
    dateFrom: null,
    dateTo: null,
    isoMin: null,
    isoMax: null,
    apertureMin: null,
    apertureMax: null,
    focalMin: null,
    focalMax: null,
    text: '',
    searchText: '',
    semanticSearch: true,
    tags: [],
    locationIds: [],
    aiLabel: null,
    favoritesOnly: false,
    sortBy: 'date_desc',
    limit: 100,
    offset: 0,
    cursor: null,
  };
}

const filterState = reactive(createDefaultFilter());

function resetFilters(volumeId = null) {
  const next = createDefaultFilter();
  next.volumeId = volumeId ?? null;
  Object.keys(next).forEach((key) => {
    filterState[key] = next[key];
  });
}

function setFilter(key, value, options = {}) {
  if (!(key in filterState)) {
    return;
  }
  const shouldResetOffset = options.resetOffset ?? key !== 'offset';
  filterState[key] = value;
  if (shouldResetOffset && key !== 'offset') {
    filterState.offset = 0;
    filterState.cursor = null;
  }
  if (key !== 'cursor' && key !== 'offset') {
    filterState.cursor = null;
  }
}

function patchFilters(patch = {}) {
  Object.entries(patch).forEach(([key, value]) => {
    setFilter(key, value, { resetOffset: key !== 'offset' });
  });
}

function toPayload() {
  return JSON.parse(JSON.stringify(filterState));
}

export function usePhotoFilters() {
  return {
    filterState,
    setFilter,
    patchFilters,
    resetFilters,
    toPayload,
    defaultLimit: createDefaultFilter().limit,
  };
}
