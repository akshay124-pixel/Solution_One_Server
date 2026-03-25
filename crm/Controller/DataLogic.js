const mongoose = require("mongoose");
const { getCRMConnection } = require("../../utils/connections");
const logger = require("../utils/logger");

const Entry = require("../Schema/DataModel");
const User = require("../Schema/Model");
const Notification = require("../Schema/NotificationSchema");
const XLSX = require("xlsx");
const Attendance = require("../Schema/AttendanceSchema");
const { validatePhoneNumber } = require("../utils/phoneValidation");

// Role helper: globaladmin has same privileges as superadmin in CRM
const isSuperAdminLike = (role) => role === "superadmin" || role === "globaladmin";

// Helper function to create a notification 
const createNotification = async (req, userId, message, entryId = null) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      logger.error(`Invalid userId: ${userId}`);

      return null;
    }

    const io = req.app.get("io");
    if (!io) {
      logger.error("Socket.IO instance not found");

      return null;
    }

    let validatedEntryId = null;
    if (entryId && mongoose.Types.ObjectId.isValid(entryId)) {
      validatedEntryId = new mongoose.Types.ObjectId(entryId);
    } else if (entryId) {

    }

    const notification = new Notification({
      userId: new mongoose.Types.ObjectId(userId),
      message,
      entryId: validatedEntryId,
      read: false,
      timestamp: new Date(),
    });

    await notification.save();


    const notificationData = {
      ...notification.toObject(),
      entryId: validatedEntryId ? { _id: validatedEntryId } : null,
    };

    io.to(userId.toString()).emit("newNotification", notificationData);

    return notificationData;
  } catch (error) {
    logger.error(`Error creating notification for user ${userId}:`, error);

    return null;
  }
};


// Check for follow-up and closing date notifications

const checkDateNotifications = async (io) => {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(tomorrow.getDate() + 1);

    const entries = await Entry.find({
      $or: [
        { followUpDate: { $gte: tomorrow, $lt: dayAfterTomorrow } },
        { expectedClosingDate: { $gte: tomorrow, $lt: dayAfterTomorrow } },
      ],
    })
      .populate("createdBy", "username")
      .populate("assignedTo", "username");

    for (const entry of entries) {
      const messagePrefix = entry.followUpDate
        ? `Follow-up due tomorrow for ${entry.customerName}`
        : `Expected closing date tomorrow for ${entry.customerName}`;
      const message = `${messagePrefix})`;

      // Notify creator
      if (entry.createdBy) {
        await createNotification(
          { app: { get: () => io } },
          entry.createdBy._id,
          message,
          entry._id
        );
      }

      // Notify assigned users
      if (entry.assignedTo && Array.isArray(entry.assignedTo)) {
        for (const user of entry.assignedTo) {
          await createNotification(
            { app: { get: () => io } },
            user._id,
            message,
            entry._id
          );
        }
      }
    }
  } catch (error) {
    logger.error("Error in date-based notifications:", error);

  }
};

// Data Entry Logic
const DataentryLogic = async (req, res) => {
  try {
    const {
      customerName,
      customerEmail,
      mobileNumber,
      contactperson,
      firstdate,
      estimatedValue,
      address,
      state,
      city,
      organization,
      type,
      category,
      products,
      status,
      expectedClosingDate,
      followUpDate,
      remarks,
      liveLocation,
      createdAt,
    } = req.body;

    // Validate required fields
    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }
    if (!liveLocation) {
      return res.status(400).json({
        success: false,
        message: "Live Location is required",
      });
    }
    // CHANGE: Prevent user from entering their own mobile number
    if (mobileNumber) {
      const user = await User.findById(req.user.id);
      const phoneValidation = validatePhoneNumber(mobileNumber, user?.username);
      if (!phoneValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: phoneValidation.message,
        });
      }
    }


    // Parse products
    let parsedProducts = [];
    if (products) {
      try {
        parsedProducts = typeof products === "string" ? JSON.parse(products) : products;
        if (!Array.isArray(parsedProducts)) {
          return res.status(400).json({
            success: false,
            message: "Products must be an array",
          });
        }
        for (const product of parsedProducts) {
          if (
            product.name !== "No Requirement" &&
            (!product.name ||
              !product.specification ||
              !product.size ||
              product.quantity === undefined ||
              product.quantity < 1)
          ) {
            return res.status(400).json({
              success: false,
              message:
                "All product fields (name, specification, size, quantity) are required and quantity must be positive for non-'No Requirement' products",
            });
          }
          if (product.name === "No Requirement") {
            product.quantity = 0;
            product.specification = product.specification || "No specific requirement";
            product.size = product.size || "Not Applicable";
          } else {
            product.quantity = Number(product.quantity) || 0;
          }
        }
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: `Invalid products format: ${error.message}`,
        });
      }
    }

    // Parse assignedTo
    let validatedAssignedTo = [];
    const assignedTo = Array.isArray(req.body.assignedTo)
      ? req.body.assignedTo
      : Object.keys(req.body)
        .filter((key) => key.startsWith("assignedTo["))
        .map((key) => req.body[key]);
    if (assignedTo && assignedTo.length > 0) {
      for (const userId of assignedTo) {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
          return res.status(400).json({
            success: false,
            message: `Invalid user ID format: ${userId}`,
          });
        }
        const user = await User.findById(userId);
        if (!user) {
          return res.status(400).json({
            success: false,
            message: `User not found: ${userId}`,
          });
        }
        validatedAssignedTo.push(userId);
      }
    }

    const numericEstimatedValue = estimatedValue ? Number(estimatedValue) : 0;

    const timestamp = createdAt ? new Date(createdAt) : new Date();
    if (isNaN(timestamp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid createdAt date format",
      });
    }

    // Validate file if present
    let attachmentPath;
    if (req.file) {
      if (req.file.size > 5 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          message: "File size exceeds 5MB limit",
        });
      }
      attachmentPath = req.file.filename;
    }

    const historyEntry = {
      status: status || "Not Found",
      remarks: remarks || "Initial entry created",
      liveLocation: liveLocation || undefined,
      products: parsedProducts,
      assignedTo: validatedAssignedTo,
      timestamp,
      attachmentpath: attachmentPath,
    };

    const newEntry = new Entry({
      customerName: customerName?.trim(),
      customerEmail: customerEmail?.trim(),
      mobileNumber: mobileNumber?.trim(),
      contactperson: contactperson?.trim(),
      firstdate: firstdate ? new Date(firstdate) : undefined,
      estimatedValue: numericEstimatedValue > 0 ? numericEstimatedValue : undefined,
      address: address?.trim(),
      state: state?.trim(),
      city: city?.trim(),
      organization: organization?.trim(),
      type: type?.trim(),
      category: category?.trim(),
      products: parsedProducts,
      status: status || "Not Found",
      expectedClosingDate: expectedClosingDate ? new Date(expectedClosingDate) : undefined,
      followUpDate: followUpDate ? new Date(followUpDate) : undefined,
      remarks: remarks?.trim(),
      liveLocation: liveLocation?.trim(),
      createdBy: req.user.id,
      assignedTo: validatedAssignedTo,
      attachmentpath: attachmentPath,
      history: [historyEntry],
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await newEntry.save();

    await createNotification(
      req,
      req.user.id,
      `New entry created: ${customerName}`,
      newEntry._id
    );
    for (const userId of validatedAssignedTo) {
      await createNotification(
        req,
        userId,
        `Assigned to new entry: ${customerName}`,
        newEntry._id
      );
    }

    const populatedEntry = await Entry.findById(newEntry._id)
      .populate("createdBy", "username")
      .populate("assignedTo", "username")
      .populate("history.assignedTo", "username");

    try {
      const io = req.app.get("io");
      if (io) {
        io.emit("entryCreated", populatedEntry);
      }
    } catch (emitErr) {
      logger.error("Socket emit error (entryCreated):", emitErr.message);
    }

    res.status(201).json({
      success: true,
      data: populatedEntry,
      message: "Entry created successfully",
    });
  } catch (error) {
    logger.error("Error in DataentryLogic:", error);


    let userMessage = "Something went wrong on our side. Please try again later.";
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message).join(", ");
      userMessage = `Validation failed: ${errors}`;
    } else if (error.message.includes("Cast to ObjectId failed")) {
      userMessage = "Invalid user or entry ID. Please refresh and try again.";
    } else if (error.message.includes("duplicate")) {
      userMessage = "This entry already exists.";
    } else if (error.message.includes("File")) {
      userMessage = error.message;
    }

    res.status(500).json({
      success: false,
      message: userMessage,
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
// Fetch Entries with Pagination and Filtering
const fetchEntries = async (req, res) => {
  try {
    const {
      page,
      limit,
      search,
      fromDate,
      toDate,
      status,
      username,
      state,
      city,
      type, // Add type parameter
    } = req.query;

    const isPaginationEnabled = page && limit;
    const pageNumber = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;
    const skip = (pageNumber - 1) * pageSize;

    // 1. Build Role-Based Base Query
    let baseQuery = {};
    const currentUserId = new mongoose.Types.ObjectId(req.user.id);

    if (isSuperAdminLike(req.user.role)) {
      baseQuery = {}; // All entries
    } else if (req.user.role === "admin") {
      const teamMembers = await User.find({
        assignedAdmins: req.user.id,
      }).select("_id role");
      let teamMemberIds = teamMembers.map((member) => member._id);

      const adminIds = teamMembers
        .filter((member) => member.role === "admin")
        .map((admin) => admin._id);
      const nestedMembers = await User.find({
        assignedAdmins: { $in: adminIds },
      }).select("_id");
      teamMemberIds = [
        ...new Set([
          ...teamMemberIds,
          ...nestedMembers.map((member) => member._id),
        ]),
      ];

      baseQuery = {
        $or: [
          { createdBy: currentUserId },
          { createdBy: { $in: teamMemberIds } },
          { assignedTo: currentUserId },
          { assignedTo: { $in: teamMemberIds } },
        ],
      };
    } else {
      baseQuery = {
        $or: [{ createdBy: currentUserId }, { assignedTo: currentUserId }],
      };
    }

    // 2. Build Filter Query
    const andConditions = [];

    // Search
    if (search) {
      const searchRegex = new RegExp(search, "i");
      andConditions.push({
        $or: [
          { customerName: searchRegex },
          { address: searchRegex },
          { mobileNumber: { $regex: searchRegex } },
          { "products.name": searchRegex },
        ],
      });
    }

    // Date Range
    if (fromDate && toDate) {
      const start = new Date(fromDate);
      const end = new Date(toDate);
      andConditions.push({
        $or: [
          { createdAt: { $gte: start, $lte: end } },
          { updatedAt: { $gte: start, $lte: end } },
        ],
      });
    }

    // Username
    if (username) {
      const user = await User.findOne({ username: username });
      if (user) {
        andConditions.push({
          $or: [
            { createdBy: user._id },
            { assignedTo: user._id },
          ],
        });
      } else {
        andConditions.push({ _id: null }); // Force no match
      }
    }

    // State & City
    if (state) andConditions.push({ state: state });
    if (city) andConditions.push({ city: city });

    // Base Stats Query (Includes all filters EXCEPT Status)
    const statsQuery = {
      $and: [baseQuery, ...andConditions],
    };

    // Add Status to Data Query
    const dataConditions = [...andConditions];
    if (status && status !== "total") {
      if (status === "Closed Won") {
        dataConditions.push({ status: "Closed", closetype: "Closed Won" });
      } else if (status === "Closed Lost") {
        dataConditions.push({ status: "Closed", closetype: "Closed Lost" });
      } else {
        dataConditions.push({ status: status });
      }
    }

    // Combine Queries for Data (includes status)
    const finalQuery = {
      $and: [baseQuery, ...dataConditions],
    };

    // 3. Handle analytics mode: return aggregated per-user metrics only
    if (type === "analytics") {
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();
      const hasDateRange = Boolean(fromDate && toDate);
      const start = hasDateRange ? new Date(fromDate) : null;
      const end = hasDateRange ? new Date(toDate) : null;

      const matchStage = { $match: finalQuery };
      const projectFields = {
        createdBy: 1,
        status: 1,
        closetype: 1,
        closeamount: { $ifNull: ["$closeamount", 0] },
        estimatedValue: { $ifNull: ["$estimatedValue", 0] },
        history: { $ifNull: ["$history", []] },
        totalHistoryCount: { $size: { $ifNull: ["$history", []] } },
      };

      if (hasDateRange) {
        projectFields.rangeHistoryCount = {
          $size: {
            $filter: {
              input: "$history",
              as: "h",
              cond: {
                $and: [
                  { $gte: ["$$h.timestamp", start] },
                  { $lte: ["$$h.timestamp", end] },
                ],
              },
            },
          },
        };
      } else {
        projectFields.monthHistoryCount = {
          $size: {
            $filter: {
              input: "$history",
              as: "h",
              cond: {
                $and: [
                  { $eq: [{ $month: "$$h.timestamp" }, currentMonth] },
                  { $eq: [{ $year: "$$h.timestamp" }, currentYear] },
                ],
              },
            },
          },
        };
      }

      const groupStage = {
        $group: {
          _id: "$createdBy",
          allTimeEntries: { $sum: 1 },
          totalVisits: {
            $sum: hasDateRange ? "$rangeHistoryCount" : "$totalHistoryCount",
          },
          monthEntries: {
            $sum: hasDateRange ? "$rangeHistoryCount" : "$monthHistoryCount",
          },
          cold: {
            $sum: { $cond: [{ $eq: ["$status", "Not Interested"] }, 1, 0] },
          },
          warm: {
            $sum: { $cond: [{ $eq: ["$status", "Maybe"] }, 1, 0] },
          },
          hot: {
            $sum: { $cond: [{ $eq: ["$status", "Interested"] }, 1, 0] },
          },
          closedWon: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "Closed"] },
                    { $eq: ["$closetype", "Closed Won"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          closedLost: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "Closed"] },
                    { $eq: ["$closetype", "Closed Lost"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalClosingAmount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "Closed"] },
                    { $eq: ["$closetype", "Closed Won"] },
                  ],
                },
                { $ifNull: ["$closeamount", 0] },
                0,
              ],
            },
          },
          hotValue: {
            $sum: {
              $cond: [
                { $eq: ["$status", "Interested"] },
                { $ifNull: ["$estimatedValue", 0] },
                0,
              ],
            },
          },
          warmValue: {
            $sum: {
              $cond: [
                { $eq: ["$status", "Maybe"] },
                { $ifNull: ["$estimatedValue", 0] },
                0,
              ],
            },
          },
        },
      };

      const pipeline = [matchStage, { $project: projectFields }, groupStage];
      const aggregated = await Entry.aggregate(pipeline);

      return res.status(200).json(aggregated);
    }

    // 4. Fetch Data & Stats for normal mode
    let entries = [];
    let total = 0;
    let stats = {
      cold: 0,
      warm: 0,
      hot: 0,
      closedWon: 0,
      closedLost: 0,
      totalVisits: 0,
      monthlyVisits: 0,
    };

    if (isPaginationEnabled) {
      // Parallel execution for data and stats
      const [data, count, statsResult] = await Promise.all([
        Entry.find(finalQuery)
          .populate("createdBy", "username role assignedAdmins")
          .populate("assignedTo", "username role assignedAdmins")
          .sort({ updatedAt: -1, createdAt: -1 })
          .skip(skip)
          .limit(pageSize)
          .lean(),
        Entry.countDocuments(finalQuery),
        Entry.aggregate([
          {
            $facet: {
              // Status Counts: Based on statsQuery (ignoring status filter)
              statusCounts: [
                { $match: statsQuery },
                {
                  $group: {
                    _id: { status: "$status", closetype: "$closetype" },
                    count: { $sum: 1 },
                  },
                },
              ],
              // History Stats: FIXED - Use statsQuery (not finalQuery) to get ALL visits regardless of status filter
              historyStats: [
                { $match: statsQuery },
                { $unwind: "$history" },
                {
                  $project: {
                    timestamp: "$history.timestamp",
                  },
                },
              ],
            },
          },
        ]),
      ]);

      entries = data;
      total = count;

      // Process Stats
      if (statsResult && statsResult[0]) {
        // Status Counts
        statsResult[0].statusCounts.forEach((item) => {
          const { status, closetype } = item._id;
          const count = item.count;
          if (status === "Not Interested") stats.cold += count;
          else if (status === "Maybe") stats.warm += count;
          else if (status === "Interested") stats.hot += count;
          else if (status === "Closed") {
            if (closetype === "Closed Won") stats.closedWon += count;
            else if (closetype === "Closed Lost") stats.closedLost += count;
          }
        });

        // Visit Counts - FIXED: Correct month comparison (getMonth returns 0-11, need to add 1)
        const now = new Date();
        const currentMonth = now.getMonth() + 1; // FIXED: Add 1 to match 1-12 range
        const currentYear = now.getFullYear();
        statsResult[0].historyStats.forEach((h) => {
          const ts = new Date(h.timestamp);
          stats.totalVisits++;

          // Monthly Visits Logic - FIXED: Compare with 1-12 range
          const tsMonth = ts.getMonth() + 1; // FIXED: Add 1 to match 1-12 range
          const tsYear = ts.getFullYear();
          if (tsMonth === currentMonth && tsYear === currentYear) {
            stats.monthlyVisits++;
          }
        });
      }

    } else {
      // Non-paginated (legacy support for drawers/exports)
      entries = await Entry.find(finalQuery)
        .populate("createdBy", "username role assignedAdmins")
        .populate("assignedTo", "username role assignedAdmins")
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean();
    }

    res.status(200).json(
      isPaginationEnabled
        ? {
          success: true,
          data: entries,
          pagination: {
            total,
            page: pageNumber,
            limit: pageSize,
            pages: Math.ceil(total / pageSize),
            hasMore: skip + entries.length < total,
          },
          stats,
        }
        : entries // Keep returning array for legacy calls if any
    );
  } catch (error) {
    console.error("Error fetching entries:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch entries",
      error: error.message,
    });
  }
};

