/**
 * Unified Auth Routes
 * POST /api/auth/login   — single login endpoint for all users
 * POST /api/auth/signup  — create user in CRM/SO/both + UnifiedUser
 * POST /api/auth/refresh — refresh unified access token
 * POST /api/auth/logout  — clear refresh token cookie
 */
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const UnifiedUser = require("../models/UnifiedUser");
const logger = require("../utils/logger");
const { loginLimiter, signupLimiter } = require("../middleware/rateLimiter");

const UNIFIED_SECRET = process.env.UNIFIED_JWT_SECRET;
const REFRESH_SECRET = process.env.UNIFIED_REFRESH_SECRET;

if (!UNIFIED_SECRET) throw new Error("FATAL: UNIFIED_JWT_SECRET is not set in environment");
if (!REFRESH_SECRET) throw new Error("FATAL: UNIFIED_REFRESH_SECRET is not set in environment");

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// Derive app_access from role.
// RULE: app_access.length === 3 → 3-card Module Selector
//       app_access.length === 2 → 2-card Module Selector
//       app_access.length === 1 → direct to their dashboard
function getAppAccess(role, dms = false, app_module = null) {
  // Normalise legacy "both" value → "crm+so"
  if (app_module === "both") app_module = "crm+so";

  // SO-only roles (also used in Furni)
  const soOnlyRoles = ["Production", "Installation", "Finish", "Accounts",
                       "Verification", "Bill", "ProductionApproval", "Watch"];

  // globaladmin always gets all 4
  if (role === "globaladmin") return ["crm", "so", "dms", "furni"];

  // superadmin: use stored app_module to determine which modules they have access to
  if (role === "superadmin") {
    if (app_module) {
      const parts = app_module.split("+").filter(Boolean);
      if (parts.length > 0) return parts;
    }
    return ["crm", "so", "dms", "furni"]; // fallback for legacy superadmins
  }

  // admin: dms=false → CRM+SO+Furni, dms=true → SO+DMS+Furni
  if (role === "admin") return dms ? ["so", "dms", "furni"] : ["crm", "so", "furni"];

  // salesperson: dms=false → CRM+SO+Furni, dms=true → SO+DMS+Furni
  if (role === "salesperson") return dms ? ["so", "dms", "furni"] : ["crm", "so", "furni"];

  // Legacy role names (kept for backward compat with existing DB records)
  if (role === "others") return ["crm", "so"];
  if (role === "Sales")  return ["crm", "so", "furni"];
  if (role === "Admin")  return ["crm", "so", "furni"];
  if (role === "dms_user") return ["dms"];

  // Furni-only roles → direct to furni only (detected via app_module stored in DB)
  // IMPORTANT: this check must come BEFORE soOnlyRoles so that furni-only signups
  // (Production, Installation, etc. with furniOnly:true) get ["furni"] not ["so","furni"]
  if (app_module === "furni") return ["furni"];

  // SO+Furni operational roles (signed up via SO tab — have both so and furni access)
  if (soOnlyRoles.includes(role)) return ["so", "furni"];
  return ["crm"]; // fallback
}

// SO-only operational roles — always go directly to SO, never see module selector.
// These roles operate exclusively in SO even though they also have furni access.
const SO_OPERATIONAL_ROLES = [
  "Production", "Installation", "Finish", "Accounts",
  "Verification", "Bill", "ProductionApproval", "Watch",
];

// Furni-only operational roles — always go directly to furni, never see module selector.
const FURNI_OPERATIONAL_ROLES = [
  "Production", "Installation", "Finish", "Accounts",
  "Verification", "Bill", "ProductionApproval",
];

// Redirect hint: driven by role first, then app_access length.
// SO/Furni operational roles bypass the module selector entirely.
// app_access.length >= 2 → "select-module"
// app_access.length === 1 → direct dashboard hint
function getRedirectHint(role, dms = false, app_module = null) {
  // SO operational roles → always direct to SO (they have so+furni but only work in SO)
  if (SO_OPERATIONAL_ROLES.includes(role) && app_module !== "furni") return "so-dashboard";

  // Furni-only operational roles (signed up with furniOnly:true) → direct to furni
  if (FURNI_OPERATIONAL_ROLES.includes(role) && app_module === "furni") return "furni-dashboard";

  const access = getAppAccess(role, dms, app_module);
  if (access.length >= 2) return "select-module";
  if (access.includes("dms")) return "dms-dashboard";
  if (access.includes("furni") && !access.includes("so")) return "furni-dashboard";
  if (access.includes("so")) return "so-dashboard";
  return "crm-dashboard";
}

