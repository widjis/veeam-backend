const moment = require('moment-timezone');
const winston = require('winston');
const _ = require('lodash');

class DataCollectionService {
  constructor(veeamApiClient) {
    this.apiClient = veeamApiClient;
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    
    // Create logger instance
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'data-collection-service' },
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });
  }

  // Cache management
  getCachedData(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }

  setCachedData(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  // Core data collection methods
  async getJobStates() {
    try {
      const cached = this.getCachedData('jobStates');
      if (cached) return cached;

      const data = await this.apiClient.get('/api/v1/jobs/states');
      this.setCachedData('jobStates', data);
      this.logger.info(`Collected ${data.data?.length || 0} job states`);
      return data;
    } catch (error) {
      this.logger.error('Failed to get job states:', error.message);
      throw error;
    }
  }

  async getJobs() {
    try {
      const cached = this.getCachedData('jobs');
      if (cached) return cached;

      const data = await this.apiClient.get('/api/v1/jobs');
      this.setCachedData('jobs', data);
      this.logger.info(`Collected ${data.data?.length || 0} jobs`);
      return data;
    } catch (error) {
      this.logger.error('Failed to get jobs:', error.message);
      throw error;
    }
  }

  async getJobDetails(jobId) {
    try {
      const data = await this.apiClient.get(`/api/v1/jobs/${jobId}`);
      return data;
    } catch (error) {
      this.logger.error(`Failed to get job details for ${jobId}:`, error.message);
      throw error;
    }
  }

  async getJobSessions(jobId, limit = 10) {
    try {
      const data = await this.apiClient.get(`/api/v1/jobs/${jobId}/sessions`, {
        limit,
        orderBy: 'creationTime',
        orderDirection: 'desc'
      });
      return data;
    } catch (error) {
      this.logger.error(`Failed to get job sessions for ${jobId}:`, error.message);
      throw error;
    }
  }

  async getSessions(filter = {}) {
    try {
      const cacheKey = `sessions_${JSON.stringify(filter)}`;
      const cached = this.getCachedData(cacheKey);
      if (cached) return cached;

      const params = {
        limit: filter.limit || 100,
        orderBy: 'creationTime',
        orderDirection: 'desc',
        ...filter
      };

      const data = await this.apiClient.get('/api/v1/sessions', params);
      
      // Normalize session data
      if (data.data) {
        data.data = data.data.map(session => {
          return {
            ...session,
            result: this.normalizeSessionResult(session.result),
            jobName: this.normalizeJobName(session.jobName)
          };
        });
      }
      
      this.setCachedData(cacheKey, data);
      this.logger.info(`Collected ${data.data?.length || 0} sessions`);
      return data;
    } catch (error) {
      this.logger.error('Failed to get sessions:', error.message);
      throw error;
    }
  }

  async getSessionStates() {
    try {
      const cached = this.getCachedData('sessionStates');
      if (cached) return cached;

      // Try to get session states, but handle gracefully if endpoint doesn't exist
      try {
        const data = await this.apiClient.get('/api/v1/sessions/states');
        this.setCachedData('sessionStates', data);
        this.logger.info(`Collected session states`);
        return data;
      } catch (apiError) {
        if (apiError.response?.status === 404 || apiError.response?.status === 400) {
          this.logger.warn('Session states endpoint not available, skipping...');
          // Return empty data structure to maintain compatibility
          const emptyData = { data: [] };
          this.setCachedData('sessionStates', emptyData);
          return emptyData;
        }
        throw apiError;
      }
    } catch (error) {
      this.logger.error('Failed to get session states:', error.message);
      throw error;
    }
  }

  async getRepositoryStates() {
    try {
      const cached = this.getCachedData('repositoryStates');
      if (cached) return cached;

      const data = await this.apiClient.get('/api/v1/backupInfrastructure/repositories/states');
      
      // Calculate used space for each repository
      if (data.data) {
        data.data.forEach(repo => {
          if (!repo.usedSpaceGB && repo.capacityGB && repo.freeGB) {
            repo.usedSpaceGB = repo.capacityGB - repo.freeGB;
          }
          // Calculate usage percentage
          if (repo.capacityGB && repo.usedSpaceGB) {
            repo.usagePercentage = (repo.usedSpaceGB / repo.capacityGB) * 100;
          }
        });
      }

      this.setCachedData('repositoryStates', data);
      this.logger.info(`Collected ${data.data?.length || 0} repository states`);
      return data;
    } catch (error) {
      this.logger.error('Failed to get repository states:', error.message);
      throw error;
    }
  }

  async getRepositories() {
    try {
      const cached = this.getCachedData('repositories');
      if (cached) return cached;

      const data = await this.apiClient.get('/api/v1/backupInfrastructure/repositories');
      this.setCachedData('repositories', data);
      this.logger.info(`Collected ${data.data?.length || 0} repositories`);
      return data;
    } catch (error) {
      this.logger.error('Failed to get repositories:', error.message);
      throw error;
    }
  }

  async getInfrastructureServers() {
    try {
      const cached = this.getCachedData('infrastructureServers');
      if (cached) return cached;

      // Use the correct endpoint for managed servers
      const data = await this.apiClient.get('/api/v1/backupInfrastructure/managedServers');
      this.setCachedData('infrastructureServers', data);
      this.logger.info(`Collected ${data.data?.length || 0} managed servers`);
      return data;
    } catch (error) {
      this.logger.error('Failed to get managed servers:', error.message);
      throw error;
    }
  }

  // Advanced data collection methods
  async getRecentSessions(hours = 24) {
    try {
      const startTime = moment().subtract(hours, 'hours').toISOString();
      const filter = {
        filter: `creationTime>="${startTime}"`,
        limit: 1000
      };
      return await this.getSessions(filter);
    } catch (error) {
      this.logger.error('Failed to get recent sessions:', error.message);
      throw error;
    }
  }

  async getFailedJobs(hours = 24) {
    try {
      const jobStates = await this.getJobStates();
      const recentSessions = await this.getRecentSessions(hours);
      
      const failedJobs = [];
      const now = moment();
      
      this.logger.info(`[DEBUG] getFailedJobs: Processing ${jobStates.data?.length || 0} jobs`);
      
      if (jobStates.data) {
        jobStates.data.forEach(job => {
          this.logger.debug(`[DEBUG] Processing job in getFailedJobs:`, {
            jobId: job.id,
            jobName: job.name,
            originalResult: job.lastResult,
            lastRun: job.lastRun
          });
          
          // Validate job data before processing
          if (!this.isValidJobData(job)) {
            this.logger.debug(`[DEBUG] Skipping invalid job data:`, { 
              jobId: job.id, 
              jobName: job.name, 
              lastResult: job.lastResult,
              reason: 'Failed isValidJobData check'
            });
            return;
          }
          
          const normalizedResult = this.normalizeJobResult(job.lastResult);
          
          this.logger.debug(`[DEBUG] Job result normalization:`, {
            jobId: job.id,
            originalResult: job.lastResult,
            normalizedResult: normalizedResult
          });
          
          // Skip if result is null (invalid), Success, or Unknown
          if (!normalizedResult || normalizedResult === 'Success' || normalizedResult === 'Unknown') {
            this.logger.debug(`[DEBUG] Skipping job due to result filter:`, {
              jobId: job.id,
              normalizedResult: normalizedResult,
              reason: 'Result is null, Success, or Unknown'
            });
            return;
          }
          
          const lastRun = moment(job.lastRun);
          const hoursDiff = now.diff(lastRun, 'hours');
          
          this.logger.debug(`[DEBUG] Checking time filter:`, {
            jobId: job.id,
            lastRun: job.lastRun,
            hoursDiff: hoursDiff,
            maxHours: hours
          });
          
          if (hoursDiff <= hours) {
            // Get recent sessions for this job
            const jobSessions = recentSessions.data?.filter(session => {
              const sessionResult = this.normalizeJobResult(session.result?.result || session.result);
              return session.jobId === job.id && sessionResult && sessionResult !== 'Success' && sessionResult !== 'Unknown';
            }) || [];
            
            this.logger.info(`[DEBUG] Adding failed job:`, {
              jobId: job.id,
              jobName: job.name,
              normalizedResult: normalizedResult,
              sessionsCount: jobSessions.length
            });
            
            failedJobs.push({
              ...job,
              lastResult: normalizedResult,
              recentFailedSessions: jobSessions
            });
          } else {
            this.logger.debug(`[DEBUG] Skipping job due to time filter:`, {
              jobId: job.id,
              hoursDiff: hoursDiff,
              maxHours: hours
            });
          }
        });
      }
      
      this.logger.info(`[DEBUG] getFailedJobs result: Found ${failedJobs.length} failed jobs in last ${hours} hours`);
      return failedJobs;
    } catch (error) {
      this.logger.error('Failed to get failed jobs:', error.message);
      throw error;
    }
  }

  async getRunningJobs() {
    try {
      const sessionStates = await this.getSessionStates();
      const runningSessions = sessionStates.data?.filter(session => 
        session.state === 'Working' || session.state === 'Starting'
      ) || [];
      
      this.logger.info(`Found ${runningSessions.length} running jobs`);
      return runningSessions;
    } catch (error) {
      this.logger.error('Failed to get running jobs:', error.message);
      throw error;
    }
  }

  async getJobStatistics(days = 7) {
    try {
      const startTime = moment().subtract(days, 'days').toISOString();
      const sessions = await this.getSessions({
        filter: `creationTime>="${startTime}"`,
        limit: 10000
      });
      
      const stats = {
        total: 0,
        success: 0,
        warning: 0,
        failed: 0,
        successRate: 0,
        failureRate: 0,
        warningRate: 0,
        averageDuration: 0,
        totalDataProcessed: 0
      };
      
      if (sessions.data && sessions.data.length > 0) {
        stats.total = sessions.data.length;
        
        let totalDuration = 0;
        let totalDataProcessed = 0;
        
        sessions.data.forEach(session => {
          switch (session.result) {
            case 'Success':
              stats.success++;
              break;
            case 'Warning':
              stats.warning++;
              break;
            case 'Failed':
            case 'Error':
              stats.failed++;
              break;
          }
          
          if (session.creationTime && session.endTime) {
            const duration = moment(session.endTime).diff(moment(session.creationTime), 'minutes');
            totalDuration += duration;
          }
          
          if (session.transferredDataSizeBytes) {
            totalDataProcessed += session.transferredDataSizeBytes;
          }
        });
        
        stats.successRate = (stats.success / stats.total) * 100;
        stats.failureRate = (stats.failed / stats.total) * 100;
        stats.warningRate = (stats.warning / stats.total) * 100;
        stats.averageDuration = totalDuration / stats.total;
        stats.totalDataProcessed = totalDataProcessed;
      }
      
      this.logger.info(`Calculated statistics for ${days} days: ${stats.total} sessions, ${stats.successRate.toFixed(2)}% success rate`);
      return stats;
    } catch (error) {
      this.logger.error('Failed to get job statistics:', error.message);
      throw error;
    }
  }

  // Comprehensive data collection for reporting
  async collectAllData() {
    try {
      this.logger.info('Starting comprehensive data collection...');
      
      // First check API health
      const apiHealth = await this.apiClient.checkApiHealth();
      
      if (apiHealth.status !== 'healthy') {
        this.logger.error('Veeam API is not accessible:', apiHealth.message);
        return {
          apiHealth: apiHealth,
          jobStates: null,
          jobs: null,
          sessions: null,
          repositoryStates: null,
          repositories: null,
          infrastructureServers: null,
          collectionTime: new Date().toISOString(),
          error: 'VEEAM_API_UNAVAILABLE',
          errorDetails: apiHealth.message
        };
      }
      
      const [jobStates, jobs, sessions, repositoryStates, repositories, infrastructureServers] = await Promise.allSettled([
        this.getJobStates(),
        this.getJobs(),
        this.getRecentSessions(24),
        this.getRepositoryStates(),
        this.getRepositories(),
        this.getInfrastructureServers()
      ]);
      
      const result = {
        apiHealth: apiHealth,
        jobStates: jobStates.status === 'fulfilled' ? jobStates.value : null,
        jobs: jobs.status === 'fulfilled' ? jobs.value : null,
        sessions: sessions.status === 'fulfilled' ? sessions.value : null,
        repositoryStates: repositoryStates.status === 'fulfilled' ? repositoryStates.value : null,
        repositories: repositories.status === 'fulfilled' ? repositories.value : null,
        infrastructureServers: infrastructureServers.status === 'fulfilled' ? infrastructureServers.value : null,
        collectionTime: new Date().toISOString(),
        error: null
      };
      
      // Check if any critical data failed to load
      const failedData = [];
      [jobStates, jobs, sessions, repositoryStates, repositories, infrastructureServers].forEach((promise, index) => {
        if (promise.status === 'rejected') {
          const names = ['jobStates', 'jobs', 'sessions', 'repositoryStates', 'repositories', 'infrastructureServers'];
          failedData.push(names[index]);
          this.logger.error(`Failed to collect ${names[index]}:`, promise.reason?.message);
        }
      });
      
      if (failedData.length > 0) {
        result.error = 'PARTIAL_DATA_FAILURE';
        result.errorDetails = `Failed to collect: ${failedData.join(', ')}`;
      }
      
      this.logger.info('Comprehensive data collection completed');
      return result;
    } catch (error) {
      this.logger.error('Failed to collect all data:', error.message);
      return {
        apiHealth: { status: 'error', message: error.message },
        jobStates: null,
        jobs: null,
        sessions: null,
        repositoryStates: null,
        repositories: null,
        infrastructureServers: null,
        collectionTime: new Date().toISOString(),
        error: 'COLLECTION_ERROR',
        errorDetails: error.message
      };
    }
  }

  // Clear cache
  clearCache() {
    this.cache.clear();
    this.logger.info('Data collection cache cleared');
  }

  // Helper method to validate job data
  isValidJobData(job) {
    if (!job || !job.id) {
      return false;
    }
    
    // Check if job has a valid name
    const hasValidName = job.name && job.name.trim() !== '' && job.name !== 'Unknown Job';
    
    // Check if job has a valid result (not None, null, undefined, or empty)
    const hasValidResult = job.lastResult && 
                          job.lastResult !== 'None' && 
                          job.lastResult !== 'null' && 
                          job.lastResult !== 'undefined' && 
                          job.lastResult.trim() !== '';
    
    return hasValidName && hasValidResult;
  }

  // Helper method to normalize job results
  normalizeJobResult(result) {
    if (!result || result === 'None' || result === 'null' || result === 'undefined' || result === '') {
      return null; // Return null for invalid results
    }
    
    // Handle nested result objects
    if (typeof result === 'object' && result.result) {
      result = result.result;
    }
    
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
        // Only return the result if it's a meaningful value
        return normalizedResult.length > 0 ? normalizedResult : null;
    }
  }

  // Helper method to normalize session results
  normalizeSessionResult(result) {
    if (!result) {
      return null;
    }
    
    // Handle nested result objects
    if (typeof result === 'object') {
      const normalizedResult = {
        result: this.normalizeJobResult(result.result),
        message: result.message || ''
      };
      
      // Only return if we have a valid result
      return normalizedResult.result ? normalizedResult : null;
    }
    
    return this.normalizeJobResult(result);
  }

  // Helper method to normalize job names
  normalizeJobName(jobName) {
    if (!jobName || jobName.trim() === '' || jobName === 'Unknown Job') {
      return null; // Return null for invalid job names
    }
    
    return jobName.trim();
  }
}

module.exports = DataCollectionService;