const mongoose = require("mongoose");
const { getDMSConnection } = require("../../utils/connections");

const CallLogSchema = new mongoose.Schema({
  leadId:            { type: mongoose.Schema.Types.ObjectId, ref: "Entry", required: true, index: true },
  userId:            { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  agentNumber:       { type: String, required: true, trim: true },
  destinationNumber: { type: String, required: true, trim: true },
  callerId:          { type: String, trim: true },
  providerCallId:    { type: String, unique: true, sparse: true, index: true },
  customIdentifier:  { type: String, trim: true },
  callStatus:        { type: String, enum: ["initiated","ringing","answered","completed","failed","no_answer","busy","cancelled"], default: "initiated", index: true },
  callDirection:     { type: String, enum: ["outbound","inbound"], default: "outbound", required: true, index: true },
  virtualNumber:     { type: String, trim: true, index: true },
  queueId:           { type: String, trim: true },
  queueWaitTime:     { type: Number, default: 0, min: 0 },
  assignedAt:        { type: Date },
  routingReason:     { type: String, enum: ["direct","queue","transfer","callback","ivr","outbound"], default: "direct" },
  startTime:         { type: Date, default: Date.now },
  endTime:           { type: Date },
  duration:          { type: Number, default: 0, min: 0 },
  recordingUrl:      { type: String, trim: true },
  disposition:       { type: String, trim: true },
  remarks:           { type: String, trim: true, maxlength: 1000 },
  source:            { type: String, enum: ["SMARTFLO","MANUAL","WEBHOOK"], default: "SMARTFLO", required: true },
  transferData:      { transferredFrom: String, transferredTo: String, transferReason: String, transferTime: Date, transferType: { type: String, enum: ["blind","attended","warm"] } },
  ivrData:           { menuSelections: [String], dtmfInputs: [String], ivrDuration: Number },
  webhookData:       { type: mongoose.Schema.Types.Mixed },
  createdAt:         { type: Date, default: Date.now, index: true },
  updatedAt:         { type: Date, default: Date.now },
});

CallLogSchema.pre("save", function (next) { this.updatedAt = Date.now(); next(); });
CallLogSchema.index({ leadId: 1, createdAt: -1 });
CallLogSchema.index({ userId: 1, createdAt: -1 });
CallLogSchema.index({ callStatus: 1, createdAt: -1 });
CallLogSchema.index({ callDirection: 1, createdAt: -1 });
CallLogSchema.index({ virtualNumber: 1, createdAt: -1 });
CallLogSchema.index({ providerCallId: 1 });

let CallLog;
const getCallLog = () => {
  if (!CallLog) CallLog = getDMSConnection().model("CallLog", CallLogSchema);
  return CallLog;
};

module.exports = { getCallLog };
