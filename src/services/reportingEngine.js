const moment = require('moment-timezone');
const winston = require('winston');
const _ = require('lodash');

class ReportingEngine {
  constructor(dataCollectionService, config = {}) {
    this.dataService = dataCollectionService;
    this.config = {
      timezone: config.timezone || 'UTC',
      dateFormat: config.dateFormat || 'YYYY-MM-DD HH:mm:ss',
      healthScoreWeights: {
        jobSuccess: 0.4,
        repositoryHealth: 0.3,
        infrastructureHealth: 0.2,
        recentFailures: 0.1
      },
      ...config
    };
    
    // Create logger instance
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'reporting-engine' },
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });
  }

  // Calculate system health score
  calculateHealthScore(data) {
    let score = 100;
    const factors = [];

    try {
      // Job success rate factor (40% weight)
      if (data.jobStates?.data) {
        const jobs = data.jobStates.data;
        const totalJobs = jobs.length;
        const successfulJobs = jobs.filter(job => job.lastResult === 'Success').length;
        const successRate = totalJobs > 0 ? (successfulJobs / totalJobs) * 100 : 100;
        
        const jobFactor = Math.max(0, successRate - 60) / 40 * 40; // 60-100% maps to 0-40 points
        score -= (40 - jobFactor);
        factors.push({ name: 'Job Success Rate', score: jobFactor, weight: 40 });
      }

      // Repository health factor (30% weight)
      if (data.repositoryStates?.data) {
        const repos = data.repositoryStates.data;
        let repoScore = 30;
        
        repos.forEach(repo => {
          if (repo.usagePercentage > 85) {
            repoScore -= 10; // Critical usage
          } else if (repo.usagePercentage > 70) {
            repoScore -= 5; // Warning usage
          }
        });
        
        repoScore = Math.max(0, repoScore);
        score -= (30 - repoScore);
        factors.push({ name: 'Repository Health', score: repoScore, weight: 30 });
      }

      // Infrastructure health factor (20% weight)
      if (data.infrastructureServers?.data) {
        const servers = data.infrastructureServers.data;
        const healthyServers = servers.filter(server => 
          server.status === 'Online' || server.status === 'Available'
        ).length;
        const infraScore = servers.length > 0 ? (healthyServers / servers.length) * 20 : 20;
        
        score -= (20 - infraScore);
        factors.push({ name: 'Infrastructure Health', score: infraScore, weight: 20 });
      }

      // Recent failure factor (10% weight)
      const recentFailures = this.getRecentFailures(data);
      let failureScore = 10;
      if (recentFailures.length > 0) {
        failureScore = Math.max(0, 10 - (recentFailures.length * 2));
      }
      score -= (10 - failureScore);
      factors.push({ name: 'Recent Failures', score: failureScore, weight: 10 });

    } catch (error) {
      this.logger.error('Error calculating health score:', error.message);
      score = 50; // Default to moderate health if calculation fails
    }

    return {
      score: Math.max(0, Math.min(100, Math.round(score * 10) / 10)),
      factors,
      timestamp: new Date().toISOString()
    };
  }

  // Get recent failures for health calculation
  getRecentFailures(data, hours = 24) {
    const failures = [];
    const cutoff = moment().subtract(hours, 'hours');

    if (data.sessions?.data) {
      data.sessions.data.forEach(session => {
        if (session.result !== 'Success' && moment(session.creationTime).isAfter(cutoff)) {
          failures.push(session);
        }
      });
    }

    return failures;
  }

  // Generate performance summary
  generatePerformanceSummary(data, period = { start: null, end: null }) {
    const summary = {
      totalJobs: 0,
      successRate: 0,
      failureRate: 0,
      warningRate: 0,
      activeAlerts: 0,
      period: {
        start: period.start || moment().subtract(1, 'day').format('M/D/YYYY'),
        end: period.end || moment().format('M/D/YYYY')
      }
    };

    try {
      if (data.jobStates?.data) {
        const jobs = data.jobStates.data;
        summary.totalJobs = jobs.length;
        
        const results = _.countBy(jobs, 'lastResult');
        const total = summary.totalJobs;
        
        summary.successRate = total > 0 ? ((results.Success || 0) / total * 100) : 0;
        summary.failureRate = total > 0 ? (((results.Failed || 0) + (results.Error || 0)) / total * 100) : 0;
        summary.warningRate = total > 0 ? ((results.Warning || 0) / total * 100) : 0;
      }

      // Count active alerts (failed jobs in last 24 hours)
      summary.activeAlerts = this.getRecentFailures(data, 24).length;

    } catch (error) {
      this.logger.error('Error generating performance summary:', error.message);
    }

    return summary;
  }

  // Generate storage analytics
  generateStorageAnalytics(data) {
    const analytics = {
      totalCapacityTB: 0,
      totalUsedTB: 0,
      overallUsagePercentage: 0,
      repositories: []
    };

    try {
      if (data.repositoryStates?.data) {
        const repos = data.repositoryStates.data;
        
        repos.forEach(repo => {
          const capacityTB = (repo.capacityGB || 0) / 1024;
          const usedTB = (repo.usedSpaceGB || 0) / 1024;
          const usagePercentage = repo.usagePercentage || 0;
          
          analytics.totalCapacityTB += capacityTB;
          analytics.totalUsedTB += usedTB;
          
          analytics.repositories.push({
            name: repo.name || 'Unknown',
            path: repo.path || '',
            capacityTB: Math.round(capacityTB * 100) / 100,
            usedTB: Math.round(usedTB * 100) / 100,
            usagePercentage: Math.round(usagePercentage * 100) / 100,
            status: this.getRepositoryStatus(usagePercentage)
          });
        });
        
        analytics.totalCapacityTB = Math.round(analytics.totalCapacityTB * 100) / 100;
        analytics.totalUsedTB = Math.round(analytics.totalUsedTB * 100) / 100;
        analytics.overallUsagePercentage = analytics.totalCapacityTB > 0 ? 
          Math.round((analytics.totalUsedTB / analytics.totalCapacityTB) * 10000) / 100 : 0;
      }
    } catch (error) {
      this.logger.error('Error generating storage analytics:', error.message);
    }

    return analytics;
  }

  // Get repository status based on usage
  getRepositoryStatus(usagePercentage) {
    if (usagePercentage > 85) return { emoji: '🔴', text: 'Critical', level: 'critical' };
    if (usagePercentage > 70) return { emoji: '🟡', text: 'Warning', level: 'warning' };
    return { emoji: '🟢', text: 'Healthy', level: 'healthy' };
  }

  // Generate repository health summary
  generateRepositoryHealth(data) {
    const health = {
      healthy: 0,
      warning: 0,
      critical: 0,
      topUsage: []
    };

    try {
      if (data.repositoryStates?.data) {
        const repos = data.repositoryStates.data;
        
        repos.forEach(repo => {
          const usage = repo.usagePercentage || 0;
          if (usage > 85) {
            health.critical++;
          } else if (usage > 70) {
            health.warning++;
          } else {
            health.healthy++;
          }
        });
        
        // Get top 5 repositories by usage
        health.topUsage = repos
          .map(repo => ({
            name: repo.name || 'Unknown',
            usedTB: Math.round((repo.usedSpaceGB || 0) / 1024 * 100) / 100,
            capacityTB: Math.round((repo.capacityGB || 0) / 1024 * 100) / 100,
            usagePercentage: Math.round((repo.usagePercentage || 0) * 100) / 100,
            status: this.getRepositoryStatus(repo.usagePercentage || 0)
          }))
          .sort((a, b) => b.usagePercentage - a.usagePercentage)
          .slice(0, 5);
      }
    } catch (error) {
      this.logger.error('Error generating repository health:', error.message);
    }

    return health;
  }

  // Generate performance trends
  generatePerformanceTrends(data) {
    const trends = {
      recentFailures: [],
      longRunningJobs: [],
      performanceIssues: []
    };

    try {
      // Recent failures
      const failures = this.getRecentFailures(data, 24);
      trends.recentFailures = failures.map(session => ({
        jobName: session.jobName || 'Unknown Job',
        type: session.jobType || 'Backup',
        failureTime: moment(session.endTime || session.creationTime).format('HH:mm'),
        reason: session.result || 'Failed'
      }));

      // Long running jobs (sessions over 4 hours)
      if (data.sessions?.data) {
        data.sessions.data.forEach(session => {
          if (session.creationTime && session.endTime) {
            const duration = moment(session.endTime).diff(moment(session.creationTime), 'hours');
            if (duration > 4) {
              trends.longRunningJobs.push({
                jobName: session.jobName || 'Unknown Job',
                duration: `${Math.round(duration * 10) / 10}h`,
                status: session.result || 'Unknown'
              });
            }
          }
        });
      }

      // Performance issues (repositories over 80% usage)
      if (data.repositoryStates?.data) {
        data.repositoryStates.data.forEach(repo => {
          if ((repo.usagePercentage || 0) > 80) {
            trends.performanceIssues.push({
              type: 'Storage',
              description: `${repo.name} at ${Math.round((repo.usagePercentage || 0) * 100) / 100}% capacity`,
              severity: (repo.usagePercentage || 0) > 90 ? 'Critical' : 'Warning'
            });
          }
        });
      }

    } catch (error) {
      this.logger.error('Error generating performance trends:', error.message);
    }

    return trends;
  }

  // Generate comprehensive daily report
  async generateDailyReport(customPeriod = null) {
    try {
      this.logger.info('Generating comprehensive daily report...');
      
      const data = await this.dataService.collectAllData();
      const period = customPeriod || {
        start: moment().subtract(1, 'day').format('M/D/YYYY'),
        end: moment().format('M/D/YYYY')
      };

      // Check if API is unavailable
      if (data.error === 'VEEAM_API_UNAVAILABLE') {
        const errorReport = {
          header: {
            title: '❌ Veeam Backup Report - API Unavailable',
            period: `📅 Period: ${period.start} to ${period.end}`,
            generatedAt: moment().format('YYYY-MM-DD HH:mm:ss')
          },
          error: 'VEEAM_API_UNAVAILABLE',
          errorDetails: data.errorDetails,
          apiHealth: data.apiHealth,
          summary: {
            totalJobs: 0,
            successfulJobs: 0,
            failedJobs: 0,
            warningJobs: 0,
            successRate: 0,
            failureRate: 0,
            warningRate: 0,
            activeAlerts: 0
          },
          jobs: [],
          repositories: [],
          alerts: [],
          timestamp: moment().toISOString()
        };
        
        this.logger.warn('Daily report generated with API unavailable status');
        return errorReport;
      }

      // Check if partial data failure
      if (data.error === 'PARTIAL_DATA_FAILURE') {
        this.logger.warn('Generating report with partial data due to API issues');
      }

      const performanceSummary = this.generatePerformanceSummary(data, period);
      const healthScore = this.calculateHealthScore(data);
      const storageAnalytics = this.generateStorageAnalytics(data);
      const repositoryHealth = this.generateRepositoryHealth(data);
      const performanceTrends = this.generatePerformanceTrends(data);
      
      // Sort jobs with priority (failed/warning first)
      const sortedJobs = (data.jobStates?.data || []).sort((a, b) => {
        const statusPriority = {
          'failed': 0,
          'warning': 1,
          'success': 2,
          'unknown': 3
        };
        const statusA = (a.lastResult || a.result || 'unknown').toString().toLowerCase();
        const statusB = (b.lastResult || b.result || 'unknown').toString().toLowerCase();
        
        const priorityA = statusPriority[statusA] !== undefined ? statusPriority[statusA] : 3;
        const priorityB = statusPriority[statusB] !== undefined ? statusPriority[statusB] : 3;
        
        return priorityA - priorityB;
      });

      const report = {
        // Test-expected fields
        summary: performanceSummary,
        jobs: sortedJobs,
        repositories: data.repositoryStates?.data || [],
        alerts: data.alerts?.data || [],
        timestamp: moment().toISOString(),
        
        // Original detailed structure
        header: {
          title: data.error === 'PARTIAL_DATA_FAILURE' ? '⚠️ Veeam Backup Report - Partial Data' : '🚨 Veeam Backup Report',
          period: `📅 Period: ${period.start} to ${period.end}`,
          generatedAt: moment().format('YYYY-MM-DD HH:mm:ss')
        },
        apiHealth: data.apiHealth,
        error: data.error,
        errorDetails: data.errorDetails,
        performanceSummary,
        healthScore,
        storageAnalytics,
        repositoryHealth,
        performanceTrends,
        rawData: {
          jobCount: data.jobStates?.data?.length || 0,
          sessionCount: data.sessions?.data?.length || 0,
          repositoryCount: data.repositoryStates?.data?.length || 0,
          serverCount: data.infrastructureServers?.data?.length || 0
        }
      };

      this.logger.info('Daily report generated successfully');
      return report;
    } catch (error) {
      this.logger.error('Failed to generate daily report:', error.message);
      
      // Return error report instead of throwing
      return {
        header: {
          title: '❌ Veeam Backup Report - Generation Failed',
          period: `📅 Period: ${customPeriod ? `${customPeriod.start} to ${customPeriod.end}` : 'Error'}`,
          generatedAt: moment().format('YYYY-MM-DD HH:mm:ss')
        },
        error: 'REPORT_GENERATION_FAILED',
        errorDetails: error.message,
        summary: {
          totalJobs: 0,
          successfulJobs: 0,
          failedJobs: 0,
          warningJobs: 0,
          successRate: 0,
          failureRate: 0,
          warningRate: 0,
          activeAlerts: 0
        },
        jobs: [],
        repositories: [],
        alerts: [],
        timestamp: moment().toISOString()
      };
    }
  }

  // Format report for WhatsApp
  formatReportForWhatsApp(report) {
    try {
      const perf = report.performanceSummary;
      const health = report.healthScore;
      const storage = report.storageAnalytics;
      const repoHealth = report.repositoryHealth;
      const trends = report.performanceTrends;

      let message = `${report.header.title}\n\n`;
      message += `${report.header.period}\n\n`;
      
      // Performance Summary
      message += `📊 Performance Summary:\n`;
      message += `•⁠  ⁠Total Jobs: ${perf.totalJobs}\n`;
      message += `•⁠  ⁠✅ Success Rate: ${perf.successRate.toFixed(2)}%\n`;
      message += `•⁠  ⁠❌ Failure Rate: ${perf.failureRate.toFixed(2)}%\n`;
      message += `•⁠  ⁠⚠️ Warning Rate: ${perf.warningRate.toFixed(2)}%\n`;
      message += `•⁠  ⁠🚨 Active Alerts: ${perf.activeAlerts}\n\n`;
      
      // Health Score
      message += `🏥 System Health Score: ${health.score}/100\n\n`;
      
      // Storage Analytics
      message += `💾 Storage Analytics:\n`;
      message += `•⁠  ⁠Total Capacity: ${storage.totalCapacityTB}TB\n`;
      message += `•⁠  ⁠Total Used: ${storage.totalUsedTB}TB\n`;
      message += `•⁠  ⁠Overall Usage: ${storage.overallUsagePercentage}%\n\n`;
      
      // Repository Health
      message += `🗄️ Repository Health:\n`;
      message += `•⁠  ⁠🟢 Healthy: ${repoHealth.healthy} repos (≤70%)\n`;
      message += `•⁠  ⁠🟡 Warning: ${repoHealth.warning} repos (70-85%)\n`;
      message += `•⁠  ⁠🔴 Critical: ${repoHealth.critical} repos (>85%)\n\n`;
      
      // Top Repository Usage
      if (repoHealth.topUsage.length > 0) {
        message += `📊 Top Repository Usage:\n`;
        repoHealth.topUsage.slice(0, 2).forEach(repo => {
          message += `•⁠  ⁠${repo.status.emoji} ${repo.name}: ${repo.usedTB}TB / ${repo.capacityTB}TB (${repo.usagePercentage}%)\n`;
        });
        message += `\n`;
      }
      
      // Performance Trends
      if (trends.recentFailures.length > 0 || trends.performanceIssues.length > 0) {
        message += `⚠️ Performance Trends:\n`;
        
        if (trends.recentFailures.length > 0) {
          message += `•⁠  ⁠🔴 Recent Failures: ${trends.recentFailures.length}\n`;
          trends.recentFailures.slice(0, 3).forEach(failure => {
            message += `   - ${failure.jobName} (${failure.type})\n`;
          });
        }
        
        if (trends.performanceIssues.length > 0) {
          message += `•⁠  ⁠⚠️ Performance Issues: ${trends.performanceIssues.length}\n`;
          trends.performanceIssues.slice(0, 2).forEach(issue => {
            message += `   - ${issue.description}\n`;
          });
        }
      }

      return message;
    } catch (error) {
      this.logger.error('Error formatting report for WhatsApp:', error.message);
      return 'Error generating report. Please check logs for details.';
    }
  }

  // Generate quick status update
  async generateQuickStatus() {
    try {
      const data = await this.dataService.collectAllData();
      const runningJobs = await this.dataService.getRunningJobs();
      const recentFailures = this.getRecentFailures(data, 1); // Last hour
      
      return {
        runningJobs: runningJobs.length,
        recentFailures: recentFailures.length,
        systemHealth: this.calculateHealthScore(data).score,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error('Failed to generate quick status:', error.message);
      throw error;
    }
  }
}

module.exports = ReportingEngine;