const analyticsOverview = async (req, res) => {
  try {
    const { fromDate, toDate, search, username, state, city } = req.query;
    let baseQuery = {};
    const currentUserId = new mongoose.Types.ObjectId(req.user.id);
    if (isSuperAdminLike(req.user.role)) {
      baseQuery = {};
    } else if (req.user.role === "admin") {
      const teamMembers = await User.find({ assignedAdmins: req.user.id }).select("_id role");
      let teamMemberIds = teamMembers.map((m) => m._id);
      const adminIds = teamMembers.filter((m) => m.role === "admin").map((a) => a._id);
      const nestedMembers = await User.find({ assignedAdmins: { $in: adminIds } }).select("_id");
      teamMemberIds = [...new Set([...teamMemberIds, ...nestedMembers.map((m) => m._id)])];
      baseQuery = {
        $or: [
          { createdBy: currentUserId },
          { createdBy: { $in: teamMemberIds } },
          { assignedTo: currentUserId },
          { assignedTo: { $in: teamMemberIds } },
        ],
      };
    } else {
      baseQuery = { $or: [{ createdBy: currentUserId }, { assignedTo: currentUserId }] };
    }
    const andConditions = [];
    if (search) {
      const searchRegex = new RegExp(search, "i");
      andConditions.push({
        $or: [
          { customerName: searchRegex },
          { address: searchRegex },
          { mobileNumber: { $regex: searchRegex } },
          { "products.name": searchRegex },
        ],
      });
    }
    if (fromDate && toDate) {
      const start = new Date(fromDate);
      const end = new Date(toDate);
      andConditions.push({
        $or: [{ createdAt: { $gte: start, $lte: end } }, { updatedAt: { $gte: start, $lte: end } }],
      });
    }
    if (username) {
      const user = await User.findOne({ username });
      if (user) {
        andConditions.push({ $or: [{ createdBy: user._id }, { assignedTo: user._id }] });
      } else {
        andConditions.push({ _id: null });
      }
    }
    if (state) andConditions.push({ state });
    if (city) andConditions.push({ city });
    const finalQuery = { $and: [baseQuery, ...andConditions] };
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // FIXED: Add 1 to match 1-12 range
    const currentYear = now.getFullYear();
    const hasDateRange = Boolean(fromDate && toDate);
    const start = hasDateRange ? new Date(fromDate) : null;
    const end = hasDateRange ? new Date(toDate) : null;
    const result = await Entry.aggregate([
      { $match: finalQuery },
      {
        $facet: {
          statusCounts: [
            {
              $group: {
                _id: { status: "$status", closetype: "$closetype" },
                count: { $sum: 1 },
              },
            },
          ],
          historyStats: [
            { $unwind: "$history" },
            {
              $project: {
                timestamp: "$history.timestamp",
              },
            },
          ],
        },
      },
    ]);
    const stats = {
      cold: 0,
      warm: 0,
      hot: 0,
      closedWon: 0,
      closedLost: 0,
      totalVisits: 0,
      monthlyVisits: 0,
    };
    if (result && result[0]) {
      result[0].statusCounts.forEach((item) => {
        const { status, closetype } = item._id;
        const count = item.count;
        if (status === "Not Interested") stats.cold += count;
        else if (status === "Maybe") stats.warm += count;
        else if (status === "Interested") stats.hot += count;
        else if (status === "Closed") {
          if (closetype === "Closed Won") stats.closedWon += count;
          else if (closetype === "Closed Lost") stats.closedLost += count;
        }
      });
      result[0].historyStats.forEach((h) => {
        const ts = new Date(h.timestamp);
        if (hasDateRange) {
          if (ts >= start && ts <= end) {
            stats.totalVisits++;
            stats.monthlyVisits++;
          }
        } else {
          stats.totalVisits++;
          // FIXED: Correct month comparison (getMonth returns 0-11, need to add 1)
          const tsMonth = ts.getMonth() + 1;
          const tsYear = ts.getFullYear();
          if (tsMonth === currentMonth && tsYear === currentYear) {
            stats.monthlyVisits++;
          }
        }
      });
    }
    res.status(200).json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch overview analytics" });
  }
};

