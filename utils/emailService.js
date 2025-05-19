require("dotenv").config();
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

exports.sendOtpEmail = (email, otp) => {
  const mailOptions = {
    from: "guanbmt.dev@gmail.com",
    to: email,
    subject: "OTP สำหรับการรีเซ็ตรหัสผ่าน",
    text: `รหัส OTP ของคุณคือ: ${otp}`,
  };

  return transporter.sendMail(mailOptions);
};
