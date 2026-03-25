const morgan = require('morgan');
const logger = require('../utils/logger');

// Custom morgan token for request ID (if using one)
morgan.token('requestId', (req) => req.id || req.headers['x-request-id'] || 'N/A');

// Define format based on environment
const morganFormat = process.env.NODE_ENV === 'production'
    ? ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms'
    : '[:requestId] :method :url :status :response-time ms - :res[content-length]';

const requestLogger = morgan(morganFormat, {
    stream: logger.stream,
    skip: (req) => {
        // Skip health check routes to avoid noise
        const skipRoutes = ['/health', '/status', '/favicon.ico'];
        return skipRoutes.some(route => req.url.includes(route));
    }
});

module.exports = requestLogger;
