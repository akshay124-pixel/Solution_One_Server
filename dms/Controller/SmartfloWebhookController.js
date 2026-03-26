/**
 * DMS Webhook Controller — adapted for unified portal
 * Uses lazy model getters instead of direct require
 */
const { getCallLog } = require("../Schema/CallLogModel");
const { getEntry } = require("../Schema/DataModel");
const { getUser } = require("../Schema/Model");
const crypto = require("crypto");
const { smartInvalidate } = require("../middleware/CacheMiddleware");

exports.handleCallEvents = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const Entry = getEntry();
    const User = getUser();
    const webhookData = req.body;

    const signature = req.headers['x-smartflo-signature'] || req.headers['x-smartflo-secret'];
    if (process.env.SMARTFLO_OUTBOUND_WEBHOOK_SECRET && signature) {
      if (!verifyWebhookSignature(signature, webhookData, process.env.SMARTFLO_OUTBOUND_WEBHOOK_SECRET) && process.env.NODE_ENV === 'production') {
        return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
      }
    }

    const { call_id, custom_identifier, event_type, call_status, agent_number, destination_number, caller_id, virtual_number, called_number, start_time, end_time, duration, recording_url, disposition, direction, queue_id, queue_wait_time, transfer_data, ivr_data, call_direction, caller_id_number, answered_agent, call_to_number } = webhookData;

    const virtualNum = virtual_number || called_number || agent_number;
    const isOutbound = direction === "clicktocall" || custom_identifier?.startsWith('CRM_');
    const isInbound = !isOutbound && (direction === "inbound" || call_direction === "inbound" || (caller_id && !custom_identifier));
    const callDirection = isOutbound ? "outbound" : (isInbound ? "inbound" : "outbound");
    const callId = call_id || `WEBHOOK_${Date.now()}`;

    let callLog = null;
    if (callId) callLog = await CallLog.findOne({ providerCallId: callId });
    if (!callLog && custom_identifier) callLog = await CallLog.findOne({ customIdentifier: custom_identifier });

    const agentNum = agent_number || (answered_agent && answered_agent.agent_number) || webhookData.answered_agent_number;
    const phoneToMatch = callDirection === "inbound" ? (caller_id || caller_id_number || destination_number || call_to_number) : (destination_number || call_to_number);

    let assignedUser = null;
    if (agentNum) assignedUser = await User.findOne({ smartfloAgentNumber: agentNum });
    if (!assignedUser && custom_identifier) {
      const parts = custom_identifier.split('_');
      if (parts.length >= 3) assignedUser = await User.findById(parts[2]).catch(() => null);
    }

    if (!callLog) {
      let lead = await Entry.findOne({ mobileNumber: phoneToMatch });
      if (!lead && callDirection === "inbound" && phoneToMatch) {
        lead = await createLeadForInboundCall(phoneToMatch, assignedUser, Entry, User);
      }
      if (!lead) {
        return res.status(200).json({ success: true, message: "Webhook received but no matching lead", action: "ignored" });
      }

      if (callDirection === "inbound") {
        if (!assignedUser && lead.createdBy) assignedUser = await User.findById(lead.createdBy).catch(() => null);
        if (!assignedUser) assignedUser = await User.findOne({ role: { $in: ["Admin","Superadmin","Globaladmin"] } });
      }
      if (!assignedUser) assignedUser = await User.findOne({ role: { $in: ["Admin","Superadmin","Globaladmin"] } });

      callLog = new CallLog({
        leadId: lead._id, userId: assignedUser ? assignedUser._id : null,
        agentNumber: agentNum || virtualNum,
        destinationNumber: callDirection === "inbound" ? (caller_id || caller_id_number || destination_number) : (destination_number || call_to_number),
        callerId: caller_id || caller_id_number, virtualNumber: virtualNum,
        providerCallId: callId, customIdentifier: custom_identifier,
        callStatus: mapSmartfloStatus(call_status || event_type), callDirection,
        queueId: queue_id, queueWaitTime: queue_wait_time ? parseInt(queue_wait_time) : 0,
        assignedAt: callDirection === "inbound" ? new Date() : null,
        routingReason: callDirection === "inbound" ? (queue_id ? "queue" : "direct") : "direct",
        source: "WEBHOOK", webhookData,
      });
    } else {
      callLog.callStatus = mapSmartfloStatus(call_status || event_type);
      callLog.webhookData = { ...callLog.webhookData, ...webhookData };
      if (!callLog.virtualNumber && virtualNum) callLog.virtualNumber = virtualNum;
      if (queue_id && !callLog.queueId) { callLog.queueId = queue_id; callLog.queueWaitTime = queue_wait_time ? parseInt(queue_wait_time) : 0; }
    }

    if (start_time) callLog.startTime = new Date(start_time);
    if (end_time) callLog.endTime = new Date(end_time);
    if (duration !== undefined) callLog.duration = parseInt(duration);
    if (recording_url) callLog.recordingUrl = recording_url;
    if (disposition) callLog.disposition = disposition;
    if (transfer_data) {
      callLog.transferData = { transferredFrom: transfer_data.from_agent, transferredTo: transfer_data.to_agent, transferReason: transfer_data.reason, transferTime: transfer_data.time ? new Date(transfer_data.time) : new Date(), transferType: transfer_data.type || "warm" };
    }
    if (ivr_data) {
      callLog.ivrData = { menuSelections: ivr_data.menu_selections || [], dtmfInputs: ivr_data.dtmf_inputs || [], ivrDuration: ivr_data.duration ? parseInt(ivr_data.duration) : 0 };
    }

    await callLog.save();
    smartInvalidate('calls', callLog.userId?.toString());

    if (callLog.leadId) {
      const lead = await Entry.findById(callLog.leadId);
      if (lead) {
        lead.lastCallDate = new Date();
        lead.lastCallStatus = callLog.callStatus;
        if (!lead.totalCallsMade) lead.totalCallsMade = 0;
        lead.totalCallsMade += 1;
        await lead.save();
      }
    }

    res.status(200).json({ success: true, message: "Webhook processed successfully", callLogId: callLog._id, direction: callLog.callDirection, virtualNumber: callLog.virtualNumber, leadId: callLog.leadId });
  } catch (error) {
    res.status(200).json({ success: false, message: "Webhook received but processing failed", error: error.message });
  }
};

