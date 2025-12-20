# Trip Splitter (Dockerized)

Lightweight Python app to parse invoice HTML and split costs. No external deps beyond Python stdlib.

## Run locally (no Docker)
```bash
python3 app.py
# open http://localhost:8005
```

## Build & run with Docker
```bash
cd /home/yparanomos/remote_developement/Projects/N8N-Projects/project-application-invoice-splitter
docker build -t trip-splitter .
docker run -d --name trip-splitter -p 8005:8005 \
  -e PORT=8005 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/uploads:/app/uploads \
  trip-splitter
```

Notes:
- Binds to `0.0.0.0` inside the container; use `PORT` env to change.
- Mount `data/` and `uploads/` for persistence on host.
- Image stays slim (python:3.11-slim, no pip deps). A non-root user runs the app.
