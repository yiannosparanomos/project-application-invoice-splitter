# Trip Splitter (Dockerized)

Lightweight Python app to parse invoice HTML and split costs. No external deps beyond Python stdlib.

## Run locally (no Docker)
```bash
python3 app.py
# open http://localhost:8000
```

## Run with Docker Compose
```bash
# build and start
docker compose up -d --build

# logs (optional)
docker compose logs -f

# stop
docker compose down
```

Notes:
- HTTP on `PORT` (default 8000); override with `PORT=9000 docker compose up -d --build`. Compose runs `uvicorn app:app --reload` so code changes hot-reload when the repo is mounted in the container.
- Optional HTTPS on `SSL_PORT` (default 8443). Map host 443 by editing `docker-compose.yml` ports to `443:${SSL_PORT:-8443}`.
- `DISABLE_HTTP=1` turns off plain HTTP when you only want HTTPS.
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

## Enable HTTPS (staging or prod)
1) Put a cert/key in `./certs` (PEM). Self-signed example for staging:
```bash
openssl req -x509 -nodes -newkey rsa:2048 -days 365 ^
  -keyout certs/server.key ^
  -out certs/server.crt ^
  -subj "/CN=localhost"
```
2) Start with TLS env vars:
```bash
SSL_CERTFILE=/certs/server.crt SSL_KEYFILE=/certs/server.key docker compose up -d --build
```
   PowerShell alternative: `$env:SSL_CERTFILE="/certs/server.crt"; $env:SSL_KEYFILE="/certs/server.key"; docker compose up -d --build`. You can also drop these into a `.env` file.
3) For cloud with a real CA, replace the cert/key with the CA-issued pair (DNS/HTTP validation is done outside this app). Set `DISABLE_HTTP=1` if you only want HTTPS. Map host 443 to the container’s `SSL_PORT` (8443 by default) in `docker-compose.yml`.
