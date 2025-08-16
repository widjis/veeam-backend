// Global configuration object
let currentConfig = {};

// Helper function to extract time from cron expression
function extractTimeFromCron(cronExpression) {
    // Parse cron expression "0 8 * * *" to extract hour and minute
    const parts = cronExpression.split(' ');
    if (parts.length >= 2) {
        const minute = parts[0] || '0';
        const hour = parts[1] || '8';
        return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    }
    return '08:00';
}

// Initialize page
document.addEventListener('DOMContentLoaded', function() {
    loadConfig();
    
    // Add event listeners for section toggles
    document.querySelectorAll('[data-toggle="section"]').forEach(header => {
        header.addEventListener('click', function() {
            toggleSection(this);
        });
    });
    
    // Add event listeners for action buttons
    document.querySelectorAll('[data-action]').forEach(button => {
        button.addEventListener('click', function() {
            const action = this.getAttribute('data-action');
            switch(action) {
                case 'loadConfig':
                    loadConfig();
                    break;
                case 'saveConfig':
                    saveConfig();
                    break;
                case 'testConnections':
                    testConnections();
                    break;
                case 'resetConfig':
                    resetConfig();
                    break;
            }
        });
    });
});

// Toggle section visibility
function toggleSection(header) {
    const section = header.parentElement;
    section.classList.toggle('active');
}

// Show status message
function showStatus(message, type = 'success') {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
    statusEl.style.display = 'block';
    
    setTimeout(() => {
        statusEl.style.display = 'none';
    }, 5000);
}

// Load current configuration
async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        currentConfig = await response.json();
        populateForm(currentConfig);
        showStatus('Configuration loaded successfully!', 'success');
    } catch (error) {
        console.error('Error loading config:', error);
        showStatus('Failed to load configuration: ' + error.message, 'error');
    }
}

