# Veeam Backup Monitoring & Reporting System

A comprehensive Node.js backend server for monitoring Veeam Backup & Replication infrastructure with automated reporting and real-time alerting via WhatsApp.

## Features

- 📊 **Daily Comprehensive Reports** - Automated daily reports with performance metrics, health scores, and storage analytics
- 🚨 **Real-time Alerting** - Instant notifications for job failures, warnings, and system issues
- 📱 **WhatsApp Integration** - Formatted messages sent directly to WhatsApp
- ⚙️ **Configurable Schedules** - Flexible reporting and monitoring schedules
- 🔄 **Persistent Alerting** - Retry mechanism with acknowledgment system
- 📈 **Performance Monitoring** - System health scoring and trend analysis
- 🛡️ **Comprehensive Error Handling** - Robust logging and monitoring
- 🔐 **OAuth2 Authentication** - Secure Veeam API integration

## Architecture

```
├── src/
│   ├── services/
│   │   ├── veeamApiClient.js      # Veeam API integration
│   │   ├── dataCollectionService.js # Data collection and caching
│   │   ├── reportingEngine.js     # Report generation
│   │   ├── alertingService.js     # Alert management
│   │   ├── whatsappService.js     # WhatsApp messaging
│   │   ├── configManager.js       # Configuration management
│   │   ├── errorHandler.js        # Error handling
│   │   └── monitor.js             # System monitoring
│   └── server.js                  # Main server application
├── config/
│   └── default.json              # Default configuration
├── data/                         # Data storage directory
├── logs/                         # Log files
└── package.json
```

## Installation

### Prerequisites

- Node.js 16+ and npm
- Veeam Backup & Replication server with API access
- WhatsApp webhook service (for message sending)

### Setup

1. **Clone and install dependencies:**
   ```bash
   git clone <repository-url>
   cd veeam-backend
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your settings:
   ```env
   VEEAM_BASE_URL=https://your-veeam-server:9419/api/v1
   VEEAM_USERNAME=your-veeam-username
   VEEAM_PASSWORD=your-veeam-password
   WHATSAPP_WEBHOOK_URL=http://your-webhook-server/send-message
   WHATSAPP_CHAT_ID=your-whatsapp-chat-id
   ```

3. **Start the server:**
   ```bash
   # Development
   npm run dev
   
   # Production
   npm start
   ```

## Configuration

The system uses a hierarchical configuration system:

1. **Default configuration** (`config/default.json`)
2. **Environment variables** (`.env` file)
3. **Runtime configuration** (via API endpoints)

### Key Configuration Sections

#### Veeam API Settings
```json
{
  "veeam": {
    "baseUrl": "https://your-veeam-server:9419/api/v1",
    "username": "your-username",
    "password": "your-password",
    "timeout": 30000,
    "retryAttempts": 3
  }
}
```

#### WhatsApp Settings
```json
{
  "whatsapp": {
    "webhookUrl": "http://your-webhook-server/send-message",
    "chatId": "your-chat-id",
    "maxRetries": 3,
    "retryInterval": 5000
  }
}
```

#### Alerting Thresholds
```json
{
  "alerting": {
    "repositoryWarningThreshold": 70,
    "repositoryCriticalThreshold": 85,
    "healthWarningThreshold": 70,
    "healthCriticalThreshold": 50,
    "jobWarningDuration": 4,
    "jobCriticalDuration": 8
  }
}
```

## API Endpoints

### Health & Status
- `GET /health` - Server health check
- `GET /api/status/quick` - Quick system status

### Configuration
- `GET /api/config` - Get current configuration
- `PUT /api/config` - Update configuration

### Reporting
- `GET /api/reports/daily` - Get daily report
- `POST /api/reports/send` - Send report to WhatsApp

### Alerting
- `GET /api/alerts/active` - Get active alerts
- `POST /api/alerts/acknowledge` - Acknowledge alert
- `GET /api/alerts/stats` - Get alert statistics

### Data Collection
- `GET /api/data/jobs` - Get job information
- `GET /api/data/repositories` - Get repository information
- `GET /api/data/sessions` - Get session information

### Scheduling
- `GET /api/schedules` - Get reporting schedules
- `POST /api/schedules` - Add reporting schedule
- `DELETE /api/schedules/:id` - Remove schedule

### Testing
- `POST /api/test/whatsapp` - Test WhatsApp connection
- `POST /api/test/veeam` - Test Veeam connection

## Usage Examples

### Setting Up Daily Reports

```bash
# Add a daily report at 8:00 AM
curl -X POST http://localhost:3000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Daily Morning Report",
    "cron": "0 8 * * *",
    "type": "daily_report",
    "enabled": true
  }'
