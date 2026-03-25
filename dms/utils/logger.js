/**
 * DMS Smart Logger — rate-limited to prevent log spam
 */
class SmartLogger {
  constructor() {
    this.logCache = new Map();
    this.cleanupInterval = setInterval(() => {
      const cutoff = Date.now() - 300000;
      for (const [key, data] of this.logCache.entries()) {
        if (data.timestamp < cutoff) this.logCache.delete(key);
      }
    }, 300000);
  }

  logWithRateLimit(key, message, data = {}, cooldown = 30000) {
    const now = Date.now();
    const cached = this.logCache.get(key);
    if (!cached || now - cached.timestamp > cooldown) {
      console.log(message, data);
      this.logCache.set(key, { timestamp: now });
      return true;
    }
    return false;
  }

  logTokenVerification(user) {
    if (process.env.NODE_ENV === "development") {
      this.logWithRateLimit(
        `token_verify_${user.id}`,
        "DMS verifyToken: Token verified",
        { id: user.id, role: user.role },
        30000
      );
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.logCache.clear();
  }
}

const logger = new SmartLogger();
process.on("exit", () => logger.destroy());
module.exports = logger;
