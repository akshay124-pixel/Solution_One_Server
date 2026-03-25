const mongoose = require("mongoose");
const { getCallLog } = require("../Schema/CallLogModel");
const { getRecording } = require("../Schema/RecordingModel");
const smartfloClient = require("../services/smartfloClient");
const { Parser } = require("json2csv");
const axios = require("axios");
const { getCachedData, setcache, smartInvalidate } = require("../middleware/CacheMiddleware");

exports.getCallHistory = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const Recording = getRecording();
    const { page=1, limit=50, userId, leadId, status, direction, startDate, endDate, agentNumber, destinationNumber, virtualNumber, hasRecording, sortBy="createdAt", sortOrder="desc" } = req.query;
    const currentUser = req.user;

    const cacheKey = `call_history_${currentUser.id}_${currentUser.role}_${page}_${limit}_${userId||'all'}_${leadId||'all'}_${status||'all'}_${direction||'all'}_${startDate||'all'}_${endDate||'all'}_${agentNumber||'all'}_${destinationNumber||'all'}_${virtualNumber||'all'}_${hasRecording||'all'}_${sortBy}_${sortOrder}`;
    const cachedResult = getCachedData(cacheKey);
    if (cachedResult) return res.status(200).json(cachedResult);

    const filter = {};
    if (currentUser.role !== "Admin" && currentUser.role !== "Superadmin" && currentUser.role !== "Globaladmin") {
      filter.userId = mongoose.Types.ObjectId.createFromHexString(currentUser.id);
    } else if (userId) {
      filter.userId = mongoose.Types.ObjectId.createFromHexString(userId);
    }

    if (leadId) filter.leadId = leadId;
    if (status) filter.callStatus = status;
    if (direction) filter.callDirection = direction;
    if (agentNumber) filter.agentNumber = new RegExp(agentNumber, "i");
    if (destinationNumber) filter.destinationNumber = new RegExp(destinationNumber, "i");
    if (virtualNumber) filter.virtualNumber = new RegExp(virtualNumber, "i");
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) { const end = new Date(endDate); end.setHours(23,59,59,999); filter.createdAt.$lte = end; }
    }
    if (hasRecording === "true") filter.recordingUrl = { $exists: true, $ne: null };

    const skip = (parseInt(page)-1) * parseInt(limit);
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;

    const [calls, total] = await Promise.all([
      CallLog.find(filter).populate("leadId","customerName contactName mobileNumber email organization").populate("userId","username email smartfloAgentNumber").sort(sortOptions).skip(skip).limit(parseInt(limit)).lean(),
      CallLog.countDocuments(filter),
    ]);

    const callsWithRecordings = await Promise.all(calls.map(async (call) => {
      if (call.recordingUrl) {
        const recording = await Recording.findOne({ callLogId: call._id });
        call.recording = recording ? { id: recording._id, status: recording.status, duration: recording.duration, format: recording.format } : null;
      }
      return call;
    }));

    const result = { success: true, data: callsWithRecordings, pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total/parseInt(limit)), hasMore: skip+calls.length < total } };
    setcache(cacheKey, result, 30);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch call history", error: error.message });
  }
};

exports.getCallDetails = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const Recording = getRecording();
    const { id } = req.params;
    const currentUser = req.user;
    const cacheKey = `call_details_${id}_${currentUser.id}`;
    const cachedCall = getCachedData(cacheKey);
    if (cachedCall) return res.status(200).json(cachedCall);

    const call = await CallLog.findById(id).populate("leadId").populate("userId","username email smartfloAgentNumber").lean();
    if (!call) return res.status(404).json({ success: false, message: "Call not found" });

    if (currentUser.role !== "Admin" && currentUser.role !== "Superadmin" && currentUser.role !== "Globaladmin" && call.userId._id.toString() !== currentUser.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    if (call.recordingUrl) {
      const recording = await Recording.findOne({ callLogId: call._id });
      call.recording = recording;
    }

    const result = { success: true, data: call };
    setcache(cacheKey, result, 600);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch call details", error: error.message });
  }
};

