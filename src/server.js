// Load environment variables first
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const moment = require('moment');
const cron = require('node-cron');
const path = require('path');
const winston = require('winston');
const fs = require('fs-extra');
const EventEmitter = require('events');

// Import services
const ConfigManager = require('./config/configManager');
const VeeamApiClient = require('./services/veeamApiClient');
const DataCollectionService = require('./services/dataCollectionService');
const ReportingEngine = require('./services/reportingEngine');
const AlertingService = require('./services/alertingService');
const WhatsAppService = require('./services/whatsappService');
const HtmlReportService = require('./services/htmlReportService');
const SyslogService = require('./services/syslogService');

class VeeamBackendServer extends EventEmitter {
    constructor() {
        super();
        this.app = express();
        this.server = null;
        this.scheduledJobs = new Map();
        this.isShuttingDown = false;
        
        // Initialize services
        this.configManager = null;
        this.veeamClient = null;
        this.dataCollectionService = null;
        this.reportingEngine = null;
        this.alertingService = null;
        this.whatsappService = null;
        this.htmlReportService = null;
        this.syslogService = null;
        
        // Initialize logger
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json()
            ),
            transports: [
                new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
                new winston.transports.File({ filename: 'logs/combined.log' }),
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        winston.format.simple()
                    )
                })
            ]
        });
    }

    /**
     * Initialize the server and all services
     */
    async initialize() {
        try {
            this.logger.info('Initializing Veeam Backend Server...');
            
            // Ensure directories exist
            await fs.ensureDir('logs');
            await fs.ensureDir('data');
            await fs.ensureDir('config');
            
            // Initialize configuration manager
            this.configManager = new ConfigManager('./config');
            await this.configManager.initialize();
            
            // Initialize services
            await this.initializeServices();
            
            // Setup Express middleware
            this.setupMiddleware();
            
            // Setup routes
            this.setupRoutes();
            
            // Setup scheduled jobs
            this.setupScheduledJobs();
            
            // Setup graceful shutdown
            this.setupGracefulShutdown();
            
            this.logger.info('Server initialization completed successfully');
        } catch (error) {
            this.logger.error('Failed to initialize server', { error: error.message, stack: error.stack });
            throw error;
        }
    }

    /**
     * Initialize all services
     */
    async initializeServices() {
        const config = this.configManager.getAll();
        
        // Initialize Veeam API client
        this.veeamClient = new VeeamApiClient(config.veeam);
        
        // Initialize data collection service
        this.dataCollectionService = new DataCollectionService(this.veeamClient, config.monitoring.dataCollection);
        
        // Initialize WhatsApp service
        this.whatsappService = new WhatsAppService(config.whatsapp);
        
        // Initialize alerting service (without reporting engine initially)
        this.alertingService = new AlertingService(this.dataCollectionService, this.whatsappService, config.alerting);
        
        // Initialize reporting engine with alerting service
        this.reportingEngine = new ReportingEngine(this.dataCollectionService, config.reporting, this.alertingService);
        
        // Set reporting engine reference in alerting service to complete the connection
        this.alertingService.reportingEngine = this.reportingEngine;
        
        // Initialize HTML report service
        this.htmlReportService = new HtmlReportService();
        
        // Initialize Syslog service
        this.syslogService = new SyslogService(config.syslog || { port: 514, host: '0.0.0.0' });
        
        // Set up syslog event handlers
        this.syslogService.on('veeamEvent', (eventData) => {
            this.handleVeeamSyslogEvent(eventData);
        });
        
        this.syslogService.on('error', (error) => {
            this.logger.error('Syslog service error:', error);
        });
        
        this.logger.info('All services initialized successfully');
    }

    /**
     * Setup Express middleware
     */
    setupMiddleware() {
        const config = this.configManager.getAll();
        
        // Security middleware - disable HTTPS upgrade for HTTP-only environments
        this.app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    baseUri: ["'self'"],
                    fontSrc: ["'self'", "https:", "data:"],
                    formAction: ["'self'"],
                    frameAncestors: ["'self'"],
                    imgSrc: ["'self'", "data:"],
                    objectSrc: ["'none'"],
                    scriptSrc: ["'self'"],
                    scriptSrcAttr: ["'none'"],
                    styleSrc: ["'self'", "https:", "'unsafe-inline'"]
                    // Removed 'upgrade-insecure-requests' to allow HTTP access
                }
            }
        }));
        
        // CORS
        if (config.server.cors.enabled) {
            this.app.use(cors({
                origin: config.server.cors.origin
            }));
        }
        
        // Rate limiting
        if (config.server.rateLimit.enabled) {
            const limiter = rateLimit({
                windowMs: config.server.rateLimit.windowMs,
                max: config.server.rateLimit.max,
                message: 'Too many requests from this IP, please try again later.'
            });
            this.app.use('/api/', limiter);
        }
        
        // Body parsing
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true }));
        
        // Serve static files for reports
        this.app.use('/reports', express.static(path.join(__dirname, '../reports')));
        
        // Request logging
        this.app.use((req, res, next) => {
            this.logger.info('HTTP Request', {
                method: req.method,
                url: req.url,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
            next();
        });
    }

    /**
     * Setup API routes
     */
    setupRoutes() {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                version: require('../package.json').version
            });
        });

        // Configuration UI
        this.app.get('/config', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'config.html'));
        });

        // Favicon
        this.app.get('/favicon.ico', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
        });

        // Serve config.js
        this.app.get('/config.js', (req, res) => {
            res.setHeader('Content-Type', 'application/javascript');
            res.sendFile(path.join(__dirname, 'public', 'config.js'));
        });

        // API routes
        this.app.use('/api', this.createApiRoutes());
        
        // Error handling middleware
        this.app.use(this.errorHandler.bind(this));
        
        // 404 handler
        this.app.use('*', (req, res) => {
            res.status(404).json({ error: 'Route not found' });
        });
    }

    /**
     * Create API routes
     */
    createApiRoutes() {
        const router = express.Router();

        // Configuration routes
        router.get('/config', async (req, res, next) => {
            try {
                const config = this.configManager.getAll();
                // Remove sensitive information
                const safeConfig = { ...config };
                delete safeConfig.veeam.password;
                // Keep webhookUrl for configuration interface but mask it partially for security
                if (safeConfig.whatsapp && safeConfig.whatsapp.webhookUrl) {
                    // Keep the webhookUrl for the config interface
                    // Note: This is needed for the configuration form to work properly
                }
                res.json(safeConfig);
            } catch (error) {
                next(error);
            }
        });

        router.put('/config/:section', async (req, res, next) => {
            try {
                await this.configManager.updateSection(req.params.section, req.body);
                res.json({ message: 'Configuration updated successfully' });
            } catch (error) {
                next(error);
            }
        });

        // Syslog monitoring routes
        router.get('/syslog/status', async (req, res, next) => {
            try {
                const stats = this.syslogService.getStats();
                res.json({
                    ...stats,
                    isListening: this.syslogService.isListening(),
                    port: this.syslogService.port,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                next(error);
            }
        });

        // Reporting routes
        router.get('/reports/daily', async (req, res, next) => {
            try {
                const report = await this.reportingEngine.generateDailyReport();
                res.json(report);
            } catch (error) {
                this.logger.warn('Failed to generate daily report:', error.message);
                res.status(503).json({
                    error: 'Report generation failed',
                    message: 'Unable to generate report due to external service unavailability',
                    fallbackData: {
                        timestamp: new Date().toISOString(),
                        status: 'Service Unavailable',
                        message: 'Veeam server connection failed'
                    }
                });
            }
        });

        router.post('/reports/send', async (req, res, next) => {
            try {
                const report = await this.reportingEngine.generateDailyReport();
                const options = {
                    format: req.body.format || 'text',
                    includeImage: req.body.includeImage || false,
                    width: req.body.width || 1200,
                    height: req.body.height || 1600
                };
                
                const success = await this.whatsappService.sendDailyReport(report, options);
                res.json({ success, message: success ? 'Report sent successfully' : 'Failed to send report' });
            } catch (error) {
                this.logger.warn('Failed to send report:', error.message);
                res.status(503).json({
                    success: false,
                    error: 'Report sending failed',
                    message: 'Unable to send report due to service unavailability',
                    timestamp: new Date().toISOString()
                });
            }
        });

        router.post('/reports/send-image', async (req, res, next) => {
            try {
                const report = await this.reportingEngine.generateDailyReport();
                const options = {
                    width: req.body.width || 1200,
                    height: req.body.height || 1600
                };
                
                const success = await this.whatsappService.sendDailyReportWithImage(report, options);
                
                if (success) {
                    res.json({ success: true, message: 'Report image sent successfully' });
                } else {
                    res.status(500).json({ success: false, message: 'Failed to send report image' });
                }
            } catch (error) {
                this.logger.warn('Failed to send report image:', error.message);
                res.status(503).json({
                    success: false,
                    error: 'Report image sending failed',
                    message: 'Unable to send report image due to service unavailability'
                });
            }
        });

        router.post('/reports/generate-image', async (req, res, next) => {
            try {
                const report = await this.reportingEngine.generateDailyReport();
                const options = {
                    width: req.body.width || 1200,
                    height: req.body.height || 1600
                };
                
                const imageResult = await this.htmlReportService.captureReportImage(report, options);
                
                if (imageResult.success) {
                    res.json({
                        success: true,
                        message: 'Report image generated successfully',
                        filename: imageResult.filename,
                        url: imageResult.url
                    });
                } else {
                    res.status(500).json({ success: false, message: 'Failed to generate report image' });
                }
            } catch (error) {
                this.logger.warn('Failed to generate report image:', error.message);
                res.status(503).json({
                    success: false,
                    error: 'Report image generation failed',
                    message: 'Unable to generate report image due to service unavailability'
                });
            }
        });

        router.get('/reports/quick-status', async (req, res, next) => {
            try {
                const status = await this.reportingEngine.generateQuickStatus();
                res.json(status);
            } catch (error) {
                next(error);
            }
        });

        router.get('/reports/html', async (req, res, next) => {
            try {
                const report = await this.reportingEngine.generateDailyReport();
                const htmlContent = await this.htmlReportService.generateReport(report);
                res.setHeader('Content-Type', 'text/html');
                res.send(htmlContent);
            } catch (error) {
                this.logger.warn('Failed to generate HTML report:', error.message);
                res.status(503).send('<html><body><h1>Report Generation Failed</h1><p>Unable to generate report due to service unavailability</p></body></html>');
            }
        });

        router.get('/reports/download', async (req, res, next) => {
            try {
                const report = await this.reportingEngine.generateDailyReport();
                const filePath = await this.htmlReportService.saveHtmlReport(report);
                res.download(filePath, `veeam-report-${moment().format('YYYY-MM-DD')}.html`);
            } catch (error) {
                this.logger.warn('Failed to generate downloadable report:', error.message);
                res.status(503).json({
                    error: 'Report download failed',
                    message: 'Unable to generate downloadable report due to service unavailability'
                });
            }
        });

        // Alerting routes
        router.get('/alerts', async (req, res, next) => {
            try {
                const alerts = await this.alertingService.getActiveAlerts();
                res.json(alerts);
            } catch (error) {
                next(error);
            }
        });

        router.post('/alerts/:alertId/acknowledge', async (req, res, next) => {
            try {
                const { alertId } = req.params;
                const { acknowledgedBy = 'API User' } = req.body;
                
                await this.alertingService.acknowledgeAlert(alertId, acknowledgedBy);
                await this.whatsappService.sendAcknowledgment(alertId, acknowledgedBy);
                
                res.json({ message: 'Alert acknowledged successfully' });
            } catch (error) {
                next(error);
            }
        });

        router.post('/alerts/acknowledge-all', async (req, res, next) => {
            try {
                const { acknowledgedBy = 'API User' } = req.body;
                
                const result = await this.alertingService.acknowledgeAllAlerts(acknowledgedBy);
                
                // Send bulk acknowledgment notification via WhatsApp
                if (result.count > 0) {
                    await this.whatsappService.sendBulkAcknowledgment(result.count, acknowledgedBy);
                }
                
                res.json({
                    message: `Successfully acknowledged ${result.count} alerts`,
                    ...result
                });
            } catch (error) {
                next(error);
            }
        });

        router.get('/alerts/stats', async (req, res, next) => {
            try {
                const stats = await this.alertingService.getAlertStats();
                res.json(stats);
            } catch (error) {
                this.logger.warn('Failed to get alert statistics:', error.message);
                res.status(503).json({
                    error: 'Alert statistics unavailable',
                    message: 'Unable to retrieve alert statistics due to external service unavailability',
                    fallbackData: {
                        totalAlerts: 0,
                        activeAlerts: 0,
                        criticalAlerts: 0,
                        warningAlerts: 0,
                        timestamp: new Date().toISOString(),
                        status: 'Service Unavailable'
                    }
                });
            }
        });

        // Test endpoint for creating test alerts
        router.post('/alerts/test', async (req, res, next) => {
            try {
                const { type = 'test', severity = 'info', title, description } = req.body;
                
                const testAlert = this.alertingService.createAlert(
                    type,
                    severity,
                    title || `Test Alert - ${new Date().toLocaleTimeString()}`,
                    description || `This is a test alert created at ${new Date().toISOString()} to verify the alert system is working correctly.`,
                    {
                        testAlert: true,
                        createdBy: 'API Test',
                        timestamp: new Date().toISOString()
                    }
                );
                
                // Immediately send the test alert
                await this.alertingService.sendAlertNotification(testAlert);
                
                res.json({ 
                    message: 'Test alert created and sent successfully',
                    alert: testAlert
                });
            } catch (error) {
                next(error);
            }
        });

        // Test endpoint for triggering monitoring execution
        router.post('/monitoring/trigger', async (req, res, next) => {
            try {
                this.logger.info('Manual monitoring execution triggered via API');
                await this.executeMonitoring();
                
                res.json({ 
                    message: 'Monitoring execution completed successfully',
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                this.logger.error('Manual monitoring execution failed:', error.message);
                next(error);
            }
        });

        // Syslog service endpoints
        router.post('/syslog/start', async (req, res, next) => {
            try {
                if (this.syslogService.isRunning) {
                    return res.json({ 
                        message: 'Syslog service is already running',
                        stats: this.syslogService.getStats()
                    });
                }
                
                await this.syslogService.start();
                this.logger.info('Syslog service started via API');
                
                res.json({ 
                    message: 'Syslog service started successfully',
                    stats: this.syslogService.getStats()
                });
            } catch (error) {
                this.logger.error('Failed to start syslog service:', error.message);
                next(error);
            }
        });

        router.post('/syslog/stop', async (req, res, next) => {
            try {
                if (!this.syslogService.isRunning) {
                    return res.json({ 
                        message: 'Syslog service is not running',
                        stats: this.syslogService.getStats()
                    });
                }
                
                await this.syslogService.stop();
                this.logger.info('Syslog service stopped via API');
                
                res.json({ 
                    message: 'Syslog service stopped successfully',
                    stats: this.syslogService.getStats()
                });
            } catch (error) {
                this.logger.error('Failed to stop syslog service:', error.message);
                next(error);
            }
        });

        router.get('/syslog/status', (req, res) => {
            const stats = this.syslogService.getStats();
            res.json({
                status: stats.isRunning ? 'running' : 'stopped',
                stats
            });
        });

        // Data collection routes
        router.get('/data/jobs', async (req, res, next) => {
            try {
                const jobs = await this.dataCollectionService.getJobs();
                res.json(jobs);
            } catch (error) {
                this.logger.warn('Failed to fetch jobs data:', error.message);
                res.status(503).json({
                    error: 'Service temporarily unavailable',
                    message: 'Unable to connect to Veeam server',
                    data: [],
                    timestamp: new Date().toISOString()
                });
            }
        });

        router.get('/data/repositories', async (req, res, next) => {
            try {
                const repositories = await this.dataCollectionService.getRepositories();
                res.json(repositories);
            } catch (error) {
                this.logger.warn('Failed to fetch repositories data:', error.message);
                res.status(503).json({
                    error: 'Service temporarily unavailable',
                    message: 'Unable to connect to Veeam server',
                    data: [],
                    timestamp: new Date().toISOString()
                });
            }
        });

        router.get('/data/sessions', async (req, res, next) => {
            try {
                const { limit = 100 } = req.query;
                const sessions = await this.dataCollectionService.getRecentSessions(parseInt(limit));
                res.json(sessions);
            } catch (error) {
                this.logger.warn('Failed to fetch sessions data:', error.message);
                res.status(503).json({
                    error: 'Service temporarily unavailable',
                    message: 'Unable to connect to Veeam server',
                    data: [],
                    timestamp: new Date().toISOString()
                });
            }
        });

        // Schedule management routes - Full CRUD operations
        router.get('/schedules', async (req, res, next) => {
            try {
                const schedules = this.configManager.get('reporting.schedules') || [];
                res.json(schedules);
            } catch (error) {
                next(error);
            }
        });

        router.get('/schedules/:name', async (req, res, next) => {
            try {
                const scheduleName = decodeURIComponent(req.params.name);
                const schedules = this.configManager.get('reporting.schedules') || [];
                const schedule = schedules.find(s => s.name === scheduleName);
                if (!schedule) {
                    return res.status(404).json({ error: 'Schedule not found' });
                }
                res.json(schedule);
            } catch (error) {
                next(error);
            }
        });

        router.get('/schedule/status', async (req, res, next) => {
            try {
                const schedules = this.configManager.get('reporting.schedules');
                const status = {
                    totalSchedules: schedules ? schedules.length : 0,
                    activeSchedules: schedules ? schedules.filter(s => s.enabled !== false).length : 0,
                    nextExecution: this.getNextScheduleExecution(schedules),
                    lastExecution: this.getLastScheduleExecution(),
                    schedulerStatus: 'running'
                };
                res.json(status);
            } catch (error) {
                next(error);
            }
        });

        router.post('/schedules', async (req, res, next) => {
            try {
                // Validate required fields
                const { name, cronExpression, type = 'custom' } = req.body;
                if (!name || !cronExpression) {
                    return res.status(400).json({ 
                        error: 'Missing required fields: name and cronExpression are required' 
                    });
                }

                // Check if schedule name already exists
                const schedules = this.configManager.get('reporting.schedules') || [];
                if (schedules.find(s => s.name === name)) {
                    return res.status(409).json({ 
                        error: 'Schedule with this name already exists' 
                    });
                }

                // Validate cron expression format
                const cronRegex = /^(\*|([0-5]?\d)) (\*|([01]?\d|2[0-3])) (\*|([0-2]?\d|3[01])) (\*|([0]?\d|1[0-2])) (\*|([0-6]))$/;
                if (!cronRegex.test(cronExpression)) {
                    return res.status(400).json({ 
                        error: 'Invalid cron expression format' 
                    });
                }

                const newSchedule = {
                    name,
                    cronExpression,
                    enabled: req.body.enabled !== false,
                    type,
                    includeCharts: req.body.includeCharts || false,
                    sendAsImage: req.body.sendAsImage || false,
                    recipients: req.body.recipients || []
                };

                await this.configManager.addSchedule(newSchedule);
                this.setupScheduledJobs(); // Refresh scheduled jobs
                res.status(201).json({ 
                    message: 'Schedule created successfully',
                    schedule: newSchedule
                });
            } catch (error) {
                next(error);
            }
        });

        router.put('/schedules/:name', async (req, res, next) => {
            try {
                const { name } = req.params;
                const schedules = this.configManager.get('reporting.schedules') || [];
                const scheduleIndex = schedules.findIndex(s => s.name === name);
                
                if (scheduleIndex === -1) {
                    return res.status(404).json({ error: 'Schedule not found' });
                }

                // Validate cron expression if provided
                if (req.body.cronExpression) {
                    const cronRegex = /^(\*|([0-5]?\d)) (\*|([01]?\d|2[0-3])) (\*|([0-2]?\d|3[01])) (\*|([0]?\d|1[0-2])) (\*|([0-6]))$/;
                    if (!cronRegex.test(req.body.cronExpression)) {
                        return res.status(400).json({ 
                            error: 'Invalid cron expression format' 
                        });
                    }
                }

                // Update schedule with provided fields
                const updatedSchedule = {
                    ...schedules[scheduleIndex],
                    ...req.body,
                    name // Ensure name doesn't change
                };

                schedules[scheduleIndex] = updatedSchedule;
                this.configManager.set('reporting.schedules', schedules);
                await this.configManager.saveConfig();
                this.setupScheduledJobs(); // Refresh scheduled jobs
                
                res.json({ 
                    message: 'Schedule updated successfully',
                    schedule: updatedSchedule
                });
            } catch (error) {
                next(error);
            }
        });

        router.delete('/schedules/:name', async (req, res, next) => {
            try {
                const { name } = req.params;
                const decodedName = decodeURIComponent(name);
                const schedules = this.configManager.get('reporting.schedules') || [];
                const scheduleExists = schedules.find(s => s.name === decodedName);
                
                if (!scheduleExists) {
                    return res.status(404).json({ error: 'Schedule not found' });
                }

                await this.configManager.removeSchedule(decodedName);
                this.setupScheduledJobs(); // Refresh scheduled jobs
                res.json({ 
                    message: 'Schedule deleted successfully',
                    deletedSchedule: name
                });
            } catch (error) {
                next(error);
            }
        });

        // Test routes
        router.post('/test/whatsapp', async (req, res, next) => {
            try {
                const success = await this.whatsappService.testConnection();
                res.json({ success, message: success ? 'WhatsApp test successful' : 'WhatsApp test failed' });
            } catch (error) {
                next(error);
            }
        });

        router.post('/test/veeam', async (req, res, next) => {
            try {
                const token = await this.veeamClient.getAccessToken();
                res.json({ success: !!token, message: token ? 'Veeam connection successful' : 'Veeam connection failed' });
            } catch (error) {
                next(error);
            }
        });

        // API Health Check - Veeam API status
        router.get('/health/veeam', async (req, res, next) => {
            try {
                const health = await this.veeamClient.checkApiHealth();
                res.json({
                    veeamApi: health,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                res.json({
                    veeamApi: {
                        status: 'error',
                        error: 'HEALTH_CHECK_FAILED',
                        message: error.message,
                        timestamp: new Date().toISOString()
                    },
                    timestamp: new Date().toISOString()
                });
            }
        });

        return router;
    }

    /**
     * Setup scheduled jobs
     */
    setupScheduledJobs() {
        // Clear existing jobs
        this.scheduledJobs.forEach(job => {
            if (job && typeof job.stop === 'function') {
                job.stop();
            }
        });
        this.scheduledJobs.clear();

        const schedules = this.configManager.get('reporting.schedules') || [];
        const timezone = this.configManager.get('reporting.timezone') || 'UTC';

        schedules.forEach(schedule => {
            if (schedule.enabled) {
                try {
                    const job = cron.schedule(schedule.cronExpression, async () => {
                        await this.executeScheduledReport(schedule);
                    }, {
                        scheduled: true,
                        timezone: timezone
                    });

                    this.scheduledJobs.set(schedule.name, job);
                    this.logger.info('Scheduled job created', {
                        name: schedule.name,
                        cronExpression: schedule.cronExpression,
                        timezone: timezone
                    });
                } catch (error) {
                    this.logger.error('Failed to create scheduled job', {
                        name: schedule.name,
                        error: error.message
                    });
                }
            }
        });

        // Setup monitoring job
        const monitoringInterval = this.configManager.get('monitoring.dataCollection.interval') || 300000;
        const monitoringJob = setInterval(async () => {
            await this.executeMonitoring();
        }, monitoringInterval);

        this.scheduledJobs.set('monitoring', { destroy: () => clearInterval(monitoringJob) });
        
        this.logger.info(`Setup ${this.scheduledJobs.size} scheduled jobs`);
    }

    /**
     * Execute scheduled report
     */
    async executeScheduledReport(schedule) {
        try {
            this.logger.info('Executing scheduled report', { name: schedule.name });
            
            const report = await this.reportingEngine.generateDailyReport();
            
            // Check if schedule is configured to send as image
            let success;
            if (schedule.sendAsImage) {
                this.logger.info('Sending report as image', { name: schedule.name });
                success = await this.whatsappService.sendDailyReportWithImage(report);
            } else {
                success = await this.whatsappService.sendDailyReport(report);
            }
            
            this.logger.info('Scheduled report completed', {
                name: schedule.name,
                success: success,
                sentAsImage: schedule.sendAsImage || false
            });
        } catch (error) {
            this.logger.error('Scheduled report failed', {
                name: schedule.name,
                error: error.message
            });
        }
    }

    /**
     * Execute monitoring and alerting
     */
    async executeMonitoring() {
        try {
            // Collect fresh data
            const data = await this.dataCollectionService.collectAllData();
            
            // Check for alerts
            await this.alertingService.runAlertChecks();
            
            // Send pending notifications
            await this.alertingService.sendPendingAlerts();
            
        } catch (error) {
            this.logger.error('Monitoring execution failed', { error: error.message });
        }
    }

    /**
     * Handle Veeam events received via syslog
     */
    async handleVeeamSyslogEvent(eventData) {
        try {
            this.logger.info('Received Veeam syslog event:', {
                timestamp: eventData.timestamp,
                hostname: eventData.hostname,
                severity: eventData.severity,
                message: eventData.message
            });

            // Extract Veeam-specific data
            const veeamData = this.syslogService.extractVeeamData(eventData);
            
            // Debug logging - Full raw syslog message received from Veeam
            this.logger.info('Full raw syslog message from Veeam:', {
                rawMessage: eventData.raw,
                parsedData: {
                    facility: eventData.facility,
                    severity: eventData.severity,
                    timestamp: eventData.timestamp,
                    hostname: eventData.hostname,
                    appName: eventData.appName,
                    procId: eventData.procId,
                    msgId: eventData.msgId,
                    structuredData: eventData.structuredData,
                    message: eventData.message
                }
            });
            
            // Debug logging to see what data is extracted
            this.logger.info('Extracted Veeam data:', {
                description: veeamData.description,
                Description: veeamData.Description,
                message: veeamData.message,
                jobName: veeamData.jobName,
                JobID: veeamData.JobID,
                JobSessionID: veeamData.JobSessionID
            });
            
            // Process the event based on severity and content
            const severityThreshold = parseInt(this.configManager.get('syslog.severityThreshold')) || 3;
            if (eventData.severity <= severityThreshold) { // Check against configured threshold
                
                // Create a meaningful alert title and message based on extracted data
                let alertTitle = 'Veeam System Event';
                let message = veeamData.Description || veeamData.description || veeamData.eventMessage || veeamData.message || eventData.message || '';
                
                // Create more specific titles based on content
                if (message.toLowerCase().includes('backup job')) {
                    alertTitle = 'Veeam Backup Job Event';
                } else if (message.toLowerCase().includes('session')) {
                    alertTitle = 'Veeam Session Event';
                } else if (message.toLowerCase().includes('repository')) {
                    alertTitle = 'Veeam Repository Event';
                } else if (veeamData.JobID) {
                    alertTitle = `Veeam Job Event (ID: ${veeamData.JobID})`;
                }
                
                // If we have a job name, include it in the title
                if (veeamData.jobName) {
                    alertTitle = `Veeam Job: ${veeamData.jobName}`;
                }
                
                // Map syslog severity to alert severity
                // Syslog severity: 0=Emergency, 1=Alert, 2=Critical, 3=Error, 4=Warning, 5=Notice, 6=Info, 7=Debug
                let alertSeverity;
                if (eventData.severity <= 2) {
                    alertSeverity = 'critical';  // Emergency, Alert, Critical
                } else if (eventData.severity <= 4) {
                    alertSeverity = 'warning';   // Error, Warning
                } else {
                    alertSeverity = 'info';      // Notice, Info, Debug
                }
                
                // Create an alert for events meeting the threshold
                const alert = this.alertingService.createAlert(
                    'syslog_event',
                    alertSeverity,
                    alertTitle,
                    message,
                    {
                        source: 'syslog',
                        hostname: eventData.hostname,
                        timestamp: eventData.timestamp,
                        jobId: veeamData.JobID,
                        sessionId: veeamData.JobSessionID,
                        severity: eventData.severity,
                        raw: eventData.raw
                    }
                );
                
                this.logger.info('Created syslog alert:', {
                    alertId: alert.id,
                    title: alertTitle,
                    severity: eventData.severity,
                    message: message.substring(0, 100) + (message.length > 100 ? '...' : '')
                });
                
                // Send the alert notification immediately
                await this.alertingService.sendAlertNotification(alert);
            }
            
            // Emit event for other services that might be interested
            this.emit('veeamSyslogEvent', veeamData);
            
        } catch (error) {
            this.logger.error('Error handling Veeam syslog event:', error);
        }
    }

    /**
     * Get next scheduled execution time
     */
    getNextScheduleExecution(schedules) {
        if (!schedules || schedules.length === 0) {
            return null;
        }

        const now = new Date();
        let nextExecution = null;

        schedules.forEach(schedule => {
            if (schedule.enabled === false) return;
            
            try {
                // Parse cron expression to find next execution
                const cronParts = schedule.cronExpression.split(' ');
                if (cronParts.length >= 5) {
                    // Simple next execution calculation (can be enhanced with a proper cron parser)
                    const next = new Date(now);
                    next.setHours(parseInt(cronParts[1]) || 0);
                    next.setMinutes(parseInt(cronParts[0]) || 0);
                    next.setSeconds(0);
                    
                    if (next <= now) {
                        next.setDate(next.getDate() + 1);
                    }
                    
                    if (!nextExecution || next < nextExecution) {
                        nextExecution = next;
                    }
                }
            } catch (error) {
                this.logger.warn(`Failed to parse schedule cron: ${schedule.cronExpression}`);
            }
        });

        return nextExecution ? nextExecution.toISOString() : null;
    }

    /**
     * Get last scheduled execution time
     */
    getLastScheduleExecution() {
        // This would typically come from a database or log file
        // For now, return a placeholder based on current time
        const lastRun = new Date();
        lastRun.setHours(lastRun.getHours() - 1); // Assume last run was 1 hour ago
        return lastRun.toISOString();
    }

    /**
     * Error handling middleware
     */
    errorHandler(error, req, res, next) {
        this.logger.error('API Error', {
            error: error.message,
            stack: error.stack,
            url: req.url,
            method: req.method
        });

        const status = error.status || 500;
        const message = status === 500 ? 'Internal Server Error' : error.message;

        res.status(status).json({
            error: message,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Setup graceful shutdown
     */
    setupGracefulShutdown() {
        const shutdown = async (signal) => {
            if (this.isShuttingDown) return;
            this.isShuttingDown = true;
            
            this.logger.info(`Received ${signal}, starting graceful shutdown...`);
            
            // Stop accepting new requests
            if (this.server) {
                this.server.close(() => {
                    this.logger.info('HTTP server closed');
                });
            }
            
            // Stop scheduled jobs
            this.scheduledJobs.forEach((job, name) => {
                try {
                    if (typeof job.destroy === 'function') {
                        job.destroy();
                    } else if (typeof job.stop === 'function') {
                        job.stop();
                    } else {
                        this.logger.warn(`Job ${name} does not have destroy or stop method`);
                    }
                } catch (error) {
                    this.logger.error(`Error stopping job ${name}:`, error.message);
                }
            });
            this.scheduledJobs.clear();
            
            this.logger.info('Graceful shutdown completed');
            process.exit(0);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
    }

    /**
     * Start the server
     */
    async start() {
        try {
            await this.initialize();
            
            const config = this.configManager.getAll();
            const port = config.server.port;
            const host = config.server.host;
            
            this.server = this.app.listen(port, host, async () => {
                this.logger.info(`Veeam Backend Server started on ${host}:${port}`);
                
                // Start syslog service
                try {
                    await this.syslogService.start();
                    this.logger.info('Syslog service started automatically');
                } catch (error) {
                    this.logger.warn('Failed to start syslog service automatically:', error.message);
                }
                
                this.logger.info('Server is ready to accept requests');
            });
            
            return this.server;
        } catch (error) {
            this.logger.error('Failed to start server', { error: error.message });
            throw error;
        }
    }
}

// Create and export server instance
const server = new VeeamBackendServer();

// Start server if this file is run directly
if (require.main === module) {
    server.start().catch(error => {
        console.error('Failed to start server:', error);
        process.exit(1);
    });
}

module.exports = server;