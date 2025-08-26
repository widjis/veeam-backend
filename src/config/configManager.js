const fs = require('fs-extra');
const path = require('path');
const winston = require('winston');
const Joi = require('joi');

class ConfigManager {
    constructor(configPath = './config') {
        this.configPath = path.resolve(configPath);
        this.configFile = path.join(this.configPath, 'config.json');
        this.defaultConfigFile = path.join(this.configPath, 'default-config.json');
        
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.File({ filename: 'logs/config.log' }),
                new winston.transports.Console()
            ]
        });

        this.config = null;
        this.watchers = new Map();
        
        // Configuration schema validation
        this.configSchema = Joi.object({
            veeam: Joi.object({
                baseUrl: Joi.string().uri().required(),
                username: Joi.string().required(),
                password: Joi.string().required(),
                tokenPath: Joi.string().default('./tokens'),
                apiTimeout: Joi.number().default(30000),
                maxRetries: Joi.number().default(3)
            }).required(),
            
            whatsapp: Joi.object({
                webhookUrl: Joi.string().uri().required(),
                chatId: Joi.string().required(),
                retryAttempts: Joi.number().default(3),
                retryDelay: Joi.number().default(1000)
            }).required(),
            
            reporting: Joi.object({
                schedules: Joi.array().items(
                    Joi.object({
                        name: Joi.string().required(),
                        cronExpression: Joi.string().required(),
                        enabled: Joi.boolean().default(true),
                        type: Joi.string().valid('daily', 'weekly', 'monthly', 'custom').required(),
                        includeCharts: Joi.boolean().default(false),
                        sendAsImage: Joi.boolean().default(false),
                        recipients: Joi.array().items(Joi.string()).default([])
                    })
                ).default([]),
                
                defaultSchedule: Joi.object({
                    daily: Joi.string().default('0 8 * * *'), // 8 AM daily
                    weekly: Joi.string().default('0 8 * * 1'), // 8 AM Monday
                    monthly: Joi.string().default('0 8 1 * *') // 8 AM 1st of month
                }).default({}),
                
                timezone: Joi.string().default('UTC'),
                maxReportSize: Joi.number().default(4096), // WhatsApp message limit
                includeHealthScore: Joi.boolean().default(true),
                includeStorageAnalytics: Joi.boolean().default(true),
                includePerformanceTrends: Joi.boolean().default(true)
            }).required(),
            
            alerting: Joi.object({
                enabled: Joi.boolean().default(true),
                
                thresholds: Joi.object({
                    repositoryUsage: Joi.object({
                        warning: Joi.number().default(70),
                        critical: Joi.number().default(85)
                    }).default({}),
                    
                    healthScore: Joi.object({
                        warning: Joi.number().default(70),
                        critical: Joi.number().default(50)
                    }).default({}),
                    
                    jobDuration: Joi.object({
                        warning: Joi.number().default(4), // hours
                        critical: Joi.number().default(8) // hours
                    }).default({}),
                    
                    failureCount: Joi.object({
                        warning: Joi.number().default(3),
                        critical: Joi.number().default(5)
                    }).default({})
                }).default({}),
                
                retrySettings: Joi.object({
                    maxRetries: Joi.number().default(5),
                    retryInterval: Joi.number().default(300000), // 5 minutes
                    escalationInterval: Joi.number().default(1800000), // 30 minutes
                    maxEscalations: Joi.number().default(3)
                }).default({}),
                
                alertTypes: Joi.object({
                    jobFailure: Joi.boolean().default(true),
                    jobStarted: Joi.boolean().default(false),
                    jobCompleted: Joi.boolean().default(false),
                    repositoryFull: Joi.boolean().default(true),
                    systemHealth: Joi.boolean().default(true),
                    longRunningJob: Joi.boolean().default(true),
                    infrastructureIssue: Joi.boolean().default(true)
                }).default({}),
                
                quietHours: Joi.object({
                    enabled: Joi.boolean().default(false),
                    start: Joi.string().default('22:00'),
                    end: Joi.string().default('06:00'),
                    timezone: Joi.string().default('UTC'),
                    allowCritical: Joi.boolean().default(true)
                }).default({})
            }).required(),
            
            monitoring: Joi.object({
                dataCollection: Joi.object({
                    interval: Joi.number().default(300000), // 5 minutes
                    batchSize: Joi.number().default(100),
                    cacheTimeout: Joi.number().default(300000), // 5 minutes
                    enableCaching: Joi.boolean().default(true)
                }).default({}),
                
                healthCheck: Joi.object({
                    interval: Joi.number().default(60000), // 1 minute
                    timeout: Joi.number().default(30000), // 30 seconds
                    retries: Joi.number().default(3)
                }).default({})
            }).required(),
            
            logging: Joi.object({
                level: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
                maxFiles: Joi.number().default(10),
                maxSize: Joi.string().default('10m'),
                enableConsole: Joi.boolean().default(true),
                enableFile: Joi.boolean().default(true)
            }).default({}),
            
            server: Joi.object({
                port: Joi.number().default(3000),
                host: Joi.string().default('localhost'),
                cors: Joi.object({
                    enabled: Joi.boolean().default(true),
                    origin: Joi.alternatives().try(
                        Joi.string(),
                        Joi.array().items(Joi.string()),
                        Joi.boolean()
                    ).default('*')
                }).default({}),
                rateLimit: Joi.object({
                    enabled: Joi.boolean().default(true),
                    windowMs: Joi.number().default(900000), // 15 minutes
                    max: Joi.number().default(100) // requests per window
                }).default({})
            }).default({})
        });
    }

    /**
     * Initialize configuration manager
     */
    async initialize() {
        try {
            await fs.ensureDir(this.configPath);
            await this.createDefaultConfig();
            await this.loadConfig();
            this.logger.info('Configuration manager initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize configuration manager', { error: error.message });
            throw error;
        }
    }

    /**
     * Create default configuration file if it doesn't exist
     */
    async createDefaultConfig() {
        const defaultConfig = {
            veeam: {
                baseUrl: process.env.VEEAM_BASE_URL || 'https://your-veeam-server:9419/api/v1',
                username: process.env.VEEAM_USERNAME || '',
                password: process.env.VEEAM_PASSWORD || '',
                tokenPath: './tokens',
                apiTimeout: 30000,
                maxRetries: 3
            },
            whatsapp: {
                webhookUrl: process.env.WHATSAPP_WEBHOOK_URL || '',
                chatId: process.env.WHATSAPP_CHAT_ID || '',
                retryAttempts: 3,
                retryDelay: 1000
            },
            reporting: {
                schedules: [
                    {
                        name: 'Daily Report',
                        cronExpression: '0 8 * * *',
                        enabled: true,
                        type: 'daily',
                        includeCharts: false,
                        recipients: []
                    }
                ],
                defaultSchedule: {
                    daily: '0 8 * * *',
                    weekly: '0 8 * * 1',
                    monthly: '0 8 1 * *'
                },
                timezone: 'UTC',
                maxReportSize: 4096,
                includeHealthScore: true,
                includeStorageAnalytics: true,
                includePerformanceTrends: true
            },
            alerting: {
                enabled: true,
                thresholds: {
                    repositoryUsage: { warning: 70, critical: 85 },
                    healthScore: { warning: 70, critical: 50 },
                    jobDuration: { warning: 4, critical: 8 },
                    failureCount: { warning: 3, critical: 5 }
                },
                retrySettings: {
                    maxRetries: 5,
                    retryInterval: 300000,
                    escalationInterval: 1800000,
                    maxEscalations: 3
                },
                alertTypes: {
                    jobFailure: true,
                    jobStarted: false,
                    jobCompleted: false,
                    repositoryFull: true,
                    systemHealth: true,
                    longRunningJob: true,
                    infrastructureIssue: true
                },
                quietHours: {
                    enabled: false,
                    start: '22:00',
                    end: '06:00',
                    timezone: 'UTC',
                    allowCritical: true
                }
            },
            monitoring: {
                dataCollection: {
                    interval: 300000,
                    batchSize: 100,
                    cacheTimeout: 300000,
                    enableCaching: true
                },
                healthCheck: {
                    interval: 60000,
                    timeout: 30000,
                    retries: 3
                }
            },
            logging: {
                level: 'info',
                maxFiles: 10,
                maxSize: '10m',
                enableConsole: true,
                enableFile: true
            },
            server: {
                port: parseInt(process.env.SERVER_PORT) || 3000,
                host: process.env.SERVER_HOST || 'localhost',
                cors: {
                    enabled: true,
                    origin: '*'
                },
                rateLimit: {
                    enabled: true,
                    windowMs: 900000,
                    max: 100
                }
            }
        };

        if (!await fs.pathExists(this.defaultConfigFile)) {
            await fs.writeJson(this.defaultConfigFile, defaultConfig, { spaces: 2 });
            this.logger.info('Default configuration file created');
        }

        if (!await fs.pathExists(this.configFile)) {
            await fs.writeJson(this.configFile, defaultConfig, { spaces: 2 });
            this.logger.info('Configuration file created from default');
        }
    }

    /**
     * Load configuration from file
     */
    async loadConfig() {
        try {
            const configData = await fs.readJson(this.configFile);
            const { error, value } = this.configSchema.validate(configData, { allowUnknown: false });
            
            if (error) {
                this.logger.error('Configuration validation failed', { error: error.details });
                throw new Error(`Configuration validation failed: ${error.message}`);
            }
            
            this.config = value;
            this.logger.info('Configuration loaded successfully');
        } catch (error) {
            this.logger.error('Failed to load configuration', { error: error.message });
            throw error;
        }
    }

    /**
     * Save configuration to file
     */
    async saveConfig() {
        try {
            // Create a deep copy for validation to avoid modifying the original config
            const configForValidation = JSON.parse(JSON.stringify(this.config));
            
            // If password is missing but was previously set, preserve it from the existing file
            if (!configForValidation.veeam?.password && fs.existsSync(this.configFile)) {
                try {
                    const existingConfig = await fs.readJson(this.configFile);
                    if (existingConfig.veeam?.password) {
                        configForValidation.veeam.password = existingConfig.veeam.password;
                        this.config.veeam.password = existingConfig.veeam.password;
                    }
                } catch (readError) {
                    this.logger.warn('Could not read existing config for password preservation', { error: readError.message });
                }
            }
            
            const { error } = this.configSchema.validate(configForValidation, { allowUnknown: false });
            
            if (error) {
                throw new Error(`Configuration validation failed: ${error.message}`);
            }
            
            await fs.writeJson(this.configFile, this.config, { spaces: 2 });
            this.logger.info('Configuration saved successfully');
        } catch (error) {
            this.logger.error('Failed to save configuration', { error: error.message });
            throw error;
        }
    }

    /**
     * Get configuration value
     * @param {string} path - Dot notation path (e.g., 'veeam.baseUrl')
     * @returns {*} - Configuration value
     */
    get(path) {
        if (!this.config) {
            throw new Error('Configuration not loaded');
        }
        
        return path.split('.').reduce((obj, key) => obj && obj[key], this.config);
    }

    /**
     * Set configuration value
     * @param {string} path - Dot notation path
     * @param {*} value - Value to set
     */
    set(path, value) {
        if (!this.config) {
            throw new Error('Configuration not loaded');
        }
        
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((obj, key) => {
            if (!obj[key]) obj[key] = {};
            return obj[key];
        }, this.config);
        
        target[lastKey] = value;
    }

    /**
     * Get all configuration
     * @returns {Object} - Complete configuration
     */
    getAll() {
        return { ...this.config };
    }

    /**
     * Update configuration section
     * @param {string} section - Configuration section
     * @param {Object} updates - Updates to apply
     */
    async updateSection(section, updates) {
        if (!this.config[section]) {
            throw new Error(`Configuration section '${section}' not found`);
        }
        
        // Filter out empty or undefined values to preserve existing configuration
        const filteredUpdates = this.filterEmptyValues(updates);
        
        // Merge updates into the section
        const updatedSection = { ...this.config[section], ...filteredUpdates };
        
        // Validate only the specific section being updated
        const sectionSchema = this.configSchema.extract(section);
        const { error } = sectionSchema.validate(updatedSection, { allowUnknown: false });
        
        if (error) {
            throw new Error(`Configuration validation failed for section '${section}': ${error.message}`);
        }
        
        // Update the configuration and save to file without full validation
        this.config[section] = updatedSection;
        await fs.writeJson(this.configFile, this.config, { spaces: 2 });
        this.logger.info(`Configuration section '${section}' saved successfully`);
        
        // Notify watchers
        this.notifyWatchers(section, this.config[section]);
    }

    /**
     * Filter out empty or undefined values from an object
     * @param {Object} obj - Object to filter
     * @returns {Object} - Filtered object
     */
    filterEmptyValues(obj) {
        const filtered = {};
        
        for (const [key, value] of Object.entries(obj)) {
            if (value !== null && value !== undefined && value !== '') {
                if (typeof value === 'object' && !Array.isArray(value)) {
                    // Recursively filter nested objects
                    const nestedFiltered = this.filterEmptyValues(value);
                    if (Object.keys(nestedFiltered).length > 0) {
                        filtered[key] = nestedFiltered;
                    }
                } else {
                    filtered[key] = value;
                }
            }
        }
        
        return filtered;
    }

    /**
     * Add or update a reporting schedule
     * @param {Object} schedule - Schedule configuration
     */
    async addSchedule(schedule) {
        const schedules = this.get('reporting.schedules') || [];
        const existingIndex = schedules.findIndex(s => s.name === schedule.name);
        
        if (existingIndex >= 0) {
            schedules[existingIndex] = schedule;
        } else {
            schedules.push(schedule);
        }
        
        this.set('reporting.schedules', schedules);
        await this.saveConfig();
        
        this.notifyWatchers('reporting.schedules', schedules);
    }

    /**
     * Remove a reporting schedule
     * @param {string} scheduleName - Name of schedule to remove
     */
    async removeSchedule(scheduleName) {
        const schedules = this.get('reporting.schedules') || [];
        const filteredSchedules = schedules.filter(s => s.name !== scheduleName);
        
        this.set('reporting.schedules', filteredSchedules);
        await this.saveConfig();
        
        this.notifyWatchers('reporting.schedules', filteredSchedules);
    }

    /**
     * Watch for configuration changes
     * @param {string} path - Configuration path to watch
     * @param {Function} callback - Callback function
     */
    watch(path, callback) {
        if (!this.watchers.has(path)) {
            this.watchers.set(path, new Set());
        }
        this.watchers.get(path).add(callback);
    }

    /**
     * Stop watching configuration changes
     * @param {string} path - Configuration path
     * @param {Function} callback - Callback function
     */
    unwatch(path, callback) {
        if (this.watchers.has(path)) {
            this.watchers.get(path).delete(callback);
        }
    }

    /**
     * Notify watchers of configuration changes
     * @param {string} path - Changed path
     * @param {*} value - New value
     */
    notifyWatchers(path, value) {
        if (this.watchers.has(path)) {
            this.watchers.get(path).forEach(callback => {
                try {
                    callback(value, path);
                } catch (error) {
                    this.logger.error('Error in configuration watcher', { error: error.message, path });
                }
            });
        }
    }

    /**
     * Validate configuration
     * @returns {Object} - Validation result
     */
    validate() {
        return this.configSchema.validate(this.config, { allowUnknown: false });
    }

    /**
     * Reset configuration to defaults
     */
    async resetToDefaults() {
        const defaultConfig = await fs.readJson(this.defaultConfigFile);
        this.config = defaultConfig;
        await this.saveConfig();
        this.logger.info('Configuration reset to defaults');
    }
}

module.exports = ConfigManager;