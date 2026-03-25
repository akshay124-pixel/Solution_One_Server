/**
 * seedUnifiedUsers.js
 *
 * Run ONCE to populate the UnifiedUser collection from existing CRM and SO user collections.
 * Existing collections are NOT modified.
 *
 * CRITICAL: We preserve the original _id from each source collection so that
 * the unified JWT token's `id` field matches the `createdBy` / `assignedTo`
 * ObjectIds stored in CRM entries and SO orders.
 *
 * Matching strategy (in order):
 *   1. Email match (exact, case-insensitive)
 *   2. Username match (case-insensitive) — catches same person with different email domains
 *      e.g. "Arwinder Singh" at arwinder@crm.web (CRM) and Arwinder@so.app (SO)
 *
 * Usage:
 *   cd unified-portal/server
 *   node scripts/seedUnifiedUsers.js [--reset]
 */
require("dotenv").config({ path: require("path").join(__dirname, "/../.env") });
const mongoose = require("mongoose");

const CRM_DB_URL = process.env.CRM_DB_URL;
const SO_DB_URL  = process.env.SO_DB_URL;

if (!CRM_DB_URL || !SO_DB_URL) {
  console.error("Missing CRM_DB_URL or SO_DB_URL in .env");
  process.exit(1);
}

// ── Schemas (inline — no connection dependency) ───────────────────────────────
const crmUserSchema = new mongoose.Schema({
  username: String, email: String, password: String,
  role: String, assignedAdmin: mongoose.Schema.Types.ObjectId,
  assignedAdmins: [mongoose.Schema.Types.ObjectId], refreshTokens: [String],
});

const soUserSchema = new mongoose.Schema({
  username: String, email: String, password: String,
  role: String, assignedToLeader: mongoose.Schema.Types.ObjectId,
});

// _id is NOT auto-generated here — we supply it from the source collection
const unifiedUserSchema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  username: { type: String, required: true },
  role: { type: String, required: true },
  app_module: { type: String, enum: ["crm", "so", "both"], required: true },
  assignedAdmin: { type: mongoose.Schema.Types.ObjectId, default: null },
  assignedAdmins: [{ type: mongoose.Schema.Types.ObjectId }],
  refreshTokens: [String],
  assignedToLeader: { type: mongoose.Schema.Types.ObjectId, default: null },
  // Store the SO user's _id for users that exist in both apps
  soUserId: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { timestamps: true });

async function run() {
  const reset = process.argv.includes("--reset");
  console.log("Connecting to databases...");

  const crmConn = await mongoose.createConnection(CRM_DB_URL).asPromise();
  const soConn  = await mongoose.createConnection(SO_DB_URL).asPromise();

  const CRMUser     = crmConn.model("User", crmUserSchema);
  const SOUser      = soConn.model("User", soUserSchema);
  const UnifiedUser = crmConn.model("UnifiedUser", unifiedUserSchema);

  if (reset) {
    console.log("--reset flag detected: dropping existing UnifiedUser collection...");
    await UnifiedUser.deleteMany({});
    console.log("Collection cleared.");
  }

  const crmUsers = await CRMUser.find({}).lean();
  const soUsers  = await SOUser.find({}).lean();

  console.log(`Found ${crmUsers.length} CRM users, ${soUsers.length} SO users`);

  // Build lookup maps for SO users
  const soByEmail    = new Map(soUsers.map(u => [u.email?.toLowerCase().trim(), u]));
  const soByUsername = new Map(soUsers.map(u => [u.username?.toLowerCase().trim(), u]));

  let created = 0, skipped = 0, updated = 0;

  // ── Seed CRM users — use CRM _id as UnifiedUser _id ─────────────────────────
  for (const u of crmUsers) {
    const email = u.email?.toLowerCase().trim();
    if (!email) { skipped++; continue; }

    // Find matching SO user: email first, then username
    const soMatch =
      soByEmail.get(email) ||
      soByUsername.get(u.username?.toLowerCase().trim());

    const existing = await UnifiedUser.findOne({ email });
    if (existing) {
      // If SO match found and not yet linked, update to "both"
      if (soMatch && existing.app_module !== "both") {
        existing.app_module = "both";
        existing.soUserId = soMatch._id;
        await existing.save();
        updated++;
        console.log(`  Updated (both): ${email} → soUserId: ${soMatch._id} (${soMatch.username})`);
      } else {
        skipped++;
      }
      continue;
    }

    const doc = {
      _id: u._id,           // ← preserve original CRM _id
      email,
      password: u.password,
      username: u.username,
      role: u.role,
      app_module: soMatch ? "both" : "crm",
      assignedAdmin: u.assignedAdmin || null,
      assignedAdmins: u.assignedAdmins || [],
      refreshTokens: [],
    };
    if (soMatch) {
      doc.soUserId = soMatch._id;
    }

    await UnifiedUser.create(doc);
    created++;
    if (soMatch) {
      console.log(`  Created (both): ${email} → crmId: ${u._id}, soUserId: ${soMatch._id}`);
    } else {
      console.log(`  Created CRM: ${email} (id: ${u._id})`);
    }
  }

  // ── Seed SO users — use SO _id as UnifiedUser _id (skip if already seeded) ──
  for (const u of soUsers) {
    const email = u.email?.toLowerCase().trim();
    if (!email) { skipped++; continue; }

    // Check if already seeded via CRM (email or username match)
    const existingByEmail    = await UnifiedUser.findOne({ email });
    const existingByUsername = !existingByEmail
      ? await UnifiedUser.findOne({ username: { $regex: new RegExp(`^${u.username?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } })
      : null;
    const existing = existingByEmail || existingByUsername;

    if (existing) {
      // Already seeded from CRM — mark as "both", store soUserId if not already
      if (existing.app_module === "crm" && !existing.soUserId) {
        existing.app_module = "both";
        existing.soUserId = u._id;
        await existing.save();
        updated++;
        console.log(`  Updated (both): ${existing.email} → soUserId: ${u._id} (${u.username})`);
      } else {
        skipped++;
      }
      continue;
    }

    await UnifiedUser.create({
      _id: u._id,           // ← preserve original SO _id
      email,
      password: u.password,
      username: u.username,
      role: u.role,
      app_module: "so",
      assignedToLeader: u.assignedToLeader || null,
      refreshTokens: [],
    });
    created++;
    console.log(`  Created SO: ${email} (id: ${u._id})`);
  }

  console.log(`\nSeed complete:`);
  console.log(`  Created : ${created}`);
  console.log(`  Updated : ${updated}`);
  console.log(`  Skipped : ${skipped}`);

  await crmConn.close();
  await soConn.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