function generateAccessToken(user) {
  const app_access = getAppAccess(user.role, user.dms, user.app_module);

  // Embed all four module IDs so each backend can match its own collection's _id.
  //   id      = CRM _id    (CRM backend uses req.user.id)
  //   soId    = SO _id     (SO backend uses req.user.soId || req.user.id)
  //   dmsId   = DMS _id    (DMS backend uses req.user.dmsId || req.user.id)
  //   furniId = Furni _id  (Furni backend uses req.user.furniId || req.user.id)
  const crmId   = user._id;
  const soId    = user.soUserId    || user._id;
  const dmsId   = user.dmsUserId   || user._id;
  const furniId = user.furniUserId || user._id;

  return jwt.sign(
    {
      id: crmId,
      soId,
      dmsId,
      furniId,
      username: user.username,
      email: user.email,
      role: user.role,
      dms: user.dms || false,
      app_module: user.app_module,
      app_access,
    },
    UNIFIED_SECRET,
    { expiresIn: "15m" }
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    { id: user._id, random: Math.random().toString(36).substring(7) },
    REFRESH_SECRET,
    { expiresIn: "7d" }
  );
}

// ── POST /api/auth/signup ─────────────────────────────────────────────────────
const CRM_ROLES   = ["globaladmin", "superadmin", "admin", "salesperson"];
const SO_ROLES    = ["Watch", "Production", "salesperson", "Installation", "Finish",
                     "Accounts", "Admin", "Verification", "Bill", "ProductionApproval"];
const DMS_ROLES   = []; // no standalone DMS-only role anymore
// Furni-only roles — actual Furni DB enum values (sent with furniOnly:true flag)
// SuperAdmin/Admin/Sales excluded — covered by globaladmin/admin/salesperson
const FURNI_ONLY_ROLES = [
  "Production", "ProductionApproval", "Installation",
  "Finish", "Accounts", "Verification", "Bill",
];
// Roles that also get Furni access (mirrors getAppAccess logic)
const FURNI_ROLES = ["globaladmin", "superadmin", "admin", "salesperson",
                     "Production", "Installation", "Finish", "Accounts",
                     "Verification", "Bill", "ProductionApproval", "salesperson", "Admin"];
// Roles that get full access to ALL 3 modules — must exist in CRM, SO, and DMS DBs
const ALL_MODULE_ROLES = ["globaladmin", "superadmin", "admin"];
const ALL_ROLES = [...CRM_ROLES, ...SO_ROLES, ...FURNI_ONLY_ROLES];

