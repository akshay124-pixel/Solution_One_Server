function validateSmartfloWebhook(req, res, next) {
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ success: false, message: "Invalid webhook payload" });
  }
  req.webhookValidated = {
    timestamp: new Date(),
    eventType: req.body.event_type || "unknown",
    callId: req.body.call_id || "missing",
    direction: req.body.direction || req.body.call_direction || "unknown",
  };
  next();
}

function isValidPhoneNumber(phone) {
  if (!phone || typeof phone !== "string") return false;
  return /^\d{10,15}$/.test(phone.replace(/[\s\-\(\)\+]/g, ""));
}

function validateIPWhitelist(allowedIPs = []) {
  return (req, res, next) => {
    if (allowedIPs.length === 0) return next();
    const clientIP = req.ip || req.connection.remoteAddress || req.headers["x-forwarded-for"];
    if (!allowedIPs.includes(clientIP)) {
      return res.status(403).json({ success: false, message: "Unauthorized IP address" });
    }
    next();
  };
}

module.exports = { validateSmartfloWebhook, validateIPWhitelist, isValidPhoneNumber };
