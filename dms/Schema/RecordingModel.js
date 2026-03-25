const mongoose = require("mongoose");
const { getDMSConnection } = require("../../utils/connections");

const RecordingSchema = new mongoose.Schema({
  callLogId:     { type: mongoose.Schema.Types.ObjectId, ref: "CallLog", required: true, index: true },
  recordingId:   { type: String, unique: true, sparse: true, index: true },
  recordingUrl:  { type: String, trim: true },
  status:        { type: String, enum: ["pending","available","downloaded","failed","expired"], default: "pending", index: true },
  duration:      { type: Number, default: 0, min: 0 },
  fileSize:      { type: Number, default: 0 },
  format:        { type: String, default: "mp3" },
  localPath:     { type: String, trim: true },
  urlExpiresAt:  { type: Date },
  lastAccessedAt:{ type: Date },
  accessCount:   { type: Number, default: 0 },
  createdAt:     { type: Date, default: Date.now, index: true },
  updatedAt:     { type: Date, default: Date.now },
});

RecordingSchema.pre("save", function (next) { this.updatedAt = Date.now(); next(); });
RecordingSchema.index({ callLogId: 1, status: 1 });
RecordingSchema.index({ status: 1, createdAt: -1 });
RecordingSchema.methods.isUrlExpired = function () { return this.urlExpiresAt ? Date.now() >= this.urlExpiresAt.getTime() : false; };
RecordingSchema.methods.recordAccess = async function () { this.accessCount += 1; this.lastAccessedAt = new Date(); await this.save(); };

let Recording;
const getRecording = () => {
  if (!Recording) Recording = getDMSConnection().model("Recording", RecordingSchema);
  return Recording;
};

module.exports = { getRecording };
