const mongoose = require("mongoose");
const XLSX = require("xlsx");
const { Server } = require("socket.io");
const User = require("../Models/Model");
const { Order, Notification } = require("../Models/Schema");
const { sendMail } = require("../utils/mailer");
const logger = require("../utils/logger");
let io;

const initSocket = (server, app) => {
  io = new Server(server, {
    path: "/sales/socket.io",
    cors: {
      origin: [process.env.UNIFIED_CLIENT_URL || process.env.CLIENT_URL],
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      credentials: true,
    },
  });
  if (app && typeof app.set === "function") {
    app.set("io", io);
  }
  io.on("connection", (socket) => {
    logger.info("Client connected", { socketId: socket.id });
    // Explicit, scoped room joins
    socket.on("join", async (data) => {
      try {
        const userId = data?.userId;
        const role = data?.role;
        if (userId) {
          socket.join(`user:${userId}`);

          try {
            const dbUser = await User.findById(userId).select(
              "assignedToLeader role",
            );
            if (dbUser?.assignedToLeader) {
              socket.join(`leader:${dbUser.assignedToLeader}`);
            }
          } catch (lookupErr) {
            logger.warn("Failed to look up user for leader room join", {
              error: lookupErr?.message,
            });
          }
        }
        if (role === "admin") {
          socket.join("admins");
        }
        logger.info("Socket joined scoped rooms", {
          socketId: socket.id,
          userId: userId || "unknown",
        });
      } catch (err) {
        logger.warn("Join handler error", {
          socketId: socket.id,
          error: err?.message,
        });
      }
    });
    socket.on("disconnect", () => {
      logger.info("Client disconnected", { socketId: socket.id });
    });
  });
  // Set up MongoDB change stream to watch for Order collection changes
  try {
    const changeStream = Order.watch([], { fullDocument: "updateLookup" });
    changeStream.on("change", (change) => {
      logger.info("Order collection change detected", {
        operationType: change.operationType,
      });
      const fullDoc = change.fullDocument;
      const documentId = change.documentKey?._id;

      // Always notify admins for any change
      io.to("admins").emit("orderUpdate", {
        operationType: change.operationType,
        documentId,
        fullDocument: fullDoc,
      });

      if (change.operationType === "delete") {
        io.to("admins").emit("deleteOrder", { _id: documentId });
      }

      // Scoped notifications for users and leaders
      if (fullDoc?.createdBy) {
        const targetRooms = new Set();
        const createdBy = String(fullDoc.createdBy);
        targetRooms.add(`user:${createdBy}`);

        if (fullDoc.assignedTo) {
          targetRooms.add(`user:${String(fullDoc.assignedTo)}`);
        }

        // Notify specific users
        const payload = {
          operationType: change.operationType,
          documentId,
          createdBy,
          assignedTo: fullDoc.assignedTo ? String(fullDoc.assignedTo) : null,
          fullDocument: fullDoc,
        };

        for (const room of targetRooms) {
          io.to(room).emit("orderUpdate", payload);
          if (change.operationType === "delete") {
            io.to(room).emit("deleteOrder", { _id: documentId });
          }
        }

        // Notify leaders of creator and assignee
        (async () => {
          try {
            const userIds = [fullDoc.createdBy];
            if (fullDoc.assignedTo) userIds.push(fullDoc.assignedTo);

            const users = await User.find({ _id: { $in: userIds } }).select("assignedToLeader");
            users.forEach(u => {
              if (u.assignedToLeader) {
                io.to(`leader:${String(u.assignedToLeader)}`).emit("orderUpdate", payload);
                if (change.operationType === "delete") {
                  io.to(`leader:${String(u.assignedToLeader)}`).emit("deleteOrder", { _id: documentId });
                }
              }
            });
          } catch (err) {
            logger.warn("Failed to notify leaders in change stream", { error: err.message });
          }
        })();
      }
    });

    // Handle change stream errors
    changeStream.on("error", (error) => {
      logger.error("Change stream error", { error });
    });

    // Handle change stream close
    changeStream.on("close", () => {
      logger.info("Change stream closed");
    });
  } catch (error) {
    logger.error("Error setting up change stream", { error });
  }
};
// Shared function to create notifications
function createNotification(req, order, action) {
  const username = req.user?.username || "User";
  const customerName = order.customername || "Unknown";
  const orderId = order.orderId || "N/A";

  return new Notification({
    message: `${action} by ${username} for ${customerName} (Order ID: ${orderId})`,
    timestamp: new Date(),
    isRead: false,
    role: "All",
    userId: req.user?.id || null,
    orderCreatedBy: order.createdBy || null,
  });
}
// Get Dashbord Count
const getDashboardCounts = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Base visibility query (removed default exclusion of cancelled orders)
    let baseQuery = {};
    if (userRole === "GlobalAdmin" || userRole === "SuperAdmin" || userRole === "Watch") {
      baseQuery = { ...baseQuery };
    } else {
      const teamMembers = await User.find({ assignedToLeader: userId }).select(
        "_id",
      );
      const teamMemberIds = teamMembers.map((m) => m._id);
      const allUserIds = [userId, ...teamMemberIds];
      baseQuery = {
        $or: [
          { createdBy: { $in: allUserIds } },
          { assignedTo: { $in: allUserIds } },
        ],
      };
    }

    // Counts
    const all = await Order.countDocuments(baseQuery);

    const installation = await Order.countDocuments({
      ...baseQuery,
      dispatchStatus: "Delivered",
      installationStatus: {
        $in: ["Pending", "In Progress", "Site Not Ready", "Hold"],
      },
    });

    const dispatch = await Order.countDocuments({
      ...baseQuery,
      fulfillingStatus: "Fulfilled",
      dispatchStatus: { $ne: "Delivered" },
    });

    const dispatchFromOptions = [
      "Patna",
      "Bareilly",
      "Ranchi",
      "Lucknow",
      "Delhi",
      "Jaipur",
      "Rajasthan",
    ];
    const production = await Order.countDocuments({
      ...baseQuery,
      sostatus: "Approved",
      dispatchFrom: { $nin: dispatchFromOptions },
      fulfillingStatus: { $ne: "Fulfilled" },
    });

    return res.status(200).json({ totalOrders: all, installation, production, dispatch });
  } catch (error) {
    logger.error("Error in getDashboardCounts", { error });
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch dashboard counts" });
  }
};

// Get all orders
const getAllOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let query = {};

    if (userRole === "GlobalAdmin" || userRole === "SuperAdmin" || userRole === "Watch") {
      // GlobalAdmin/SuperAdmin can see all orders
      query = {};
    } else {
      // For Sales users, get their own orders plus their team members' orders
      const teamMembers = await User.find({ assignedToLeader: userId }).select(
        "_id",
      );
      const teamMemberIds = teamMembers.map((member) => member._id);

      // Include the leader's own ID in the list
      const allUserIds = [userId, ...teamMemberIds];

      query = {
        $or: [
          { createdBy: { $in: allUserIds } },
          { assignedTo: { $in: allUserIds } },
        ],
      };
    }

    const orders = await Order.find(query)
      .populate({
        path: "createdBy",
        select: "username email assignedToLeader",
        populate: { path: "assignedToLeader", select: "username" },
      })
      .populate({ path: "assignedTo", select: "username email" });
    res.json(orders);
  } catch (error) {
    logger.error("Error in getAllOrders", { error: error.message });
    res.status(500).json({ error: "Server error" });
  }
};

// Optimized Sales Analytics API
const getSalesAnalytics = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { startDate, endDate, salesPerson } = req.query;

    let matchQuery = {
      dispatchStatus: { $ne: "Order Cancelled" },
    };

    // Role-based visibility logic
    if (userRole !== "GlobalAdmin" && userRole !== "SuperAdmin") {
      const teamMembers = await User.find({ assignedToLeader: userId }).select("_id");
      const allUserIds = [new mongoose.Types.ObjectId(userId), ...teamMembers.map((m) => m._id)];
      matchQuery.$or = [{ createdBy: { $in: allUserIds } }, { assignedTo: { $in: allUserIds } }];
    }

    // Date filtering
    if (startDate || endDate) {
      matchQuery.soDate = {};
      if (startDate) matchQuery.soDate.$gte = new Date(new Date(startDate).setHours(0, 0, 0, 0));
      if (endDate) matchQuery.soDate.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    // Salesperson filtering
    if (salesPerson && salesPerson !== "All") {
      // We'll filter by username later after $lookup or handle it here if we have search capability
      // For now, we'll keep it simple and filter after grouping if name is provided
    }

    const aggregationPipeline = [
      { $match: matchQuery },
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "creator",
        },
      },
      { $unwind: { path: "$creator", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          localField: "creator.assignedToLeader",
          foreignField: "_id",
          as: "leader",
        },
      },
      { $unwind: { path: "$leader", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: "$createdBy",
          personName: { $first: "$creator.username" },
          leaderName: { $first: "$leader.username" },
          leaderId: { $first: "$creator.assignedToLeader" },
          totalOrders: { $sum: 1 },
          totalAmount: { $sum: "$total" },
          totalPaymentCollected: {
            $sum: {
              $convert: {
                input: "$paymentCollected",
                to: "double",
                onError: 0,
                onNull: 0
              }
            }
          },
          totalPaymentDue: {
            $sum: {
              $convert: {
                input: "$paymentDue",
                to: "double",
                onError: 0,
                onNull: 0
              }
            }
          },
          totalUnitPrice: {
            $sum: {
              $reduce: {
                input: "$products",
                initialValue: 0,
                in: { $add: ["$$value", { $multiply: ["$$this.unitPrice", "$$this.qty"] }] },
              },
            },
          },
          dueOver30Days: {
            $sum: {
              $cond: [
                {
                  $and: [
                    {
                      $gt: [
                        {
                          $convert: {
                            input: "$paymentDue",
                            to: "double",
                            onError: 0,
                            onNull: 0
                          }
                        },
                        0
                      ]
                    },
                    {
                      $gt: [
                        { $divide: [{ $subtract: [new Date(), "$soDate"] }, 1000 * 60 * 60 * 24] },
                        30,
                      ],
                    },
                  ],
                },
                {
                  $convert: {
                    input: "$paymentDue",
                    to: "double",
                    onError: 0,
                    onNull: 0
                  }
                },
                0,
              ],
            },
          },
        },
      },
      { $sort: { totalAmount: -1 } },
    ];

    const results = await Order.aggregate(aggregationPipeline);

    // Final filtering by salesPerson if requested
    let finalData = results;
    if (salesPerson && salesPerson !== "All") {
      finalData = results.filter(r => r.personName?.trim() === salesPerson.trim());
    }

    res.json(finalData);
  } catch (error) {
    logger.error("Error in getSalesAnalytics", { error: error.message });
    res.status(500).json({ error: "Server error" });
  }
};

