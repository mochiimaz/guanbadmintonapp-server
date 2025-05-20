const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const authenticateToken = require("../middlewares/authenticateToken");
const multer = require("multer");

const upload = multer({ dest: "uploads/" });

// อัปเดตรูปโปรไฟล์ของผู้ใช้
router.post(
  "/updateProfile/:userId",
  authenticateToken,
  upload.single("profile"),
  userController.updateProfile
);

// ดึงข้อมูลโปรไฟล์ผู้ใช้ user id
router.post(
  "/getUserProfile",
  authenticateToken,
  userController.getUserProfile
);

// อัพเดทข้อมูลโปรไฟล์ส่วนตัว ไม่รวมรูป
router.post(
  "/updateUserProfile",
  authenticateToken,
  userController.updateUserProfile
);

// ดึงข้อมูลของผู้ใช้คนอื่น ๆ พร้อมกับระดับความชอบที่เคยตั้งไว้ (ถ้ามี)
router.get(
  "/all-users-with-likes/:user_id",
  userController.getAllUsersWithLikes
);

// อัปเดตระดับความชอบของผู้ใช้
router.patch(
  "/user_likes/:user_id/:liked_user_id",
  userController.updateUserLikeRating
);

// ข้อมูลโปรไฟล์ผู้ใช้งานคนอื่นที่กดเข้าไปดูโปรไฟล์ พร้อมระดับดาวที่ผู้ใช้ล็อกอินให้ไว้
router.get(
  "/view-profile-othersperson/:id",
  userController.viewOtherUserProfile
);

module.exports = router;
