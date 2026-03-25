/**
 * Singleton connection accessors.
 * connectAll() must be called before any model file is required.
 * These getters are called at model-require time, so connections must
 * already be established by then.
 */
const { connectAuth, connectCRM, connectSO, connectDMS, connectFurni } = require("./dbconnect");

let _auth = null;
let _crm  = null;
let _so   = null;
let _dms  = null;
let _furni = null;

const getAuthConnection = () => {
  if (!_auth) throw new Error("Auth DB connection not yet initialized. Call initConnections() first.");
  return _auth;
};

const getCRMConnection = () => {
  if (!_crm) throw new Error("CRM DB connection not yet initialized. Call initConnections() first.");
  return _crm;
};

const getSOConnection = () => {
  if (!_so) throw new Error("SO DB connection not yet initialized. Call initConnections() first.");
  return _so;
};

const getDMSConnection = () => {
  if (!_dms) throw new Error("DMS DB connection not yet initialized. Call initConnections() first.");
  return _dms;
};

const getFurniConnection = () => {
  if (!_furni) throw new Error("Furni DB connection not yet initialized. Call initConnections() first.");
  return _furni;
};

const initConnections = async () => {
  _auth  = await connectAuth();
  _crm   = await connectCRM();
  _so    = await connectSO();
  _dms   = await connectDMS();
  _furni = await connectFurni();
};

module.exports = { getAuthConnection, getCRMConnection, getSOConnection, getDMSConnection, getFurniConnection, initConnections };