const analyticsUserMetrics = async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    let userIds = [];
    const currentUserId = new mongoose.Types.ObjectId(req.user.id);
    if (isSuperAdminLike(req.user.role)) {
      const users = await User.find({ role: { $in: ["admin", "salesperson"] } }).select("_id");
      userIds = users.map((u) => u._id);
    } else if (req.user.role === "admin") {
      const teamMembers = await User.find({ assignedAdmins: req.user.id }).select("_id role");
      let teamMemberIds = teamMembers.map((m) => m._id);
      const adminIds = teamMembers.filter((m) => m.role === "admin").map((a) => a._id);
      const nestedMembers = await User.find({ assignedAdmins: { $in: adminIds } }).select("_id");
      teamMemberIds = [...new Set([...teamMemberIds, ...nestedMembers.map((m) => m._id)])];
      userIds = [...new Set([currentUserId, ...teamMemberIds])];
    } else {
      userIds = [currentUserId];
    }
    const matchDate = {};
    if (fromDate && toDate) {
      const start = new Date(fromDate);
      const end = new Date(toDate);
      matchDate.$or = [{ createdAt: { $gte: start, $lte: end } }, { updatedAt: { $gte: start, $lte: end } }];
    }
    const finalQuery = {
      $and: [{ createdBy: { $in: userIds } }, ...(matchDate.$or ? [matchDate] : [])],
    };
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const hasDateRange = Boolean(fromDate && toDate);
    const start = hasDateRange ? new Date(fromDate) : null;
    const end = hasDateRange ? new Date(toDate) : null;
    const agg = await Entry.aggregate([
      { $match: finalQuery },
      {
        $facet: {
          entryStats: [
            {
              $group: {
                _id: "$createdBy",
                allTimeEntries: { $sum: 1 },
                cold: { $sum: { $cond: [{ $eq: ["$status", "Not Interested"] }, 1, 0] } },
                warm: { $sum: { $cond: [{ $eq: ["$status", "Maybe"] }, 1, 0] } },
                hot: { $sum: { $cond: [{ $eq: ["$status", "Interested"] }, 1, 0] } },
                closedWon: {
                  $sum: {
                    $cond: [{ $and: [{ $eq: ["$status", "Closed"] }, { $eq: ["$closetype", "Closed Won"] }] }, 1, 0],
                  },
                },
                closedLost: {
                  $sum: {
                    $cond: [{ $and: [{ $eq: ["$status", "Closed"] }, { $eq: ["$closetype", "Closed Lost"] }] }, 1, 0],
                  },
                },
                totalClosingAmount: {
                  $sum: {
                    $cond: [
                      { $and: [{ $eq: ["$status", "Closed"] }, { $eq: ["$closetype", "Closed Won"] }] },
                      { $ifNull: ["$closeamount", 0] },
                      0,
                    ],
                  },
                },
                hotValue: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "Interested"] }, { $ifNull: ["$estimatedValue", 0] }, 0],
                  },
                },
                warmValue: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "Maybe"] }, { $ifNull: ["$estimatedValue", 0] }, 0],
                  },
                },
              },
            },
          ],
          historyStats: [
            { $unwind: "$history" },
            {
              $group: {
                _id: "$createdBy",
                totalVisits: {
                  $sum: 1,
                },
                monthlyVisits: {
                  $sum: {
                    $cond: [
                      hasDateRange
                        ? {
                          $and: [
                            { $gte: ["$history.timestamp", start] },
                            { $lte: ["$history.timestamp", end] },
                          ],
                        }
                        : {
                          $and: [
                            { $eq: [{ $month: "$history.timestamp" }, currentMonth + 1] },
                            { $eq: [{ $year: "$history.timestamp" }, currentYear] },
                          ],
                        },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    ]);
    const entryMap = new Map();
    (agg[0]?.entryStats || []).forEach((e) => {
      entryMap.set(String(e._id), e);
    });
    const historyMap = new Map();
    (agg[0]?.historyStats || []).forEach((h) => {
      historyMap.set(String(h._id), h);
    });
    const users = await User.find({ _id: { $in: userIds } }).select("_id username role assignedAdmins assignedAdmin");
    const metrics = users.map((u) => {
      const id = String(u._id);
      const e = entryMap.get(id) || {};
      const h = historyMap.get(id) || {};
      return {
        userId: id,
        username: u.username || "",
        role: typeof u.role === "string" ? u.role.toLowerCase() : "",
        assignedAdmin: u.assignedAdmin || null,
        assignedAdmins: Array.isArray(u.assignedAdmins) ? u.assignedAdmins : [],
        allTimeEntries: e.allTimeEntries || 0,
        monthEntries: h.monthlyVisits || 0,
        totalVisits: h.totalVisits || 0,
        cold: e.cold || 0,
        warm: e.warm || 0,
        hot: e.hot || 0,
        closedWon: e.closedWon || 0,
        closedLost: e.closedLost || 0,
        totalClosingAmount: e.totalClosingAmount || 0,
        hotValue: e.hotValue || 0,
        warmValue: e.warmValue || 0,
      };
    });
    res.status(200).json({ success: true, data: metrics });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch user metrics" });
  }
};

// Delete Entry
const DeleteData = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid entry ID" });
    }

    const entry = await Entry.findById(req.params.id);
    if (!entry) {
      return res
        .status(404)
        .json({ success: false, message: "Entry not found" });
    }

    if (isSuperAdminLike(req.user.role)) {
      // Superadmin can delete any entry
    } else if (req.user.role === "admin") {
      const teamMembers = await User.find({
        assignedAdmins: req.user.id,
      }).select("_id");
      const teamMemberIds = teamMembers.map((member) => member._id);
      if (
        entry.createdBy.toString() !== req.user.id &&
        !teamMemberIds.includes(entry.createdBy)
      ) {
        return res
          .status(403)
          .json({ success: false, message: "Unauthorized" });
      }
    } else {
      if (entry.createdBy.toString() !== req.user.id) {
        return res
          .status(403)
          .json({ success: false, message: "Unauthorized" });
      }
    }

    // Notifications
    await createNotification(
      req,
      req.user.id,
      `Entry deleted: ${entry.customerName}`,
      entry._id
    );
    for (const userId of entry.assignedTo || []) {
      await createNotification(
        req,
        userId,
        `Entry deleted: ${entry.customerName}`,
        entry._id
      );
    }

    await Entry.findByIdAndDelete(req.params.id);
    try {
      const io = req.app.get("io");
      if (io) {
        io.emit("entryDeleted", { _id: entry._id });
      }
    } catch (emitErr) {
      logger.error("Socket emit error (entryDeleted):", emitErr.message);
    }
    res
      .status(200)
      .json({ success: true, message: "Entry deleted successfully" });
  } catch (error) {
    console.error("Error fetching entries:", error);
    res.status(500).json({
      success: false,
      message:
        "Sorry, we are unable to load the entries right now. Please try again later.",
    });
  }
};

