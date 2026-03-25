const mongoose = require("mongoose");
const { getCRMConnection } = require("../../utils/connections");

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  message: { type: String, required: true },
  entryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Entry",
    required: false,
  },
  read: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now },
});

module.exports = getCRMConnection().model("Notification", notificationSchema);
