FROM python:3.11-slim

WORKDIR /app

# Create a non-root user for security
RUN adduser --disabled-password --gecos "" appuser \
  && mkdir -p /app/data /app/uploads \
  && chown -R appuser:appuser /app

COPY app.py /app/app.py
COPY static /app/static

USER appuser

# Default port is configurable via PORT; app.py defaults to 8005.
EXPOSE 8005

CMD ["python", "app.py"]
