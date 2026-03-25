/**
 * Furni Controller — DataLogic.js
 * All business logic for the Furni (Sales Order Furniture) module.
 * Adapted from Sales_Order_Furni/Server/Controller/Logic.js:
 *   - Removed all auth logic (login, signup, JWT generation) — portal handles this
 *   - Replaced mongoose.model() calls with getFurniConnection() models via getModels()
 *   - Removed app.listen(), dotenv.config(), cors() — server/index.js handles these
 *   - Socket.IO initSocket() adapted to accept (server, app) like SO module pattern
 */
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const { Server } = require("socket.io");
const { getModels } = require("../Schema/Schema");
const { getUser: getFurniUser } = require("../Schema/Model");
const logger = require("../utils/logger");
const { sendMail } = require("../utils/mailer");

let io;

const initSocket = (server, app) => {
  const allowedOrigins = [
    process.env.UNIFIED_CLIENT_URL || "http://localhost:3000",
  ];

  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
      credentials: true,
    },
    path: "/furni/socket.io",
  });

  io.on("connection", (socket) => {
    logger.info("Furni client connected", { socketId: socket.id });

    socket.on("join", async (data) => {
      try {
        const userId = data?.userId;
        const role = data?.role;
        if (userId) {
          socket.join(`user:${userId}`);
          try {
            const FurniUser = getFurniUser();
            const dbUser = await FurniUser.findById(userId).select("assignedToLeader role");
            if (dbUser?.assignedToLeader) {
              socket.join(`leader:${dbUser.assignedToLeader}`);
            }
          } catch (lookupErr) {
            logger.warn("Furni: Failed to look up user for leader room join", { error: lookupErr?.message });
          }
        }
        if (role === "Admin" || role === "SuperAdmin" || role === "GlobalAdmin") {
          socket.join("admins");
        }
        logger.info("Furni socket joined rooms", { socketId: socket.id, userId: userId || "unknown" });
      } catch (err) {
        logger.warn("Furni join handler error", { socketId: socket.id, error: err?.message });
      }
    });

    socket.on("disconnect", () => {
      logger.info("Furni client disconnected", { socketId: socket.id });
    });
  });

  // Set up MongoDB change stream to watch for Order collection changes
  try {
    const { Order } = getModels();
    const changeStream = Order.watch([], { fullDocument: "updateLookup" });

    changeStream.on("change", async (change) => {
      const fullDoc = change.fullDocument;
      const documentId = change.documentKey?._id;

      if (fullDoc?.createdBy) {
        const targetRooms = new Set();
        targetRooms.add(`user:${String(fullDoc.createdBy)}`);
        if (fullDoc.assignedTo) {
          targetRooms.add(`user:${String(fullDoc.assignedTo)}`);
        }
        const payload = {
          operationType: change.operationType,
          documentId,
          createdBy: String(fullDoc.createdBy),
          assignedTo: fullDoc.assignedTo ? String(fullDoc.assignedTo) : null,
          fullDocument: fullDoc,
        };
        for (const room of targetRooms) {
          io.to(room).emit("orderUpdate", payload);
        }
      }

      try {
        const { Order: O } = getModels();
        const dispatchFromOptions = ["Patna", "Bareilly", "Ranchi", "Lucknow", "Delhi", "Jaipur", "Rajasthan"];
        const [all, installation, dispatch, production] = await Promise.all([
          O.countDocuments({}),
          O.countDocuments({
            dispatchStatus: "Delivered",
            installationStatus: { $in: ["Pending", "In Progress", "Site Not Ready", "Hold"] },
          }),
          O.countDocuments({
            fulfillingStatus: "Fulfilled",
            dispatchStatus: { $ne: "Delivered" },
          }),
          O.countDocuments({
            sostatus: "Approved",
            dispatchFrom: { $nin: dispatchFromOptions },
            fulfillingStatus: { $ne: "Fulfilled" },
          }),
        ]);
        io.to("admins").emit("dashboardCounts", { all, installation, production, dispatch });
      } catch (countErr) {
        logger.warn("Furni: Failed to emit admin dashboardCounts", { error: countErr?.message });
      }
    });

    changeStream.on("error", (error) => {
      logger.error("Furni change stream error", { error });
    });

    changeStream.on("close", () => {
      logger.info("Furni change stream closed");
    });
  } catch (error) {
    logger.error("Furni: Error setting up change stream", { error });
  }

  if (app) app.set("furniIo", io);
};

// Shared notification creator
function createNotification(req, order, action) {
  const { Notification } = getModels();
  const username = req.user?.username || "User";
  const customerName = order.customername || "Unknown";
  const orderId = order.orderId || "N/A";
  return new Notification({
    message: `${action} by ${username} for ${customerName} (Order ID: ${orderId})`,
    timestamp: new Date(),
    isRead: false,
    role: "All",
    userId: req.user?.id || null,
  });
}

