# Node 18+ is the only requirement — the server uses built-in fetch and has
# no dependencies, so there is nothing to install.
FROM node:22-alpine

WORKDIR /app
COPY . .

# The gear list and ride history have to live outside the code directory, for
# two independent reasons. /app is owned by root and the process runs as `node`,
# so a write beside the code fails outright with EACCES — sync would report an
# error on every save. And updating a container means replacing it, not
# restarting it, so anything inside the container is discarded on every update.
# Mount a named volume here: -v cwem-state:/state
RUN mkdir -p /state && chown node:node /state
VOLUME ["/state"]

ENV PORT=8765 HOST=0.0.0.0 STATE_DIR=/state
EXPOSE 8765

# Don't run as root.
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8765/ >/dev/null || exit 1

CMD ["node", "server.js"]
