# --- Build the React client ---
FROM node:24-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# --- Runtime: Express API + built client ---
FROM node:24-alpine
# git: the Repos panel reads local clones (read-only)
RUN apk add --no-cache git
WORKDIR /app/server
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=client /app/client/dist ./public

USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT:-3001}/api/health || exit 1
CMD ["node", "index.js"]
