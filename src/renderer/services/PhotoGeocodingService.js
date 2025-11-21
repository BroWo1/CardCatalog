import RBush from 'rbush';

/**
 * PhotoGeocodingService - Fast offline reverse geocoding using R-tree spatial index
 *
 * Improvements over hardcoded city array:
 * - ~25,000 cities (cities15000) vs 21 cities
 * - O(log n) search with R-tree vs O(n) linear search
 * - Better global coverage
 * - Configurable distance threshold
 */
export class PhotoGeocodingService {
  constructor(options = {}) {
    this.maxDistance = options.maxDistance || 200; // km
    this.tree = new RBush();
    this.loaded = false;
    this.cities = [];
  }

  /**
   * Load cities from a JSON file
   * Expected format: Array of { name, admin1, country, lat, lng, population }
   */
  async loadCities(citiesData) {
    if (this.loaded) {
      console.warn('Cities already loaded');
      return;
    }

    this.cities = citiesData;

    // Build R-tree index for fast spatial queries
    const items = citiesData.map(city => ({
      minX: city.lng,
      minY: city.lat,
      maxX: city.lng,
      maxY: city.lat,
      city: {
        name: city.name,
        admin1: city.admin1,
        country: city.country,
        lat: city.lat,
        lng: city.lng,
        population: city.population || 0,
      }
    }));

    this.tree.load(items);
    this.loaded = true;

    console.log(`[PhotoGeocodingService] Loaded ${citiesData.length} cities into spatial index`);
  }

  /**
   * Find the nearest city to given coordinates
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @param {number} maxDistance - Max distance in km (optional)
   * @returns {Object|null} City info or null if no match found
   */
  findNearestCity(lat, lng, maxDistance = null) {
    if (!this.loaded) {
      console.warn('[PhotoGeocodingService] Cities not loaded yet');
      return null;
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    const searchDist = maxDistance || this.maxDistance;
    const searchRadius = 3; // ~330km at equator

    // Search R-tree for candidates
    const candidates = this.tree.search({
      minX: lng - searchRadius,
      minY: lat - searchRadius,
      maxX: lng + searchRadius,
      maxY: lat + searchRadius
    });

    if (candidates.length === 0) {
      return null;
    }

    // Find closest using Haversine formula
    let closest = null;
    let minDist = Infinity;

    for (const item of candidates) {
      const dist = this.haversineDistance(lat, lng, item.city.lat, item.city.lng);
      if (dist < minDist) {
        minDist = dist;
        closest = item.city;
      }
    }

    // Only return if within max distance
    if (minDist <= searchDist) {
      return {
        city: closest.name,
        region: this.formatRegion(closest),
        state: closest.admin1,
        country: closest.country,
        distance: Math.round(minDist * 10) / 10,
        population: closest.population,
        timezone: this.formatRegion(closest), // Simplified - could use geo-tz library
      };
    }

    return null;
  }

  /**
   * Haversine distance calculation between two points
   * @returns {number} Distance in kilometers
   */
  haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const toRad = (value) => (value * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Format region string from city data
   */
  formatRegion(city) {
    const parts = [];
    if (city.admin1) parts.push(city.admin1);
    if (city.country) parts.push(city.country);
    return parts.join(', ') || city.country || 'Unknown';
  }

  /**
   * Get statistics about loaded cities
   */
  getStats() {
    return {
      loaded: this.loaded,
      cityCount: this.cities.length,
      maxDistance: this.maxDistance,
    };
  }
}

// Singleton instance
let instance = null;

export function getGeocodingService() {
  if (!instance) {
    instance = new PhotoGeocodingService();
  }
  return instance;
}
