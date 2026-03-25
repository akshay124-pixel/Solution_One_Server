const NodeCache = require("node-cache");

const cache = new NodeCache({
  stdTTL: 60,
  checkperiod: 30,
  useClones: false,
  deleteOnExpire: true,
  maxKeys: 10000,
});

module.exports = cache;
