FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package.json ./
RUN npm install && npm cache clean --force

# Copy app source
COPY index.html ./
COPY fight_cancer_logo.png ./
COPY server.js ./

# Create data directory for persistence
RUN mkdir data

EXPOSE 80

CMD ["node", "server.js"]