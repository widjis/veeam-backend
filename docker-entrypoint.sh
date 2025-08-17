#!/bin/sh

# Ensure config directory exists and has proper permissions
mkdir -p /app/config
chmod 775 /app/config

# Create config.json if it doesn't exist or fix permissions if it does
if [ ! -f /app/config/config.json ]; then
    touch /app/config/config.json
fi

# Ensure proper ownership and permissions
chown veeam:nodejs /app/config/config.json
chmod 664 /app/config/config.json

# Start the application
exec "$@"