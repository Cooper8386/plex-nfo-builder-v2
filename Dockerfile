FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg gosu tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS dependencies
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.19.0
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
COPY shared/package.json shared/package.json

FROM dependencies AS production-dependencies
RUN pnpm --filter server... install --prod --frozen-lockfile

FROM dependencies AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM build AS check
RUN chown -R node:node /app
USER node
RUN pnpm lint && pnpm typecheck && pnpm test

FROM base AS runtime
ENV NODE_ENV=production MEDIA_ROOT=/media CONFIG_DIR=/config
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/client/dist ./client/dist
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /media /config && chown node:node /media /config
VOLUME ["/media", "/config"]
EXPOSE 8000
ENTRYPOINT ["/usr/bin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "server/dist/index.js"]
