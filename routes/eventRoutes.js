const express = require("express");
const router = express.Router();
const eventController = require("../controllers/eventController");

// สำหรับดึงเวลา และสถานที่ ของวันที่ที่เลือก เพื่อตรวจสอบข้อมูล
router.get("/events", eventController.getEventsByDate);

// ตรวจสอบสถานะการเข้าร่วมและสร้างคำขอใหม่หากจำเป็น
// ผู้ใช้กดปุ่มยืนยันเข้าร่วมกิจกรรม
router.post(
  "/participants/validate-and-join",
  eventController.validateAndJoinEvent
);

// ดึงข้อมูลที่กำลังรออนุมัติจากแอดมินของผู้ใช้ตาม userId
router.get(
  "/pending-requests/:userId",
  eventController.getPendingRequestsByUser
);

// ดึงข้อมูลที่อนุมัติแล้วจากแอดมินของผู้ใช้ตาม userId
router.get(
  "/approved-requests/:userId",
  eventController.getApprovedRequestsByUser
);

// ยกเลิกคำขอเข้าร่วมตาม id_join ที่ userId เลือก
router.delete(
  "/cancel-pending/:id_join",
  eventController.cancelPendingJoinRequest
);

// ดึงรายชื่อผู้เข้าร่วมกิจกรรมตาม id_event พร้อมรายละเอียด
router.get(
  "/users-approved-in-event/:eventId",
  eventController.getApprovedUsersInEvent
);

// ยกเลิกเข้าร่วมกิจกรรมที่เข้าร่วมแล้วของ users เลือก events
router.delete(
  "/user-cancel-event-select/:id_join",
  eventController.cancelApprovedEvent
);

module.exports = router;
