FROM python:3.11-slim

WORKDIR /app

# Create an optional non-root user (use with --user appuser if you prefer)
RUN adduser --disabled-password --gecos "" appuser \
  && mkdir -p /app/data /app/uploads \
  && chown -R appuser:appuser /app

# QR decode (local) + ASGI server
RUN apt-get update \
  && apt-get install -y --no-install-recommends libzbar0 \
  && pip install --no-cache-dir \
       "fastapi>=0.110.0" \
       "uvicorn[standard]>=0.23.0" \
       "python-multipart>=0.0.6" \
       "pillow>=9.0.0" \
       "pyzbar>=0.1.9" \
  && rm -rf /var/lib/apt/lists/*

COPY app.py /app/app.py
COPY static /app/static

# Default port: HTTP via PORT (8000). HTTPS terminates upstream (proxy) in typical VPS setups.
EXPOSE 8000

CMD ["python", "app.py"]