const createOrder = async (req, res) => {
  try {
    const {
      name,
      city,
      state,
      pinCode,
      contactNo,
      alterno,
      customerEmail,
      customername,
      products,
      orderType,
      report,
      freightcs,
      installation,
      salesPerson,
      company,
      shippingAddress,
      billingAddress,
      sameAddress,
      total,
      gstno,
      freightstatus,
      installchargesstatus,
      paymentCollected,
      paymentMethod,
      paymentDue,
      neftTransactionId,
      chequeId,
      remarks,
      gemOrderNumber,
      deliveryDate,
      demoDate,
      paymentTerms,
      creditDays,
      dispatchFrom,
      fulfillingStatus,
    } = req.body;

    // Parse products if sent as JSON string (from FormData)
    let parsedProducts = products;
    if (typeof products === "string") {
      try {
        parsedProducts = JSON.parse(products);
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: "Invalid products format",
        });
      }
    }

    // Handle file upload
    let poFilePath = null;
    if (req.file) {
      poFilePath = `/Uploads/${req.file.filename}`;
    }

    // Validate orderType-specific fields
    if (orderType === "B2G" && !gemOrderNumber) {
      return res.status(400).json({
        success: false,
        error: "Missing GEM Order Number",
      });
    }
    if (orderType === "Demo" && !demoDate) {
      return res.status(400).json({
        success: false,
        error: "Missing Demo Date",
      });
    }
    if (!paymentTerms && orderType !== "Demo") {
      return res.status(400).json({
        success: false,
        error: "Payment Terms is required for non-Demo orders",
      });
    }
    // Validate dispatchFrom
    const validDispatchLocations = [
      "Patna",
      "Bareilly",
      "Ranchi",
      "Morinda",
      "Lucknow",
      "Delhi",
      "Jaipur",
      "Rajasthan",
    ];
    if (dispatchFrom && !validDispatchLocations.includes(dispatchFrom)) {
      return res.status(400).json({
        success: false,
        error: "Invalid dispatchFrom value",
      });
    }

    // Validate products
    for (const product of parsedProducts) {
      if (
        !product.productType ||
        !product.qty ||
        !product.gst ||
        !product.warranty
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid product data",
          details: "Each product must have productType, qty, gst, and warranty",
        });
      }
      if (
        isNaN(Number(product.qty)) ||
        Number(product.qty) <= 0 ||
        isNaN(Number(product.unitPrice)) ||
        Number(product.unitPrice) < 0 ||
        (product.gst !== "including" && isNaN(Number(product.gst)))
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid product data",
          details:
            "qty must be positive, unitPrice must be non-negative, and gst must be valid",
        });
      }
      if (
        product.productType === "IFPD" &&
        (!product.modelNos || !product.brand)
      ) {
        return res.status(400).json({
          success: false,
          error: "Model Numbers and Brand are required for IFPD products",
        });
      }
      product.warranty =
        product.warranty ||
        (orderType === "B2G"
          ? "As Per Tender"
          : product.productType === "IFPD" && product.brand === "Promark"
            ? "3 Years"
            : "1 Year");
      product.serialNos = Array.isArray(product.serialNos)
        ? product.serialNos
        : [];
      product.modelNos = Array.isArray(product.modelNos)
        ? product.modelNos
        : product.modelNos
          ? product.modelNos.split(",").map((m) => m.trim())
          : [];
      product.brand = product.brand || "";
    }

    // Calculate total
    const calculatedTotal =
      parsedProducts.reduce((sum, product) => {
        const qty = Number(product.qty) || 0;
        const unitPrice = Number(product.unitPrice) || 0;
        const gstRate =
          product.gst === "including" ? 0 : Number(product.gst) || 0;
        return sum + qty * unitPrice * (1 + gstRate / 100);
      }, 0) +
      Number(freightcs || 0) +
      Number(installation || 0);

    const calculatedPaymentDue =
      calculatedTotal - Number(paymentCollected || 0);

    // Get submission timestamp
    const submissionTime = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "full",
      timeStyle: "medium",
    });

    // Create order
    const order = new Order({
      soDate: new Date(),
      name,
      city,
      state,
      pinCode,
      contactNo,
      alterno,
      customerEmail,
      customername,
      products: parsedProducts,
      gstno,
      freightcs,
      freightstatus: freightstatus || "Extra",
      installchargesstatus: installchargesstatus || "Extra",
      installation,
      report,
      salesPerson,
      company,
      orderType: orderType || "B2C",
      shippingAddress,
      billingAddress,
      sameAddress,
      total:
        total !== undefined && !isNaN(total) ? Number(total) : calculatedTotal,
      paymentCollected: String(paymentCollected || ""),
      paymentMethod: paymentMethod || "",
      paymentDue:
        paymentDue !== undefined && !isNaN(paymentDue)
          ? String(paymentDue)
          : String(calculatedPaymentDue),
      neftTransactionId: neftTransactionId || "",
      chequeId: chequeId || "",
      remarks,
      gemOrderNumber: gemOrderNumber || "",
      deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
      paymentTerms: paymentTerms || "",
      demoDate: demoDate ? new Date(demoDate) : null,
      creditDays: creditDays || "",
      createdBy: req.user.id,
      dispatchFrom,
      fulfillingStatus: fulfillingStatus || calculatedFulfillingStatus,
      poFilePath,
      submissionTime,
    });

    // Save order
    const savedOrder = await order.save();

    const notification = new Notification({
      message: `New sales order created by ${req.user.username || "User"} for ${savedOrder.customername || "Unknown"
        } (Order ID: ${savedOrder.orderId || "N/A"})`,
      timestamp: new Date(),
      isRead: false,
      role: "All",
      userId: req.user.id,
      orderCreatedBy: savedOrder.createdBy || null,
    });
    await notification.save();

    try {
      const notifRooms = new Set();

      if (savedOrder?.createdBy)
        notifRooms.add(`user:${String(savedOrder.createdBy)}`);

      if (savedOrder?.assignedTo)
        notifRooms.add(`user:${String(savedOrder.assignedTo)}`);

      notifRooms.add("admins");

      const notifPayload = {
        _id: String(notification._id),
        message: notification.message,
        timestamp: notification.timestamp,
        isRead: notification.isRead,
        userId: notification.userId ? String(notification.userId) : null,
        orderId: savedOrder.orderId || String(savedOrder._id),
      };

      io.to([...notifRooms]).emit("notification", notifPayload); // FIX: single, instant notification
    } catch (emitErr) {
      logger.warn("Failed to emit scoped notification", {
        error: emitErr?.message,
      });
    }

    res.status(201).json({ success: true, data: savedOrder });
  } catch (error) {
    logger.error("Error in createOrder", { error });
    if (error.name === "ValidationError") {
      // Create user-friendly error messages
      const fieldErrors = Object.entries(error.errors).map(([field, err]) => {
        // Convert field names to readable format
        const fieldName = field
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, str => str.toUpperCase())
          .trim();
        return `${fieldName} is required`;
      });

      const errorMessage = fieldErrors.length === 1
        ? fieldErrors[0]
        : `Please fill in the following required fields: ${fieldErrors.join(', ')}`;

      return res.status(400).json({
        success: false,
        error: errorMessage,
        details: fieldErrors,
      });
    }
    res
      .status(500)
      .json({ success: false, error: "Server error", details: error.message });
  }
};

