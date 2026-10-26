# Contributing

Thanks for improving Weather Assistant. Keep changes small, match the existing vanilla JavaScript and CSS patterns, and avoid introducing a framework or build step for a focused change.

## Local workflow

1. Create a topic branch for the change.
2. Serve the project from its root with `python -m http.server 5173` or `npm start`.
3. Run `npm test` when Node.js is available.
4. Follow the manual smoke-test checklist in the README for UI, map, or API changes.
5. Review the diff and ensure no credentials, generated files, or unrelated changes are included.

## Change guidance

- Keep API access in `js/api.js` and pure calculations/formatting in `js/utils.js`.
- Render untrusted API text using `textContent`; validate external links before making them clickable.
- Preserve loading, error, and empty states when changing external data flows.
- Treat third-party APIs as optional dependencies: handle timeouts, rate limits, and missing fields without breaking the forecast dashboard.
- Keep keyboard access, accessible labels, and narrow-screen layouts intact.
- Update the README when features, providers, setup, or known limitations change.

## Pull requests

Describe the user-visible change, list the checks performed, and call out any provider or browser limitations. Use a concise conventional title such as `fix: ignore stale forecast responses` or `docs: clarify local setup`.