// ── GET /dashboard-counts ─────────────────────────────────────────────────────
const getDashboardCounts = async (req, res) => {
  try {
    const { Order } = getModels();
    const { role, id } = req.user;
    const dispatchFromOptions = ["Patna", "Bareilly", "Ranchi", "Lucknow", "Delhi", "Jaipur", "Rajasthan"];

    // For salesperson: scope all counts to their own orders only
    const userObjectId = mongoose.Types.ObjectId.isValid(id)
      ? new mongoose.Types.ObjectId(id)
      : id;
    const ownerFilter = (role === "SuperAdmin" || role === "GlobalAdmin")
      ? {}
      : { createdBy: userObjectId };

    const [all, installation, production, dispatch] = await Promise.all([
      Order.countDocuments({ ...ownerFilter }),
      Order.countDocuments({
        ...ownerFilter,
        dispatchStatus: "Delivered",
        installationStatus: { $in: ["Pending", "In Progress", "Site Not Ready", "Hold"] },
      }),
      Order.countDocuments({
        ...ownerFilter,
        sostatus: "Approved",
        dispatchFrom: { $nin: dispatchFromOptions },
        fulfillingStatus: { $ne: "Fulfilled" },
      }),
      Order.countDocuments({
        ...ownerFilter,
        fulfillingStatus: "Fulfilled",
        dispatchStatus: { $ne: "Delivered" },
      }),
    ]);
    res.json({ all, installation, production, dispatch });
  } catch (error) {
    logger.error("Furni getDashboardCounts error", { error: error.message });
    res.status(500).json({ success: false, error: "Failed to fetch dashboard counts", message: error.message });
  }
};

// ── GET /get-orders ───────────────────────────────────────────────────────────
const getAllOrders = async (req, res) => {
  try {
    const { Order } = getModels();
    const { role, id } = req.user;
    let orders;
    if (role === "SuperAdmin" || role === "GlobalAdmin") {
      orders = await Order.find().populate("createdBy", "username email");
    } else {
      // Admin and salesperson both see only their own orders
      orders = await Order.find({ createdBy: id }).populate("createdBy", "username email");
    }
    res.json(orders);
  } catch (error) {
    logger.error("Furni getAllOrders error", { error: error.message });
    res.status(500).json({ error: "Server error" });
  }
};

