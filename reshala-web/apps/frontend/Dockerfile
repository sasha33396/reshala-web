FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json turbo.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/frontend/package.json ./apps/frontend/

RUN npm install --legacy-peer-deps

COPY packages/shared/ ./packages/shared/
COPY apps/frontend/ ./apps/frontend/
COPY tsconfig.json ./

RUN cd packages/shared && npx tsc
RUN cd apps/frontend && npx next build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/frontend/.next ./apps/frontend/.next
COPY --from=builder /app/apps/frontend/next.config.js ./apps/frontend/
COPY --from=builder /app/apps/frontend/package.json ./apps/frontend/

EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "apps/frontend", "-p", "3000"]
