/**
 * DMS Data Controller — adapted for unified portal
 * Model imports use lazy getters (getDMSConnection-based).
 */
const mongoose = require("mongoose");
const { getEntry }   = require("../Schema/DataModel");
const { getUser }    = require("../Schema/Model");
const XLSX           = require("xlsx");
const { sendMail }   = require("../utils/mailer");
const { smartInvalidate } = require("../middleware/CacheMiddleware");
const { parse, isValid } = require("date-fns");

const sanitizePhone = (phone) => {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.length >= 10) return digits.slice(-10);
  return "";
};

const DataentryLogic = async (req, res) => {
  try {
    const Entry = getEntry();
    const { customerName, contactName, mobileNumber, AlterNumber, email, address, state, city, product, organization, category, status, remarks, estimatedValue } = req.body;
    const newEntry = new Entry({
      customerName: customerName ? customerName.trim() : "",
      mobileNumber: sanitizePhone(mobileNumber),
      contactName: contactName ? contactName.trim() : "",
      AlterNumber: sanitizePhone(AlterNumber),
      email: email ? email.trim().toLowerCase() : "",
      address: address ? address.trim() : "",
      product: product ? product.trim() : "",
      state: state ? state.trim() : "",
      city: city ? city.trim() : "",
      organization: organization ? organization.trim() : "",
      category: category ? category.trim() : "",
      createdBy: req.user.id,
      status: status || "Not Found",
      remarks: remarks ? remarks.trim() : "",
      estimatedValue: estimatedValue ? parseFloat(estimatedValue) || null : null,
      history: status && remarks ? [{ status, remarks: remarks.trim(), timestamp: new Date() }] : [],
    });
    await newEntry.save();
    await newEntry.populate("createdBy", "username _id");
    res.status(201).json({ success: true, data: newEntry, message: "Entry created successfully." });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Some inputs are incorrect.", errors: messages });
    }
    console.error("DMS DataentryLogic error:", error.message);
    res.status(500).json({ success: false, message: "Something went wrong.", error: error.message });
  }
};

const buildFilter = (req, normalizedRole) => {
  const Entry = getEntry();
  const filter = {};
  const { searchTerm, selectedOrganization, selectedStateA, selectedCityA, startDate, endDate, status, dashboardFilter } = req.query;

  if (normalizedRole !== "Admin" && normalizedRole !== "Superadmin" && normalizedRole !== "Globaladmin") {
    filter.createdBy = mongoose.Types.ObjectId.createFromHexString(req.user.id);
  }
  if (searchTerm) {
    filter.$or = [
      { customerName: { $regex: searchTerm, $options: "i" } },
      { address: { $regex: searchTerm, $options: "i" } },
      { mobileNumber: { $regex: searchTerm, $options: "i" } },
    ];
  }
  if (selectedOrganization) filter.organization = selectedOrganization;
  if (selectedStateA) filter.state = selectedStateA;
  if (selectedCityA) filter.city = selectedCityA;

  if (startDate || endDate) {
    if (startDate && endDate) {
      filter.createdAt = { $gte: new Date(startDate + "T00:00:00"), $lte: new Date(endDate + "T23:59:59.999") };
      if (filter.$or) delete filter.$or;
    } else if (startDate) {
      filter.createdAt = { $gte: new Date(startDate + "T00:00:00") };
    } else {
      filter.createdAt = { $lte: new Date(endDate + "T23:59:59.999") };
    }
  }
  if (status) filter.status = status;

  if (dashboardFilter === "leads") {
    filter.status = "Not Found";
  } else if (dashboardFilter === "monthly") {
    if (!startDate && !endDate) {
      const now = new Date();
      filter.$or = [
        { $expr: { $and: [{ $eq: [{ $month: "$createdAt" }, now.getMonth() + 1] }, { $eq: [{ $year: "$createdAt" }, now.getFullYear()] }] } },
        { $expr: { $and: [{ $eq: [{ $month: "$updatedAt" }, now.getMonth() + 1] }, { $eq: [{ $year: "$updatedAt" }, now.getFullYear()] }] } },
      ];
    }
  } else if (dashboardFilter === "Closed Won") {
    filter.closetype = "Closed Won";
  } else if (dashboardFilter === "Closed Lost") {
    filter.closetype = "Closed Lost";
  } else if (dashboardFilter && dashboardFilter !== "total" && dashboardFilter !== "results") {
    filter.status = dashboardFilter;
  }
  return filter;
};

