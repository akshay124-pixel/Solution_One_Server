const smartfloClient     = require("../services/smartfloClient");
const { getCallLog }     = require("../Schema/CallLogModel");

exports.getActiveCalls = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const currentUser = req.user;
    const activeCallsResponse = await smartfloClient.getActiveCalls();
    let activeCalls = activeCallsResponse.data || activeCallsResponse.calls || [];
    if (currentUser.role !== "Admin" && currentUser.role !== "Superadmin" && currentUser.role !== "Globaladmin") {
      activeCalls = activeCalls.filter((call) => call.agent_number === currentUser.smartfloAgentNumber);
    }
    const enrichedCalls = await Promise.all(activeCalls.map(async (call) => {
      const callLog = await CallLog.findOne({ providerCallId: call.call_id || call.id }).populate("leadId", "customerName contactName mobileNumber email").populate("userId", "username email").lean();
      return { ...call, crmData: callLog || null };
    }));
    res.status(200).json({ success: true, data: enrichedCalls, total: enrichedCalls.length });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch active calls", error: error.message });
  }
};

exports.hangupCall = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const { callId } = req.params;
    const callLog = await CallLog.findOne({ providerCallId: callId });
    if (callLog && req.user.role !== "Admin" && req.user.role !== "Superadmin" && req.user.role !== "Globaladmin" && callLog.userId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }
    const result = await smartfloClient.hangupCall(callId);
    if (callLog) { callLog.callStatus = "cancelled"; callLog.endTime = new Date(); await callLog.save(); }
    res.status(200).json({ success: true, message: "Call hangup initiated", data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to hangup call", error: error.message });
  }
};

exports.transferCall = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const { callId } = req.params;
    const { transferTo, transferType = "blind" } = req.body;
    if (!transferTo) return res.status(400).json({ success: false, message: "Transfer destination required" });
    const callLog = await CallLog.findOne({ providerCallId: callId });
    if (callLog && req.user.role !== "Admin" && req.user.role !== "Superadmin" && req.user.role !== "Globaladmin" && callLog.userId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const result = await smartfloClient.transferCall(callId, transferTo, transferType);
    res.status(200).json({ success: true, message: "Call transfer initiated", data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to transfer call", error: error.message });
  }
};

exports.holdCall = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const { callId } = req.params;
    const { action = "hold" } = req.body;
    const callLog = await CallLog.findOne({ providerCallId: callId });
    if (callLog && req.user.role !== "Admin" && req.user.role !== "Superadmin" && req.user.role !== "Globaladmin" && callLog.userId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const result = await smartfloClient.holdCall(callId, action);
    res.status(200).json({ success: true, message: `Call ${action} successful`, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to hold/unhold call", error: error.message });
  }
};

exports.getCallStatus = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const { callId } = req.params;
    const callLog = await CallLog.findOne({ providerCallId: callId }).populate("leadId", "customerName contactName mobileNumber").populate("userId", "username email").lean();
    if (callLog) return res.status(200).json({ success: true, data: { ...callLog, source: "database" } });
    const smartfloStatus = await smartfloClient.getCallStatus(callId);
    res.status(200).json({ success: true, data: { ...smartfloStatus, source: "smartflo" } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch call status", error: error.message });
  }
};

module.exports = exports;
