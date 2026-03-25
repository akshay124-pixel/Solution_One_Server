/**
 * migrateFurniAccess.js
 * ─────────────────────
 * One-time migration: adds "furni" to app_module for all existing UnifiedUsers
 * who should have furni access but don't yet.
 *
 * Rules (mirrors getAppAccess logic):
 *   globaladmin  → crm+so+dms+furni
 *   superadmin   → append furni to whatever modules they already have
 *   admin        → crm+so → crm+so+furni  |  so+dms → so+dms+furni
 *   salesperson  → crm+so → crm+so+furni  |  so+dms → so+dms+furni
 *   SO roles     → so → so+furni
 *
 * Run once:
 *   node mydata/server/scripts/migrateFurniAccess.js
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const mongoose = require("mongoose");

const FURNI_ROLES = [
  "globaladmin", "superadmin", "admin", "salesperson",
  "Production", "Installation", "Finish", "Accounts",
  "Verification", "Bill", "ProductionApproval", "Sales", "Admin",
];

// Map old app_module → new app_module
function migrateModule(role, app_module) {
  if (!app_module) return null;

  // Already has furni — skip
  if (app_module.includes("furni")) return null;

  const parts = app_module.split("+").filter(Boolean);

  if (role === "globaladmin") {
    return "crm+so+dms+furni";
  }

  if (FURNI_ROLES.includes(role)) {
    // Append furni to existing modules
    return [...parts, "furni"].join("+");
  }

  return null; // no change needed
}

async function run() {
  const AUTH_DB_URI = process.env.AUTH_DB_URI;
  if (!AUTH_DB_URI) {
    console.error("AUTH_DB_URI not set in .env");
    process.exit(1);
  }

  const conn = await mongoose.createConnection(AUTH_DB_URI).asPromise();
  console.log("Connected to Auth DB");

  // Minimal schema — just what we need
  const schema = new mongoose.Schema({
    role: String,
    app_module: String,
  }, { strict: false });

  const UnifiedUser = conn.model("UnifiedUser", schema);

  const users = await UnifiedUser.find({});
  console.log(`Found ${users.length} users`);

  let updated = 0;
  let skipped = 0;

  for (const user of users) {
    const newModule = migrateModule(user.role, user.app_module);
    if (!newModule) {
      skipped++;
      continue;
    }

    await UnifiedUser.updateOne(
      { _id: user._id },
      { $set: { app_module: newModule } }
    );
    console.log(`  ✓ ${user.email} (${user.role}): ${user.app_module} → ${newModule}`);
    updated++;
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
  await conn.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