// Edit an existing order
const editEntry = async (req, res) => {
  // Helper function to compare arrays for equality (deep comparison for products)
  function arraysEqual(arr1, arr2) {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i++) {
      if (
        arr1[i].productType !== arr2[i]?.productType ||
        arr1[i].qty !== arr2[i]?.qty ||
        arr1[i].unitPrice !== arr2[i]?.unitPrice ||
        arr1[i].gst !== arr2[i]?.gst ||
        arr1[i].brand !== arr2[i]?.brand ||
        arr1[i].warranty !== arr2[i]?.warranty ||
        !deepEqual(arr1[i].serialNos, arr2[i]?.serialNos) ||
        !deepEqual(arr1[i].modelNos, arr2[i]?.modelNos) ||
        !deepEqual(arr1[i].productCode, arr2[i]?.productCode)
      ) {
        return false;
      }
    }
    return true;
  }

  function deepEqual(arr1, arr2) {
    if (!arr1 || !arr2) return arr1 === arr2;
    if (arr1.length !== arr2.length) return false;
    return arr1.every((val, index) => val === arr2[index]);
  }

  try {
    const orderId = req.params.id;
    const updateData = req.body;

    // Log request body for debugging
    logger.debug("Edit request body (Full)", { updateData });

    // FILTERED LOGGING FOR VERIFICATION
    // We want to see if we are receiving a huge object or just the changes.
    const keysReceived = Object.keys(updateData);
    logger.info(
      `[PATCH AUDIT] EditEntry called for ${orderId}. Received ${keysReceived.length} fields.`,
      {
        keys: keysReceived,
        productsIncluded: keysReceived.includes("products"),
      },
    );

    // Fetch existing order
    const existingOrder = await Order.findById(orderId);
    if (!existingOrder) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }

    // Define allowed fields for update
    const allowedFields = [
      "soDate",
      "dispatchFrom",
      "dispatchDate",
      "name",
      "city",
      "state",
      "pinCode",
      "contactNo",
      "alterno",
      "customerEmail",
      "customername",
      "products",
      "productno",
      "total",
      "gstno",
      "freightstatus",
      "installchargesstatus",
      "paymentCollected",
      "paymentMethod",
      "paymentDue",
      "neftTransactionId",
      "chequeId",
      "freightcs",
      "orderType",
      "installation",
      "installationeng",
      "installationStatus",
      "remarksByInstallation",
      "dispatchStatus",
      "salesPerson",
      "report",
      "company",
      "transporter",
      "transporterDetails",
      "docketNo",
      "receiptDate",
      "shippingAddress",
      "billingAddress",
      "sameAddress",
      "invoiceNo",
      "invoiceDate",
      "fulfillingStatus",
      "remarksByProduction",
      "remarksByAccounts",
      "paymentReceived",
      "billNumber",
      "piNumber",
      "remarksByBilling",
      "verificationRemarks",
      "billStatus",
      "completionStatus",
      "fulfillmentDate",
      "remarks",
      "sostatus",
      "gemOrderNumber",
      "deliveryDate",
      "deliveredDate",
      "stamp",
      "installationReport",
      "installationStatusDate",
      "demoDate",
      "paymentTerms",
      "creditDays",
      "actualFreight",
      "installationFile",
      "actualFreight",
      "installationFile",
      "stockStatus",
      "poFilePath",
    ];

    // Create update object with only provided fields
    const updateFields = {};
    let productsWereEdited = false;

    // Helper: Check if field is present in payload (prevents missing keys from overwriting)
    const has = (field) =>
      Object.prototype.hasOwnProperty.call(updateData, field);

    for (const field of allowedFields) {
      // Handle file upload from req.files explicitly
      if (field === "installationFile" && req.files && req.files.installationFile) {
        updateFields[field] = `/Uploads/${req.files.installationFile[0].filename}`;
        continue;
      }
      if (field === "poFilePath" && req.files && req.files.poFile) {
        updateFields[field] = `/Uploads/${req.files.poFile[0].filename}`;
        continue;
      }

      if (has(field)) {
        const val = updateData[field];
        // Skip undefined, BUT allow null (to clear fields)
        if (val === undefined) continue;

        if (field === "products") {
          if (!Array.isArray(val)) {
            return res
              .status(400)
              .json({ success: false, error: "Products must be an array" });
          }
          // Normalize and Validate products
          const normalizedProducts = val.map((p) => ({
            ...p,
            qty: Number(p.qty),
            unitPrice: Number(p.unitPrice),
            gst: p.gst || "18",
            warranty: p.warranty || "1 Year",
          }));

          for (const p of normalizedProducts) {
            if (
              !p.productType ||
              !p.qty ||
              p.unitPrice < 0 ||
              !p.gst ||
              !p.warranty
            ) {
              return res
                .status(400)
                .json({ success: false, error: "Invalid product data" });
            }
          }

          // Check for edits
          const existingProducts = existingOrder.products || [];
          if (!arraysEqual(normalizedProducts, existingProducts)) {
            productsWereEdited = true;
            updateFields.products = normalizedProducts;
          }
        } else if (
          field.endsWith("Date") ||
          field === "receiptDate" ||
          field === "soDate"
        ) {
          // For dates: Only update if it's a valid date string OR explicitly null.
          if (val === null) {
            updateFields[field] = null;
          } else if (val && !isNaN(new Date(val))) {
            updateFields[field] = new Date(val);
          }
        } else {
          updateFields[field] = val;
        }
      }
    }

    // Handle approval timestamp
    if (
      updateFields.sostatus === "Approved" &&
      existingOrder.sostatus !== "Approved"
    ) {
      updateFields.approvalTimestamp = new Date();

      // -------------------------------------------------------------------------
      // ✅ APPROVAL-BASED FULFILLMENT RULE
      // -------------------------------------------------------------------------
      // Business Rule: When order is approved, auto-fulfill if:
      // - orderType === "Demo" OR
      // - dispatchFrom !== "Morinda"

      const finalOrderType = updateFields.orderType || existingOrder.orderType;
      const finalDispatchFrom = updateFields.dispatchFrom || existingOrder.dispatchFrom;

      if (
        finalOrderType === "Demo" ||
        (finalDispatchFrom && finalDispatchFrom !== "Morinda")
      ) {
        updateFields.fulfillingStatus = "Fulfilled";
        updateFields.fulfillmentDate = new Date();
        updateFields.completionStatus = "Complete";
      }
    }

    // =========================================================================
    // ✅ BIDIRECTIONAL SYNCHRONIZATION: sostatus ↔ dispatchStatus
    // =========================================================================

    // RULE 1: When sostatus → "Order Cancelled", auto-set dispatchStatus → "Order Cancelled"
    // (only if user didn't explicitly set dispatchStatus)
    if (
      updateFields.sostatus === "Order Cancelled" &&
      existingOrder.sostatus !== "Order Cancelled" &&
      !has("dispatchStatus") // User didn't explicitly set dispatchStatus
    ) {
      updateFields.dispatchStatus = "Order Cancelled";
    }

    // RULE 2: When dispatchStatus → "Order Cancelled", auto-set sostatus → "Order Cancelled"
    // (only if user didn't explicitly set sostatus)
    if (
      updateFields.dispatchStatus === "Order Cancelled" &&
      existingOrder.dispatchStatus !== "Order Cancelled" &&
      !has("sostatus") // User didn't explicitly set sostatus
    ) {
      updateFields.sostatus = "Order Cancelled";
    }

    // RULE 3: When sostatus changes FROM "Order Cancelled" to something else,
    // reset dispatchStatus → "Not Dispatched" (only if user didn't explicitly set it)
    if (
      existingOrder.sostatus === "Order Cancelled" &&
      updateFields.sostatus &&
      updateFields.sostatus !== "Order Cancelled" &&
      !has("dispatchStatus") // User didn't explicitly set dispatchStatus
    ) {
      updateFields.dispatchStatus = "Not Dispatched";
    }

    // RULE 4: When dispatchStatus changes FROM "Order Cancelled" to something else,
    // reset sostatus → "Pending for Approval" (only if user didn't explicitly set it)
    if (
      existingOrder.dispatchStatus === "Order Cancelled" &&
      updateFields.dispatchStatus &&
      updateFields.dispatchStatus !== "Order Cancelled" &&
      !has("sostatus") // User didn't explicitly set sostatus
    ) {
      updateFields.sostatus = "Pending for Approval";
    }

    // Handle products edit timestamp if products were edited
    if (productsWereEdited) {
      updateFields.productsEditTimestamp = new Date();
    }

    // -------------------------------------------------------------------------
    // ✅ FULFILLMENT & MORINDA RULE
    // -------------------------------------------------------------------------

    // Check if dispatchFrom is being changed
    if (
      updateFields.dispatchFrom &&
      updateFields.dispatchFrom !== existingOrder.dispatchFrom
    ) {
      // RULE: If "Morinda" is selected, Production Status MUST be "Pending"
      if (updateFields.dispatchFrom === "Morinda") {
        updateFields.fulfillingStatus = "Pending";
        updateFields.completionStatus = "In Progress";
        updateFields.fulfillmentDate = null; // Reset if switching to Morinda
      } else {
        // RULE: Any other location implies "Fulfilled" (as per user request)
        updateFields.fulfillingStatus = "Fulfilled";
        updateFields.completionStatus = "Complete";
        updateFields.fulfillmentDate = new Date();
      }
    }
    // If dispatchFrom is NOT changing, handle manual status updates
    else if (has("fulfillingStatus")) {
      if (updateFields.fulfillingStatus === "Fulfilled") {
        updateFields.completionStatus = "Complete";
        if (!existingOrder.fulfillmentDate) {
          updateFields.fulfillmentDate = new Date();
        }
      } else {
        // Handle downgrade
        updateFields.completionStatus = "In Progress";
        updateFields.fulfillmentDate = null;
      }
    }

    // Auto-set Dispatch Date if status changes to Dispatched or Delivered
    if (
      has("dispatchStatus") &&
      (updateFields.dispatchStatus === "Dispatched" ||
        updateFields.dispatchStatus === "Delivered") &&
      !has("dispatchDate") &&
      !existingOrder.dispatchDate
    ) {
      updateFields.dispatchDate = new Date();
    }

    // Set receiptDate if dispatchStatus is "Delivered"
    if (
      updateFields.dispatchStatus === "Delivered" &&
      !existingOrder.receiptDate
    ) {
      updateFields.receiptDate = new Date();
    }

    // Update the order
    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      { $set: updateFields },
      { new: true, runValidators: true },
    ).populate("createdBy", "username email");

    if (!updatedOrder) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }
    // Send confirmation email if sostatus is updated to "Approved"
    if (
      updateFields.sostatus === "Approved" &&
      updatedOrder.customerEmail &&
      existingOrder.sostatus !== "Approved"
    ) {
      try {
        const subject = `Your Order #${updatedOrder.orderId || updatedOrder._id
          } is Approved!`;
        const text = `
Dear ${updatedOrder.customername || "Customer"},

We're thrilled to confirm that your order for the following products has been approved! Get ready for an amazing experience with Promark Tech Solutions:

${updatedOrder.products
            .map(
              (p, i) =>
                `${i + 1}. ${p.productType} - Qty: ${p.qty}, Unit Price: ₹${p.unitPrice
                }, Brand: ${p.brand}`,
            )
            .join("\n")}

Total: ₹${updatedOrder.total || 0}

Let's make it happen! Reach out to us to explore the next steps.

Cheers,
The Promark Tech Solutions Crew
        `;
        const html = `
           <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap');
              body { font-family: 'Poppins', Arial, sans-serif; background-color: #f0f2f5; margin: 0; padding: 0; line-height: 1.6; }
              .container { max-width: 720px; margin: 40px auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 20px rgba(0,0,0,0.15); }
              .hero { background: linear-gradient(135deg, #1e3a8a, #3b82f6); padding: 60px 20px; text-align: center; position: relative; }
              .hero::before { content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: url('https://www.transparenttextures.com/patterns/subtle-white-feathers.png'); opacity: 0.1; }
              .hero h1 { color: #ffffff; font-size: 38px; font-weight: 700; margin: 0; text-shadow: 0 3px 6px rgba(0,0,0,0.3); letter-spacing: 1.2px; }
              .hero p { color: #ffffff; font-size: 20px; opacity: 0.95; margin: 15px 0; font-weight: 400; }
              .content { padding: 50px 30px; background-color: #ffffff; }
              .content h2 { color: #1f2937; font-size: 28px; font-weight: 600; margin-bottom: 20px; }
              .content p { color: #4b5563; font-size: 16px; line-height: 1.9; margin: 0 0 25px; }
              .highlight { background: linear-gradient(135deg, #e0f2fe, #bfdbfe); padding: 25px; border-radius: 16px; text-align: center; font-size: 18px; font-weight: 500; color: #1f2937; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
              .products {  padding: 30px;}
              .products ul { list-style: none; padding: 0; margin: 0; }
              .products li { font-size: 16px; color: #1f2937; margin-bottom: 16px; display: flex; align-items: center; transition: transform 0.3s ease; }
              .products li:hover { transform: translateX(12px); }
              .products li::before { content: '✨'; color: #f59e0b; margin-right: 12px; font-size: 20px; }
              .cta-button { 
                display: inline-block; 
                padding: 20px 40px; 
                background: linear-gradient(135deg, #22c55e, #16a34a); 
                color: #000000; /* Changed text color to black for Contact Us Now button */
                text-decoration: none; 
                border-radius: 50px; 
                font-size: 18px; 
                font-weight: 600; 
                margin: 30px 0; 
                box-shadow: 0 6px 12px rgba(0,0,0,0.2); 
                transition: all 0.3s ease; 
                position: relative; 
                overflow: hidden; 
              }
              .cta-button::after { 
                content: ''; 
                position: absolute; 
                top: 0; 
                left: -100%; 
                width: 100%; 
                height: 100%; 
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent); 
                transition: 0.5s; 
              }
              .cta-button:hover::after { left: 100%; }
              .cta-button:hover { 
                transform: translateY(-4px); 
                box-shadow: 0 8px 16px rgba(0,0,0,0.3); 
                background: linear-gradient(135deg, #16a34a, #22c55e); 
              }
              .footer { text-align: center; padding: 40px; background:linear-gradient(135deg, #1e3a8a, #3b82f6); color: #6b7280; font-size: 14px; }
              .footer a { color: #1e3a8a; text-decoration: none; font-weight: 600; }
              .footer a:hover { text-decoration: underline; }
              .social-icons { margin-top: 20px; }
              .social-icons a { margin: 0 15px; display: inline-block; transition: transform 0.3s ease; }
              .social-icons a:hover { transform: scale(1.3); }
              .social-icons img { width: 30px; height: 30px; }
              @media (max-width: 600px) {
                .container { margin: 20px; }
                .hero h1 { font-size: 30px; }
                .hero p { font-size: 16px; }
                .content { padding: 30px; }
                .content h2 { font-size: 24px; }
                .cta-button { padding: 16px 32px; font-size: 16px; }
                .products { padding: 20px; }
                .highlight { padding: 20px; }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="hero">
                <h1>Order #${updatedOrder.orderId || updatedOrder._id
          } Approved!</h1>
                <p>Kickstarting Your Journey with Promark Tech Solutions!</p>
              </div>
              <div class="content">
                <h2>Dear ${updatedOrder.customername || "Customer"},</h2>
                <p>We're over the moon to announce that your order has been officially approved! You're about to experience the magic of your selected products with Promark Tech Solutions.</p>
               <div class="products" style="margin-top:10px;">
  <ul style="list-style-type:none; padding:0; margin:0;">
    ${updatedOrder.products
            .map(
              (p, i) =>
                `<li style="margin-bottom:8px; padding:6px 10px;">
            <strong style="color:#333;">${p.productType}</strong> 
            <span style="margin-left:10px; color:#555;">Qty: ${p.qty}</span>, 
           
          </li>`,
            )
            .join("")}
  </ul>
</div>

                
                <p>Ready to dive into the next steps? Our team is here to make your experience seamless and extraordinary. Let's make it happen!</p>
                <a href="mailto:support@promarktechsolutions.com" class="cta-button">Contact Us Now</a>
              </div>
              <div class="footer" style="color: #e0f2fe;">
                <p>With enthusiasm,<br/>The Promark Tech Solutions Crew</p>
                <p>&copy; 2025 <a href="https://promarktechsolutions.com">Promark Tech Solutions</a>. All rights reserved.</p>
                <div class="social-icons">
                  <a href="https://twitter.com/promarktech"><img src="https://img.icons8.com/color/30/000000/twitter.png" alt="Twitter"></a>
                  <a href="https://linkedin.com/company/promarktechsolutions"><img src="https://img.icons8.com/color/30/000000/linkedin.png" alt="LinkedIn"></a>
                  <a href="https://instagram.com/promarktechsolutions"><img src="https://img.icons8.com/color/30/000000/instagram.png" alt="Instagram"></a>
                </div>
              </div>
            </div>
          </body>
          </html>
        `;
        await sendMail(updatedOrder.customerEmail, subject, text, html);
      } catch (mailErr) {
        console.error(
          "Order confirmation email sending failed:",
          mailErr.message,
        );
      }
    }

    // Send email if dispatchStatus is updated to "Dispatched" or "Delivered"
    if (
      (updateFields.dispatchStatus === "Dispatched" ||
        updateFields.dispatchStatus === "Delivered") &&
      updatedOrder.customerEmail
    ) {
      try {
        const statusText =
          updateFields.dispatchStatus === "Dispatched"
            ? "dispatched"
            : "delivered";
        const subject = `Your Order #${updatedOrder.orderId || updatedOrder._id
          } Has Been ${statusText.charAt(0).toUpperCase() + statusText.slice(1)
          }!`;
        const text = `
Dear ${updatedOrder.customername || "Customer"},

Great news! Your order has been ${statusText}. Here are the details of your order:

${updatedOrder.products
            .map(
              (p, i) =>
                `${i + 1}. ${p.productType} - Qty: ${p.qty}, Brand: ${p.brand}, Size: ${p.size}, Spec: ${p.spec}`,
            )
            .join("\n")}


${updateFields.dispatchStatus === "Dispatched"
            ? `Dispatch Date: ${updatedOrder.dispatchDate
              ? new Date(updatedOrder.dispatchDate).toLocaleString("en-IN")
              : "N/A"
            }`
            : `Delivery Date: ${updatedOrder.receiptDate
              ? new Date(updatedOrder.receiptDate).toLocaleString("en-IN")
              : "N/A"
            }`
          }
Transporter: ${updatedOrder.transporter || "N/A"}
Docket No: ${updatedOrder.docketNo || "N/A"}

We're here to support you every step of the way!

Cheers,
The Promark Tech Solutions Crew
        `;
        const html = `
        <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap');
              body { font-family: 'Poppins', Arial, sans-serif; background-color: #f0f2f5; margin: 0; padding: 0; line-height: 1.6; }
              .container { max-width: 720px; margin: 40px auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 20px rgba(0,0,0,0.15); }
              .hero { background: linear-gradient(135deg, #16a34a, #4ade80, #22c55e);
; padding: 60px 20px; text-align: center; position: relative; }
              .hero::before { content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: url('https://www.transparenttextures.com/patterns/subtle-white-feathers.png'); opacity: 0.1; }
              .hero h1 { color: #ffffff; font-size: 38px; font-weight: 700; margin: 0; text-shadow: 0 3px 6px rgba(0,0,0,0.3); letter-spacing: 1.2px; }
              .hero p { color: #ffffff; font-size: 20px; opacity: 0.95; margin: 15px 0; font-weight: 400; }
              .content { padding: 50px 30px; background-color: #ffffff; }
              .content h2 { color: #1f2937; font-size: 28px; font-weight: 600; margin-bottom: 20px; }
              .content p { color: #4b5563; font-size: 16px; line-height: 1.9; margin: 0 0 25px; }
              .highlight {  padding: 25px;  text-align: center; font-size: 18px; font-weight: 500; color: #1f2937;  }
              .products {  padding: 30px;  }
              .products ul { list-style: none; padding: 0; margin: 0; }
              .products li { font-size: 16px; color: #1f2937; margin-bottom: 16px; display: flex; align-items: center; transition: transform 0.3s ease; }
              .products li:hover { transform: translateX(12px); }
              .products li::before { content: '✨'; color: #f59e0b; margin-right: 12px; font-size: 20px; }
              .cta-button { 
                display: inline-block; 
                padding: 20px 40px; 
                background: linear-gradient(135deg, #22c55e, #16a34a); 
                color: #000000; /* Changed text color to black for Get in Touch button */
                text-decoration: none; 
                border-radius: 50px; 
                font-size: 18px; 
                font-weight: 600; 
                margin: 30px 0; 
                box-shadow: 0 6px 12px rgba(0,0,0,0.2); 
                transition: all 0.3s ease; 
                position: relative; 
                overflow: hidden; 
              }
              .cta-button::after { 
                content: ''; 
                position: absolute; 
                top: 0; 
                left: -100%; 
                width: 100%; 
                height: 100%; 
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent); 
                transition: 0.5s; 
              }
              .cta-button:hover::after { left: 100%; }
              .cta-button:hover { 
                transform: translateY(-4px); 
                box-shadow: 0 8px 16px rgba(0,0,0,0.3); 
                background: linear-gradient(135deg, #16a34a, #22c55e); 
              }
              .footer { text-align: center; padding: 40px; background: linear-gradient(135deg, #16a34a, #4ade80, #22c55e); color: #6b7280; font-size: 14px; }
              .footer a { color: #0858cf; text-decoration: none; font-weight: 600; }
              .footer a:hover { text-decoration: underline; }
              .social-icons { margin-top: 20px; }
              .social-icons a { margin: 0 15px; display: inline-block; transition: transform 0.3s ease; }
              .social-icons a:hover { transform: scale(1.3); }
              .social-icons img { width: 30px; height: 30px; }
              @media (max-width: 600px) {
                .container { margin: 20px; }
                .hero h1 { font-size: 30px; }
                .hero p { font-size: 16px; }
                .content { padding: 30px; }
                .content h2 { font-size: 24px; }
                .cta-button { padding: 16px 32px; font-size: 16px; }
                .products { padding: 20px; }
                .highlight { padding: 20px; }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="hero">
                <h1>Order #${updatedOrder.orderId || updatedOrder._id} ${statusText.charAt(0).toUpperCase() + statusText.slice(1)
          }!</h1>
                <p>Your Next Step with Promark Tech Solutions!</p>
              </div>
              <div class="content">
                <h2>Dear ${updatedOrder.customername || "Customer"},</h2>
                <p>Fantastic news! Your order has been ${statusText}, bringing you one step closer to enjoying the excellence of Promark Tech Solutions. Here's what's in your order:</p>
                <div class="products" style="margin-top:10px;">
  <ul style="list-style-type:none; padding:0; margin:0;">
    ${updatedOrder.products
            .map(
              (p, i) =>
                `<li style="margin-bottom:10px; padding:8px 12px;">
            <strong style="color:#333;">${p.productType}</strong> 
            <span style="margin-left:12px; color:#555;">Qty: ${p.qty}</span>, 
           
          </li>`,
            )
            .join("")}
  </ul>
</div>

                <div class="highlight">
                 
                  <p>${updateFields.dispatchStatus === "Dispatched"
            ? `Dispatch Date: ${updatedOrder.dispatchDate
              ? new Date(
                updatedOrder.dispatchDate,
              ).toLocaleString("en-IN")
              : "N/A"
            }`
            : `Delivery Date: ${updatedOrder.receiptDate
              ? new Date(updatedOrder.receiptDate).toLocaleString(
                "en-IN",
              )
              : "N/A"
            }`
          }</p>
                  <p>Transporter: ${updatedOrder.transporter || "N/A"}</p>
                  <p>Docket No: ${updatedOrder.docketNo || "N/A"}</p>
                </div>
                <p>We're here to ensure your experience is nothing short of spectacular! Reach out with any questions or to explore what's next.</p>
                <a href="mailto:support@promarktechsolutions.com" class="cta-button">Get in Touch</a>
              </div>
              <div class="footer" style="color: white;">
                <p>With enthusiasm,<br/>The Promark Tech Solutions Crew</p>
                <p>&copy; 2025 <a href="https://promarktechsolutions.com">Promark Tech Solutions</a>. All rights reserved.</p>
                <div class="social-icons">
                  <a href="https://twitter.com/promarktech"><img src="https://img.icons8.com/color/30/000000/twitter.png" alt="Twitter"></a>
                  <a href="https://linkedin.com/company/promarktechsolutions"><img src="https://img.icons8.com/color/30/000000/linkedin.png" alt="LinkedIn"></a>
                  <a href="https://instagram.com/promarktechsolutions"><img src="https://img.icons8.com/color/30/000000/instagram.png" alt="Instagram"></a>
                </div>
              </div>
            </div>
          </body>
          </html>
        `;
        await sendMail(updatedOrder.customerEmail, subject, text, html);
      } catch (mailErr) {
        console.error(
          `${updateFields.dispatchStatus} email sending failed:`,
          mailErr.message,
        );
      }
    }

    // Create and save notification
    console.log("req.user for notification:", req.user);
    const notification = new Notification({
      message: `Order updated by ${req.user?.username ||
        req.user?.name ||
        req.user?.email ||
        req.user?.id ||
        "Unknown User"
        } for ${updatedOrder.customername || "Unknown"} (Order ID: ${updatedOrder.orderId || "N/A"
        })`,
      timestamp: new Date(),
      isRead: false,
      role: "All",
      userId: req.user?.id || null,
      orderCreatedBy: updatedOrder.createdBy || null,
    });
    await notification.save();

    try {
      const notifRooms = new Set();
      if (updatedOrder?.createdBy)
        notifRooms.add(`user:${String(updatedOrder.createdBy)}`);
      if (updatedOrder?.assignedTo)
        notifRooms.add(`user:${String(updatedOrder.assignedTo)}`);
      notifRooms.add("admins");

      const notifPayload = {
        _id: String(notification._id),
        message: notification.message,
        timestamp: notification.timestamp,
        isRead: notification.isRead,
        userId: notification.userId ? String(notification.userId) : null,
        orderId: updatedOrder.orderId || String(updatedOrder._id),
      };
      // Hinglish: Ek hi emit me multiple rooms pass karo taaki same socket pe duplicate na aaye
      io.to([...notifRooms]).emit("notification", notifPayload);
    } catch (emitErr) {
      console.warn(
        "Failed to emit scoped notification (editEntry):",
        emitErr?.message,
      );
    }

    res.status(200).json({ success: true, data: updatedOrder });
  } catch (error) {
    console.error("Error in editEntry:", error);
    res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    });
  }
};
// Send installation completion email
const sendInstallationCompletionMail = async (req, res) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findById(orderId).populate(
      "createdBy",
      "username email",
    );

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    if (!order.customerEmail) {
      return res
        .status(400)
        .json({ success: false, message: "Customer email not available" });
    }

    const salespersonEmail = order.createdBy?.email;
    const customerEmail = order.customerEmail;
    const orderDisplayId = order.orderId || order._id;

    const installationEngineer = order.installationeng || "Assigned Engineer";

    const subject = `Installation Assignment: Order #${orderDisplayId}`;
    const text = `
Dear ${order.customername || "Customer"},

We are pleased to inform you that an installation engineer has been assigned for your order #${orderDisplayId}.

The installation is scheduled to be completed within the next 2 days.

Details:
Order ID: ${orderDisplayId}
Location: ${order.shippingAddress || (order.city ? `${order.city}, ${order.state}` : "N/A")}

Please ensure the site is ready. Our engineer will contact you shortly to coordinate the exact time.

Thank you for choosing Promark Tech Solutions.

Best regards,
The Promark Tech Solutions Crew
    `;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap');
          body { font-family: 'Poppins', Arial, sans-serif; background-color: #f0f2f5; margin: 0; padding: 0; line-height: 1.6; }
          .container { max-width: 720px; margin: 40px auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 20px rgba(0,0,0,0.15); }
          .hero { background: linear-gradient(135deg, #f59e0b, #d97706); padding: 60px 20px; text-align: center; color: white; }
          .hero h1 { font-size: 28px; font-weight: 700; margin: 0; text-shadow: 0 2px 4px rgba(0,0,0,0.2); }
          .hero p { font-size: 18px; opacity: 0.9; margin: 10px 0 0; }
          .content { padding: 40px 30px; }
          .content h2 { color: #1f2937; font-size: 24px; margin-bottom: 20px; }
          .content p { color: #4b5563; font-size: 16px; margin-bottom: 20px; }
          .details-box { background-color: #fffbeb; border-radius: 12px; padding: 25px; border: 1px solid #fcd34d; margin-bottom: 30px; }
          .details-table { width: 100%; border-collapse: collapse; }
          .details-table td { padding-bottom: 10px; font-size: 15px; vertical-align: top; }
          .detail-label { font-weight: 600; color: #92400e; width: 140px; }
          .detail-value { color: #1e293b; word-wrap: break-word; word-break: break-word; }
          .footer { text-align: center; padding: 30px; background-color: #f1f5f9; color: #64748b; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="hero">
            <h1>Installation Scheduled!</h1>
            <p>Order #${orderDisplayId}</p>
          </div>
          <div class="content">
            <h2>Dear ${order.customername || "Customer"},</h2>
            <p>We have successfully assigned an installation engineer for your order. We are committed to completing the installation <strong>within the next 2 days</strong>.</p>
            
            <div class="details-box">
              <table class="details-table" role="presentation">
                <tr>
                  <td class="detail-label">Order ID:</td>
                  <td class="detail-value">${orderDisplayId}</td>
                </tr>
                <tr>
                  <td class="detail-label">Location:</td>
                  <td class="detail-value">${order.shippingAddress || (order.city ? `${order.city}, ${order.state}` : "N/A")}</td>
                </tr>
                <tr>
                  <td class="detail-label">Timeline:</td>
                  <td class="detail-value">Within 48 Hours</td>
                </tr>
              </table>
            </div>

            <p>Please ensure the site is ready for installation. Our engineer will coordinate with you for site availability.</p>
          </div>
         <div class="footer" style="color: white; background: linear-gradient(135deg, #f59e0b, #d97706); padding:40px; text-align:center;">
  <p>With enthusiasm,<br/>The Promark Tech Solutions Crew</p>
  <p>&copy; 2025 <a href="https://promarktechsolutions.com" style="color:#0858cf; text-decoration:none;">Promark Tech Solutions</a>. All rights reserved.</p>
  <div class="social-icons" style="margin-top:20px;">
    <a href="https://twitter.com/promarktech"><img src="https://img.icons8.com/color/30/000000/twitter.png" /></a>
    <a href="https://linkedin.com/company/promarktechsolutions"><img src="https://img.icons8.com/color/30/000000/linkedin.png" /></a>
    <a href="https://instagram.com/promarktechsolutions"><img src="https://img.icons8.com/color/30/000000/instagram.png" /></a>
  </div>
</div>

        </div>
      </body>
      </html>
    `;

    console.log(
      `Attempting to send Installation Assignment Mail for Order #${orderDisplayId}`,
    );

    // Send to Customer
    try {
      await sendMail(customerEmail, subject, text, html);
      console.log(
        `Successfully sent customer email for Order #${orderDisplayId} to ${customerEmail}`,
      );
    } catch (msgErr) {
      console.error(
        `Failed to send customer email for Order #${orderDisplayId} to ${customerEmail}:`,
        msgErr,
      );
      throw msgErr;
    }

    // Send to Salesperson (Internal)
    if (salespersonEmail) {
      try {
        await sendMail(
          salespersonEmail,
          `[Internal] Installation Assigned - Order #${orderDisplayId}`,
          `Installation assigned to ${installationEngineer} for Order #${orderDisplayId}. Scheduled within 2 days.\nCustomer: ${order.customername}`,
          html,
        );
        console.log("Internal email sent successfully.");
      } catch (internalErr) {
        console.warn("Failed to send internal email copy:", internalErr);
      }
    }

    res.status(200).json({
      success: true,
      message: "Installation assignment email sent successfully!",
    });
  } catch (error) {
    console.error("Error in sendInstallationCompletionMail:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send installation completion email",
      error: error.message,
    });
  }
};

// Delete an order
const DeleteData = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid order ID" });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    if (
      req.user.role === "salesperson" &&
      order.createdBy.toString() !== req.user.id
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Unauthorized to delete this order" });
    }

    // Delete the order
    await Order.findByIdAndDelete(req.params.id);

    // Create and save notification
    const notification = new Notification({
      message: `Order deleted by ${req.user?.username || req.user?.name || req.user?.email || req.user?.id || "Unknown User"} for ${order.customername || "Unknown"} (Order ID: ${order.orderId || "N/A"})`,
      timestamp: new Date(),
      isRead: false,
      role: "All",
      userId: req.user?.id || null,
      orderCreatedBy: order.createdBy || null,
    });
    await notification.save();

    // Emit only to owner and assignee rooms
    const targetRooms = new Set();
    targetRooms.add(`user:${String(order.createdBy)}`);
    if (order.assignedTo) targetRooms.add(`user:${String(order.assignedTo)}`);
    const payload = {
      _id: order._id,
      customername: order.customername,
      orderId: order.orderId,
      createdBy: String(order.createdBy),
      assignedTo: order.assignedTo ? String(order.assignedTo) : null,
    };
    // Hinglish: Single emit to multiple rooms -> duplicate delivery avoid
    io.to([...targetRooms]).emit("deleteOrder", payload);

    // Hinglish: Consistent 'notification' event bhi emit karein, jisse UI toast aur list update ek jaise rahein
    try {
      const notifRooms = new Set(targetRooms);
      notifRooms.add("admins");
      const notifPayload = {
        _id: String(notification._id),
        message: notification.message,
        timestamp: notification.timestamp,
        isRead: notification.isRead,
        userId: notification.userId ? String(notification.userId) : null,
        orderId: order.orderId || String(order._id),
      };
      io.to([...notifRooms]).emit("notification", notifPayload);
    } catch (emitErr) {
      console.warn(
        "Failed to emit scoped notification (deleteOrder):",
        emitErr?.message,
      );
    }

    res
      .status(200)
      .json({ success: true, message: "Order deleted successfully" });
  } catch (error) {
    console.error("Error deleting order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete order",
      error: error.message,
    });
  }
};

// Parse date strings
const parseDate = (dateStr) => {
  if (!dateStr) return null;
  const date = new Date(String(dateStr).trim());
  return isNaN(date.getTime()) ? null : date;
};

// Bulk upload orders
const bulkUploadOrders = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded",
      });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet);

    const orders = [];
    const validDispatchLocations = [
      "Patna",
      "Bareilly",
      "Ranchi",
      "Morinda",
      "Lucknow",
      "Delhi",
      "Jaipur",
      "Rajasthan",
    ];

    for (const row of jsonData) {
      // ✅ Helper to get value checking both old and new header formats
      const getVal = (oldKey, newKey) => row[newKey] !== undefined ? row[newKey] : row[oldKey];

      const products = [
        {
          productType: getVal("Product Type", "Product Name") || row["Product Type"] || "",
          size: getVal("Size", "Size") || "N/A",
          spec: getVal("Specification", "Specification") || "N/A",
          qty: Number(getVal("Quantity", "Quantity")) || 0,
          unitPrice: Number(getVal("Unit Price", "Unit Price")) || 0,
          gst: getVal("GST", "GST") || "18",
          modelNos: (row["Model Nos"] || row["Model Number"])
            ? String(row["Model Nos"] || row["Model Number"])
              .split(",")
              .map((m) => m.trim())
            : [],
          brand: getVal("Brand", "Brand") || "",
          warranty:
            getVal("Warranty", "Warranty") ||
            (getVal("Order Type", "Order Type") === "B2G"
              ? "As Per Tender"
              : (getVal("Product Type", "Product Name") === "IFPD" && getVal("Brand", "Brand") === "Promark")
                ? "3 Years"
                : "1 Year"),
        },
      ];

      // Validate products
      for (const product of products) {
        if (
          !product.productType ||
          !product.qty ||
          !product.unitPrice ||
          !product.gst ||
          !product.warranty
        ) {
          return res.status(400).json({
            success: false,
            error: `Invalid product data in row: ${JSON.stringify(row)}`,
          });
        }
        if (
          isNaN(Number(product.qty)) ||
          Number(product.qty) <= 0 ||
          isNaN(Number(product.unitPrice)) ||
          (product.gst !== "including" && isNaN(Number(product.gst)))
        ) {
          return res.status(400).json({
            success: false,
            error: `Invalid product data in row: ${JSON.stringify(row)}`,
          });
        }
        if (
          product.productType === "IFPD" &&
          (!product.modelNos || !product.brand)
        ) {
          return res.status(400).json({
            success: false,
            error: `Model Numbers and Brand are required for IFPD products in row: ${JSON.stringify(
              row,
            )}`,
          });
        }
      }

      // Calculate total
      const calculatedTotal =
        products.reduce((sum, product) => {
          const qty = Number(product.qty) || 0;
          const unitPrice = Number(product.unitPrice) || 0;
          const gstRate =
            product.gst === "including" ? 0 : Number(product.gst) || 0;
          return sum + qty * unitPrice * (1 + gstRate / 100);
        }, 0) +
        Number(getVal("Freight Charges", "Freight Charges") || 0) +
        Number(getVal("Installation Charges", "Installation Charges") || 0);

      const calculatedPaymentDue =
        calculatedTotal - Number(getVal("Payment Collected", "Payment Collected") || 0);

      // Validate dispatchFrom
      if (
        getVal("Dispatch From", "Dispatch From") &&
        !validDispatchLocations.includes(getVal("Dispatch From", "Dispatch From"))
      ) {
        return res.status(400).json({
          success: false,
          error: `Invalid dispatchFrom value in row: ${JSON.stringify(row)}`,
        });
      }

      // Create order object
      const order = {
        soDate: getVal("SO Date", "SO Date") ? new Date(getVal("SO Date", "SO Date")) : new Date(),
        dispatchFrom: getVal("Dispatch From", "Dispatch From") || "",
        name: getVal("Contact Person Name", "Contact Person") || "",
        city: getVal("City", "City") || "",
        state: getVal("State", "State") || "",
        pinCode: getVal("Pin Code", "Pin Code") || "",
        contactNo: getVal("Contact No", "Contact Number") || "",
        alterno: getVal("Alternate No", "Alternate Number") || "",
        customerEmail: getVal("Customer Email", "Customer Email") || "",
        customername: getVal("Customer Name", "Customer Name") || "",
        products,
        total: calculatedTotal,
        gstno: getVal("GST No", "GST Number") || "",
        freightcs: getVal("Freight Charges", "Freight Charges") || "",
        freightstatus: getVal("Freight Status", "Freight Status") || "Extra",
        installchargesstatus: getVal("Installation Charges Status", "Installation Charges Status") || "Extra",
        installation: getVal("Installation Charges", "Installation Charges") || "",
        report: getVal("Reporting Manager", "Reporting Manager") || "",
        salesPerson: getVal("Sales Person", "Sales Person") || "",
        company: getVal("Company", "Company") || "Promark",
        orderType: getVal("Order Type", "Order Type") || "B2C",
        shippingAddress: getVal("Shipping Address", "Shipping Address") || "",
        billingAddress: getVal("Billing Address", "Billing Address") || "",
        sameAddress: getVal("Same Address", "Same Address") === "Yes" || false,
        paymentCollected: String(getVal("Payment Collected", "Payment Collected") || ""),
        paymentMethod: getVal("Payment Method", "Payment Method") || "",
        paymentDue: String(calculatedPaymentDue),
        neftTransactionId: getVal("NEFT Transaction ID", "NEFT / Transaction ID") || "",
        chequeId: getVal("Cheque ID", "Cheque ID") || "",
        remarks: getVal("Remarks", "SO Remarks") || "",
        gemOrderNumber: getVal("GEM Order Number", "GEM Order Number") || "",
        deliveryDate: getVal("Delivery Date", "Delivery Date")
          ? new Date(getVal("Delivery Date", "Delivery Date"))
          : null,
        paymentTerms: getVal("Payment Terms", "Payment Terms") || "",
        creditDays: getVal("Credit Days", "Credit Days") || "",
        createdBy: req.user.id,
      };

      orders.push(order);
    }

    // Save orders
    const savedOrders = await Order.insertMany(orders);

    // Emit newOrder events only to scoped rooms
    savedOrders.forEach((order) => {
      const targetRooms = new Set();
      targetRooms.add(`user:${String(order.createdBy)}`);
      if (order.assignedTo) targetRooms.add(`user:${String(order.assignedTo)}`);
      const payload = {
        _id: order._id,
        customername: order.customername,
        orderId: order.orderId,
        createdBy: String(order.createdBy),
        assignedTo: order.assignedTo ? String(order.assignedTo) : null,
      };
      for (const room of targetRooms) io.to(room).emit("newOrder", payload);
    });

    res.status(201).json({
      success: true,
      message: "Orders uploaded successfully",
      data: savedOrders,
    });
  } catch (error) {
    console.error("Error in bulkUploadOrders:", error);
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details: messages,
      });
    }
    res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    });
  }
};