// ── POST /orders ──────────────────────────────────────────────────────────────
const createOrder = async (req, res) => {
  try {
    const { Order, Notification } = getModels();
    const {
      name, city, state, pinCode, contactNo, alterno, customerEmail,
      customername, products, orderType, report, freightcs, installation,
      salesPerson, company, shippingAddress, billingAddress, sameAddress,
      total, gstno, freightstatus, installchargesstatus, paymentCollected,
      paymentMethod, paymentDue, neftTransactionId, chequeId, remarks,
      gemOrderNumber, deliveryDate, demoDate, paymentTerms, dispatchFrom,
      fulfillingStatus,
    } = req.body;

    if (!customername || !name || !contactNo || !customerEmail) {
      return res.status(400).json({ success: false, error: "Missing required customer details" });
    }
    if (!/^\d{10}$/.test(contactNo)) {
      return res.status(400).json({ success: false, error: "Contact number must be exactly 10 digits" });
    }
    if (alterno && !/^\d{10}$/.test(alterno)) {
      return res.status(400).json({ success: false, error: "Alternate contact number must be exactly 10 digits" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return res.status(400).json({ success: false, error: "Invalid email address" });
    }
    if (!state || !city || !pinCode) {
      return res.status(400).json({ success: false, error: "Missing required address details" });
    }
    if (!/^\d{6}$/.test(pinCode)) {
      return res.status(400).json({ success: false, error: "Pin Code must be exactly 6 digits" });
    }
    if (!shippingAddress || !billingAddress) {
      return res.status(400).json({ success: false, error: "Missing billing or shipping address" });
    }
    if (orderType === "B2G" && !gemOrderNumber) {
      return res.status(400).json({ success: false, error: "Missing GEM Order Number for B2G orders" });
    }
    if (orderType === "Demo" && !demoDate) {
      return res.status(400).json({ success: false, error: "Missing Demo Date for Demo orders" });
    }
    if (!paymentTerms && orderType !== "Demo") {
      return res.status(400).json({ success: false, error: "Payment Terms is required for non-Demo orders" });
    }

    const validDispatchLocations = ["Patna", "Bareilly", "Ranchi", "Morinda", "Lucknow", "Delhi", "Jaipur", "Rajasthan"];
    if (dispatchFrom && !validDispatchLocations.includes(dispatchFrom)) {
      return res.status(400).json({ success: false, error: "Invalid dispatchFrom value" });
    }

    for (const product of products) {
      if (!product.productType || !product.qty || !product.unitPrice || !product.gst) {
        return res.status(400).json({ success: false, error: "Invalid product data" });
      }
      product.size = product.size || "N/A";
      product.spec = product.spec || "N/A";
      product.modelNos = Array.isArray(product.modelNos) ? product.modelNos : [];
    }

    const calculatedTotal =
      products.reduce((sum, p) => {
        const qty = Number(p.qty) || 0;
        const unitPrice = Number(p.unitPrice) || 0;
        const gstRate = p.gst === "including" ? 0 : Number(p.gst) || 0;
        return sum + qty * unitPrice * (1 + gstRate / 100);
      }, 0) +
      Number(freightcs || 0) +
      Number(installation || 0);

    const calculatedPaymentDue = calculatedTotal - Number(paymentCollected || 0);

    const order = new Order({
      soDate: new Date(),
      name, city, state, pinCode, contactNo, alterno, customerEmail,
      customername, products, gstno,
      freightcs: freightcs || "",
      freightstatus: freightstatus || "Extra",
      installchargesstatus: installchargesstatus || "Extra",
      installation: installation || "",
      report, salesPerson, company,
      orderType: orderType || "B2C",
      shippingAddress, billingAddress, sameAddress,
      total: total !== undefined && !isNaN(total) ? Number(total) : calculatedTotal,
      paymentCollected: String(paymentCollected || ""),
      paymentMethod: paymentMethod || "",
      paymentDue: paymentDue !== undefined && !isNaN(paymentDue) ? String(paymentDue) : String(calculatedPaymentDue),
      neftTransactionId: neftTransactionId || "",
      chequeId: chequeId || "",
      remarks,
      gemOrderNumber: gemOrderNumber || "",
      deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
      paymentTerms: paymentTerms || "",
      demoDate: demoDate ? new Date(demoDate) : null,
      createdBy: req.user.id,
      dispatchFrom,
      fulfillingStatus: fulfillingStatus || (dispatchFrom === "Morinda" ? "Pending" : "Fulfilled"),
    });

    const savedOrder = await order.save();

    const notification = new Notification({
      message: `New sales order created by ${req.user.username || "User"} for ${savedOrder.customername || "Unknown"} (Order ID: ${savedOrder.orderId || "N/A"})`,
      timestamp: new Date(),
      isRead: false,
      role: "All",
      userId: req.user.id,
    });
    await notification.save();

    try {
      const notifRooms = new Set();
      if (savedOrder?.createdBy) notifRooms.add(`user:${String(savedOrder.createdBy)}`);
      if (savedOrder?.assignedTo) notifRooms.add(`user:${String(savedOrder.assignedTo)}`);
      notifRooms.add("admins");
      const notifPayload = {
        _id: String(notification._id),
        message: notification.message,
        timestamp: notification.timestamp,
        isRead: notification.isRead,
        userId: notification.userId ? String(notification.userId) : null,
        orderId: savedOrder.orderId || String(savedOrder._id),
      };
      io.to([...notifRooms]).emit("notification", notifPayload);
    } catch (emitErr) {
      logger.warn("Furni: Failed to emit scoped notification", { error: emitErr?.message });
    }

    res.status(201).json({ success: true, data: savedOrder });
  } catch (error) {
    logger.error("Furni createOrder error", { error });
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, error: "Validation failed", details: messages });
    }
    res.status(500).json({ success: false, error: "Server error", details: error.message });
  }
};
// -- PUT /edit/:id -------------------------------------------------------------
const editEntry = async (req, res) => {
  try {
    const { Order, Notification } = getModels();
    const orderId = req.params.id;
    const updateData = req.body;
    const existingOrder = await Order.findById(orderId);
    if (!existingOrder) return res.status(404).json({ success: false, error: "Order not found" });

    const allowedFields = [
      "soDate","dispatchFrom","dispatchDate","name","city","state","pinCode",
      "contactNo","alterno","customerEmail","customername","products","total",
      "gstno","freightstatus","installchargesstatus","paymentCollected",
      "paymentMethod","paymentDue","neftTransactionId","chequeId","freightcs",
      "orderType","installation","installationStatus","remarksByInstallation",
      "dispatchStatus","salesPerson","report","company","installationReport",
      "transporterDetails","receiptDate","shippingAddress","billingAddress",
      "sameAddress","invoiceNo","invoiceDate","fulfillingStatus",
      "remarksByProduction","remarksByAccounts","paymentReceived","billNumber",
      "piNumber","remarksByBilling","verificationRemarks","billStatus",
      "completionStatus","fulfillmentDate","remarks","sostatus","gemOrderNumber",
      "deliveryDate","stamp","demoDate","paymentTerms","actualFreight","remarksBydispatch",
    ];

    const updateFields = {};
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        if (field === "products" && typeof updateData[field] === "string") {
          try { updateFields[field] = JSON.parse(updateData[field]); continue; } catch (_) {}
        }
        if (field.endsWith("Date") && updateData[field] && !isNaN(new Date(updateData[field]))) {
          updateFields[field] = new Date(updateData[field]);
        } else {
          updateFields[field] = updateData[field];
        }
      }
    }

    if (req.file) updateFields.installationFile = req.file.filename;

    const prevFulfill = existingOrder.fulfillingStatus;
    const newFulfill = updateData.fulfillingStatus;
    if (newFulfill && prevFulfill !== newFulfill) {
      if (newFulfill === "Fulfilled") { updateFields.completionStatus = "Complete"; updateFields.fulfillmentDate = new Date(); }
      if (newFulfill === "Order Cancel") updateFields.sostatus = "Order Cancelled";
      if (newFulfill === "Hold") updateFields.sostatus = "Hold By Production";
    }

    const updatedOrder = await Order.findByIdAndUpdate(orderId, { $set: updateFields }, { new: true, runValidators: false });
    if (!updatedOrder) return res.status(404).json({ success: false, error: "Order not found" });

    if (updateFields.sostatus === "Approved" && updatedOrder.customerEmail && existingOrder.sostatus !== "Approved") {
      try {
        await sendMail(updatedOrder.customerEmail, "Your Order is Approved!", "",
          `<p>Dear ${updatedOrder.customername || "Customer"}, your order #${updatedOrder.orderId} has been approved. Total: Rs.${updatedOrder.total || 0}. Thank you for choosing Promark Tech Solutions.</p>`);
      } catch (mailErr) { logger.error("Furni: Approval email failed", { error: mailErr.message }); }
    }

    const prevDispatch = existingOrder.dispatchStatus;
    const newDispatch = updateFields.dispatchStatus;
    if (newDispatch && prevDispatch !== newDispatch && (newDispatch === "Dispatched" || newDispatch === "Delivered") && updatedOrder.customerEmail) {
      try {
        const st = newDispatch === "Dispatched" ? "dispatched" : "delivered";
        await sendMail(updatedOrder.customerEmail, `Your Order Has Been ${st.charAt(0).toUpperCase() + st.slice(1)}!`, "",
          `<p>Dear ${updatedOrder.customername || "Customer"}, your order #${updatedOrder.orderId} has been ${st}. Thank you for choosing Promark Tech Solutions.</p>`);
      } catch (mailErr) { logger.error("Furni: Shipment email failed", { error: mailErr.message }); }
    }

    const notification = new Notification({
      message: `Order updated by ${req.user?.username || "Unknown"} for ${updatedOrder.customername || "Unknown"} (Order ID: ${updatedOrder.orderId || "N/A"})`,
      timestamp: new Date(), isRead: false, role: "All", userId: req.user?.id || null,
    });
    await notification.save();
    try {
      const rooms = new Set();
      if (updatedOrder?.createdBy) rooms.add(`user:${String(updatedOrder.createdBy)}`);
      if (updatedOrder?.assignedTo) rooms.add(`user:${String(updatedOrder.assignedTo)}`);
      rooms.add("admins");
      io.to([...rooms]).emit("notification", { _id: String(notification._id), message: notification.message, timestamp: notification.timestamp, isRead: notification.isRead, userId: notification.userId ? String(notification.userId) : null, orderId: updatedOrder.orderId || String(updatedOrder._id) });
    } catch (emitErr) { logger.warn("Furni: emit notification failed (editEntry)", { error: emitErr?.message }); }

    res.status(200).json({ success: true, data: updatedOrder });
  } catch (error) {
    logger.error("Furni editEntry error", { error });
    res.status(500).json({ success: false, error: "Server error", details: error.message });
  }
};

