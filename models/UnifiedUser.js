/**
 * UnifiedUser — lives in the Auth_Data database (decoupled from CRM).
 * Single source of truth for portal-level login across CRM, SO, and DMS.
 *
 * CRITICAL: _id is set to the original source collection's _id (CRM or SO).
 * This ensures the JWT token's `id` field matches the `createdBy` / `assignedTo`
 * ObjectIds stored in CRM entries and SO orders — so all data queries work correctly.
 *
 * For users that exist in BOTH apps (same email in CRM + SO):
 *   - _id = CRM user's _id  (CRM data queries work)
 *   - soUserId = SO user's _id  (SO data queries work — see authRoutes.js)
 */
const mongoose = require("mongoose");
const { getAuthConnection } = require("../utils/connections");

const unifiedUserSchema = new mongoose.Schema(
  {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
    },
    // role values: CRM roles (superadmin, admin, others) + SO roles (Sales, Production, etc.)
    role: {
      type: String,
      required: true,
    },
    // Which app this user originally belongs to
    // Single: "crm" | "so" | "dms" | "furni"
    // Combined: "crm+so" (legacy "both"), "crm+dms", "so+dms", "crm+so+dms"
    //           "furni", "crm+furni", "so+furni", "dms+furni",
    //           "crm+so+furni", "so+dms+furni", "crm+so+dms+furni"
    app_module: {
      type: String,
      // "both" removed — use "crm+so" instead. Run scripts/migrateAppModuleBoth.js once.
      enum: [
        "crm", "so", "dms", "furni",
        "crm+so", "crm+dms", "so+dms", "crm+furni", "so+furni", "dms+furni",
        "crm+so+dms", "crm+so+furni", "so+dms+furni", "crm+dms+furni",
        "crm+so+dms+furni",
      ],
      required: true,
    },
    // CRM-specific fields
    assignedAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    assignedAdmins: [{ type: mongoose.Schema.Types.ObjectId }],
    refreshTokens: [String],
    // SO-specific fields
    assignedToLeader: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // For "both" users: the SO collection's _id (different from CRM _id).
    // The SO token uses this id so SO order queries match correctly.
    soUserId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // For all-module users: the DMS collection's _id.
    dmsUserId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // For Furni module users: the Furni collection's _id.
    furniUserId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // For salesperson role: dms=false → CRM+SO access, dms=true → SO+DMS access
    dms: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const UnifiedUser = getAuthConnection().model("UnifiedUser", unifiedUserSchema);

module.exports = UnifiedUser;