// ============================================================================
// SHARED QUERY BUILDER FOR EXPORT AND PAGINATION
// ============================================================================
// This ensures export and pagination use IDENTICAL filter logic
const buildOrderQuery = async (params) => {
  const {
    userId,
    userRole,
    search,
    approval,
    orderType,
    dispatch,
    salesPerson,
    dispatchFrom,
    startDate,
    endDate,
    dashboardFilter,
  } = params;

  let query = {};

  // 1. Role-based Access Control
  if (userRole === "GlobalAdmin" || userRole === "SuperAdmin" || userRole === "Watch") {
    query = {};
  } else {
    const teamMembers = await User.find({ assignedToLeader: userId }).select("_id");
    const teamMemberIds = teamMembers.map((member) => member._id);
    const allUserIds = [userId, ...teamMemberIds];
    query = {
      $or: [
        { createdBy: { $in: allUserIds } },
        { assignedTo: { $in: allUserIds } },
      ],
    };
  }

  // 2. Global Search
  if (search) {
    const searchRegex = new RegExp(search, "i");
    const matchingUsers = await User.find({ username: searchRegex }).select("_id");
    const matchingUserIds = matchingUsers.map(u => u._id);

    const searchConditions = [
      { customername: searchRegex },
      { orderId: searchRegex },
      { contactNo: searchRegex },
      { customerEmail: searchRegex },
      { company: searchRegex },
      { city: searchRegex },
      { state: searchRegex },
      { pinCode: searchRegex },
      { salesPerson: searchRegex },
      { "products.productType": searchRegex },
      { "products.serialNos": searchRegex },
      { "products.modelNos": searchRegex },
      { billingAddress: searchRegex },
      { shippingAddress: searchRegex },
      { gstno: searchRegex },
      { remarks: searchRegex },
      { invoiceNo: searchRegex },
      { billNumber: searchRegex },
      { piNumber: searchRegex },
      { dispatchFrom: searchRegex },
      { transporter: searchRegex },
      { transporterDetails: searchRegex },
      { docketNo: searchRegex },
      { billStatus: searchRegex },
      { sostatus: searchRegex },
      { orderType: searchRegex },
      { paymentMethod: searchRegex },
      { paymentTerms: searchRegex },
      { creditDays: searchRegex },
      { gemOrderNumber: searchRegex },
      { installation: searchRegex },
      { dispatchStatus: searchRegex },
      { fulfillingStatus: searchRegex },
      { createdBy: { $in: matchingUserIds } }
    ];

    if (query.$or) {
      query = {
        $and: [
          { $or: query.$or },
          { $or: searchConditions }
        ]
      };
    } else {
      query.$or = searchConditions;
    }
  }

  // 3. Filters
  if (approval && approval !== "All") {
    query.sostatus = approval;
  }

  if (orderType && orderType !== "All") {
    query.orderType = orderType;
  }

  if (dispatch && dispatch !== "All") {
    query.dispatchStatus = dispatch;
  }

  if (dispatchFrom && dispatchFrom !== "All") {
    query.dispatchFrom = dispatchFrom;
  }

  if (salesPerson && salesPerson !== "All") {
    const user = await User.findOne({ username: salesPerson });
    if (user) {
      query.createdBy = user._id;
    } else {
      query.createdBy = new mongoose.Types.ObjectId();
    }
  }

  if (startDate || endDate) {
    let dateQuery = {};
    if (startDate) {
      dateQuery.$gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateQuery.$lte = end;
    }
    if (Object.keys(dateQuery).length > 0) {
      query.soDate = dateQuery;
    }
  }

  // 4. Dashboard Logic Filters
  if (dashboardFilter && dashboardFilter !== "all" && dashboardFilter !== "undefined") {
    switch (dashboardFilter) {
      case "production":
        query.sostatus = "Approved";
        query.dispatchFrom = {
          $nin: ["Patna", "Bareilly", "Ranchi", "Lucknow", "Delhi", "Jaipur", "Rajasthan"]
        };
        query.fulfillingStatus = { $ne: "Fulfilled" };
        break;
      case "installation":
        query.dispatchStatus = "Delivered";
        query.installationStatus = {
          $in: ["Pending", "In Progress", "Site Not Ready", "Hold"]
        };
        break;
      case "dispatch":
        query.fulfillingStatus = "Fulfilled";
        query.dispatchStatus = { $ne: "Delivered" };
        break;
      default:
        break;
    }
  }

  return query;
};

