const axios = require('axios');
const winston = require('winston');
const moment = require('moment');
const fs = require('fs').promises;
const FormData = require('form-data');
const HtmlReportService = require('./htmlReportService');

class WhatsAppService {
    constructor(config = {}) {
        this.webhookUrl = config.webhookUrl || process.env.WHATSAPP_WEBHOOK_URL;
        this.chatId = config.chatId || process.env.WHATSAPP_CHAT_ID;
        this.retryAttempts = config.retryAttempts || 3;
        this.retryDelay = config.retryDelay || 1000;
        this.htmlReportService = new HtmlReportService();
        
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.File({ filename: 'logs/whatsapp.log' }),
                new winston.transports.Console()
            ]
        });
    }

    /**
     * Send a message to WhatsApp
     * @param {string} message - The message to send
     * @param {Object} options - Additional options
     * @returns {Promise<boolean>} - Success status
     */
    async sendMessage(message, options = {}) {
        const payload = {
            id: options.chatId || this.chatId,
            message: message
        };

        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            try {

                
                const response = await axios.post(this.webhookUrl, payload, {
                    timeout: 10000,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                if (response.status === 200) {
                    this.logger.info('WhatsApp message sent successfully', {
                        messageLength: message.length,
                        attempt,
                        chatId: payload.id
                    });
                    return true;
                }
            } catch (error) {
                this.logger.error(`WhatsApp message send attempt ${attempt} failed`, {
                    error: error.message,
                    attempt,
                    maxAttempts: this.retryAttempts
                });

                if (attempt === this.retryAttempts) {
                    this.logger.error('All WhatsApp message send attempts failed', {
                        error: error.message,
                        messageLength: message.length
                    });
                    return false;
                }

                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
            }
        }

        return false;
    }

    /**
     * Send a daily report via WhatsApp
     * @param {Object} reportData - The report data
     * @param {Object} options - Options for report format
     * @returns {Promise<boolean>} - Success status
     */
    async sendDailyReport(reportData, options = {}) {
        if (options.format === 'image' || options.includeImage) {
            return await this.sendDailyReportWithImage(reportData, options);
        } else {
            const message = this.formatDailyReport(reportData);
            return await this.sendMessage(message);
        }
    }

    /**
     * Send a daily report with HTML image via WhatsApp
     * @param {Object} reportData - The report data
     * @param {Object} options - Options for image generation
     * @returns {Promise<boolean>} - Success status
     */
    async sendDailyReportWithImage(reportData, options = {}) {
        try {
            // Generate the HTML report image
            const imageResult = await this.htmlReportService.captureReportImage(reportData, {
                width: options.width || 1200,
                height: options.height || 1600
            });

            if (!imageResult.success) {
                this.logger.error('Failed to generate report image');
                // Fallback to text message
                const message = this.formatDailyReport(reportData);
                return await this.sendMessage(message);
            }

            // Send the image
            const imageSuccess = await this.sendImage(imageResult.filepath, {
                caption: this.formatImageCaption(reportData),
                chatId: this.chatId
            });

            if (imageSuccess) {
                this.logger.info('Daily report image sent successfully', {
                    filepath: imageResult.filepath,
                    filename: imageResult.filename
                });
                return true;
            } else {
                // Fallback to text message if image sending fails
                this.logger.warn('Image sending failed, falling back to text message');
                const message = this.formatDailyReport(reportData);
                return await this.sendMessage(message);
            }
        } catch (error) {
            this.logger.error('Error sending daily report with image:', error);
            // Fallback to text message
            const message = this.formatDailyReport(reportData);
            return await this.sendMessage(message);
        }
    }

    /**
     * Send an alert to WhatsApp
     * @param {Object} alert - The alert object
     * @returns {Promise<boolean>} - Success status
     */
    async sendAlert(alert) {
        const message = this.formatAlert(alert);
        return await this.sendMessage(message);
    }

    /**
     * Send a quick status update
     * @param {Object} statusData - Quick status data
     * @returns {Promise<boolean>} - Success status
     */
    async sendQuickStatus(statusData) {
        const message = this.formatQuickStatus(statusData);
        return await this.sendMessage(message);
    }

    /**
     * Format daily report for WhatsApp
     * @param {Object} reportData - Report data
     * @returns {string} - Formatted message
     */
    formatDailyReport(reportData) {
        try {
            // Handle different report structures
            const summary = reportData.summary || reportData.performanceSummary || {};
            const storage = reportData.storageAnalytics || {};
            const repositories = reportData.repositoryHealth || reportData.repositories || {};
            const trends = reportData.performanceTrends || reportData.trends || {};
            const jobs = reportData.jobs || [];
            const timestamp = reportData.timestamp || new Date().toISOString();
            
            // Determine report icon based on job status
            let reportIcon = '✅'; // Default: all good
            if (summary.failureRate > 0) {
                reportIcon = '🚨'; // Failed jobs present
            } else if (summary.warningRate > 0) {
                reportIcon = '⚠️'; // Warning jobs present
            }
            
            let message = `${reportIcon} *Veeam Backup Report*\n\n`;
            
            // Period
            const reportDate = moment(timestamp).format('YYYY-MM-DD HH:mm');
            message += `📅 *Report Date:* ${reportDate}\n\n`;
            
            // Performance Summary
            message += `📊 *Performance Summary:*\n`;
            message += `• Total Jobs: ${summary.totalJobs || 'N/A'}\n`;
            message += `• ✅ Success Rate: ${this.formatNumber(summary.successRate)}%\n`;
            message += `• ❌ Failure Rate: ${this.formatNumber(summary.failureRate)}%\n`;
            message += `• ⚠️ Warning Rate: ${this.formatNumber(summary.warningRate)}%\n`;
            message += `• 🚨 Active Alerts: ${summary.activeAlerts || 'N/A'}\n\n`;
            
            // System Health Score
            const healthScore = summary.healthScore || (reportData.healthScore && reportData.healthScore.score) || reportData.healthScore || 'N/A';
            message += `🏥 *System Health Score:* ${this.formatNumber(healthScore)}/100\n\n`;
            
            // Repository Details
            const storageAnalytics = reportData.storageAnalytics || {};
            const repoList = storageAnalytics.repositories || [];
            if (repoList.length > 0) {
                message += `🗄️ *Repository Details:*\n`;
                repoList.forEach(repo => {
                    const status = repo.status || {};
                    message += `${status.emoji || '🔵'} *${repo.name}*\n`;
                    message += `   • Capacity: ${this.formatNumber(repo.capacityTB || 0)}TB\n`;
                    message += `   • Used: ${this.formatNumber(repo.usedTB || 0)}TB\n`;
                    message += `   • Usage: ${this.formatNumber(repo.usagePercentage || 0)}%\n`;
                    message += `   • Path: ${repo.path || 'N/A'}\n\n`;
                });
            }
            
            // Failed and Warning Jobs
            const failedJobs = jobs.filter(job => job.lastResult === 'Failed');
            const warningJobs = jobs.filter(job => job.lastResult === 'Warning');
            
            if (failedJobs.length > 0 || warningJobs.length > 0) {
                message += `⚠️ *Job Issues:*\n`;
                
                if (failedJobs.length > 0) {
                    message += `🔴 *Failed Jobs (${failedJobs.length}):*\n`;
                    failedJobs.forEach(job => {
                        const lastRun = job.lastRun ? moment(job.lastRun).format('MM/DD HH:mm') : 'N/A';
                        message += `   • ${job.name} - ${lastRun}\n`;
                    });
                    message += `\n`;
                }
                
                if (warningJobs.length > 0) {
                    message += `🟡 *Warning Jobs (${warningJobs.length}):*\n`;
                    warningJobs.forEach(job => {
                        const lastRun = job.lastRun ? moment(job.lastRun).format('MM/DD HH:mm') : 'N/A';
                        message += `   • ${job.name} - ${lastRun}\n`;
                    });
                    message += `\n`;
                }
            }
            

            
            message += `📊 Generated at: ${reportDate}`;
            
            return message;
        } catch (error) {
            this.logger.error('Error formatting daily report for WhatsApp:', error.message);
            return `🚨 *Veeam Backup Report*\n\nError generating report. Please check logs for details.\n\nGenerated at: ${moment().format('YYYY-MM-DD HH:mm')}`;
        }
    }

    /**
     * Format number to 2 decimal places
     * @param {number|string} value - The value to format
     * @returns {string} - Formatted number
     */
    formatNumber(value) {
        if (value === null || value === undefined || value === 'N/A') {
            return 'N/A';
        }
        const num = parseFloat(value);
        return isNaN(num) ? 'N/A' : num.toFixed(2);
    }

    /**
     * Format alert for WhatsApp
     * @param {Object} alert - Alert object
     * @returns {string} - Formatted message
     */
    formatAlert(alert) {
        const severityEmojis = {
            critical: '🚨',
            high: '⚠️',
            medium: '🟡',
            low: 'ℹ️',
            warning: '⚠️',
            info: 'ℹ️'
        };

        const emoji = severityEmojis[alert.severity] || 'ℹ️';
        
        // Handle both field naming conventions
        const alertMessage = alert.message || alert.description || alert.title || 'No message available';
        const alertTimestamp = alert.timestamp || alert.createdAt;
        const formattedTime = alertTimestamp ? moment(alertTimestamp).format('YYYY-MM-DD HH:mm:ss') : 'Unknown time';
        
        let message = `${emoji} *VEEAM ALERT*\n\n`;
        message += `*Type:* ${alert.type}\n`;
        message += `*Severity:* ${alert.severity.toUpperCase()}\n`;
        message += `*Time:* ${formattedTime}\n\n`;
        message += `*Message:*\n${alertMessage}\n\n`;
        
        if (alert.details) {
            message += `*Details:*\n${alert.details}\n\n`;
        }
        
        // Check metadata for additional job information
        if (alert.jobName || alert.metadata?.jobName) {
            message += `*Job:* ${alert.jobName || alert.metadata.jobName}\n`;
        }
        
        if (alert.repositoryName || alert.metadata?.repositoryName) {
            message += `*Repository:* ${alert.repositoryName || alert.metadata.repositoryName}\n`;
        }
        
        // Add metadata information if available
        if (alert.metadata && Object.keys(alert.metadata).length > 0) {
            const relevantMetadata = Object.entries(alert.metadata)
                .filter(([key, value]) => value && !['jobName', 'repositoryName'].includes(key))
                .slice(0, 3); // Limit to 3 most relevant fields
            
            if (relevantMetadata.length > 0) {
                message += `\n*Additional Info:*\n`;
                relevantMetadata.forEach(([key, value]) => {
                    const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                    message += `• ${formattedKey}: ${value}\n`;
                });
            }
        }
        
        message += `\n*Alert ID:* ${alert.id}\n`;
        message += `\nTo acknowledge this alert, reply with: /ack ${alert.id}`;
        
        return message;
    }

    /**
     * Format quick status for WhatsApp
     * @param {Object} statusData - Status data
     * @returns {string} - Formatted message
     */
    formatQuickStatus(statusData) {
        let message = `⚡ <b>Quick Status Update</b>\n\n`;
        
        message += `🏥 Health Score: ${statusData.healthScore}/100\n`;
        message += `✅ Success Rate: ${statusData.successRate}%\n`;
        message += `🚨 Active Alerts: ${statusData.activeAlerts}\n`;
        message += `💾 Storage Usage: ${statusData.storageUsage}%\n\n`;
        
        if (statusData.runningJobs > 0) {
            message += `🔄 Running Jobs: ${statusData.runningJobs}\n`;
        }
        
        if (statusData.recentFailures > 0) {
            message += `❌ Recent Failures: ${statusData.recentFailures}\n`;
        }
        
        message += `\n⏰ ${moment().format('YYYY-MM-DD HH:mm:ss')}`;
        
        return message;
    }

    /**
     * Send multiple messages as a group (for large reports)
     * @param {Array<string>} messages - Array of messages
     * @returns {Promise<boolean>} - Success status
     */
    async sendMessageGroup(messages) {
        let allSuccess = true;
        
        for (let i = 0; i < messages.length; i++) {
            const success = await this.sendMessage(messages[i]);
            if (!success) {
                allSuccess = false;
            }
            
            // Small delay between messages to avoid rate limiting
            if (i < messages.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        return allSuccess;
    }

    /**
     * Format bytes to human readable format
     * @param {number} bytes - Bytes to format
     * @returns {string} - Formatted string
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Test the WhatsApp connection
     * @returns {Promise<boolean>} - Connection status
     */
    async testConnection() {
        const testMessage = `🧪 <b>Veeam Backend Test</b>\n\nConnection test at ${moment().format('YYYY-MM-DD HH:mm:ss')}`;
        return await this.sendMessage(testMessage);
    }

    /**
     * Send an image to WhatsApp
     * @param {string} imagePath - Path to the image file
     * @param {Object} options - Additional options
     * @returns {Promise<boolean>} - Success status
     */
    async sendImage(imagePath, options = {}) {
        try {
            // Check if file exists
            const fs = require('fs');
            if (!fs.existsSync(imagePath)) {
                this.logger.error('Image file does not exist', { imagePath });
                return false;
            }

            const formData = new FormData();
            const imageBuffer = fs.readFileSync(imagePath);
            
            // Use the exact same format as the working direct API calls
            formData.append('image', imageBuffer, {
                filename: imagePath.split('/').pop() || 'report.png',
                contentType: 'image/png'
            });
            formData.append('id', options.chatId || this.chatId);
            
            if (options.caption) {
                formData.append('message', options.caption);
            }

            this.logger.info('Sending image to WhatsApp', {
                imagePath,
                webhookUrl: this.webhookUrl,
                chatId: options.chatId || this.chatId,
                bufferSize: imageBuffer.length
            });
            


            const response = await axios.post(this.webhookUrl, formData, {
                timeout: 30000,
                headers: {
                    ...formData.getHeaders()
                }
            });

            this.logger.info('WhatsApp image sent successfully', {
                imagePath,
                chatId: options.chatId || this.chatId,
                status: response.status,
                responseData: response.data
            });

            return true;

        } catch (error) {
            this.logger.error('WhatsApp image send error', {
                error: error.message,
                imagePath,
                status: error.response?.status,
                responseData: error.response?.data
            });
            return false;
        }
    }

    /**
     * Format a detailed caption for image reports
     * @param {Object} reportData - Report data
     * @returns {string} - Formatted caption
     */
    formatImageCaption(reportData) {
        const summary = reportData.summary || reportData.performanceSummary || {};
        const storage = reportData.storageAnalytics || {};
        const repositories = reportData.repositoryHealth || reportData.repositories || {};
        const jobs = reportData.jobs || [];
        const timestamp = reportData.timestamp || new Date().toISOString();
        
        let reportIcon = '✅';
        if (summary.failureRate > 0) {
            reportIcon = '🚨';
        } else if (summary.warningRate > 0) {
            reportIcon = '⚠️';
        }
        
        const reportDate = moment(timestamp).format('YYYY-MM-DD HH:mm');
        
        let caption = `${reportIcon} Veeam Backup Report\n\n`;
        caption += `📅 Report Date: ${reportDate}\n\n`;
        caption += `📊 Performance Summary:\n`;
        caption += `•⁠  ⁠Total Jobs: ${summary.totalJobs || 'N/A'}\n`;
        caption += `•⁠  ⁠✅ Success Rate: ${this.formatNumber(summary.successRate)}%\n`;
        caption += `•⁠  ⁠❌ Failure Rate: ${this.formatNumber(summary.failureRate)}%\n`;
        caption += `•⁠  ⁠⚠️ Warning Rate: ${this.formatNumber(summary.warningRate)}%\n`;
        caption += `•⁠  ⁠🚨 Active Alerts: ${summary.activeAlerts || 'N/A'}\n\n`;
        const healthScore = summary.healthScore || (reportData.healthScore && reportData.healthScore.score) || reportData.healthScore || 'N/A';
        caption += `🏥 System Health Score: ${this.formatNumber(healthScore)}/100\n\n`;
        
        // Repository Details
        const repoList = storage.repositories || [];
        if (repoList.length > 0) {
            caption += `🗄️ Repository Details:\n`;
            repoList.forEach(repo => {
                const status = repo.usagePercentage > 80 ? '🟡' : '🟢';
                caption += `${status} ${repo.name}\n`;
                caption += `   • Capacity: ${this.formatNumber(repo.capacityTB || 0)}TB\n`;
                caption += `   • Used: ${this.formatNumber(repo.usedTB || 0)}TB\n`;
                caption += `   • Usage: ${this.formatNumber(repo.usagePercentage || 0)}%\n`;
                caption += `   • Path: ${repo.path || 'N/A'}\n\n`;
            });
        }
        
        // Failed Jobs
        const failedJobs = jobs.filter(job => job.lastResult === 'Failed');
        if (failedJobs.length > 0) {
            caption += `⚠️ Job Issues:\n`;
            caption += `🔴 Failed Jobs (${failedJobs.length}):\n`;
            failedJobs.forEach(job => {
                const lastRun = job.lastRun ? moment(job.lastRun).format('MM/DD HH:mm') : 'N/A';
                caption += `   • ${job.name} - ${lastRun}\n`;
            });
            caption += `\n`;
        }
        
        caption += `📊 Generated at: ${reportDate}`;
        
        return caption;
    }

    /**
     * Send acknowledgment confirmation
     * @param {string} alertId - Alert ID that was acknowledged
     * @param {string} acknowledgedBy - Who acknowledged the alert
     * @returns {Promise<boolean>} - Success status
     */
    async sendAcknowledgment(alertId, acknowledgedBy = 'User') {
        const message = `✅ *Alert Acknowledged*\n\n` +
                       `Alert ID: ${alertId}\n` +
                       `Acknowledged by: ${acknowledgedBy}\n` +
                       `Time: ${moment().format('YYYY-MM-DD HH:mm:ss')}`;
        
        return await this.sendMessage(message);
    }
}

module.exports = WhatsAppService;