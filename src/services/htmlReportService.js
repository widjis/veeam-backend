const fs = require('fs').promises;
const path = require('path');
const puppeteer = require('puppeteer');
const winston = require('winston');

class HtmlReportService {
    constructor() {
        this.templatePath = path.join(__dirname, '../templates/report.html');
        this.outputDir = path.join(__dirname, '../../reports');
        
        // Create logger instance
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json()
            ),
            defaultMeta: { service: 'html-report-service' },
            transports: [
                new winston.transports.Console({
                    format: winston.format.simple()
                })
            ]
        });
        
        this.ensureOutputDir();
    }

    async ensureOutputDir() {
        try {
            await fs.mkdir(this.outputDir, { recursive: true });
        } catch (error) {
            this.logger.error('Failed to create output directory:', error);
        }
    }

    async generateReport(reportData) {
        try {
            this.logger.info('Starting HTML report generation...');
            
            // Read the HTML template
            this.logger.info('Reading template from:', this.templatePath);
            const template = await fs.readFile(this.templatePath, 'utf8');
            this.logger.info('Template loaded successfully, length:', template.length);
            
            // Process the data for the report
            this.logger.info('Processing report data...');
            const processedData = this.processReportData(reportData);
            this.logger.info('Data processed successfully');
            
            // Replace template placeholders
            this.logger.info('Replacing placeholders...');
            let html = this.replacePlaceholders(template, processedData);
            
            // Inject data as JavaScript
            this.logger.info('Recent jobs data:', JSON.stringify(processedData.recentJobs, null, 2));
            const dataScript = `
                <script>
                    window.reportData = ${JSON.stringify(processedData)};
                    console.log('Report data loaded:', window.reportData);
                    console.log('Recent jobs:', window.reportData.recentJobs);
                    document.addEventListener('DOMContentLoaded', function() {
                        if (window.populateReport) {
                            console.log('Calling populateReport with data:', window.reportData);
                            window.populateReport(window.reportData);
                        } else {
                            console.error('populateReport function not found!');
                        }
                    });
                </script>
            `;
            
            html = html.replace('</head>', dataScript + '</head>');
            this.logger.info('HTML report generated successfully');
            
            return html;
        } catch (error) {
            this.logger.error('Failed to generate HTML report:', error.message);
            this.logger.error('Error stack:', error.stack);
            throw error;
        }
    }

    async captureReportImage(reportData, options = {}) {
        let browser;
        try {
            // Generate HTML content
            const html = await this.generateReport(reportData);
            
            // Launch puppeteer
            browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            
            const page = await browser.newPage();
            
            // Set viewport for consistent rendering
            await page.setViewport({
                width: options.width || 1200,
                height: options.height || 1600,
                deviceScaleFactor: 2
            });
            
            // Set content and wait for it to load
            await page.setContent(html, { waitUntil: 'networkidle0' });
            
            // Wait for any dynamic content to load
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Wait for JavaScript to execute
            await page.evaluate(() => {
                return new Promise(resolve => {
                    if (typeof populateReport === 'function') {
                        setTimeout(resolve, 500);
                    } else {
                        resolve();
                    }
                });
            });
            
            // Generate filename
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `veeam-report-${timestamp}.png`;
            const filepath = path.join(this.outputDir, filename);
            
            // Capture screenshot
            await page.screenshot({
                path: filepath,
                fullPage: true,
                type: 'png'
            });
            
            this.logger.info(`Report image captured: ${filepath}`);
            
            return {
                success: true,
                filepath,
                filename,
                url: `/reports/${filename}`
            };
            
        } catch (error) {
            this.logger.error('Failed to capture report image:', error);
            throw error;
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    processReportData(data) {
        const now = new Date();
        const reportDate = now.toLocaleDateString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const reportTime = now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        // Calculate chart heights based on percentages
        const totalJobs = data.summary?.totalJobs || 0;
        const successRate = data.summary?.successRate || 0;
        const warningRate = data.summary?.warningRate || 0;
        const failureRate = data.summary?.failureRate || 0;
        
        // Calculate actual job counts from rates
        const successJobs = Math.round((successRate / 100) * totalJobs);
        const warningJobs = Math.round((warningRate / 100) * totalJobs);
        const failedJobs = Math.round((failureRate / 100) * totalJobs);

        // Calculate bar heights (max 100px)
        const maxHeight = 100;
        const successBarHeight = Math.max((successRate / 100) * maxHeight, 5);
        const warningBarHeight = Math.max((warningRate / 100) * maxHeight, 5);
        const failureBarHeight = Math.max((failureRate / 100) * maxHeight, 5);

        // Process repositories
        const repositories = (data.repositories || []).map(repo => {
            const capacity = parseFloat(repo.capacity) || 0;
            const used = parseFloat(repo.used) || 0;
            const usage = capacity > 0 ? ((used / capacity) * 100).toFixed(2) : 0;
            
            return {
                name: repo.name || 'Unknown',
                capacity: this.formatBytes(capacity),
                used: this.formatBytes(used),
                usage: parseFloat(usage),
                path: repo.path || '',
                status: repo.status || 'unknown'
            };
        });

        // Process recent jobs - show only failed and warning jobs
        this.logger.info(`Total jobs before filtering: ${(data.jobs || []).length}`);
        
        const failedAndWarningJobs = (data.jobs || []).filter(job => {
            const status = (job.lastResult || job.result || 'unknown').toString().toLowerCase();
            return status === 'failed' || status === 'warning';
        });
        
        this.logger.info(`Failed and warning jobs found: ${failedAndWarningJobs.length}`);
        
        const recentJobs = failedAndWarningJobs.slice(0, 10).map(job => {
            const status = (job.lastResult || job.result || 'unknown').toLowerCase();
            this.logger.info(`HTML Report Processing job: ${job.name}, lastResult: ${job.lastResult}, status: ${status}`);
            return {
                name: job.name || 'Unknown Job',
                type: job.type || 'Backup',
                status: status
            };
        });

        // Calculate storage usage
        const totalCapacity = repositories.reduce((sum, repo) => sum + parseFloat(repo.capacity.replace(/[^0-9.]/g, '')), 0);
        const totalUsed = repositories.reduce((sum, repo) => sum + parseFloat(repo.used.replace(/[^0-9.]/g, '')), 0);
        const overallUsage = totalCapacity > 0 ? ((totalUsed / totalCapacity) * 100).toFixed(2) : 0;

        // Health status
        const healthScore = data.healthScore?.score || data.summary?.healthScore?.score || data.summary?.healthScore || 0;
        this.logger.info(`Health score calculation: healthScore=${healthScore}, data.healthScore=${JSON.stringify(data.healthScore)}, data.summary?.healthScore=${JSON.stringify(data.summary?.healthScore)}`);
        
        let healthStatus = 'Critical';
        if (healthScore >= 90) healthStatus = 'Excellent';
        else if (healthScore >= 80) healthStatus = 'Good';
        else if (healthScore >= 70) healthStatus = 'Fair';
        else if (healthScore >= 60) healthStatus = 'Poor';

        // Repository health counts
        const healthyRepos = repositories.filter(r => parseFloat(r.usage) < 80).length;
        const warningRepos = repositories.filter(r => parseFloat(r.usage) >= 80 && parseFloat(r.usage) < 90).length;
        const criticalRepos = repositories.filter(r => parseFloat(r.usage) >= 90).length;

        // Recommendations
        const recommendations = [];
        if (failedJobs > 0) recommendations.push(`${failedJobs} recent job failures require investigation`);
        if (criticalRepos > 0) recommendations.push(`${criticalRepos} repositories are critically full`);
        if (warningRepos > 0) recommendations.push(`${warningRepos} repositories need attention`);
        if (healthScore < 80) recommendations.push('System health score is below optimal threshold');
        if (recommendations.length === 0) recommendations.push('All systems operating normally');

        return {
            reportDate,
            reportTime,
            totalJobs,
            successRate: parseFloat(successRate),
            healthScore,
            failedJobs,
            storageUsage: parseFloat(overallUsage),
            successBarHeight,
            warningBarHeight,
            failureBarHeight,
            repositories,
            recentJobs,
            healthStatus,
            recommendations,
            healthyRepos,
            warningRepos,
            criticalRepos,
            overallUsage: parseFloat(overallUsage)
        };
    }

    replacePlaceholders(template, data) {
        let html = template;
        
        // Replace simple placeholders
        const placeholders = {
            '{{reportDate}}': data.reportDate,
            '{{reportTime}}': data.reportTime,
            '{{totalJobs}}': data.totalJobs,
            '{{successRate}}': data.successRate,
            '{{healthScore}}': data.healthScore,
            '{{failedJobs}}': data.failedJobs,
            '{{storageUsage}}': data.storageUsage,
            '{{healthStatus}}': data.healthStatus,
            '{{healthyRepos}}': data.healthyRepos,
            '{{warningRepos}}': data.warningRepos,
            '{{criticalRepos}}': data.criticalRepos,
            '{{overallUsage}}': data.overallUsage
        };

        Object.keys(placeholders).forEach(placeholder => {
            html = html.replace(new RegExp(placeholder, 'g'), placeholders[placeholder]);
        });

        return html;
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async saveHtmlReport(reportData, filename) {
        try {
            const html = await this.generateReport(reportData);
            const filepath = path.join(this.outputDir, filename || 'report.html');
            await fs.writeFile(filepath, html, 'utf8');
            
            this.logger.info(`HTML report saved: ${filepath}`);
            return { success: true, filepath };
        } catch (error) {
            this.logger.error('Failed to save HTML report:', error);
            throw error;
        }
    }
}

module.exports = HtmlReportService;