FROM node:16-alpine

# Set working directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Create necessary directories
RUN mkdir -p logs data config

# Copy application code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S veeam -u 1001

# Change ownership of app directory (after copying files)
RUN chown -R veeam:nodejs /app

# Ensure config directory has proper permissions and create config.json with write permissions
RUN chmod -R 775 /app/config
RUN touch /app/config/config.json && chown veeam:nodejs /app/config/config.json && chmod 664 /app/config/config.json

USER veeam

# Expose port (default 3000, configurable via SERVER_PORT env var)
EXPOSE ${SERVER_PORT:-3000}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const port = process.env.SERVER_PORT || 3000; require('http').get('http://localhost:' + port + '/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Start application
CMD ["npm", "start"]