// Edit Entry
const editEntry = async (req, res) => {
  try {
    const {
      customerName,
      customerEmail,
      mobileNumber,
      contactperson,
      firstdate,
      address,
      state,
      city,
      products,
      type,
      organization,
      category,
      status,
      expectedClosingDate,
      followUpDate,
      remarks,
      liveLocation,
      nextAction,
      estimatedValue,
      closeamount,
      closetype,
      firstPersonMeet,
      secondPersonMeet,
      thirdPersonMeet,
      fourthPersonMeet,
      assignedTo,
      createdAt,

    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid entry ID" });
    }

    const entry = await Entry.findById(req.params.id);
    if (!entry) {
      return res
        .status(404)
        .json({ success: false, message: "Entry not found" });
    }
    // CHANGE: Prevent user from entering their own mobile number
    if (mobileNumber !== undefined) {
      const user = await User.findById(req.user.id);
      const phoneValidation = validatePhoneNumber(mobileNumber, user?.username);
      if (!phoneValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: phoneValidation.message,
        });
      }
    }
    let parsedProducts = [];
    if (products) {
      try {
        if (typeof products === "string") {
          parsedProducts = JSON.parse(products);
        } else if (Array.isArray(products)) {
          parsedProducts = products;
        }
        parsedProducts = parsedProducts.filter(
          (p) => p.name && p.specification && p.size && p.quantity
        );
      } catch (error) {
        logger.error("Error parsing products:", error.message);

        return res.status(400).json({
          success: false,
          message: "Invalid products data format",
        });
      }
    }

    let validatedAssignedTo = [];
    if (assignedTo && Array.isArray(assignedTo)) {
      for (const userId of assignedTo) {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
          return res.status(400).json({
            success: false,
            message: `Invalid user ID format: ${userId}`,
          });
        }
        const user = await User.findById(userId);
        if (!user) {
          return res.status(400).json({
            success: false,
            message: `User not found: ${userId}`,
          });
        }
        validatedAssignedTo.push(userId);
      }
    }

    const assignedToChanged =
      JSON.stringify(entry.assignedTo) !== JSON.stringify(validatedAssignedTo);

    let historyEntry = {};
    const newFollowUpDate = followUpDate ? new Date(followUpDate) : null;
    const oldFollowUpDate = entry.followUpDate ? new Date(entry.followUpDate) : null;
    const followUpDateChanged =
      newFollowUpDate && oldFollowUpDate
        ? newFollowUpDate.getTime() !== oldFollowUpDate.getTime()
        : newFollowUpDate !== oldFollowUpDate;
    let hasChanges = false;

    // Check for status update
    if (status !== undefined && status !== entry.status) {
      if (!liveLocation) {
        return res.status(400).json({
          success: false,
          message: "Live location is required when updating status",
        });
      }
      historyEntry = {
        status,
        remarks: remarks || "Status updated",
        liveLocation: liveLocation || entry.liveLocation,
        nextAction: nextAction || entry.nextAction,
        estimatedValue: estimatedValue
          ? Number(estimatedValue)
          : entry.estimatedValue,
        products: parsedProducts.length > 0 ? parsedProducts : entry.products,
        assignedTo: validatedAssignedTo,
        followUpDate: newFollowUpDate,
        timestamp: new Date(),
      };
    }
    // Check for remarks update
    else if (remarks !== undefined && remarks !== entry.remarks) {
      historyEntry = {
        status: entry.status,
        remarks,
        liveLocation: liveLocation || entry.liveLocation,
        nextAction: nextAction || entry.nextAction,
        products: parsedProducts.length > 0 ? parsedProducts : entry.products,
        assignedTo: validatedAssignedTo,
        followUpDate: newFollowUpDate,
        timestamp: new Date(),
      };
    }
    // Check for products update
    else if (
      parsedProducts.length > 0 &&
      JSON.stringify(parsedProducts) !== JSON.stringify(entry.products)
    ) {
      historyEntry = {
        status: entry.status,
        remarks: remarks || "Products updated",
        liveLocation: liveLocation || entry.liveLocation,
        nextAction: nextAction || entry.nextAction,
        products: parsedProducts,
        assignedTo: validatedAssignedTo,
        followUpDate: newFollowUpDate,
        timestamp: new Date(),
      };
    }
    // Check for assignedTo update
    else if (assignedTo !== undefined && assignedToChanged) {
      historyEntry = {
        status: entry.status,
        remarks: remarks || "Assigned users updated",
        liveLocation: liveLocation || entry.liveLocation,
        nextAction: nextAction || entry.nextAction,
        products: parsedProducts.length > 0 ? parsedProducts : entry.products,
        assignedTo: validatedAssignedTo,
        followUpDate: newFollowUpDate,
        timestamp: new Date(),
      };
    }
    // Check for followUpDate update
    else if (followUpDate !== undefined && followUpDateChanged) {
      historyEntry = {
        status: entry.status,
        remarks: remarks || "Follow-up date updated",
        liveLocation: liveLocation || entry.liveLocation,
        nextAction: nextAction || entry.nextAction,
        products: parsedProducts.length > 0 ? parsedProducts : entry.products,
        assignedTo: validatedAssignedTo,
        followUpDate: newFollowUpDate,
        timestamp: new Date(),
      };
    }

    const personMeetFields = {
      firstPersonMeet,
      secondPersonMeet,
      thirdPersonMeet,
      fourthPersonMeet,
    };

    for (const [field, value] of Object.entries(personMeetFields)) {
      if (
        value !== undefined &&
        value.trim() !== "" &&
        value !== entry[field]
      ) {
        historyEntry[field] = value.trim();
        historyEntry.status = status || entry.status;
        historyEntry.remarks = remarks || "Person meet updated";
        historyEntry.liveLocation = liveLocation || entry.liveLocation;
        historyEntry.nextAction = nextAction || entry.nextAction;
        historyEntry.products = parsedProducts.length > 0 ? parsedProducts : entry.products;
        historyEntry.assignedTo = validatedAssignedTo;
        historyEntry.followUpDate = newFollowUpDate;
        historyEntry.timestamp = new Date();
      }
    }

    let attachmentPath;
    if (req.file) {
      if (req.file.size > 5 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          message: "File size exceeds 5MB limit",
        });
      }
      attachmentPath = req.file.filename;
      historyEntry.attachmentpath = attachmentPath;
      historyEntry.status = status || entry.status;
      historyEntry.remarks = remarks || "Attachment added";
      historyEntry.liveLocation = liveLocation || entry.liveLocation;
      historyEntry.nextAction = nextAction || entry.nextAction;
      historyEntry.estimatedValue = estimatedValue
        ? Number(estimatedValue)
        : entry.estimatedValue;
      historyEntry.products = parsedProducts.length > 0 ? parsedProducts : entry.products;
      historyEntry.assignedTo = validatedAssignedTo;
      historyEntry.followUpDate = newFollowUpDate;
      historyEntry.timestamp = new Date();
    }

    if (Object.keys(historyEntry).length > 0) {
      hasChanges = true;
      if (entry.history.length >= 10) {
        entry.history.shift();
      }
      entry.history.push(historyEntry);
    }

    if (assignedToChanged) {
      await Promise.all([
        ...validatedAssignedTo.map(async (userId) => {
          if (!entry.assignedTo.includes(userId)) {
            await createNotification(
              req,
              userId,
              `Assigned to updated entry: ${customerName || entry.customerName
              }`,
              entry._id
            );
          }
        }),
        ...entry.assignedTo.map(async (userId) => {
          if (!validatedAssignedTo.includes(userId)) {
            await createNotification(
              req,
              userId,
              `Unassigned from entry: ${customerName || entry.customerName}`,
              entry._id
            );
          }
        }),
      ]);
    }

    Object.assign(entry, {
      ...(customerName !== undefined && { customerName: customerName.trim() }),
      ...(customerEmail !== undefined && { customerEmail: customerEmail.trim() }),
      ...(mobileNumber !== undefined && { mobileNumber: mobileNumber.trim() }),
      ...(contactperson !== undefined && {
        contactperson: contactperson.trim(),
      }),
      ...(firstdate !== undefined && {
        firstdate: firstdate ? new Date(firstdate) : null,
      }),
      ...(address !== undefined && { address: address.trim() }),
      ...(state !== undefined && { state: state.trim() }),
      ...(city !== undefined && { city: city.trim() }),
      ...(parsedProducts.length > 0 && { products: parsedProducts }),
      ...(type !== undefined && { type: type.trim() }),
      ...(organization !== undefined && { organization: organization.trim() }),
      ...(category !== undefined && { category: category.trim() }),
      ...(status !== undefined && { status }),
      ...(expectedClosingDate !== undefined && {
        expectedClosingDate: expectedClosingDate
          ? new Date(expectedClosingDate)
          : null,
      }),
      ...(followUpDate !== undefined && {
        followUpDate: newFollowUpDate,
      }),
      ...(closetype !== undefined && { closetype: closetype.trim() }),
      ...(remarks !== undefined && { remarks: remarks.trim() }),
      ...(nextAction !== undefined && { nextAction: nextAction.trim() }),
      ...(estimatedValue !== undefined && {
        estimatedValue: Number(estimatedValue) || 0,
      }),
      ...(closeamount !== undefined && {
        closeamount: Number(closeamount) || 0,
      }),
      ...(firstPersonMeet !== undefined && {
        firstPersonMeet: firstPersonMeet.trim(),
      }),
      ...(secondPersonMeet !== undefined && {
        secondPersonMeet: secondPersonMeet.trim(),
      }),
      ...(thirdPersonMeet !== undefined && {
        thirdPersonMeet: thirdPersonMeet.trim(),
      }),
      ...(fourthPersonMeet !== undefined && {
        fourthPersonMeet: fourthPersonMeet.trim(),
      }),
      ...(assignedTo !== undefined && { assignedTo: validatedAssignedTo }),
      ...(attachmentPath && { attachmentpath: attachmentPath }),
      updatedAt: new Date(),
      ...(createdAt !== undefined && {
        createdAt: createdAt ? new Date(createdAt.trim()) : entry.createdAt,
      }),
    });

    const updatedEntry = await entry.save();
    // Send general update notification if there were changes (history added)
    if (hasChanges) {
      const updateMessage = `Entry "${customerName || entry.customerName}" has been updated.`;
      // Notify creator
      await createNotification(req, entry.createdBy, updateMessage, entry._id);
      // Notify current assigned users (new validatedAssignedTo)
      if (Array.isArray(validatedAssignedTo) && validatedAssignedTo.length > 0) {
        for (const userId of validatedAssignedTo) {
          await createNotification(req, userId, updateMessage, entry._id);
        }
      }
    }
    const populatedEntry = await Entry.findById(updatedEntry._id)
      .populate("createdBy", "username")
      .populate("assignedTo", "username")
      .populate("history.assignedTo", "username");

    try {
      const io = req.app.get("io");
      if (io) {
        io.emit("entryUpdated", populatedEntry);
      }
    } catch (emitErr) {
      logger.error("Socket emit error (entryUpdated):", emitErr.message);
    }

    res.status(200).json({
      success: true,
      data: populatedEntry,
      message: "Entry updated successfully",
    });
  } catch (error) {
    logger.error("Error in editEntry:", error);

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => ({
        field: err.path,
        message: err.message,
      }));
      return res.status(400).json({
        success: false,
        message: "Some input values are invalid. Please review and correct them.",
        errors,
      });
    }
    let userMessage = "Oops! Something went wrong while updating the entry. Please try again later.";
    if (error.message.includes("file")) {
      userMessage = "Invalid file uploaded. Please upload a valid document (PDF, image, Word).";
    }
    res.status(500).json({
      success: false,
      message: userMessage,
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
// Bulk Upload Stocks
const bulkUploadStocks = async (req, res) => {
  try {
    // Check MongoDB connection
    if (getCRMConnection().readyState !== 1) {
      logger.error(
        "MongoDB not connected, state:",
        getCRMConnection().readyState
      );

      return res.status(500).json({
        success: false,
        message: "Database connection error",
      });
    }

    if (!req.user?.id) {
      logger.error("No authenticated user found");

      return res
        .status(401)
        .json({ success: false, message: "User not authenticated" });
    }

    const newEntries = Array.isArray(req.body) ? req.body : [];
    if (!newEntries.length) {
      return res
        .status(400)
        .json({ success: false, message: "No entries provided" });
    }

    const entriesWithMetadata = [];
    const errors = [];

    for (const [index, entry] of newEntries.entries()) {
      try {
        logger.debug(
          `Processing entry ${index}:`,
          JSON.stringify(entry, null, 2)
        );


        // Validate mobile number
        if (entry.mobileNumber && !/^\d{10}$/.test(entry.mobileNumber)) {
          throw new Error(`Invalid mobile number: ${entry.mobileNumber}`);
        }
        // CHANGE: Prevent user from entering their own mobile number
        if (entry.mobileNumber) {
          const user = await User.findById(req.user.id);
          const phoneValidation = validatePhoneNumber(entry.mobileNumber, user?.username);
          if (!phoneValidation.isValid) {
            throw new Error(phoneValidation.message);
          }
        }

        // Validate products
        const products = Array.isArray(entry.products)
          ? entry.products.map((p) => ({
            name: String(p.name || ""),
            specification: String(p.specification || ""),
            size: String(p.size || ""),
            quantity: Number(p.quantity || 1),
          }))
          : [];

        // Validate dates
        const expectedClosingDate = entry.expectedClosingDate
          ? new Date(entry.expectedClosingDate)
          : null;
        if (expectedClosingDate && isNaN(expectedClosingDate.getTime())) {
          throw new Error(
            `Invalid expectedClosingDate: ${entry.expectedClosingDate}`
          );
        }

        const followUpDate = entry.followUpDate
          ? new Date(entry.followUpDate)
          : null;
        if (followUpDate && isNaN(followUpDate.getTime())) {
          throw new Error(`Invalid followUpDate: ${entry.followUpDate}`);
        }

        // Validate assignedTo (ensure valid ObjectIds)
        const assignedTo = Array.isArray(entry.assignedTo)
          ? entry.assignedTo.filter((id) => mongoose.Types.ObjectId.isValid(id))
          : [];

        const createdAt = entry.createdAt ? new Date(entry.createdAt) : new Date();  // Use incoming if valid, else now
        if (isNaN(createdAt.getTime())) {
          throw new Error(`Invalid createdAt: ${entry.createdAt}`);
        }

        // FIXED: Use createdAt for history timestamp to match entry's effective date (prevents current-month inflation for past data)
        const historyTimestamp = createdAt;

        const formattedEntry = {
          customerName: String(entry.customerName || ""),
          customerEmail: String(entry.customerEmail || ""),
          mobileNumber: String(entry.mobileNumber || ""),
          contactperson: String(entry.contactperson || ""),
          address: String(entry.address || ""),
          state: String(entry.state || ""),
          city: String(entry.city || ""),
          organization: String(entry.organization || ""),
          category: String(entry.category || ""),
          type: String(entry.type || ""),
          status: entry.status || "Not Found",
          closetype: entry.closetype || "",
          estimatedValue: Number(entry.estimatedValue || 0),
          closeamount: Number(entry.closeamount || 0),
          remarks: String(entry.remarks || ""),
          liveLocation: String(entry.liveLocation || ""),
          nextAction: String(entry.nextAction || ""),
          firstPersonMeet: String(entry.firstPersonMeet || ""),
          secondPersonMeet: String(entry.secondPersonMeet || ""),
          thirdPersonMeet: String(entry.thirdPersonMeet || ""),
          fourthPersonMeet: String(entry.fourthPersonMeet || ""),
          expectedClosingDate,
          followUpDate,
          products,
          assignedTo,
          createdBy: req.user.id,
          createdAt,
          updatedAt: createdAt,
          history: [
            {
              status: entry.status || "Not Found",
              remarks: entry.remarks || "Bulk upload entry",
              liveLocation: entry.liveLocation || null,
              products,
              assignedTo,
              timestamp: historyTimestamp,  // FIXED: Use past/current createdAt, not new Date()
              firstPersonMeet: String(entry.firstPersonMeet || ""),
              secondPersonMeet: String(entry.secondPersonMeet || ""),
              thirdPersonMeet: String(entry.thirdPersonMeet || ""),
              fourthPersonMeet: String(entry.fourthPersonMeet || ""),
            },
          ],
        };

        // Validate with Mongoose schema
        const entryDoc = new Entry(formattedEntry);
        await entryDoc.validate();

        entriesWithMetadata.push(formattedEntry);
      } catch (validationError) {
        logger.error(
          `Validation error for entry ${index}:`,
          validationError.message
        );

        errors.push({ entryIndex: index, error: validationError.message });
      }
    }

    if (!entriesWithMetadata.length) {
      return res.status(400).json({
        success: false,
        message: "No valid entries to upload",
        errors,
      });
    }

    const batchSize = 500;
    let insertedCount = 0;

    for (let i = 0; i < entriesWithMetadata.length; i += batchSize) {
      const batch = entriesWithMetadata.slice(i, i + batchSize);
      logger.info(`Inserting batch of ${batch.length} entries`);

      try {
        const insertedEntries = await Entry.insertMany(batch, {
          ordered: false,
          rawResult: true,
        });

        logger.debug(
          "InsertMany result:",
          JSON.stringify(insertedEntries, null, 2)
        );

        insertedCount +=
          insertedEntries.insertedCount || insertedEntries.length || 0;

        // Process notifications
        for (const entry of insertedEntries.ops || []) {
          try {
            await createNotification(
              req,
              req.user.id,
              `Bulk entry created: ${entry.customerName || "Unknown"}`,
              entry._id
            );
            for (const userId of entry.assignedTo || []) {
              await createNotification(
                req,
                userId,
                `Assigned to bulk entry: ${entry.customerName || "Unknown"}`,
                entry._id
              );
            }
          } catch (notificationError) {
            logger.error(
              `Notification error for entry ${entry._id}:`,
              notificationError.message
            );

            errors.push({
              entry: entry._id,
              error: `Notification failed: ${notificationError.message}`,
            });
          }
        }
      } catch (batchError) {
        logger.error(`Batch ${i / batchSize + 1} error:`, batchError.message);

        errors.push({ batch: i / batchSize + 1, error: batchError.message });
      }
    }

    logger.info(
      `Inserted ${insertedCount} of ${entriesWithMetadata.length} entries`
    );

    return res.status(201).json({
      success: insertedCount > 0,
      message: `Uploaded ${insertedCount} entries`,
      count: insertedCount,
      errors: errors.length ? errors : null,
    });
  } catch (error) {
    logger.error("Bulk upload error:", error.message, error.stack);

    return res.status(500).json({
      success: false,
      message: "Failed to process entries",
      error: error.message,
    });
  }
};


const formatDateDDMMYYYY = (date) => {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB"); // dd/mm/yyyy
};


// Export Entries
const exportentry = async (req, res) => {
  try {
    const filters = req.query;
    const matchConditions = [];

    // Role-based restriction
    let roleCondition;
    if (isSuperAdminLike(req.user.role)) {
      roleCondition = {};
    } else if (req.user.role === "admin") {
      const teamMembers = await User.find({
        assignedAdmins: req.user.id,
      }).select("_id");
      const teamMemberIds = teamMembers.map((member) => member._id);
      roleCondition = {
        $or: [
          { createdBy: req.user.id },
          { createdBy: { $in: teamMemberIds } },
          { assignedTo: req.user.id },
          { assignedTo: { $in: teamMemberIds } },
        ],
      };
    } else {
      roleCondition = {
        $or: [
          { createdBy: req.user.id },
          { assignedTo: req.user.id },
        ],
      };
    }
    if (Object.keys(roleCondition).length > 0) {
      matchConditions.push(roleCondition);
    }

    // Search filter
    if (filters.search) {
      matchConditions.push({
        $or: [
          { customerName: { $regex: filters.search, $options: "i" } },
          { customerEmail: { $regex: filters.search, $options: "i" } },
          { mobileNumber: { $regex: filters.search, $options: "i" } },
          { address: { $regex: filters.search, $options: "i" } },
          { products: { $elemMatch: { name: { $regex: filters.search, $options: "i" } } } },
        ],
      });
    }

    // Username filter
    if (filters.username) {
      const usernameUser = await User.findOne({ username: filters.username }).select('_id');
      if (usernameUser) {
        const uId = usernameUser._id;
        matchConditions.push({
          $or: [
            { createdBy: uId },
            { assignedTo: uId },
          ],
        });
      } else {
        // No user found, impossible condition for no results
        matchConditions.push({ _id: new mongoose.Types.ObjectId('000000000000000000000000') });
      }
    }

    // Status filter
    if (filters.status && filters.status !== 'total') {
      let statusCondition;
      if (filters.status === "Closed Won") {
        statusCondition = {
          $and: [
            { status: "Closed" },
            { closetype: "Closed Won" },
          ],
        };
      } else if (filters.status === "Closed Lost") {
        statusCondition = {
          $and: [
            { status: "Closed" },
            { closetype: "Closed Lost" },
          ],
        };
      } else {
        statusCondition = { status: filters.status };
      }
      matchConditions.push(statusCondition);
    }

    // State filter
    if (filters.state) {
      matchConditions.push({ state: filters.state });
    }

    // City filter
    if (filters.city) {
      matchConditions.push({ city: filters.city });
    }


    // Date range filter
    if (filters.fromDate && filters.toDate) {
      const fromUTC = new Date(filters.fromDate);
      const toUTC = new Date(filters.toDate);

      if (isNaN(fromUTC.getTime()) || isNaN(toUTC.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid date format" });
      }

      if (toUTC < fromUTC) {
        return res.status(400).json({ success: false, message: "toDate cannot be before fromDate" });
      }

      matchConditions.push({
        $or: [
          { createdAt: { $gte: fromUTC, $lte: toUTC } },
          { updatedAt: { $gte: fromUTC, $lte: toUTC } },
        ],
      });
    }



    // Build final query
    let query;
    if (matchConditions.length === 0) {
      query = {};
    } else if (matchConditions.length === 1) {
      query = matchConditions[0];
    } else {
      query = { $and: matchConditions };
    }

    const entries = await Entry.find(query)
      .populate("createdBy", "username role assignedAdmins")
      .populate("assignedTo", "username role assignedAdmins")
      .populate("history", "timestamp location remarks status nextAction firstPersonMeet secondPersonMeet thirdPersonMeet fourthPersonMeet attachmentpath")
      .lean();

    // Flatten the data: main entry rows followed by history rows
    const exportData = [];
    const headers = [
      "Section", "Customer_Name", "Customer_Email", "Mobile_Number", "Contact_Person", "Address", "City", "State",
      "Organization", "Category", "Type", "Products", "Estimated_Value", "Close_Amount",
      "Status", "Close_Type", "First_Meeting", "Follow_Up_Date", "Expected_Closing_Date", "Next_Action", "Remarks", "CreatedAt", "Updated", "Created By",
      "Assigned_To", "Attachment", "History Date", "First_Person_Meet",
      "Second_Person_Meet", "Third_Person_Meet", "Fourth_Person_Meet"
    ];

    // Add headers as first row
    exportData.push(headers);

    entries.forEach((entry, entryIndex) => {

      const mainRow = [
        `Client Entry #${entryIndex + 1}`,
        entry.customerName || "N/A",
        entry.customerEmail || "N/A",
        entry.mobileNumber || "N/A",
        entry.contactperson || "N/A",
        entry.address || "N/A",
        entry.city || "N/A",
        entry.state || "N/A",
        entry.organization || "N/A",
        entry.category || "N/A",
        entry.type || "Customer",
        entry.products
          ?.map(
            (p) =>
              `${p.name} (Spec: ${p.specification}, ${p.size}, Qty: ${p.quantity})`
          )
          .join("; ") || "N/A",
        entry.estimatedValue || "",
        entry.closeamount || "",
        entry.status || "Not Found",
        entry.closetype || "",
        formatDateDDMMYYYY(entry.firstdate),
        formatDateDDMMYYYY(entry.followUpDate),
        formatDateDDMMYYYY(entry.expectedClosingDate),
        entry.nextAction || "",
        entry.remarks || "",
        formatDateDDMMYYYY(entry.createdAt),
        formatDateDDMMYYYY(entry.updatedAt),
        entry.createdBy?.username || "N/A",
        Array.isArray(entry.assignedTo) ? entry.assignedTo.map((user) => user.username).join(", ") : (entry.assignedTo?.username || "Unassigned"),
        entry.attachmentpath ? "Yes" : "",
        "",
        entry.firstPersonMeet || "",
        entry.secondPersonMeet || "",
        entry.thirdPersonMeet || "",
        entry.fourthPersonMeet || ""
      ];
      exportData.push(mainRow);

      // History rows (sorted by timestamp ascending - oldest first)
      const sortedHistory = entry.history ? [...entry.history].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)) : [];
      sortedHistory.forEach((hist, histIndex) => {
        const historyRow = [
          `History #${histIndex + 1}`, "",
          "", "", "", "", "", "", "", // Empty for Customer to State (1-7)
          "", "", // Organization, Category (8-9)
          entry.products
            ?.map(
              (p) =>
                `${p.name} (Spec: ${p.specification}, ${p.size}, Qty: ${p.quantity})`
            )
            .join("; ") || "N/A", // Products (10)
          "", "", // Estimated Value, Closing Amount (11-12)
          hist.status || entry.status || "Maybe", // Status (13)
          "", "", "", // Close Type, First Meeting, Follow Up (14-16)
          "", // Expected Closing Date (17)
          hist.nextAction || "", // Next Action (18)
          hist.remarks || "N/A", // Remarks (19)
          "", "", // Created, Updated (20-21)
          "", // Created By (22)
          "", // Assigned To (23)
          hist.attachmentpath ? "Yes" : "", // Attachment (24)
          formatDateDDMMYYYY(hist.timestamp),
          hist.firstPersonMeet || "", // First Person Meet (26)
          hist.secondPersonMeet || "", // Second (27)
          hist.thirdPersonMeet || "", // Third (28)
          hist.fourthPersonMeet || "" // Fourth (29)
        ];
        exportData.push(historyRow);
      });
    });

    const ws = XLSX.utils.aoa_to_sheet(exportData);
    ws["!cols"] = [
      { wch: 15 }, // Section
      { wch: 20 }, // Customer
      { wch: 15 }, // Mobile Number
      { wch: 20 }, // Contact Person
      { wch: 30 }, // Address
      { wch: 15 }, // City
      { wch: 15 }, // State
      { wch: 20 }, // Organization
      { wch: 15 }, // Category
      { wch: 15 }, // Type
      { wch: 50 }, // Products
      { wch: 15 }, // Estimated Value
      { wch: 15 }, // Closing Amount
      { wch: 15 }, // Status
      { wch: 20 }, // Close Type
      { wch: 15 }, // First Meeting
      { wch: 15 }, // Follow Up
      { wch: 15 }, // Expected Closing Date
      { wch: 20 }, // Next Action
      { wch: 30 }, // Remarks
      { wch: 15 }, // Created
      { wch: 15 }, // Updated
      { wch: 15 }, // Created By
      { wch: 20 }, // Assigned To
      { wch: 10 }, // Attachment
      { wch: 15 }, // History Date
      { wch: 20 }, // First Person Meet
      { wch: 20 }, // Second Person Meet
      { wch: 20 }, // Third Person Meet
      { wch: 20 }  // Fourth Person Meet
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Customer Entries");

    const fileBuffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    res.setHeader("Content-Disposition", "attachment; filename=entries.xlsx");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.send(fileBuffer);
  } catch (error) {
    logger.error("Error exporting entries:", error);

    res.status(500).json({
      success: false,
      message: "Error exporting entries",
      error: error.message,
    });
  }
};

// Fetch all users (Superadmin only)
const fetchAllUsers = async (req, res) => {
  try {
    if (!isSuperAdminLike(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    const users = await User.find({})
      .select("_id username email role assignedAdmins")
      .lean();

    res.status(200).json(users);
  } catch (error) {
    logger.error("Error fetching all users:", error);

    res.status(500).json({
      success: false,
      message:
        "Oops! We encountered an issue while fetching users. Please try again later.",
      // For security, avoid exposing raw error to users
      // error: error.message,
    });
  }
};

// Get admin status
const getAdmin = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findById(req.user.id)
      .select("_id username role assignedAdmins")
      .lean();
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.status(200).json({
      success: true,
      isAdmin: user.role === "admin" || isSuperAdminLike(user.role),
      role: user.role,
      userId: user._id.toString(),
    });
  } catch (error) {
    logger.error("Error fetching user:", error);

    res.status(500).json({
      success: false,
      message:
        "Something went wrong while fetching your information. Please try again later.",
      // error: error.message, // Hide internal error from users
    });
  }
};

// Fetch users (Role-based)
const fetchUsers = async (req, res) => {
  try {
    let users = [];

    if (isSuperAdminLike(req.user.role)) {
      users = await User.find({})
        .select("_id username email role assignedAdmins")
        .lean();
    } else if (req.user.role === "admin") {
      users = await User.find({
        $or: [{ assignedAdmins: req.user.id }, { _id: req.user.id }],
      })
        .select("_id username email role assignedAdmins")
        .lean();
    } else {
      const user = await User.findById(req.user.id)
        .select("_id username email role assignedAdmins")
        .lean();
      if (!user.assignedAdmins?.length) {
        users.push(user);
      } else {
        users = await User.find({
          assignedAdmins: { $in: user.assignedAdmins },
        })
          .select("_id username email role assignedAdmins")
          .lean();
        users.push(user);
      }
    }

    if (!users.length) return res.status(200).json([]);

    users.sort((a, b) => a.username.localeCompare(b.username));

    res.status(200).json(users);
  } catch (error) {
    logger.error("Error fetching users:", error);

    res.status(500).json({
      success: false,
      message:
        "Oops! Something went wrong while fetching users. Please try again later.",
      // error: error.message,
    });
  }
};

// Fetch team
const fetchTeam = async (req, res) => {
  try {
    logger.debug("Fetching team for user:", req.user.id, "Role:", req.user.role);


    let users = [];

    if (isSuperAdminLike(req.user.role)) {
      users = await User.find({ _id: { $ne: req.user.id } })
        .select("_id username email role assignedAdmins")
        .lean();
      logger.debug("Superadmin users fetched:", users.length);

    } else if (req.user.role === "admin") {
      const allAdmins = await User.find({ role: "admin" })
        .select("_id assignedAdmins")
        .lean();
      const assignedAdminIds = allAdmins
        .filter(
          (admin) =>
            admin.assignedAdmins?.length > 0 &&
            admin._id.toString() !== req.user.id
        )
        .map((admin) => admin._id.toString());

      users = await User.find({
        $or: [
          { assignedAdmins: { $size: 0 } }, // Unassigned users
          { assignedAdmins: req.user.id }, // Users assigned to current admin
          {
            role: "admin",
            _id: { $ne: req.user.id },
            _id: { $nin: assignedAdminIds },
          }, // Unassigned admins
        ],
      })
        .select("_id username email role assignedAdmins")
        .lean();
      logger.debug("Admin users fetched:", users.length);

    } else if (req.user.role === "salesperson") {
      // Fetch assigned admins for "salesperson" role users
      const currentUser = await User.findById(req.user.id)
        .select("_id username email role assignedAdmins")
        .lean();
      if (!currentUser) {
        return res.status(404).json({
          success: false,
          message: "Current user not found",
        });
      }
      if (currentUser.assignedAdmins?.length > 0) {
        users = await User.find({
          _id: { $in: currentUser.assignedAdmins },
        })
          .select("_id username email role assignedAdmins")
          .lean();
      } else {
        users = [currentUser]; // Show only themselves if no assigned admins
      }
      logger.debug("Others users fetched:", users.length);
    } else {
      logger.debug("Unknown role, returning empty list");

      return res.status(200).json([]);
    }

    if (!users.length) {
      logger.debug("No users found, returning empty array");

      return res.status(200).json([]);
    }

    // Fetch all admins for username mapping
    const adminIds = [
      ...new Set(
        users
          .flatMap((u) => u.assignedAdmins || [])
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
      ),
    ];
    logger.debug("Admin IDs for mapping:", adminIds);
    const admins = await User.find({ _id: { $in: adminIds } })
      .select("_id username role")
      .lean();
    const adminMap = new Map(
      admins.map((a) => [
        a._id.toString(),
        { username: a.username, role: a.role },
      ])
    );

    for (const user of users) {
      user.assignedAdminUsernames =
        user.assignedAdmins
          ?.map((id) => adminMap.get(id.toString())?.username || "Unknown")
          .filter((username) => username !== "Unknown")
          .join(", ") || "Unassigned";
    }

    users.sort((a, b) => a.username.localeCompare(b.username));

    logger.debug("Final users sent to frontend:", users.length);
    res.status(200).json(users);
  } catch (error) {
    logger.error("Error fetching team:", error);

    res.status(500).json({
      success: false,
      message:
        "Sorry, we couldn't retrieve the team information right now. Please try again later or contact support if the issue continues.",
      // error: error.message,
    });
  }
};
// Get users for tagging
const getUsersForTagging = async (req, res) => {
  try {
    const users = await User.find({})
      .select("_id username")
      .sort({ username: 1 })
      .lean();

    res.status(200).json(users);
  } catch (error) {
    logger.error("Error fetching users for tagging:", error);

    res.status(500).json({
      success: false,
      message:
        "Oops! We couldn't load the user list for tagging right now. Please try again later or contact support if the problem continues.",
      // error: error.message,
    });
  }
};

// Assign user to admin
const assignUser = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID" });
    }

    if (userId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: "Cannot assign yourself",
      });
    }

    if (req.user.role !== "admin" && !isSuperAdminLike(req.user.role)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findById(userId);
    if (!user || isSuperAdminLike(user.role)) {
      return res.status(404).json({
        success: false,
        message: "User not found or cannot assign superadmin",
      });
    }

    if (!user.assignedAdmins) user.assignedAdmins = [];
    if (user.assignedAdmins.includes(req.user.id)) {
      return res.status(400).json({
        success: false,
        message: "User is already assigned to you",
      });
    }

    // Assign the user to the current admin
    user.assignedAdmins.push(req.user.id);
    await user.save();

    // If the assigned user is an admin, assign their team as well
    if (user.role === "admin") {
      const teamMembers = await User.find({ assignedAdmins: user._id });
      for (const teamMember of teamMembers) {
        if (!teamMember.assignedAdmins) teamMember.assignedAdmins = [];
        if (!teamMember.assignedAdmins.includes(req.user.id)) {
          teamMember.assignedAdmins.push(req.user.id);
          await teamMember.save();
          await createNotification(
            req,
            teamMember._id,
            `Assigned to admin: ${req.user.username} via admin ${user.username}`,
            null
          );
        }
      }
    }

    await createNotification(
      req,
      userId,
      `Assigned to admin: ${req.user.username}`,
      null
    );

    const adminIds = user.assignedAdmins;
    const admins = await User.find({ _id: { $in: adminIds } })
      .select("_id username")
      .lean();
    const adminMap = new Map(admins.map((a) => [a._id.toString(), a.username]));

    res.status(200).json({
      success: true,
      message: "User and team assigned successfully",
      user: {
        id: user._id,
        username: user.username,
        assignedAdmins: user.assignedAdmins,
        assignedAdminUsernames:
          user.assignedAdmins
            .map((id) => adminMap.get(id.toString()) || "Unknown")
            .join(", ") || "Unassigned",
        role: user.role,
      },
    });
  } catch (error) {
    logger.error("Error assigning user:", error);

    res.status(500).json({
      success: false,
      message:
        "Sorry, we couldn't assign the user right now. Please try again later or contact support if this issue continues.",
      // error: error.message,
    });
  }
};