// -- DELETE /delete/:id --------------------------------------------------------
const DeleteData = async (req, res) => {
  try {
    const { Order } = getModels();
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (req.user.role === "salesperson" || req.user.role === "Admin") {
      if (order.createdBy.toString() !== req.user.id) {
        return res.status(403).json({ success: false, message: "Unauthorized to delete this order" });
      }
    }
    await Order.findByIdAndDelete(req.params.id);
    const notification = createNotification(req, order, "Order deleted");
    await notification.save();
    const rooms = new Set();
    rooms.add(`user:${String(order.createdBy)}`);
    if (order.assignedTo) rooms.add(`user:${String(order.assignedTo)}`);
    io.to([...rooms]).emit("deleteOrder", { _id: order._id, customername: order.customername, orderId: order.orderId, createdBy: String(order.createdBy), assignedTo: order.assignedTo ? String(order.assignedTo) : null });
    rooms.add("admins");
    io.to([...rooms]).emit("notification", { _id: String(notification._id), message: notification.message, timestamp: notification.timestamp, isRead: notification.isRead, userId: notification.userId ? String(notification.userId) : null, orderId: order.orderId || String(order._id) });
    res.status(200).json({ success: true, message: "Order deleted successfully" });
  } catch (error) {
    logger.error("Furni DeleteData error", { error });
    res.status(500).json({ success: false, message: "Failed to delete order", error: error.message });
  }
};

