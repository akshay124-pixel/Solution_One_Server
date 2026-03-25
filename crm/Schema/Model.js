const mongoose = require("mongoose");
const { getCRMConnection } = require("../../utils/connections");

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ["superadmin", "admin", "globaladmin", "salesperson"],
    default: "salesperson",
  },
  assignedAdmin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  assignedAdmins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  refreshTokens: [String], // Whitelist of valid refresh tokens
});

module.exports = getCRMConnection().model("User", userSchema);
