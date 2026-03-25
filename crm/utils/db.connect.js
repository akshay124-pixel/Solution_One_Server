const mongoose = require("mongoose");
const logger = require("./logger");

URI = process.env.DB_URL;

const dbconnect = async () => {
  try {
    await mongoose.connect(URI);
    logger.info("Connected to MongoDB");
  } catch (error) {
    logger.error("Error connecting to MongoDB", error);
  }
};
module.exports = dbconnect;
