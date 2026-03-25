/**
 * unifiedAuth — verifies the unified portal JWT.
 * Used ONLY on portal-level routes (/api/auth/*).
 * CRM routes use their own verifyToken from crm/utils/config jwt.js
 * SO routes use their own verifyToken from so/utils/config jwt.js
 */
const jwt = require("jsonwebtoken");

const UNIFIED_SECRET = process.env.UNIFIED_JWT_SECRET;
if (!UNIFIED_SECRET) throw new Error("FATAL: UNIFIED_JWT_SECRET is not set in environment");

const unifiedAuth = (req, res, next) => {
  const token = req.header("Authorization")?.split(" ")[1];

  if (!token) {
    return res.status(403).json({ success: false, message: "No token provided." });
  }

  try {
    const decoded = jwt.verify(token, UNIFIED_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token." });
  }
};

module.exports = unifiedAuth;
