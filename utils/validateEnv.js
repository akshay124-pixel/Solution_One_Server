/**
 * validateEnv — called as the very first step in bootstrap().
 * Throws immediately if any required environment variable is missing,
 * preventing the server from starting with an insecure or broken config.
 */

const REQUIRED_KEYS = [
  "UNIFIED_JWT_SECRET",
  "UNIFIED_REFRESH_SECRET",
  "AUTH_DB_URI",
  "CRM_DB_URL",
  "SO_DB_URL",
  "DMS_DB_URL",
  "FURNI_DB_URL",
  "NODE_ENV",
];

function validateEnv() {
  const missing = REQUIRED_KEYS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `FATAL: Missing required environment variables: ${missing.join(", ")}\n` +
      "Copy server/.env.example to server/.env and fill in all values."
    );
  }
}

module.exports = { validateEnv };
