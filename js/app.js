/**
 * Weather Assistant — application shell.
 * Wires the map, search, unit toggle and forecast rendering together.
 */
import {
  buildTileUrl, fetchForecast, fetchRadarFrames, fetchWeatherNews, reverseGeocode, searchPlaces
} from './api.js';
import {
  buildPlaceLabel, clampLatitude, describeWeather, formatCoords, formatDayLabel, formatHour,
  formatNumber, formatTemperature, hourlyWindow, isFiniteNumber, normalizeLongitude,
  rangeBarGeometry, sanitizeQuery, uvCategory, windDirection
} from './utils.js';

const DEFAULT_LOCATION = { latitude: 12.9716, longitude: 77.5946, label: 'Bengaluru, Karnataka, India' };
const ANIMATION_INTERVAL_MS = 1000;

const state = {
  unit: 'celsius',
  location: { ...DEFAULT_LOCATION },
  layer: 'radar',
  frames: { host: '', radar: [], clouds: [] },
  frameIndex: 0,
  playing: false,
  animationTimer: null,
  forecastAbort: null,
  newsAbort: null,
  suggestAbort: null,
  latestForecast: null,
  chart: null
};

const el = (id) => document.getElementById(id);
const dom = {
  searchForm: el('search-form'),
  searchInput: el('search-input'),
  suggestions: el('suggestions'),
  locateBtn: el('locate-btn'),
  current: el('current'),
  skeleton: el('current-skeleton'),
  hourlyStrip: el('hourly-strip'),
  daily: el('daily'),
  toast: el('toast'),
  frameSlider: el('frame-slider'),
  frameTime: el('frame-time'),
  playBtn: el('play-btn'),
  overlayStatusText: el('overlay-status-text'),
  overlayStatusDot: el('overlay-status-dot'),
  radarLegend: el('radar-legend'),
  cloudButton: document.querySelector('[data-layer="clouds"]'),
  newsLocation: el('news-location'),
  newsState: el('news-state'),
  newsList: el('news-list'),
  newsRefresh: el('news-refresh'),
  assistantContext: el('assistant-context'),
  assistantMessages: el('assistant-messages'),
  assistantBrief: el('assistant-brief'),
  assistantForm: el('assistant-form'),
  assistantInput: el('assistant-input')
};

let map;
let marker;
let tileLayer = null;
let tileLayerKind = null;
let toastTimer = null;
let resumeAnimation = false;

/* ------------------------------------------------------------------ */
/* UI helpers                                                          */
/* ------------------------------------------------------------------ */

/**
 * Shows a transient status message.
 * @param {string} message
 */
function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { dom.toast.hidden = true; }, 4500);
}

/**
 * Toggles the loading skeleton for the current-conditions panel.
 * @param {boolean} loading
 */
function setLoading(loading) {
  dom.skeleton.hidden = !loading;
  dom.current.hidden = loading;
}

function setOverlayStatus(message, tone = 'ready', showLegend = false) {
  dom.overlayStatusText.textContent = message;
  dom.overlayStatusDot.classList.toggle('is-loading', tone === 'loading');
  dom.overlayStatusDot.classList.toggle('is-error', tone === 'error');
  dom.radarLegend.hidden = !showLegend;
}

/* ------------------------------------------------------------------ */
/* Map                                                                 */
/* ------------------------------------------------------------------ */

function initMap() {
  map = L.map('map', { zoomControl: true, worldCopyJump: true })
    .setView([state.location.latitude, state.location.longitude], 6);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    className: 'basemap-dark',
    maxZoom: 19,
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 1
  }).addTo(map);

  marker = L.marker([state.location.latitude, state.location.longitude], { keyboard: true })
    .addTo(map);

  map.on('click', async (event) => {
    const lat = clampLatitude(event.latlng.lat);
    const lon = normalizeLongitude(event.latlng.lng);
    const place = await reverseGeocode(lat, lon);
    const label = place && place.name ? buildPlaceLabel(place) : formatCoords(lat, lon);
    selectLocation({ latitude: lat, longitude: lon, label, keepView: true });
  });
}

