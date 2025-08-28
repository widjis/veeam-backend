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
- 🔌 **RESTful API** - Complete API with 25+ endpoints for integration
- 🖥️ **Web Configuration UI** - User-friendly web interface for system configuration
- 📖 **Comprehensive Documentation** - Detailed API documentation with examples

## 📚 API Documentation

For complete API documentation with detailed examples, request/response schemas, and integration guides, see:

**[📖 API_DOCUMENTATION.md](./API_DOCUMENTATION.md)**

The API provides 25+ endpoints covering:
- Health monitoring and status checks
- Configuration management
- Data collection (jobs, repositories, sessions)
- Report generation and delivery
- Alert management and acknowledgment
- Schedule management (CRUD operations)
- Service connectivity testing

### Quick API Examples

```bash
# Check server health
curl http://localhost:3000/health

# Get daily report
curl http://localhost:3000/api/reports/daily

# Send report via WhatsApp
curl -X POST http://localhost:3000/api/reports/send \
  -H "Content-Type: application/json" \
  -d '{"format": "text", "includeImage": true}'

# Get active alerts
curl http://localhost:3000/api/alerts

# Test Veeam connectivity
curl -X POST http://localhost:3000/api/test/veeam
```

## 🖥️ Web Configuration Interface

Access the intuitive web-based configuration interface at:

**http://localhost:3000/config**

The configuration UI provides:
- **Visual Configuration Management** - Easy-to-use forms for all system settings
- **Real-time Testing** - Built-in connectivity tests for Veeam and WhatsApp
- **Section-based Organization** - Organized tabs for different configuration areas:
  - Veeam API settings (server, credentials, SSL)
  - WhatsApp integration (bot token, chat ID)
  - Monitoring intervals and health checks
  - Alerting thresholds and notification types
  - Reporting schedules and recipients
  - Server configuration (port, CORS, rate limiting)
- **Responsive Design** - Works on desktop, tablet, and mobile devices
- **Immediate Feedback** - Success/error indicators for all operations

### Configuration Sections

- **🔧 Veeam API**: Server URL, authentication, SSL verification
- **💬 WhatsApp**: Bot configuration, message formatting
- **📊 Monitoring**: Data collection intervals, health check settings
- **🚨 Alerting**: Threshold configuration, notification preferences
- **📋 Reporting**: Schedule management, recipient lists
- **⚙️ Server**: Port settings, CORS, rate limiting, logging
```

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
    "groupName": "MTI Alert!!",
    "useGroupName": false,
    "maxRetries": 3,
    "retryInterval": 5000
  }
}
```

**WhatsApp Configuration Options:**
- `webhookUrl`: WhatsApp webhook endpoint URL
- `chatId`: WhatsApp chat ID (e.g., `120363215673098371@g.us`) - used when `useGroupName` is false
- `groupName`: WhatsApp group name (e.g., `MTI Alert!!`) - used when `useGroupName` is true
- `useGroupName`: Boolean flag to use group name instead of chat ID
- `maxRetries`: Number of retry attempts for failed messages
- `retryInterval`: Delay between retry attempts in milliseconds

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

## Recent Changes

### CRUD Operations for Scheduler Tasks (August 16, 2025)
- **Full CRUD Functionality:** Implemented complete Create, Read, Update, Delete operations for scheduler tasks
- **Modal-Based Interface:** Added intuitive modal dialogs for creating and editing scheduler tasks
- **Enhanced API Endpoints:** Improved `/api/schedules` endpoints with full CRUD support and validation
- **Real-time Updates:** Dynamic refresh of scheduler task list after operations
- **Form Validation:** Comprehensive validation for schedule names, cron expressions, and required fields
- **User Feedback:** Toast notifications for success/error states during operations
- **Delete Confirmation:** Safety dialogs to prevent accidental schedule deletions

**Bug Fixes & Debugging (2025-08-16 15:47):**
- ✅ **URL Encoding Fix:** Resolved 404 errors when editing schedules with spaces in names by adding proper `decodeURIComponent()` handling
- ✅ **DOM Element Fix:** Fixed JavaScript errors by correcting HTML element ID mismatches
- ✅ **Event Listener Fix:** Resolved modal interaction issues by properly wiring event handlers
- ✅ **API Verification:** Confirmed all CRUD endpoints work correctly with comprehensive testing