// Unassign user from admin
const unassignUser = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID" });
    }

    if (req.user.role !== "admin" && !isSuperAdminLike(req.user.role)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findById(userId);
    if (!user || isSuperAdminLike(user.role)) {
      return res.status(404).json({
        success: false,
        message: "User not found or cannot unassign superadmin",
      });
    }

    if (!user.assignedAdmins?.length) {
      return res.status(400).json({
        success: false,
        message: "User is not assigned to any admin",
      });
    }

    // Check if user is assigned by a superadmin or globaladmin
    const assignedBySuperAdmin = await User.findOne({
      _id: { $in: user.assignedAdmins },
      role: { $in: ["superadmin", "globaladmin"] },
    });

    if (
      req.user.role === "admin" &&
      assignedBySuperAdmin &&
      !user.assignedAdmins.includes(req.user.id)
    ) {
      return res.status(403).json({
        success: false,
        message: "Cannot unassign user assigned by superadmin",
      });
    }

    // Superadmin can unassign anyone, admins can unassign their own or non-superadmin-assigned users
    if (
      isSuperAdminLike(req.user.role) ||
      user.assignedAdmins.includes(req.user.id) ||
      (!assignedBySuperAdmin && req.user.role === "admin")
    ) {
      const isForceUnassign =
        isSuperAdminLike(req.user.role) &&
        !user.assignedAdmins.includes(req.user.id);

      if (isForceUnassign) {
        user.assignedAdmins = [];
      } else {
        user.assignedAdmins = user.assignedAdmins.filter(
          (id) => id.toString() !== req.user.id
        );
      }

      if (user.role === "admin") {
        // Unassign the admin's team appropriately
        const teamMembers = await User.find({ assignedAdmins: user._id });
        for (const teamMember of teamMembers) {
          if (isForceUnassign) {
            // For force unassign, remove the sub-admin (user._id) from team member's assignedAdmins
            teamMember.assignedAdmins = teamMember.assignedAdmins.filter(
              (id) => id.toString() !== user._id.toString()
            );
          } else {
            // Normal case: remove the top-level admin (req.user.id) from team member's assignedAdmins
            teamMember.assignedAdmins = teamMember.assignedAdmins.filter(
              (id) => id.toString() !== req.user.id
            );
          }
          await teamMember.save();
          await createNotification(
            req,
            teamMember._id,
            `Unassigned from admin: ${req.user.username}`,
            null
          );
        }
      }

      await user.save();

      await createNotification(
        req,
        userId,
        `Unassigned from admin: ${req.user.username}`,
        null
      );

      res.status(200).json({
        success: true,
        message: "User and team unassigned successfully",
      });
    } else {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to unassign this user",
      });
    }
  } catch (error) {
    console.error("Error unassigning user:", error);
    res.status(500).json({
      success: false,
      message:
        "Sorry, we couldn't complete the unassignment right now. Please try again later or contact support if this keeps happening.",
      // error: error.message,
    });
  }
};
// Get current user
const getCurrentUser = async (req, res) => {
  try {
    console.log("Fetching current user:", req.user.id);
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      console.error("Invalid user ID:", req.user.id);
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    const user = await User.findById(req.user.id)
      .select("_id username email role assignedAdmins")
      .lean();

    if (!user) {
      console.error("User not found:", req.user.id);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    console.log("Current user fetched:", user.username);
    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Error fetching current user:", error);
    res.status(500).json({
      success: false,
      message:
        "Sorry, we couldn't retrieve your user information right now. Please try again later or contact support if the issue continues.",
      // error: error.message,
    });
  }
};

// Check-in
const checkIn = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "You need to be logged in to check in.",
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found. Please contact support.",
      });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const existingAttendance = await Attendance.findOne({
      user: req.user.id,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
      },
    });

    if (existingAttendance) {
      return res.status(400).json({
        success: false,
        message: "You have already checked in today.",
      });
    }

    const { remarks, checkInLocation } = req.body;

    if (
      !checkInLocation ||
      !checkInLocation.latitude ||
      !checkInLocation.longitude
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid check-in location.",
      });
    }

    const latitude = Number(checkInLocation.latitude);
    const longitude = Number(checkInLocation.longitude);

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({
        success: false,
        message: "Invalid coordinates provided for location.",
      });
    }

    const attendance = new Attendance({
      user: req.user.id,
      date: today,
      checkIn: new Date().toISOString(),
      checkInLocation: { latitude, longitude },
      remarks: remarks?.trim() || null,
      status: "Present",
    });

    await attendance.save();

    await createNotification(
      req,
      req.user.id,
      `Checked in at ${new Date().toISOString()}`,
      null
    );

    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate("user", "username")
      .lean();

    res.status(201).json({
      success: true,
      message: "Checked in successfully",
      data: {
        ...populatedAttendance,
        date: new Date(populatedAttendance.date).toISOString(),
        checkIn: populatedAttendance.checkIn
          ? new Date(populatedAttendance.checkIn).toISOString()
          : null,
        checkOut: populatedAttendance.checkOut
          ? new Date(populatedAttendance.checkOut).toISOString()
          : null,
      },
    });
  } catch (error) {
    console.error("Check-in error:", error);
    res.status(500).json({
      success: false,
      message:
        "Oops! We couldn't complete your check-in at the moment. Please try again shortly, or contact support if the problem persists.",
      // error: error.message,
    });
  }
};
// checkOut endpoint
const checkOut = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "You need to be logged in to check out.",
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found. Please contact support.",
      });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      user: req.user.id,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
      },
    });

    if (!attendance) {
      return res.status(400).json({
        success: false,
        message: "No check-in found for today. Please check in first.",
      });
    }

    if (attendance.checkOut) {
      return res.status(400).json({
        success: false,
        message: "You have already checked out today.",
      });
    }

    const { remarks, checkOutLocation } = req.body;

    if (
      !checkOutLocation ||
      checkOutLocation.latitude == null ||
      checkOutLocation.longitude == null
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid location to check out.",
      });
    }

    const latitude = Number(checkOutLocation.latitude);
    const longitude = Number(checkOutLocation.longitude);

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({
        success: false,
        message: "Invalid coordinates provided for location.",
      });
    }

    attendance.checkOut = new Date().toISOString();
    attendance.checkOutLocation = { latitude, longitude };
    attendance.remarks = remarks?.trim() || attendance.remarks || "";
    attendance.status = "Present";

    await attendance.save();

    await createNotification(
      req,
      req.user.id,
      `Checked out at ${new Date().toISOString()}`,
      null
    );

    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate("user", "username")
      .lean();

    res.status(200).json({
      success: true,
      message: "Checked out successfully",
      data: {
        ...populatedAttendance,
        date: new Date(populatedAttendance.date).toISOString(),
        checkIn: populatedAttendance.checkIn
          ? new Date(populatedAttendance.checkIn).toISOString()
          : null,
        checkOut: populatedAttendance.checkOut
          ? new Date(populatedAttendance.checkOut).toISOString()
          : null,
      },
    });
  } catch (error) {
    console.error("Check-out error:", error);
    res.status(500).json({
      success: false,
      message:
        "Oops! Something went wrong while checking you out. Please try again later or contact support if the issue persists.",
      // error: error.message,
    });
  }
};
// Fetch attendance
const fetchAttendance = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const {
      page = 1,
      limit = 10,
      startDate,
      endDate,
      selectedUserId,
    } = req.query;
    console.log(
      "Received attendance request with selectedUserId:",
      selectedUserId
    );
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (isNaN(pageNum) || pageNum < 1) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid page number" });
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        message: "Limit must be between 1 and 100",
      });
    }

    let query = {};

    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format",
        });
      }

      if (start > end) {
        return res.status(400).json({
          success: false,
          message: "startDate cannot be later than endDate",
        });
      }

      query.date = { $gte: start, $lte: end };
    }

    // Apply user filter if selectedUserId is provided
    if (selectedUserId) {
      if (isSuperAdminLike(user.role)) {
        // Superadmin can filter by any user
        query.user = selectedUserId;
      } else if (user.role === "admin") {
        // Admin can only filter by their team members or themselves
        const teamMembers = await User.find({
          assignedAdmins: req.user.id,
        }).select("_id");
        const teamMemberIds = teamMembers.map((member) => member._id);
        const allowedUserIds = [req.user.id, ...teamMemberIds];

        if (
          allowedUserIds
            .map((id) => id.toString())
            .includes(selectedUserId.toString())
        ) {
          query.user = selectedUserId;
        } else {
          return res.status(403).json({
            success: false,
            message: "You can only filter by your team members",
          });
        }
      } else {
        // Regular users can only filter by themselves
        if (selectedUserId === req.user.id) {
          query.user = selectedUserId;
        } else {
          return res.status(403).json({
            success: false,
            message: "You can only filter by your own attendance",
          });
        }
      }
    } else {
      // If no selectedUserId, apply role-based restrictions
      if (isSuperAdminLike(user.role)) {
        // No restrictions for superadmin
      } else if (user.role === "admin") {
        const teamMembers = await User.find({
          assignedAdmins: req.user.id,
        }).select("_id");
        const teamMemberIds = teamMembers.map((member) => member._id);
        query.user = { $in: [req.user.id, ...teamMemberIds] };
      } else {
        query.user = req.user.id;
      }
    }

    console.log(
      `Fetching attendance for user: ${req.user.id}, query: ${JSON.stringify(
        query
      )}`
    );

    const skip = (pageNum - 1) * limitNum;

    const totalRecords = await Attendance.countDocuments(query);
    console.log(`Total records: ${totalRecords}`);

    const attendance = await Attendance.find(query)
      .populate("user", "username")
      .sort({ date: -1, _id: -1 }) // Sort by date and _id to ensure consistent order
      .skip(skip)
      .limit(limitNum)
      .lean();

    console.log(`Fetched records: ${JSON.stringify(attendance)}`);

    const formattedAttendance = attendance.map((record) => ({
      ...record,
      user: record.user || { username: "Unknown" },
      date: record.date ? new Date(record.date).toISOString() : null,
      checkIn: record.checkIn ? new Date(record.checkIn).toISOString() : null,
      checkOut: record.checkOut
        ? new Date(record.checkOut).toISOString()
        : null,
    }));

    res.status(200).json({
      success: true,
      data: formattedAttendance,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalRecords / limitNum),
        totalRecords,
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error("Fetch attendance error:", error);
    res.status(500).json({
      success: false,
      message:
        "Sorry, we couldn’t load attendance data at this time. Please try again later or contact support if the issue persists.",
      // error: error.message,
    });
  }
};
// Fetch notifications
const fetchNotifications = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { page = 1, limit = 10, readStatus } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (isNaN(pageNum) || pageNum < 1) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid page number" });
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        message: "Limit must be between 1 and 100",
      });
    }

    let query = { userId: req.user.id };
    if (readStatus === "read") {
      query.read = true;
    } else if (readStatus === "unread") {
      query.read = false;
    }

    const skip = (pageNum - 1) * limitNum;
    const totalRecords = await Notification.countDocuments(query);

    const notifications = await Notification.find(query)
      .populate("entryId", "customerName")
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalRecords / limitNum),
        totalRecords,
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
      error: error.message,
    });
  }
};