```

### Acknowledging Alerts

```bash
# Acknowledge an alert
curl -X POST http://localhost:3000/api/alerts/acknowledge \
  -H "Content-Type: application/json" \
  -d '{
    "alertId": "alert-id-here",
    "acknowledgedBy": "admin",
    "reason": "Issue resolved"
  }'
```

### Manual Report Generation

```bash
# Generate and send daily report
curl -X POST http://localhost:3000/api/reports/send

# Generate HTML report
curl http://localhost:3000/api/reports/html

# Generate daily report data (JSON)
curl http://localhost:3000/api/reports/daily

# Generate and send report as image
curl -X POST http://localhost:3000/api/reports/send-image
```

## Daily Reporting System

### Overview
The system provides automated daily reporting with multiple delivery formats:
- **Text Reports**: Formatted WhatsApp messages with key metrics
- **HTML Reports**: Rich visual reports with charts and detailed analytics
- **Image Reports**: Generated screenshots of HTML reports sent via WhatsApp
- **JSON Data**: Raw report data for integration with other systems

### Scheduling Configuration

#### Current Schedule Status
```bash
# Check current schedule status
curl http://localhost:3000/api/schedule/status
```

Response includes:
- Total and active schedules count
- Next execution time
- Last execution time
- Scheduler running status

#### Default Schedule
Daily reports are configured to run at **8:00 AM UTC** (cron: `"0 8 * * *"`)

#### Adding Custom Schedules
```bash
# Add daily report at 6:00 AM UTC
curl -X POST http://localhost:3000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Early Morning Report",
    "cronExpression": "0 6 * * *",
    "enabled": true,
    "type": "daily",
    "recipients": ["your-whatsapp-chat-id"]
  }'

# Add weekly report (Mondays at 9:00 AM)
curl -X POST http://localhost:3000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Weekly Summary",
    "cronExpression": "0 9 * * 1",
    "enabled": true,
    "type": "weekly",
    "recipients": ["your-whatsapp-chat-id"]
  }'

# Add daily report with image at 6:00 PM UTC
curl -X POST http://localhost:3000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Evening Report with Image",
    "cronExpression": "0 18 * * *",
    "enabled": true,
    "type": "daily",
    "sendAsImage": true,
    "recipients": ["your-whatsapp-chat-id"]
  }'

# Add weekly report with image (Fridays at 5:00 PM)
curl -X POST http://localhost:3000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Weekly Image Report",
    "cronExpression": "0 17 * * 5",
    "enabled": true,
    "type": "weekly",
    "sendAsImage": true,
    "recipients": ["your-whatsapp-chat-id"]
  }'
```

#### Schedule Management
```bash
# List all schedules
curl http://localhost:3000/api/schedules

# Delete a schedule
curl -X DELETE http://localhost:3000/api/schedules/schedule-id
```

### Report Filtering

#### HTML Reports
HTML reports automatically filter to show:
- **Recent Jobs**: Only failed and warning jobs (not successful ones)
- **Failed Jobs**: Complete list of failed jobs with details
- **System Health**: Overall health metrics and alerts

#### Report Content
Each daily report includes:
- **Job Summary**: Success/failure rates, total jobs processed
- **Performance Metrics**: System health score, processing times
- **Storage Analytics**: Repository usage, capacity planning
- **Alert Status**: Active alerts and their severity
- **Trend Analysis**: Comparison with previous periods

### WhatsApp Image Reports

#### Enabling Image Reports for Scheduled Jobs

**Method 1: Configuration-based (Recommended)**

Add `"sendAsImage": true` to your schedule configuration:

```json
{
  "name": "Daily Image Report",
  "cronExpression": "0 8 * * *",
  "enabled": true,
  "type": "daily",
  "sendAsImage": true,
  "recipients": []
}
```

**Method 2: Code Modification**

Modify `src/server.js` line 593 in the `executeScheduledReport` method:

```javascript
// Change from:
const success = await this.whatsappService.sendDailyReport(report);

// To:
const success = await this.whatsappService.sendDailyReportWithImage(report);
```

#### Image Report Features

- **Visual HTML Report**: Generated as a screenshot image
- **Rich Caption**: Includes performance summary, failed jobs, and repository status
- **Status Icons**: 🚨 for failures, ⚠️ for warnings, ✅ for success
- **Fallback Mechanism**: Automatically sends text report if image generation fails

#### Manual Image Report Testing

```bash
# Test image generation and WhatsApp sending
curl -X POST http://localhost:3000/api/reports/send-image