// Populate form with configuration data
function populateForm(config) {
    // Helper function to set nested values
    function setValue(path, value) {
        const element = document.querySelector(`[name="${path}"]`);
        if (element) {
            if (element.type === 'checkbox') {
                element.checked = Boolean(value);
            } else {
                element.value = value || '';
            }
        }
    }



    // Populate all configuration sections
    if (config.veeam) {
        setValue('veeam.baseUrl', config.veeam.baseUrl);
        setValue('veeam.username', config.veeam.username);
        setValue('veeam.password', config.veeam.password);
        setValue('veeam.rejectUnauthorized', config.veeam.rejectUnauthorized);
        setValue('veeam.timeout', config.veeam.timeout);
        setValue('veeam.retryAttempts', config.veeam.retryAttempts);
        setValue('veeam.retryDelay', config.veeam.retryDelay);
    }

    if (config.whatsapp) {
        setValue('whatsapp.webhookUrl', config.whatsapp.webhookUrl || '');
        setValue('whatsapp.chatId', config.whatsapp.chatId || '');
        setValue('whatsapp.timeout', config.whatsapp.timeout || 10000);
        setValue('whatsapp.retryAttempts', config.whatsapp.retryAttempts || 3);
    }

    if (config.monitoring) {
        setValue('monitoring.dataCollection.interval', config.monitoring.dataCollection.interval);
        setValue('monitoring.dataCollection.batchSize', config.monitoring.dataCollection.batchSize);
        setValue('monitoring.dataCollection.cacheTimeout', config.monitoring.dataCollection.cacheTimeout);
        setValue('monitoring.dataCollection.enableCaching', config.monitoring.dataCollection.enableCaching);
        setValue('monitoring.healthCheck.interval', config.monitoring.healthCheck.interval);
        setValue('monitoring.healthCheck.timeout', config.monitoring.healthCheck.timeout);
        setValue('monitoring.healthCheck.retries', config.monitoring.healthCheck.retries);
    }

    if (config.alerting) {
        setValue('alerting.enabled', config.alerting.enabled);
        if (config.alerting.thresholds && config.alerting.thresholds.repositoryUsage) {
            setValue('alerting.thresholds.repositoryUsage.warning', config.alerting.thresholds.repositoryUsage.warning);
            setValue('alerting.thresholds.repositoryUsage.critical', config.alerting.thresholds.repositoryUsage.critical);
        }
        if (config.alerting.thresholds && config.alerting.thresholds.healthScore) {
            setValue('alerting.thresholds.healthScore.warning', config.alerting.thresholds.healthScore.warning);
            setValue('alerting.thresholds.healthScore.critical', config.alerting.thresholds.healthScore.critical);
        }
        if (config.alerting.thresholds && config.alerting.thresholds.jobDuration) {
            setValue('alerting.thresholds.jobDuration.warning', config.alerting.thresholds.jobDuration.warning);
            setValue('alerting.thresholds.jobDuration.critical', config.alerting.thresholds.jobDuration.critical);
        }
        if (config.alerting.thresholds && config.alerting.thresholds.failureCount) {
            setValue('alerting.thresholds.failureCount.warning', config.alerting.thresholds.failureCount.warning);
            setValue('alerting.thresholds.failureCount.critical', config.alerting.thresholds.failureCount.critical);
        }
        if (config.alerting.retrySettings) {
            setValue('alerting.retrySettings.maxRetries', config.alerting.retrySettings.maxRetries);
            setValue('alerting.retrySettings.retryInterval', config.alerting.retrySettings.retryInterval);
            setValue('alerting.retrySettings.escalationInterval', config.alerting.retrySettings.escalationInterval);
            setValue('alerting.retrySettings.maxEscalations', config.alerting.retrySettings.maxEscalations);
        }
        
        // Alert types
        if (config.alerting.alertTypes) {
            setValue('alerting.alertTypes.jobFailure', config.alerting.alertTypes.jobFailure);
            setValue('alerting.alertTypes.jobStarted', config.alerting.alertTypes.jobStarted);
            setValue('alerting.alertTypes.jobCompleted', config.alerting.alertTypes.jobCompleted);
            setValue('alerting.alertTypes.repositoryFull', config.alerting.alertTypes.repositoryFull);
            setValue('alerting.alertTypes.systemHealth', config.alerting.alertTypes.systemHealth);
            setValue('alerting.alertTypes.longRunningJob', config.alerting.alertTypes.longRunningJob);
            setValue('alerting.alertTypes.infrastructureIssue', config.alerting.alertTypes.infrastructureIssue);
        }
        
        // Quiet hours
        if (config.alerting.quietHours) {
            setValue('alerting.quietHours.enabled', config.alerting.quietHours.enabled);
            setValue('alerting.quietHours.start', config.alerting.quietHours.start);
            setValue('alerting.quietHours.end', config.alerting.quietHours.end);
            setValue('alerting.quietHours.timezone', config.alerting.quietHours.timezone);
            setValue('alerting.quietHours.allowCritical', config.alerting.quietHours.allowCritical);
        }
    }

    if (config.reporting) {
        setValue('reporting.timezone', config.reporting.timezone || 'UTC');
        setValue('reporting.maxReportSize', config.reporting.maxReportSize || 4096);
        setValue('reporting.includeHealthScore', config.reporting.includeHealthScore || true);
        setValue('reporting.includeStorageAnalytics', config.reporting.includeStorageAnalytics || true);
        setValue('reporting.includePerformanceTrends', config.reporting.includePerformanceTrends || true);
        
        // Populate scheduler tasks
        populateSchedulerTasks(config.reporting.schedules || []);
    }

    if (config.server) {
        setValue('server.port', config.server.port);
        setValue('server.host', config.server.host);
        setValue('server.cors.enabled', config.server.cors.enabled);
        setValue('server.cors.origin', config.server.cors.origin);
        setValue('server.rateLimit.enabled', config.server.rateLimit.enabled);
        setValue('server.rateLimit.windowMs', config.server.rateLimit.windowMs);
        setValue('server.rateLimit.max', config.server.rateLimit.max);
    }

    if (config.logging) {
        setValue('logging.level', config.logging.level);
        setValue('logging.maxFiles', config.logging.maxFiles);
        setValue('logging.maxSize', config.logging.maxSize);
        setValue('logging.enableConsole', config.logging.enableConsole);
        setValue('logging.enableFile', config.logging.enableFile);
    }
}

