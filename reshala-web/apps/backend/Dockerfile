FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json turbo.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/backend/package.json ./apps/backend/

RUN npm install --legacy-peer-deps

# Copy sources
COPY packages/shared/ ./packages/shared/
COPY apps/backend/ ./apps/backend/
COPY tsconfig.json ./

# Build shared then backend
RUN cd packages/shared && npx tsc
RUN cd apps/backend && npx nest build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/apps/backend/dist ./dist
COPY --from=builder /app/apps/backend/node_modules ./node_modules
COPY --from=builder /app/apps/backend/package.json ./

EXPOSE 3001
CMD ["node", "dist/main"]
