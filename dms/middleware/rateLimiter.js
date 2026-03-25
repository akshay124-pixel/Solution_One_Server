const { getCachedData, setcache } = require("./CacheMiddleware");

function createRateLimiter(maxRequests = 100, windowMs = 60000) {
  return (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || req.headers["x-forwarded-for"];
    const key = `dms_rate_limit_${clientIP}`;
    const current = getCachedData(key) || { count: 0, resetTime: Date.now() + windowMs };
    if (Date.now() > current.resetTime) { current.count = 0; current.resetTime = Date.now() + windowMs; }
    current.count++;
    setcache(key, current, Math.ceil(windowMs / 1000));
    res.set({
      "X-RateLimit-Limit": maxRequests,
      "X-RateLimit-Remaining": Math.max(0, maxRequests - current.count),
      "X-RateLimit-Reset": new Date(current.resetTime).toISOString(),
    });
    if (current.count > maxRequests) {
      return res.status(429).json({ success: false, message: "Too many requests", retryAfter: Math.ceil((current.resetTime - Date.now()) / 1000) });
    }
    next();
  };
}

const webhookRateLimit = createRateLimiter(200, 60000);
const apiRateLimit = createRateLimiter(60, 60000);
module.exports = { webhookRateLimit, apiRateLimit, createRateLimiter };
