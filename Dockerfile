FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Install build dependencies for canvas
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    fonts-inter \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Install app dependencies
COPY package.json ./
RUN npm install && npm cache clean --force

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