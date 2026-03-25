/**
 * DMS User Model — uses DMS_Data connection
 * Lazy-initialized after getDMSConnection() is ready.
 */
const mongoose = require("mongoose");
const { getDMSConnection } = require("../../utils/connections");

const userSchema = new mongoose.Schema({
  username:            { type: String, required: true },
  email:               { type: String, required: true, unique: true },
  password:            { type: String, required: true },
  role:                { type: String, enum: ["Globaladmin", "Superadmin", "Admin", "salesperson", "Others"], default: "salesperson", required: true },
  lastPasswordChange:  { type: Date, default: Date.now },
  refreshToken:        { type: String, default: null },
  tokenVersion:        { type: Number, default: 0 },
  smartfloUserId:      { type: String, trim: true, sparse: true },
  smartfloAgentNumber: { type: String, trim: true, sparse: true },
  smartfloExtension:   { type: String, trim: true },
  smartfloEnabled:     { type: Boolean, default: false },
});

// Model is created once, on first require (after initConnections)
let User;
const getUser = () => {
  if (!User) User = getDMSConnection().model("User", userSchema);
  return User;
};

module.exports = { getUser };
