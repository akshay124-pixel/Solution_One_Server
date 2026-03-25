/**
 * Unified Portal — Express Entry Point
 *
 * Route prefixes:
 *   /api/auth/*   → unified portal auth (login, refresh, logout)
 *   /api/crm/*    → all CRM backend routes (unchanged logic)
 *   /api/so/*     → all SO backend routes (unchanged logic)
 *
 * Two separate MongoDB connections are maintained to prevent
 * model name collisions between CRM and SO databases
 */
require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");

const logger = require("./utils/logger");
const { initConnections } = require("./utils/connections");
const { validateEnv } = require("./utils/validateEnv");

// All route files are required INSIDE bootstrap() after DB connections are ready.
// This prevents model files from calling getCRMConnection() before it is initialized.

const app = express();
const server = http.createServer(app);

const PORT = process.env.UNIFIED_SERVER_PORT || 5050;

const allowedOrigins = [
  process.env.UNIFIED_CLIENT_URL || "http://localhost:3000",
];

// ── Middleware ────────────────────────────────────────────────────────────────
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
  credentials: true,
}));
app.use(mongoSanitize());
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// ── Static uploads ────────────────────────────────────────────────────────────
// CRM uploads — served at /crm/Uploads (CRM download route handles auth)
app.use("/crm/Uploads", express.static(path.join(__dirname, "crm/Uploads")));
// SO uploads — served at both /so/Uploads and /api/so/Uploads
// because SO components build URLs as: REACT_APP_SO_URL + /Uploads/filename
// = http://localhost:5050/api/so/Uploads/filename
app.use("/so/Uploads", express.static(path.join(__dirname, "so/Uploads")));
app.use("/api/so/Uploads", express.static(path.join(__dirname, "so/Uploads")));
// DMS uploads
app.use("/dms/Uploads", express.static(path.join(__dirname, "dms/Uploads")));
app.use("/api/dms/Uploads", express.static(path.join(__dirname, "dms/Uploads")));
// Furni uploads
app.use("/furni/Uploads", express.static(path.join(__dirname, "furni/Uploads")));
app.use("/api/furni/Uploads", express.static(path.join(__dirname, "furni/Uploads")));

// ── Bootstrap: connect DBs, then mount all routes ────────────────────────────
const bootstrap = async () => {
  try {
    validateEnv();
    await initConnections();
    logger.info("All database connections established (Auth, CRM, SO, DMS)");

    // Require ALL routes AFTER connections are ready so model files
    // can call getCRMConnection() / getSOConnection() safely.
    const authRoutes      = require("./routes/authRoutes");
    const crmDataRoute    = require("./crm/Router/DataRouter");
    const soRoutes        = require("./so/Router/Routes");

    // ── Unified auth (single source of truth) ────────────────────────────────
    app.use("/api/auth", authRoutes);

    // ── Legacy auth route stubs — return 410 Gone ─────────────────────────────
    // These routes are disabled. All auth must go through /api/auth/*
    const legacyAuthHandler = (req, res) => {
      logger.warn(`[LEGACY AUTH] Blocked request to deprecated route: ${req.method} ${req.originalUrl}`);
      return res.status(410).json({
        success: false,
        message: "This authentication endpoint has been removed. Please use /api/auth/* instead.",
        redirectTo: "/api/auth/login",
      });
    };
    app.post("/api/crm/auth/login",       legacyAuthHandler);
    app.post("/api/crm/auth/change-password", legacyAuthHandler);
    app.get("/api/crm/auth/verify-token", legacyAuthHandler);
    app.post("/api/crm/user/signup",      legacyAuthHandler);
    app.post("/api/crm/auth/refresh",     legacyAuthHandler);
    app.post("/api/crm/auth/logout",      legacyAuthHandler);
    app.post("/api/so/auth/login",        legacyAuthHandler);
    app.post("/api/so/auth/change-password", legacyAuthHandler);
    app.get("/api/so/auth/verify-token",  legacyAuthHandler);
    app.post("/api/so/user/signup",       legacyAuthHandler);

    // ── CRM data routes (protected by unified JWT via crm/utils/config jwt.js) ─
    app.use("/api/crm/api",   crmDataRoute);

    // ── SO data routes (protected by unified JWT via so/utils/config jwt.js) ──
    app.use("/api/so/api",    soRoutes);

    // Mount DMS routes under /api/dms prefix
    const dmsDataRoute            = require("./dms/Router/DataRouter");
    const dmsDialerRoute          = require("./dms/Router/SmartfloDialerRouter");
    const dmsAdminRoute           = require("./dms/Router/SmartfloAdminRouter");
    const dmsWebhookRoute         = require("./dms/Router/SmartfloWebhookRouter");
    const dmsAnalyticsRoute       = require("./dms/Router/SmartfloAnalyticsRouter");
    const dmsCallHistoryRoute     = require("./dms/Router/SmartfloCallHistoryRouter");
    const dmsRecordingRoute       = require("./dms/Router/SmartfloRecordingRouter");
    const dmsActiveCallsRoute     = require("./dms/Router/SmartfloActiveCallsRouter");

    app.use("/api/dms/api",                    dmsDataRoute);
    app.use("/api/dms/dialer",                 dmsDialerRoute);
    app.use("/api/dms/admin/smartflo",         dmsAdminRoute);
    app.use("/api/dms/webhooks/smartflo",      dmsWebhookRoute);
    app.use("/api/dms/analytics",              dmsAnalyticsRoute);
    app.use("/api/dms/calls",                  dmsCallHistoryRoute);
    app.use("/api/dms/recordings",             dmsRecordingRoute);
    app.use("/api/dms/active-calls",           dmsActiveCallsRoute);

    // Mount Furni routes under /api/furni prefix
    const furniDataRoute = require("./furni/Router/DataRouter");
    app.use("/api/furni/api", furniDataRoute);

    // ── Socket.IO ─────────────────────────────────────────────────────────────
    // CRM socket (path: /crm/socket.io — unchanged from original)
    const { verifyToken: crmVerifyToken } = require("./crm/utils/config jwt");
    const { checkDateNotifications } = require("./crm/Controller/DataLogic");
    const schedule = require("node-schedule");

    const crmIo = new Server(server, {
      cors: { origin: allowedOrigins, methods: ["GET", "POST"], credentials: true },
      path: "/crm/socket.io",
    });

    crmIo.use((socket, next) => {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error("Authentication error: No token"));
      try {
        const decoded = crmVerifyToken(token.replace("Bearer ", ""), next);
        if (!decoded?.id) throw new Error("Invalid token payload");
        socket.user = decoded;
        next();
      } catch (err) {
        next(new Error(`Authentication error: ${err.message}`));
      }
    });

    crmIo.on("connection", (socket) => {
      socket.join(socket.user.id.toString());
      socket.on("disconnect", () => {});
    });

    app.set("io", crmIo);

    schedule.scheduleJob("30 18 * * *", async () => {
      try {
        await checkDateNotifications(crmIo);
      } catch (err) {
        logger.error("CRM scheduled job failed", { error: err.message });
      }
    });

    // SO socket (path: /sales/socket.io — unchanged from original)
    const soController = require("./so/Controller/Logic");
    soController.initSocket(server, app);

    // Furni socket (path: /furni/socket.io)
    const furniController = require("./furni/Controller/DataLogic");
    furniController.initSocket(server, app);

    // ── Start server ──────────────────────────────────────────────────────────
    server.listen(PORT, () => {
      logger.info(`Unified portal server running on port ${PORT}`);
    });

  } catch (err) {
    logger.error("Bootstrap failed", { error: err.message });
    process.exit(1);
  }
};

bootstrap();
