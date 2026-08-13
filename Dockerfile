# Node 18+ is the only requirement — the server uses built-in fetch and has
# no dependencies, so there is nothing to install.
FROM node:22-alpine

WORKDIR /app
COPY . .

ENV PORT=8765 HOST=0.0.0.0
EXPOSE 8765

# Don't run as root.
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8765/ >/dev/null || exit 1

CMD ["node", "server.js"]
