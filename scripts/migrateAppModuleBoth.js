/**
 * One-time migration: app_module "both" → "crm+so"
 *
 * The legacy "both" value is equivalent to "crm+so".
 * Run this ONCE after deploying the UnifiedUser schema change that removes "both" from the enum.
 *
 * Usage:
 *   node server/scripts/migrateAppModuleBoth.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");

const AUTH_DB_URI = process.env.AUTH_DB_URI;
if (!AUTH_DB_URI) {
  console.error("ERROR: AUTH_DB_URI is not set in environment.");
  process.exit(1);
}

async function migrate() {
  console.log("Connecting to Auth_Data...");
  const conn = await mongoose.createConnection(AUTH_DB_URI).asPromise();
  const collection = conn.collection("unifiedusers");

  const result = await collection.updateMany(
    { app_module: "both" },
    { $set: { app_module: "crm+so" } }
  );

  console.log(`Migration complete: ${result.modifiedCount} document(s) updated (both → crm+so).`);
  await conn.close();
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
