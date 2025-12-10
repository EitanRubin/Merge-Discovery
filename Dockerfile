# ============================================
# Merge Discovery - Multi-stage Dockerfile
# ============================================
# This Dockerfile builds and runs the API Discovery Tool
# which includes both frontend and backend services.

# ============================================
# Stage 1: Build Frontend
# ============================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY client-processor/frontend/package*.json ./

# Install dependencies
RUN npm ci

# Copy frontend source
COPY client-processor/frontend/ ./

# Build frontend
RUN npm run build

# ============================================
# Stage 2: Build Backend
# ============================================
FROM node:20-alpine AS backend-builder

WORKDIR /app/backend

# Copy backend package files
COPY client-processor/backend/package*.json ./

# Install dependencies
RUN npm ci

# Copy backend source
COPY client-processor/backend/ ./

# Build backend
RUN npm run build

# ============================================
# Stage 3: Production Runtime
# ============================================
FROM node:20-alpine AS production

# Install Python for Noizz2025 (optional - for full scan mode)
RUN apk add --no-cache python3 py3-pip

WORKDIR /app

# Copy backend build and dependencies
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules
COPY --from=backend-builder /app/backend/package.json ./backend/

# Copy frontend build (to be served by backend or nginx)
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy configuration files
COPY client-processor/backend/config.json ./backend/

# Copy analysis scripts and tools
COPY run_analysis.py ./
COPY run_pipeline.js ./
COPY merge_api_calls.js ./
COPY package.json ./

# Copy output files if they exist (for quick mode)
COPY outputs/ ./outputs/ 2>/dev/null || true

# Copy Noizz2025 for full scan capability
COPY Noizz2025/ ./Noizz2025/ 2>/dev/null || true

# Copy Static_Analysis for full scan capability
COPY Static_Analysis/ ./Static_Analysis/ 2>/dev/null || true

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Expose ports
EXPOSE 3001
EXPOSE 5173

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start the backend server
WORKDIR /app/backend
CMD ["node", "dist/index.js"]

