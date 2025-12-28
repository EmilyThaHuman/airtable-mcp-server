# Use Node.js LTS
FROM node:20-alpine

# Build argument to force cache invalidation
ARG BUILD_DATE
ARG BUILD_VERSION
ARG CACHE_BUST=1

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY tsconfig.build.json ./
COPY vite.config.ts ./
COPY postcss.config.js ./
COPY tailwind.config.ts ./

# Install dependencies (no cache to ensure fresh installs)
RUN npm ci --no-cache

# Copy source code
COPY src ./src

# NUCLEAR OPTION: Remove ONLY build output directories (not node_modules cache)
# This ensures a completely fresh build every time without breaking TypeScript
RUN rm -rf dist assets .vite .wrangler \
    && echo "Cleaned build artifacts at $(date)"

# Build the widgets (Vite) and server (TypeScript)
# This creates the assets/ directory with built HTML/JS/CSS
# Build timestamp to verify fresh builds
# CACHE_BUST ensures this layer is rebuilt every time
RUN echo "Cache bust: $CACHE_BUST" && \
    npm run build && npm run build:widgets && \
    echo "Build completed at $(date)" > /app/.build-timestamp && \
    echo "Build version: $BUILD_VERSION" >> /app/.build-timestamp && \
    echo "=== Built JavaScript files ===" && \
    ls -la /app/assets/*.js 2>/dev/null | head -10 || echo "No JS files found" && \
    echo "=== HTML file bundle reference ===" && \
    ls -la /app/assets/src/components/*.html 2>/dev/null | head -5 || echo "No HTML files found"

# Expose the port
EXPOSE 8006

# Set environment variable for port
ENV PORT=8006

# Start the server
CMD ["node", "dist/server/server.js"]

