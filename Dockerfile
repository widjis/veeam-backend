# ---- Base ----
FROM node:16-alpine

# Workdir
WORKDIR /app

# ---- Copy & verify entrypoint early ----
# (so .dockerignore patterns for later COPY don't affect it)
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Normalize line endings, make executable, and LOG/VERIFY
RUN set -eux; \
  # remove CRLF if present
  sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh; \
  chmod +x /usr/local/bin/docker-entrypoint.sh; \
  echo "== Entrypoint: ls -l =="; \
  ls -l /usr/local/bin/docker-entrypoint.sh; \
  echo "== Entrypoint: shebang =="; \
  head -n 1 /usr/local/bin/docker-entrypoint.sh; \
  echo "== Entrypoint: CRLF check =="; \
  if grep -q $'\r' /usr/local/bin/docker-entrypoint.sh; then \
    echo "WARNING: CRLF detected in docker-entrypoint.sh"; \
  else \
    echo "Line endings OK (LF)"; \
  fi; \
  echo "== Entrypoint: sha256sum =="; \
  sha256sum /usr/local/bin/docker-entrypoint.sh; \
  # Optional: show file type, then remove the 'file' pkg to keep image small
  apk add --no-cache file > /dev/null; \
  echo "== Entrypoint: file type =="; \
  file /usr/local/bin/docker-entrypoint.sh; \
  apk del file > /dev/null

# ---- Install deps (production) ----
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# ---- App code ----
COPY . .

# Ensure expected runtime dirs exist
RUN mkdir -p logs data config reports

# ---- Config files (redundant if already in previous COPY, but kept explicit) ----
COPY config/default-config.json ./config/
COPY config/config.json ./config/

# Verify config presence and log details
RUN set -eux; \
  echo "== Config directory listing =="; \
  ls -al ./config || true; \
  [ -f ./config/config.json ] && echo "config.json present" || (echo "config.json MISSING!" && exit 1); \
  [ -f ./config/default-config.json ] && echo "default-config.json present" || echo "default-config.json missing (will fallback at runtime)"

# ---- su-exec & user ----
RUN set -eux; \
  apk add --no-cache su-exec; \
  addgroup -g 1001 -S nodejs; \
  adduser -S veeam -G nodejs -u 1001; \
  chown -R veeam:nodejs /app

# ---- Entrypoint & runtime ----
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Note: EXPOSE must be a literal; app can still listen on SERVER_PORT env at runtime
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const p = process.env.SERVER_PORT || 3000; require('http').get('http://localhost:'+p+'/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["npm", "start"]
