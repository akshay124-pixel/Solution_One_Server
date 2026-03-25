const mongoose = require("mongoose");
const logger = require("./logger");

// Four separate connections — Auth, CRM, SO, and DMS live in different databases
// on the same Atlas cluster. Separate connections prevent Mongoose
// model name collisions (all apps have a "User" and "Entry" model).

let authConnection = null;
let crmConnection  = null;
let soConnection   = null;
let dmsConnection  = null;

const connectAuth = async () => {
  if (authConnection) return authConnection;
  const uri = process.env.AUTH_DB_URI;
  if (!uri) throw new Error("AUTH_DB_URI is not defined in environment variables.");
  authConnection = await mongoose.createConnection(uri).asPromise();
  logger.info("Auth database connected (Auth_Data)");
  return authConnection;
};

const connectCRM = async () => {
  if (crmConnection) return crmConnection;
  crmConnection = await mongoose.createConnection(process.env.CRM_DB_URL).asPromise();
  logger.info("CRM database connected");
  return crmConnection;
};

const connectSO = async () => {
  if (soConnection) return soConnection;
  soConnection = await mongoose.createConnection(process.env.SO_DB_URL).asPromise();
  logger.info("SO database connected");
  return soConnection;
};

const connectDMS = async () => {
  if (dmsConnection) return dmsConnection;
  dmsConnection = await mongoose.createConnection(process.env.DMS_DB_URL).asPromise();
  logger.info("DMS database connected");
  return dmsConnection;
};

let furniConnection = null;

const connectFurni = async () => {
  if (furniConnection) return furniConnection;
  furniConnection = await mongoose.createConnection(process.env.FURNI_DB_URL).asPromise();
  logger.info("Furni database connected");
  return furniConnection;
};

const connectAll = async () => {
  await Promise.all([connectAuth(), connectCRM(), connectSO(), connectDMS(), connectFurni()]);
};

module.exports = { connectAuth, connectCRM, connectSO, connectDMS, connectFurni, connectAll };
