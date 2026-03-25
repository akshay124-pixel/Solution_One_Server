const nodemailer = require("nodemailer");
const path = require("path");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Images folder is inside unified-portal/server/dms/Images/
const IMAGES_DIR = path.join(__dirname, "../Images");

async function sendMail(to, subject, text, html) {
  try {
    await transporter.sendMail({
      from: '"Promark Tech Solutions" <salesorderweb@gmail.com>',
      to,
      subject,
      text,
      html,
      attachments: [
        {
          filename: "Promark Techsolutions Pvt Ltd.jpeg",
          path: path.join(IMAGES_DIR, "Promark Techsolutions Pvt Ltd.jpeg"),
          cid: "middle-image",
        },
      ],
    });
    console.log(`DMS email sent to ${to}`);
  } catch (error) {
    console.error("DMS mailer error:", error);
    throw error;
  }
}

module.exports = { sendMail };
