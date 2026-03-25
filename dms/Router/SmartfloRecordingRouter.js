const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/unifiedAuth");
const callHistoryController = require("../Controller/SmartfloCallHistoryController");

router.get("/:id/stream", verifyToken, callHistoryController.streamRecording);
router.get("/:id", verifyToken, callHistoryController.getRecordingMetadata);

module.exports = router;