exports.handleInboundCall = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const Entry = getEntry();
    const User = getUser();
    const webhookData = req.body;

    const signature = req.headers['x-smartflo-signature'] || req.headers['x-smartflo-secret'];
    if (process.env.SMARTFLO_INBOUND_WEBHOOK_SECRET && signature) {
      if (!verifyWebhookSignature(signature, webhookData, process.env.SMARTFLO_INBOUND_WEBHOOK_SECRET) && process.env.NODE_ENV === 'production') {
        return res.status(401).json({ success: false, message: 'Invalid inbound webhook signature' });
      }
    }

    const { call_id, caller_number, called_number, virtual_number, call_status, start_time, agent_number, queue_id, queue_wait_time } = webhookData;
    const virtualNum = virtual_number || called_number;
    const callerNum = caller_number;

    let lead = await Entry.findOne({ mobileNumber: callerNum });
    let isNewLead = false;

    if (!lead) {
      let defaultUser = await User.findOne({ role: { $in: ["Admin","Superadmin","Globaladmin"] } });
      if (!defaultUser) defaultUser = await User.findOne();
      lead = new Entry({ customerName: `Incoming Caller ${callerNum}`, mobileNumber: callerNum, status: "Not Found", organization: "Unknown", category: "Incoming Call", address: "Unknown", state: "Unknown", city: "Unknown", createdBy: defaultUser?._id });
      await lead.save();
      isNewLead = true;
    }

    let assignedUser = null;
    if (agent_number) assignedUser = await User.findOne({ smartfloAgentNumber: agent_number });
    if (!assignedUser && lead.createdBy) assignedUser = await User.findById(lead.createdBy).catch(() => null);
    if (!assignedUser) assignedUser = await User.findOne({ role: { $in: ["Admin","Superadmin","Globaladmin"] } });

    if (isNewLead && assignedUser && !lead.createdBy) { lead.createdBy = assignedUser._id; await lead.save(); }

    const callLog = new CallLog({ leadId: lead._id, userId: assignedUser ? assignedUser._id : null, agentNumber: agent_number || virtualNum, destinationNumber: callerNum, callerId: callerNum, virtualNumber: virtualNum, providerCallId: call_id, callStatus: mapSmartfloStatus(call_status), callDirection: "inbound", queueId: queue_id, queueWaitTime: queue_wait_time ? parseInt(queue_wait_time) : 0, assignedAt: new Date(), routingReason: queue_id ? "queue" : "direct", startTime: start_time ? new Date(start_time) : new Date(), source: "WEBHOOK", webhookData });
    await callLog.save();

    smartInvalidate('calls', callLog.userId?.toString());
    smartInvalidate('entries', callLog.userId?.toString());

    lead.lastCallDate = new Date();
    lead.lastCallStatus = "inbound_call";
    if (!lead.totalCallsMade) lead.totalCallsMade = 0;
    lead.totalCallsMade += 1;
    await lead.save();

    res.status(200).json({ success: true, message: "Inbound call logged successfully", callLogId: callLog._id, leadId: lead._id, virtualNumber: virtualNum, isNewLead, assignedAgent: assignedUser ? assignedUser.username : null });
  } catch (error) {
    res.status(200).json({ success: false, message: "Webhook received but processing failed", error: error.message });
  }
};

function mapSmartfloStatus(smartfloStatus) {
  if (!smartfloStatus) return "initiated";
  const status = smartfloStatus.toLowerCase();
  const statusMap = { "call.initiated":"initiated","call.ringing":"ringing","call.answered":"answered","call.completed":"completed","call.failed":"failed","call.no_answer":"no_answer","call.busy":"busy","call.cancelled":"cancelled","initiated":"initiated","ringing":"ringing","answered":"answered","completed":"completed","failed":"failed","no_answer":"no_answer","busy":"busy","cancelled":"cancelled","answer":"answered","pickup":"answered","connected":"answered","hangup":"completed","end":"completed","finished":"completed","noanswer":"no_answer","timeout":"no_answer","reject":"failed","error":"failed","declined":"failed","unreachable":"failed" };
  return statusMap[status] || "initiated";
}

function verifyWebhookSignature(signature, payload, secret) {
  try {
    if (!secret || !signature) return !secret;
    if (signature === secret) return true;
    const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
    const normalized = signature.startsWith('sha256=') ? signature.substring(7) : signature;
    return normalized === hash;
  } catch (_) { return false; }
}

async function createLeadForInboundCall(phoneNumber, assignedUser, Entry, User) {
  let defaultUser = assignedUser;
  if (!defaultUser) defaultUser = await User.findOne({ role: { $in: ["Admin","Superadmin","Globaladmin"] } });
  if (!defaultUser) defaultUser = await User.findOne();
  if (!defaultUser) throw new Error('No users available to assign as lead creator');
  const lead = new Entry({ customerName: `Incoming Caller ${phoneNumber}`, mobileNumber: phoneNumber, status: "Not Found", organization: "Unknown", category: "Incoming Call", address: "Unknown", state: "Unknown", city: "Unknown", createdBy: defaultUser._id });
  await lead.save();
  return lead;
}

module.exports = exports;
