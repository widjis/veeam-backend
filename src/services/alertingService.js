const fs = require('fs-extra');
const path = require('path');
const moment = require('moment-timezone');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
const _ = require('lodash');

class AlertingService {
  constructor(dataCollectionService, whatsappService, config = {}, reportingEngine = null) {
    this.dataService = dataCollectionService;
    this.whatsappService = whatsappService;
    this.reportingEngine = reportingEngine;
    this.config = {
      alertsFilePath: path.join(__dirname, '../../data/alerts.json'),
      acknowledgedAlertsFilePath: path.join(__dirname, '../../data/acknowledged_alerts.json'),
      maxRetries: config.maxRetries || 5,
      retryInterval: config.retryInterval || 30, // minutes
      autoAcknowledgeAfter: config.autoAcknowledgeAfter || 24, // hours
      thresholds: {
        repositoryUsage: {
          warning: 70,
          critical: 85
        },
        jobFailureCount: {
          warning: 1,
          critical: 3
        },
        healthScore: {
          warning: 70,
          critical: 50
        },
        longRunningJob: 4, // hours
        ...config.thresholds
      }
    };
    
    // Create logger instance
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'alerting-service' },
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });
    
    this.activeAlerts = new Map();
    this.acknowledgedAlerts = new Map();
    this.loadAlerts();
  }

  // Load alerts from persistent storage
  async loadAlerts() {
    try {
      // Load active alerts
      if (await fs.pathExists(this.config.alertsFilePath)) {
        const alertsData = await fs.readJson(this.config.alertsFilePath);
        Object.entries(alertsData).forEach(([id, alert]) => {
          this.activeAlerts.set(id, alert);
        });
        this.logger.info(`Loaded ${this.activeAlerts.size} active alerts`);
      }

      // Load acknowledged alerts
      if (await fs.pathExists(this.config.acknowledgedAlertsFilePath)) {
        const ackData = await fs.readJson(this.config.acknowledgedAlertsFilePath);
        Object.entries(ackData).forEach(([id, alert]) => {
          this.acknowledgedAlerts.set(id, alert);
        });
        this.logger.info(`Loaded ${this.acknowledgedAlerts.size} acknowledged alerts`);
      }
    } catch (error) {
      this.logger.error('Error loading alerts:', error.message);
    }
  }

  // Save alerts to persistent storage
  async saveAlerts() {
    try {
      await fs.ensureDir(path.dirname(this.config.alertsFilePath));
      
      // Save active alerts
      const alertsData = Object.fromEntries(this.activeAlerts);
      await fs.writeJson(this.config.alertsFilePath, alertsData, { spaces: 2 });
      
      // Save acknowledged alerts
      const ackData = Object.fromEntries(this.acknowledgedAlerts);
      await fs.writeJson(this.config.acknowledgedAlertsFilePath, ackData, { spaces: 2 });
      
      this.logger.debug('Alerts saved to persistent storage');
    } catch (error) {
      this.logger.error('Error saving alerts:', error.message);
    }
  }

  // Create a new alert
  createAlert(type, severity, title, description, metadata = {}) {
    const alertId = uuidv4();
    const alert = {
      id: alertId,
      type,
      severity, // 'info', 'warning', 'critical'
      title,
      description,
      metadata,
      createdAt: new Date().toISOString(),
      lastNotified: null,
      notificationCount: 0,
      acknowledged: false,
      acknowledgedAt: null,
      acknowledgedBy: null,
      resolved: false,
      resolvedAt: null
    };

    this.activeAlerts.set(alertId, alert);
    this.saveAlerts();
    
    this.logger.info(`Alert created: ${type} - ${title}`);
    return alert;
  }

  // Update an existing alert
  updateAlert(alertId, updates) {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      Object.assign(alert, updates, { updatedAt: new Date().toISOString() });
      this.activeAlerts.set(alertId, alert);
      this.saveAlerts();
      return alert;
    }
    return null;
  }

  // Acknowledge an alert
  acknowledgeAlert(alertId, acknowledgedBy = 'system') {
    const alert = this.activeAlerts.get(alertId);
    if (alert && !alert.acknowledged) {
      alert.acknowledged = true;
      alert.acknowledgedAt = new Date().toISOString();
      alert.acknowledgedBy = acknowledgedBy;
      
      this.acknowledgedAlerts.set(alertId, alert);
      this.activeAlerts.delete(alertId);
      this.saveAlerts();
      
      this.logger.info(`Alert acknowledged: ${alert.title} by ${acknowledgedBy}`);
      return alert;
    }
    return null;
  }

  // Acknowledge all active alerts
  acknowledgeAllAlerts(acknowledgedBy = 'system') {
    const acknowledgedAlerts = [];
    const timestamp = new Date().toISOString();
    
    // Process all active alerts
    Array.from(this.activeAlerts.values()).forEach(alert => {
      if (!alert.acknowledged) {
        alert.acknowledged = true;
        alert.acknowledgedAt = timestamp;
        alert.acknowledgedBy = acknowledgedBy;
        
        this.acknowledgedAlerts.set(alert.id, alert);
        acknowledgedAlerts.push(alert);
      }
    });
    
    // Clear all active alerts
    this.activeAlerts.clear();
    this.saveAlerts();
    
    this.logger.info(`Bulk acknowledged ${acknowledgedAlerts.length} alerts by ${acknowledgedBy}`);
    return {
      count: acknowledgedAlerts.length,
      alerts: acknowledgedAlerts,
      acknowledgedBy,
      acknowledgedAt: timestamp
    };
  }

  // Resolve an alert
  resolveAlert(alertId, resolvedBy = 'system') {
    const alert = this.activeAlerts.get(alertId) || this.acknowledgedAlerts.get(alertId);
    if (alert && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = new Date().toISOString();
      alert.resolvedBy = resolvedBy;
      
      if (this.activeAlerts.has(alertId)) {
        this.activeAlerts.delete(alertId);
      }
      if (this.acknowledgedAlerts.has(alertId)) {
        this.acknowledgedAlerts.delete(alertId);
      }
      
      this.saveAlerts();
      this.logger.info(`Alert resolved: ${alert.title}`);
      return alert;
    }
    return null;
  }

  // Check if alert should be sent (based on retry logic)
  shouldSendAlert(alert) {
    if (alert.acknowledged || alert.resolved) {
      return false;
    }

    if (alert.notificationCount >= this.config.maxRetries) {
      return false;
    }

    if (!alert.lastNotified) {
      return true;
    }

    const lastNotified = moment(alert.lastNotified);
    const now = moment();
    const minutesSinceLastNotification = now.diff(lastNotified, 'minutes');
    
    return minutesSinceLastNotification >= this.config.retryInterval;
  }

  // Send alert notification
  async sendAlertNotification(alert) {
    try {
      if (!this.shouldSendAlert(alert)) {
        return false;
      }

      // WhatsApp service expects the alert object, not a formatted message
      await this.whatsappService.sendAlert(alert);
      
      // Update alert notification tracking
      alert.lastNotified = new Date().toISOString();
      alert.notificationCount++;
      this.updateAlert(alert.id, alert);
      
      this.logger.info(`Alert notification sent: ${alert.title} (attempt ${alert.notificationCount})`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send alert notification for ${alert.title}:`, error.message);
      return false;
    }
  }

  // Format alert message for WhatsApp
  formatAlertMessage(alert) {
    const severityEmojis = {
      info: 'ℹ️',
      warning: '⚠️',
      critical: '🚨'
    };

    const emoji = severityEmojis[alert.severity] || '📢';
    const timestamp = moment(alert.createdAt).format('HH:mm:ss');
    
    let message = `${emoji} *Veeam Alert - ${alert.severity.toUpperCase()}*\n\n`;
    message += `📋 *${alert.title}*\n`;
    message += `📝 ${alert.description}\n`;
    message += `🕐 Time: ${timestamp}\n`;
    
    if (alert.metadata && Object.keys(alert.metadata).length > 0) {
      message += `\n📊 *Details:*\n`;
      Object.entries(alert.metadata).forEach(([key, value]) => {
        message += `• ${key}: ${value}\n`;
      });
    }
    
    if (alert.notificationCount > 0) {
      message += `\n🔄 Retry #${alert.notificationCount + 1}\n`;
    }
    
    message += `\n💡 Reply with "ACK ${alert.id.substring(0, 8)}" to acknowledge this alert.`;
    
    return message;
  }

  // Check for job failures
  async checkJobFailures() {
    try {
      const failedJobs = await this.dataService.getFailedJobs(1); // Last hour
      
      this.logger.info(`[DEBUG] checkJobFailures: Processing ${failedJobs.length} failed jobs`);
      
      failedJobs.forEach(job => {
        this.logger.info(`[DEBUG] Processing job:`, {
          jobId: job.id,
          jobName: job.name,
          originalResult: job.lastResult,
          lastRun: job.lastRun
        });
        
        // Validate job data before creating alert
        if (!this.isValidJobData(job)) {
          this.logger.warn(`[DEBUG] Skipping invalid job data for job failure check:`, { 
            jobId: job.id, 
            jobName: job.name, 
            lastResult: job.lastResult,
            reason: 'Failed isValidJobData check'
          });
          return;
        }
        
        const jobName = this.resolveJobName(job);
        const originalResult = job.lastResult;
        const normalizedResult = this.normalizeResult(job.lastResult);
        
        this.logger.info(`[DEBUG] Job validation passed:`, {
          jobId: job.id,
          resolvedJobName: jobName,
          originalResult: originalResult,
          normalizedResult: normalizedResult
        });
        
        // Skip if result is not actually a failure
        if (normalizedResult === 'Success' || normalizedResult === 'Unknown') {
          this.logger.info(`[DEBUG] Skipping job due to result filter:`, {
            jobId: job.id,
            jobName: jobName,
            normalizedResult: normalizedResult,
            reason: 'Result is Success or Unknown'
          });
          return;
        }
        
        const alertKey = `job_failure_${job.id}`;
        const existingAlert = Array.from(this.activeAlerts.values())
          .find(alert => alert.metadata.jobId === job.id && alert.type === 'job_failure');
        
        if (!existingAlert) {
          this.logger.info(`[DEBUG] Creating new job failure alert:`, {
            jobId: job.id,
            jobName: jobName,
            normalizedResult: normalizedResult
          });
          
          const severity = normalizedResult === 'Failed' ? 'critical' : 'warning';
          this.createAlert(
            'job_failure',
            severity,
            `Backup Job Failed: ${jobName}`,
            `Job "${jobName}" failed with result: ${normalizedResult}. Last run: ${moment(job.lastRun).format('YYYY-MM-DD HH:mm:ss')}`,
            {
              jobId: job.id,
              jobName: jobName,
              lastResult: normalizedResult,
              originalResult: originalResult,
              lastRun: job.lastRun,
              message: job.message || 'No additional details available'
            }
          );
        } else {
          this.logger.info(`[DEBUG] Skipping job - existing alert found:`, {
            jobId: job.id,
            jobName: jobName,
            existingAlertId: existingAlert.id
          });
        }
      });
    } catch (error) {
      this.logger.error('Error checking job failures:', error.message);
    }
  }

  // Check repository usage
  async checkRepositoryUsage() {
    try {
      const repositoryStates = await this.dataService.getRepositoryStates();
      
      if (repositoryStates?.data) {
        repositoryStates.data.forEach(repo => {
          const usage = repo.usagePercentage || 0;
          const alertKey = `repo_usage_${repo.id || repo.name}`;
          
          const existingAlert = Array.from(this.activeAlerts.values())
            .find(alert => alert.metadata.repositoryId === (repo.id || repo.name) && alert.type === 'repository_usage');
          
          let severity = null;
          if (usage >= this.config.thresholds.repositoryUsage.critical) {
            severity = 'critical';
          } else if (usage >= this.config.thresholds.repositoryUsage.warning) {
            severity = 'warning';
          }
          
          if (severity && !existingAlert) {
            this.createAlert(
              'repository_usage',
              severity,
              `Repository Usage ${severity === 'critical' ? 'Critical' : 'Warning'}: ${repo.name}`,
              `Repository "${repo.name}" is at ${usage.toFixed(2)}% capacity (${(repo.usedSpaceGB / 1024).toFixed(2)}TB / ${(repo.capacityGB / 1024).toFixed(2)}TB)`,
              {
                repositoryId: repo.id || repo.name,
                repositoryName: repo.name,
                usagePercentage: usage,
                usedSpaceGB: repo.usedSpaceGB,
                capacityGB: repo.capacityGB,
                path: repo.path
              }
            );
          } else if (!severity && existingAlert) {
            // Usage dropped below threshold, resolve alert
            this.resolveAlert(existingAlert.id, 'auto-resolved');
          }
        });
      }
    } catch (error) {
      this.logger.error('Error checking repository usage:', error.message);
    }
  }

  // Check system health
  async checkSystemHealth() {
    try {
      const data = await this.dataService.collectAllData();
      let healthScore;
      
      if (this.reportingEngine) {
        healthScore = this.reportingEngine.calculateHealthScore(data);
      } else {
        // Fallback: create temporary engine without alerting service to avoid circular dependency
        const reportingEngine = require('./reportingEngine');
        const engine = new reportingEngine(this.dataService);
        healthScore = engine.calculateHealthScore(data);
      }
      
      const existingAlert = Array.from(this.activeAlerts.values())
        .find(alert => alert.type === 'system_health');
      
      let severity = null;
      if (healthScore.score <= this.config.thresholds.healthScore.critical) {
        severity = 'critical';
      } else if (healthScore.score <= this.config.thresholds.healthScore.warning) {
        severity = 'warning';
      }
      
      if (severity && !existingAlert) {
        this.createAlert(
          'system_health',
          severity,
          `System Health ${severity === 'critical' ? 'Critical' : 'Warning'}`,
          `System health score has dropped to ${healthScore.score}/100. Immediate attention required.`,
          {
            healthScore: healthScore.score,
            factors: healthScore.factors,
            timestamp: healthScore.timestamp
          }
        );
      } else if (!severity && existingAlert) {
        // Health improved, resolve alert
        this.resolveAlert(existingAlert.id, 'auto-resolved');
      }
    } catch (error) {
      this.logger.error('Error checking system health:', error.message);
    }
  }

  // Check for long running jobs
  async checkLongRunningJobs() {
    try {
      const runningSessions = await this.dataService.getRunningJobs();
      
      runningSessions.forEach(session => {
        if (session.creationTime) {
          const duration = moment().diff(moment(session.creationTime), 'hours');
          
          if (duration >= this.config.thresholds.longRunningJob) {
            const existingAlert = Array.from(this.activeAlerts.values())
              .find(alert => alert.metadata.sessionId === session.id && alert.type === 'long_running_job');
            
            if (!existingAlert) {
              this.createAlert(
                'long_running_job',
                'warning',
                `Long Running Job: ${session.jobName || 'Unknown Job'}`,
                `Job has been running for ${duration.toFixed(1)} hours, which exceeds the threshold of ${this.config.thresholds.longRunningJob} hours.`,
                {
                  sessionId: session.id,
                  jobName: session.jobName,
                  duration: duration,
                  startTime: session.creationTime,
                  state: session.state
                }
              );
            }
          }
        }
      });
    } catch (error) {
      this.logger.error('Error checking long running jobs:', error.message);
    }
  }

  // Check for job state changes
  async checkJobStateChanges() {
    try {
      const runningSessions = await this.dataService.getRunningJobs();
      const recentSessions = await this.dataService.getRecentSessions(1); // Last hour
      
      // Check for newly started jobs
      runningSessions.forEach(session => {
        if (!this.isValidSessionData(session)) {
          this.logger.warn(`Skipping invalid session data for job start check:`, { sessionId: session.id, jobName: session.jobName });
          return;
        }
        
        if (session.creationTime) {
          const startTime = moment(session.creationTime);
          const minutesAgo = moment().diff(startTime, 'minutes');
          
          // Alert for jobs that started in the last 5 minutes
          if (minutesAgo <= 5) {
            const existingAlert = Array.from(this.activeAlerts.values())
              .find(alert => alert.metadata.sessionId === session.id && alert.type === 'job_started');
            
            if (!existingAlert) {
              const jobName = this.resolveJobName(session);
              this.createAlert(
                'job_started',
                'info',
                `Backup Job Started: ${jobName}`,
                `Backup job "${jobName}" has started at ${startTime.format('HH:mm:ss')}.`,
                {
                  sessionId: session.id,
                  jobName: jobName,
                  startTime: session.creationTime,
                  state: session.state
                }
              );
            }
          }
        }
      });
      
      // Check for recently completed jobs
      if (recentSessions?.data) {
        recentSessions.data.forEach(session => {
          if (!this.isValidSessionData(session)) {
            this.logger.warn(`Skipping invalid session data for job completion check:`, { sessionId: session.id, jobName: session.jobName });
            return;
          }
          
          if (session.endTime) {
            const endTime = moment(session.endTime);
            const minutesAgo = moment().diff(endTime, 'minutes');
            
            // Alert for jobs that completed in the last 5 minutes
            if (minutesAgo <= 5) {
              const jobName = this.resolveJobName(session);
              const resultValue = this.normalizeResult(session.result?.result || session.result);
              const resultMessage = session.result?.message || 'No additional details';
              
              // Skip alerts for unknown or invalid results
              if (resultValue === 'Unknown') {
                this.logger.warn(`Skipping alert for session with unknown result:`, { sessionId: session.id, jobName: jobName, result: session.result });
                return;
              }
              
              const severity = resultValue === 'Success' ? 'info' : 
                             resultValue === 'Warning' ? 'warning' : 'critical';
              
              const existingAlert = Array.from(this.activeAlerts.values())
                .find(alert => alert.metadata.sessionId === session.id && alert.type === 'job_completed');
              
              if (!existingAlert) {
                this.createAlert(
                  'job_completed',
                  severity,
                  `Backup Job ${resultValue}: ${jobName}`,
                  `Backup job "${jobName}" completed with result: ${resultValue} at ${endTime.format('HH:mm:ss')}. ${resultMessage}`,
                  {
                    sessionId: session.id,
                    jobName: jobName,
                    result: resultValue,
                    resultMessage: resultMessage,
                    endTime: session.endTime,
                    duration: session.creationTime ? moment(session.endTime).diff(moment(session.creationTime), 'minutes') : null
                  }
                );
              }
            }
          }
        });
      }
    } catch (error) {
      this.logger.error('Error checking job state changes:', error.message);
    }
  }

  // Run all alert checks
  async runAlertChecks() {
    this.logger.info('Running alert checks...');
    
    try {
      await Promise.allSettled([
        this.checkJobFailures(),
        this.checkRepositoryUsage(),
        this.checkSystemHealth(),
        this.checkLongRunningJobs(),
        this.checkJobStateChanges()
      ]);
      
      // Clean up old acknowledged alerts
      this.cleanupOldAlerts();
      
      this.logger.info('Alert checks completed');
    } catch (error) {
      this.logger.error('Error running alert checks:', error.message);
    }
  }

  // Send pending alert notifications
  async sendPendingAlerts() {
    const pendingAlerts = Array.from(this.activeAlerts.values())
      .filter(alert => this.shouldSendAlert(alert));
    
    this.logger.info(`Sending ${pendingAlerts.length} pending alerts`);
    
    for (const alert of pendingAlerts) {
      await this.sendAlertNotification(alert);
      // Add delay between notifications to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Clean up old alerts
  cleanupOldAlerts() {
    const cutoff = moment().subtract(this.config.autoAcknowledgeAfter, 'hours');
    
    // Auto-acknowledge old alerts
    Array.from(this.activeAlerts.values()).forEach(alert => {
      if (moment(alert.createdAt).isBefore(cutoff)) {
        this.acknowledgeAlert(alert.id, 'auto-acknowledged');
      }
    });
    
    // Remove very old acknowledged alerts (older than 7 days)
    const oldCutoff = moment().subtract(7, 'days');
    Array.from(this.acknowledgedAlerts.keys()).forEach(alertId => {
      const alert = this.acknowledgedAlerts.get(alertId);
      if (moment(alert.acknowledgedAt).isBefore(oldCutoff)) {
        this.acknowledgedAlerts.delete(alertId);
      }
    });
    
    this.saveAlerts();
  }

  // Get alert statistics
  getAlertStatistics() {
    return {
      active: this.activeAlerts.size,
      acknowledged: this.acknowledgedAlerts.size,
      byType: _.countBy(Array.from(this.activeAlerts.values()), 'type'),
      bySeverity: _.countBy(Array.from(this.activeAlerts.values()), 'severity'),
      oldestActive: this.activeAlerts.size > 0 ? 
        Math.min(...Array.from(this.activeAlerts.values()).map(a => new Date(a.createdAt).getTime())) : null
    };
  }

  // Get all active alerts
  getActiveAlerts() {
    return Array.from(this.activeAlerts.values());
  }

  // Get acknowledged alerts
  getAcknowledgedAlerts() {
    return Array.from(this.acknowledgedAlerts.values());
  }

  // Helper method to validate job data
  isValidJobData(job) {
    if (!job || !job.id) {
      return false;
    }
    
    // Check if job has a valid name or can be resolved
    const hasValidName = job.name && job.name.trim() !== '' && job.name !== 'Unknown Job';
    const hasValidResult = job.lastResult && job.lastResult !== 'None' && job.lastResult !== 'Unknown';
    
    return hasValidName || hasValidResult;
  }

  // Helper method to validate session data
  isValidSessionData(session) {
    if (!session || !session.id) {
      return false;
    }
    
    // Check if session has a valid job name or can be resolved
    const hasValidName = session.jobName && session.jobName.trim() !== '' && session.jobName !== 'Unknown Job';
    const hasValidResult = session.result && session.result !== 'None' && session.result !== 'Unknown';
    
    return hasValidName || hasValidResult;
  }

  // Helper method to resolve job names
  resolveJobName(jobOrSession) {
    if (!jobOrSession) {
      return 'Unknown Job';
    }
    
    // Try to get name from different possible fields
    const name = jobOrSession.name || jobOrSession.jobName || jobOrSession.displayName;
    
    if (name && name.trim() !== '' && name !== 'Unknown Job') {
      return name.trim();
    }
    
    // If we have an ID, try to use it as fallback
    if (jobOrSession.id) {
      return `Job-${jobOrSession.id.substring(0, 8)}`;
    }
    
    return 'Unknown Job';
  }

  // Helper method to normalize result values
  normalizeResult(result) {
    if (!result || result === 'None' || result === '') {
      return 'Unknown';
    }
    
    // Handle nested result objects
    if (typeof result === 'object' && result.result) {
      result = result.result;
    }
    
    // Normalize common result values
    const normalizedResult = String(result).trim();
    
    switch (normalizedResult.toLowerCase()) {
      case 'success':
      case 'successful':
      case 'completed':
        return 'Success';
      case 'warning':
      case 'warnings':
        return 'Warning';
      case 'failed':
      case 'failure':
      case 'error':
        return 'Failed';
      case 'critical':
        return 'Critical';
      default:
        return normalizedResult || 'Unknown';
    }
  }
}

module.exports = AlertingService;