// -- Helper: Build Order Query -------------------------------------------------
const buildOrderQuery = async ({ userId, userRole, search, approval, orderType, dispatch, salesPerson, dispatchFrom, startDate, endDate, dashboardFilter, accountsStatus, installationStatus }) => {
  const { Order } = getModels();
  const FurniUser = getFurniUser();
  const query = {};

  if (userRole !== "SuperAdmin" && userRole !== "GlobalAdmin") {
    // Cast userId to ObjectId so aggregation $match works correctly
    const userObjectId = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : userId;
    const teamMembers = await FurniUser.find({ assignedToLeader: userObjectId }).select("_id");
    const teamMemberIds = teamMembers.map((m) => m._id);
    const allUserIds = [userObjectId, ...teamMemberIds];
    query.$or = [{ createdBy: { $in: allUserIds } }, { assignedTo: { $in: allUserIds } }];
  }

  if (search) {
    const searchRegex = new RegExp(search, "i");
    const searchConditions = [
      { orderId: searchRegex }, { customername: searchRegex }, { name: searchRegex },
      { contactNo: searchRegex }, { customerEmail: searchRegex }, { city: searchRegex },
      { state: searchRegex }, { billingAddress: searchRegex }, { shippingAddress: searchRegex },
      { invoiceNo: searchRegex }, { billNumber: searchRegex }, { remarks: searchRegex },
      { sostatus: searchRegex }, { dispatchStatus: searchRegex }, { fulfillingStatus: searchRegex },
      { "products.productType": searchRegex }, { "products.modelNos": searchRegex },
    ];
    if (query.$or) { query.$and = [{ $or: query.$or }, { $or: searchConditions }]; delete query.$or; }
    else { query.$or = searchConditions; }
  }

  if (startDate && endDate) { query.soDate = { $gte: new Date(startDate), $lte: new Date(endDate) }; }
  else if (startDate) { query.soDate = { $gte: new Date(startDate) }; }
  else if (endDate) { query.soDate = { $lte: new Date(endDate) }; }

  if (approval && approval !== "All") {
    const statusMap = { "Pending": "Pending for Approval", "Hold": "Hold By Production", "Order Cancel": "Order Cancelled" };
    if (statusMap[approval]) { query.sostatus = statusMap[approval]; }
    else { query.fulfillingStatus = approval; }
  }

  if (orderType && orderType !== "All") {
    const validOrderTypes = ["B2G", "B2C", "B2B", "Demo", "Replacement", "Stock Out"];
    if (validOrderTypes.includes(orderType)) { query.orderType = orderType; }
    else { query["products.productType"] = orderType; }
  }

  if (dispatch && dispatch !== "All") query.dispatchStatus = dispatch;
  if (accountsStatus && accountsStatus !== "All") query.paymentReceived = accountsStatus;
  if (installationStatus && installationStatus !== "All") query.installationStatus = installationStatus;
  if (salesPerson && salesPerson !== "All") query.salesPerson = salesPerson;
  if (dispatchFrom && dispatchFrom !== "All") query.dispatchFrom = dispatchFrom;

  if (dashboardFilter && dashboardFilter !== "all") {
    const dispatchFromOptions = ["Patna", "Bareilly", "Ranchi", "Lucknow", "Delhi", "Jaipur", "Rajasthan"];
    switch (dashboardFilter) {
      case "installation":
        query.dispatchStatus = "Delivered";
        query.installationStatus = { $in: ["Pending", "In Progress", "Site Not Ready", "Hold"] };
        break;
      case "production":
        query.sostatus = "Approved";
        query.dispatchFrom = { $nin: dispatchFromOptions };
        query.fulfillingStatus = { $ne: "Fulfilled" };
        break;
      case "dispatch":
        query.fulfillingStatus = "Fulfilled";
        query.dispatchStatus = { $ne: "Delivered" };
        break;
    }
  }
  return query;
};

