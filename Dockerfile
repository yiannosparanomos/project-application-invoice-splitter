FROM python:3.11-slim

WORKDIR /app

# Create an optional non-root user (use with --user appuser if you prefer)
RUN adduser --disabled-password --gecos "" appuser \
  && mkdir -p /app/data /app/uploads \
  && chown -R appuser:appuser /app

# ASGI server + FastAPI for uvicorn mode
RUN pip install --no-cache-dir "fastapi>=0.110.0" "uvicorn[standard]>=0.23.0" "python-multipart>=0.0.6"

COPY app.py /app/app.py
COPY static /app/static

# Default port: HTTP via PORT (8000). HTTPS terminates upstream (proxy) in typical VPS setups.
EXPOSE 8000

CMD ["python", "app.py"]