// Export orders to Excel
const exportentry = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    const {
      search,
      approval,
      orderType,
      dispatch,
      salesPerson,
      dispatchFrom,
      startDate,
      endDate,
      dashboardFilter,
    } = req.query;

    // ✅ USE SHARED QUERY BUILDER - Guarantees identical logic with pagination
    const query = await buildOrderQuery({
      userId,
      userRole,
      search,
      approval,
      orderType,
      dispatch,
      salesPerson,
      dispatchFrom,
      startDate,
      endDate,
      dashboardFilter,
    });

    const orders = await Order.find(query)
      .populate({
        path: "createdBy",
        select: "username email assignedToLeader",
        populate: { path: "assignedToLeader", select: "username" },
      })
      .populate({ path: "assignedTo", select: "username email" })
      .sort({ createdAt: -1 })
      .lean();

    if (!Array.isArray(orders) || orders.length === 0) {
      const ws = XLSX.utils.json_to_sheet([]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Orders");
      const fileBuffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
      res.setHeader("Content-Disposition", `attachment; filename=orders_${new Date().toISOString().slice(0, 10)}.xlsx`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      return res.send(fileBuffer);
    }

    // ✅ FIX: Create ONE row per order (not one row per product)
    // Aggregate products into comma-separated strings
    const formattedEntries = orders.map((entry) => {
      const products = Array.isArray(entry.products) && entry.products.length > 0 ? entry.products : [{
        productType: "Not Found", size: "N/A", spec: "N/A", qty: 0, unitPrice: 0, serialNos: [], modelNos: [], gst: 0, brand: "", warranty: "",
      }];

      // ✅ SIMPLIFIED FORMAT: All product details in one column
      // Format: [Type] - Qty: X, Price: ₹Y, Size: S, Spec: Sp, Brand: B, SN: S1, S2, Model: M1, M2, Warranty: W
      const productDetails = products.map(p => {
        const parts = [];

        // Product type (Name)
        parts.push(p.productType || "N/A");

        // Add details in a clean format
        if (p.qty) parts.push(`Qty: ${p.qty}`);
        if (p.unitPrice) parts.push(`Price: ₹${p.unitPrice}`);
        if (p.size && p.size !== "N/A") parts.push(`Size: ${p.size}`);
        if (p.spec && p.spec !== "N/A") parts.push(`Spec: ${p.spec}`);
        if (p.brand) parts.push(`Brand: ${p.brand}`);

        // Serial numbers
        if (Array.isArray(p.serialNos) && p.serialNos.length > 0) {
          parts.push(`SN: ${p.serialNos.join(", ")}`);
        }

        // Model numbers
        if (Array.isArray(p.modelNos) && p.modelNos.length > 0) {
          parts.push(`Model: ${p.modelNos.join(", ")}`);
        }

        // Warranty
        if (p.warranty) parts.push(`Warranty: ${p.warranty}`);

        return parts.join(" - ");
      }).join(" || "); // Use " || " for multiple products within one cell for better identification

      // ✅ ONLY Product Details and Total Quantity columns for product data
      const productData = {
        "Product Details": productDetails,
        "Total Quantity": products.reduce((sum, p) => sum + (p.qty || 0), 0),
      };

      const entryData = {
        "Order ID": entry.orderId || "",
        "SO Date": entry.soDate ? new Date(entry.soDate).toISOString().slice(0, 10) : "",
        "Dispatch From": entry.dispatchFrom || "",
        "Dispatch Date": entry.dispatchDate ? new Date(entry.dispatchDate).toISOString().slice(0, 10) : "",
        "Contact Person": entry.name || "",
        "City": entry.city || "",
        "State": entry.state || "",
        "Pin Code": entry.pinCode || "",
        "Contact Number": entry.contactNo || "",
        "Alternate Number": entry.alterno || "",
        "Customer Email": entry.customerEmail || "",
        "Customer Name": entry.customername || "",
      };

      const orderData = {
        "Total Amount": entry.total || 0,
        "Payment Collected": entry.paymentCollected || "",
        "Payment Method": entry.paymentMethod || "",
        "Payment Due": entry.paymentDue || "",
        "NEFT / Transaction ID": entry.neftTransactionId || "",
        "Cheque ID": entry.chequeId || "",
        "Freight Charges": entry.freightcs || "",
        "Freight Status": entry.freightstatus || "",
        "Installation Charges Status": entry.installchargesstatus || "",
        "GST Number": entry.gstno || "",
        "Order Type": entry.orderType || "Private",
        "Installation Charges": entry.installation || "",
        "Installation Status": entry.installationStatus || "Pending",
        "Installation Remarks": entry.remarksByInstallation || "",
        "Dispatch Status": entry.dispatchStatus || "Not Dispatched",
        "Sales Person": entry.salesPerson || "",
        "Reporting Manager": entry.report || "",
        "Company": entry.company || "Promark",
        "Transporter": entry.transporter || "",
        "Transporter Details": entry.transporterDetails || "",
        "Docket Number": entry.docketNo || "",
        "Shipping Address": entry.shippingAddress || "",
        "Billing Address": entry.billingAddress || "",
        "Invoice Number": entry.invoiceNo || "",
        "Production Status": entry.fulfillingStatus || "Pending",
        "Production Remarks": entry.remarksByProduction || "",
        "Accounts Remarks": entry.remarksByAccounts || "",
        "Payment Status": entry.paymentReceived || "Not Received",
        "Bill Number": entry.billNumber || "",
        "PI Number": entry.piNumber || "",
        "Billing Remarks": entry.remarksByBilling || "",
        "Verification Remarks": entry.verificationRemarks || "",
        "Bill Status": entry.billStatus || "Pending",
        "Overall Status": entry.completionStatus || "In Progress",
        "SO Remarks": entry.remarks || "",
        "Approval Status": entry.sostatus || "Pending for Approval",
        "Created By": entry.createdBy ? entry.createdBy.username : "-",
      };

      const dateData = {
        "Receipt Date": entry.receiptDate ? new Date(entry.receiptDate).toISOString().slice(0, 10) : "",
        "Invoice Date": entry.invoiceDate ? new Date(entry.invoiceDate).toISOString().slice(0, 10) : "",
        "Production Date": entry.fulfillmentDate ? new Date(entry.fulfillmentDate).toISOString().slice(0, 10) : "",
      };

      return { ...entryData, ...productData, ...orderData, ...dateData };
    });


    const ws = XLSX.utils.json_to_sheet(formattedEntries);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orders");
    const fileBuffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
    res.setHeader("Content-Disposition", `attachment; filename=orders_${new Date().toISOString().slice(0, 10)}.xlsx`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(fileBuffer);
  } catch (error) {
    console.error("Error in exportentry:", error);
    res.status(500).json({ success: false, message: "Failed to export orders", error: error.message });
  }
};

// Fetch finished goods orders
const getFinishedGoodsOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      fulfillingStatus: { $in: ["Fulfilled", "Partial Dispatch"] },
      dispatchStatus: { $nin: ["Order Cancelled"] },
      stamp: { $ne: "Received" },
    }).populate("createdBy", "username email");

    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    console.error("Error in getFinishedGoodsOrders:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch finished goods orders",
      error: error.message,
    });
  }
};

