const winston = require('winston');
const path = require('path');

// Custom format for masking sensitive data
const maskSensitiveData = winston.format((info) => {
    const sensitiveFields = ['password', 'accessToken', 'refreshToken', 'token', 'secret'];

    const maskValues = (obj) => {
        if (typeof obj !== 'object' || obj === null) return obj;

        const maskedObj = Array.isArray(obj) ? [...obj] : { ...obj };

        for (const key in maskedObj) {
            if (sensitiveFields.includes(key.toLowerCase())) {
                maskedObj[key] = '***MASKED***';
            } else if (typeof maskedObj[key] === 'object') {
                maskedObj[key] = maskValues(maskedObj[key]);
            }
        }
        return maskedObj;
    };

    // Apply masking to the info object itself and any metadata
    if (info.message && typeof info.message === 'object') {
        info.message = maskValues(info.message);
    }

    // Mask any additional properties in the info object
    const keys = Object.keys(info);
    for (const key of keys) {
        if (sensitiveFields.includes(key.toLowerCase())) {
            info[key] = '***MASKED***';
        } else if (typeof info[key] === 'object' && key !== 'message') {
            info[key] = maskValues(info[key]);
        }
    }

    return info;
});

const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
};

const level = () => {
    const env = process.env.NODE_ENV || 'development';
    const isDevelopment = env === 'development';
    return isDevelopment ? 'debug' : 'info';
};

const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'white',
};

winston.addColors(colors);

const format = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
    maskSensitiveData(),
    process.env.NODE_ENV === 'production'
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize({ all: true }),
            winston.format.printf(
                (info) => `${info.timestamp} ${info.level}: ${typeof info.message === 'object' ? JSON.stringify(info.message, null, 2) : info.message}`
            )
        )
);

const transports = [
    new winston.transports.Console(),
];

const logger = winston.createLogger({
    level: level(),
    levels,
    format,
    transports,
});

module.exports = logger;
