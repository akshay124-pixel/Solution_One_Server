/**
 * Furni Data Router
 * All routes protected by unified JWT via furni/middleware/unifiedAuth.js
 * Mounted at: /api/furni/api
 */
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const router = express.Router();
const Controller = require("../Controller/DataLogic");
const { verifyToken } = require("../middleware/unifiedAuth");

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

const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    "application/pdf", "application/x-pdf",
    "image/png", "image/jpeg", "image/jpg",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ];
  const allowedExtensions = [".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx", ".xls", ".xlsx"];
  const fileExt = path.extname(file.originalname).toLowerCase();
  if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(fileExt)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type (${fileExt}). Only PDF, PNG, JPG, DOCX, XLS, and XLSX are allowed.`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Multer for bulk upload (memory storage — XLSX parsing)
const bulkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Routes ────────────────────────────────────────────────────────────────────
router.get("/get-orders",                  verifyToken, Controller.getAllOrders);
router.get("/get-orders-paginated",        verifyToken, Controller.getOrdersPaginated);
router.get("/installation-orders",         verifyToken, Controller.getInstallationOrders);
router.get("/accounts-orders",             verifyToken, Controller.getAccountsOrders);
router.post("/orders",                     verifyToken, Controller.createOrder);
router.get("/dashboard-counts",            verifyToken, Controller.getDashboardCounts);
router.delete("/delete/:id",               verifyToken, Controller.DeleteData);
router.put("/edit/:id",                    verifyToken, upload.single("installationFile"), Controller.editEntry);
router.get("/export",                      verifyToken, Controller.exportentry);
router.post("/bulk-orders",                verifyToken, bulkUpload.single("file"), Controller.bulkUploadOrders);
router.get("/production-orders",           verifyToken, Controller.getProductionOrders);
router.get("/get-analytics",               verifyToken, Controller.getSalesAnalytics);
router.get("/dashboard-counts",            verifyToken, Controller.getDashboardCounts);
router.get("/finished-goods",              verifyToken, Controller.getFinishedGoodsOrders);
router.get("/get-verification-orders",     verifyToken, Controller.getVerificationOrders);
router.get("/production-approval-orders",  verifyToken, Controller.getProductionApprovalOrders);
router.get("/get-bill-orders",             verifyToken, Controller.getBillOrders);
router.get("/notifications",               verifyToken, Controller.getNotifications);
router.post("/mark-read",                  verifyToken, Controller.markNotificationsRead);
router.delete("/clear",                    verifyToken, Controller.clearNotifications);
router.post("/send-completion-mail",       verifyToken, Controller.sendInstallationCompletionMail);

module.exports = router;