// Fetch verification orders
const getVerificationOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      paymentTerms: { $in: ["100% Advance", "Partial Advance"] },
      sostatus: {
        $nin: [
          "Accounts Approved",
          "Approved",
          "Order on Hold Due to Low Price",
        ],
      },
      dispatchStatus: { $ne: "Order Cancelled" }, // Exclude Cancelled
    }).populate("createdBy", "username email");
    res.json({ success: true, data: orders });
  } catch (error) {
    console.error("Error in getVerificationOrders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch verification orders",
      error: error.message,
    });
  }
};
// Fetch bill orders
const getBillOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      sostatus: "Approved",
      billStatus: { $ne: "Billing Complete" },
      dispatchStatus: { $ne: "Order Cancelled" }, // Exclude Cancelled
    }).populate("createdBy", "username email");
    res.json({ success: true, data: orders });
  } catch (error) {
    console.error("Error in getBillOrders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch bill orders",
      error: error.message,
    });
  }
};

// Fetch installation orders
const getInstallationOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      dispatchStatus: "Delivered",
      installchargesstatus: { $ne: "Not in Scope" },
      installationStatus: { $ne: "Completed" },
    }).populate("createdBy", "username email");

    res.json({ success: true, data: orders });
  } catch (error) {
    console.error("Error in getInstallationOrders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch installation orders",
      error: error.message,
    });
  }
};