function populateSchedulerTasks(schedules) {
    const container = document.getElementById('scheduler-tasks-container');
    if (!container) return;
    
    // Clear existing content
    container.innerHTML = '';
    
    if (!schedules || schedules.length === 0) {
        container.innerHTML = '<p class="help-text">No scheduled reports configured.</p>';
        return;
    }
    
    schedules.forEach((schedule, index) => {
        const taskDiv = document.createElement('div');
        taskDiv.className = 'scheduler-task';
        taskDiv.style.cssText = 'border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; background: #f9f9f9;';
        
        const cronTime = extractTimeFromCron(schedule.cronExpression);
        const cronDescription = getCronDescription(schedule.cronExpression);
        
        taskDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h5 style="margin: 0; color: #333;">${schedule.name}</h5>
                <div class="checkbox-group">
                    <input type="checkbox" id="schedule-${index}-enabled" 
                           name="reporting.schedules.${index}.enabled" 
                           ${schedule.enabled ? 'checked' : ''}>
                    <label for="schedule-${index}-enabled">Enabled</label>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 10px;">
                <div>
                    <label style="font-weight: bold; color: #555;">Schedule:</label>
                    <div style="color: #666; font-size: 0.9em;">${cronDescription}</div>
                    <div style="color: #888; font-size: 0.8em;">Cron: ${schedule.cronExpression}</div>
                </div>
                <div>
                    <label style="font-weight: bold; color: #555;">Type:</label>
                    <div style="color: #666;">${schedule.type || 'custom'}</div>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                <div class="checkbox-group">
                    <input type="checkbox" id="schedule-${index}-includeCharts" 
                           name="reporting.schedules.${index}.includeCharts" 
                           ${schedule.includeCharts ? 'checked' : ''}>
                    <label for="schedule-${index}-includeCharts">Include Charts</label>
                </div>
                <div class="checkbox-group">
                    <input type="checkbox" id="schedule-${index}-sendAsImage" 
                           name="reporting.schedules.${index}.sendAsImage" 
                           ${schedule.sendAsImage ? 'checked' : ''}>
                    <label for="schedule-${index}-sendAsImage">Send as Image</label>
                </div>
            </div>
            <input type="hidden" name="reporting.schedules.${index}.name" value="${schedule.name}">
            <input type="hidden" name="reporting.schedules.${index}.cronExpression" value="${schedule.cronExpression}">
            <input type="hidden" name="reporting.schedules.${index}.type" value="${schedule.type || 'custom'}">
        `;
        
        container.appendChild(taskDiv);
    });
}

function getCronDescription(cronExpression) {
    const parts = cronExpression.split(' ');
    if (parts.length < 5) return cronExpression;
    
    const [minute, hour, day, month, dayOfWeek] = parts;
    
    if (minute.startsWith('*/')) {
        const interval = minute.substring(2);
        return `Every ${interval} minutes`;
    }
    
    if (hour === '*' && minute === '*') {
        return 'Every minute';
    }
    
    if (day === '*' && month === '*' && dayOfWeek === '*') {
        const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
        return `Daily at ${time}`;
    }
    
    return cronExpression;
}

async function saveConfig() {
    try {
        showStatus('Saving configuration...', 'success');
        
        // Collect form data
        const formData = new FormData(document.getElementById('configForm'));
        const configSections = {};
        
        // Parse form data into nested object structure
        for (let [key, value] of formData.entries()) {
            const parts = key.split('.');
            let current = configSections;
            
            for (let i = 0; i < parts.length - 1; i++) {
                if (!current[parts[i]]) {
                    current[parts[i]] = {};
                }
                current = current[parts[i]];
            }
            
            const lastPart = parts[parts.length - 1];
            const element = document.querySelector(`[name="${key}"]`);
            
            if (element && element.type === 'checkbox') {
                current[lastPart] = element.checked;
            } else if (element && element.type === 'number') {
                current[lastPart] = parseInt(value) || 0;
            } else {
                current[lastPart] = value;
            }
        }
        
        // Save each section
        const savePromises = Object.entries(configSections).map(async ([section, data]) => {
            const response = await fetch(`/api/config/${section}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Failed to save ${section}: ${error}`);
            }
            
            return response.json();
        });

        await Promise.all(savePromises);
        showStatus('Configuration saved successfully!', 'success');
        
        // Reload to get updated config
        setTimeout(() => loadConfig(), 1000);
        
    } catch (error) {
        console.error('Error saving config:', error);
        showStatus('Failed to save configuration: ' + error.message, 'error');
    }
}

// Test connections
async function testConnections() {
    try {
        showStatus('Testing connections...', 'success');
        
        // Test Veeam connection
        const veeamResponse = await fetch('/test/veeam', { method: 'POST' });
        const veeamResult = await veeamResponse.json();
        
        // Test WhatsApp connection
        const whatsappResponse = await fetch('/test/whatsapp', { method: 'POST' });
        const whatsappResult = await whatsappResponse.json();
        
        let message = 'Connection Test Results:\n';
        message += `Veeam API: ${veeamResult.success ? '✅ Connected' : '❌ Failed - ' + veeamResult.error}\n`;
        message += `WhatsApp API: ${whatsappResult.success ? '✅ Connected' : '❌ Failed - ' + whatsappResult.error}`;
        
        const overallSuccess = veeamResult.success && whatsappResult.success;
        showStatus(message, overallSuccess ? 'success' : 'error');
        
    } catch (error) {
        console.error('Error testing connections:', error);
        showStatus('Failed to test connections: ' + error.message, 'error');
    }
}

// Reset configuration
async function resetConfig() {
    if (!confirm('Are you sure you want to reset all configuration to defaults? This action cannot be undone.')) {
        return;
    }
    
    try {
        // This would require a reset endpoint in the API
        showStatus('Reset functionality not implemented yet', 'error');
    } catch (error) {
        console.error('Error resetting config:', error);
        showStatus('Failed to reset configuration: ' + error.message, 'error');
    }
}