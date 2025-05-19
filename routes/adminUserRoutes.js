const express = require("express");
const router = express.Router();
const adminUserController = require("../controllers/adminUserController");

// ดึงข้อมูลผู้ใช้ทั้งหมด
router.get("/admin/users", adminUserController.getAllUsers);

// ลบผู้ใช้ตาม ID
router.delete("/admin/users/:id", adminUserController.deleteUserById);

// แก้ไข rank_play ของผู้ใช้
router.put("/admin/users/:id", adminUserController.updateUserRank);

module.exports = router;