// Fetch accounts orders
const getAccountsOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      paymentReceived: { $ne: "Received" },
      dispatchStatus: { $ne: "Order Cancelled" },
      $or: [
        // 🔹 Normal flow: installation completed
        { installationStatus: "Completed" },

        // 🔹 Bypass flow: Not in Scope (ignore installation status)
        { installchargesstatus: "Not in Scope" },
      ],
    }).populate("createdBy", "username email");

    res.json({ success: true, data: orders });
  } catch (error) {
    console.error("Error in getAccountsOrders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch accounts orders",
      error: error.message,
    });
  }
};

// Fetch production approval orders
const getProductionApprovalOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      $or: [
        // 🔹 Case 1: Accounts Approved (existing)
        { sostatus: "Accounts Approved" },

        // 🔹 Case 2: Pending + Credit (existing)
        {
          $and: [
            { sostatus: "Pending for Approval" },
            { paymentTerms: "Credit" },
          ],
        },

        // 🔹 Case 3: Partial Stock + Approved (NEW ✅)
        {
          $and: [{ stockStatus: "Partial Stock" }, { sostatus: "Approved" }],
        },
      ],

      dispatchStatus: { $ne: "Order Cancelled" }, // Exclude Cancelled
    }).populate("createdBy", "username email");

    res.json({ success: true, data: orders });
  } catch (error) {
    console.error("Error in getProductionApprovalOrders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch production approval orders",
      error: error.message,
    });
  }
};

