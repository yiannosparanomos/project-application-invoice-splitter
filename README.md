# Trip Splitter (Dockerized)

Lightweight Python app to parse invoice HTML and split costs. No external deps beyond Python stdlib.

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
