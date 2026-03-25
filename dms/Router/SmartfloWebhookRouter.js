const express = require("express");
const SmartfloWebhookController = require("../Controller/SmartfloWebhookController");
const { webhookRateLimit } = require("../middleware/rateLimiter");
const { validateSmartfloWebhook, validateIPWhitelist } = require("../middleware/webhookValidator");
const router = express.Router();

// No auth — Smartflo calls these directly
router.use(webhookRateLimit);

const allowedIPs = process.env.SMARTFLO_ALLOWED_IPS
  ? process.env.SMARTFLO_ALLOWED_IPS.split(',').map(ip => ip.trim())
  : [];
router.use(validateIPWhitelist(allowedIPs));
router.use(validateSmartfloWebhook);

router.post("/call-events", SmartfloWebhookController.handleCallEvents);
router.post("/inbound", SmartfloWebhookController.handleInboundCall);
router.post("/debug", (req, res) => {
  res.status(200).json({ success: true, message: "Debug webhook received", timestamp: new Date().toISOString(), data: req.body });
});

module.exports = router;
