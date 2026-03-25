/**
 * DMS Unified Auth Middleware
 * Verifies the unified portal JWT (UNIFIED_JWT_SECRET) and maps
 * portal role strings to the DMS role strings that DMS controllers expect.
 *
 * Portal canonical → DMS controller expects
 *   superadmin   → "Superadmin"
 *   admin        → "Admin"
 *   salesperson  → "salesperson"  (DMS salesperson, dms=true)
 *   dms_user     → "salesperson"  (legacy alias)
 *   Others       → "salesperson"  (legacy DB value)
 *
 * req.user shape after this middleware:
 *   { id, username, email, role, app_access }
 *   where role is the DMS-normalised string ("Superadmin" | "Admin" | "salesperson")
 */
const jwt = require("jsonwebtoken");

const UNIFIED_SECRET = process.env.UNIFIED_JWT_SECRET;
if (!UNIFIED_SECRET) throw new Error("FATAL: UNIFIED_JWT_SECRET is not set in environment");

// Map portal canonical role → DMS role string used in controllers
const ROLE_MAP = {
  globaladmin: "Globaladmin",
  superadmin:  "Superadmin",
  super_admin: "Superadmin",  // legacy alias
  admin:       "Admin",
  salesperson: "salesperson", // DMS salesperson (dms=true)
  dms_user:    "salesperson", // legacy alias
  // pass-through for roles that already match DMS strings
  Globaladmin: "Globaladmin",
  Superadmin:  "Superadmin",
  Admin:       "Admin",
  Others:      "salesperson", // legacy DB value → map to salesperson
};

const unifiedAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
      code: "NO_TOKEN",
    });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, UNIFIED_SECRET);

    // Map role to DMS-expected string
    const dmsRole = ROLE_MAP[decoded.role] || "salesperson";

    req.user = {
      // Use dmsId when present (superadmin/admin have a real DMS User doc)
      // Fall back to id (CRM _id) for dms_user who only has one _id
      id:         decoded.dmsId || decoded.id,
      username:   decoded.username,
      email:      decoded.email,
      role:       dmsRole,
      app_access: decoded.app_access || [],
    };

    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Token expired.", code: "TOKEN_EXPIRED" });
    }
    return res.status(401).json({ success: false, message: "Invalid token.", code: "INVALID_TOKEN" });
  }
};

module.exports = { verifyToken: unifiedAuth };
