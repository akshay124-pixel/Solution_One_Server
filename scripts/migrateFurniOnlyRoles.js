/**
 * migrateFurniOnlyRoles.js
 * ─────────────────────────
 * One-time fix: Furni-only operational role users (Production, Installation,
 * Finish, Accounts, Verification, Bill, ProductionApproval) who were signed up
 * via the Furni tab (furniOnly:true) should have app_module = "furni".
 *
 * If they were created before the getAppAccess fix, they may have
 * app_module = "so+furni" which incorrectly gives them SO access.
 *
 * This script finds those users and corrects their app_module to "furni".
 *
 * Run once:
 *   node mydata/server/scripts/migrateFurniOnlyRoles.js
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const mongoose = require("mongoose");

const FURNI_ONLY_ROLES = [
  "Production", "ProductionApproval", "Installation",
  "Finish", "Accounts", "Verification", "Bill",
];

async function run() {
  const AUTH_DB_URI = process.env.AUTH_DB_URI;
  if (!AUTH_DB_URI) {
    console.error("AUTH_DB_URI not set in .env");
    process.exit(1);
  }

  const conn = await mongoose.createConnection(AUTH_DB_URI).asPromise();
  console.log("Connected to Auth DB");

  const schema = new mongoose.Schema({ role: String, app_module: String }, { strict: false });
  const UnifiedUser = conn.model("UnifiedUser", schema);

  // Find furni-only operational role users who have SO access they shouldn't
  // These are users whose app_module contains "so" but NOT "crm" or "dms"
  // AND whose role is a furni-only operational role
  const users = await UnifiedUser.find({
    role: { $in: FURNI_ONLY_ROLES },
    app_module: { $regex: /so/, $not: /crm/ },
  });

  console.log(`Found ${users.length} users to check`);

  let updated = 0;
  let skipped = 0;

  for (const user of users) {
    // Only fix users who have "so+furni" or similar — not "crm+so+furni"
    const parts = (user.app_module || "").split("+").filter(Boolean);
    const hasSO = parts.includes("so");
    const hasCRM = parts.includes("crm");
    const hasFurni = parts.includes("furni");

    // If they have SO but not CRM, they were likely furni-only signups that got wrong module
    if (hasSO && !hasCRM && hasFurni) {
      await UnifiedUser.updateOne(
        { _id: user._id },
        { $set: { app_module: "furni" } }
      );
      console.log(`  ✓ ${user.email} (${user.role}): ${user.app_module} → furni`);
      updated++;
    } else {
      console.log(`  - ${user.email} (${user.role}): ${user.app_module} — skipped (has CRM or unexpected module)`);
      skipped++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
  await conn.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
