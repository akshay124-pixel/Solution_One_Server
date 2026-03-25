/**
 * CRM JWT Middleware — Unified Portal Version
 *
 * ONLY accepts tokens signed with UNIFIED_JWT_SECRET.
 * Legacy CRM secret ("My_CRM") is no longer accepted.
 * All tokens are issued by /api/auth/login on the unified server.
 */
const jwt = require("jsonwebtoken");
const logger = require("./logger");

const UNIFIED_SECRET = process.env.UNIFIED_JWT_SECRET;
if (!UNIFIED_SECRET) throw new Error("FATAL: UNIFIED_JWT_SECRET is not set in environment");

// Normalize portal canonical roles → CRM-expected strings (all lowercase)
const CRM_ROLE_MAP = {
  GlobalAdmin: "globaladmin",
  Admin:       "admin",
  SuperAdmin:  "superadmin",
  salesperson: "salesperson",
  others:      "salesperson", // legacy alias
};

/**
 * Express middleware — verifies unified JWT and sets req.user.
 * Also supports direct call: verifyToken(tokenString, callback)
 */
const verifyToken = (tokenOrReq, resOrNext, next) => {
  let token;
  let res;
  let callback;

  if (typeof tokenOrReq === "string") {
    // Direct call: verifyToken(tokenString, callback)
    token = tokenOrReq;
    callback = resOrNext;
  } else {
    // Express middleware call
    token = tokenOrReq.header("Authorization")?.split(" ")[1];
    res = resOrNext;
    callback = next;
  }

  if (!token) {
    if (res) {
      return res.status(403).json({ success: false, message: "No token provided, access denied." });
    }
    throw new Error("No token provided");
  }

  try {
    const decoded = jwt.verify(token, UNIFIED_SECRET);

    const normalizedDecoded = {
      ...decoded,
      role: CRM_ROLE_MAP[decoded.role] || decoded.role,
    };

    if (res) {
      tokenOrReq.user = normalizedDecoded;
      if (callback) callback();
    } else {
      if (callback) callback(null, normalizedDecoded);
    }
    return normalizedDecoded;
  } catch (err) {
    logger.warn("CRM verifyToken: invalid or expired unified JWT", { error: err.message });
    if (res) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ success: false, message: "Token expired.", code: "TOKEN_EXPIRED" });
      }
      return res.status(401).json({ success: false, message: "Invalid or expired token." });
    }
    throw new Error("Invalid token");
  }
};

module.exports = { verifyToken };