// Fetch production orders
const getProductionOrders = async (req, res) => {
  try {
    const dispatchFromOptions = [
      "Patna",
      "Bareilly",
      "Ranchi",
      "Lucknow",
      "Delhi",
      "Jaipur",
      "Rajasthan",
    ];

    const orders = await Order.find({
      sostatus: "Approved",
      dispatchFrom: { $nin: dispatchFromOptions },
      fulfillingStatus: { $ne: "Fulfilled" },
      dispatchStatus: { $ne: "Order Cancelled" }, // Exclude Cancelled
    }).lean();

    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    console.error("Error in getProductionOrders:", error.message);
    res.status(500).json({
      success: false,
      message: "Error fetching production orders",
      error: error.message,
    });
  }
};

// Notifictions
const getNotifications = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User not authenticated",
      });
    }

    const userId = req.user.id;
    const userRole = req.user.role;

    let notifications;

    if (
      userRole === "GlobalAdmin" ||
      userRole === "SuperAdmin" ||
      userRole === "Watch"
    ) {
      // Full access — see all notifications
      notifications = await Notification.find({ role: "All" })
        .sort({ timestamp: -1 })
        .limit(50);
    } else {
      // Admin / salesperson — see only notifications for their own orders + team members' orders
      const teamMembers = await User.find({ assignedToLeader: userId }).select("_id");
      const teamMemberIds = teamMembers.map((m) => m._id);
      const allUserIds = [new mongoose.Types.ObjectId(userId), ...teamMemberIds];

      notifications = await Notification.find({
        role: "All",
        orderCreatedBy: { $in: allUserIds },
      })
        .sort({ timestamp: -1 })
        .limit(50);
    }

    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    console.error("Error in getNotifications:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
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
    const userId = req.user?.id;
    const userRole = req.user?.role;

    let filter = { role: "All" };

    if (
      userRole !== "GlobalAdmin" &&
      userRole !== "SuperAdmin" &&
      userRole !== "Watch"
    ) {
      const teamMembers = await User.find({ assignedToLeader: userId }).select("_id");
      const teamMemberIds = teamMembers.map((m) => m._id);
      const allUserIds = [new mongoose.Types.ObjectId(userId), ...teamMemberIds];
      filter.orderCreatedBy = { $in: allUserIds };
    }

    await Notification.updateMany(filter, { isRead: true });
    res
      .status(200)
      .json({ success: true, message: "Notifications marked as read" });
  } catch (error) {
    console.error("Error in markNotificationsRead:", error.stack);
    res.status(500).json({
      success: false,
      message: "Failed to mark notifications as read",
      error: error.message,
    });
  }
};

// Clear notifications
const clearNotifications = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;

    let filter = { role: "All" };

    if (
      userRole !== "GlobalAdmin" &&
      userRole !== "SuperAdmin" &&
      userRole !== "Watch"
    ) {
      const teamMembers = await User.find({ assignedToLeader: userId }).select("_id");
      const teamMemberIds = teamMembers.map((m) => m._id);
      const allUserIds = [new mongoose.Types.ObjectId(userId), ...teamMemberIds];
      filter.orderCreatedBy = { $in: allUserIds };
    }

    await Notification.deleteMany(filter);
    res.status(200).json({ success: true, message: "Notifications cleared" });
  } catch (error) {
    console.error("Error in clearNotifications:", error.stack);
    res.status(500).json({
      success: false,
      message: "Failed to clear notifications",
      error: error.message,
    });
  }
};

// Assign user to team (fixed notification usage)
const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      // CRM-origin users have no SO User record — return empty data gracefully
      return res.json({ success: true, data: null });
    }
    res.json({ success: true, data: user });
  } catch (error) {
    console.error("Error fetching current user:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch current user",
      error: error.message,
    });
  }
};

// Fixed fetchAvailableUsers function
const fetchAvailableUsers = async (req, res) => {
  try {
    const users = await User.find({
      assignedToLeader: null,
      _id: { $ne: req.user.id },
      role: { $in: ["salesperson", "admin"] },
    }).select("username email");
    res.json({ success: true, data: users });
  } catch (error) {
    console.error("Error fetching available users:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch available users",
      error: error.message,
    });
  }
};

// Fixed fetchMyTeam function
const fetchMyTeam = async (req, res) => {
  try {
    const team = await User.find({ assignedToLeader: req.user.id })
      .select("username email assignedToLeader")
      .populate("assignedToLeader", "username");
    res.json({ success: true, data: team });
  } catch (error) {
    console.error("Error fetching team members:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch team members",
      error: error.message,
    });
  }
};

// Fixed assignUser function
const assignUser = async (req, res) => {
  const { userId } = req.body;
  try {
    console.log("Assigning user ID:", userId, "by leader ID:", req.user.id); // Debug log
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    if (targetUser.assignedToLeader) {
      return res
        .status(400)
        .json({ success: false, message: "User already assigned to a team" });
    }
    if (targetUser._id.equals(req.user.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Cannot assign yourself" });
    }
    targetUser.assignedToLeader = req.user.id;
    await targetUser.save();

    // Emit socket event
    const io = req.app.get("io");
    if (io) {
      io.emit("teamUpdate", {
        userId: targetUser._id,
        leaderId: req.user.id,
        action: "assign",
      });
    }

    res.json({ success: true, message: "User assigned successfully" });
  } catch (error) {
    console.error("Error assigning user:", error);
    res.status(500).json({
      success: false,
      message: "Failed to assign user",
      error: error.message,
    });
  }
};

// Fixed unassignUser function
const unassignUser = async (req, res) => {
  const { userId } = req.body;
  try {
    console.log("Unassigning user ID:", userId, "by leader ID:", req.user.id); // Debug log
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    if (
      !targetUser.assignedToLeader ||
      !targetUser.assignedToLeader.equals(req.user.id)
    ) {
      return res.status(403).json({
        success: false,
        message: "You are not the leader of this user",
      });
    }
    targetUser.assignedToLeader = null;
    await targetUser.save();

    // Emit socket event
    const io = req.app.get("io");
    if (io) {
      io.emit("teamUpdate", {
        userId: targetUser._id,
        leaderId: req.user.id,
        action: "unassign",
      });
    }

    res.json({ success: true, message: "User unassigned successfully" });
  } catch (error) {
    console.error("Error unassigning user:", error);
    res.status(500).json({
      success: false,
      message: "Failed to unassign user",
      error: error.message,
    });
  }
};
// Get orders with pagination
const getOrdersPaginated = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const {
      search,
      approval,
      orderType,
      dispatch,
      salesPerson,
      dispatchFrom,
      startDate,
      endDate,
      dashboardFilter,
    } = req.query;

    // ✅ USE SHARED QUERY BUILDER - Guarantees identical logic with export
    const query = await buildOrderQuery({
      userId,
      userRole,
      search,
      approval,
      orderType,
      dispatch,
      salesPerson,
      dispatchFrom,
      startDate,
      endDate,
      dashboardFilter,
    });

    const total = await Order.countDocuments(query);

    // Calculate total product quantity for the filtered result
    const qtyAggregation = await Order.aggregate([
      { $match: query },
      { $unwind: "$products" },
      { $group: { _id: null, totalQty: { $sum: "$products.qty" } } }
    ]);
    const totalProductQty = qtyAggregation.length > 0 ? qtyAggregation[0].totalQty : 0;

    const orders = await Order.find(query)
      .populate({
        path: "createdBy",
        select: "username email assignedToLeader",
        populate: { path: "assignedToLeader", select: "username" },
      })
      .populate({ path: "assignedTo", select: "username email" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      data: orders,
      total,
      totalProductQty,
      page,
      pages: Math.ceil(total / limit),
    });

  } catch (error) {
    console.error("Error in getOrdersPaginated:", error.message);
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = {
  initSocket,
  unassignUser,
  assignUser,
  fetchMyTeam,
  fetchAvailableUsers,
  getAllOrders,
  getOrdersPaginated,
  createOrder,
  editEntry,
  DeleteData,
  bulkUploadOrders,
  exportentry,
  getCurrentUser,
  getFinishedGoodsOrders,
  getVerificationOrders,
  getProductionApprovalOrders,
  getBillOrders,
  getInstallationOrders,
  getAccountsOrders,
  getProductionOrders,
  getNotifications,
  markNotificationsRead,
  clearNotifications,
  getDashboardCounts,
  getSalesAnalytics,
  sendInstallationCompletionMail,
};
