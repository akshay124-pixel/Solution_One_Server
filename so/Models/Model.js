const mongoose = require("mongoose");
const { getSOConnection } = require("../../utils/connections");

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
      "Watch",
      "Production",
      "salesperson",
      "Installation",
      "Finish",
      "Accounts",
      "admin",
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

const User = getSOConnection().model("User", userSchema);

module.exports = User;
