const mongoose = require("mongoose");
const { getCRMConnection } = require("../../utils/connections");

const attendanceSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  checkIn: {
    type: Date,
  },
  checkOut: {
    type: Date,
  },
  status: {
    type: String,
    enum: ["Present", "Absent", "Late", "Leave"],
    default: "Absent",
  },
  remarks: {
    type: String,
  },
  checkInLocation: {
    latitude: { type: Number },
    longitude: { type: Number },
  },
  checkOutLocation: {
    latitude: { type: Number },
    longitude: { type: Number },
  },
  liveLocation: {
    type: String,
  },
});

module.exports = getCRMConnection().model("Attendance", attendanceSchema);
