# Use a slim Python image with FFmpeg support
FROM python:3.11-slim

# Install system dependencies and FFmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libva-drm2 libva2 i915-va-driver \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create a non-root user
RUN useradd -m -u 1000 mediauser
USER root

# Create necessary directories and set permissions
RUN mkdir -p shared_media thumbs logs temp/hls \
    && chown -R mediauser:mediauser /app

# Switch to non-root user
USER mediauser

# Expose port
EXPOSE 51733

# Healthcheck to ensure API is responsive
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:51733/api/system/health', timeout=5)" || exit 1

# Start application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "51733"]
