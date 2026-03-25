const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

// Define log levels
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
};

// Define level based on environment
const level = () => {
    const env = process.env.NODE_ENV || 'development';
    const isDevelopment = env === 'development';
    return isDevelopment ? 'debug' : 'info';
};

// Define colors for each level
const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'white',
};

// Link colors to winston
winston.addColors(colors);

// Sensitive fields to mask
const SENSITIVE_FIELDS = ['password', 'token', 'secret', 'credit_card', 'authorization'];

// Custom format to mask sensitive data
const maskSensitiveData = winston.format((info) => {
    const mask = (obj) => {
        for (const key in obj) {
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                mask(obj[key]);
            } else if (SENSITIVE_FIELDS.includes(key.toLowerCase())) {
                obj[key] = '********';
            }
        }
    };

    if (info.metadata) {
        mask(info.metadata);
    }

    // Also check top level message if it's an object
    if (typeof info.message === 'object') {
        mask(info.message);
    }

    return info;
});

// Helper to get file and line number (for development)
const getCallerInfo = () => {
    const error = new Error();
    const stack = error.stack.split('\n');
    // stack[0] is Error
    // stack[1] is getCallerInfo
    // stack[2] is the custom format function
    // stack[3] is winston internal
    // We need to find the first line that is not from winston or this file
    for (let i = 2; i < stack.length; i++) {
        if (!stack[i].includes('node_modules') && !stack[i].includes('logger.js')) {
            const match = stack[i].match(/\((.*):(\d+):(\d+)\)$/) || stack[i].match(/at (.*):(\d+):(\d+)$/);
            if (match) {
                return `${path.basename(match[1])}:${match[2]}`;
            }
        }
    }
    return 'unknown';
};

// Custom format for development (pretty & colorized)
const devFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
    winston.format.colorize({ all: true }),
    winston.format.printf(
        (info) => {
            const caller = getCallerInfo();
            return `${info.timestamp} [${caller}] ${info.level}: ${typeof info.message === 'object' ? JSON.stringify(info.message, null, 2) : info.message}`;
        }
    )
);

// Custom format for production (JSON)
const prodFormat = winston.format.combine(
    winston.format.timestamp(),
    maskSensitiveData(),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Define transports
const transports = [
    // Console transport
    new winston.transports.Console({
        format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
    }),
    // Error log file
    new winston.transports.DailyRotateFile({
        filename: 'logs/error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d',
        level: 'error',
        format: prodFormat,
    }),
    // Combined log file
    new winston.transports.DailyRotateFile({
        filename: 'logs/combined-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d',
        format: prodFormat,
    }),
];

// Create the logger
const logger = winston.createLogger({
    level: level(),
    levels,
    transports,
    // Do not exit on handled exceptions
    exitOnError: false,
});

// Create a stream object for Morgan integration
logger.stream = {
    write: (message) => logger.http(message.trim()),
};

module.exports = logger;
