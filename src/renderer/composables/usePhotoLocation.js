import { getGeocodingService } from '../services/PhotoGeocodingService';

// Lazy-loaded geocoding service
let geocodingService = null;
let loadingPromise = null;

/**
 * Get or initialize the geocoding service
 * Loads city database on first use
 */
async function getOrInitGeocodingService() {
  if (geocodingService) {
    return geocodingService;
  }

  // Prevent multiple simultaneous loads
  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    geocodingService = getGeocodingService();

    try {
      // Always load fallback cities first (guaranteed to exist)
      const fallbackCities = await import('../data/cities.json');
      await geocodingService.loadCities(fallbackCities.default);
      console.log('[usePhotoLocation] Loaded city database with', fallbackCities.default.length, 'cities');

      // TODO: In the future, we can add logic to load the optional GeoNames database
      // For now, the 150+ city fallback provides good coverage
    } catch (error) {
      console.error('[usePhotoLocation] Failed to load city database:', error);
      // Continue with empty database - service will return null for lookups
    }

    return geocodingService;
  })();

  return loadingPromise;
}

export function usePhotoLocation() {
  /**
   * Lookup city from GPS coordinates using the geocoding service
   */
  function lookupCityFromGps(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    // If service isn't loaded yet, return null
    // This is fine as the UI will show coordinates instead
    if (!geocodingService?.loaded) {
      // Trigger async load for next time
      getOrInitGeocodingService().catch(console.error);
      return null;
    }

    const result = geocodingService.findNearestCity(lat, lng);

    if (result) {
      return {
        city: result.city,
        region: result.region,
        timezone: result.timezone,
        distance: result.distance,
      };
    }

    return null;
  }

  function formatLatLng(lat, lng) {
    const latSuffix = lat >= 0 ? 'N' : 'S';
    const lngSuffix = lng >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(4)}° ${latSuffix}, ${Math.abs(lng).toFixed(4)}° ${lngSuffix}`;
  }

  function buildMapEmbedUrl(lat, lng) {
    const delta = 0.01;
    const bbox = [
      lng - delta,
      lat - delta,
      lng + delta,
      lat + delta,
    ]
      .map((value) => value.toFixed(6))
      .join(',');
    const marker = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
      bbox,
    )}&layer=mapnik&marker=${encodeURIComponent(marker)}`;
  }

  function getPhotoLocation(photo) {
    if (!photo) {
      return null;
    }
    const lat = Number(photo.gpsLat);
    const lng = Number(photo.gpsLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    // Filter out invalid 0,0 coordinates (often default for missing GPS)
    if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) {
      return null;
    }
    const cityInfo = lookupCityFromGps(lat, lng);
    const manualLabel = typeof photo.locationLabel === 'string'
      ? photo.locationLabel.trim()
      : '';
    return {
      lat,
      lng,
      label: formatLatLng(lat, lng),
      coordinates: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      mapUrl: buildMapEmbedUrl(lat, lng),
      city: cityInfo?.city || manualLabel || null,
      region: cityInfo?.region || null,
      timezone: cityInfo?.timezone || null,
    };
  }

  return {
    getPhotoLocation,
    lookupCityFromGps,
    formatLatLng,
    buildMapEmbedUrl,
  };
}
