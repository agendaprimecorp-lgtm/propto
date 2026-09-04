FROM node:20-alpine

WORKDIR /app

# Copy root package files
COPY package*.json ./

# Copy service-specific package files
COPY services/capture-worker/package*.json ./services/capture-worker/

# Install dependencies (production only)
RUN npm ci --omit=dev

# Copy source code
COPY services/capture-worker ./services/capture-worker
COPY packages ./packages

# Build the capture-worker (may fail if no build script, that's OK)
RUN npm run build --workspace=@propto/capture-worker || true

# Copy entrypoint script and make it executable
COPY scripts/docker-entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Expose port 3000 for future API
EXPOSE 3000

# Set entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]
