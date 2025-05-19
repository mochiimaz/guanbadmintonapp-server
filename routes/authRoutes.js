const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

// ไม่ต้องใช้ middleware ตรวจ token ใน login หรือ authen แล้ว
router.post("/login", authController.login);
router.post("/authen", authController.authen);
router.post("/register", authController.register);
router.post("/send-otp", authController.sendOtp);
router.post("/reset-password", authController.resetPassword);

module.exports = router;
