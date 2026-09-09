FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@11.19.0
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
COPY shared/package.json shared/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production MEDIA_ROOT=/media CONFIG_DIR=/config
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /media /config && chown node:node /media /config
USER node
VOLUME ["/media", "/config"]
EXPOSE 8000
CMD ["node", "server/dist/index.js"]
