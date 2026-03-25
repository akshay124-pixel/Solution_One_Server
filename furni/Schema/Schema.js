/**
 * Furni Order, Counter, and Notification Models
 * Uses Furni_Data connection via getFurniConnection().
 * Mirrors Sales_Order_Furni/Server/Models/Schema.js exactly,
 * adapted to use the furni connection singleton.
 */
const mongoose = require("mongoose");
const { getFurniConnection } = require("../../utils/connections");

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  sequence: { type: Number, default: 0 },
});

const productSchema = new mongoose.Schema({
  productType: { type: String, trim: true, required: true },
  size: { type: String, default: "N/A", trim: true },
  spec: { type: String, default: "N/A", trim: true },
  qty: { type: Number, min: 1, required: true },
  unitPrice: { type: Number, min: 0, required: true },
  modelNos: [{ type: String, trim: true }],
  gst: {
    type: String,
    enum: ["18", "including"],
    trim: true,
    required: true,
  },
});

const orderSchema = new mongoose.Schema(
  {
    orderId: { type: String, unique: true },
    soDate: { type: Date, required: true },
    dispatchFrom: {
      type: String,
      trim: true,
      enum: [
        "Patna", "Bareilly", "Ranchi", "Morinda",
        "Lucknow", "Delhi", "Jaipur", "Rajasthan", "",
      ],
      default: "",
    },
    dispatchDate: { type: Date },
    name: { type: String, trim: true, required: true },
    gstno: { type: String, trim: true },
    city: { type: String, trim: true, required: true },
    state: { type: String, trim: true, required: true },
    pinCode: { type: String, trim: true, required: true },
    contactNo: { type: String, trim: true, required: true },
    alterno: { type: String, trim: true },
    customerEmail: { type: String, trim: true, required: true },
    customername: { type: String, trim: true, required: true },
    products: [productSchema],
    total: { type: Number, min: 0, required: true },
    paymentCollected: { type: String, trim: true, default: "" },
    paymentMethod: {
      type: String,
      enum: ["Cash", "NEFT", "RTGS", "Cheque", ""],
      default: "",
    },
    paymentDue: { type: String, trim: true, default: "" },
    neftTransactionId: { type: String, trim: true, default: "" },
    chequeId: { type: String, trim: true, default: "" },
    paymentTerms: {
      type: String,
      enum: ["100% Advance", "Partial Advance", "Credit", ""],
      default: "",
    },
    freightcs: { type: String, trim: true, default: "" },
    freightstatus: {
      type: String,
      enum: ["Self-Pickup", "To Pay", "Including", "Extra"],
      default: "Extra",
    },
    actualFreight: { type: Number, min: 0 },
    installchargesstatus: {
      type: String,
      enum: ["To Pay", "Including", "Extra", "Not in Scope"],
      default: "Extra",
    },
    orderType: {
      type: String,
      enum: ["B2G", "B2C", "B2B", "Demo", "Replacement", "Stock Out"],
      default: "B2C",
    },
    gemOrderNumber: { type: String, trim: true, default: "" },
    deliveryDate: { type: Date },
    installationFile: { type: String },
    installation: { type: String, trim: true },
    installationStatus: { type: String, default: "Pending" },
    installationReport: {
      type: String,
      enum: ["Yes", "No", "Installed"],
      default: "No",
    },
    stamp: {
      type: String,
      enum: ["Received", "Not Received"],
      default: "Not Received",
    },
    remarksByInstallation: { type: String, default: "", trim: true },
    dispatchStatus: {
      type: String,
      enum: [
        "Not Dispatched",
        "Hold by Salesperson",
        "Hold by Customer",
        "Order Cancelled",
        "Dispatched",
        "Delivered",
      ],
      default: "Not Dispatched",
    },
    salesPerson: { type: String, trim: true, default: "" },
    report: { type: String, trim: true, default: "" },
    company: {
      type: String,
      enum: ["Promark", "Foxmate", "Promine", "Primus", ""],
      default: "",
    },
    transporterDetails: { type: String, trim: true },
    docketNo: { type: String, trim: true },
    receiptDate: { type: Date },
    shippingAddress: { type: String, trim: true, required: true },
    billingAddress: { type: String, trim: true, required: true },
    invoiceNo: { type: String, trim: true },
    invoiceDate: { type: Date },
    fulfillingStatus: { type: String, default: "Pending", trim: true },
    remarksByProduction: { type: String, trim: true },
    remarksByAccounts: { type: String, trim: true },
    paymentReceived: {
      type: String,
      enum: ["Not Received", "Received"],
      default: "Not Received",
    },
    billNumber: { type: String, trim: true },
    piNumber: { type: String, trim: true },
    remarksByBilling: { type: String, trim: true },
    remarksBydispatch: { type: String, trim: true },
    verificationRemarks: { type: String, trim: true },
    billStatus: {
      type: String,
      enum: ["Pending", "Under Billing", "Billing Complete"],
      default: "Pending",
    },
    completionStatus: {
      type: String,
      enum: ["In Progress", "Complete"],
      default: "In Progress",
    },
    demoDate: { type: Date },
    fulfillmentDate: { type: Date },
    remarks: { type: String, trim: true, default: "" },
    sostatus: {
      type: String,
      enum: [
        "Pending for Approval",
        "Accounts Approved",
        "Approved",
        "Order Cancelled",
        "Hold By Production",
      ],
      default: "Pending for Approval",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Indexes for performance
orderSchema.index({ orderId: 1 });
orderSchema.index({ soDate: 1 });
orderSchema.index({ createdBy: 1 });

const notificationSchema = new mongoose.Schema({
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  isRead: { type: Boolean, default: false },
  role: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
});

// Models are created once, on first require (after initConnections)
let Order, Counter, Notification;

const getModels = () => {
  if (!Order) {
    const conn = getFurniConnection();

    // Counter must be defined before Order (pre-save hook references it)
    Counter = conn.model("Counter", counterSchema);

    // Auto-generate orderId using the furni connection's Counter model
    orderSchema.pre("save", async function (next) {
      if (this.isNew && !this.orderId) {
        try {
          const counter = await Counter.findByIdAndUpdate(
            { _id: "orderId" },
            { $inc: { sequence: 1 } },
            { new: true, upsert: true }
          );
          this.orderId = `PMTO${counter.sequence}`;
          next();
        } catch (error) {
          next(error);
        }
      } else {
        next();
      }
    });

    Order        = conn.model("Order", orderSchema);
    Notification = conn.model("Notification", notificationSchema);
  }
  return { Order, Counter, Notification };
};

module.exports = { getModels };
