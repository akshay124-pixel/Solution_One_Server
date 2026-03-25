const { getCallLog } = require("../Schema/CallLogModel");
const { getEntry } = require("../Schema/DataModel");
const { getUser } = require("../Schema/Model");
const { getScheduledCall } = require("../Schema/ScheduledCallModel");
const smartfloClient = require("../services/smartfloClient");

exports.clickToCall = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const Entry = getEntry();
    const User = getUser();
    const { leadId } = req.body;
    const userId = req.user.id;

    const lead = await Entry.findById(leadId);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    if (!lead.mobileNumber) return res.status(400).json({ success: false, message: "Lead does not have a phone number" });

    const user = await User.findById(userId);
    if (!user || !user.smartfloEnabled || !user.smartfloAgentNumber) {
      return res.status(400).json({ success: false, message: "User is not mapped to Smartflo agent. Please contact administrator." });
    }

    const callerId = user.smartfloAgentNumber;
    const customIdentifier = `CRM_${leadId}_${Date.now()}`;
    const customerName = lead.customerName || lead.contactName || "Customer";

    const payload = { agentNumber: user.smartfloAgentNumber, destinationNumber: lead.mobileNumber, callerId, customIdentifier, extraHeaders: { "From-Name": customerName, "X-Caller-Name": customerName } };
    const callResponse = await smartfloClient.clickToCall(payload);

    const callLog = new CallLog({ leadId: lead._id, userId: user._id, agentNumber: user.smartfloAgentNumber, destinationNumber: lead.mobileNumber, callerId, virtualNumber: user.smartfloAgentNumber, providerCallId: callResponse.call_id || callResponse.id, customIdentifier, callStatus: "initiated", callDirection: "outbound", source: "SMARTFLO", routingReason: "outbound" });
    await callLog.save();

    lead.totalCallsMade = (lead.totalCallsMade || 0) + 1;
    lead.lastCallDate = new Date();
    lead.lastCallStatus = "initiated";
    await lead.save();

    return res.status(200).json({ success: true, message: "Call initiated successfully", callLogId: callLog._id, providerCallId: callLog.providerCallId, customIdentifier, callerIdUsed: callerId, newCallCount: lead.totalCallsMade });
  } catch (error) {
    return res.status(error.response?.status || 500).json({ success: false, message: "Failed to initiate call", providerError: error.response?.data || null, error: error.message });
  }
};

exports.getCallLogs = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const { leadId, userId, status, startDate, endDate, page=1, limit=50 } = req.query;
    const filter = {};
    if (leadId) filter.leadId = leadId;
    if (userId) filter.userId = userId;
    if (status) filter.callStatus = status;
    if (startDate || endDate) { filter.createdAt = {}; if (startDate) filter.createdAt.$gte = new Date(startDate); if (endDate) filter.createdAt.$lte = new Date(endDate); }
    const skip = (parseInt(page)-1) * parseInt(limit);
    const callLogs = await CallLog.find(filter).populate("leadId","customerName contactName mobileNumber email").populate("userId","username email").sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
    const total = await CallLog.countDocuments(filter);
    res.status(200).json({ success: true, data: callLogs, pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total/parseInt(limit)) } });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch call logs", error: error.message });
  }
};

exports.getLeadCallHistory = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const { leadId } = req.params;
    const callLogs = await CallLog.find({ leadId }).populate("userId","username email").sort({ createdAt: -1 }).limit(100);
    res.status(200).json({ success: true, data: callLogs, total: callLogs.length });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch call history", error: error.message });
  }
};

exports.manualCallLog = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const Entry = getEntry();
    const User = getUser();
    const { leadId, duration, disposition, remarks, callStatus } = req.body;
    const userId = req.user.id;
    const lead = await Entry.findById(leadId);
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    const user = await User.findById(userId);
    const callLog = new CallLog({ leadId: lead._id, userId: user._id, agentNumber: user.smartfloAgentNumber || "manual", destinationNumber: lead.mobileNumber, callStatus: callStatus || "completed", callDirection: "outbound", duration: duration || 0, disposition, remarks, startTime: new Date(), endTime: new Date() });
    await callLog.save();
    lead.totalCallsMade = (lead.totalCallsMade || 0) + 1;
    lead.lastCallDate = new Date();
    lead.lastCallStatus = callStatus || "completed";
    await lead.save();
    res.status(200).json({ success: true, message: "Call logged successfully", callLogId: callLog._id });
  } catch (error) {
    res.status(500).json({ message: "Failed to log call", error: error.message });
  }
};

