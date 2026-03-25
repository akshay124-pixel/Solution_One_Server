/**
 * Furni mailer — nodemailer transport for order notification emails.
 * Credentials read from environment variables (never hardcoded).
 */
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.FURNI_EMAIL_USER || process.env.EMAIL_USER,
    pass: process.env.FURNI_EMAIL_PASS || process.env.EMAIL_PASS,
  },
});

async function sendMail(to, subject, text, html) {
  const from = process.env.FURNI_EMAIL_USER || process.env.EMAIL_USER;
  await transporter.sendMail({
    from: `"Promark Tech Solutions" <${from}>`,
    to,
    subject,
    text,
    html,
  });
}

module.exports = { sendMail };
