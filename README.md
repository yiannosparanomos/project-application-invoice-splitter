# Trip Splitter (Dockerized)

```bash
pip install fastapi uvicorn
# Optional for offline QR decode (needs system libzbar): pip install pillow pyzbar
# Optional for headless HTML fetch (JS-rendered pages): pip install playwright && playwright install chromium
```

Lightweight Python app to parse invoice HTML and split costs. QR decoding can run locally (Pillow + pyzbar + libzbar) or via the external api.qrserver.com service; see QR notes below.

## Run locally (no Docker)
```bash
python3 app.py
# open http://localhost:8000
```

## Run with Docker Compose
```bash
# build and start (staging or VPS)
docker compose up -d --build

# logs (optional)
docker compose logs -f

# stop
docker compose down
```

Notes:
- HTTP on `PORT` (default 8000); override with `PORT=9000 docker compose up -d --build`.
- SSL/TLS should terminate at your VPS reverse proxy (nginx/caddy/etc.); the container serves plain HTTP on `PORT`.
- Host volumes `./data` and `./uploads` hold state/uploads so the image stays lean.
- Container runs as root by default to avoid bind-mount permission issues. If you prefer non-root, run with `--user appuser` (or set `user: appuser` in Compose) and ensure `data`/`uploads` are writable by that user.

## Build & run with Docker (optional)
```bash
docker build -t trip-splitter .
docker run -d --name trip-splitter -p 8000:8000 ^
  -e PORT=8000 ^
  -v %cd%/data:/app/data ^
  -v %cd%/uploads:/app/uploads ^
  trip-splitter
```

Image stays slim (python:3.11-slim, no pip deps) and runs as a non-root user.

SSL is handled outside the container (reverse proxy), so no in-container certs are needed.

## QR decoding (important)
- The app first tries local decode (`decode_qr_locally`). Install deps to enable it: system `libzbar` plus Python `pillow` and `pyzbar`.
- If local decode is unavailable, it falls back to https://api.qrserver.com/v1/read-qr-code. This requires outbound HTTPS; in restricted environments you will see “QR decode failed: network error”.
- Debug lines include the decode source (`local` vs `remote`) and any local_error so you can pinpoint why a QR failed.

Headless fetch (rendered HTML)
- Some Entersoft pages load invoice rows via JS; the plain HTTP fetch is just a 3 KB shell. To fetch the rendered HTML automatically, install Playwright + Chromium (see above) and set `HEADLESS_FETCH=1` in the environment. The server will then try a headless fetch when plain fetches return tiny pages.
