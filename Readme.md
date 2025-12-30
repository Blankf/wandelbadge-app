# Wandelbadge App 2026

A walking tracker application that generates badges to monitor and visualize your daily walking progress.

## Features

- 📊 Track daily walking progress
- 🎯 Set and monitor walking goals
- 💾 Browser localStorage for data persistence
- 🐳 Docker containerized for easy deployment

## Quick Start

### Using Docker Compose

```bash
docker-compose up -d --build
```

Access the application at: http://localhost:7000

### Using Docker CLI

```bash
# Build the image
docker build -t wandelbadge-app .

# Run the container
docker run -d -p 7000:80 --name wandelbadge-app wandelbadge-app
```

## Docker Compose Example

```yaml
version: '3.8'

services:
  wandelbadge-app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "7000:80"
    restart: unless-stopped
```

## Configuration

### Port Customization

If port 7000 is already in use, modify the port mapping in `docker-compose.yml`:

```yaml
ports:
  - "9000:80"  # Change 9000 to your preferred port
```

## Data Persistence

The application uses browser localStorage to save your walking progress. Your data persists across:
- Browser sessions
- Docker container restarts
- Application updates

> **Note:** Data is stored client-side in your browser. Clearing browser data will reset your progress.

## Docker Image

Published to GitHub Container Registry:
- `ghcr.io/blankf/wandelbadge-app:latest`
- `ghcr.io/blankf/wandelbadge-app:YYYY.MM.DD`

## License

MIT