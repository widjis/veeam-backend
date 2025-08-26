#!/bin/sh

# This script runs as root initially, then switches to veeam user

# Ensure config directory exists and has proper permissions
mkdir -p /app/config
chmod 775 /app/config

# Ensure config.json exists (should already be copied from source)
if [ ! -f /app/config/config.json ]; then
    if [ -f /app/config/default-config.json ]; then
        cp /app/config/default-config.json /app/config/config.json
        echo "Fallback: Copied default-config.json to config.json"
    else
        touch /app/config/config.json
        echo "Fallback: Created empty config.json"
    fi
else
    echo "Using existing config.json from source"
fi

# Ensure proper ownership and permissions
chown veeam:nodejs /app/config/config.json
chmod 664 /app/config/config.json

# Switch to veeam user and start the application
exec su-exec veeam:nodejs "$@"