const express = require("express");
const SmartfloDialerController = require("../Controller/SmartfloDialerController");
const { verifyToken } = require("../middleware/unifiedAuth");
const router = express.Router();

router.post("/click-to-call", verifyToken, SmartfloDialerController.clickToCall);
router.get("/call-logs", verifyToken, SmartfloDialerController.getCallLogs);
router.get("/call-logs/:leadId", verifyToken, SmartfloDialerController.getLeadCallHistory);
router.post("/manual-log", verifyToken, SmartfloDialerController.manualCallLog);
router.post("/schedule-call", verifyToken, SmartfloDialerController.scheduleCall);
router.get("/scheduled-calls", verifyToken, SmartfloDialerController.getScheduledCalls);
router.get("/scheduled-calls/upcoming/today", verifyToken, SmartfloDialerController.getUpcomingCalls);
router.get("/scheduled-calls/overdue", verifyToken, SmartfloDialerController.getOverdueCalls);
router.get("/scheduled-calls/stats", verifyToken, SmartfloDialerController.getScheduledCallsStats);
router.get("/scheduled-calls/:leadId", verifyToken, SmartfloDialerController.getLeadScheduledCalls);
router.patch("/scheduled-calls/:id", verifyToken, SmartfloDialerController.updateScheduledCall);
router.patch("/scheduled-calls/:id/complete", verifyToken, SmartfloDialerController.completeScheduledCall);
router.delete("/scheduled-calls/:id", verifyToken, SmartfloDialerController.deleteScheduledCall);

module.exports = router;
