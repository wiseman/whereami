# whereami

A small web page for watching raw browser geolocation (GPS) fixes: a map with
the accuracy circle and track, a readout of the latest fix, and a log of every
fix as it arrives. Export to CSV.

Live at https://whereami.obliscence.com/ (HTTPS is required for geolocation).

## Layout

- `site/` — the static app (`index.html`, `app.js`, `style.css`); Leaflet is loaded from cdnjs.
- `captain-definition` — CapRover build: copies `site/` into `nginx:alpine`.

## Develop

```sh
cd site && python3 -m http.server 8765
```

`localhost` counts as a secure context, so geolocation works there. To test
from a phone, expose it over HTTPS, e.g. `tailscale serve --bg 8765`.

## Deploy

```sh
caprover-cli deploy whereami
```