**Modal Fixes & Port Configuration (2025-08-16 15:57):**
- ✅ **Modal JavaScript Fix:** Resolved `TypeError: Cannot read properties of null` errors in create/edit modals
- ✅ **Element Reference Fix:** Corrected `schedule-title` to `modal-title` element ID mismatch
- ✅ **Recipients Field:** Added proper population of recipients field in edit mode
- ✅ **Environment Port Config:** Made server port fully configurable via `SERVER_PORT` environment variable
- ✅ **Docker Integration:** Updated Dockerfile and docker-compose.yml for dynamic port configuration
- ✅ **Backward Compatibility:** Maintains default port 3000 when no environment variable is set
- ✅ **Docker Permission Fix:** Resolved `EACCES: permission denied` error when accessing `/app/config/config.json`
- ✅ **File Ownership:** Added explicit permission setting (`chmod 775 /app/config`) in Dockerfile for write access
- ✅ **Enhanced Config Handling:** Creates file with proper ownership (`veeam:nodejs`) and permissions (`664`) for group write
- ⚠️ **Important:** If experiencing permission errors, rebuild with: `docker compose build --no-cache && docker compose up -d`

## Docker Build & Permission Fix

### Issue Resolution
Fixed Docker build failure and persistent `EACCES: permission denied` error when accessing `/app/config/config.json` in Docker container.

### Root Causes
1. **Build Failure**: Dockerfile command order issue - trying to set permissions on non-existent directories
2. **Permission Error**: ConfigManager uses `fs.writeJson()` requiring write permissions
3. **Runtime Issues**: Static permission setting in Dockerfile insufficient for runtime scenarios

### Comprehensive Solution
- **Fixed Dockerfile command order**:
  1. Copy application code first (`COPY . .`)
  2. Create necessary directories (`mkdir -p logs data config`)
  3. Set permissions on existing directories

- **Implemented Runtime Permission Management**:
  - Created `docker-entrypoint.sh` script for dynamic permission handling
  - Script ensures config directory and file permissions at container startup
  - Handles cases where volume mounts or layer caching override permissions

- **Entrypoint Script Features**:
  - **Runs as root initially** to handle permission operations
  - Creates config directory with `775` permissions if missing
  - Creates `config.json` file if it doesn't exist
  - Sets proper ownership (`veeam:nodejs`) and permissions (`664`) at runtime
  - **Switches to non-root user** (`veeam`) before starting application for security
  - Uses `su-exec` for secure user switching

### Technical Implementation
- **Root Privilege Requirement**: Entrypoint script needs root access to:
  - Create directories and modify permissions
  - Change file ownership (`chown` operations)
  - Set proper file permissions (`chmod` operations)
- **Security Maintained**: Application runs as non-root user after permission setup
- **User Switching**: Uses `su-exec` package for clean user transition

### Files Added/Modified
- **`docker-entrypoint.sh`**: Runtime permission management script with root execution
- **`Dockerfile`**: Updated to use entrypoint script, added `su-exec` package, removed `USER` directive

### Rebuild Required
To apply these fixes, rebuild your Docker container:
```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

**New Features:**
- Add new scheduler tasks with custom cron expressions
- Edit existing scheduler tasks with pre-populated form data
- Delete scheduler tasks with confirmation dialogs
- Cron expression validation and format checking
- Schedule name uniqueness validation
- Error handling for API failures
- Configurable port deployment via environment variables

**Status:** 🟢 **Fully Operational** - All CRUD functionality tested and working correctly

### 2025-08-16 - Configuration Interface Improvements

**Fixed Configuration Loading Issues:**
- ✅ **WhatsApp Integration**: Webhook URL now properly displays in configuration interface
- ✅ **Dynamic Scheduler Tasks**: Reporting settings now show all configured scheduler tasks dynamically
- ✅ **Enhanced Error Handling**: Added comprehensive null checks to prevent JavaScript runtime errors
- ✅ **Improved UI**: Redesigned reporting settings section with individual task controls
- ✅ **Function Scope Fixes**: Resolved JavaScript reference errors for better stability

**Technical Improvements:**
- Modified API response to include webhook URL while maintaining security
- Added `populateSchedulerTasks()` function for dynamic UI generation
- Created `getCronDescription()` helper for human-readable schedule descriptions
- Enhanced form population with proper error handling and fallbacks
- Fixed function accessibility issues in configuration JavaScript

**Files Updated:**
- `src/server.js` - API response security adjustments and enhanced scheduler endpoints
- `src/public/config.html` - Dynamic scheduler tasks UI and CRUD modal dialogs
- `src/public/config.js` - Enhanced error handling, dynamic population, and CRUD operations

## Support

For issues and questions:
1. Check the logs in the `logs/` directory
2. Review the configuration settings
3. Test individual components using the test endpoints
4. Enable debug mode for detailed logging
5. Check the JOURNAL.md for detailed troubleshooting history

## License

MIT License - see LICENSE file for details.