const mongoose = require("mongoose");
const { getDMSConnection } = require("../../utils/connections");

const SmartfloConfigSchema = new mongoose.Schema({
  leadListId:       { type: String, trim: true, index: true },
  leadListName:     { type: String, required: true, trim: true },
  campaignId:       { type: String, trim: true, index: true },
  campaignName:     { type: String, trim: true },
  campaignType:     { type: String, enum: ["progressive","predictive","preview","manual"], default: "progressive" },
  segmentCriteria:  { status: [String], category: [String], state: [String], city: [String], dateRange: { from: Date, to: Date } },
  isActive:         { type: Boolean, default: true },
  totalLeadsSynced: { type: Number, default: 0 },
  lastSyncDate:     { type: Date },
  createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  createdAt:        { type: Date, default: Date.now },
  updatedAt:        { type: Date, default: Date.now },
});

SmartfloConfigSchema.pre("save", function (next) { this.updatedAt = Date.now(); next(); });

let SmartfloConfig;
const getSmartfloConfig = () => {
  if (!SmartfloConfig) SmartfloConfig = getDMSConnection().model("SmartfloConfig", SmartfloConfigSchema);
  return SmartfloConfig;
};

module.exports = { getSmartfloConfig };
