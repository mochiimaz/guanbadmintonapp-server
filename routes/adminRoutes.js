const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");

// สร้าง Event ใหม่
router.post("/events", adminController.createEvent);

// ดึงข้อมูลกิจกรรมทั้งหมดที่สร้าง
router.get("/manage-date-events", adminController.getAllEvents);

// ลบกิจกรรมตาม id_event ที่สร้างกิจกรรมไว้
router.delete("/events/:id_event", adminController.deleteEvent);

// โหลดค่าสถานะหลังเปลี่ยนการใช้งาน การชำระเงิน ของผู้เล่นแต่ละคน
router.get("/get-user-status", adminController.getUserStatus);

// อัปเดตสถานะห้องกิจกรรม และราคาสนาม
router.patch(
  "/setting-room-price-status",
  adminController.updateRoomStatusAndCost
);

// โหลดค่าเดิมของ สถานะห้องกิจกรรม และราคาสนาม
router.get("/get-event-settings", adminController.getRoomStatusAndCost);

module.exports = router;
