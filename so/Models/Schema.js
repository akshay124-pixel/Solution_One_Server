const mongoose = require("mongoose");
const { getSOConnection } = require("../../utils/connections");

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  sequence: { type: Number, default: 0 },
});

const productSchema = new mongoose.Schema({
  productType: { type: String, trim: true, required: true },
  size: { type: String, default: "N/A", trim: true },
  spec: { type: String, default: "N/A", trim: true },
  qty: { type: Number, min: 1, required: true },
  unitPrice: { type: Number, required: true },
  serialNos: [{ type: String, trim: true }],
  modelNos: [{ type: String, trim: true }],
  productCode: [{ type: String, trim: true }],
  gst: {
    type: String,
    default: "18",
    enum: ["18", "28", "including"],
    trim: true,
    required: true,
  },
  brand: { type: String, trim: true, default: "" },
  warranty: { type: String, trim: true, required: true },
});

const orderSchema = new mongoose.Schema(
  {
    orderId: { type: String, unique: true },
    soDate: { type: Date, required: true },
    dispatchFrom: {
      type: String,
      trim: true,
      enum: [
        "Patna",
        "Bareilly",
        "Ranchi",
        "Morinda",
        "Lucknow",
        "Delhi",
        "Jaipur",
        "Rajasthan",
        "",
      ],
      default: "",
    },
    dispatchDate: { type: Date },
    name: { type: String, trim: true },
    gstno: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pinCode: { type: String, trim: true },
    contactNo: { type: String, trim: true },
    alterno: { type: String, trim: true },
    customerEmail: { type: String, trim: true },
    customername: { type: String, trim: true, required: true },
    products: [productSchema],
    total: { type: Number, min: 0, required: true },
    paymentCollected: { type: String, trim: true },
    paymentMethod: {
      type: String,
      enum: ["Cash", "NEFT", "RTGS", "Cheque", ""],
      default: "",
    },
    poFilePath: String,
    paymentDue: { type: String, trim: true },
    neftTransactionId: { type: String, trim: true },
    chequeId: { type: String, trim: true },
    paymentTerms: {
      type: String,
      enum: ["100% Advance", "Partial Advance", "Credit", ""],
      default: "",
    },
    creditDays: { type: String, trim: true },
    freightcs: { type: String, trim: true },
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
      enum: ["B2G", "B2C", "B2B", "Demo", "Replacement", "Stock Out", "Repair"],
      default: "B2C",
    },
    approvalTimestamp: { type: Date },
    productsEditTimestamp: { type: Date },
    productno: { type: String },
    gemOrderNumber: { type: String, trim: true },
    deliveryDate: { type: Date },
    deliveredDate: { type: Date },
    installation: { type: String, trim: true },
    installationStatus: { type: String, default: "Pending" },
    installationStatusDate: { type: Date },
    installationeng: { type: String },
    remarksByInstallation: { type: String, default: "", trim: true },
    dispatchStatus: {
      type: String,
      enum: [
        "Not Dispatched",
        "Docket Awaited Dispatched",
        "Hold by Salesperson",
        "Hold by Customer",
        "Order Cancelled",
        "Partially Shipped",
        "Dispatched",
        "Delivered",
      ],
      default: "Not Dispatched",
    },
    salesPerson: { type: String, trim: true },
    report: { type: String, trim: true },
    company: {
      type: String,
      enum: ["Promark", "Foxmate", "Promine", "Primus"],
      default: "Promark",
      required: true,
    },
    submissionTime: {
      type: String,
      default: new Date().toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "full",
        timeStyle: "medium",
      }),
    },
    transporter: { type: String, trim: true },
    transporterDetails: { type: String, trim: true },
    docketNo: { type: String, trim: true },
    receiptDate: { type: Date },
    shippingAddress: { type: String, default: "", trim: true },
    billingAddress: { type: String, default: "", trim: true },
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
    stockStatus: {
      type: String,
      enum: ["In Stock", "Not in Stock", "Partial Stock"],
      default: "In Stock",
    },
    submissionTime: {
      type: String,
      default: new Date().toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "full",
        timeStyle: "medium",
      }),
    },
    installationFile: { type: String },
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
    demoDate: { type: Date },
    fulfillmentDate: { type: Date },
    remarks: { type: String, trim: true },
    sostatus: {
      type: String,
      enum: [
        "Pending for Approval",
        "Accounts Approved",
        "Approved",
        "Order on Hold Due to Low Price",
        "Order Cancelled",
      ],
      default: "Pending for Approval",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

// Removed orderSchema.index({ orderId: 1 }); to avoid duplicate index warning
orderSchema.index({ soDate: 1 });
orderSchema.index({ createdBy: 1 });
orderSchema.index({ assignedTo: 1 }); // Index for team access queries

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

const notificationSchema = new mongoose.Schema({
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  isRead: { type: Boolean, default: false },
  role: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  orderCreatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
});

const Order = getSOConnection().model("Order", orderSchema);
const Counter = getSOConnection().model("Counter", counterSchema);
const Notification = getSOConnection().model("Notification", notificationSchema);

module.exports = { Order, Counter, Notification };
