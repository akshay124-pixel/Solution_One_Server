/**
 * Furni Unified Auth Middleware
 * Verifies the unified portal JWT (UNIFIED_JWT_SECRET) and maps
 * portal role strings to the Furni role strings that Furni controllers expect.
 *
 * Portal canonical → Furni controller expects
 *   globaladmin  → "GlobalAdmin"
 *   superadmin   → "SuperAdmin"
 *   admin        → "Admin"
 *   salesperson  → "salesperson"
 *   Production   → "Production"   (pass-through)
 *   Installation → "Installation" (pass-through)
 *   Finish       → "Finish"       (pass-through)
 *   Accounts     → "Accounts"     (pass-through)
 *   Verification → "Verification" (pass-through)
 *   Bill         → "Bill"         (pass-through)
 *   ProductionApproval → "ProductionApproval" (pass-through)
 *
 * req.user shape after this middleware:
 *   { id, username, email, role, app_access }
 *   where role is the Furni-normalised string
 */
const jwt = require("jsonwebtoken");

const UNIFIED_SECRET = process.env.UNIFIED_JWT_SECRET;
if (!UNIFIED_SECRET) throw new Error("FATAL: UNIFIED_JWT_SECRET is not set in environment");

// Map portal canonical role → Furni role string used in controllers
const ROLE_MAP = {
  globaladmin:       "GlobalAdmin",
  superadmin:        "SuperAdmin",
  admin:             "Admin",
  Admin:             "Admin",
  salesperson:       "salesperson",
  Sales:             "salesperson",
  // SO-style roles that map directly into Furni
  Production:        "Production",
  Installation:      "Installation",
  Finish:            "Finish",
  Accounts:          "Accounts",
  Verification:      "Verification",
  Bill:              "Bill",
  ProductionApproval: "ProductionApproval",
  // Pass-through for roles already matching Furni strings
  SuperAdmin:        "SuperAdmin",
  GlobalAdmin:       "GlobalAdmin",
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

    // Map role to Furni-expected string
    const furniRole = ROLE_MAP[decoded.role] || decoded.role;

    req.user = {
      // Use furniId when present (superadmin/admin have a real Furni User doc)
      // Fall back to id (CRM _id) for users who only have one _id
      id:         decoded.furniId || decoded.id,
      username:   decoded.username,
      email:      decoded.email,
      role:       furniRole,
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
