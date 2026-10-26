/**
 * Pure helper functions for the Weather Assistant.
 * Kept free of DOM/network access so they can be unit tested in isolation.
 */

/** WMO weather interpretation codes used by Open-Meteo. */
export const WEATHER_CODES = Object.freeze({
  0: { label: 'Clear sky', day: '☀️', night: '🌙' },
  1: { label: 'Mainly clear', day: '🌤️', night: '🌙' },
  2: { label: 'Partly cloudy', day: '⛅', night: '☁️' },
  3: { label: 'Overcast', day: '☁️', night: '☁️' },
  45: { label: 'Fog', day: '🌫️', night: '🌫️' },
  48: { label: 'Depositing rime fog', day: '🌫️', night: '🌫️' },
  51: { label: 'Light drizzle', day: '🌦️', night: '🌦️' },
  53: { label: 'Moderate drizzle', day: '🌦️', night: '🌦️' },
  55: { label: 'Dense drizzle', day: '🌧️', night: '🌧️' },
  56: { label: 'Light freezing drizzle', day: '🌧️', night: '🌧️' },
  57: { label: 'Dense freezing drizzle', day: '🌧️', night: '🌧️' },
  61: { label: 'Slight rain', day: '🌦️', night: '🌦️' },
  63: { label: 'Moderate rain', day: '🌧️', night: '🌧️' },
  65: { label: 'Heavy rain', day: '🌧️', night: '🌧️' },
  66: { label: 'Light freezing rain', day: '🌨️', night: '🌨️' },
  67: { label: 'Heavy freezing rain', day: '🌨️', night: '🌨️' },
  71: { label: 'Slight snow fall', day: '🌨️', night: '🌨️' },
  73: { label: 'Moderate snow fall', day: '❄️', night: '❄️' },
  75: { label: 'Heavy snow fall', day: '❄️', night: '❄️' },
  77: { label: 'Snow grains', day: '❄️', night: '❄️' },
  80: { label: 'Slight rain showers', day: '🌦️', night: '🌦️' },
  81: { label: 'Moderate rain showers', day: '🌧️', night: '🌧️' },
  82: { label: 'Violent rain showers', day: '⛈️', night: '⛈️' },
  85: { label: 'Slight snow showers', day: '🌨️', night: '🌨️' },
  86: { label: 'Heavy snow showers', day: '❄️', night: '❄️' },
  95: { label: 'Thunderstorm', day: '⛈️', night: '⛈️' },
  96: { label: 'Thunderstorm with slight hail', day: '⛈️', night: '⛈️' },
  99: { label: 'Thunderstorm with heavy hail', day: '⛈️', night: '⛈️' }
});

const UNKNOWN_WEATHER = Object.freeze({ label: 'Unknown', day: '❔', night: '❔' });

/**
 * Maps a WMO weather code to a human readable label and an icon.
 * @param {number|null|undefined} code WMO weather code.
 * @param {boolean} [isDay=true] Whether the reading is during daylight.
 * @returns {{ label: string, icon: string }}
 */
export function describeWeather(code, isDay = true) {
  const entry = WEATHER_CODES[code] ?? UNKNOWN_WEATHER;
  return { label: entry.label, icon: isDay ? entry.day : entry.night };
}

/**
 * Checks that a value is a usable finite number.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Rounds a numeric reading and appends a suffix, or returns a dash placeholder.
 * @param {unknown} value
 * @param {string} [suffix='']
 * @param {number} [digits=0]
 * @returns {string}
 */
export function formatNumber(value, suffix = '', digits = 0) {
  if (!isFiniteNumber(value)) return '--';
  return `${value.toFixed(digits)}${suffix}`;
}

/**
 * Formats a temperature with the correct degree symbol.
 * @param {unknown} value
 * @param {'celsius'|'fahrenheit'} [unit='celsius']
 * @returns {string}
 */
export function formatTemperature(value, unit = 'celsius') {
  if (!isFiniteNumber(value)) return '--';
  return `${Math.round(value)}°${unit === 'fahrenheit' ? 'F' : 'C'}`;
}

/**
 * Converts a compass bearing into a 16-point direction label.
 * @param {unknown} degrees
 * @returns {string}
 */
export function windDirection(degrees) {
  if (!isFiniteNumber(degrees)) return '';
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16;
  return points[index];
}

/**
 * Categorises a UV index value.
 * @param {unknown} uv
 * @returns {string}
 */
