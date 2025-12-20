FROM python:3.11-slim

WORKDIR /app

# Create a non-root user for security
RUN adduser --disabled-password --gecos "" appuser \
  && mkdir -p /app/data /app/uploads \
  && chown -R appuser:appuser /app

# ASGI dev server + FastAPI for uvicorn mode with autoreload
RUN pip install --no-cache-dir "fastapi>=0.110.0" "uvicorn[standard]>=0.23.0" "python-multipart>=0.0.6"

COPY app.py /app/app.py
COPY static /app/static

USER appuser

# Default ports: HTTP via PORT (8000), optional HTTPS via SSL_PORT (8443).
EXPOSE 8000 8443

CMD ["python", "app.py"]