// -- GET /get-orders-paginated -------------------------------------------------
const getOrdersPaginated = async (req, res) => {
  try {
    const { Order } = getModels();
    const userId = req.user.id;
    const userRole = req.user.role;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { search, approval, orderType, dispatch, salesPerson, dispatchFrom, startDate, endDate, dashboardFilter, accountsStatus, installationStatus } = req.query;
    const query = await buildOrderQuery({ userId, userRole, search, approval, orderType, dispatch, salesPerson, dispatchFrom, startDate, endDate, dashboardFilter, accountsStatus, installationStatus });
    const total = await Order.countDocuments(query);
    const qtyAgg = await Order.aggregate([{ $match: query }, { $unwind: "$products" }, { $group: { _id: null, totalQty: { $sum: "$products.qty" } } }]);
    const totalProductQty = qtyAgg.length > 0 ? qtyAgg[0].totalQty : 0;
    const orders = await Order.find(query)
      .populate({ path: "createdBy", select: "username email assignedToLeader", populate: { path: "assignedToLeader", select: "username" } })
      .populate({ path: "assignedTo", select: "username email" })
      .sort({ createdAt: -1 }).skip(skip).limit(limit);
    res.json({ data: orders, total, totalProductQty, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    logger.error("Furni getOrdersPaginated error", { error: error.message });
    res.status(500).json({ error: "Server error", message: error.message });
  }
};

// -- GET /export ---------------------------------------------------------------
const exportentry = async (req, res) => {
  try {
    const { Order } = getModels();
    const { search, approval, orderType, dispatch, salesPerson, dispatchFrom, startDate, endDate, dashboardFilter, accountsStatus, installationStatus } = req.query;
    const query = await buildOrderQuery({ userId: req.user.id, userRole: req.user.role, search, approval, orderType, dispatch, salesPerson, dispatchFrom, startDate, endDate, dashboardFilter, accountsStatus, installationStatus });
    const orders = await Order.find(query).populate({ path: "createdBy", select: "username" }).populate({ path: "assignedTo", select: "username" }).sort({ createdAt: -1 });
    const exportData = orders.map((order, index) => {
      const productDetails = order.products.map((p) => `Product: ${p.productType || "-"} Spec: ${p.spec || "-"} - Qty: ${p.qty || 0} - Model: ${p.modelNos || "-"} - Price: ${p.unitPrice || 0}`).join(" || ");
      const formatDate = (d) => d ? new Date(d).toLocaleDateString("en-GB") : "-";
      return {
        "Seq No": index + 1, "Order ID": order.orderId || "-", "SO Date": formatDate(order.soDate),
        "Customer Name": order.customername || "-", "Contact Person": order.name || "-",
        "Contact No": order.contactNo || "-", "Email": order.customerEmail || "-",
        "SO Status": order.sostatus || "-", "City": order.city || "-", "State": order.state || "-",
        "GST No": order.gstno || "-", "Shipping Address": order.shippingAddress || "-",
        "Billing Address": order.billingAddress || "-", "Product Details": productDetails,
        "Total Qty": order.products.reduce((acc, p) => acc + (p.qty || 0), 0),
        "Total Amount": order.total || 0, "Payment Collected": order.paymentCollected || 0,
        "Payment Due": order.paymentDue || 0, "Dispatch Status": order.dispatchStatus || "-",
        "Production Status": order.fulfillingStatus || "-", "Installation Status": order.installationStatus || "-",
        "Created By": order.createdBy?.username || "-", "Assigned To": order.assignedTo?.username || "-",
        "Remarks": order.remarks || "-",
      };
    });
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Orders");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=furni_orders_${new Date().toISOString().slice(0, 10)}.xlsx`);
    res.send(buffer);
  } catch (error) {
    logger.error("Furni exportentry error", { error: error.message });
    res.status(500).json({ error: "Server error" });
  }
};

// -- POST /bulk-orders ---------------------------------------------------------
const bulkUploadOrders = async (req, res) => {
  try {
    const { Order } = getModels();
    if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(sheet);
    const orders = [];
    const validDispatchLocations = ["Patna", "Bareilly", "Ranchi", "Morinda", "Lucknow", "Delhi", "Jaipur", "Rajasthan"];
    for (const row of jsonData) {
      const products = [{ productType: row["Product Type"] || "", size: row["Size"] || "N/A", spec: row["Specification"] || "N/A", qty: Number(row["Quantity"]) || 0, unitPrice: Number(row["Unit Price"]) || 0, gst: row["GST"] || "18", modelNos: row["Model Nos"] ? String(row["Model Nos"]).split(",").map((m) => m.trim()) : [] }];
      if (row["Dispatch From"] && !validDispatchLocations.includes(row["Dispatch From"])) {
        return res.status(400).json({ success: false, error: `Invalid dispatchFrom value in row: ${JSON.stringify(row)}` });
      }
      const calculatedTotal = products.reduce((sum, p) => { const qty = Number(p.qty) || 0; const unitPrice = Number(p.unitPrice) || 0; const gstRate = p.gst === "including" ? 0 : Number(p.gst) || 0; return sum + qty * unitPrice * (1 + gstRate / 100); }, 0) + Number(row["Freight Charges"] || 0) + Number(row["Installation Charges"] || 0);
      orders.push({ soDate: row["SO Date"] ? new Date(row["SO Date"]) : new Date(), dispatchFrom: row["Dispatch From"] || "", name: row["Contact Person Name"] || "", city: row["City"] || "", state: row["State"] || "", pinCode: row["Pin Code"] || "", contactNo: row["Contact No"] || "", alterno: row["Alternate No"] || "", customerEmail: row["Customer Email"] || "", customername: row["Customer Name"] || "", products, total: calculatedTotal, gstno: row["GST No"] || "", freightcs: row["Freight Charges"] || "", freightstatus: row["Freight Status"] || "Extra", installchargesstatus: row["Installation Charges Status"] || "Extra", installation: row["Installation Charges"] || "", report: row["Reporting Manager"] || "", salesPerson: row["Sales Person"] || "", company: row["Company"] || "Promark", orderType: row["Order Type"] || "B2C", shippingAddress: row["Shipping Address"] || "", billingAddress: row["Billing Address"] || "", sameAddress: row["Same Address"] === "Yes" || false, paymentCollected: String(row["Payment Collected"] || ""), paymentMethod: row["Payment Method"] || "", paymentDue: String(calculatedTotal - Number(row["Payment Collected"] || 0)), neftTransactionId: row["NEFT Transaction ID"] || "", chequeId: row["Cheque ID"] || "", remarks: row["Remarks"] || "", gemOrderNumber: row["GEM Order Number"] || "", deliveryDate: row["Delivery Date"] ? new Date(row["Delivery Date"]) : null, paymentTerms: row["Payment Terms"] || "", createdBy: req.user.id });
    }
    const savedOrders = await Order.insertMany(orders);
    savedOrders.forEach((o) => { const creator = o.createdBy?.toString?.() || req.user.id.toString(); io.to(creator).emit("newOrder", { order: o }); io.to("admins").emit("newOrder", { order: o }); });
    res.status(201).json({ success: true, message: "Orders uploaded successfully", data: savedOrders });
  } catch (error) {
    logger.error("Furni bulkUploadOrders error", { error });
    res.status(500).json({ success: false, error: "Server error", details: error.message });
  }
};

// -- GET /get-analytics --------------------------------------------------------
const getSalesAnalytics = async (req, res) => {
  try {
    const { Order } = getModels();
    const { startDate, endDate, productionStatus, productType, installStatus, accountsStatus, dispatchStatus } = req.query;
    let adjustedEndDate = endDate;
    if (endDate) { const end = new Date(endDate); end.setHours(23, 59, 59, 999); adjustedEndDate = end.toISOString(); }
    const matchQuery = await buildOrderQuery({ userId: req.user.id, userRole: req.user.role, startDate: startDate ? new Date(startDate).toISOString() : undefined, endDate: adjustedEndDate, approval: productionStatus, orderType: productType, installationStatus: installStatus, accountsStatus, dispatch: dispatchStatus });
    if (!matchQuery.sostatus) matchQuery.sostatus = { $ne: "Order Cancelled" };
    const pipeline = [
      { $match: matchQuery },
      { $group: { _id: "$createdBy", totalOrders: { $sum: 1 }, totalAmount: { $sum: "$total" }, totalPaymentCollected: { $sum: { $convert: { input: "$paymentCollected", to: "double", onError: 0, onNull: 0 } } }, totalPaymentDue: { $sum: { $convert: { input: "$paymentDue", to: "double", onError: 0, onNull: 0 } } }, totalUnitPrice: { $sum: { $reduce: { input: "$products", initialValue: 0, in: { $add: ["$$value", { $multiply: [{ $ifNull: ["$$this.unitPrice", 0] }, { $ifNull: ["$$this.qty", 0] }] }] } } } }, dueOver30Days: { $sum: { $cond: [{ $and: [{ $gt: [{ $convert: { input: "$paymentDue", to: "double", onError: 0, onNull: 0 } }, 0] }, { $gt: [{ $divide: [{ $subtract: [new Date(), "$soDate"] }, 1000 * 60 * 60 * 24] }, 30] }] }, { $convert: { input: "$paymentDue", to: "double", onError: 0, onNull: 0 } }, 0] } } } },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "creator" } },
      { $unwind: { path: "$creator", preserveNullAndEmptyArrays: true } },
      { $project: { _id: 1, createdBy: { $ifNull: ["$creator.username", "Unknown"] }, totalOrders: 1, totalAmount: 1, totalPaymentCollected: 1, totalPaymentDue: 1, totalUnitPrice: 1, dueOver30Days: 1 } },
    ];
    const analytics = await Order.aggregate(pipeline);
    res.status(200).json(analytics);
  } catch (error) {
    logger.error("Furni getSalesAnalytics error", { error: error.message });
    res.status(500).json({ error: "Server error", message: error.message });
  }
};