exports.streamRecording = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const Recording = getRecording();
    const { id } = req.params;
    const currentUser = req.user;

    const call = await CallLog.findById(id);
    if (!call) return res.status(404).json({ success: false, message: "Call not found" });

    if (currentUser.role !== "Admin" && currentUser.role !== "Superadmin" && currentUser.role !== "Globaladmin" && call.userId.toString() !== currentUser.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (!call.recordingUrl) return res.status(404).json({ success: false, message: "Recording not available" });

    let recording = await Recording.findOne({ callLogId: call._id });
    if (!recording) {
      recording = new Recording({ callLogId: call._id, recordingUrl: call.recordingUrl, status: "available", duration: call.duration });
      await recording.save();
    }
    await recording.recordAccess();

    try {
      const response = await axios({ method: "GET", url: call.recordingUrl, responseType: "stream", timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'audio/*,*/*;q=0.9' } });
      let contentType = response.headers["content-type"] || "audio/mpeg";
      if (contentType.includes('audio/mp3') || contentType.includes('audio/x-mpeg')) contentType = "audio/mpeg";
      else if (!contentType.startsWith('audio/')) contentType = "audio/mpeg";

      res.setHeader("Content-Type", contentType);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "private, max-age=3600");
      if (response.headers["content-length"]) res.setHeader("Content-Length", response.headers["content-length"]);

      response.data.on('error', (e) => { if (!res.headersSent) res.status(500).json({ success: false, message: "Stream interrupted" }); });
      response.data.pipe(res);
    } catch (streamError) {
      recording.status = "failed";
      await recording.save();
      res.status(500).json({ success: false, message: "Failed to stream recording", error: streamError.message });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to access recording", error: error.message });
  }
};

