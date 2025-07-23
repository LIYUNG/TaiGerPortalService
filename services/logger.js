/**
 * Lightweight Logger for TaiGer Portal Service
 *
 * This logger leverages native console.log for CloudWatch integration when running on AWS ECS/EC2.
 * In production, logs are output as JSON for structured logging in CloudWatch.
 * In development, logs are colored and formatted for better readability.
 *
 * Features:
 * - Automatic CloudWatch integration via console.log
 * - Structured JSON logging in production
 * - Colored output in development (disabled in CloudWatch)
 * - Configurable log levels via LOG_LEVEL environment variable
 * - Support for metadata/context objects
 * - Silent mode in test environment
 *
 * Usage:
 * const logger = require('./services/logger');
 *
 * logger.info('User logged in', { userId: 123, ip: '192.168.1.1' });
 * logger.error('Database connection failed', { error: err.message });
 * logger.warn('Rate limit approaching', { requests: 95, limit: 100 });
 * logger.debug('Processing request', { method: 'POST', path: '/api/users' });
 * logger.http('GET /api/users 200 45ms');
 *
 * Environment Variables:
 * - LOG_LEVEL: Set log level (error, warn, info, debug). Default: 'info' in prod, 'debug' in dev
 * - NODE_ENV: Determines output format (JSON in production, colored text in development)
 *
 * Log Levels (in order of priority):
 * - error: 0 (highest priority)
 * - warn: 1
 * - info: 2
 * - debug: 3 (lowest priority)
 */

const { isProd, isTest } = require('../config');

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

// Log levels with numeric values
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// Current log level (can be set via environment variable)
const currentLevel = process.env.LOG_LEVEL || (isProd() ? 'info' : 'debug');

// Helper function to format timestamp
const getTimestamp = () => new Date().toISOString();

// Helper function to format log message
const formatMessage = (level, message, meta = {}) => {
  const logData = {
    level: level.toUpperCase(),
    message,
    ...meta
  };

  // In production or CloudWatch environment, output JSON for structured logging
  // (without timestamp since CloudWatch provides it automatically)
  if (isProd()) {
    return JSON.stringify(logData);
  }

  // In development, output colored, formatted text (only if not in CloudWatch)
  const timestamp = getTimestamp();
  const colorMap = {
    error: colors.red,
    warn: colors.yellow,
    info: colors.green,
    debug: colors.blue
  };

  const color = colorMap[level] || colors.reset;
  const prefix = `${color}[${level.toUpperCase()}]${colors.reset}`;
  const time = `${colors.gray}${timestamp}${colors.reset}`;

  let formattedMessage = `${prefix} ${time} ${message}`;

  if (Object.keys(meta).length > 0) {
    formattedMessage += ` ${colors.cyan}${JSON.stringify(meta)}${colors.reset}`;
  }

  return formattedMessage;
};

// Check if log level should be output
const shouldLog = (level) => {
  if (isTest()) return false;
  return levels[level] <= levels[currentLevel];
};

// Logger methods
const logger = {
  error: (message, meta = {}) => {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message, meta));
    }
  },

  warn: (message, meta = {}) => {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message, meta));
    }
  },

  info: (message, meta = {}) => {
    if (shouldLog('info')) {
      console.log(formatMessage('info', message, meta));
    }
  },

  debug: (message, meta = {}) => {
    if (shouldLog('debug')) {
      console.log(formatMessage('debug', message, meta));
    }
  },

  // Convenience method for HTTP requests
  http: (message, meta = {}) => {
    if (shouldLog('info')) {
      console.log(formatMessage('info', `HTTP: ${message}`, meta));
    }
  },

  // Method to set log level at runtime
  setLevel: (level) => {
    if (Object.prototype.hasOwnProperty.call(levels, level)) {
      process.env.LOG_LEVEL = level;
    }
  },

  // Method to check if a level is enabled
  isLevelEnabled: (level) => shouldLog(level)
};

module.exports = logger;
