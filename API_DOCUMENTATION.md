# Veeam Backend API Documentation

## Overview

The Veeam Backend API provides comprehensive monitoring, reporting, and alerting capabilities for Veeam Backup & Replication environments. This RESTful API enables integration with external systems and provides real-time access to backup job status, repository information, and automated reporting features.

**Base URL:** `http://localhost:3000/api`

**Version:** 1.0.0

## Authentication

Currently, the API does not require authentication. However, rate limiting is enabled by default to prevent abuse.

## Rate Limiting

- **Window:** 15 minutes
- **Max Requests:** 100 per window per IP
- **Headers:** Rate limit information is included in response headers

## Error Handling

All API endpoints return consistent error responses:

```json
{
  "error": "Error message",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request
- `404` - Not Found
- `429` - Too Many Requests
- `500` - Internal Server Error
- `503` - Service Unavailable (Veeam server connection issues)

---

## 🏥 Health & Status Endpoints

### GET /health

Returns the overall health status of the backend server.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600.5,
  "version": "1.0.0"
}
```

**Example:**
```bash
curl -X GET http://localhost:3000/health
```

### GET /api/health/veeam

Checks the connectivity and health of the Veeam API.

**Response (Success):**
```json
{
  "veeamApi": {
    "status": "healthy",
    "timestamp": "2024-01-15T10:30:00.000Z"
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Response (Error):**
```json
{
  "veeamApi": {
    "status": "error",
    "error": "HEALTH_CHECK_FAILED",
    "message": "Connection timeout",
    "timestamp": "2024-01-15T10:30:00.000Z"
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Example:**
```bash
curl -X GET http://localhost:3000/api/health/veeam
```

---

## ⚙️ Configuration Management

### GET /api/config

Retrieves the current system configuration (sensitive data excluded).

**Response:**
```json
{
  "server": {
    "port": 3000,
    "host": "localhost",
    "cors": {
      "enabled": true,
      "origin": "*"
    },
    "rateLimit": {
      "enabled": true,
      "windowMs": 900000,
      "max": 100
    }
  },
  "veeam": {
    "baseUrl": "https://veeam-server:9419",
    "username": "admin"
  },
  "reporting": {
    "schedules": [
      {
        "name": "daily-report",
        "cron": "0 8 * * *",
        "enabled": true,
        "sendAsImage": false
      }
    ]
  },
  "alerting": {
    "enabled": true,
    "thresholds": {
      "repositoryUsage": 85,
      "healthScore": 70,
      "jobDuration": 14400,
      "failureCount": 3
    }
  }
}
```

**Example:**
```bash
curl -X GET http://localhost:3000/api/config
```

### PUT /api/config/:section

Updates a specific configuration section.

**Parameters:**
- `section` (path) - Configuration section to update (e.g., "server", "alerting", "reporting")

**Request Body:**
```json
{
  "enabled": true,
  "thresholds": {
    "repositoryUsage": 90,
    "healthScore": 75
  }
}
```

**Response:**
```json
{
  "message": "Configuration updated successfully"
}
```

**Example:**
```bash
curl -X PUT http://localhost:3000/api/config/alerting \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "thresholds": {
      "repositoryUsage": 90,
      "healthScore": 75
    }
  }'
```

---

## 📊 Data Collection Endpoints

### GET /api/data/jobs

Retrieves information about all backup jobs.

**Response:**
```json
[
  {
    "id": "job-123",
    "name": "Daily VM Backup",
    "type": "Backup",
    "status": "Success",
    "lastRun": "2024-01-15T02:00:00.000Z",
    "nextRun": "2024-01-16T02:00:00.000Z",
    "duration": 3600,
    "processedSize": "50.2 GB",
    "transferredSize": "12.1 GB",
    "compressionRatio": 2.4,
    "deduplicationRatio": 1.8
  }
]
```

**Example:**
```bash
curl -X GET http://localhost:3000/api/data/jobs
```

### GET /api/data/repositories

Retrieves information about backup repositories.

**Response:**
```json
[
  {
    "id": "repo-456",
    "name": "Primary Repository",
    "type": "Windows",
    "capacity": "2.0 TB",
    "freeSpace": "500.0 GB",
    "usedSpace": "1.5 TB",
    "usagePercentage": 75,
    "status": "Available"
  }
]
```

**Example:**
```bash
curl -X GET http://localhost:3000/api/data/repositories
```

### GET /api/data/sessions

Retrieves recent backup sessions.

**Query Parameters:**
- `limit` (optional) - Number of sessions to return (default: 100, max: 1000)

**Response:**
```json
[
  {
    "id": "session-789",
    "jobName": "Daily VM Backup",
    "status": "Success",
    "startTime": "2024-01-15T02:00:00.000Z",
    "endTime": "2024-01-15T03:15:00.000Z",
    "duration": 4500,
    "processedObjects": 25,
    "transferredData": "12.1 GB",
    "result": "Success"
  }
]
```

**Example:**
```bash
curl -X GET "http://localhost:3000/api/data/sessions?limit=50"
```

---

## 📈 Reporting Endpoints

### GET /api/reports/daily

Generates and returns a comprehensive daily report.

**Response:**
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "summary": {
    "totalJobs": 15,
    "successfulJobs": 13,
    "failedJobs": 2,
    "warningJobs": 0,
    "successRate": 86.7
  },
  "jobs": [
    {
      "name": "Daily VM Backup",
      "status": "Success",
      "duration": "1h 15m",
      "processedSize": "50.2 GB",
      "transferredSize": "12.1 GB"
    }
  ],
  "repositories": [
    {
      "name": "Primary Repository",
      "usagePercentage": 75,
      "freeSpace": "500.0 GB",
      "status": "Available"
    }
  ],
  "alerts": [
    {
      "type": "repositoryUsage",
      "severity": "warning",
      "message": "Repository usage above 75%"
    }
  ]
}
```

**Example:**
```bash
curl -X GET http://localhost:3000/api/reports/daily
```

### GET /api/reports/quick-status

Returns a quick status overview.

**Response:**
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "overallStatus": "Warning",
  "jobsStatus": {
    "total": 15,
    "running": 2,
    "successful": 11,
    "failed": 2
  },
  "repositoriesStatus": {
    "total": 3,
    "available": 3,
    "averageUsage": 68
  },
  "alertsCount": 3
}
```

**Example:**
```bash
curl -X GET http://localhost:3000/api/reports/quick-status
```

### GET /api/reports/html

Generates and returns an HTML-formatted report.

**Response:** HTML content

**Example:**
```bash
curl -X GET http://localhost:3000/api/reports/html
```

### GET /api/reports/download

Generates and downloads an HTML report file.

**Response:** File download

**Example:**
```bash
curl -X GET http://localhost:3000/api/reports/download -o veeam-report.html
```

### POST /api/reports/send

Sends a report via WhatsApp.

**Request Body:**
```json
{
  "format": "text",
  "includeImage": false,
  "width": 1200,
  "height": 1600
}
```

**Response:**
```json
{
  "success": true,
  "message": "Report sent successfully"
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/reports/send \
  -H "Content-Type: application/json" \
  -d '{
    "format": "text",
    "includeImage": true,
    "width": 1200,
    "height": 1600
  }'
```

### POST /api/reports/send-image

Sends a report as an image via WhatsApp.

**Request Body:**
```json
{
  "width": 1200,
  "height": 1600
}
```

**Response:**
```json
{
  "success": true,
  "message": "Report image sent successfully"
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/reports/send-image \
  -H "Content-Type: application/json" \
  -d '{
    "width": 1200,
    "height": 1600
  }'
```

### POST /api/reports/generate-image

Generates a report image and returns the file information.

**Request Body:**
```json
{
  "width": 1200,
  "height": 1600
}
```

**Response:**
```json
{
  "success": true,
  "message": "Report image generated successfully",
  "filename": "veeam-report-20240115.png",
  "url": "/reports/images/veeam-report-20240115.png"
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/reports/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "width": 1200,
    "height": 1600
  }'
```

---

## 🚨 Alerting Endpoints

### GET /api/alerts

Retrieves all active alerts.

**Response:**
```json
[
  {
    "id": "alert-123",
    "type": "jobFailure",
    "severity": "critical",
    "message": "Backup job 'Daily VM Backup' failed",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "acknowledged": false,
    "jobName": "Daily VM Backup",
    "details": {
      "errorCode": "E001",
      "errorMessage": "Network connection timeout"
    }
  },
  {
    "id": "alert-124",
    "type": "repositoryUsage",
    "severity": "warning",
    "message": "Repository 'Primary Repository' usage is 85%",
    "timestamp": "2024-01-15T09:15:00.000Z",
    "acknowledged": false,
    "repositoryName": "Primary Repository",
    "usagePercentage": 85
  }
]
```

**Example:**
```bash
curl -X GET http://localhost:3000/api/alerts
```

### POST /api/alerts/:alertId/acknowledge

Acknowledges a specific alert.

**Parameters:**
- `alertId` (path) - The ID of the alert to acknowledge

**Request Body:**
```json
{
  "acknowledgedBy": "John Doe"
}
```

**Response:**
```json
{
  "message": "Alert acknowledged successfully"
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/alerts/alert-123/acknowledge \
  -H "Content-Type: application/json" \
  -d '{
    "acknowledgedBy": "John Doe"
  }'
```

### GET /api/alerts/stats

Retrieves alert statistics.

**Response:**
```json
{
  "totalAlerts": 25,
  "activeAlerts": 5,
  "criticalAlerts": 2,
  "warningAlerts": 3,
  "acknowledgedAlerts": 20,
  "alertsByType": {
    "jobFailure": 2,
    "repositoryUsage": 2,
    "systemHealth": 1,
    "longRunningJob": 0,
    "infrastructureIssue": 0
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Example:**
```bash
curl -X GET http://localhost:3000/api/alerts/stats
```

---

## 📅 Schedule Management

### GET /api/schedules

Retrieves all configured report schedules.

**Response:**
```json
[
  {
    "name": "daily-report",
    "cron": "0 8 * * *",
    "enabled": true,
    "sendAsImage": false,
    "description": "Daily backup report at 8 AM"
  },
  {
    "name": "weekly-summary",
    "cron": "0 9 * * 1",
    "enabled": true,
    "sendAsImage": true,
    "description": "Weekly summary every Monday at 9 AM"
  }
]
```

**Example:**
```bash
curl -X GET http://localhost:3000/api/schedules
```

### GET /api/schedule/status

Retrieves the status of the scheduling system.

**Response:**
```json
{
  "totalSchedules": 3,
  "activeSchedules": 2,
  "nextExecution": "2024-01-16T08:00:00.000Z",
  "lastExecution": "2024-01-15T08:00:00.000Z",
  "schedulerStatus": "running"
}
```

**Example:**
```bash
curl -X GET http://localhost:3000/api/schedule/status
```

### POST /api/schedules

Creates a new report schedule.

**Request Body:**
```json
{
  "name": "hourly-status",
  "cron": "0 * * * *",
  "enabled": true,
  "sendAsImage": false,
  "description": "Hourly status check"
}
```

**Response:**
```json
{
  "message": "Schedule added successfully"
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "hourly-status",
    "cron": "0 * * * *",
    "enabled": true,
    "sendAsImage": false,
    "description": "Hourly status check"
  }'
```

### DELETE /api/schedules/:name

Deletes a specific schedule.

**Parameters:**
- `name` (path) - The name of the schedule to delete

**Response:**
```json
{
  "message": "Schedule removed successfully"
}
```

**Example:**
```bash
curl -X DELETE http://localhost:3000/api/schedules/hourly-status
```

---

## 🧪 Testing Endpoints

### POST /api/test/whatsapp

Tests the WhatsApp service connectivity.

**Response:**
```json
{
  "success": true,
  "message": "WhatsApp test successful"
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/test/whatsapp
```

### POST /api/test/veeam

Tests the Veeam API connectivity.

**Response:**
```json
{
  "success": true,
  "message": "Veeam connection successful"
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/test/veeam
```

---

## 📁 Static File Access

### GET /reports/*

Serves static report files (HTML reports, images, etc.).

**Example:**
```bash
curl -X GET http://localhost:3000/reports/veeam-report-20240115.html
curl -X GET http://localhost:3000/reports/images/veeam-report-20240115.png
```

---

## 📋 Common Use Cases

### 1. Dashboard Integration

```javascript
// Fetch system overview for dashboard
const response = await fetch('http://localhost:3000/api/reports/quick-status');
const status = await response.json();
console.log(`Overall Status: ${status.overallStatus}`);
```

### 2. Monitoring Integration

```javascript
// Check for critical alerts
const alerts = await fetch('http://localhost:3000/api/alerts');
const alertData = await alerts.json();
const criticalAlerts = alertData.filter(alert => alert.severity === 'critical');
```

### 3. Automated Reporting

```javascript
// Send daily report via WhatsApp
const reportResponse = await fetch('http://localhost:3000/api/reports/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    format: 'text',
    includeImage: true
  })
});
```

### 4. Configuration Management

```javascript
// Update alerting thresholds
const configResponse = await fetch('http://localhost:3000/api/config/alerting', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    thresholds: {
      repositoryUsage: 90,
      healthScore: 75
    }
  })
});
```

---

## 🔧 Error Handling Examples

### Service Unavailable (503)

When the Veeam server is unreachable:

```json
{
  "error": "Service temporarily unavailable",
  "message": "Unable to connect to Veeam server",
  "data": [],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Rate Limit Exceeded (429)

```json
{
  "error": "Too many requests from this IP, please try again later.",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Invalid Configuration (400)

```json
{
  "error": "Invalid configuration section",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

## 📊 Response Headers

All API responses include standard headers:

```
Content-Type: application/json
X-Powered-By: Express
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642248600
```

---

## 🚀 Getting Started

1. **Start the server:**
   ```bash
   npm start
   ```

2. **Test connectivity:**
   ```bash
   curl http://localhost:3000/health
   ```

3. **Check Veeam connection:**
   ```bash
   curl -X POST http://localhost:3000/api/test/veeam
   ```

4. **Get daily report:**
   ```bash
   curl http://localhost:3000/api/reports/daily
   ```

---

## 📞 Support

For technical support or questions about the API:

- **Documentation:** This file
- **Logs:** Check `logs/combined.log` for detailed information
- **Configuration:** Modify `config.json` for customization
- **Health Check:** Use `/health` and `/api/health/veeam` endpoints

---

*Last Updated: January 15, 2024*
*API Version: 1.0.0*