# Generate HTML report for preview
curl http://localhost:3000/api/reports/html
```

### Configuration Files

#### Main Configuration (`config/config.json`)
```json
{
  "reportingSchedules": [
    {
      "name": "Daily Report",
      "cronExpression": "0 8 * * *",
      "enabled": true,
      "type": "daily",
      "recipients": ["your-chat-id"]
    }
  ]
}
```

#### Default Templates (`config/default-config.json`)
Contains default cron expressions:
- **Daily**: `"0 8 * * *"` (8:00 AM UTC)
- **Weekly**: `"0 9 * * 1"` (9:00 AM UTC on Mondays)
- **Monthly**: `"0 10 1 * *"` (10:00 AM UTC on 1st of month)

### Troubleshooting Daily Reports

#### Check Schedule Status
```bash
# Verify scheduler is running
curl http://localhost:3000/api/schedule/status

# Check server logs for schedule execution
tail -f logs/combined.log | grep "Scheduled job"
```

#### Manual Testing
```bash
# Test report generation
curl http://localhost:3000/api/reports/daily

# Test WhatsApp delivery
curl -X POST http://localhost:3000/api/reports/send

# Test image generation
curl -X POST http://localhost:3000/api/reports/send-image
```

#### Common Issues
1. **Reports not sending**: Check WhatsApp webhook configuration
2. **Wrong timezone**: Cron expressions use UTC time
3. **Missing data**: Verify Veeam API connectivity
4. **Image generation fails**: Check HTML report service logs

### Report Customization

#### Modifying Report Content
- **HTML Template**: Edit `src/templates/report.html`
- **Report Logic**: Modify `src/services/reportingEngine.js`
- **WhatsApp Formatting**: Update `src/services/whatsappService.js`
- **Filtering Logic**: Adjust `src/services/htmlReportService.js`

#### Adding New Report Types
1. Add new schedule type in `configManager.js`
2. Implement generation logic in `reportingEngine.js`
3. Add delivery method in `whatsappService.js`
4. Update API endpoints in `server.js`

## WhatsApp Message Examples

### Daily Report
```
🚨 Veeam Backup Report

📅 Period: 8/14/2025 to 8/15/2025

📊 Performance Summary:
• Total Jobs: 17
• ✅ Success Rate: 94.12%
• ❌ Failure Rate: 5.88%
• ⚠️ Warning Rate: 0.00%
• 🚨 Active Alerts: 0

🏥 System Health Score: 88.2/100

💾 Storage Analytics:
• Total Capacity: 107.30TB
• Total Used: 49.37TB
• Overall Usage: 46.01%

🗄️ Repository Health:
• 🟢 Healthy: 2 repos (≤70%)
• 🟡 Warning: 0 repos (70-85%)
• 🔴 Critical: 0 repos (>85%)
```

### Alert Example
```
🚨 CRITICAL ALERT

📋 Job: MMSMRWFS01 (Backup)
🔴 Status: Failed
⏰ Time: 2025-01-15 14:30:25
📝 Details: Job failed with error code 123

💬 Reply 'ACK alert-id reason' to acknowledge
```

## Monitoring & Logging

### Log Files
- `logs/error.log` - Error logs
- `logs/combined.log` - All logs
- `logs/service-*.log` - Service-specific logs
- `logs/metrics.log` - System metrics

### System Monitoring
The system continuously monitors:
- CPU and memory usage
- Disk space
- Network connectivity
- Application performance
- Error rates

## Troubleshooting

### Common Issues

1. **Veeam API Connection Failed**
   - Check Veeam server URL and credentials
   - Verify network connectivity
   - Check Veeam API service status

2. **WhatsApp Messages Not Sending**
   - Verify webhook URL is accessible
   - Check chat ID configuration
   - Review WhatsApp service logs

3. **Scheduled Jobs Not Running**
   - Check cron expression syntax
   - Verify schedule is enabled
   - Review server logs for errors

### Debug Mode

Enable debug logging:
```bash
DEBUG=true npm start
```

### Health Checks

```bash
# Check server health
curl http://localhost:3000/health

# Test Veeam connection
curl -X POST http://localhost:3000/api/test/veeam

# Test WhatsApp connection
curl -X POST http://localhost:3000/api/test/whatsapp
```

## Development

### Running in Development Mode
```bash
npm run dev
```

### Running Tests
```bash
npm test
```

### Code Linting
```bash
npm run lint
```

## Production Deployment

### Using PM2
```bash
npm install -g pm2
pm2 start ecosystem.config.js
```

### Using Docker
```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Environment Variables for Production
```env
NODE_ENV=production
LOG_LEVEL=warn
SERVER_PORT=3000
SERVER_HOST=0.0.0.0
```

## Security Considerations

- Store sensitive credentials in environment variables
- Use HTTPS for Veeam API connections
- Implement rate limiting (already configured)
- Regular security updates
- Monitor access logs

## Support

For issues and questions:
1. Check the logs in the `logs/` directory
2. Review the configuration settings
3. Test individual components using the test endpoints
4. Enable debug mode for detailed logging

## License

MIT License - see LICENSE file for details.