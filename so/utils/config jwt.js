/**
 * SO JWT Middleware — Unified Portal Version
 *
 * ONLY accepts tokens signed with UNIFIED_JWT_SECRET.
 * Legacy SO secret ("My_SO") is no longer accepted.
 * All tokens are issued by /api/auth/login on the unified server.
 */
const jwt = require("jsonwebtoken");
const logger = require("./logger");

const UNIFIED_SECRET = process.env.UNIFIED_JWT_SECRET;
if (!UNIFIED_SECRET) throw new Error("FATAL: UNIFIED_JWT_SECRET is not set in environment");

// Normalize portal canonical roles → SO-expected strings
// SO controllers (Logic.js) check: "GlobalAdmin", "SuperAdmin", "admin", "salesperson"
const SO_ROLE_MAP = {
  globaladmin: "GlobalAdmin",
  superadmin:  "SuperAdmin",
  admin:       "admin",
  Admin:       "admin",
  salesperson: "salesperson",
  others:      "salesperson", // legacy alias
  Sales:       "salesperson",
};

const verifyToken = (req, res, next) => {
  const token = req.header("Authorization")?.split(" ")[1];

  if (!token) {
    return res.status(403).json({ message: "No token provided, access denied." });
  }

  try {
    const decoded = jwt.verify(token, UNIFIED_SECRET);

    req.user = {
      ...decoded,
      // SO backend uses soId when present (multi-module users have separate SO _id)
      id:   decoded.soId || decoded.id,
      role: SO_ROLE_MAP[decoded.role] || decoded.role,
    };
    return next();
  } catch (err) {
    logger.warn("SO verifyToken: invalid or expired unified JWT", { error: err.message });
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expired.", code: "TOKEN_EXPIRED" });
    }
    return res.status(401).json({ message: "Invalid or expired token." });
  }
};

module.exports = { verifyToken };
