# Veeam Backend Deployment Guide

## Quick Setup Instructions

### Prerequisites
- Node.js 18+ installed
- Access to Veeam Backup & Replication server
- WhatsApp webhook service (optional)

### Installation Steps

1. **Extract the deployment package:**
   ```bash
   unzip veeam-backend-deployment.zip
   cd veeam-backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env file with your settings
   ```

4. **Update configuration:**
   - Edit `config/config.json` with your Veeam server details
   - Update WhatsApp webhook URL and chat ID/group name
   - Set appropriate timezone and alert thresholds

5. **Start the application:**
   ```bash
   # Development mode
   npm start
   
   # Production mode with PM2
   npm install -g pm2
   pm2 start ecosystem.config.js
   ```

### Docker Deployment (Alternative)

1. **Build and run with Docker:**
   ```bash
   docker-compose up -d
   ```

### Configuration Files to Update

1. **config/config.json** - Main configuration
   - `veeam.baseUrl` - Your Veeam server URL
   - `veeam.username` - Veeam admin username
   - `veeam.password` - Veeam admin password
   - `whatsapp.webhookUrl` - WhatsApp webhook service URL
   - `whatsapp.chatId` or `whatsapp.groupName` - Target for notifications

2. **.env** (optional) - Environment variables
   - Copy from `.env.example` and customize

### Verification

1. **Check health:**
   ```bash
   curl http://localhost:3005/health
   curl http://localhost:3005/api/health/veeam
   ```

2. **Access web interface:**
   - Open `http://localhost:3005/config` for configuration
   - View API documentation at the base URL

3. **Test alerts:**
   ```bash
   curl -X POST http://localhost:3005/api/alerts/test \
     -H "Content-Type: application/json" \
     -d '{"message": "Test deployment alert"}'
   ```

### Important Notes

- The application runs on port 3005 by default
- Logs are stored in the `logs/` directory
- Reports are generated in the `reports/` directory
- Configuration can be managed via web UI or API
- WhatsApp integration requires a separate webhook service

### Troubleshooting

- Check logs in `logs/combined.log` and `logs/error.log`
- Verify Veeam server connectivity
- Ensure proper network access to WhatsApp webhook
- Use `/api/test/veeam` and `/api/test/whatsapp` endpoints for testing

For detailed API documentation, see `API_DOCUMENTATION.md`.