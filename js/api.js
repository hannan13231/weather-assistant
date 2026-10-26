/**
 * Network layer: all external API access lives here.
 * All endpoints below are free and require no API key.
 */
import { clampLatitude, normalizeLongitude, sanitizeQuery } from './utils.js';

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE_GEOCODING_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const RAINVIEWER_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const RSS_TO_JSON_URL = 'https://api.rss2json.com/v1/api.json';

const REQUEST_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const responseCache = new Map();

/**
 * Fetch JSON with a timeout and consistent error reporting.
 * @param {string} url
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<any>}
 */
async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortRequest = () => controller.abort();
  if (options.signal) {
    options.signal.addEventListener('abort', abortRequest, { once: true });
  }
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('This service is receiving too many requests. Please try again in a few minutes.');
      }
      if (response.status >= 500) {
        throw new Error('This service is temporarily unavailable. Please try again shortly.');
      }
      throw new Error(`Request failed (${response.status})`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('The weather service took too long to respond.');
    }
    throw new Error(error instanceof Error ? error.message : 'Network error');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortRequest);
  }
}

async function fetchCachedJson(url, options = {}) {
  const cached = responseCache.get(url);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) return cached.data;

  const data = await fetchJson(url, options);
  responseCache.set(url, { createdAt: Date.now(), data });
  return data;
}

/**
 * Searches for places by name.
 * @param {string} query
 * @param {{ count?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<Array<object>>}
 */
export async function searchPlaces(query, options = {}) {
  const term = sanitizeQuery(query);
  if (term.length < 2) return [];
  const url = new URL(GEOCODING_URL);
  url.searchParams.set('name', term);
  url.searchParams.set('count', String(options.count ?? 6));
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  const data = await fetchCachedJson(url.toString(), { signal: options.signal });
  return Array.isArray(data?.results) ? data.results : [];
}

/**
 * Best-effort reverse geocoding for map clicks. Never rejects.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{name: string, admin1: string, country: string}|null>}
 */
export async function reverseGeocode(lat, lon) {
  const url = new URL(REVERSE_GEOCODING_URL);
  url.searchParams.set('latitude', String(clampLatitude(lat)));
  url.searchParams.set('longitude', String(normalizeLongitude(lon)));
  url.searchParams.set('localityLanguage', 'en');
  try {
    const data = await fetchJson(url.toString());
    return {
      name: data?.city || data?.locality || data?.principalSubdivision || '',
      admin1: data?.principalSubdivision || '',
      country: data?.countryName || ''
    };
  } catch {
    return null;
  }
}

/**
 * Fetches current conditions, 24h+ hourly data and a 7-day outlook.
 * @param {number} lat
 * @param {number} lon
 * @param {{ unit?: 'celsius'|'fahrenheit', signal?: AbortSignal }} [options]
 * @returns {Promise<object>}
 */
export async function fetchForecast(lat, lon, options = {}) {
  const url = new URL(FORECAST_URL);
  url.searchParams.set('latitude', clampLatitude(lat).toFixed(4));
  url.searchParams.set('longitude', normalizeLongitude(lon).toFixed(4));
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('temperature_unit', options.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius');
  url.searchParams.set('wind_speed_unit', 'kmh');
  url.searchParams.set('forecast_days', '7');
  url.searchParams.set('current', [
    'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'is_day',
    'precipitation', 'weather_code', 'surface_pressure', 'wind_speed_10m', 'wind_direction_10m'
  ].join(','));
  url.searchParams.set('hourly', [
    'temperature_2m', 'precipitation_probability', 'weather_code', 'is_day', 'visibility', 'uv_index'
  ].join(','));
  url.searchParams.set('daily', [
    'weather_code', 'temperature_2m_max', 'temperature_2m_min',
    'precipitation_probability_max', 'sunrise', 'sunset', 'uv_index_max'
  ].join(','));

  const data = await fetchCachedJson(url.toString(), { signal: options.signal });
  if (data?.error) throw new Error(data.reason || 'Weather service error');
  return data;
}

/**
 * Loads RainViewer radar/satellite tile frames (past + nowcast).
 * @returns {Promise<{ host: string, radar: Array<{time:number, path:string}>, clouds: Array<{time:number, path:string}> }>}
 */
export async function fetchRadarFrames() {
  const data = await fetchCachedJson(RAINVIEWER_URL);
  const past = Array.isArray(data?.radar?.past) ? data.radar.past : [];
  const nowcast = Array.isArray(data?.radar?.nowcast) ? data.radar.nowcast : [];
  const clouds = Array.isArray(data?.satellite?.infrared) ? data.satellite.infrared : [];
  return {
    host: typeof data?.host === 'string' ? data.host : 'https://tilecache.rainviewer.com',
    radar: [...past, ...nowcast],
    clouds
  };
}

/**
 * Loads recent weather-related news for a place.
 * @param {string} location
 * @param {{ signal?: AbortSignal, refresh?: boolean }} [options]
 * @returns {Promise<Array<{title:string, source:string, link:string, publishedAt:string}>>}
 */
export async function fetchWeatherNews(location, options = {}) {
  const place = sanitizeQuery(location)
    .split(',')
    .slice(0, 2)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
  if (!place) return [];

  const feed = new URL('https://news.google.com/rss/search');
  feed.searchParams.set('q', `"${place}" weather forecast`);
  feed.searchParams.set('hl', 'en-US');
  feed.searchParams.set('gl', 'US');
  feed.searchParams.set('ceid', 'US:en');

  const url = new URL(RSS_TO_JSON_URL);
  url.searchParams.set('rss_url', feed.toString());
  const data = options.refresh
    ? await fetchJson(url.toString(), { signal: options.signal })
    : await fetchCachedJson(url.toString(), { signal: options.signal });
  if (data?.status !== 'ok' || !Array.isArray(data.items)) {
    throw new Error(data?.message || 'Weather news is unavailable.');
  }

  return data.items.slice(0, 6).map((item) => {
    const title = typeof item.title === 'string' ? item.title.trim() : 'Weather update';
    const separator = title.lastIndexOf(' - ');
    return {
      title: separator > 0 ? title.slice(0, separator) : title,
      source: separator > 0 ? title.slice(separator + 3) : 'Google News',
      link: typeof item.link === 'string' && /^https?:\/\//.test(item.link) ? item.link : '',
      publishedAt: typeof item.pubDate === 'string' ? item.pubDate : ''
    };
  });
}

/**
 * Builds a RainViewer tile URL template for Leaflet.
 * @param {string} host
 * @param {string} path Frame path from the RainViewer index.
 * @param {'radar'|'clouds'} kind
 * @returns {string}
 */
export function buildTileUrl(host, path, kind) {
  const colorScheme = kind === 'clouds' ? 0 : 4;
  const options = kind === 'clouds' ? '0_0' : '1_1';
  return `${host}${path}/256/{z}/{x}/{y}/${colorScheme}/${options}.png`;
}
