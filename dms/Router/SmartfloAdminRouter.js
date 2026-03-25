const express = require("express");
const SmartfloAdminController = require("../Controller/SmartfloAdminController");
const { verifyToken } = require("../middleware/unifiedAuth");
const router = express.Router();

router.get("/users", verifyToken, SmartfloAdminController.getAllUsersWithMapping);
router.put("/users/:userId/map", verifyToken, SmartfloAdminController.mapUserToSmartflo);
router.post("/lead-sync", verifyToken, SmartfloAdminController.syncLeadsToSmartflo);
router.post("/campaign/create", verifyToken, SmartfloAdminController.createCampaign);
router.get("/campaigns", verifyToken, SmartfloAdminController.getCampaigns);
router.get("/dispositions", verifyToken, SmartfloAdminController.getDispositions);
router.post("/test-connection", verifyToken, SmartfloAdminController.testConnection);

module.exports = router;