exports.getRecordingMetadata = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const Recording = getRecording();
    const { id } = req.params;
    const currentUser = req.user;

    const call = await CallLog.findById(id);
    if (!call) return res.status(404).json({ success: false, message: "Call not found" });
    if (currentUser.role !== "Admin" && currentUser.role !== "Superadmin" && currentUser.role !== "Globaladmin" && call.userId.toString() !== currentUser.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (!call.recordingUrl) return res.status(404).json({ success: false, message: "Recording not available for this call" });

    let recording = await Recording.findOne({ callLogId: call._id });
    if (!recording) {
      recording = new Recording({ callLogId: call._id, recordingUrl: call.recordingUrl, status: "available", duration: call.duration, format: "mp3" });
      try {
        const headResponse = await axios.head(call.recordingUrl, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (headResponse.headers['content-length']) recording.fileSize = parseInt(headResponse.headers['content-length']);
        const ct = headResponse.headers['content-type'] || '';
        if (ct.includes('wav')) recording.format = 'wav';
        else if (ct.includes('ogg')) recording.format = 'ogg';
      } catch (_) { /* use defaults */ }
      await recording.save();
    }

    res.status(200).json({ success: true, data: { ...recording.toObject(), streamUrl: `/api/dms/recordings/${call._id}/stream`, directUrl: call.recordingUrl, isExpired: recording.isUrlExpired ? recording.isUrlExpired() : false } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch recording metadata", error: error.message });
  }
};

exports.exportCallHistory = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const { userId, leadId, status, direction, startDate, endDate, format="csv" } = req.body;
    const currentUser = req.user;
    const filter = {};

    if (currentUser.role !== "Admin" && currentUser.role !== "Superadmin" && currentUser.role !== "Globaladmin") {
      filter.userId = mongoose.Types.ObjectId.createFromHexString(currentUser.id);
    } else if (userId) {
      filter.userId = mongoose.Types.ObjectId.createFromHexString(userId);
    }

    if (leadId) filter.leadId = leadId;
    if (status) filter.callStatus = status;
    if (direction) filter.callDirection = direction;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) { const end = new Date(endDate); end.setHours(23,59,59,999); filter.createdAt.$lte = end; }
    }

    const calls = await CallLog.find(filter).populate("leadId","customerName contactName mobileNumber email organization").populate("userId","username email").sort({ createdAt: -1 }).limit(10000).lean();
    if (!calls.length) return res.status(404).json({ success: false, message: "No calls found for export" });

    const exportData = calls.map((call) => ({
      "Call ID": call._id, "Date": new Date(call.createdAt).toLocaleString(),
      "Agent": call.userId?.username || "N/A", "Agent Number": call.agentNumber,
      "Customer Name": call.leadId?.contactName || call.leadId?.customerName || "N/A",
      "Customer Number": call.destinationNumber, "Direction": call.callDirection,
      "Status": call.callStatus, "Duration (sec)": call.duration || 0,
      "Recording": call.recordingUrl ? "Yes" : "No",
    }));

    if (format === "csv") {
      const parser = new Parser();
      const csv = parser.parse(exportData);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=call-history-${Date.now()}.csv`);
      res.send(csv);
    } else {
      res.status(200).json({ success: true, data: exportData, total: exportData.length });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to export call history", error: error.message });
  }
};

exports.getCallStats = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const { startDate, endDate, userId } = req.query;
    const currentUser = req.user;
    const cacheKey = `call_stats_${currentUser.id}_${currentUser.role}_${userId||'all'}_${startDate||'all'}_${endDate||'all'}`;
    const cachedStats = getCachedData(cacheKey);
    if (cachedStats) return res.status(200).json(cachedStats);

    const filter = {};
    if (currentUser.role !== "Admin" && currentUser.role !== "Superadmin" && currentUser.role !== "Globaladmin") {
      filter.userId = mongoose.Types.ObjectId.createFromHexString(currentUser.id);
    } else if (userId) {
      filter.userId = mongoose.Types.ObjectId.createFromHexString(userId);
    }
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) { const end = new Date(endDate); end.setHours(23,59,59,999); filter.createdAt.$lte = end; }
    }

    const stats = await CallLog.aggregate([
      { $match: filter },
      { $group: { _id: null, totalCalls: { $sum: 1 }, completedCalls: { $sum: { $cond: [{ $eq: ["$callStatus","completed"] }, 1, 0] } }, answeredCalls: { $sum: { $cond: [{ $eq: ["$callStatus","answered"] }, 1, 0] } }, failedCalls: { $sum: { $cond: [{ $eq: ["$callStatus","failed"] }, 1, 0] } }, noAnswerCalls: { $sum: { $cond: [{ $eq: ["$callStatus","no_answer"] }, 1, 0] } }, inboundCalls: { $sum: { $cond: [{ $eq: ["$callDirection","inbound"] }, 1, 0] } }, outboundCalls: { $sum: { $cond: [{ $eq: ["$callDirection","outbound"] }, 1, 0] } }, totalDuration: { $sum: "$duration" }, avgDuration: { $avg: "$duration" }, callsWithRecording: { $sum: { $cond: [{ $and: [{ $ne: ["$recordingUrl",null] }, { $ne: ["$recordingUrl",""] }] }, 1, 0] } } } },
    ]);

    const result = stats[0] || { totalCalls:0, completedCalls:0, answeredCalls:0, failedCalls:0, noAnswerCalls:0, inboundCalls:0, outboundCalls:0, totalDuration:0, avgDuration:0, callsWithRecording:0 };
    const successful = result.completedCalls + result.answeredCalls;
    result.completionRate = result.totalCalls > 0 ? parseFloat(((successful/result.totalCalls)*100).toFixed(2)) : 0;
    result.answerRate = result.totalCalls > 0 ? parseFloat(((result.answeredCalls/result.totalCalls)*100).toFixed(2)) : 0;

    const response = { success: true, data: result };
    setcache(cacheKey, response, 60);
    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch call statistics", error: error.message });
  }
};

exports.debugRecordings = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const calls = await CallLog.find({ recordingUrl: { $exists: true, $ne: null, $ne: "" } }).populate("leadId","customerName contactName").populate("userId","username").limit(10).lean();
    res.status(200).json({ success: true, data: calls.map(c => ({ id: c._id, customer: c.leadId?.customerName || c.leadId?.contactName, agent: c.userId?.username, recordingUrl: c.recordingUrl, status: c.callStatus, duration: c.duration, createdAt: c.createdAt })), total: calls.length });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch debug recordings", error: error.message });
  }
};

exports.refreshCache = async (req, res) => {
  try {
    const currentUser = req.user;
    const { dataType = 'calls', userId } = req.body;
    smartInvalidate(dataType, userId || currentUser.id);
    res.status(200).json({ success: true, message: `${dataType} cache refreshed successfully`, refreshedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to refresh cache", error: error.message });
  }
};

exports.getCacheMonitoring = async (req, res) => {
  try {
    const { getCacheStats } = require("../middleware/CacheMiddleware");
    const cache = require("../utils/Cache");
    const stats = getCacheStats();
    const allKeys = cache.keys();
    res.status(200).json({ success: true, data: { ...stats, totalKeys: allKeys.length, hitRate: stats.hits > 0 ? ((stats.hits/(stats.hits+stats.misses))*100).toFixed(2)+'%' : '0%', lastUpdated: new Date().toISOString() } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to get cache statistics", error: error.message });
  }
};

module.exports = exports;
