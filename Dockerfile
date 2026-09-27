# Debian rather than Alpine: sharp ships prebuilt binaries for glibc, and on
# musl it falls back to compiling libvips from source.
FROM node:22-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./

# --omit=dev also keeps mongodb-memory-server out of the image, which would
# otherwise download a MongoDB binary at install time.
RUN npm ci --omit=dev

FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY assets ./assets
COPY index.html CNAME ./

# Runs unprivileged; the node image already provides this user.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "server.js"]