export function uvCategory(uv) {
  if (!isFiniteNumber(uv)) return '--';
  if (uv < 3) return 'Low';
  if (uv < 6) return 'Moderate';
  if (uv < 8) return 'High';
  if (uv < 11) return 'Very high';
  return 'Extreme';
}

/**
 * Formats an Open-Meteo local ISO timestamp (no zone suffix) as a clock time.
 * @param {string} isoLocal e.g. "2026-09-26T14:00"
 * @param {boolean} [hour12=true]
 * @returns {string}
 */
export function formatHour(isoLocal, hour12 = true) {
  if (typeof isoLocal !== 'string') return '--';
  const match = /T(\d{2}):(\d{2})/.exec(isoLocal);
  if (!match) return '--';
  const hours = Number(match[1]);
  const minutes = match[2];
  if (!hour12) return `${match[1]}:${minutes}`;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display} ${suffix}`;
}

/**
 * Returns a short weekday label for an ISO date, or "Today" for the reference date.
 * @param {string} isoDate e.g. "2026-09-26"
 * @param {string} [todayIso] ISO date considered "today".
 * @returns {string}
 */
export function formatDayLabel(isoDate, todayIso) {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return '--';
  if (todayIso && isoDate.slice(0, 10) === todayIso.slice(0, 10)) return 'Today';
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
}

/**
 * Builds a readable place label from an Open-Meteo geocoding result.
 * @param {{name?: string, admin1?: string, country?: string}|null|undefined} place
 * @returns {string}
 */
export function buildPlaceLabel(place) {
  if (!place || typeof place !== 'object') return 'Unknown location';
  const parts = [place.name, place.admin1, place.country]
    .filter((part) => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim());
  const unique = parts.filter((part, index) => parts.indexOf(part) === index);
  return unique.length ? unique.join(', ') : 'Unknown location';
}

/**
 * Clamps latitude to the valid WGS84 range.
 * @param {number} lat
 * @returns {number}
 */
export function clampLatitude(lat) {
  if (!isFiniteNumber(lat)) return 0;
  return Math.min(90, Math.max(-90, lat));
}

/**
 * Wraps longitude into the [-180, 180] range (Leaflet allows infinite panning).
 * @param {number} lon
 * @returns {number}
 */
export function normalizeLongitude(lon) {
  if (!isFiniteNumber(lon)) return 0;
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * Trims and length-limits free-text user input before it is sent to an API.
 * @param {unknown} value
 * @param {number} [maxLength=80]
 * @returns {string}
 */
export function sanitizeQuery(value, maxLength = 80) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, maxLength);
}

/**
 * Formats coordinates for display.
 * @param {number} lat
 * @param {number} lon
 * @returns {string}
 */
export function formatCoords(lat, lon) {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return '--';
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lon).toFixed(2)}°${ew}`;
}

/**
 * Slices hourly arrays to a forward-looking window starting at the current hour.
 * @param {string[]} times Local ISO timestamps.
 * @param {string} currentTime Current local ISO timestamp.
 * @param {number} [count=24]
 * @returns {{ start: number, end: number }}
 */
export function hourlyWindow(times, currentTime, count = 24) {
  if (!Array.isArray(times) || times.length === 0) return { start: 0, end: 0 };
  const prefix = typeof currentTime === 'string' ? currentTime.slice(0, 13) : '';
  const found = times.findIndex((t) => typeof t === 'string' && t.slice(0, 13) === prefix);
  const start = found >= 0 ? found : 0;
  return { start, end: Math.min(times.length, start + count) };
}

/**
 * Computes the relative offset/width (0-100) of a day's temperature range
 * against the whole week, for the range bars in the daily forecast.
 * @param {number} min Day minimum.
 * @param {number} max Day maximum.
 * @param {number} weekMin Week minimum.
 * @param {number} weekMax Week maximum.
 * @returns {{ offset: number, width: number }}
 */
export function rangeBarGeometry(min, max, weekMin, weekMax) {
  if (![min, max, weekMin, weekMax].every(isFiniteNumber) || weekMax <= weekMin) {
    return { offset: 0, width: 100 };
  }
  const span = weekMax - weekMin;
  const offset = ((Math.min(min, max) - weekMin) / span) * 100;
  const width = (Math.abs(max - min) / span) * 100;
  return {
    offset: Math.max(0, Math.min(100, offset)),
    width: Math.max(4, Math.min(100 - Math.max(0, offset), width))
  };
}
