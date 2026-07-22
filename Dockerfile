FROM node:20-alpine AS builder

WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Install dependencies (including devDependencies to compile TypeScript)
RUN npm ci

# Copy source code
COPY . .

# Build the project (compiles TypeScript to dist/)
RUN npm run build

# --- Runner Stage ---
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy package manifests
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built files and uploads/any necessary folders from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/uploads ./uploads

EXPOSE 8000

CMD ["node", "dist/index.js"]
