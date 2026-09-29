# Build stage: toolchain for native modules (better-sqlite3 falls back to node-gyp when no prebuild matches)
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000
COPY tsconfig.json ./
COPY src ./src
RUN yarn build \
  && yarn install --frozen-lockfile --production --ignore-scripts --prefer-offline --network-timeout 600000

# Runtime stage: compiled code + production node_modules (native binaries built above) + assets
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY assets ./assets
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
CMD ["node", "dist/index.js"]
