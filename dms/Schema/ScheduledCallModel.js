const mongoose = require("mongoose");
const { getDMSConnection } = require("../../utils/connections");

const ScheduledCallSchema = new mongoose.Schema({
  leadId:          { type: mongoose.Schema.Types.ObjectId, ref: "Entry", required: true, index: true },
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  scheduledTime:   { type: Date, required: true, index: true },
  priority:        { type: String, enum: ["low","medium","high","urgent"], default: "medium", index: true },
  purpose:         { type: String, enum: ["follow_up","demo","negotiation","closing","support","feedback","renewal","upsell","other"], required: true },
  notes:           { type: String, trim: true, maxlength: 1000 },
  status:          { type: String, enum: ["pending","completed","cancelled","missed"], default: "pending", index: true },
  completedAt:     { type: Date },
  completionNotes: { type: String, trim: true, maxlength: 500 },
  outcome:         { type: String, enum: ["successful","no_answer","busy","voicemail","callback_requested","not_interested"] },
  callLogId:       { type: mongoose.Schema.Types.ObjectId, ref: "CallLog" },
  reminderSent:    { type: Boolean, default: false },
  createdAt:       { type: Date, default: Date.now, index: true },
  updatedAt:       { type: Date, default: Date.now },
});

ScheduledCallSchema.pre("save", function (next) { this.updatedAt = Date.now(); next(); });
ScheduledCallSchema.index({ userId: 1, scheduledTime: 1 });
ScheduledCallSchema.index({ leadId: 1, status: 1 });
ScheduledCallSchema.index({ status: 1, scheduledTime: 1 });
ScheduledCallSchema.virtual("isOverdue").get(function () { return this.status === "pending" && this.scheduledTime < new Date(); });
ScheduledCallSchema.methods.markCompleted = function (notes, outcome) { this.status = "completed"; this.completedAt = new Date(); this.completionNotes = notes || ""; this.outcome = outcome || "successful"; return this.save(); };
ScheduledCallSchema.methods.markMissed = function () { this.status = "missed"; return this.save(); };
ScheduledCallSchema.statics.findOverdue = function () { return this.find({ status: "pending", scheduledTime: { $lt: new Date() } }); };
ScheduledCallSchema.statics.findUpcoming = function (userId, hours = 24) {
  const now = new Date();
  const future = new Date(now.getTime() + hours * 60 * 60 * 1000);
  return this.find({ userId, status: "pending", scheduledTime: { $gte: now, $lte: future } }).sort({ scheduledTime: 1 });
};

let ScheduledCall;
const getScheduledCall = () => {
  if (!ScheduledCall) ScheduledCall = getDMSConnection().model("ScheduledCall", ScheduledCallSchema);
  return ScheduledCall;
};

module.exports = { getScheduledCall };
