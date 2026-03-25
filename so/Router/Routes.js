const express = require("express");
const router = express.Router();
const Controller = require("../Controller/Logic");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const { verifyToken } = require("../utils/config jwt");
const logger = require("../utils/logger");

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "../Uploads"));
  },
  filename: function (req, file, cb) {
    const randomBytes = crypto.randomBytes(16).toString("hex");
    const ext = path.extname(file.originalname);
    cb(null, `${randomBytes}${ext}`);
  },
});

// File filter to validate file types
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    "application/pdf",
    "application/x-pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ];

  const allowedExtensions = [".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx", ".xls", ".xlsx"];
  const fileExt = path.extname(file.originalname).toLowerCase();

  const isMimeAllowed = allowedMimeTypes.includes(file.mimetype);
  const isExtAllowed = allowedExtensions.includes(fileExt);

  if (isMimeAllowed || isExtAllowed) {
    cb(null, true);
  } else {
    logger.warn("File upload rejected", {
      filename: file.originalname,
      mimetype: file.mimetype,
      extension: fileExt
    });
    cb(
      new Error(
        `Invalid file type (${fileExt}). Only PDF, PNG, JPG, DOCX, XLS, and XLSX are allowed.`
      ),
      false
    );
  }
};
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB - increased to handle multipart overhead
  },
});

router.get("/get-orders", verifyToken, Controller.getAllOrders);
router.get("/get-orders-paginated", verifyToken, Controller.getOrdersPaginated);
router.get(
  "/installation-orders",
  verifyToken,
  Controller.getInstallationOrders
);
router.get("/accounts-orders", verifyToken, Controller.getAccountsOrders);

router.post(
  "/orders",
  verifyToken,
  upload.single("poFile"),
  Controller.createOrder
);
router.get("/dashboard-counts", verifyToken, Controller.getDashboardCounts);
router.delete("/delete/:id", verifyToken, Controller.DeleteData);
router.patch("/edit/:id", verifyToken, upload.fields([{ name: 'installationFile', maxCount: 1 }, { name: 'poFile', maxCount: 1 }]), Controller.editEntry);
router.get("/export", verifyToken, Controller.exportentry);
router.post("/bulk-orders", verifyToken, Controller.bulkUploadOrders);
router.get(
  "/production-orders",
  verifyToken,

  Controller.getProductionOrders
);
router.get("/finished-goods", verifyToken, Controller.getFinishedGoodsOrders);
router.get(
  "/get-verification-orders",
  verifyToken,
  Controller.getVerificationOrders
);
router.get(
  "/production-approval-orders",
  verifyToken,

  Controller.getProductionApprovalOrders
);
router.get("/get-bill-orders", verifyToken, Controller.getBillOrders);
router.get("/notifications", verifyToken, Controller.getNotifications);
router.post("/assign-user", verifyToken, Controller.assignUser);
router.post("/unassign-user", verifyToken, Controller.unassignUser);
router.post("/mark-read", verifyToken, Controller.markNotificationsRead);
router.delete("/clear", verifyToken, Controller.clearNotifications);
router.get("/current-user", verifyToken, Controller.getCurrentUser);
router.get(
  "/fetch-available-users",
  verifyToken,
  Controller.fetchAvailableUsers
);
router.get("/fetch-my-team", verifyToken, Controller.fetchMyTeam);
router.post("/send-completion-mail", verifyToken, Controller.sendInstallationCompletionMail);
router.get("/get-analytics", verifyToken, Controller.getSalesAnalytics);
module.exports = router;
