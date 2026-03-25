const { getCallLog } = require("../Schema/CallLogModel");
const mongoose = require("mongoose");
const smartfloClient = require("../services/smartfloClient");

exports.getCallSummary = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const { startDate, endDate, userId } = req.query;
    const currentUser = req.user;
    const dateFilter = {};

    if (currentUser.role !== "Admin" && currentUser.role !== "Superadmin" && currentUser.role !== "Globaladmin") {
      dateFilter.userId = mongoose.Types.ObjectId.createFromHexString(currentUser.id);
    } else if (userId) {
      dateFilter.userId = mongoose.Types.ObjectId.createFromHexString(userId);
    }

    if (startDate || endDate) {
      const dateQuery = {};
      if (startDate) dateQuery.$gte = new Date(startDate);
      if (endDate) { const end = new Date(endDate); end.setHours(23,59,59,999); dateQuery.$lte = end; }
      dateFilter.$or = [{ createdAt: dateQuery }, { updatedAt: dateQuery }];
    } else {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      dateFilter.createdAt = { $gte: thirtyDaysAgo };
    }

    const stats = await CallLog.aggregate([
      { $match: dateFilter },
      { $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        completedCalls: { $sum: { $cond: [{ $eq: ["$callStatus","completed"] }, 1, 0] } },
        answeredCalls: { $sum: { $cond: [{ $in: ["$callStatus",["answered","completed"]] }, 1, 0] } },
        notAnsweredCalls: { $sum: { $cond: [{ $eq: ["$callStatus","no_answer"] }, 1, 0] } },
        failedCalls: { $sum: { $cond: [{ $eq: ["$callStatus","failed"] }, 1, 0] } },
        totalDuration: { $sum: "$duration" },
        avgDuration: { $avg: "$duration" },
      }},
    ]);

    const summary = stats[0] || { totalCalls:0, completedCalls:0, answeredCalls:0, notAnsweredCalls:0, failedCalls:0, totalDuration:0, avgDuration:0 };
    const totalInitiated = summary.totalCalls - summary.failedCalls;
    summary.connectionRate = totalInitiated > 0 ? ((summary.answeredCalls / totalInitiated) * 100).toFixed(2) : 0;
    summary.totalDurationFormatted = formatDuration(summary.totalDuration);
    summary.avgDurationFormatted = formatDuration(summary.avgDuration);

    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch call summary", error: error.message });
  }
};

exports.getAgentPerformance = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const { startDate, endDate } = req.query;
    const currentUser = req.user;
    const dateFilter = {};

    if (currentUser.role !== "Admin" && currentUser.role !== "Superadmin" && currentUser.role !== "Globaladmin") {
      dateFilter.userId = mongoose.Types.ObjectId.createFromHexString(currentUser.id);
    }

    if (startDate || endDate) {
      const dateQuery = {};
      if (startDate) dateQuery.$gte = new Date(startDate);
      if (endDate) { const end = new Date(endDate); end.setHours(23,59,59,999); dateQuery.$lte = end; }
      dateFilter.$or = [{ createdAt: dateQuery }, { updatedAt: dateQuery }];
    } else {
      const today = new Date(); today.setHours(0,0,0,0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
      dateFilter.createdAt = { $gte: today, $lt: tomorrow };
    }

    const agentStats = await CallLog.aggregate([
      { $match: dateFilter },
      { $group: { _id: "$userId", totalCalls: { $sum: 1 }, completedCalls: { $sum: { $cond: [{ $eq: ["$callStatus","completed"] }, 1, 0] } }, totalDuration: { $sum: "$duration" }, avgDuration: { $avg: "$duration" } } },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
      { $unwind: "$user" },
      { $project: { userId: "$_id", username: "$user.username", email: "$user.email", totalCalls: 1, completedCalls: 1, totalDuration: 1, avgDuration: 1, connectionRate: { $cond: [{ $gt: ["$totalCalls",0] }, { $multiply: [{ $divide: ["$completedCalls","$totalCalls"] }, 100] }, 0] } } },
      { $sort: { totalCalls: -1 } },
    ]);

    agentStats.forEach((agent) => {
      agent.totalDurationFormatted = formatDuration(agent.totalDuration);
      agent.avgDurationFormatted = formatDuration(agent.avgDuration);
      agent.connectionRate = agent.connectionRate.toFixed(2);
    });

    res.status(200).json({ success: true, data: agentStats });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch agent performance", error: error.message });
  }
};

