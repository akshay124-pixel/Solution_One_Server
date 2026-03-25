const { getUser }           = require("../Schema/Model");
const { getEntry }          = require("../Schema/DataModel");
const { getSmartfloConfig } = require("../Schema/SmartfloConfigModel");
const smartfloClient        = require("../services/smartfloClient");

exports.getAllUsersWithMapping = async (req, res) => {
  try {
    const User = getUser();
    const users = await User.find({}, { password: 0, lastPasswordChange: 0 }).sort({ username: 1 });
    res.status(200).json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch users", error: error.message });
  }
};

exports.mapUserToSmartflo = async (req, res) => {
  try {
    const User = getUser();
    if (req.user.role !== "Superadmin" && req.user.role !== "Admin" && req.user.role !== "Globaladmin") {
      return res.status(403).json({ message: "Access denied. Admin privileges required." });
    }
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const { smartfloUserId, smartfloAgentNumber, smartfloExtension, smartfloEnabled } = req.body;
    if (smartfloUserId)     user.smartfloUserId     = smartfloUserId;
    if (smartfloAgentNumber)user.smartfloAgentNumber= smartfloAgentNumber;
    if (smartfloExtension)  user.smartfloExtension  = smartfloExtension;
    if (smartfloEnabled !== undefined) user.smartfloEnabled = smartfloEnabled;
    await user.save();
    res.status(200).json({ success: true, message: "User mapped to Smartflo successfully", data: { userId: user._id, username: user.username, smartfloAgentNumber: user.smartfloAgentNumber, smartfloEnabled: user.smartfloEnabled } });
  } catch (error) {
    res.status(500).json({ message: "Failed to map user", error: error.message });
  }
};

exports.syncLeadsToSmartflo = async (req, res) => {
  try {
    const Entry = getEntry();
    const SmartfloConfig = getSmartfloConfig();
    if (req.user.role !== "Superadmin" && req.user.role !== "Admin" && req.user.role !== "Globaladmin") {
      return res.status(403).json({ message: "Access denied." });
    }
    const { leadListName, segmentCriteria } = req.body;
    const filter = {};
    if (segmentCriteria) {
      if (segmentCriteria.status?.length)   filter.status   = { $in: segmentCriteria.status };
      if (segmentCriteria.category?.length) filter.category = { $in: segmentCriteria.category };
      if (segmentCriteria.state?.length)    filter.state    = { $in: segmentCriteria.state };
      if (segmentCriteria.city?.length)     filter.city     = { $in: segmentCriteria.city };
      if (segmentCriteria.dateRange) {
        filter.createdAt = {};
        if (segmentCriteria.dateRange.from) filter.createdAt.$gte = new Date(segmentCriteria.dateRange.from);
        if (segmentCriteria.dateRange.to)   filter.createdAt.$lte = new Date(segmentCriteria.dateRange.to);
      }
    }
    const leads = await Entry.find(filter).select("customerName contactName mobileNumber email organization");
    if (!leads.length) return res.status(400).json({ message: "No leads found matching criteria" });
    const leadListResponse = await smartfloClient.createLeadList(leadListName || `DMS_Sync_${Date.now()}`, `Synced from DMS on ${new Date().toISOString()}`);
    const leadListId = leadListResponse.id || leadListResponse.lead_list_id;
    let successCount = 0, failCount = 0;
    for (const lead of leads) {
      try {
        await smartfloClient.addLeadToList(leadListId, { firstName: lead.contactName || lead.customerName, phoneNumber: lead.mobileNumber, email: lead.email, company: lead.organization });
        lead.smartfloLeadId = leadListId;
        await lead.save();
        successCount++;
      } catch (e) { failCount++; }
    }
    const config = new SmartfloConfig({ leadListId, leadListName: leadListName || `DMS_Sync_${Date.now()}`, segmentCriteria, totalLeadsSynced: successCount, lastSyncDate: new Date(), createdBy: req.user.id });
    await config.save();
    res.status(200).json({ success: true, message: "Leads synced", data: { leadListId, totalLeads: leads.length, successCount, failCount, configId: config._id } });
  } catch (error) {
    res.status(500).json({ message: "Failed to sync leads", error: error.message });
  }
};

exports.createCampaign = async (req, res) => {
  try {
    const SmartfloConfig = getSmartfloConfig();
    if (req.user.role !== "Superadmin" && req.user.role !== "Admin" && req.user.role !== "Globaladmin") return res.status(403).json({ message: "Access denied." });
    const { campaignName, leadListId, campaignType, agentNumbers, callerId, startTime, endTime } = req.body;
    if (!campaignName || !leadListId) return res.status(400).json({ message: "Campaign name and lead list ID required" });
    const campaignResponse = await smartfloClient.createCampaign({ name: campaignName, leadListId, campaignType: campaignType || "progressive", agentNumbers: agentNumbers || [], callerId: callerId || process.env.SMARTFLO_DEFAULT_CALLER_ID, startTime, endTime });
    const campaignId = campaignResponse.id || campaignResponse.campaign_id;
    const config = await SmartfloConfig.findOne({ leadListId });
    if (config) { config.campaignId = campaignId; config.campaignName = campaignName; config.campaignType = campaignType || "progressive"; await config.save(); }
    res.status(200).json({ success: true, message: "Campaign created", data: { campaignId, campaignName, leadListId } });
  } catch (error) {
    res.status(500).json({ message: "Failed to create campaign", error: error.message });
  }
};

exports.getCampaigns = async (req, res) => {
  try {
    const SmartfloConfig = getSmartfloConfig();
    const configs = await SmartfloConfig.find({ campaignId: { $exists: true, $ne: null } }).populate("createdBy", "username email").sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: configs });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch campaigns", error: error.message });
  }
};

exports.getDispositions = async (req, res) => {
  try {
    const dispositions = await smartfloClient.getDispositions();
    res.status(200).json({ success: true, data: dispositions });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch dispositions", error: error.message });
  }
};

exports.testConnection = async (req, res) => {
  try {
    if (req.user.role !== "Superadmin" && req.user.role !== "Admin" && req.user.role !== "Globaladmin") return res.status(403).json({ message: "Access denied." });
    const result = await smartfloClient.testConnection();
    res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: "Connection test failed", error: error.message });
  }
};