const fetchEntries = async (req, res) => {
  try {
    const Entry = getEntry();
    const User  = getUser();
    const normalizedRole = req.user.role.charAt(0).toUpperCase() + req.user.role.slice(1).toLowerCase();
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ success: false, errorCode: "INVALID_USER_ID", message: "Invalid user ID." });
    }
    const page  = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip  = (page - 1) * limit;
    let filter  = buildFilter(req, normalizedRole);

    if (req.query.selectedCreatedBy && (normalizedRole === "Admin" || normalizedRole === "Superadmin" || normalizedRole === "Globaladmin")) {
      const user = await User.findOne({ username: req.query.selectedCreatedBy }).lean();
      if (user) filter.createdBy = user._id;
    }

    const [entries, total] = await Promise.all([
      Entry.find(filter).populate("createdBy", "username _id").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Entry.countDocuments(filter),
    ]);

    const normalizedEntries = entries.map((e) => ({
      ...e,
      _id: e._id.toString(),
      createdBy: { _id: e.createdBy?._id?.toString() || null, username: e.createdBy?.username || "Unknown" },
    }));

    res.status(200).json({
      success: true,
      data: normalizedEntries,
      pagination: { total, page, limit, pages: Math.ceil(total / limit), hasMore: skip + entries.length < total },
    });
  } catch (error) {
    console.error("DMS fetchEntries error:", error.message);
    res.status(500).json({ success: false, errorCode: "SERVER_ERROR", message: "Could not retrieve entries.", error: error.message });
  }
};

const fetchAllEntries = async (req, res) => {
  try {
    const Entry = getEntry();
    const User  = getUser();
    const normalizedRole = req.user.role.charAt(0).toUpperCase() + req.user.role.slice(1).toLowerCase();
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ success: false, errorCode: "INVALID_USER_ID", message: "Invalid user ID." });
    }
    let filter = buildFilter(req, normalizedRole);
    if (req.query.selectedCreatedBy && (normalizedRole === "Admin" || normalizedRole === "Superadmin" || normalizedRole === "Globaladmin")) {
      const user = await User.findOne({ username: req.query.selectedCreatedBy }).lean();
      if (user) filter.createdBy = user._id;
    }
    const entries = await Entry.find(filter).populate("createdBy", "username _id").sort({ createdAt: -1 }).lean();
    const normalizedEntries = entries.map((e) => ({
      ...e,
      _id: e._id.toString(),
      createdBy: { _id: e.createdBy?._id?.toString() || null, username: e.createdBy?.username || "Unknown" },
    }));
    res.status(200).json({ success: true, data: normalizedEntries, total: normalizedEntries.length });
  } catch (error) {
    console.error("DMS fetchAllEntries error:", error.message);
    res.status(500).json({ success: false, errorCode: "SERVER_ERROR", message: "Could not retrieve entries.", error: error.message });
  }
};

