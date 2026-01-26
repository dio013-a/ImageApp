FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production=false

# Copy source code
COPY . .

# Build worker
RUN npm run build:worker

# Run worker
CMD ["node", "dist-worker/worker/worker.js"]