exports.scheduleCall = async (req, res) => {
  try {
    const ScheduledCall = getScheduledCall();
    const Entry = getEntry();
    const { leadId, scheduledTime, priority, purpose, notes } = req.body;
    const userId = req.user.id;
    if (!leadId || !scheduledTime || !purpose) return res.status(400).json({ success: false, message: "Lead ID, scheduled time, and purpose are required" });
    const scheduledDate = new Date(scheduledTime);
    if (scheduledDate <= new Date()) return res.status(400).json({ success: false, message: "Scheduled time must be in the future" });
    const lead = await Entry.findById(leadId);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    const scheduledCall = new ScheduledCall({ leadId, userId, scheduledTime: scheduledDate, priority: priority || "medium", purpose, notes: notes || "", status: "pending" });
    await scheduledCall.save();
    await scheduledCall.populate("leadId","customerName contactName mobileNumber email");
    await scheduledCall.populate("userId","username email");
    res.status(201).json({ success: true, message: "Call scheduled successfully", data: scheduledCall });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to schedule call", error: error.message });
  }
};

exports.getScheduledCalls = async (req, res) => {
  try {
    const ScheduledCall = getScheduledCall();
    const userId = req.user.id;
    const userRole = req.user.role;
    const { status, priority, purpose, startDate, endDate } = req.query;
    const filter = {};
    if (userRole !== "Admin" && userRole !== "Superadmin" && userRole !== "Globaladmin") filter.userId = userId;
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (purpose) filter.purpose = purpose;
    if (startDate || endDate) { filter.scheduledTime = {}; if (startDate) filter.scheduledTime.$gte = new Date(startDate); if (endDate) filter.scheduledTime.$lte = new Date(endDate); }
    const scheduledCalls = await ScheduledCall.find(filter).populate("leadId","customerName contactName mobileNumber email").populate("userId","username email").sort({ scheduledTime: 1 });
    res.status(200).json({ success: true, data: scheduledCalls, total: scheduledCalls.length });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch scheduled calls", error: error.message });
  }
};

exports.getLeadScheduledCalls = async (req, res) => {
  try {
    const ScheduledCall = getScheduledCall();
    const { leadId } = req.params;
    const scheduledCalls = await ScheduledCall.find({ leadId }).populate("userId","username email").sort({ scheduledTime: -1 });
    res.status(200).json({ success: true, data: scheduledCalls, total: scheduledCalls.length });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch scheduled calls", error: error.message });
  }
};

exports.updateScheduledCall = async (req, res) => {
  try {
    const ScheduledCall = getScheduledCall();
    const { id } = req.params;
    const { scheduledTime, priority, purpose, notes } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;
    const scheduledCall = await ScheduledCall.findById(id);
    if (!scheduledCall) return res.status(404).json({ success: false, message: "Scheduled call not found" });
    if (userRole !== "Admin" && userRole !== "Superadmin" && userRole !== "Globaladmin" && scheduledCall.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized to update this scheduled call" });
    }
    if (scheduledTime) {
      const newDate = new Date(scheduledTime);
      if (newDate <= new Date()) return res.status(400).json({ success: false, message: "Scheduled time must be in the future" });
      scheduledCall.scheduledTime = newDate;
    }
    if (priority) scheduledCall.priority = priority;
    if (purpose) scheduledCall.purpose = purpose;
    if (notes !== undefined) scheduledCall.notes = notes;
    await scheduledCall.save();
    await scheduledCall.populate("leadId","customerName contactName mobileNumber email");
    await scheduledCall.populate("userId","username email");
    res.status(200).json({ success: true, message: "Scheduled call updated successfully", data: scheduledCall });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update scheduled call", error: error.message });
  }
};