const editEntry = async (req, res) => {
  try {
    const Entry = getEntry();
    const { customerName, contactName, mobileNumber, AlterNumber, email, address, state, city, product, organization, category, status, remarks, closetype, closeamount, estimatedValue } = req.body;
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid entry ID." });
    }
    const entry = await Entry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: "Entry not found." });

    const normalizedRole = req.user.role.charAt(0).toUpperCase() + req.user.role.slice(1).toLowerCase();
    if (normalizedRole !== "Admin" && normalizedRole !== "Superadmin" && normalizedRole !== "Globaladmin" && entry.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Permission denied." });
    }

    const updateData = {
      ...(customerName !== undefined && { customerName: customerName.trim() || entry.customerName }),
      ...(contactName  !== undefined && { contactName:  contactName.trim()  || entry.contactName }),
      ...(mobileNumber !== undefined && { mobileNumber: sanitizePhone(mobileNumber) || entry.mobileNumber }),
      ...(AlterNumber  !== undefined && { AlterNumber:  sanitizePhone(AlterNumber)  || entry.AlterNumber }),
      ...(email        !== undefined && { email:        email.trim().toLowerCase()  || entry.email }),
      ...(address      !== undefined && { address:      address.trim()      || entry.address }),
      ...(state        !== undefined && { state:        state.trim()        || "" }),
      ...(city         !== undefined && { city:         city.trim()         || "" }),
      ...(product      !== undefined && { product:      product.trim()      || entry.product }),
      ...(organization !== undefined && { organization: organization.trim() || entry.organization }),
      ...(category     !== undefined && { category:     category.trim()     || entry.category }),
      ...(status       !== undefined && { status }),
      ...(remarks      !== undefined && { remarks: remarks ? remarks.trim() : "" }),
      ...(estimatedValue !== undefined && { estimatedValue: parseFloat(estimatedValue) || null }),
      updatedAt: new Date(),
    };

    if (Object.keys(updateData).length > 1) {
      updateData.$push = { history: { status: status !== undefined ? status : entry.status, remarks: remarks !== undefined ? remarks.trim() : "", timestamp: new Date() } };
    }

    if (status === "Closed") {
      if (!closetype || !["Closed Won", "Closed Lost"].includes(closetype.trim())) {
        return res.status(400).json({ success: false, message: "Please specify 'Closed Won' or 'Closed Lost'." });
      }
      updateData.closetype = closetype.trim();
      updateData.closeamount = parseFloat(closeamount) || null;
    } else {
      updateData.closetype = "";
      updateData.closeamount = null;
    }

    const updatedEntry = await Entry.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true }).populate("createdBy", "username _id").lean();
    res.status(200).json({ success: true, data: updatedEntry, message: "Entry updated successfully." });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, message: "Validation error.", errors: Object.values(error.errors).map((e) => e.message) });
    }
    console.error("DMS editEntry error:", error.message);
    res.status(500).json({ success: false, message: "Error updating entry.", error: error.message });
  }
};

const DeleteData = async (req, res) => {
  try {
    const Entry = getEntry();
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid entry ID." });
    }
    const entry = await Entry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: "Entry not found." });

    const normalizedRole = req.user.role.charAt(0).toUpperCase() + req.user.role.slice(1).toLowerCase();
    if (normalizedRole !== "Admin" && normalizedRole !== "Superadmin" && normalizedRole !== "Globaladmin") {
      if (!entry.createdBy || entry.createdBy.toString() !== req.user.id) {
        return res.status(403).json({ success: false, message: "Permission denied." });
      }
    }
    await Entry.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: "Entry deleted successfully." });
  } catch (error) {
    console.error("DMS DeleteData error:", error.message);
    res.status(500).json({ success: false, message: "Error deleting entry.", error: error.message });
  }
};

const bulkUploadStocks = async (req, res) => {
  try {
    const Entry = getEntry();
    const newEntries = req.body;
    if (!Array.isArray(newEntries) || newEntries.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid data format." });
    }
    const validatedEntries = newEntries.map((entry) => ({
      customerName:  entry["Customer Name"]  ? String(entry["Customer Name"]).trim()  : "",
      contactName:   entry["Contact Person"] ? String(entry["Contact Person"]).trim() : "",
      email:         entry["Email"]          ? String(entry["Email"]).trim().toLowerCase() : "",
      mobileNumber:  sanitizePhone(entry["Contact Number"]),
      AlterNumber:   sanitizePhone(entry["Alternate Number"]),
      product:       entry["Product"]        ? String(entry["Product"]).trim()        : "",
      address:       entry["Address"]        ? String(entry["Address"]).trim()        : "",
      organization:  entry["Organization"]   ? String(entry["Organization"]).trim()   : "",
      category:      entry["Category"]       ? String(entry["Category"]).trim()       : "",
      city:          entry["District"]       ? String(entry["District"]).trim()       : "",
      state:         entry["State"]          ? String(entry["State"]).trim()          : "",
      status:        (entry["Status"] || entry["status"]) ? String(entry["Status"] || entry["status"]).trim() : "Not Found",
      remarks:       (entry["Remarks"] || entry["remarks"]) ? String(entry["Remarks"] || entry["remarks"]).trim() : "",
      createdAt: (() => {
        const val = entry["Created At"];
        if (!val) return new Date();
        if (val instanceof Date) return val;
        let p = parse(String(val), "dd/MM/yyyy", new Date());
        if (isValid(p)) return p;
        p = parse(String(val), "dd-MM-yyyy", new Date());
        if (isValid(p)) return p;
        const s = new Date(val);
        return isNaN(s.getTime()) ? new Date() : s;
      })(),
      createdBy: req.user.id,
    }));

    const batchSize = 500;
    let insertedCount = 0;
    const errors = [];
    for (let i = 0; i < validatedEntries.length; i += batchSize) {
      const batch = validatedEntries.slice(i, i + batchSize);
      try {
        const result = await Entry.insertMany(batch, { ordered: false });
        insertedCount += result.length;
      } catch (batchError) {
        if (batchError.code === 11000 || batchError.name === "BulkWriteError") {
          insertedCount += batchError.insertedDocs ? batchError.insertedDocs.length : 0;
          if (batchError.writeErrors) batchError.writeErrors.forEach((e) => errors.push(e.errmsg || "Validation error"));
        } else {
          errors.push(batchError.message);
        }
      }
    }

    if (insertedCount === 0 && errors.length > 0) {
      return res.status(400).json({ success: false, message: "No entries uploaded.", insertedCount: 0, errors });
    }
    if (errors.length > 0) {
      return res.status(207).json({ success: true, message: `Partially uploaded ${insertedCount} entries.`, insertedCount, errors });
    }
    res.status(201).json({ success: true, message: `All ${insertedCount} entries uploaded.`, insertedCount });
  } catch (error) {
    console.error("DMS bulkUpload error:", error.message);
    res.status(400).json({ success: false, message: "Bulk upload failed.", error: error.message });
  }
};