// -- GET /finished-goods -------------------------------------------------------
const getFinishedGoodsOrders = async (req, res) => {
  try {
    const { Order } = getModels();
    const orders = await Order.find({ fulfillingStatus: "Fulfilled", stamp: { $ne: "Received" } }).populate("createdBy", "username email");
    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    logger.error("Furni getFinishedGoodsOrders error", { error: error.message });
    res.status(500).json({ success: false, message: "Failed to fetch finished goods orders", error: error.message });
  }
};

// -- GET /get-verification-orders ----------------------------------------------
const getVerificationOrders = async (req, res) => {
  try {
    const { Order } = getModels();
    const orders = await Order.find({ paymentTerms: { $in: ["100% Advance", "Partial Advance"] }, sostatus: { $nin: ["Accounts Approved", "Approved", "Order Cancelled"] } }).populate("createdBy", "username email");
    res.json({ success: true, data: orders });
  } catch (error) {
    logger.error("Furni getVerificationOrders error", { error });
    res.status(500).json({ success: false, message: "Failed to fetch verification orders", error: error.message });
  }
};

// -- GET /get-bill-orders ------------------------------------------------------
const getBillOrders = async (req, res) => {
  try {
    const { Order } = getModels();
    const orders = await Order.find({ sostatus: "Approved", billStatus: { $ne: "Billing Complete" } }).populate("createdBy", "username email");
    res.json({ success: true, data: orders });
  } catch (error) {
    logger.error("Furni getBillOrders error", { error });
    res.status(500).json({ success: false, message: "Failed to fetch bill orders", error: error.message });
  }
};

// -- GET /installation-orders --------------------------------------------------
const getInstallationOrders = async (req, res) => {
  try {
    const { Order } = getModels();
    const orders = await Order.find({ dispatchStatus: "Delivered", installchargesstatus: { $ne: "Not in Scope" }, installationReport: { $ne: "Yes" }, installationStatus: { $in: ["Pending", "In Progress", "Failed", "Completed", "Hold by Salesperson", "Hold by Customer", "Site Not Ready"] } }).populate("createdBy", "username email");
    res.json({ success: true, data: orders });
  } catch (error) {
    logger.error("Furni getInstallationOrders error", { error });
    res.status(500).json({ success: false, message: "Failed to fetch installation orders", error: error.message });
  }
};

// -- GET /accounts-orders ------------------------------------------------------
const getAccountsOrders = async (req, res) => {
  try {
    const { Order } = getModels();
    const orders = await Order.find({ paymentReceived: { $ne: "Received" }, $or: [{ installationStatus: "Completed" }, { installchargesstatus: "Not in Scope" }] }).populate("createdBy", "username email");
    res.json({ success: true, data: orders });
  } catch (error) {
    logger.error("Furni getAccountsOrders error", { error });
    res.status(500).json({ success: false, message: "Failed to fetch accounts orders", error: error.message });
  }
};

