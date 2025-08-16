const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const winston = require('winston');

class VeeamApiClient {
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.username = config.username;
    this.password = config.password;
    this.tokenPath = path.join(__dirname, '../../data/tokens.json');
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
    
    // Create logger instance
    this.logger = winston.createLogger({
        level: 'info',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json()
        ),
        defaultMeta: { service: 'veeam-api-client' },
        transports: [
            new winston.transports.Console({
                format: winston.format.simple()
            })
        ]
    });
    
    // Ensure data directory exists
        fs.ensureDirSync(path.dirname(this.tokenPath));
    
    // Create axios instance with default config
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      },
      httpsAgent: new (require('https').Agent)({
        rejectUnauthorized: false
      })
    });
    
    this.loadTokens();
  }

  async loadTokens() {
    try {
      if (await fs.pathExists(this.tokenPath)) {
        const tokenData = await fs.readJson(this.tokenPath);
        this.accessToken = tokenData.access_token;
        this.refreshToken = tokenData.refresh_token;
        this.tokenExpiry = tokenData.token_expiry;
        
        if (this.tokenExpiry) {
          const expiryDate = new Date(this.tokenExpiry * 1000);
          this.logger.info(`Loaded tokens. Expires at: ${expiryDate.toISOString()}`);
        }
      }
    } catch (error) {
      this.logger.error('Error loading tokens:', error.message);
    }
  }

  async saveTokens() {
    try {
      await fs.ensureDir(path.dirname(this.tokenPath));
      const tokenData = {
        access_token: this.accessToken,
        refresh_token: this.refreshToken,
        token_expiry: this.tokenExpiry
      };
      await fs.writeJson(this.tokenPath, tokenData, { spaces: 2 });
      this.logger.info('Tokens saved successfully');
    } catch (error) {
      this.logger.error('Error saving tokens:', error.message);
    }
  }

  async deleteTokens() {
    try {
      if (await fs.pathExists(this.tokenPath)) {
        await fs.remove(this.tokenPath);
        this.logger.info('Tokens deleted successfully');
      }
    } catch (error) {
      this.logger.error('Error deleting tokens:', error.message);
    }
  }

  isTokenExpired() {
    if (!this.tokenExpiry) return true;
    return Date.now() / 1000 > this.tokenExpiry;
  }

  async getAccessToken() {
    try {
      const response = await this.axiosInstance.post('/api/oauth2/token',
        new URLSearchParams({
          grant_type: 'password',
          username: this.username,
          password: this.password
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-api-version': '1.1-rev1'
          }
        }
      );

      if (response.status === 200) {
        const data = response.data;
        this.accessToken = data.access_token;
        this.refreshToken = data.refresh_token;
        this.tokenExpiry = Math.floor(Date.now() / 1000) + (data.expires_in || 3600);
        
        await this.saveTokens();
        
        const expiryDate = new Date(this.tokenExpiry * 1000);
        this.logger.info(`New access token obtained. Expires at: ${expiryDate.toISOString()}`);
        
        return this.accessToken;
      }
    } catch (error) {
      this.logger.error('Failed to obtain access token:', {
        status: error.response?.status,
        message: error.response?.data || error.message
      });
      throw new Error('Authentication failed');
    }
  }

  async refreshAccessToken() {
    if (!this.refreshToken) {
      return await this.getAccessToken();
    }

    try {
      const response = await this.axiosInstance.post('/api/oauth2/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-api-version': '1.1-rev1'
          }
        }
      );

      if (response.status === 200) {
        const data = response.data;
        this.accessToken = data.access_token;
        this.refreshToken = data.refresh_token || this.refreshToken;
        this.tokenExpiry = Math.floor(Date.now() / 1000) + (data.expires_in || 3600);
        
        await this.saveTokens();
        this.logger.info('Access token refreshed successfully');
        
        return this.accessToken;
      }
    } catch (error) {
      this.logger.warn('Failed to refresh token, getting new one:', error.message);
      return await this.getAccessToken();
    }
  }

  async ensureValidToken() {
    if (!this.accessToken || this.isTokenExpired()) {
      if (this.refreshToken && !this.isTokenExpired()) {
        await this.refreshAccessToken();
      } else {
        await this.getAccessToken();
      }
    }
    return this.accessToken;
  }

  async checkApiHealth() {
    try {
      await this.ensureValidToken();
      
      const response = await this.axiosInstance({
        url: '/api/v1/jobs',
        method: 'GET',
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'x-api-version': '1.1-rev1'
        }
      });
      
      return {
        status: 'healthy',
        responseTime: response.headers['x-response-time'] || 'unknown',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.response?.status || 'CONNECTION_FAILED',
        message: error.response?.data?.message || error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async makeAuthenticatedRequest(endpoint, options = {}) {
    await this.ensureValidToken();
    
    const config = {
      url: endpoint,
      method: options.method || 'GET',
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${this.accessToken}`,
        'x-api-version': '1.1-rev1'
      }
    };

    try {
      const response = await this.axiosInstance(config);
      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        this.logger.warn('Token expired during request, refreshing...');
        await this.getAccessToken();
        
        // Retry with new token
        config.headers.Authorization = `Bearer ${this.accessToken}`;
        const retryResponse = await this.axiosInstance(config);
        return retryResponse.data;
      }
      
      this.logger.error('API request failed:', {
        endpoint,
        status: error.response?.status,
        message: error.response?.data || error.message
      });
      
      throw error;
    }
  }

  // Convenience methods for common HTTP verbs
  async get(endpoint, params = {}) {
    return this.makeAuthenticatedRequest(endpoint, {
      method: 'GET',
      params
    });
  }

  async post(endpoint, data = {}) {
    return this.makeAuthenticatedRequest(endpoint, {
      method: 'POST',
      data
    });
  }

  async put(endpoint, data = {}) {
    return this.makeAuthenticatedRequest(endpoint, {
      method: 'PUT',
      data
    });
  }

  async delete(endpoint) {
    return this.makeAuthenticatedRequest(endpoint, {
      method: 'DELETE'
    });
  }

  // Health check method
  async healthCheck() {
    try {
      await this.get('/api/v1/serverInfo');
      return { status: 'healthy', timestamp: new Date().toISOString() };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        error: error.message, 
        timestamp: new Date().toISOString() 
      };
    }
  }
}

module.exports = VeeamApiClient;