/**
 * Applies the active weather overlay frame to the map.
 */
function renderOverlay() {
  if (state.layer === 'none') {
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = null;
    tileLayerKind = null;
    dom.frameTime.textContent = '--:--';
    setOverlayStatus('Weather overlay hidden');
    return;
  }
  const frames = state.frames[state.layer] ?? [];
  if (!frames.length) {
    setOverlayStatus('This overlay is unavailable from the provider.', 'error');
    return;
  }

  const index = Math.min(state.frameIndex, frames.length - 1);
  const frame = frames[index];
  const url = buildTileUrl(state.frames.host, frame.path, state.layer);

  if (tileLayer && tileLayerKind === state.layer) {
    setOverlayStatus('Loading radar frame…', 'loading');
    tileLayer.setUrl(url);
  } else {
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(url, {
      opacity: state.layer === 'clouds' ? 0.5 : 0.7,
      zIndex: 400,
      attribution: 'Radar &copy; RainViewer',
      maxNativeZoom: 7,
      updateWhenIdle: true,
      updateWhenZooming: false,
      keepBuffer: 1
    });
    tileLayer.on('loading', () => setOverlayStatus('Loading radar frame…', 'loading'));
    tileLayer.on('load', () => setOverlayStatus(
      'Radar loaded · Clear areas have no colored pixels.', 'ready', state.layer === 'radar'
    ));
    tileLayer.on('tileerror', () => setOverlayStatus('Some radar tiles could not be loaded.', 'error'));
    tileLayer.addTo(map);
    tileLayerKind = state.layer;
  }

  dom.frameSlider.max = String(frames.length - 1);
  dom.frameSlider.value = String(index);
  dom.frameTime.textContent = new Date(frame.time * 1000)
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function loadOverlayFrames() {
  try {
    state.frames = await fetchRadarFrames();
    const cloudsAvailable = state.frames.clouds.length > 0;
    dom.cloudButton.disabled = !cloudsAvailable;
    dom.cloudButton.title = cloudsAvailable
      ? 'Show infrared cloud cover'
      : 'Cloud tiles are not currently provided by RainViewer';
    state.frameIndex = Math.max(0, (state.frames.radar?.length ?? 1) - 1);
    dom.playBtn.disabled = state.frames.radar.length === 0;
    dom.frameSlider.disabled = state.frames.radar.length === 0;
    renderOverlay();
  } catch {
    setOverlayStatus('Radar service is unavailable right now.', 'error');
    dom.playBtn.disabled = true;
    dom.frameSlider.disabled = true;
    showToast('Radar overlay is unavailable right now.');
  }
}

function toggleAnimation(play) {
  state.playing = play;
  dom.playBtn.textContent = play ? '❚❚' : '▶';
  dom.playBtn.setAttribute('aria-label', play ? 'Pause radar animation' : 'Play radar animation');
  clearInterval(state.animationTimer);
  if (!play) return;
  state.animationTimer = setInterval(() => {
    const frames = state.frames[state.layer] ?? [];
    if (!frames.length) return;
    state.frameIndex = (state.frameIndex + 1) % frames.length;
    renderOverlay();
  }, ANIMATION_INTERVAL_MS);
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/**
 * Renders the current conditions panel.
 * @param {object} data Open-Meteo forecast payload.
 */
function renderCurrent(data) {
  const current = data.current ?? {};
  const daily = data.daily ?? {};
  const hourly = data.hourly ?? {};
  const isDay = current.is_day !== 0;
  const { label, icon } = describeWeather(current.weather_code, isDay);
  const { start } = hourlyWindow(hourly.time ?? [], current.time);

  el('place-name').textContent = state.location.label;
  el('local-time').textContent = `${formatCoords(state.location.latitude, state.location.longitude)} · local ${formatHour(current.time)}`;
  el('current-icon').textContent = icon;
  el('current-temp').textContent = isFiniteNumber(current.temperature_2m)
    ? String(Math.round(current.temperature_2m)) : '--';
  el('deg-unit').textContent = state.unit === 'fahrenheit' ? '°F' : '°C';
  el('current-desc').textContent = label;
  el('current-feels').textContent = formatTemperature(current.apparent_temperature, state.unit);

  el('m-humidity').textContent = formatNumber(current.relative_humidity_2m, '%');
  el('m-wind').textContent = isFiniteNumber(current.wind_speed_10m)
    ? `${Math.round(current.wind_speed_10m)} km/h ${windDirection(current.wind_direction_10m)}`.trim()
    : '--';
  el('m-precip').textContent = formatNumber(current.precipitation, ' mm', 1);
  el('m-pressure').textContent = formatNumber(current.surface_pressure, ' hPa');

  const uv = hourly.uv_index?.[start] ?? daily.uv_index_max?.[0];
  el('m-uv').textContent = isFiniteNumber(uv) ? `${uv.toFixed(1)} · ${uvCategory(uv)}` : '--';

  const visibility = hourly.visibility?.[start];
  el('m-visibility').textContent = isFiniteNumber(visibility)
    ? `${(visibility / 1000).toFixed(1)} km` : '--';

  el('m-sunrise').textContent = formatHour(daily.sunrise?.[0]);
  el('m-sunset').textContent = formatHour(daily.sunset?.[0]);
}

/**
 * Renders the hourly chart and scrollable hour cards.
 * @param {object} data Open-Meteo forecast payload.
 */
function renderHourly(data) {
  const hourly = data.hourly ?? {};
  const times = hourly.time ?? [];
  const { start, end } = hourlyWindow(times, data.current?.time);
  const slice = (arr) => (Array.isArray(arr) ? arr.slice(start, end) : []);

  const labels = slice(times).map((t) => formatHour(t));
  const temps = slice(hourly.temperature_2m);
  const pops = slice(hourly.precipitation_probability);
  const codes = slice(hourly.weather_code);
  const isDayFlags = slice(hourly.is_day);

  dom.hourlyStrip.replaceChildren(...labels.map((time, i) => {
    const { icon } = describeWeather(codes[i], isDayFlags[i] !== 0);
    const li = document.createElement('li');
    const timeEl = document.createElement('span');
    timeEl.className = 'h-time';
    timeEl.textContent = time;
    const iconEl = document.createElement('span');
    iconEl.className = 'h-icon';
    iconEl.textContent = icon;
    const tempEl = document.createElement('span');
    tempEl.className = 'h-temp';
    tempEl.textContent = formatTemperature(temps[i], state.unit);
    const popEl = document.createElement('span');
    popEl.className = 'h-pop';
    popEl.textContent = isFiniteNumber(pops[i]) ? `💧 ${pops[i]}%` : '';
    li.append(timeEl, iconEl, tempEl, popEl);
    return li;
  }));

  renderChart(labels, temps, pops);
}

/**
 * Draws (or updates) the temperature / precipitation chart.
 * @param {string[]} labels
 * @param {number[]} temps
 * @param {number[]} pops
 */
function renderChart(labels, temps, pops) {
  const canvas = el('hourly-chart');
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 180);
  gradient.addColorStop(0, 'rgba(86, 204, 242, 0.45)');
  gradient.addColorStop(1, 'rgba(86, 204, 242, 0)');

  const config = {
    data: {
      labels,
      datasets: [
        {
          type: 'line',
          label: `Temperature (°${state.unit === 'fahrenheit' ? 'F' : 'C'})`,
          data: temps,
          borderColor: '#56ccf2',
          backgroundColor: gradient,
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointRadius: 0,
          yAxisID: 'y'
        },
        {
          type: 'bar',
          label: 'Precipitation chance (%)',
          data: pops,
          backgroundColor: 'rgba(167, 139, 250, 0.35)',
          borderRadius: 4,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#a5b0d0', boxWidth: 12, usePointStyle: true } },
        tooltip: { backgroundColor: '#0d1430', borderColor: 'rgba(255,255,255,0.14)', borderWidth: 1 }
      },
      scales: {
        x: { ticks: { color: '#a5b0d0', maxTicksLimit: 8 }, grid: { display: false } },
        y: { position: 'left', ticks: { color: '#a5b0d0' }, grid: { color: 'rgba(255,255,255,0.06)' } },
        y1: {
          position: 'right', min: 0, max: 100,
          ticks: { color: '#a5b0d0', callback: (v) => `${v}%` },
          grid: { display: false }
        }
      }
    }
  };

  if (state.chart) {
    state.chart.data = config.data;
    state.chart.options = config.options;
    state.chart.update('none');
    return;
  }
  state.chart = new Chart(ctx, { type: 'bar', ...config });
}

/**
 * Renders the 7-day outlook list.
 * @param {object} data Open-Meteo forecast payload.
 */
function renderDaily(data) {
  const daily = data.daily ?? {};
  const days = daily.time ?? [];
  const maxes = daily.temperature_2m_max ?? [];
  const mins = daily.temperature_2m_min ?? [];
  const weekMax = Math.max(...maxes.filter(isFiniteNumber));
  const weekMin = Math.min(...mins.filter(isFiniteNumber));
  const todayIso = data.current?.time?.slice(0, 10);

  dom.daily.replaceChildren(...days.map((day, i) => {
    const { label, icon } = describeWeather(daily.weather_code?.[i], true);
    const { offset, width } = rangeBarGeometry(mins[i], maxes[i], weekMin, weekMax);

    const li = document.createElement('li');

    const dayEl = document.createElement('span');
    dayEl.className = 'd-day';
    dayEl.textContent = formatDayLabel(day, todayIso);

    const iconEl = document.createElement('span');
    iconEl.className = 'd-icon';
    iconEl.textContent = icon;

    const descEl = document.createElement('span');
    descEl.className = 'd-desc';
    const pop = daily.precipitation_probability_max?.[i];
    descEl.textContent = isFiniteNumber(pop) ? `${label} · 💧 ${pop}%` : label;

    const rangeEl = document.createElement('span');
    rangeEl.className = 'd-range';
    const minEl = document.createElement('span');
    minEl.className = 'd-min';
    minEl.textContent = formatTemperature(mins[i], state.unit);
    const bar = document.createElement('span');
    bar.className = 'range-bar';
    const fill = document.createElement('span');
    fill.className = 'range-fill';
    fill.style.left = `${offset}%`;
    fill.style.width = `${width}%`;
    bar.append(fill);
    const maxEl = document.createElement('span');
    maxEl.textContent = formatTemperature(maxes[i], state.unit);
    rangeEl.append(minEl, bar, maxEl);

    li.append(dayEl, iconEl, descEl, rangeEl);
    return li;
  }));
}

function addAssistantMessage(text, isUser = false) {
  const message = document.createElement('p');
  message.className = `assistant-message${isUser ? ' is-user' : ''}`;
  message.textContent = text;
  dom.assistantMessages.append(message);
  dom.assistantMessages.scrollTop = dom.assistantMessages.scrollHeight;
}

function updateAssistant(data) {
  state.latestForecast = data;
  const current = data.current ?? {};
  const daily = data.daily ?? {};
  const place = state.location.label.split(',')[0];
  const weather = describeWeather(current.weather_code, current.is_day !== 0);
  const rainChance = daily.precipitation_probability_max?.[0];
  dom.assistantContext.textContent = `Using the live forecast for ${place}`;
  dom.assistantInput.disabled = false;
  dom.assistantForm.querySelector('button').disabled = false;
  dom.assistantMessages.replaceChildren();
  addAssistantMessage(`${weather.label}, ${formatTemperature(current.temperature_2m, state.unit)} now. Ask me how the weather may affect your plans.`);

  const briefItems = [
    `${weather.label} now, feeling like ${formatTemperature(current.apparent_temperature, state.unit)}.`,
    isFiniteNumber(rainChance) ? `Today's peak rain chance is ${rainChance}%.` : 'Rain probability is unavailable.',
    `Wind is ${formatNumber(current.wind_speed_10m, ' km/h')} ${windDirection(current.wind_direction_10m)}.`,
    `Sunset is at ${formatHour(daily.sunset?.[0])}.`
  ];
  dom.assistantBrief.replaceChildren(...briefItems.map((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
}

function answerForecastQuestion(question) {
  const data = state.latestForecast;
  if (!data) return 'I am still waiting for the latest forecast.';
  const query = question.toLowerCase();
  const current = data.current ?? {};
  const daily = data.daily ?? {};
  const hourly = data.hourly ?? {};
  const { start, end } = hourlyWindow(hourly.time ?? [], current.time, 12);
  const nextRain = (hourly.precipitation_probability ?? []).slice(start, end).filter(isFiniteNumber);
  const peakRain = nextRain.length ? Math.max(...nextRain) : daily.precipitation_probability_max?.[0];
  const temperature = formatTemperature(current.temperature_2m, state.unit);
  const weather = describeWeather(current.weather_code, current.is_day !== 0).label.toLowerCase();

  if (/rain|umbrella|wet|storm/.test(query)) {
    if (!isFiniteNumber(peakRain)) return 'Rain probability is not available for the next few hours.';
    return peakRain >= 50
      ? `Yes, take an umbrella. Rain probability reaches ${peakRain}% over the next 12 hours.`
      : peakRain >= 25
        ? `An umbrella is sensible. Rain probability peaks near ${peakRain}% over the next 12 hours.`
        : `You can probably leave it behind; rain probability peaks at only ${peakRain}% over the next 12 hours.`;
  }
  if (/wear|clothes|jacket|coat|dress/.test(query)) {
    const value = current.temperature_2m;
    const advice = value < (state.unit === 'fahrenheit' ? 50 : 10)
      ? 'Wear a warm coat and layers.'
      : value < (state.unit === 'fahrenheit' ? 68 : 20)
        ? 'A light jacket or layered outfit should be comfortable.'
        : 'Light, breathable clothing should be comfortable.';
    return `It is ${temperature} with ${weather}. ${advice}`;
  }
  if (/outdoor|walk|run|cycle|picnic|plan/.test(query)) {
    const wind = current.wind_speed_10m;
    if (isFiniteNumber(peakRain) && peakRain >= 60) return `Outdoor plans look risky: rain probability reaches ${peakRain}% in the next 12 hours.`;
    if (isFiniteNumber(wind) && wind >= 35) return `Conditions are fairly windy at ${Math.round(wind)} km/h, so sheltered plans would be better.`;
    return `Outdoor conditions look reasonable at ${temperature}. Check the radar before leaving; the next-12-hour rain peak is ${formatNumber(peakRain, '%')}.`;
  }
  if (/wind/.test(query)) {
    return `Wind is ${formatNumber(current.wind_speed_10m, ' km/h')} from ${windDirection(current.wind_direction_10m) || 'an unknown direction'}.`;
  }
  if (/sun|uv/.test(query)) {
    return `Sunrise is ${formatHour(daily.sunrise?.[0])}, sunset is ${formatHour(daily.sunset?.[0])}, and today's maximum UV index is ${formatNumber(daily.uv_index_max?.[0], '', 1)}.`;
  }
  return `It is ${temperature} with ${weather}. Rain probability peaks at ${formatNumber(peakRain, '%')} over the next 12 hours. Try asking about an umbrella, clothing, wind, UV, or outdoor plans.`;
}

function renderNews(items) {
  dom.newsState.hidden = items.length > 0;
  dom.newsState.textContent = items.length ? '' : 'No recent weather news was found for this location.';
  dom.newsList.replaceChildren(...items.map((item) => {
    const listItem = document.createElement('li');
    listItem.className = 'news-card';

    const link = document.createElement('a');
    link.href = item.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    const source = document.createElement('span');
    source.className = 'news-source';
    source.textContent = decodeFeedText(item.source);

    const title = document.createElement('h3');
    title.textContent = decodeFeedText(item.title);

    const meta = document.createElement('span');
    meta.className = 'news-meta';
    const published = document.createElement('time');
    const isoDate = item.publishedAt ? `${item.publishedAt.replace(' ', 'T')}Z` : '';
    const date = new Date(isoDate);
    published.dateTime = Number.isNaN(date.getTime()) ? '' : date.toISOString();
    published.textContent = Number.isNaN(date.getTime())
      ? 'Recent'
      : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const openLabel = document.createElement('span');
    openLabel.textContent = 'Read ↗';
    meta.append(published, openLabel);

    link.append(source, title, meta);
    listItem.append(link);
    return listItem;
  }));
}

function decodeFeedText(value) {
  const documentFragment = new DOMParser().parseFromString(value, 'text/html');
  return documentFragment.body.textContent || value;
}

/* ------------------------------------------------------------------ */
/* Data flow                                                           */
/* ------------------------------------------------------------------ */

/**
 * Loads and renders the forecast for the location currently in state.
 */
async function loadForecast() {
  state.forecastAbort?.abort();
  const controller = new AbortController();
  state.forecastAbort = controller;
  setLoading(true);
  try {
    const data = await fetchForecast(state.location.latitude, state.location.longitude, {
      unit: state.unit,
      signal: controller.signal
    });
    if (controller.signal.aborted || state.forecastAbort !== controller) return;
    renderCurrent(data);
    renderHourly(data);
    renderDaily(data);
    updateAssistant(data);
    setLoading(false);
  } catch (error) {
    if (controller.signal.aborted || state.forecastAbort !== controller) return;
    setLoading(false);
    showToast(error.message || 'Could not load the forecast.');
  }
}

async function loadWeatherNews(refresh = false) {
  state.newsAbort?.abort();
  const controller = new AbortController();
  state.newsAbort = controller;
  const place = state.location.label.split(',')[0].trim();
  dom.newsLocation.textContent = `Latest reports near ${place}`;
  dom.newsState.hidden = false;
  dom.newsState.textContent = 'Loading local weather news…';
  dom.newsList.replaceChildren();
  dom.newsRefresh.disabled = true;

  try {
    const items = await fetchWeatherNews(state.location.label, {
      signal: controller.signal,
      refresh
    });
    if (state.newsAbort === controller) renderNews(items);
  } catch (error) {
    if (!controller.signal.aborted && state.newsAbort === controller) {
      dom.newsState.textContent = error.message || 'Weather news is unavailable right now.';
    }
  } finally {
    if (state.newsAbort === controller) dom.newsRefresh.disabled = false;
  }
}

/**
 * Centres the map/marker on a location and refreshes the forecast.
 * @param {{latitude:number, longitude:number, label:string, keepView?:boolean}} location
 */
function selectLocation(location) {
  state.location = {
    latitude: clampLatitude(location.latitude),
    longitude: normalizeLongitude(location.longitude),
    label: location.label || formatCoords(location.latitude, location.longitude)
  };
  marker.setLatLng([state.location.latitude, state.location.longitude]);
  if (!location.keepView) {
    map.flyTo([state.location.latitude, state.location.longitude], Math.max(map.getZoom(), 8), { duration: 0.8 });
  }
  hideSuggestions();
  loadForecast();
  loadWeatherNews();
}

function hideSuggestions() {
  dom.suggestions.hidden = true;
  dom.suggestions.replaceChildren();
}

/**
 * Renders the autocomplete dropdown.
 * @param {Array<object>} places
 */
function renderSuggestions(places) {
  if (!places.length) {
    hideSuggestions();
    return;
  }
  dom.suggestions.replaceChildren(...places.map((place) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.tabIndex = 0;

    const name = document.createElement('span');
    name.textContent = place.name;
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = [place.admin1, place.country].filter(Boolean).join(', ');
    li.append(name, sub);

    const choose = () => selectLocation({
      latitude: place.latitude,
      longitude: place.longitude,
      label: buildPlaceLabel(place)
    });
    li.addEventListener('click', choose);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose();
      }
    });
    return li;
  }));
  dom.suggestions.hidden = false;
}

/**
 * Debounces a function call.
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const handleSuggest = debounce(async (query) => {
  const term = sanitizeQuery(query);
  if (term.length < 2) {
    hideSuggestions();
    return;
  }
  state.suggestAbort?.abort();
  state.suggestAbort = new AbortController();
  try {
    renderSuggestions(await searchPlaces(term, { signal: state.suggestAbort.signal }));
  } catch {
    hideSuggestions();
  }
}, 280);

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function bindEvents() {
  dom.searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const term = sanitizeQuery(dom.searchInput.value);
    if (term.length < 2) {
      showToast('Enter at least two characters to search.');
      return;
    }
    try {
      const [first] = await searchPlaces(term, { count: 1 });
      if (!first) {
        showToast(`No place found for "${term}".`);
        return;
      }
      selectLocation({ latitude: first.latitude, longitude: first.longitude, label: buildPlaceLabel(first) });
    } catch (error) {
      showToast(error.message || 'Search failed.');
    }
  });

  dom.searchInput.addEventListener('input', (event) => handleSuggest(event.target.value));
  dom.searchInput.addEventListener('blur', () => setTimeout(hideSuggestions, 180));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideSuggestions();
  });

  dom.locateBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast('Geolocation is not supported by this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const place = await reverseGeocode(coords.latitude, coords.longitude);
        selectLocation({
          latitude: coords.latitude,
          longitude: coords.longitude,
          label: place && place.name ? buildPlaceLabel(place) : 'My location'
        });
      },
      () => showToast('Location permission denied.'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  });

  document.querySelectorAll('.unit-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const unit = button.dataset.unit;
      if (unit === state.unit) return;
      state.unit = unit;
      document.querySelectorAll('.unit-btn').forEach((b) => b.classList.toggle('is-active', b === button));
      loadForecast();
    });
  });

  document.querySelectorAll('.layer-btn').forEach((button) => {
    button.addEventListener('click', () => {
      state.layer = button.dataset.layer;
      document.querySelectorAll('.layer-btn').forEach((b) => b.classList.toggle('is-active', b === button));
      const frames = state.frames[state.layer] ?? [];
      state.frameIndex = Math.max(0, frames.length - 1);
      if (state.layer === 'none') toggleAnimation(false);
      renderOverlay();
    });
  });

  dom.playBtn.addEventListener('click', () => toggleAnimation(!state.playing));
  dom.frameSlider.addEventListener('input', (event) => {
    toggleAnimation(false);
    state.frameIndex = Number(event.target.value);
    renderOverlay();
  });

  dom.newsRefresh.addEventListener('click', () => loadWeatherNews(true));

  document.querySelectorAll('.assistant-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const selected = tab.dataset.assistantTab;
      document.querySelectorAll('.assistant-tab').forEach((button) => {
        const active = button === tab;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
      });
      el('assistant-panel-ask').hidden = selected !== 'ask';
      el('assistant-panel-brief').hidden = selected !== 'brief';
    });
  });

  const askAssistant = (question) => {
    const cleanQuestion = sanitizeQuery(question, 120);
    if (!cleanQuestion) return;
    addAssistantMessage(cleanQuestion, true);
    addAssistantMessage(answerForecastQuestion(cleanQuestion));
    dom.assistantInput.value = '';
  };
  dom.assistantForm.addEventListener('submit', (event) => {
    event.preventDefault();
    askAssistant(dom.assistantInput.value);
  });
  document.querySelectorAll('[data-question]').forEach((button) => {
    button.addEventListener('click', () => askAssistant(button.dataset.question));
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      resumeAnimation = state.playing;
      if (state.playing) toggleAnimation(false);
    } else if (resumeAnimation && state.layer !== 'none') {
      resumeAnimation = false;
      toggleAnimation(true);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

function init() {
  initMap();
  bindEvents();
  loadForecast();
  loadWeatherNews();
  loadOverlayFrames();
}

init();
