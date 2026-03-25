const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/unifiedAuth");
const callHistoryController = require("../Controller/SmartfloCallHistoryController");

router.get("/", verifyToken, callHistoryController.getCallHistory);
router.get("/stats", verifyToken, callHistoryController.getCallStats);
router.get("/debug/recordings", verifyToken, callHistoryController.debugRecordings);
router.post("/refresh-cache", verifyToken, callHistoryController.refreshCache);
router.get("/cache-stats", verifyToken, callHistoryController.getCacheMonitoring);
router.post("/export", verifyToken, callHistoryController.exportCallHistory);
router.get("/:id", verifyToken, callHistoryController.getCallDetails);

module.exports = router;
