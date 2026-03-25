/**
 * Furni User Model — uses Furni_Data connection
 * Lazy-initialized after getFurniConnection() is ready.
 * Mirrors Sales_Order_Furni/Server/Models/Model.js but uses
 * the furni connection instead of the default mongoose connection.
 */
const mongoose = require("mongoose");
const { getFurniConnection } = require("../../utils/connections");

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    match: [
      /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
      "Please fill a valid email address",
    ],
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: [
      "Production",
      "salesperson",
      "Installation",
      "Finish",
      "Accounts",
      "Admin",
      "SuperAdmin",
      "GlobalAdmin",
      "Verification",
      "Bill",
      "ProductionApproval",
    ],
    default: "salesperson",
    required: true,
  },
  assignedToLeader: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
});

// Model is created once, on first require (after initConnections)
let User;
const getUser = () => {
  if (!User) User = getFurniConnection().model("User", userSchema);
  return User;
};

module.exports = { getUser };