const exportentry = async (req, res) => {
  try {
    const Entry = getEntry();
    const normalizedRole = req.user.role.charAt(0).toUpperCase() + req.user.role.slice(1).toLowerCase();
    const entries = (normalizedRole === "Admin" || normalizedRole === "Superadmin" || normalizedRole === "Globaladmin")
      ? await Entry.find().populate("createdBy", "username").lean()
      : await Entry.find({ createdBy: req.user.id }).populate("createdBy", "username").lean();

    const formattedEntries = entries.map((e) => ({
      "Customer Name":   e.customerName || "",
      "Contact Person":  e.contactName  || "",
      "Email":           e.email        || "",
      "Contact Number":  e.mobileNumber || "",
      "Alternate Number":e.AlterNumber  || "",
      "Product":         e.product      || "",
      "Address":         e.address      || "",
      "Organization":    e.organization || "",
      "Category":        e.category     || "",
      "District":        e.city         || "",
      "State":           e.state        || "",
      "Status":          e.status       || "Not Found",
      "Remarks":         e.remarks      || "",
      "Created By":      e.createdBy?.username || "",
      "Created At":      e.createdAt ? new Date(e.createdAt) : "",
    }));

    const ws = XLSX.utils.json_to_sheet(formattedEntries, { dateNF: "dd-mm-yyyy" });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Customer Entries");
    const fileBuffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
    res.setHeader("Content-Disposition", "attachment; filename=dms-entries.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(fileBuffer);
  } catch (error) {
    console.error("DMS exportentry error:", error.message);
    res.status(500).json({ success: false, message: "Export failed.", error: error.message });
  }
};

const getAdmin = async (req, res) => {
  try {
    const role = req.user.role;
    const isGlobaladmin = role === "Globaladmin";
    return res.status(200).json({
      id: req.user.id,
      role,
      isAdmin: role === "Admin" || isGlobaladmin,
      isSuperadmin: role === "Superadmin" || isGlobaladmin,
      isGlobaladmin,
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching role." });
  }
};

const getUsers = async (req, res) => {
  try {
    const User = getUser();
    const normalizeRole = (r) => r ? r.charAt(0).toUpperCase() + r.slice(1).toLowerCase() : "salesperson";
    const userRole = normalizeRole(req.user.role);
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ success: false, errorCode: "INVALID_USER_ID", message: "Invalid user ID." });
    }
    const users = (userRole === "Superadmin" || userRole === "Admin" || userRole === "Globaladmin")
      ? await User.find().select("_id username role").lean()
      : await User.find({ _id: req.user.id }).select("_id username role").lean();

    if (!users.length) return res.status(404).json({ success: false, errorCode: "NO_USERS_FOUND", message: "No users found." });

    res.status(200).json({
      success: true,
      data: users.map((u) => ({ _id: u._id.toString(), username: u.username || "Unknown", role: normalizeRole(u.role) })),
    });
  } catch (error) {
    console.error("DMS getUsers error:", error.message);
    res.status(500).json({ success: false, errorCode: "SERVER_ERROR", message: "Could not retrieve users.", error: error.message });
  }
};

