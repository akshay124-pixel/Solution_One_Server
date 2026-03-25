/**
 * One-time migration script: CRM_Data.unifiedusers → Auth_Data.unifiedusers
 *
 * Steps:
 *   1. Connect to both CRM_Data and Auth_Data
 *   2. Fetch all documents from CRM_Data.unifiedusers
 *   3. Insert into Auth_Data.unifiedusers (preserving _id)
 *   4. Verify counts match
 *   5. Print summary — manual drop of old collection is left to the operator
 *
 * Usage:
 *   node server/scripts/migrateUnifiedUsers.js
 *
 * Set env vars before running (or ensure server/.env is loaded):
 *   CRM_DB_URL=...
 *   AUTH_DB_URI=...
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");

const CRM_DB_URL = process.env.CRM_DB_URL;
const AUTH_DB_URI = process.env.AUTH_DB_URI;

if (!CRM_DB_URL || !AUTH_DB_URI) {
  console.error("ERROR: CRM_DB_URL and AUTH_DB_URI must be set in environment.");
  process.exit(1);
}

async function migrate() {
  console.log("Connecting to databases...");

  const crmConn  = await mongoose.createConnection(CRM_DB_URL).asPromise();
  const authConn = await mongoose.createConnection(AUTH_DB_URI).asPromise();

  console.log("Connected to CRM_Data and Auth_Data.");

  // Raw collection access — no schema needed for migration
  const srcCollection  = crmConn.collection("unifiedusers");
  const destCollection = authConn.collection("unifiedusers");

  const srcCount = await srcCollection.countDocuments();
  console.log(`Source (CRM_Data.unifiedusers): ${srcCount} documents`);

  if (srcCount === 0) {
    console.log("Nothing to migrate. Exiting.");
    await crmConn.close();
    await authConn.close();
    return;
  }

  const docs = await srcCollection.find({}).toArray();

  // Insert in batches of 100 to avoid memory issues on large collections
  const BATCH = 100;
  let inserted = 0;
  let skipped  = 0;

  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    try {
      const result = await destCollection.insertMany(batch, { ordered: false });
      inserted += result.insertedCount;
    } catch (err) {
      // ordered:false — duplicate key errors are non-fatal (already migrated docs)
      if (err.code === 11000 || err.writeErrors) {
        const dupes = err.writeErrors ? err.writeErrors.length : batch.length;
        skipped  += dupes;
        inserted += (batch.length - dupes);
        console.warn(`  Batch ${i / BATCH + 1}: ${dupes} duplicate(s) skipped.`);
      } else {
        throw err;
      }
    }
  }

  const destCount = await destCollection.countDocuments();
  console.log(`\nMigration complete:`);
  console.log(`  Inserted : ${inserted}`);
  console.log(`  Skipped  : ${skipped} (already existed)`);
  console.log(`  Dest total (Auth_Data.unifiedusers): ${destCount}`);

  if (destCount < srcCount - skipped) {
    console.error("WARNING: Destination count is lower than expected. Verify data before dropping source.");
  } else {
    console.log("\nVerification passed. Data integrity looks good.");
    console.log("Next step (manual): after confirming the app works, drop CRM_Data.unifiedusers:");
    console.log("  db.getSiblingDB('CRM_Data').unifiedusers.drop()");
  }

  await crmConn.close();
  await authConn.close();
  console.log("Connections closed.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