router.post("/signup", signupLimiter, async (req, res) => {
  try {
    const { username, email, password, role, dms, furniOnly, superadminModules } = req.body;

    if (!username || !email || !password || !role) {
      return res.status(400).json({ success: false, message: "Please fill in all required fields." });
    }

    // furniOnly=true means this role goes to Furni DB only — validate against furni enum
    const isFurniOnlySignup = furniOnly === true && FURNI_ONLY_ROLES.includes(role);

    if (!isFurniOnlySignup && !ALL_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role selected." });
    }

    // For superadmin, validate and normalize module selection
    let saModules = { crm: true, so: true, dms: true, furni: true }; // default: all 4
    if (role === "superadmin" && superadminModules && typeof superadminModules === "object") {
      saModules = {
        crm:   !!superadminModules.crm,
        so:    !!superadminModules.so,
        dms:   !!superadminModules.dms,
        furni: !!superadminModules.furni,
      };
      if (!saModules.crm && !saModules.so && !saModules.dms && !saModules.furni) {
        return res.status(400).json({ success: false, message: "Superadmin must have at least one module selected." });
      }
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check duplicate in UnifiedUser
    const existing = await UnifiedUser.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ success: false, message: "This email is already registered." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // dms flag:
    // salesperson + dms=false → CRM + SO
    // salesperson + dms=true  → SO + DMS
    // admin + dms=false       → CRM + SO (no DMS)
    // admin + dms=true        → SO + DMS (no CRM)
    const isDmsUser = (role === "salesperson" && dms === true) || (role === "admin" && dms === true);

    const isAllModuleRole = ALL_MODULE_ROLES.includes(role);
    // CRM: globaladmin, superadmin(crm), admin(dms=false), salesperson(dms=false)
    const isCRMRole = role === "globaladmin"
      || (role === "superadmin" && saModules.crm)
      || (role === "admin" && !isDmsUser)
      || (role === "salesperson" && !isDmsUser)
      || (CRM_ROLES.includes(role) && role !== "salesperson" && role !== "admin" && role !== "superadmin" && role !== "globaladmin");
    // SO: globaladmin, superadmin(so), admin(both), salesperson(both), SO-specific roles
    const isSORole  = role === "globaladmin"
      || (role === "superadmin" && saModules.so)
      || (role === "admin")
      || role === "salesperson"
      || SO_ROLES.includes(role);
    // DMS: globaladmin, superadmin(dms), admin(dms=true), salesperson(dms=true)
    const isDMSRole = role === "globaladmin"
      || (role === "superadmin" && saModules.dms)
      || isDmsUser;

    // Lazy-load models (connections already open at this point)
    const CRMUser = require("../crm/Schema/Model");
    const SOUser  = require("../so/Models/Model");
    const { getUser: getDMSUser }   = require("../dms/Schema/Model");
    const { getUser: getFurniUser } = require("../furni/Schema/Model");
    const DMSUser   = getDMSUser();
    const FurniUser = getFurniUser();

    let crmId   = null;
    let soId    = null;
    let dmsId   = null;
    let furniId = null;

    // CRM model enum: ["globaladmin", "superadmin", "admin", "salesperson"]
    const crmRoleMap = {};  // all roles pass through as-is

    // SO model enum: ["Watch","Production","salesperson","Installation","Finish",
    //                 "Accounts","admin","GlobalAdmin","Verification","Bill","ProductionApproval"]
    // "globaladmin" → "GlobalAdmin", "superadmin" → "GlobalAdmin" (SO has no superadmin)
    // "Admin" → "admin", "Sales" → "salesperson"
    const soRoleMap = { globaladmin: "GlobalAdmin", superadmin: "GlobalAdmin", Admin: "admin", Sales: "salesperson" };

    // DMS model enum: ["Globaladmin","Superadmin","Admin","salesperson"]
    const dmsRoleMap = { globaladmin: "Globaladmin", superadmin: "Superadmin", admin: "Admin", salesperson: "salesperson" };

    // Furni model enum: ["SuperAdmin","Admin","Sales","Production","Installation",
    //                    "Finish","Accounts","Verification","Bill","ProductionApproval"]
    // "globaladmin" → "SuperAdmin", "superadmin" → "SuperAdmin", "admin" → "Admin", "salesperson" → "salesperson"
    const furniRoleMap = { globaladmin: "GlobalAdmin", superadmin: "SuperAdmin", admin: "Admin", salesperson: "salesperson", Admin: "Admin", Sales: "salesperson" };

    // Is this a furni-only signup (furniOnly:true flag from frontend)?
    const isFurniOnlyRole = isFurniOnlySignup;

    // Determine if this role gets Furni access
    const isFurniRole = isFurniOnlyRole
      || (FURNI_ROLES.includes(role) && !isDmsUser && (role !== "superadmin" || saModules.furni));

    // Create in CRM collection
    if (isCRMRole && !isFurniOnlyRole) {
      const crmRole = crmRoleMap[role] || role;
      const crmUser = new CRMUser({ username, email: normalizedEmail, password: hashedPassword, role: crmRole, refreshTokens: [] });
      await crmUser.save();
      crmId = crmUser._id;
    }

    // Create in SO collection
    if (isSORole && !isFurniOnlyRole) {
      const soRole = soRoleMap[role] || role;
      const soUser = new SOUser({ username, email: normalizedEmail, password: hashedPassword, role: soRole });
      await soUser.save();
      soId = soUser._id;
    }

    // Create in DMS collection
    if (isDMSRole && !isFurniOnlyRole) {
      const dmsRole = dmsRoleMap[role] || "salesperson";
      const dmsUser = new DMSUser({ username, email: normalizedEmail, password: hashedPassword, role: dmsRole });
      await dmsUser.save();
      dmsId = dmsUser._id;
    }

    // Create in Furni collection
    if (isFurniRole) {
      // furniOnly roles: role value IS already the furni DB enum (Sales, Admin, SuperAdmin, etc.)
      // multi-module roles: map via furniRoleMap
      const furniRole = isFurniOnlyRole ? role : (furniRoleMap[role] || role);
      const furniUser = new FurniUser({ username, email: normalizedEmail, password: hashedPassword, role: furniRole });
      await furniUser.save();
      furniId = furniUser._id;
    }

    // Determine UnifiedUser _id and app_module
    // For furni-only roles: _id = furniId
    const unifiedId = crmId || soId || dmsId || furniId;

    let app_module;
    if (role === "globaladmin") {
      app_module = "crm+so+dms+furni";
    } else if (role === "superadmin") {
      // Build app_module from selected modules, preserving order: crm, so, dms, furni
      const parts = [];
      if (saModules.crm)   parts.push("crm");
      if (saModules.so)    parts.push("so");
      if (saModules.dms)   parts.push("dms");
      if (saModules.furni) parts.push("furni");
      app_module = parts.join("+");
    } else if (role === "admin") {
      app_module = dms === true ? "so+dms+furni" : "crm+so+furni";
    } else if (isDmsUser) {
      app_module = "so+dms+furni";
    } else if (isFurniOnlyRole) {
      app_module = "furni";
    } else if (isCRMRole && isSORole) {
      app_module = "crm+so+furni";
    } else if (isCRMRole) {
      app_module = "crm";
    } else if (isSORole) {
      app_module = "so+furni";
    } else {
      app_module = "crm";
    }

    const unifiedDoc = {
      _id: unifiedId,
      email: normalizedEmail,
      password: hashedPassword,
      username,
      // For furni-only users, store the actual furni role (e.g. "Sales", "SuperAdmin")
      // For all others, store the portal role (e.g. "salesperson", "globaladmin")
      role: isFurniOnlyRole ? role : role,
      dms: role === "superadmin" ? false : (isDmsUser || (role === "admin" && dms === true)),
      app_module,
      refreshTokens: [],
    };
    // Store secondary IDs so JWT can embed them for cross-module queries
    if (soId && crmId) unifiedDoc.soUserId = soId;
    if (dmsId && crmId) unifiedDoc.dmsUserId = dmsId;
    // For SO+DMS salesperson: _id = soId, dmsUserId = dmsId
    if (dmsId && !crmId && soId) unifiedDoc.dmsUserId = dmsId;
    // Furni user ID
    if (furniId) unifiedDoc.furniUserId = furniId;

    const newUnifiedUser = await UnifiedUser.create(unifiedDoc);

    // Issue tokens so user is logged in immediately after signup
    const accessToken  = generateAccessToken(newUnifiedUser);
    const refreshToken = generateRefreshToken(newUnifiedUser);
    newUnifiedUser.refreshTokens.push(refreshToken);
    await newUnifiedUser.save();

    res.cookie("unifiedRefreshToken", refreshToken, COOKIE_OPTIONS);

    const app_access   = getAppAccess(newUnifiedUser.role, newUnifiedUser.dms, newUnifiedUser.app_module);
    const redirectHint = getRedirectHint(newUnifiedUser.role, newUnifiedUser.dms, newUnifiedUser.app_module);

    return res.status(201).json({
      success: true,
      message: "Account created successfully.",
      accessToken,
      redirectHint,
      user: {
        id: newUnifiedUser._id.toString(),
        username: newUnifiedUser.username,
        email: newUnifiedUser.email,
        role: newUnifiedUser.role,
        dms: newUnifiedUser.dms,
        app_module: newUnifiedUser.app_module,
        app_access,
      },
    });
  } catch (err) {
    logger.error("Unified signup error", { error: err.message, stack: err.stack });

    // E11000 — duplicate key (email already exists in a module-level collection)
    if (err.code === 11000 || err.name === "MongoServerError") {
      return res.status(409).json({ success: false, message: "This email is already registered." });
    }

    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Please enter both email and password." });
    }

    const user = await UnifiedUser.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({ success: false, message: "No account found with this email." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Incorrect password. Please try again." });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Store refresh token — keep max 10, atomically
    user.refreshTokens = user.refreshTokens || [];
    user.refreshTokens = [...user.refreshTokens.slice(-9), refreshToken];
    await user.save();

    res.cookie("unifiedRefreshToken", refreshToken, COOKIE_OPTIONS);

    const app_access = getAppAccess(user.role, user.dms, user.app_module);
    const redirectHint = getRedirectHint(user.role, user.dms, user.app_module);

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      accessToken,
      redirectHint,
      user: {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        role: user.role,
        dms: user.dms || false,
        app_module: user.app_module,
        app_access,
      },
    });
  } catch (err) {
    logger.error("Unified login error", { error: err.message });
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
router.post("/refresh", async (req, res) => {
  const refreshToken = req.cookies?.unifiedRefreshToken;

  if (!refreshToken) {
    return res.status(401).json({ success: false, message: "No refresh token." });
  }

  try {
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
    const user = await UnifiedUser.findById(decoded.id);

    if (!user || !user.refreshTokens?.includes(refreshToken)) {
      res.clearCookie("unifiedRefreshToken", COOKIE_OPTIONS);
      return res.status(403).json({ success: false, message: "Invalid session." });
    }

    // Rotate token
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    // Rotate token — remove old, keep max 9 existing, add new = max 10 total
    user.refreshTokens = [
      ...user.refreshTokens.filter((t) => t !== refreshToken).slice(-9),
      newRefreshToken,
    ];
    await user.save();

    res.cookie("unifiedRefreshToken", newRefreshToken, COOKIE_OPTIONS);

    const app_access = getAppAccess(user.role, user.dms, user.app_module);

    return res.status(200).json({
      success: true,
      accessToken: newAccessToken,
      user: {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        role: user.role,
        dms: user.dms || false,
        app_module: user.app_module,
        app_access,
      },
    });
  } catch (err) {
    res.clearCookie("unifiedRefreshToken", COOKIE_OPTIONS);
    return res.status(403).json({ success: false, message: "Session expired." });
  }
});

// ── POST /api/auth/change-password ───────────────────────────────────────────
// Updates UnifiedUser + every connected module collection atomically.
// Requires a valid unified portal JWT in Authorization header.
const unifiedAuth = require("../middleware/unifiedAuth");

router.post("/change-password", unifiedAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id; // CRM _id (UnifiedUser._id)

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: "All fields are required." });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ success: false, message: "New password must be different from current password." });
  }

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  if (!passwordRegex.test(newPassword)) {
    return res.status(400).json({
      success: false,
      message: "New password must be at least 8 characters, include uppercase, lowercase, number, and special character.",
    });
  }

  try {
    const unifiedUser = await UnifiedUser.findById(userId);
    if (!unifiedUser) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const isMatch = await bcrypt.compare(currentPassword, unifiedUser.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Current password is incorrect." });
    }

    const hashedNew = await bcrypt.hash(newPassword, 10);

    // 1. Update UnifiedUser (source of truth for login)
    unifiedUser.password = hashedNew;
    await unifiedUser.save();

    // 2. Update all connected module collections in parallel
    const CRMUser = require("../crm/Schema/Model");
    const SOUser  = require("../so/Models/Model");
    const { getUser: getDMSUser }   = require("../dms/Schema/Model");
    const { getUser: getFurniUser } = require("../furni/Schema/Model");
    const DMSUser   = getDMSUser();
    const FurniUser = getFurniUser();

    const updates = [];
    const email = unifiedUser.email;

    // CRM collection — find by email (CRM _id === UnifiedUser._id for CRM users)
    updates.push(
      CRMUser.findOneAndUpdate({ email }, { password: hashedNew }).catch(() => null)
    );
    // SO collection — find by email
    updates.push(
      SOUser.findOneAndUpdate({ email }, { password: hashedNew }).catch(() => null)
    );
    // DMS collection — find by email
    updates.push(
      DMSUser.findOneAndUpdate({ email }, { password: hashedNew }).catch(() => null)
    );
    // Furni collection — find by email
    updates.push(
      FurniUser.findOneAndUpdate({ email }, { password: hashedNew }).catch(() => null)
    );

    await Promise.all(updates);

    // Invalidate all refresh tokens so all sessions are logged out
    unifiedUser.refreshTokens = [];
    await unifiedUser.save();

    logger.info("Unified change-password: success", { userId, email });

    return res.status(200).json({ success: true, message: "Password changed successfully." });
  } catch (err) {
    logger.error("Unified change-password error", { error: err.message, userId });
    return res.status(500).json({ success: false, message: "An error occurred while changing password." });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post("/logout", async (req, res) => {
  const refreshToken = req.cookies?.unifiedRefreshToken;

  if (refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
      const user = await UnifiedUser.findById(decoded.id);
      if (user) {
        user.refreshTokens = (user.refreshTokens || []).filter((t) => t !== refreshToken);
        await user.save();
      }
    } catch (_) {
      // Token already invalid — still clear cookie
    }
  }

  res.clearCookie("unifiedRefreshToken", { ...COOKIE_OPTIONS, maxAge: 0 });
  return res.status(200).json({ success: true, message: "Logged out." });
});

module.exports = router;