const getEntryCounts = async (req, res) => {
  try {
    const Entry = getEntry();
    const User  = getUser();
    const normalizedRole = req.user.role.charAt(0).toUpperCase() + req.user.role.slice(1).toLowerCase();
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ success: false, errorCode: "INVALID_USER_ID", message: "Invalid user ID." });
    }
    let filter = buildFilter(req, normalizedRole);
    if (req.query.selectedCreatedBy && (normalizedRole === "Admin" || normalizedRole === "Superadmin" || normalizedRole === "Globaladmin")) {
      const user = await User.findOne({ username: req.query.selectedCreatedBy }).lean();
      if (user) filter.createdBy = user._id;
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYear  = now.getFullYear();

    // Build month match: entry created OR updated this month (mirrors frontend AdminDrawer logic)
    const monthMatchFilter = { ...filter };
    if (!req.query.startDate && !req.query.endDate) {
      monthMatchFilter.$or = [
        { $expr: { $and: [{ $eq: [{ $month: "$createdAt" }, currentMonth] }, { $eq: [{ $year: "$createdAt" }, currentYear] }] } },
        { $expr: { $and: [{ $eq: [{ $month: "$updatedAt" }, currentMonth] }, { $eq: [{ $year: "$updatedAt" }, currentYear] }] } },
      ];
    }

    // Run all counts in parallel — including per-status aggregation and monthly calls aggregation
    const [totalResults, totalLeads, monthlyCallsAgg, statusAgg] = await Promise.all([
      Entry.countDocuments(filter),
      Entry.countDocuments({ ...filter, status: "Not Found" }),
      // Monthly Calls aggregation — mirrors frontend logic exactly:
      //   +1 for each entry created this month
      //   +history.length for each entry created OR updated this month
      Entry.aggregate([
        { $match: monthMatchFilter },
        {
          $project: {
            // 1 if created this month, else 0
            createdThisMonth: {
              $cond: [
                {
                  $and: [
                    { $eq: [{ $month: "$createdAt" }, currentMonth] },
                    { $eq: [{ $year:  "$createdAt" }, currentYear]  },
                  ],
                },
                1,
                0,
              ],
            },
            // history.length for entries created OR updated this month (already matched above)
            historyCount: { $size: { $ifNull: ["$history", []] } },
          },
        },
        {
          $group: {
            _id: null,
            monthlyCalls: { $sum: { $add: ["$createdThisMonth", "$historyCount"] } },
          },
        },
      ]),
      Entry.aggregate([
        { $match: filter },
        { $group: { _id: { status: "$status", closetype: "$closetype" }, count: { $sum: 1 } } },
      ]),
    ]);

    const monthlyCalls = monthlyCallsAgg[0]?.monthlyCalls || 0;

    // Build statusCounts and closeTypeCounts maps from aggregation
    const statusCounts    = {};
    const closeTypeCounts = {};
    for (const row of statusAgg) {
      const { status, closetype } = row._id;
      if (status) statusCounts[status] = (statusCounts[status] || 0) + row.count;
      if (closetype) closeTypeCounts[closetype] = (closeTypeCounts[closetype] || 0) + row.count;
    }

    res.status(200).json({
      success: true,
      data: {
        totalResults,
        totalLeads,
        monthlyCalls,   // frontend reads this key
        statusCounts,   // { "Interested": N, "Maybe": N, "Not Interested": N, ... }
        closeTypeCounts, // { "Closed Won": N, "Closed Lost": N }
      },
    });
  } catch (error) {
    console.error("DMS getEntryCounts error:", error.message);
    res.status(500).json({ success: false, errorCode: "SERVER_ERROR", message: "Could not retrieve counts.", error: error.message });
  }
};

/**
 * sendEntryEmail - Send email for an entry
 */
