const dgram = require('dgram');
const EventEmitter = require('events');
const winston = require('winston');

class SyslogService extends EventEmitter {
    constructor(config = {}) {
        super();
        this.port = config.port || 514;
        this.host = config.host || '0.0.0.0';
        this.server = null;
        this.isRunning = false;
        this.messageCount = 0;
        this.veeamMessageCount = 0;
        this.startTime = null;
        
        // Create logger instance
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json()
            ),
            defaultMeta: { service: 'syslog-service' },
            transports: [
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
     * Start the syslog server
     */
    start() {
        return new Promise((resolve, reject) => {
            try {
                this.server = dgram.createSocket('udp4');

                this.server.on('message', (msg, rinfo) => {
                    this.handleMessage(msg, rinfo);
                });

                this.server.on('error', (err) => {
                    this.logger.error('Syslog server error:', err);
                    this.emit('error', err);
                });

                this.server.on('listening', () => {
                    const address = this.server.address();
                    this.logger.info(`Syslog server listening on ${address.address}:${address.port}`);
                    this.isRunning = true;
                    this.startTime = Date.now();
                    resolve();
                });

                this.server.bind(this.port, this.host);
            } catch (error) {
                this.logger.error('Failed to start syslog server:', error);
                reject(error);
            }
        });
    }

    /**
     * Stop the syslog server
     */
    stop() {
        return new Promise((resolve) => {
            if (this.server && this.isRunning) {
                this.server.close(() => {
                    this.logger.info('Syslog server stopped');
                    this.isRunning = false;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Handle incoming syslog message
     */
    handleMessage(buffer, rinfo) {
        try {
            this.messageCount++;
            const message = buffer.toString('utf8');
            
            this.logger.info(`[SYSLOG] Received message from ${rinfo.address}:${rinfo.port}`);
            this.logger.info(`[SYSLOG] Raw message: ${message}`);

            // Parse the syslog message
            const parsedMessage = this.parseSyslogMessage(message);
            
            if (parsedMessage) {
                // Log detailed information about the parsed message
                this.logger.info(`[SYSLOG] Parsed message details:`, {
                    hostname: parsedMessage.hostname,
                    appName: parsedMessage.appName,
                    severity: parsedMessage.severity,
                    facility: parsedMessage.facility,
                    timestamp: parsedMessage.timestamp,
                    message: parsedMessage.msg,
                    structuredData: parsedMessage.structuredData
                });
                
                // Check if this is a Veeam message
                if (this.isVeeamMessage(parsedMessage)) {
                    this.veeamMessageCount++;
                    
                    // Extract event ID and source information
                    let eventId = 'Unknown';
                    let source = parsedMessage.appName || 'Unknown';
                    
                    // Try to extract event ID from structured data
                    if (parsedMessage.structuredData) {
                        for (const element of parsedMessage.structuredData) {
                            if (element.params.EventID) {
                                eventId = element.params.EventID;
                            }
                        }
                    }
                    
                    this.logger.info(`[VEEAM EVENT] Source: ${source}, Event ID: ${eventId}, Severity: ${parsedMessage.severity}`);
                    this.logger.info(`[VEEAM EVENT] Message: ${parsedMessage.description || parsedMessage.msg}`);
                    
                    // Emit the parsed Veeam event
                    this.emit('veeamEvent', parsedMessage);
                } else {
                    this.logger.info(`[SYSLOG] Non-Veeam message from ${parsedMessage.appName || 'Unknown'}`);
                }
            } else {
                this.logger.warn(`[SYSLOG] Failed to parse message: ${message}`);
            }
        } catch (error) {
            this.logger.error('Error handling syslog message:', error);
        }
    }

    /**
     * Parse RFC 5424 syslog message
     * Format: <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID STRUCTURED-DATA MSG
     */
    parseSyslogMessage(message) {
        try {
            // Improved RFC 5424 regex pattern to handle structured data with quotes
            const rfc5424Pattern = /^<(\d+)>(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/;
            const match = message.match(rfc5424Pattern);

            if (match) {
                const [, pri, version, timestamp, hostname, appName, procId, msgId, rest] = match;
                
                // Parse structured data and message
                const { structuredData, msg } = this.parseStructuredDataAndMessage(rest);
                
                return {
                    priority: parseInt(pri),
                    facility: Math.floor(parseInt(pri) / 8),
                    severity: parseInt(pri) % 8,
                    version: parseInt(version),
                    timestamp,
                    hostname,
                    appName,
                    procId: procId === '-' ? null : procId,
                    msgId: msgId === '-' ? null : msgId,
                    structuredData,
                    msg,
                    raw: message
                };
            } else {
                // Try to parse as legacy syslog format
                return this.parseLegacySyslog(message);
            }
        } catch (error) {
            this.logger.error('Error parsing syslog message:', error);
            return null;
        }
    }

    /**
     * Parse structured data and message from the rest of the syslog message
     */
    parseStructuredDataAndMessage(rest) {
        const structuredData = [];
        let msg = '';
        let pos = 0;

        // Parse structured data elements - handle nested brackets and quotes
        while (pos < rest.length && rest[pos] === '[') {
            let bracketCount = 0;
            let endPos = pos;
            let inQuotes = false;
            
            // Find the matching closing bracket, handling quotes
            for (let i = pos; i < rest.length; i++) {
                const char = rest[i];
                if (char === '"' && (i === 0 || rest[i-1] !== '\\')) {
                    inQuotes = !inQuotes;
                } else if (!inQuotes) {
                    if (char === '[') {
                        bracketCount++;
                    } else if (char === ']') {
                        bracketCount--;
                        if (bracketCount === 0) {
                            endPos = i;
                            break;
                        }
                    }
                }
            }
            
            if (endPos > pos) {
                const element = rest.substring(pos + 1, endPos);
                structuredData.push(this.parseStructuredDataElement(element));
                pos = endPos + 1;
                
                // Skip whitespace
                while (pos < rest.length && rest[pos] === ' ') pos++;
            } else {
                break;
            }
        }

        // The rest is the message
        if (pos < rest.length) {
            msg = rest.substring(pos).trim();
        }

        return { structuredData, msg };
    }

    /**
     * Parse a single structured data element
     */
    parseStructuredDataElement(element) {
        const spaceIndex = element.indexOf(' ');
        if (spaceIndex === -1) {
            return { sdId: element, params: {} };
        }
        
        const sdId = element.substring(0, spaceIndex);
        const paramsStr = element.substring(spaceIndex + 1);
        const params = {};

        // Parse parameters with proper quote handling
        const paramPattern = /([^=]+)="([^"]*)"/g;
        let paramMatch;
        while ((paramMatch = paramPattern.exec(paramsStr)) !== null) {
            params[paramMatch[1]] = paramMatch[2];
        }

        return { sdId, params };
    }

    /**
     * Parse legacy syslog format
     */
    parseLegacySyslog(message) {
        const legacyPattern = /^<(\d+)>(.*)$/;
        const match = message.match(legacyPattern);

        if (match) {
            const [, pri, content] = match;
            return {
                priority: parseInt(pri),
                facility: Math.floor(parseInt(pri) / 8),
                severity: parseInt(pri) % 8,
                version: 0, // Legacy format
                content,
                raw: message
            };
        }

        return null;
    }

    /**
     * Check if the message is from Veeam
     */
    isVeeamMessage(parsedMessage) {
        // Check app name
        if (parsedMessage.appName && parsedMessage.appName.toLowerCase().includes('veeam')) {
            return true;
        }

        // Check structured data for Veeam-specific fields
        if (parsedMessage.structuredData) {
            for (const element of parsedMessage.structuredData) {
                if (element.params.JobID || element.params.JobSessionID || element.params.JobType !== undefined) {
                    return true;
                }
            }
        }

        // Check message content
        if (parsedMessage.msg && parsedMessage.msg.toLowerCase().includes('backup job')) {
            return true;
        }

        return false;
    }

    /**
     * Extract Veeam-specific data from parsed message
     */
    extractVeeamData(parsedMessage) {
        const veeamData = {
            timestamp: parsedMessage.timestamp,
            hostname: parsedMessage.hostname,
            message: parsedMessage.msg,
            severity: parsedMessage.severity,
            raw: parsedMessage.raw
        };

        // Extract data from structured data elements
        if (parsedMessage.structuredData) {
            for (const element of parsedMessage.structuredData) {
                // Normalize field names by trimming spaces and assign to veeamData
                for (const [key, value] of Object.entries(element.params)) {
                    const normalizedKey = key.trim();
                    veeamData[normalizedKey] = value;
                    // Also keep the original key for backward compatibility
                    veeamData[key] = value;
                }
            }
        }

        // Parse Windows Event Log XML data from message body
        if (parsedMessage.msg) {
            this.parseEventDataXML(parsedMessage.msg, veeamData);
        }

        // Add description if available (check both normalized and spaced versions)
        if (veeamData.Description) {
            veeamData.description = veeamData.Description;
        } else if (veeamData[' Description']) {
            veeamData.description = veeamData[' Description'];
            veeamData.Description = veeamData[' Description'];
        }

        return veeamData;
    }

    /**
     * Parse simple Veeam syslog messages
     */
    parseSimpleVeeamMessage(messageContent, parsed) {
        const data = {
            message: messageContent,
            severity: this.mapSyslogSeverityToAlert(parsed.severity),
            timestamp: new Date().toISOString()
        };

        // Extract job name from common patterns
        const jobNamePatterns = [
            /backup job "([^"]+)"/i,
            /job "([^"]+)"/i,
            /job '([^']+)'/i,
            /VM \(([^)]+)\)/i
        ];

