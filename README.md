# Weather Assistant

A responsive, single-page weather dashboard with an interactive map, forecasts, local weather headlines, and a forecast-guidance assistant. It is built with browser-native JavaScript modules and public APIs; there is no application server or API key.

## Features

- Interactive Leaflet map; selecting a city, using browser location, or clicking the map updates the forecast.
- Current conditions, hourly temperature and precipitation chart, and a seven-day outlook.
- RainViewer radar animation with play/pause and frame scrubbing.
- Location-related headlines from Google News RSS.
- Forecast guidance for rain, clothing, outdoor plans, wind, and UV, plus a daily brief.
- Celsius/Fahrenheit toggle, city autocomplete, and responsive layouts.

The forecast assistant is a small rule-based helper using the currently loaded Open-Meteo data. It does not call a generative AI service. The weather-news panel is best-effort: its public RSS conversion service may rate-limit requests.

## Technology stack

- **Frontend:** semantic HTML5, CSS3 (Grid, Flexbox, responsive media queries), and native JavaScript ES modules.
- **Browser APIs:** Fetch, AbortController, Geolocation, Canvas, and DOM APIs.
- **Map:** Leaflet 1.9.4, loaded from unpkg; OpenStreetMap raster tiles.
- **Charts:** Chart.js 4.4.3, loaded from jsDelivr.
- **Typography:** Outfit from Google Fonts.
- **Local tooling:** Python's built-in HTTP server or Node.js `http-server` through `npx`; Node's built-in test runner for unit tests.
- **Build system:** None. The site is static and runs directly from the repository root when served over HTTP.

## Requirements

- A modern browser with JavaScript enabled and an internet connection.
- Python 3 for the simplest local server, or Node.js and npm to use the package scripts and run tests.

The runtime uses Leaflet, Chart.js, and the Outfit font from CDNs. No dependency installation is needed to serve the app with Python.

## Run locally

Serve the project directory over HTTP because the application uses ES modules. Opening `index.html` directly from the filesystem is not supported.

```powershell
# Python
python -m http.server 5173

# Or Node.js (uses npx to run http-server)
npm start
```

Open <http://localhost:5173/>. On Windows, `py -m http.server 5173` can be used if the `python` command is unavailable.

The app can also be deployed to any static web host. Publish the repository root so `index.html`, `css/`, and `js/` remain at their expected relative paths. HTTPS is required for browser geolocation outside localhost.

## Tests

The built-in Node test runner covers the pure utility functions in `js/utils.js` (weather-code interpretation, formatting, coordinate handling, input cleanup, hourly ranges, and temperature-bar geometry). No npm packages are required for the tests.

```powershell
npm test
```

The automated tests do not exercise the DOM, map, or live third-party APIs. Use this manual smoke-test checklist after changing those areas:

1. Load the page and confirm current conditions, 24 hourly entries, seven daily entries, and the map appear.
2. Search for a city and select a suggestion; verify the forecast and news location update.
3. Click the map and confirm the selected coordinates receive a forecast.
4. Switch between °C and °F; check the current, hourly, daily, and assistant values.
5. Switch the map overlay off and on, scrub a radar frame, and play/pause the animation.
6. Ask an assistant question, open the Brief tab, and refresh the news panel.
7. Check desktop and mobile widths and confirm there is no page-level horizontal overflow.

## APIs, libraries, and attribution

| Use | Service and endpoint |
| --- | --- |
| Current, hourly, and daily forecasts | [Open-Meteo Forecast API](https://api.open-meteo.com/v1/forecast) |
| City search/autocomplete | [Open-Meteo Geocoding API](https://geocoding-api.open-meteo.com/v1/search) |
| Reverse geocoding for map selections | [BigDataCloud client API](https://api.bigdatacloud.net/data/reverse-geocode-client) |
| Radar metadata and tile imagery | [RainViewer Weather Maps API](https://api.rainviewer.com/public/weather-maps.json) and its tile host |
| Location-related headlines | [Google News RSS](https://news.google.com/rss/search) converted to JSON by [RSS2JSON](https://api.rss2json.com/v1/api.json) |
| Base map tiles and map rendering | [OpenStreetMap](https://www.openstreetmap.org/copyright) tiles rendered with [Leaflet](https://leafletjs.com/) |
| Forecast chart | [Chart.js](https://www.chartjs.org/) |
| Web font | [Outfit](https://fonts.google.com/specimen/Outfit) via Google Fonts |

No API credentials are required or included. When browser geolocation is requested, the chosen coordinates are sent to the forecast and reverse-geocoding providers. External service availability, usage limits, and terms apply.

## Known provider limitations

- RainViewer currently returns radar frames but an empty satellite infrared frame list, so the Clouds control is disabled. Open-Meteo cloud-cover values are point forecasts and are not map tiles.
- RSS2JSON can return rate-limit or temporary service errors for new news queries. The news panel reports these errors and can be retried later; forecast and map functionality are independent of news availability.
- Rain radar is transparent where no precipitation is detected or where radar coverage is absent. The app does not generate radar data.

## Project structure

```text
weather_assistant/
├── .gitignore         # Local dependencies, build output, and environment files
├── index.html          # Single-page markup and CDN dependencies
├── css/styles.css      # Theme, dashboard layout, and responsive rules
├── js/app.js           # UI state, map, rendering, and interactions
├── js/api.js           # Forecast, geocoding, radar, and news requests
├── js/utils.js         # Pure formatting, weather-code, and coordinate helpers
├── tests/utils.test.js # Node built-in unit tests
├── package.json        # Local server and test scripts
└── CONTRIBUTING.md     # Local workflow for repository changes
```

## Implementation notes

- API responses are cached in memory for five minutes. Requests have a 12-second timeout; superseded forecast requests are cancelled and ignored.
- Search input is trimmed, stripped of control characters, and length-limited. API text is rendered with `textContent` rather than HTML injection.
- Coordinates are clamped/normalised before requests. Radar animation reuses a tile layer and pauses when the tab is hidden.
