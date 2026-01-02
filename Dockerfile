# --- Stage 1: Builder ---
FROM node:20-slim AS builder

WORKDIR /usr/src/app

# Install build dependencies for canvas compilation
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Install app dependencies (compiled native modules will be here)
COPY package.json ./
RUN npm install && npm cache clean --force

# --- Stage 2: Runner ---
FROM node:20-slim

WORKDIR /usr/src/app

# Install ONLY runtime shared libraries and fonts
RUN apt-get update && apt-get install -y \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    fonts-inter \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Copy compiled node_modules from builder
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY package.json ./

# Copy app source
COPY index.html ./
COPY fight_cancer_logo.png ./
COPY server.js ./
COPY assets ./assets

# Create data directory for persistence
RUN mkdir data && chown -R node:node /usr/src/app

EXPOSE 3000

USER node

CMD ["node", "server.js"]