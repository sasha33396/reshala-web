FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json turbo.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/backend/package.json ./apps/backend/

RUN npm install --legacy-peer-deps

COPY packages/shared/ ./packages/shared/
COPY apps/backend/ ./apps/backend/
COPY tsconfig.json ./

RUN cd packages/shared && npx tsc
RUN cd apps/backend && npx nest build

FROM node:20-alpine
RUN apk add --no-cache openssh-client
WORKDIR /app
ENV NODE_ENV=production

# npm workspaces hoists все зависимости в корневой node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/backend/dist ./dist
COPY --from=builder /app/apps/backend/package.json ./

EXPOSE 3001
CMD ["node", "dist/main"]