// Mark notifications as read
const markNotificationsRead = async (req, res) => {
  try {
    const { notificationIds } = req.body;

    if (!Array.isArray(notificationIds) || !notificationIds.length) {
      return res.status(400).json({
        success: false,
        message: "Notification IDs required",
      });
    }

    for (const id of notificationIds) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: `Invalid notification ID: ${id}`,
        });
      }
    }

    await Notification.updateMany(
      { _id: { $in: notificationIds }, userId: req.user.id },
      { read: true }
    );

    res.status(200).json({
      success: true,
      message: "Notifications marked as read",
    });
  } catch (error) {
    console.error("Error marking notifications:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notifications",
      error: error.message,
    });
  }
};

// Clear notifications
const clearNotifications = async (req, res) => {
  try {
    if (!req.user.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    await Notification.deleteMany({ userId: req.user.id });

    req.app.get("io").to(req.user.id).emit("notificationsCleared");

    res.status(200).json({
      success: true,
      message: "Notifications cleared successfully",
    });
  } catch (error) {
    console.error("Error clearing notifications:", error);
    res.status(500).json({
      success: false,
      message: "Failed to clear notifications",
      error: error.message,
    });
  }
};

const exportAttendance = async (req, res) => {
  try {
    // Authenticate user
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findById(req.user.id).lean();
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Validate query parameters
    const { startDate, endDate, selectedUserId } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Start date and end date are required",
      });
    }

    const start = new Date(startDate);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setUTCHours(23, 59, 59, 999);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format",
      });
    }

    if (start > end) {
      return res.status(400).json({
        success: false,
        message: "Start date cannot be later than end date",
      });
    }

    // Determine users based on role and selectedUserId
    let users;

    if (selectedUserId) {
      if (isSuperAdminLike(user.role)) {
        // Superadmin can select any user
        const selectedUser = await User.findById(selectedUserId).select("username _id").lean();
        if (!selectedUser) {
          return res.status(404).json({ success: false, message: "Selected user not found" });
        }
        users = [selectedUser];
      } else if (user.role === "admin") {
        // Admin can only select their team or self
        const teamMembers = await User.find({
          $or: [{ assignedAdmins: req.user.id }, { _id: req.user.id }]
        }).select("_id username").lean();
        const selectedUser = teamMembers.find(u => u._id.toString() === selectedUserId);
        if (!selectedUser) {
          return res.status(403).json({
            success: false,
            message: "You can only filter by your team members or yourself",
          });
        }
        users = [selectedUser];
      } else {
        // Regular user only self
        if (selectedUserId !== req.user.id.toString()) {
          return res.status(403).json({
            success: false,
            message: "You can only filter by your own attendance",
          });
        }
        users = [user];
      }
    } else {
      // No selection: based on role
      if (isSuperAdminLike(user.role)) {
        // Superadmin gets all users overall
        users = await User.find({}).select("_id username").lean();
      } else if (user.role === "admin") {
        users = await User.find({
          $or: [{ assignedAdmins: req.user.id }, { _id: req.user.id }]
        }).select("_id username").lean();
      } else {
        users = [user];
      }
    }

    // Deduplicate users by username (keep first occurrence for same name)
    const uniqueUsersMap = users.reduce((acc, u) => {
      if (u.username && !acc[u.username]) {
        acc[u.username] = u;
      }
      return acc;
    }, {});
    users = Object.values(uniqueUsersMap);

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No users found for export",
      });
    }

    // Build attendance query base
    const attendanceQuery = {
      date: { $gte: start, $lte: end },
    };

    // Fetch all attendance for the users in range
    let fullAttendanceQuery = { ...attendanceQuery };
    const userIds = users.map(u => u._id);
    fullAttendanceQuery.user = { $in: userIds };

    const attendanceRecords = await Attendance.find(fullAttendanceQuery)
      .populate("user", "username")
      .sort({ date: 1, user: 1 })

    // Group attendance by user for easy lookup
    const attendanceByUser = {};
    attendanceRecords.forEach(record => {
      const userId = record.user._id.toString();
      if (!attendanceByUser[userId]) {
        attendanceByUser[userId] = {};
      }
      const dateKey = new Date(record.date).toDateString();
      attendanceByUser[userId][dateKey] = record;
    });

    // Generate all dates in range
    const dates = [];
    let currentDate = new Date(start);
    while (currentDate <= end) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    if (dates.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No dates in the specified range",
      });
    }

    // Function to get Excel serial number (date only, integer)
    const dateToExcelSerial = (date) => {
      const EPOCH = new Date('1899-12-30T00:00:00Z');
      const diffMs = date.getTime() - EPOCH.getTime();
      return Math.floor(diffMs / (1000 * 60 * 60 * 24));
    };

    // Function to determine status
    const getStatus = (date, record) => {
      const dayOfWeek = date.getDay();
      if (dayOfWeek === 0) {
        return "WeekOff";
      }


      if (record) {
        return record.status || "Present";
      }
      return "Absent";
    };

    // Status abbreviation map
    const statusMap = {
      'Present': 'P',
      'present': 'P',
      'PRESENT': 'P',
      'Absent': 'A',
      'absent': 'A',
      'ABSENT': 'A',
      'Leave': 'L',
      'leave': 'L',
      'LEAVE': 'L',
      'WeekOff': 'WO',
      'weekoff': 'WO',
      'WEEKOFF': 'WO',
      'Week Off': 'WO',
      'week off': 'WO',
      'WEEK OFF': 'WO'
    };

    // Build array of arrays for the sheet
    const aoa = [];
    const numCols = dates.length + 1;

    users.forEach((usr, userIndex) => {
      if (userIndex > 0) {
        // Add two empty rows between users
        aoa.push(Array(numCols).fill(''));
        aoa.push(Array(numCols).fill(''));
      }

      // Date row (Excel serial numbers for proper date formatting)
      aoa.push(['Date', ...dates.map(d => dateToExcelSerial(d))]);

      // Day row
      aoa.push(['Day', ...dates.map(d =>
        d.toLocaleDateString("en-GB", {
          weekday: "short",
          timeZone: "Asia/Kolkata"
        })
      )]);

      // Status row
      const userId = usr._id.toString();
      let statuses = dates.map(date => {
        const dateKey = date.toDateString();
        const record = attendanceByUser[userId]?.[dateKey];
        return getStatus(date, record);
      });
      const abbreviatedStatuses = statuses.map(s => {
        const lowerKey = s.toLowerCase().trim();
        const key = Object.keys(statusMap).find(k => k.toLowerCase() === lowerKey);
        return key ? statusMap[key] : s;
      });
      aoa.push([usr.username || "Unknown", ...abbreviatedStatuses]);

      // Check In row
      const checkIns = dates.map(date => {
        const dateKey = date.toDateString();
        const record = attendanceByUser[userId]?.[dateKey];
        const checkInTime = record?.checkIn ? new Date(record.checkIn) : null;
        return checkInTime
          ? checkInTime.toLocaleTimeString("en-US", {
            hour12: true,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            timeZone: "Asia/Kolkata"
          })
          : '';
      });
      aoa.push(['Check In Time', ...checkIns]);

      // Check Out row
      const checkOuts = dates.map(date => {
        const dateKey = date.toDateString();
        const record = attendanceByUser[userId]?.[dateKey];
        const checkOutTime = record?.checkOut ? new Date(record.checkOut) : null;
        return checkOutTime
          ? checkOutTime.toLocaleTimeString("en-US", {
            hour12: true,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            timeZone: "Asia/Kolkata"
          })
          : '';
      });
      aoa.push(['Check Out Time', ...checkOuts]);

      // Remarks row
      const remarksList = dates.map(date => {
        const dateKey = date.toDateString();
        return attendanceByUser[userId]?.[dateKey]?.remarks || '';
      });
      aoa.push(['Remarks', ...remarksList]);
    });

    if (aoa.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No attendance data available for the specified date range",
      });
    }

    // Create Excel worksheet from array of arrays
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Set column widths: wider for first column (employee names), narrower for days
    ws["!cols"] = [
      { wch: 20 },
      ...Array(dates.length).fill({ wch: 12 })
    ];

    // Apply date format to the date row cells (for each user's block)
    const dateFormat = { numFmt: 'dd/mm/yyyy' };
    aoa.forEach((row, r) => {
      if (row[0] === 'Date') {
        for (let c = 1; c < row.length; ++c) {
          const addr = XLSX.utils.encode_cell({ r, c });
          if (ws[addr]) {
            ws[addr].t = 'n'; // number type
            ws[addr].z = dateFormat.numFmt; // format
          }
        }
      }
    });

    // Style headers (Date, Day, Check In Time, etc.)
    const headerStyle = {
      font: { bold: true },
      fill: { fgColor: { rgb: "E1F5FE" } },
      alignment: { horizontal: "center" },
    };
    aoa.forEach((row, r) => {
      if (row[0] && (row[0] === 'Date' || row[0] === 'Day' || row[0] === 'Check In Time' || row[0] === 'Check Out Time' || row[0] === 'Remarks')) {
        // Style the header cell (first column)
        const addr = XLSX.utils.encode_cell({ r, c: 0 });
        if (ws[addr]) {
          if (!ws[addr].s) {
            ws[addr].s = headerStyle;
          } else {
            Object.assign(ws[addr].s, headerStyle);
          }
        }
      }
    });

    // Create Excel workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");

    // Generate and send file
    const fileBuffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Attendance_${startDate}_to_${endDate}.xlsx`
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.send(fileBuffer);
  } catch (error) {
    console.error("Error exporting attendance:", error);
    res.status(500).json({
      success: false,
      message:
        "Sorry, something went wrong while exporting attendance. Please try again later or contact support.",
    });
  }
};
const markLeave = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "You need to be logged in to mark leave.",
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found. Please contact support.",
      });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const existingAttendance = await Attendance.findOne({
      user: req.user.id,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
      },
    });

    if (existingAttendance) {
      return res.status(400).json({
        success: false,
        message: "Attendance already marked for today.",
      });
    }

    const { remarks } = req.body;

    const attendance = new Attendance({
      user: req.user.id,
      date: today,
      remarks: remarks?.trim() || null,
      status: "Leave",
    });

    await attendance.save();

    await createNotification(
      req,
      req.user.id,
      `Marked leave on ${new Date().toISOString()}`,
      null
    );

    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate("user", "username")
      .lean();

    res.status(201).json({
      success: true,
      message: "Leave marked successfully",
      data: {
        ...populatedAttendance,
        date: new Date(populatedAttendance.date).toISOString(),
        checkIn: populatedAttendance.checkIn
          ? new Date(populatedAttendance.checkIn).toISOString()
          : null,
        checkOut: populatedAttendance.checkOut
          ? new Date(populatedAttendance.checkOut).toISOString()
          : null,
      },
    });
  } catch (error) {
    console.error("Mark leave error:", error);
    res.status(500).json({
      success: false,
      message:
        "Oops! We couldn't mark your leave at the moment. Please try again shortly, or contact support if the problem persists.",
    });
  }
};
module.exports = {
  markLeave,
  bulkUploadStocks,
  getUsersForTagging,
  fetchAllUsers,
  DataentryLogic,
  fetchEntries,
  analyticsOverview,
  analyticsUserMetrics,
  DeleteData,
  editEntry,
  exportentry,
  exportAttendance,
  getAdmin,
  fetchUsers,
  assignUser,
  unassignUser,
  checkIn,
  checkOut,
  fetchTeam,
  fetchAttendance,
  fetchNotifications,
  markNotificationsRead,
  clearNotifications,
  getCurrentUser,
  checkDateNotifications,
};
