const winston = require('winston');
const fs = require('fs-extra');
const path = require('path');
const moment = require('moment');

class ErrorHandler {
    constructor(config = {}) {
        this.config = {
            logLevel: config.logLevel || 'info',
            maxFiles: config.maxFiles || 10,
            maxSize: config.maxSize || '10m',
            enableConsole: config.enableConsole !== false,
            enableFile: config.enableFile !== false,
            enableErrorReporting: config.enableErrorReporting || false,
            errorReportingUrl: config.errorReportingUrl || null,
            ...config
        };

        this.logger = this.createLogger();
        this.errorStats = {
            totalErrors: 0,
            errorsByType: new Map(),
            errorsByService: new Map(),
            lastError: null,
            startTime: new Date()
        };

        this.setupGlobalErrorHandlers();
    }

    /**
     * Create Winston logger instance
     */
    createLogger() {
        const transports = [];

        // Console transport
        if (this.config.enableConsole) {
            transports.push(new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.timestamp(),
                    winston.format.printf(({ timestamp, level, message, ...meta }) => {
                        const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
                        return `${timestamp} [${level}]: ${message} ${metaStr}`;
                    })
                )
            }));
        }

        // File transports
        if (this.config.enableFile) {
            // Error log
            transports.push(new winston.transports.File({
                filename: 'logs/error.log',
                level: 'error',
                maxsize: this.parseSize(this.config.maxSize),
                maxFiles: this.config.maxFiles,
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.errors({ stack: true }),
                    winston.format.json()
                )
            }));

            // Combined log
            transports.push(new winston.transports.File({
                filename: 'logs/combined.log',
                maxsize: this.parseSize(this.config.maxSize),
                maxFiles: this.config.maxFiles,
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.errors({ stack: true }),
                    winston.format.json()
                )
            }));

            // Service-specific logs
            ['veeam', 'whatsapp', 'alerting', 'reporting'].forEach(service => {
                transports.push(new winston.transports.File({
                    filename: `logs/${service}.log`,
                    maxsize: this.parseSize(this.config.maxSize),
                    maxFiles: this.config.maxFiles,
                    format: winston.format.combine(
                        winston.format.timestamp(),
                        winston.format.errors({ stack: true }),
                        winston.format.json(),
                        winston.format((info) => {
                            return info.service === service ? info : false;
                        })()
                    )
                }));
            });
        }

        return winston.createLogger({
            level: this.config.logLevel,
            transports,
            exitOnError: false
        });
    }

    /**
     * Parse size string to bytes
     */
    parseSize(sizeStr) {
        const units = { b: 1, k: 1024, m: 1024 * 1024, g: 1024 * 1024 * 1024 };
        const match = sizeStr.toLowerCase().match(/^(\d+)([bkmg]?)$/);
        if (!match) return 10 * 1024 * 1024; // Default 10MB
        return parseInt(match[1]) * (units[match[2]] || 1);
    }

    /**
     * Setup global error handlers
     */
    setupGlobalErrorHandlers() {
        // Uncaught exceptions
        process.on('uncaughtException', (error) => {
            this.handleCriticalError('uncaughtException', error);
        });

        // Unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            this.handleCriticalError('unhandledRejection', reason, { promise });
        });

        // Warning events
        process.on('warning', (warning) => {
            this.logger.warn('Process warning', {
                name: warning.name,
                message: warning.message,
                stack: warning.stack
            });
        });
    }

    /**
     * Handle critical errors
     */
    handleCriticalError(type, error, meta = {}) {
        const errorInfo = {
            type,
            message: error.message || error,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            pid: process.pid,
            memory: process.memoryUsage(),
            uptime: process.uptime(),
            ...meta
        };

        this.logger.error('Critical error occurred', errorInfo);
        this.updateErrorStats(type, 'critical', errorInfo);

        // Save error report
        this.saveErrorReport(errorInfo);

        // For uncaught exceptions, we should exit gracefully
        if (type === 'uncaughtException') {
            setTimeout(() => {
                process.exit(1);
            }, 1000);
        }
    }

    /**
     * Log error with context
     */
    logError(error, context = {}) {
        const errorInfo = {
            message: error.message,
            stack: error.stack,
            name: error.name,
            code: error.code,
            timestamp: new Date().toISOString(),
            ...context
        };

        this.logger.error('Application error', errorInfo);
        this.updateErrorStats(error.name || 'Error', context.service || 'unknown', errorInfo);

        return errorInfo;
    }

    /**
     * Log warning
     */
    logWarning(message, context = {}) {
        const warningInfo = {
            message,
            timestamp: new Date().toISOString(),
            ...context
        };

        this.logger.warn(message, warningInfo);
        return warningInfo;
    }

    /**
     * Log info
     */
    logInfo(message, context = {}) {
        const infoData = {
            message,
            timestamp: new Date().toISOString(),
            ...context
        };

        this.logger.info(message, infoData);
        return infoData;
    }

    /**
     * Log debug
     */
    logDebug(message, context = {}) {
        const debugData = {
            message,
            timestamp: new Date().toISOString(),
            ...context
        };

        this.logger.debug(message, debugData);
        return debugData;
    }

    /**
     * Update error statistics
     */
    updateErrorStats(errorType, service, errorInfo) {
        this.errorStats.totalErrors++;
        this.errorStats.lastError = errorInfo;

        // Update error type stats
        const typeCount = this.errorStats.errorsByType.get(errorType) || 0;
        this.errorStats.errorsByType.set(errorType, typeCount + 1);

        // Update service stats
        const serviceCount = this.errorStats.errorsByService.get(service) || 0;
        this.errorStats.errorsByService.set(service, serviceCount + 1);
    }

    /**
     * Get error statistics
     */
    getErrorStats() {
        return {
            totalErrors: this.errorStats.totalErrors,
            errorsByType: Object.fromEntries(this.errorStats.errorsByType),
            errorsByService: Object.fromEntries(this.errorStats.errorsByService),
            lastError: this.errorStats.lastError,
            uptime: moment.duration(Date.now() - this.errorStats.startTime).humanize(),
            startTime: this.errorStats.startTime
        };
    }

    /**
     * Save error report to file
     */
    async saveErrorReport(errorInfo) {
        try {
            await fs.ensureDir('logs/error-reports');
            const filename = `error-${Date.now()}-${process.pid}.json`;
            const filepath = path.join('logs/error-reports', filename);
            
            await fs.writeJson(filepath, {
                ...errorInfo,
                environment: {
                    nodeVersion: process.version,
                    platform: process.platform,
                    arch: process.arch,
                    cwd: process.cwd(),
                    argv: process.argv,
                    env: this.sanitizeEnv(process.env)
                }
            }, { spaces: 2 });

            this.logger.info('Error report saved', { filepath });
        } catch (saveError) {
            this.logger.error('Failed to save error report', { error: saveError.message });
        }
    }

    /**
     * Sanitize environment variables (remove sensitive data)
     */
    sanitizeEnv(env) {
        const sensitiveKeys = ['password', 'secret', 'key', 'token', 'auth'];
        const sanitized = {};
        
        Object.keys(env).forEach(key => {
            const lowerKey = key.toLowerCase();
            const isSensitive = sensitiveKeys.some(sensitive => lowerKey.includes(sensitive));
            sanitized[key] = isSensitive ? '[REDACTED]' : env[key];
        });
        
        return sanitized;
    }

    /**
     * Create error middleware for Express
     */
    createExpressErrorMiddleware() {
        return (error, req, res, next) => {
            const errorInfo = this.logError(error, {
                service: 'express',
                url: req.url,
                method: req.method,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                body: req.body,
                params: req.params,
                query: req.query
            });

            const status = error.status || error.statusCode || 500;
            const message = status === 500 ? 'Internal Server Error' : error.message;

            res.status(status).json({
                error: message,
                timestamp: errorInfo.timestamp,
                requestId: errorInfo.requestId || req.id
            });
        };
    }

    /**
     * Create async error wrapper
     */
    asyncWrapper(fn) {
        return (req, res, next) => {
            Promise.resolve(fn(req, res, next)).catch(next);
        };
    }

    /**
     * Create service error wrapper
     */
    serviceWrapper(serviceName, fn) {
        return async (...args) => {
            try {
                return await fn(...args);
            } catch (error) {
                this.logError(error, { service: serviceName });
                throw error;
            }
        };
    }

    /**
     * Monitor system health
     */
    getSystemHealth() {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        return {
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: {
                rss: this.formatBytes(memUsage.rss),
                heapTotal: this.formatBytes(memUsage.heapTotal),
                heapUsed: this.formatBytes(memUsage.heapUsed),
                external: this.formatBytes(memUsage.external),
                arrayBuffers: this.formatBytes(memUsage.arrayBuffers)
            },
            cpu: {
                user: cpuUsage.user,
                system: cpuUsage.system
            },
            pid: process.pid,
            version: process.version,
            platform: process.platform,
            arch: process.arch,
            errorStats: this.getErrorStats()
        };
    }

    /**
     * Format bytes to human readable
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Clean up old log files
     */
    async cleanupLogs(maxAge = 30) {
        try {
            const logsDir = 'logs';
            const cutoffDate = moment().subtract(maxAge, 'days');
            
            if (await fs.pathExists(logsDir)) {
                const files = await fs.readdir(logsDir);
                
                for (const file of files) {
                    const filePath = path.join(logsDir, file);
                    const stats = await fs.stat(filePath);
                    
                    if (moment(stats.mtime).isBefore(cutoffDate)) {
                        await fs.remove(filePath);
                        this.logger.info('Cleaned up old log file', { file: filePath });
                    }
                }
            }
        } catch (error) {
            this.logger.error('Failed to cleanup logs', { error: error.message });
        }
    }

    /**
     * Get logger instance
     */
    getLogger() {
        return this.logger;
    }
}

module.exports = ErrorHandler;