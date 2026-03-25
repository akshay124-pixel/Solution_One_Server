const mongoose = require("mongoose");
const logger = require("./logger");

const URI = process.env.DB_URL;
const dbconnect = async () => {
  try {
    await mongoose.connect(URI);
    logger.info("Database connected");
  } catch (error) {
    logger.error("Error connecting to database:", { error: error.message });
  }
};

module.exports = dbconnect;
