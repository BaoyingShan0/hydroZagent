FROM node:22.19.0-bookworm-slim AS build

WORKDIR /srv/hcs
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22.19.0-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /srv/hcs
COPY --from=build --chown=node:node /srv/hcs/package.json /srv/hcs/package-lock.json ./
COPY --from=build --chown=node:node /srv/hcs/node_modules ./node_modules
COPY --from=build --chown=node:node /srv/hcs/dist ./dist
COPY --from=build --chown=node:node /srv/hcs/migrations ./migrations
USER node
EXPOSE 8787
CMD ["node", "dist/index.js"]