        for (const pattern of jobNamePatterns) {
            const match = messageContent.match(pattern);
            if (match) {
                data.jobName = match[1];
                break;
            }
        }

        // Extract session ID if present
        const sessionIdMatch = messageContent.match(/ID:\s*([a-f0-9-]+)/i);
        if (sessionIdMatch) {
            data.sessionId = sessionIdMatch[1];
        }

        // Determine job status from message content
        if (messageContent.toLowerCase().includes('started')) {
            data.status = 'Started';
        } else if (messageContent.toLowerCase().includes('completed') || messageContent.toLowerCase().includes('finished')) {
            data.status = 'Completed';
        } else if (messageContent.toLowerCase().includes('failed') || messageContent.toLowerCase().includes('error')) {
            data.status = 'Failed';
        } else if (messageContent.toLowerCase().includes('warning')) {
            data.status = 'Warning';
        }

        return data;
    }

    /**
     * Parse Windows Event Log EventData XML from message content
     */
    parseEventDataXML(message, veeamData) {
        try {
            // Look for EventData XML section
            const eventDataMatch = message.match(/<EventData[^>]*>([\s\S]*?)<\/EventData>/i);
            if (eventDataMatch) {
                const eventDataXML = eventDataMatch[1];
                
                // Extract Data elements with Name attributes (structured format)
                const namedDataElements = eventDataXML.match(/<Data Name="([^"]+)">([^<]*)<\/Data>/gi);
                if (namedDataElements) {
                    for (const element of namedDataElements) {
                        const match = element.match(/<Data Name="([^"]+)">([^<]*)<\/Data>/i);
                        if (match) {
                            const [, name, value] = match;
                            veeamData[name] = value;
                            
                            // Log extracted data for debugging
                            this.logger.debug(`[XML PARSE] Extracted ${name}: ${value}`);
                        }
                    }
                }
                
                // Extract unnamed Data elements (Windows Event Log format)
                const unnamedDataElements = eventDataXML.match(/<Data>([^<]*)<\/Data>/gi);
                if (unnamedDataElements) {
                    const dataValues = [];
                    for (const element of unnamedDataElements) {
                        const match = element.match(/<Data>([^<]*)<\/Data>/i);
                        if (match) {
                            dataValues.push(match[1]);
                        }
                    }
                    
                    // Map known positions based on Veeam Event Log structure
                    if (dataValues.length > 1) {
                        // Index 0: Usually Job ID (GUID)
                        if (dataValues[0] && dataValues[0].trim()) {
                            veeamData.JobID = dataValues[0];
                            this.logger.debug(`[XML PARSE] Extracted JobID from index 0: ${dataValues[0]}`);
                        }
                        
                        // Index 1: Usually Job Session ID (GUID)
                        if (dataValues[1] && dataValues[1].trim()) {
                            veeamData.JobSessionID = dataValues[1];
                            this.logger.debug(`[XML PARSE] Extracted JobSessionID from index 1: ${dataValues[1]}`);
                        }
                    }
                    
                    // Look for the actual message in the last non-empty Data element
                    for (let i = dataValues.length - 1; i >= 0; i--) {
                        if (dataValues[i] && dataValues[i].trim() && dataValues[i].length > 10) {
                            // This is likely the descriptive message
                            veeamData.eventMessage = dataValues[i];
                            this.logger.debug(`[XML PARSE] Extracted event message from index ${i}: ${dataValues[i]}`);
                            
                            // Override the main message with the descriptive one
                            veeamData.message = dataValues[i];
                            break;
                        }
                    }
                }
            }
            
            // Also try to extract from UserData section if present
            const userDataMatch = message.match(/<UserData[^>]*>([\s\S]*?)<\/UserData>/i);
            if (userDataMatch) {
                const userDataXML = userDataMatch[1];
                
                // Extract any XML elements that might contain job data
                const jobIdMatch = userDataXML.match(/<JobID[^>]*>([^<]+)<\/JobID>/i);
                if (jobIdMatch) {
                    veeamData.JobID = jobIdMatch[1];
                    this.logger.debug(`[XML PARSE] Extracted JobID from UserData: ${jobIdMatch[1]}`);
                }
                
                const sessionIdMatch = userDataXML.match(/<JobSessionID[^>]*>([^<]+)<\/JobSessionID>/i);
                if (sessionIdMatch) {
                    veeamData.JobSessionID = sessionIdMatch[1];
                    this.logger.debug(`[XML PARSE] Extracted JobSessionID from UserData: ${sessionIdMatch[1]}`);
                }
            }
            
        } catch (error) {
            this.logger.warn('Error parsing EventData XML:', error.message);
        }
    }

    /**
     * Check if the syslog server is listening
     */
    isListening() {
        return this.isRunning && this.server && this.server.listening;
    }

    /**
     * Get service statistics
     */
    getStats() {
        return {
            isRunning: this.isRunning,
            port: this.port,
            host: this.host,
            totalMessages: this.messageCount,
            veeamMessages: this.veeamMessageCount,
            uptime: this.isRunning && this.startTime ? Date.now() - this.startTime : 0
        };
    }
}

module.exports = SyslogService;