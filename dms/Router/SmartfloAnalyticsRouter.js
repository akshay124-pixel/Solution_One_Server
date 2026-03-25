const express = require("express");
const SmartfloAnalyticsController = require("../Controller/SmartfloAnalyticsController");
const { verifyToken } = require("../middleware/unifiedAuth");
const router = express.Router();

router.get("/call-summary", verifyToken, SmartfloAnalyticsController.getCallSummary);
router.get("/agent-performance", verifyToken, SmartfloAnalyticsController.getAgentPerformance);
router.get("/call-trends", verifyToken, SmartfloAnalyticsController.getCallTrends);
router.post("/sync-cdr", verifyToken, SmartfloAnalyticsController.syncCDR);

module.exports = router;
