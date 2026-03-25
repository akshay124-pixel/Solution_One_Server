/**
 * One-time migration: create SO and DMS user records for existing
 * superadmin/admin accounts that were created before the all-module-role fix.
 *
 * Run once:  node scripts/migrateAdminRoles.js
 */
require("dotenv").config({ path: __dirname + "/../.env" });

const bcrypt = require("bcrypt");
const { initConnections, getCRMConnection, getSOConnection, getDMSConnection } = require("../utils/connections");
const UnifiedUser = require("../models/UnifiedUser");
const logger = require("../utils/logger");

const DUMMY_PW = "MigratedUser@2024!"; // placeholder — real pw is hashed in UnifiedUser

async function migrate() {
  await initConnections();

  const CRMUser = require("../crm/Schema/Model");
  const SOUser  = require("../so/Models/Model");
  const { getUser: getDMSUser } = require("../dms/Schema/Model");
  const DMSUser = getDMSUser();

  const soRoleMap  = { superadmin: "admin", admin: "admin" };
  const dmsRoleMap = { superadmin: "Superadmin", admin: "Admin" };

  // Find all unified superadmin/admin users
  const admins = await UnifiedUser.find({ role: { $in: ["superadmin", "admin"] } });
  logger.info(`Found ${admins.length} superadmin/admin users to migrate`);

  for (const u of admins) {
    const email = u.email;
    const hashedPw = u.password; // reuse existing hash

    // ── SO ────────────────────────────────────────────────────────────────────
    if (!u.soUserId) {
      let soUser = await SOUser.findOne({ email });
      if (!soUser) {
        soUser = new SOUser({
          username: u.username,
          email,
          password: hashedPw,
          role: soRoleMap[u.role],
        });
        await soUser.save();
        logger.info(`Created SO user for ${email} (role: ${soRoleMap[u.role]})`);
      }
      u.soUserId = soUser._id;
    }

    // ── DMS ───────────────────────────────────────────────────────────────────
    if (!u.dmsUserId) {
      let dmsUser = await DMSUser.findOne({ email });
      if (!dmsUser) {
        dmsUser = new DMSUser({
          username: u.username,
          email,
          password: hashedPw,
          role: dmsRoleMap[u.role],
        });
        await dmsUser.save();
        logger.info(`Created DMS user for ${email} (role: ${dmsRoleMap[u.role]})`);
      }
      u.dmsUserId = dmsUser._id;
    }

    // ── Update app_module ─────────────────────────────────────────────────────
    u.app_module = "crm+so+dms";
    await u.save();
    logger.info(`Updated UnifiedUser for ${email}: soUserId=${u.soUserId}, dmsUserId=${u.dmsUserId}`);
  }

  logger.info("Migration complete.");
  process.exit(0);
}

migrate().catch((err) => {
  logger.error("Migration failed", { error: err.message });
  process.exit(1);
});