exports.completeScheduledCall = async (req, res) => {
  try {
    const ScheduledCall = getScheduledCall();
    const { id } = req.params;
    const { notes, outcome } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;
    const scheduledCall = await ScheduledCall.findById(id);
    if (!scheduledCall) return res.status(404).json({ success: false, message: "Scheduled call not found" });
    if (userRole !== "Admin" && userRole !== "Superadmin" && userRole !== "Globaladmin" && scheduledCall.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized to update this scheduled call" });
    }
    await scheduledCall.markCompleted(notes, outcome);
    await scheduledCall.populate("leadId","customerName contactName mobileNumber email");
    await scheduledCall.populate("userId","username email");
    res.status(200).json({ success: true, message: "Scheduled call marked as completed", data: scheduledCall });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to complete scheduled call", error: error.message });
  }
};

exports.deleteScheduledCall = async (req, res) => {
  try {
    const ScheduledCall = getScheduledCall();
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;
    const scheduledCall = await ScheduledCall.findById(id);
    if (!scheduledCall) return res.status(404).json({ success: false, message: "Scheduled call not found" });
    if (userRole !== "Admin" && userRole !== "Superadmin" && userRole !== "Globaladmin" && scheduledCall.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this scheduled call" });
    }
    await ScheduledCall.findByIdAndDelete(id);
    res.status(200).json({ success: true, message: "Scheduled call deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to delete scheduled call", error: error.message });
  }
};

exports.getUpcomingCalls = async (req, res) => {
  try {
    const ScheduledCall = getScheduledCall();
    const userId = req.user.id;
    const hours = parseInt(req.query.hours) || 24;
    const upcomingCalls = await ScheduledCall.findUpcoming(userId, hours);
    await ScheduledCall.populate(upcomingCalls, [
      { path: "leadId", select: "customerName contactName mobileNumber email" },
      { path: "userId", select: "username email" },
    ]);
    res.status(200).json({ success: true, data: upcomingCalls, total: upcomingCalls.length });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch upcoming calls", error: error.message });
  }
};

exports.getOverdueCalls = async (req, res) => {
  try {
    const ScheduledCall = getScheduledCall();
    const userId = req.user.id;
    const userRole = req.user.role;
    const filter = { status: "pending", scheduledTime: { $lt: new Date() } };
    if (userRole !== "Admin" && userRole !== "Superadmin" && userRole !== "Globaladmin") filter.userId = userId;
    const overdueCalls = await ScheduledCall.find(filter).populate("leadId","customerName contactName mobileNumber email").populate("userId","username email").sort({ scheduledTime: 1 });
    res.status(200).json({ success: true, data: overdueCalls, total: overdueCalls.length });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch overdue calls", error: error.message });
  }
};

exports.getScheduledCallsStats = async (req, res) => {
  try {
    const ScheduledCall = getScheduledCall();
    const userId = req.user.id;
    const userRole = req.user.role;
    const filter = {};
    if (userRole !== "Admin" && userRole !== "Superadmin" && userRole !== "Globaladmin") filter.userId = userId;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const [totalPending, todayCalls, highPriority, overdue, completed, missed] = await Promise.all([
      ScheduledCall.countDocuments({ ...filter, status: "pending" }),
      ScheduledCall.countDocuments({ ...filter, status: "pending", scheduledTime: { $gte: today, $lt: tomorrow } }),
      ScheduledCall.countDocuments({ ...filter, status: "pending", priority: { $in: ["high","urgent"] } }),
      ScheduledCall.countDocuments({ ...filter, status: "pending", scheduledTime: { $lt: now } }),
      ScheduledCall.countDocuments({ ...filter, status: "completed" }),
      ScheduledCall.countDocuments({ ...filter, status: "missed" }),
    ]);
    res.status(200).json({ success: true, data: { totalPending, todayCalls, highPriority, overdue, completed, missed } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch statistics", error: error.message });
  }
};
