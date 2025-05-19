const connection = require("../config/db");

// ดึงข้อมูลผู้เข้าร่วมที่รออนุมัติ
exports.getPendingParticipants = (req, res) => {
  const query = `
    SELECT
      epj.id_join,
      COALESCE(u.images_user, '') AS images_user,
      u.id AS user_id,
      u.sname AS user_name,
      u.phone,
      u.rank_play,
      ea.event_date,
      ea.event_start_time,
      ea.event_location,
      epj.created_at
    FROM event_participants_join epj
    JOIN users u ON epj.users_id = u.id
    JOIN events_admin ea ON epj.event_id = ea.id_event
    WHERE epj.status = 'pending'
    ORDER BY epj.id_join ASC;
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching participants:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json(results);
  });
};

// เปลี่ยนสถานะเป็น approved / rejected
exports.updateParticipantStatus = (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const query = `
    UPDATE event_participants_join
    SET status = ?
    WHERE id_join = ?
  `;

  connection.query(query, [status, id], (err) => {
    if (err) {
      console.error("Error updating status:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: "Status updated successfully" });
  });
};

// อนุมัติและเพิ่มรายการ payment
exports.approveParticipant = (req, res) => {
  const { id } = req.params;

  const queryGetUserAndEvent = `
    SELECT epj.users_id, epj.event_id
    FROM event_participants_join epj
    WHERE epj.id_join = ?
  `;

  connection.query(queryGetUserAndEvent, [id], (err, result) => {
    if (err || result.length === 0) {
      console.error("Error fetching user and event:", err);
      return res.status(500).json({ message: "ไม่พบคำขอหรือเกิดข้อผิดพลาด" });
    }

    const { users_id, event_id } = result[0];

    const queryUpdateStatus = `
      UPDATE event_participants_join
      SET status = 'approved'
      WHERE id_join = ?
    `;

    connection.query(queryUpdateStatus, [id], (err) => {
      if (err) return res.status(500).json({ message: "อัปเดตสถานะไม่สำเร็จ" });

      const queryAddParticipant = `
        UPDATE events_admin
        SET participants =
          IF(participants IS NULL OR participants = '', ?, CONCAT(participants, ',', ?))
        WHERE id_event = ?
      `;

      connection.query(
        queryAddParticipant,
        [users_id, users_id, event_id],
        (err) => {
          if (err)
            return res
              .status(500)
              .json({ message: "เพิ่มชื่อใน participants ไม่สำเร็จ" });

          const queryInsertPayment = `
          INSERT INTO payments (user_id, event_id, amount, payment_method, status, created_at)
          VALUES (?, ?, 0, 'cash', 'pending', NOW())
        `;

          connection.query(queryInsertPayment, [users_id, event_id], (err) => {
            if (err) {
              console.error("Error creating payment record:", err);
              return res
                .status(500)
                .json({ message: "เพิ่มข้อมูลการชำระเงินไม่สำเร็จ" });
            }

            res.json({ message: "อนุมัติคำขอและเพิ่ม payment เรียบร้อยแล้ว" });
          });
        }
      );
    });
  });
};

// สำหรับปฏิเสธคำขอ
exports.rejectJoinRequest = (req, res) => {
  const { id } = req.params;
  const queryUpdateStatus = `
      UPDATE event_participants_join
      SET status = 'rejected'
      WHERE id_join = ?
    `;

  connection.query(queryUpdateStatus, [id], (err) => {
    if (err) {
      console.error("Error updating status:", err);
      return res.status(500).json({ error: "Failed to update status" });
    }
    res.json({ message: "Request rejected successfully" });
  });
};

// ลบผู้เล่นที่ได้เข้าร่วมกิจกรรมแล้วในภายหลัง แต่ละ users เลือกภายใน event
exports.cancelApprovedUser = (req, res) => {
  const { id_join } = req.params;
  const querySelect = `
      SELECT event_id, users_id FROM event_participants_join WHERE id_join = ?
    `;

  connection.query(querySelect, [id_join], (err, results) => {
    if (err || results.length === 0) {
      return res
        .status(500)
        .json({ message: "ไม่พบหรือดึงข้อมูลกิจกรรมล้มเหลว" });
    }

    const { event_id, users_id } = results[0];
    const queryUpdateParticipants = `
        UPDATE events_admin
        SET participants = TRIM(BOTH ',' FROM REPLACE(CONCAT(',', participants, ','), CONCAT(',', ?, ','), ','))
        WHERE id_event = ?
      `;

    connection.query(queryUpdateParticipants, [users_id, event_id], (err) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "เกิดข้อผิดพลาดในการอัปเดต participants" });
      }

      const queryDeleteRequest = `
          DELETE FROM event_participants_join WHERE id_join = ?
        `;

      connection.query(queryDeleteRequest, [id_join], (err) => {
        if (err) {
          return res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบคำขอ" });
        }

        res.status(200).json({ message: "คำขอเข้าร่วมถูกยกเลิกเรียบร้อยแล้ว" });
      });
    });
  });
};

// เปลี่ยนสถานะการใช้งานออนไลน์ ออฟไลน์ การชำระเงิน ของผู้เล่นแต่ละคน
exports.switchUserStatusAndPayment = async (req, res) => {
  const { user_id, event_id, status_real_join, payment_status } = req.body;

  if (!user_id || !event_id) {
    return res
      .status(400)
      .json({ success: false, message: "กรุณาระบุ user_id และ event_id" });
  }

  const conn = connection.promise();
  try {
    await conn.beginTransaction();

    const checkUserQuery = `
        SELECT epj.status_real_join, COALESCE(p.status, 'pending') AS payment_status
        FROM event_participants_join epj
        LEFT JOIN payments p ON epj.users_id = p.user_id AND epj.event_id = p.event_id
        WHERE epj.users_id = ? AND epj.event_id = ?
      `;

    const [userRow] = await conn.query(checkUserQuery, [user_id, event_id]);
    if (!userRow.length) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลสมาชิกในกิจกรรมนี้" });
    }

    let currentStatus = userRow[0].status_real_join;
    let currentPaymentStatus = userRow[0].payment_status;
    let forcedStatus = currentStatus;

    if (payment_status === "completed" && currentStatus === "online") {
      forcedStatus = "offline";
      await conn.query(
        `UPDATE event_participants_join SET status_real_join = 'offline' WHERE users_id = ? AND event_id = ?`,
        [user_id, event_id]
      );
    }

    if (status_real_join !== undefined) {
      await conn.query(
        `UPDATE event_participants_join SET status_real_join = ? WHERE users_id = ? AND event_id = ?`,
        [status_real_join, user_id, event_id]
      );
    }

    if (payment_status !== undefined) {
      await conn.query(
        `UPDATE payments SET status = ? WHERE user_id = ? AND event_id = ?`,
        [payment_status, user_id, event_id]
      );
    }

    await conn.commit();
    res.json({
      success: true,
      message: "สถานะอัปเดตเรียบร้อยแล้ว",
      updated_status: {
        status_real_join: forcedStatus || currentStatus,
        payment_status: payment_status || currentPaymentStatus,
      },
    });
  } catch (error) {
    await conn.rollback();
    console.error("Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการอัปเดตสถานะ" });
  }
};
