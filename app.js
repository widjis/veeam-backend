#!/usr/bin/env node

/**
 * Veeam Backup Monitoring & Reporting System
 * Main application entry point
 */

const server = require('./src/server');
const ErrorHandler = require('./src/utils/errorHandler');

// Initialize error handler first
const errorHandler = new ErrorHandler();
errorHandler.setupGlobalErrorHandlers();

// Start the server
server.start().catch((error) => {
    errorHandler.logError('Failed to start server', error, { service: 'app' });
    process.exit(1);
});

// Export for testing
module.exports = server;