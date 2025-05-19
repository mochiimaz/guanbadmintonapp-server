const express = require("express");
const router = express.Router();
const participantController = require("../controllers/participantController");

// ดึงข้อมูลผู้เข้าร่วมที่รออนุมัติพร้อมรายละเอียดกิจกรรม
router.get(
  "/participants/pending",
  participantController.getPendingParticipants
);

// เปลี่ยนสถานะเป็น approved / rejected
router.patch(
  "/participants/:id/status",
  participantController.updateParticipantStatus
);

// อนุมัติและเพิ่มรายการ payment
router.patch(
  "/participants/:id/approve",
  participantController.approveParticipant
);

// สำหรับปฏิเสธคำขอ
router.patch(
  "/participants/:id/reject",
  participantController.rejectJoinRequest
);

// ลบผู้เล่นที่ได้เข้าร่วมกิจกรรมแล้วในภายหลัง แต่ละ users เลือกภายใน event
router.delete(
  "/admin-cancel-event-select/:id_join",
  participantController.cancelApprovedUser
);

// เปลี่ยนสถานะการใช้งานออนไลน์ ออฟไลน์ การชำระเงิน ของผู้เล่นแต่ละคน
router.patch(
  "/switch-for-changed-status",
  participantController.switchUserStatusAndPayment
);

module.exports = router;
