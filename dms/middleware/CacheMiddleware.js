const cache = require("../utils/Cache");

const setcache = (key, data, TTL = 60) => {
  try {
    return cache.set(key, data, TTL);
  } catch (e) {
    console.error(`DMS cache set error ${key}:`, e.message);
    return false;
  }
};

const getCachedData = (key) => {
  try {
    return cache.get(key) || null;
  } catch (e) {
    return null;
  }
};

const deleteCache = (key) => {
  try { return cache.del(key); } catch (e) { return 0; }
};

const smartInvalidate = (dataType, userId = null) => {
  try {
    const patterns = [];
    if (dataType === "calls") {
      patterns.push("call_history_*", "call_stats_*", "call_details_*");
      if (userId) patterns.push(`*_${userId}_*`);
    } else if (dataType === "entries") {
      patterns.push("entries_*", "entry_counts_*");
      if (userId) patterns.push(`*_${userId}_*`);
    } else if (dataType === "users") {
      patterns.push("user_role_*");
    } else if (dataType === "all") {
      cache.flushAll();
      return true;
    }
    patterns.forEach((pattern) => {
      const regex = new RegExp(pattern.replace(/\*/g, ".*"));
      cache.keys().filter((k) => regex.test(k)).forEach((k) => cache.del(k));
    });
    return true;
  } catch (e) {
    return false;
  }
};

const smartCacheRefresh = async (pattern, refreshFn = null, params = {}) => {
  try {
    const regex = new RegExp(pattern.replace(/\*/g, ".*"));
    cache.keys().filter((k) => regex.test(k)).forEach((k) => cache.del(k));
    if (refreshFn && params.cacheKey) {
      const fresh = await refreshFn(params);
      if (fresh) setcache(params.cacheKey, fresh, params.ttl || 60);
    }
    return true;
  } catch (e) {
    return false;
  }
};

const clearAllCache = () => { try { cache.flushAll(); return true; } catch (e) { return false; } };
const getCacheStats = () => { try { return cache.getStats(); } catch (e) { return null; } };

module.exports = { setcache, getCachedData, deleteCache, clearAllCache, getCacheStats, smartCacheRefresh, smartInvalidate };