const sendEntryEmail = async (req, res) => {
  try {
    const { entryId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(entryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid entry ID provided.",
      });
    }

    const entry = await Entry.findById(entryId).populate("createdBy", "username");
    if (!entry) {
      return res.status(404).json({
        success: false,
        message: "Entry not found.",
      });
    }

    if (!entry.email || !entry.email.trim()) {
      return res.status(400).json({
        success: false,
        message: "No valid email address associated with this entry.",
      });
    }

    const normalizedRole = req.user.role.charAt(0).toUpperCase() + req.user.role.slice(1).toLowerCase();
    if (normalizedRole !== "Admin" && normalizedRole !== "Superadmin" && entry.createdBy._id.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to send an email for this entry.",
      });
    }

    const subject = `Your Journey with Promark Techsolutions Begins!`;
    const text = `Thank you for connecting with Promark – a 22-year-old company with a legacy in EdTech, AV, and Furniture, owning its own factories, serving government, private, and autonomous organisations in India.
  Proudly part of the "Make in India" initiative.`;
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Journey with Promark Techsolutions</title>
        <style>
          body { font-family: 'Poppins', Arial, sans-serif; background-color: #f4f6f9; margin: 0; padding: 0; }
          .container { max-width: 850px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 20px rgba(0,0,0,0.15); }
          .content { padding: 0px; text-align: center; }
          .content img { max-width: 100%; height: auto; display: block; margin: 0 auto; border-radius: 20px; }
          .content .middle-image { max-width: 800px; min-height: 400px; margin: 50px auto; padding: 0px; border: 2px solid #e0e0e0; background-color: #f9f9f9; box-shadow: 0 8px 20px rgba(0,0,0,0.15); vertical-align: middle; }
          @media (max-width: 600px) {
            .container { margin: 10px; width: 100%; }
            .content { padding: 20px 10px; }
            .content img { max-width: 100%; margin: 0 auto; }
            .content .middle-image { max-width: 100%; min-height: 50vh; margin: 20px 0; padding: 10px; width: 100%; box-sizing: border-box; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="content">
            <img src="cid:middle-image" alt="Promark Middle Image" class="middle-image">
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email using Nodemailer with attachments

    await sendMail(entry.email, subject, text, html, [
      {
        filename: 'middle.png',
        path: 'public/middle.png',
        cid: 'middle-image'
      },
    ]);

    res.status(200).json({
      success: true,
      message: `Email sent successfully to ${entry.email}.`,
    });
  } catch (error) {
    console.error("Error sending email:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to send email. Please try again later.",
      error: error.message,
    });
  }
};


// Send Quotation Email
const sendQuotationEmail = async (req, res) => {
  try {
    const {
      entryId,
      productType,
      specification,
      quantity,
      price,
      customerEmail,
      customerName,
    } = req.body;

    // Validate required fields
    if (
      !entryId ||
      !productType ||
      !specification ||
      !quantity ||
      !price ||
      !customerEmail
    ) {
      return res.status(400).json({
        success: false,
        message:
          "All fields are required (entryId, productType, specification, quantity, price, customerEmail).",
      });
    }

    // Validate entryId
    if (!mongoose.Types.ObjectId.isValid(entryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid entry ID provided.",
      });
    }

    // Validate quantity and price
    if (quantity <= 0 || price <= 0) {
      return res.status(400).json({
        success: false,
        message: "Quantity and price must be greater than 0.",
      });
    }

    // Fetch the entry for authorization check
    // Performance Optimization: Select only required fields and optimize populate
    const entry = await Entry.findById(entryId)
      .select("createdBy") // Only fetch createdBy field for authorization check
      .populate({
        path: "createdBy",
        select: "username _id", // Only fetch username and _id from User collection
        options: { lean: true } // Convert Mongoose document to plain JS object for better performance
      });
    if (!entry) {
      return res.status(404).json({
        success: false,
        message: "Entry not found.",
      });
    }

    // Authorization check
    const normalizedRole =
      req.user.role.charAt(0).toUpperCase() +
      req.user.role.slice(1).toLowerCase();
    if (
      normalizedRole !== "Admin" &&
      normalizedRole !== "Superadmin" &&
      entry.createdBy._id.toString() !== req.user.id
    ) {
      return res.status(403).json({
        success: false,
        message:
          "You do not have permission to send a quotation for this entry.",
      });
    }

    // Calculate total amount
    const totalAmount = quantity * price;
    const formattedPrice = price.toLocaleString("en-IN");
    const formattedTotal = totalAmount.toLocaleString("en-IN");

    // Email subject and content
    const subject = `Quotation from Promark Techsolutions - ${productType}`;
    const text = `Dear ${customerName},

Thank you for your interest in Promark Techsolutions.

Please find below the quotation details:

Product Type: ${productType}
Specification: ${specification}
Quantity: ${quantity}
Unit Price: ₹${formattedPrice}
Total Amount: ₹${formattedTotal}

We look forward to serving you.

Best Regards,
Promark Techsolutions Pvt Ltd
A 22-year-old company with legacy in EdTech, AV, and Furniture
Proudly part of "Make in India" initiative`;

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Quotation from Promark Techsolutions</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6f9; margin: 0; padding: 0; }
          .container { max-width: 700px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #6a11cb 0%, #2575fc 100%); padding: 30px; text-align: center; color: white; }
          .header h1 { margin: 0; font-size: 28px; font-weight: 700; }
          .header p { margin: 10px 0 0; font-size: 14px; opacity: 0.9; }
          .content { padding: 40px 30px; }
          .greeting { font-size: 18px; color: #333; margin-bottom: 20px; }
          .quotation-box { background: #f8f9fa; border-left: 4px solid #6a11cb; padding: 20px; margin: 20px 0; border-radius: 8px; }
          .quotation-box h2 { margin: 0 0 15px; color: #6a11cb; font-size: 20px; }
          .quotation-item { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e0e0e0; }
          .quotation-item:last-child { border-bottom: none; }
          .quotation-item .label { font-weight: 600; color: #555; }
          .quotation-item .value { color: #333; font-weight: 500; }
          .total-row { background: linear-gradient(135deg, #6a11cb 0%, #2575fc 100%); color: white; padding: 15px 20px; margin-top: 15px; border-radius: 8px; display: flex; justify-content: space-between; font-size: 18px; font-weight: 700; }
          .footer { background: #f8f9fa; padding: 25px 30px; text-align: center; color: #666; font-size: 14px; line-height: 1.6; }
          .footer strong { color: #333; }
          @media (max-width: 600px) {
            .container { margin: 10px; width: calc(100% - 20px); }
            .content { padding: 20px 15px; }
            .header h1 { font-size: 22px; }
            .quotation-item { flex-direction: column; gap: 5px; }
            .total-row { flex-direction: column; gap: 5px; text-align: center; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>💼 QUOTATION</h1>
            <p>Promark Techsolutions Pvt Ltd</p>
          </div>
          
          <div class="content">
            <p class="greeting">Dear <strong>${customerName}</strong>,</p>
            <p>Thank you for your interest in <strong>Promark Techsolutions</strong>. We are pleased to provide you with the following quotation:</p>
            
            <div class="quotation-box">
              <h2>📋 Quotation Details</h2>
              <div class="quotation-item">
                <span class="label">Product Type:</span>
                <span class="value">${productType}</span>
              </div>
              <div class="quotation-item">
                <span class="label">Specification:</span>
                <span class="value">${specification}</span>
              </div>
              <div class="quotation-item">
                <span class="label">Quantity:</span>
                <span class="value">${quantity}</span>
              </div>
              <div class="quotation-item">
                <span class="label">Unit Price:</span>
                <span class="value">₹${formattedPrice}</span>
              </div>
              <div class="total-row">
                <span>Total Amount:</span>
                <span>₹${formattedTotal}</span>
              </div>
            </div>
            
            <p style="margin-top: 25px; color: #555; line-height: 1.6;">
              We look forward to the opportunity to serve you and provide you with the best quality products and services.
            </p>
            <p style="color: #555; line-height: 1.6;">
              Should you have any questions or require further information, please do not hesitate to contact us.
            </p>
          </div>
          
          <div class="footer">
            <p><strong>Promark Techsolutions Pvt Ltd</strong></p>
            <p>A 22-year-old company with a legacy in EdTech, AV, and Furniture</p>
            <p>Owning its own factories, serving government, private, and autonomous organisations in India</p>
            <p>Proudly part of the <strong>"Make in India"</strong> initiative</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email
    await sendMail(customerEmail, subject, text, html);

    res.status(200).json({
      success: true,
      message: `Quotation email sent successfully to ${customerEmail}.`,
    });
  } catch (error) {
    console.error("Error sending quotation email:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to send quotation email. Please try again later.",
      error: error.message,
    });
  }
};


module.exports = { DataentryLogic, fetchEntries, fetchAllEntries, editEntry, DeleteData, bulkUploadStocks, exportentry, getAdmin, getUsers, getEntryCounts, sendEntryEmail, sendQuotationEmail };
