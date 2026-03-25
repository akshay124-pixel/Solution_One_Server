/**
 * Migration: others → salesperson (dms:false), dms_user → salesperson (dms:true)
 *
 * Run once after deploying the salesperson role changes:
 *   node unified-portal/server/scripts/migrateSalespersonRoles.js
 *
 * What it does:
 *   1. UnifiedUser: role="others"   → role="salesperson", dms=false, app_module="crm+so"
 *   2. UnifiedUser: role="dms_user" → role="salesperson", dms=true,  app_module="so+dms"
 *   3. DMS DB:      role="Others"   → role="salesperson"
 */
require("dotenv").config({ path: __dirname + "/../.env" });
const mongoose = require("mongoose");

const UNIFIED_URI = process.env.UNIFIED_MONGO_URI || process.env.CRM_MONGO_URI;
const DMS_URI     = process.env.DMS_MONGO_URI;

async function run() {
  if (!UNIFIED_URI || !DMS_URI) {
    console.error("Missing UNIFIED_MONGO_URI/CRM_MONGO_URI or DMS_MONGO_URI in .env");
    process.exit(1);
  }

  // ── Unified DB ──────────────────────────────────────────────────────────────
  const unifiedConn = await mongoose.createConnection(UNIFIED_URI).asPromise();
  console.log("Connected to Unified DB");

  const UnifiedUser = unifiedConn.model("UnifiedUser", new mongoose.Schema({}, { strict: false }));

  // others → salesperson (dms:false)
  const othersResult = await UnifiedUser.updateMany(
    { role: "others" },
    { $set: { role: "salesperson", dms: false, app_module: "crm+so" } }
  );
  console.log(`others → salesperson (dms:false): ${othersResult.modifiedCount} updated`);

  // dms_user → salesperson (dms:true)
  const dmsUserResult = await UnifiedUser.updateMany(
    { role: "dms_user" },
    { $set: { role: "salesperson", dms: true, app_module: "so+dms" } }
  );
  console.log(`dms_user → salesperson (dms:true): ${dmsUserResult.modifiedCount} updated`);

  await unifiedConn.close();

  // ── DMS DB ──────────────────────────────────────────────────────────────────
  const dmsConn = await mongoose.createConnection(DMS_URI).asPromise();
  console.log("Connected to DMS DB");

  const DMSUser = dmsConn.model("User", new mongoose.Schema({}, { strict: false }));

  // Others → salesperson
  const dmsOthersResult = await DMSUser.updateMany(
    { role: "Others" },
    { $set: { role: "salesperson" } }
  );
  console.log(`DMS Others → salesperson: ${dmsOthersResult.modifiedCount} updated`);

  await dmsConn.close();

  console.log("Migration complete.");
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