// -- GET /production-approval-orders ------------------------------------------
const getProductionApprovalOrders = async (req, res) => {
  try {
    const { Order } = getModels();
    const orders = await Order.find({ $or: [{ sostatus: "Accounts Approved" }, { $and: [{ sostatus: "Pending for Approval" }, { paymentTerms: "Credit" }] }] }).populate("createdBy", "username email");
    res.json({ success: true, data: orders });
  } catch (error) {
    logger.error("Furni getProductionApprovalOrders error", { error });
    res.status(500).json({ success: false, message: "Failed to fetch production approval orders", error: error.message });
  }
};

// -- GET /production-orders ----------------------------------------------------
const getProductionOrders = async (req, res) => {
  try {
    const { Order } = getModels();
    const dispatchFromOptions = ["Patna", "Bareilly", "Ranchi", "Lucknow", "Delhi", "Jaipur", "Rajasthan"];
    const orders = await Order.find({ sostatus: { $in: ["Approved", "Hold By Production"] }, dispatchFrom: { $nin: dispatchFromOptions }, fulfillingStatus: { $nin: ["Fulfilled", "Order Cancel"] } }).lean();
    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    logger.error("Furni getProductionOrders error", { error: error.message });
    res.status(500).json({ success: false, message: "Error fetching production orders", error: error.message });
  }
};

// -- GET /notifications --------------------------------------------------------
const getNotifications = async (req, res) => {
  try {
    const { Notification } = getModels();
    if (!req.user || !req.user.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const notifications = await Notification.find({ $or: [{ role: "All" }, { userId: req.user.id }] }).sort({ timestamp: -1 }).limit(50);
    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    logger.error("Furni getNotifications error", { error: error.message });
    res.status(500).json({ success: false, message: "Failed to fetch notifications", error: error.message });
  }
};

// -- POST /mark-read -----------------------------------------------------------
const markNotificationsRead = async (req, res) => {
  try {
    const { Notification } = getModels();
    const filter = req.user?.id ? { $or: [{ role: "All" }, { userId: req.user.id }] } : { role: "All" };
    await Notification.updateMany(filter, { isRead: true });
    res.status(200).json({ success: true, message: "Notifications marked as read" });
  } catch (error) {
    logger.error("Furni markNotificationsRead error", { error: error.message });
    res.status(500).json({ success: false, message: "Failed to mark notifications as read", error: error.message });
  }
};

// -- DELETE /clear -------------------------------------------------------------
const clearNotifications = async (req, res) => {
  try {
    const { Notification } = getModels();
    const filter = req.user?.id ? { $or: [{ role: "All" }, { userId: req.user.id }] } : { role: "All" };
    await Notification.deleteMany(filter);
    res.status(200).json({ success: true, message: "Notifications cleared" });
  } catch (error) {
    logger.error("Furni clearNotifications error", { error: error.message });
    res.status(500).json({ success: false, message: "Failed to clear notifications", error: error.message });
  }
};

// -- POST /send-completion-mail ------------------------------------------------
const sendInstallationCompletionMail = async (req, res) => {
  try {
    const { Order } = getModels();
    const { orderId } = req.body;
    const order = await Order.findById(orderId).populate("createdBy", "username email");
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (!order.customerEmail) return res.status(400).json({ success: false, message: "Customer email not available" });
    const orderDisplayId = order.orderId || order._id;
    const subject = `Installation Assignment: Order #${orderDisplayId}`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;"><div style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:30px;text-align:center;color:white;border-radius:8px 8px 0 0;"><h1>Installation Scheduled!</h1><p>Order #${orderDisplayId}</p></div><div style="padding:30px;background:#fff;"><h2>Dear ${order.customername || "Customer"},</h2><p>An installation engineer has been assigned for your order. Installation will be completed within 2 days.</p><p><strong>Order ID:</strong> ${orderDisplayId}<br/><strong>Location:</strong> ${order.shippingAddress || (order.city ? `${order.city}, ${order.state}` : "N/A")}<br/><strong>Timeline:</strong> Within 48 Hours</p><p>Please ensure the site is ready. Our engineer will contact you shortly.</p></div><div style="padding:20px;background:#f1f5f9;text-align:center;font-size:14px;color:#64748b;border-radius:0 0 8px 8px;"><p>With regards,<br/>The Promark Tech Solutions Crew</p></div></div>`;
    await sendMail(order.customerEmail, subject, "", html);
    res.status(200).json({ success: true, message: "Installation assignment email sent successfully" });
  } catch (error) {
    logger.error("Furni sendInstallationCompletionMail error", { error: error.message });
    res.status(500).json({ success: false, message: "Failed to send email", error: error.message });
  }
};

module.exports = {
  initSocket,
  getDashboardCounts,
  getAllOrders,
  getOrdersPaginated,
  createOrder,
  editEntry,
  DeleteData,
  bulkUploadOrders,
  exportentry,
  getSalesAnalytics,
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
  sendInstallationCompletionMail,
};