exports.syncCDR = async (req, res) => {
  try {
    const CallLog = getCallLog();
    if (req.user.role !== "Superadmin" && req.user.role !== "Admin" && req.user.role !== "Globaladmin") {
      return res.status(403).json({ message: "Access denied. Admin privileges required." });
    }
    const { fromDate, toDate } = req.body;
    const from = fromDate || getYesterdayDate();
    const to = toDate || getTodayDate();
    const cdrResponse = await smartfloClient.fetchCDR(from, to);
    const cdrRecords = cdrResponse.data || cdrResponse.records || [];
    let updatedCount = 0, newCount = 0;
    for (const record of cdrRecords) {
      try {
        const callLog = await CallLog.findOne({ providerCallId: record.call_id || record.id });
        if (callLog) {
          callLog.callStatus = mapCDRStatus(record.status);
          callLog.duration = record.duration || callLog.duration;
          callLog.recordingUrl = record.recording_url || callLog.recordingUrl;
          callLog.disposition = record.disposition || callLog.disposition;
          callLog.endTime = record.end_time ? new Date(record.end_time) : callLog.endTime;
          await callLog.save();
          updatedCount++;
        } else { newCount++; }
      } catch (e) { /* skip */ }
    }
    res.status(200).json({ success: true, message: "CDR sync completed", data: { totalRecords: cdrRecords.length, updatedCount, newCount, dateRange: { from, to } } });
  } catch (error) {
    res.status(500).json({ message: "Failed to sync CDR", error: error.message });
  }
};

exports.getCallTrends = async (req, res) => {
  try {
    const CallLog = getCallLog();
    const { queryStartDate, queryEndDate } = req.query;
    const currentUser = req.user;
    const filter = {};

    if (currentUser.role !== "Admin" && currentUser.role !== "Superadmin" && currentUser.role !== "Globaladmin") {
      filter.userId = mongoose.Types.ObjectId.createFromHexString(currentUser.id);
    }

    if (queryStartDate || queryEndDate) {
      const dateQuery = {};
      if (queryStartDate) dateQuery.$gte = new Date(queryStartDate);
      if (queryEndDate) { const end = new Date(queryEndDate); end.setHours(23,59,59,999); dateQuery.$lte = end; }
      filter.$or = [{ createdAt: dateQuery }, { updatedAt: dateQuery }];
    } else {
      const today = new Date(); today.setHours(0,0,0,0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
      filter.createdAt = { $gte: today, $lt: tomorrow };
    }

    const trends = await CallLog.aggregate([
      { $match: filter },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, totalCalls: { $sum: 1 }, completedCalls: { $sum: { $cond: [{ $eq: ["$callStatus","completed"] }, 1, 0] } }, totalDuration: { $sum: "$duration" } } },
      { $sort: { _id: 1 } },
    ]);

    res.status(200).json({ success: true, data: trends });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch call trends", error: error.message });
  }
};

function formatDuration(seconds) {
  if (!seconds) return "00:00:00";
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function getYesterdayDate() { const d = new Date(); d.setDate(d.getDate()-1); return d.toISOString().split("T")[0]; }
function getTodayDate() { return new Date().toISOString().split("T")[0]; }
function mapCDRStatus(status) {
  const m = { completed:"completed", answered:"answered", failed:"failed", "no-answer":"no_answer", busy:"busy", cancelled:"cancelled" };
  return m[status] || status;
}

module.exports = exports;
