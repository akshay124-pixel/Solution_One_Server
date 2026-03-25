/**
 * CRM Auth Controller — DEPRECATED
 *
 * Login, Signup, and token refresh are now handled exclusively by the
 * unified portal at /api/auth/* (server/routes/authRoutes.js).
 *
 * ChangePassword is also handled by /api/auth/change-password which
 * updates UnifiedUser + all module collections atomically.
 *
 * This file is kept to avoid breaking any stale imports but all
 * exported functions return 410 Gone.
 */
const logger = require("../utils/logger");

const gone = (name) => async (req, res) => {
  logger.warn(`[LEGACY AUTH] Blocked call to deprecated CRM AuthLogic.${name}`);
  return res.status(410).json({
    success: false,
    message: `This endpoint has been removed. Use /api/auth/* instead.`,
  });
};

const Signup        = gone("Signup");
const Login         = gone("Login");
const ChangePassword = gone("ChangePassword");

module.exports = { Signup, Login, ChangePassword };
