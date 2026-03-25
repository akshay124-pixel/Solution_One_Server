/**
 * One-time migration: update role "Sales" → "salesperson" in Furni DB
 * Run from mydata/server: node scripts/migrateFurniSalesToSalesperson.js
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

async function run() {
  if (!process.env.FURNI_DB_URL) {
    console.error("FURNI_DB_URL not set in .env");
    process.exit(1);
  }

  console.log("Connecting to Furni DB...");
  const conn = await mongoose.createConnection(process.env.FURNI_DB_URL).asPromise();

  const schema = new mongoose.Schema({}, { strict: false });
  const User = conn.model("User", schema);

  // Check how many need updating
  const count = await User.countDocuments({ role: "Sales" });
  console.log(`Found ${count} user(s) with role "Sales"`);

  if (count > 0) {
    const result = await User.updateMany({ role: "Sales" }, { $set: { role: "salesperson" } });
    console.log(`Updated ${result.modifiedCount} user(s) from "Sales" → "salesperson"`);
  } else {
    console.log("Nothing to migrate.");
  }

  await conn.close();
  console.log("Done.");
}

run().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
