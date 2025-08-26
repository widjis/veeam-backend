FROM node:16-alpine

# Set working directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Ensure config directory and both config files are copied
COPY config/default-config.json ./config/
COPY config/config.json ./config/

# Copy and make entrypoint script executable
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create necessary directories
RUN mkdir -p logs data config reports

# Install su-exec for user switching
RUN apk add --no-cache su-exec

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S veeam -u 1001

# Change ownership of app directory (after copying files)
RUN chown -R veeam:nodejs /app

# Set entrypoint (runs as root, switches to veeam user)
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Expose port (default 3000, configurable via SERVER_PORT env var)
EXPOSE ${SERVER_PORT:-3000}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const port = process.env.SERVER_PORT || 3000; require('http').get('http://localhost:' + port + '/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Start application
CMD ["npm", "start"]