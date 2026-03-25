const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/unifiedAuth");
const activeCallsController = require("../Controller/SmartfloActiveCallsController");

router.get("/", verifyToken, activeCallsController.getActiveCalls);
router.get("/:callId/status", verifyToken, activeCallsController.getCallStatus);
router.post("/:callId/hangup", verifyToken, activeCallsController.hangupCall);
router.post("/:callId/transfer", verifyToken, activeCallsController.transferCall);
router.post("/:callId/hold", verifyToken, activeCallsController.holdCall);

module.exports = router;
