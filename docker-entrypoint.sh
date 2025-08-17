#!/bin/sh

# This script runs as root initially, then switches to veeam user

# Ensure config directory exists and has proper permissions
mkdir -p /app/config
chmod 775 /app/config

# Create config.json if it doesn't exist
if [ ! -f /app/config/config.json ]; then
    touch /app/config/config.json
fi

# Ensure proper ownership and permissions
chown veeam:nodejs /app/config/config.json
chmod 664 /app/config/config.json

# Switch to veeam user and start the application
exec su-exec veeam:nodejs "$@"