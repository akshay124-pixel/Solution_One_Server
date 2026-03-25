const express = require("express");
const logger = require("../utils/logger");

const router = express.Router();
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const mime = require("mime-types");
const { verifyToken } = require("../utils/config jwt");
const {
  markLeave,
  bulkUploadStocks,
  getUsersForTagging,
  fetchAllUsers,
  DataentryLogic,
  fetchEntries,
  analyticsOverview,
  analyticsUserMetrics,
  fetchTeam,
  DeleteData,
  editEntry,
  exportentry,
  getAdmin,
  fetchUsers,
  assignUser,
  unassignUser,
  fetchNotifications,
  markNotificationsRead,
  clearNotifications,
  getCurrentUser,
  exportAttendance,
  checkIn,
  checkOut,
  fetchAttendance,
} = require("../Controller/DataLogic");

// Configure Multer with file size limit and type validation
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, "../Uploads");
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const originalName = file.originalname;
    const randomPrefix = crypto.randomBytes(4).toString("hex"); // Short random prefix
    cb(null, `${randomPrefix}_${originalName}`); // Preserve original name and extension
  },
});
const fileFilter = (req, file, cb) => {
  // Primary allowed mime types
  const allowedMimeTypes = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "application/pdf",
    "application/msword", // .doc
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
    "application/vnd.ms-excel", // .xls
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
    "application/vnd.ms-powerpoint", // .ppt
    "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
    "text/plain",
  ]);

  // Allowed extensions (case-insensitive)
  const allowedExtensions = new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".heic",
    ".heif",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".txt",
  ]);

  const mimetype = (file.mimetype || "").toLowerCase();
  const ext = path.extname(file.originalname || "").toLowerCase();

  // Some mobile browsers report application/octet-stream or empty mimetype.
  // Accept if either MIME type OR extension is whitelisted.
  if (allowedMimeTypes.has(mimetype) || allowedExtensions.has(ext)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Invalid file type. Allowed: PDF, JPG, JPEG, PNG, WEBP, HEIC, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT"
      ),
      false
    );
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: fileFilter,
});

// Increase server timeout for file uploads
router.use((req, res, next) => {
  req.setTimeout(120000); // 120 seconds
  res.setTimeout(120000);
  next();
});

// Routes (unchanged)
router.post("/check-in", verifyToken, checkIn);
router.post("/check-out", verifyToken, checkOut);
router.get("/attendance", verifyToken, fetchAttendance);
router.post("/leave", verifyToken, markLeave);
router.get("/allusers", verifyToken, fetchAllUsers);
router.post("/entry", verifyToken, upload.single("attachment"), DataentryLogic);
router.get("/fetch-entry", verifyToken, fetchEntries);
router.get("/analytics/overview", verifyToken, analyticsOverview);
router.get("/analytics/user-metrics", verifyToken, analyticsUserMetrics);
router.get("/fetch-team", verifyToken, fetchTeam);
router.delete("/entry/:id", verifyToken, DeleteData);
router.put("/editentry/:id", verifyToken, upload.single("attachment"), editEntry);
router.get("/export", verifyToken, exportentry);
router.post("/entries", verifyToken, bulkUploadStocks);
router.get("/user-role", verifyToken, getAdmin);
router.get("/tag-users", verifyToken, getUsersForTagging);
router.get("/users", verifyToken, fetchUsers);
router.post("/assign-user", verifyToken, assignUser);
router.post("/unassign-user", verifyToken, unassignUser);
router.get("/current-user", verifyToken, getCurrentUser);
router.get("/notifications", verifyToken, fetchNotifications);
router.post("/notificationsread", verifyToken, markNotificationsRead);
router.delete("/notificationsdelete", verifyToken, clearNotifications);
router.get("/export-attendance", verifyToken, exportAttendance);

router.get("/download/:filename", verifyToken, (req, res) => {
  try {
    // Decode and sanitize provided filename
    const rawParam = req.params.filename || "";
    const decoded = decodeURIComponent(rawParam);

    // Prevent path traversal
    if (decoded.includes("..") || decoded.includes("/") || decoded.includes("\\")) {
      return res.status(400).json({ success: false, message: "Invalid filename" });
    }

    const uploadsDir = path.join(__dirname, "../Uploads");
    const exactPath = path.join(uploadsDir, decoded);
    logger.info("Attempting to download file:", exactPath);


    let resolvedPath = null;

    if (fs.existsSync(exactPath)) {
      resolvedPath = exactPath;
    } else {
      // Case-insensitive lookup for cross-device compatibility
      try {
        const files = fs.readdirSync(uploadsDir);
        const targetLower = decoded.toLowerCase();
        const match = files.find((f) => f.toLowerCase() === targetLower);
        if (match) {
          resolvedPath = path.join(uploadsDir, match);
        }
      } catch (dirErr) {
        logger.error("Error reading uploads directory:", dirErr);

      }
    }

    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      logger.info("File not found:", decoded);

      return res
        .status(404)
        .json({ success: false, message: `File '${decoded}' not found` });
    }

    const stat = fs.statSync(resolvedPath);
    const basename = path.basename(resolvedPath);
    const mimeType = mime.lookup(basename) || "application/octet-stream";

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${basename}"`);
    res.setHeader("Content-Length", stat.size);

    const fileStream = fs.createReadStream(resolvedPath);
    fileStream.on("error", (err) => {
      logger.error("Stream error:", err);

      res.status(500).json({ success: false, message: "Error streaming file" });
    });
    fileStream.pipe(res);
  } catch (err) {
    logger.error("Download route error:", err);

    res.status(500).json({ success: false, message: "Internal server error" });
  }
});
module.exports = router;
