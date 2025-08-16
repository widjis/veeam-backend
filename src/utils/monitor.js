const EventEmitter = require('events');
const os = require('os');
const fs = require('fs-extra');
const path = require('path');
const moment = require('moment');

class SystemMonitor extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            interval: config.interval || 60000, // 1 minute
            memoryThreshold: config.memoryThreshold || 0.8, // 80%
            cpuThreshold: config.cpuThreshold || 0.8, // 80%
            diskThreshold: config.diskThreshold || 0.9, // 90%
            enableFileLogging: config.enableFileLogging !== false,
            logPath: config.logPath || 'logs/monitoring.log',
            retentionDays: config.retentionDays || 7,
            ...config
        };

        this.metrics = {
            system: new Map(),
            application: new Map(),
            alerts: new Map()
        };

        this.isMonitoring = false;
        this.monitoringInterval = null;
        this.startTime = Date.now();
        this.lastCpuUsage = process.cpuUsage();
    }

    /**
     * Start monitoring
     */
    start() {
        if (this.isMonitoring) {
            return;
        }

        this.isMonitoring = true;
        this.emit('monitoring:started');

        // Initial collection
        this.collectMetrics();

        // Setup interval
        this.monitoringInterval = setInterval(() => {
            this.collectMetrics();
        }, this.config.interval);

        console.log(`System monitoring started with ${this.config.interval}ms interval`);
    }

    /**
     * Stop monitoring
     */
    stop() {
        if (!this.isMonitoring) {
            return;
        }

        this.isMonitoring = false;
        
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }

        this.emit('monitoring:stopped');
        console.log('System monitoring stopped');
    }

    /**
     * Collect all metrics
     */
    async collectMetrics() {
        try {
            const timestamp = Date.now();
            
            // Collect system metrics
            const systemMetrics = await this.collectSystemMetrics();
            const applicationMetrics = this.collectApplicationMetrics();
            
            // Store metrics
            this.storeMetrics('system', timestamp, systemMetrics);
            this.storeMetrics('application', timestamp, applicationMetrics);
            
            // Check thresholds and emit alerts
            this.checkThresholds(systemMetrics, applicationMetrics);
            
            // Log metrics if enabled
            if (this.config.enableFileLogging) {
                await this.logMetrics(timestamp, systemMetrics, applicationMetrics);
            }
            
            // Emit metrics event
            this.emit('metrics:collected', {
                timestamp,
                system: systemMetrics,
                application: applicationMetrics
            });
            
        } catch (error) {
            this.emit('monitoring:error', error);
        }
    }

    /**
     * Collect system metrics
     */
    async collectSystemMetrics() {
        const cpuUsage = this.getCpuUsage();
        const memoryUsage = this.getMemoryUsage();
        const diskUsage = await this.getDiskUsage();
        const networkStats = this.getNetworkStats();
        const loadAverage = os.loadavg();
        
        return {
            cpu: cpuUsage,
            memory: memoryUsage,
            disk: diskUsage,
            network: networkStats,
            load: {
                '1min': loadAverage[0],
                '5min': loadAverage[1],
                '15min': loadAverage[2]
            },
            uptime: os.uptime(),
            platform: os.platform(),
            arch: os.arch(),
            hostname: os.hostname(),
            cpuCount: os.cpus().length
        };
    }

    /**
     * Collect application metrics
     */
    collectApplicationMetrics() {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage(this.lastCpuUsage);
        this.lastCpuUsage = process.cpuUsage();
        
        return {
            memory: {
                rss: memUsage.rss,
                heapTotal: memUsage.heapTotal,
                heapUsed: memUsage.heapUsed,
                external: memUsage.external,
                arrayBuffers: memUsage.arrayBuffers,
                heapUsedPercent: (memUsage.heapUsed / memUsage.heapTotal) * 100
            },
            cpu: {
                user: cpuUsage.user,
                system: cpuUsage.system,
                total: cpuUsage.user + cpuUsage.system
            },
            uptime: process.uptime(),
            pid: process.pid,
            version: process.version,
            activeHandles: process._getActiveHandles().length,
            activeRequests: process._getActiveRequests().length
        };
    }

    /**
     * Get CPU usage percentage
     */
    getCpuUsage() {
        const cpus = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;
        
        cpus.forEach(cpu => {
            for (const type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        });
        
        const idle = totalIdle / cpus.length;
        const total = totalTick / cpus.length;
        const usage = 100 - ~~(100 * idle / total);
        
        return {
            usage: usage,
            cores: cpus.length,
            model: cpus[0].model,
            speed: cpus[0].speed
        };
    }

    /**
     * Get memory usage
     */
    getMemoryUsage() {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        
        return {
            total: totalMem,
            free: freeMem,
            used: usedMem,
            usagePercent: (usedMem / totalMem) * 100,
            available: freeMem
        };
    }

    /**
     * Get disk usage
     */
    async getDiskUsage() {
        try {
            const stats = await fs.stat(process.cwd());
            // This is a simplified version - in production you might want to use a library like 'diskusage'
            return {
                path: process.cwd(),
                // Note: fs.stat doesn't provide disk space info
                // You would need a platform-specific solution or library
                available: null,
                total: null,
                used: null,
                usagePercent: null
            };
        } catch (error) {
            return {
                error: error.message
            };
        }
    }

    /**
     * Get network statistics
     */
    getNetworkStats() {
        const interfaces = os.networkInterfaces();
        const stats = {};
        
        Object.keys(interfaces).forEach(name => {
            const iface = interfaces[name];
            stats[name] = iface.map(addr => ({
                address: addr.address,
                netmask: addr.netmask,
                family: addr.family,
                mac: addr.mac,
                internal: addr.internal
            }));
        });
        
        return stats;
    }

    /**
     * Store metrics in memory
     */
    storeMetrics(type, timestamp, metrics) {
        if (!this.metrics[type]) {
            this.metrics[type] = new Map();
        }
        
        this.metrics[type].set(timestamp, metrics);
        
        // Keep only last 1000 entries to prevent memory leaks
        if (this.metrics[type].size > 1000) {
            const oldestKey = this.metrics[type].keys().next().value;
            this.metrics[type].delete(oldestKey);
        }
    }

    /**
     * Check thresholds and emit alerts
     */
    checkThresholds(systemMetrics, applicationMetrics) {
        const alerts = [];
        
        // CPU threshold
        if (systemMetrics.cpu.usage > this.config.cpuThreshold * 100) {
            alerts.push({
                type: 'cpu_high',
                severity: 'warning',
                message: `High CPU usage: ${systemMetrics.cpu.usage.toFixed(2)}%`,
                value: systemMetrics.cpu.usage,
                threshold: this.config.cpuThreshold * 100
            });
        }
        
        // Memory threshold
        if (systemMetrics.memory.usagePercent > this.config.memoryThreshold * 100) {
            alerts.push({
                type: 'memory_high',
                severity: 'warning',
                message: `High memory usage: ${systemMetrics.memory.usagePercent.toFixed(2)}%`,
                value: systemMetrics.memory.usagePercent,
                threshold: this.config.memoryThreshold * 100
            });
        }
        
        // Application memory threshold
        if (applicationMetrics.memory.heapUsedPercent > 90) {
            alerts.push({
                type: 'app_memory_high',
                severity: 'warning',
                message: `High application heap usage: ${applicationMetrics.memory.heapUsedPercent.toFixed(2)}%`,
                value: applicationMetrics.memory.heapUsedPercent,
                threshold: 90
            });
        }
        
        // Load average threshold (for Unix systems)
        if (systemMetrics.load['1min'] > systemMetrics.cpuCount * 2) {
            alerts.push({
                type: 'load_high',
                severity: 'warning',
                message: `High load average: ${systemMetrics.load['1min'].toFixed(2)}`,
                value: systemMetrics.load['1min'],
                threshold: systemMetrics.cpuCount * 2
            });
        }
        
        // Emit alerts
        alerts.forEach(alert => {
            const alertKey = `${alert.type}_${Date.now()}`;
            this.metrics.alerts.set(alertKey, {
                ...alert,
                timestamp: Date.now()
            });
            
            this.emit('alert', alert);
        });
    }

    /**
     * Log metrics to file
     */
    async logMetrics(timestamp, systemMetrics, applicationMetrics) {
        try {
            await fs.ensureDir(path.dirname(this.config.logPath));
            
            const logEntry = {
                timestamp: new Date(timestamp).toISOString(),
                system: systemMetrics,
                application: applicationMetrics
            };
            
            await fs.appendFile(this.config.logPath, JSON.stringify(logEntry) + '\n');
        } catch (error) {
            this.emit('monitoring:error', error);
        }
    }

    /**
     * Get current metrics
     */
    getCurrentMetrics() {
        const latestSystem = Array.from(this.metrics.system.entries()).pop();
        const latestApp = Array.from(this.metrics.application.entries()).pop();
        
        return {
            timestamp: Date.now(),
            system: latestSystem ? latestSystem[1] : null,
            application: latestApp ? latestApp[1] : null
        };
    }

    /**
     * Get metrics history
     */
    getMetricsHistory(type = 'all', limit = 100) {
        if (type === 'all') {
            return {
                system: Array.from(this.metrics.system.entries()).slice(-limit),
                application: Array.from(this.metrics.application.entries()).slice(-limit),
                alerts: Array.from(this.metrics.alerts.entries()).slice(-limit)
            };
        }
        
        if (this.metrics[type]) {
            return Array.from(this.metrics[type].entries()).slice(-limit);
        }
        
        return [];
    }

    /**
     * Get performance summary
     */
    getPerformanceSummary() {
        const current = this.getCurrentMetrics();
        const uptime = Date.now() - this.startTime;
        
        return {
            uptime: moment.duration(uptime).humanize(),
            uptimeMs: uptime,
            current: current,
            alerts: {
                total: this.metrics.alerts.size,
                recent: Array.from(this.metrics.alerts.values())
                    .filter(alert => Date.now() - alert.timestamp < 3600000) // Last hour
                    .length
            },
            health: this.getHealthScore(current)
        };
    }

    /**
     * Calculate health score
     */
    getHealthScore(metrics) {
        if (!metrics.system || !metrics.application) {
            return { score: 0, status: 'unknown' };
        }
        
        let score = 100;
        const factors = [];
        
        // CPU factor
        const cpuUsage = metrics.system.cpu.usage;
        if (cpuUsage > 80) {
            score -= 20;
            factors.push('High CPU usage');
        } else if (cpuUsage > 60) {
            score -= 10;
            factors.push('Moderate CPU usage');
        }
        
        // Memory factor
        const memUsage = metrics.system.memory.usagePercent;
        if (memUsage > 85) {
            score -= 20;
            factors.push('High memory usage');
        } else if (memUsage > 70) {
            score -= 10;
            factors.push('Moderate memory usage');
        }
        
        // Application heap factor
        const heapUsage = metrics.application.memory.heapUsedPercent;
        if (heapUsage > 90) {
            score -= 15;
            factors.push('High heap usage');
        } else if (heapUsage > 75) {
            score -= 8;
            factors.push('Moderate heap usage');
        }
        
        // Load average factor (Unix systems)
        if (metrics.system.load && metrics.system.cpuCount) {
            const loadRatio = metrics.system.load['1min'] / metrics.system.cpuCount;
            if (loadRatio > 2) {
                score -= 15;
                factors.push('High load average');
            } else if (loadRatio > 1) {
                score -= 8;
                factors.push('Moderate load average');
            }
        }
        
        // Recent alerts factor
        const recentAlerts = Array.from(this.metrics.alerts.values())
            .filter(alert => Date.now() - alert.timestamp < 3600000).length;
        
        if (recentAlerts > 5) {
            score -= 10;
            factors.push('Multiple recent alerts');
        } else if (recentAlerts > 2) {
            score -= 5;
            factors.push('Some recent alerts');
        }
        
        score = Math.max(0, Math.min(100, score));
        
        let status;
        if (score >= 90) status = 'excellent';
        else if (score >= 75) status = 'good';
        else if (score >= 60) status = 'fair';
        else if (score >= 40) status = 'poor';
        else status = 'critical';
        
        return {
            score: Math.round(score),
            status,
            factors
        };
    }

    /**
     * Clean up old metrics and logs
     */
    async cleanup() {
        try {
            // Clean up old alerts (older than retention period)
            const cutoffTime = Date.now() - (this.config.retentionDays * 24 * 60 * 60 * 1000);
            
            for (const [key, alert] of this.metrics.alerts.entries()) {
                if (alert.timestamp < cutoffTime) {
                    this.metrics.alerts.delete(key);
                }
            }
            
            // Clean up old log files if they exist
            if (this.config.enableFileLogging && await fs.pathExists(this.config.logPath)) {
                const stats = await fs.stat(this.config.logPath);
                if (Date.now() - stats.mtime.getTime() > cutoffTime) {
                    await fs.remove(this.config.logPath);
                }
            }
            
        } catch (error) {
            this.emit('monitoring:error', error);
        }
    }

    /**
     * Format bytes to human readable
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

module.exports = SystemMonitor;