FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# We don't have a package.json yet, so we'll create one or install directly
RUN npm init -y && \
    npm install express ws body-parser

# Copy app source
COPY index.html ./
COPY fight_cancer_logo.png ./
COPY server.js ./

# Create data directory for persistence
RUN mkdir data

EXPOSE 80

CMD ["node", "server.js"]