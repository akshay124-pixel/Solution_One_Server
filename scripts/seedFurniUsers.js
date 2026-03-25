/**
 * seedFurniUsers.js
 * Migrates existing Sales_Order_Furni users into the unified UnifiedUser model
 * with module = "furni" and the correct role mapping.
 *
 * Usage:
 *   node mydata/server/scripts/seedFurniUsers.js
 *
 * Requires: MONGO_URI_UNIFIED and MONGO_URI_FURNI in environment (or .env)
 *
 * Role mapping (furni → unified):
 *   globaladmin  → SuperAdmin
 *   superadmin   → SuperAdmin
 *   admin        → Admin
 *   salesperson  → Sales
 *   (all other SO-style roles pass through as-is)
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// ── Unified User schema (minimal, matches UnifiedUser.js) ──────────────────
const unifiedUserSchema = new mongoose.Schema({
  username:  { type: String, required: true },
  email:     { type: String, required: true, unique: true },
  password:  { type: String, required: true },
  role:      { type: String, required: true },
  module:    { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

// ── Furni source user schema (minimal) ────────────────────────────────────
const furniUserSchema = new mongoose.Schema({
  username: String,
  email:    String,
  password: String,
  role:     String,
}, { collection: "users" });

// ── Role mapping ──────────────────────────────────────────────────────────
const mapRole = (role) => {
  if (!role) return "Sales";
  const r = role.toLowerCase();
  if (r === "globaladmin" || r === "superadmin") return "SuperAdmin";
  if (r === "admin")       return "Admin";
  if (r === "salesperson") return "Sales";
  // SO-style roles pass through
  return role;
};

async function seed() {
  const UNIFIED_URI = process.env.MONGO_URI_UNIFIED;
  const FURNI_URI   = process.env.MONGO_URI_FURNI;

  if (!UNIFIED_URI || !FURNI_URI) {
    console.error("ERROR: MONGO_URI_UNIFIED and MONGO_URI_FURNI must be set in .env");
    process.exit(1);
  }

  // Connect to both databases
  const unifiedConn = await mongoose.createConnection(UNIFIED_URI).asPromise();
  const furniConn   = await mongoose.createConnection(FURNI_URI).asPromise();

  const UnifiedUser = unifiedConn.model("UnifiedUser", unifiedUserSchema, "unifiedusers");
  const FurniUser   = furniConn.model("FurniUser", furniUserSchema);

  const furniUsers = await FurniUser.find({}).lean();
  console.log(`Found ${furniUsers.length} furni users to migrate.`);

  let created = 0;
  let skipped = 0;
  let errors  = 0;

  for (const u of furniUsers) {
    try {
      const existing = await UnifiedUser.findOne({ email: u.email, module: "furni" });
      if (existing) {
        console.log(`  SKIP  ${u.email} — already exists in unified (furni)`);
        skipped++;
        continue;
      }

      await UnifiedUser.create({
        username: u.username || u.email.split("@")[0],
        email:    u.email,
        password: u.password, // already hashed in source DB
        role:     mapRole(u.role),
        module:   "furni",
      });

      console.log(`  OK    ${u.email} → role: ${mapRole(u.role)}`);
      created++;
    } catch (err) {
      console.error(`  ERROR ${u.email}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone. Created: ${created}, Skipped: ${skipped}, Errors: ${errors}`);
  await unifiedConn.close();
  await furniConn.close();
  process.exit(0);
}

seed().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
