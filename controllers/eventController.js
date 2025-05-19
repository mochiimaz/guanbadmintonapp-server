const connection = require("../config/db");

// สำหรับดึงเวลา และสถานที่ ของวันที่ที่เลือก เพื่อตรวจสอบข้อมูล
exports.getEventsByDate = (req, res) => {
  const { date } = req.query;
  const sql = `
    SELECT event_start_time, event_location 
    FROM events_admin 
    WHERE event_date = ?
  `;

  connection.query(sql, [date], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const events = results.map((row) => ({
      startTime: row.event_start_time,
      location: row.event_location,
    }));

    res.json({ events: events.length ? events : [] });
  });
};

// ตรวจสอบสถานะการเข้าร่วมและสร้างคำขอใหม่หากจำเป็น
// ผู้ใช้กดปุ่มยืนยันเข้าร่วมกิจกรรม
exports.validateAndJoinEvent = (req, res) => {
  const { date, startTime, location, user_id } = req.body;

  const queryCheckEvent = `
    SELECT id_event
    FROM events_admin
    WHERE event_date = ? AND event_start_time = ? AND event_location = ?
  `;

  connection.query(
    queryCheckEvent,
    [date, startTime, location],
    (err, eventResults) => {
      if (err) {
        console.error("Error checking event:", err);
        return res.status(500).json({ error: "Internal Server Error" });
      }

      if (eventResults.length === 0) {
        return res
          .status(404)
          .json({ message: "ไม่พบกิจกรรมที่ตรงกับเวลาที่เลือก" });
      }

      const eventId = eventResults[0].id_event;

      const queryCheckStatus = `
      SELECT status
      FROM event_participants_join
      WHERE event_id = ? AND users_id = ?
    `;

      connection.query(
        queryCheckStatus,
        [eventId, user_id],
        (err, statusResults) => {
          if (err) {
            console.error("Error checking status:", err);
            return res.status(500).json({ error: "Internal Server Error" });
          }

          if (statusResults.length > 0) {
            const { status } = statusResults[0];
            if (status === "pending") {
              return res
                .status(400)
                .json({ message: "คุณอยู่ในระหว่างรออนุมัติคำขอ" });
            } else if (status === "approved") {
              return res
                .status(400)
                .json({ message: "คุณได้รับการเข้าร่วมกิจกรรมนี้แล้ว" });
            }
          }

          const queryJoinEvent = `
        INSERT INTO event_participants_join (event_id, users_id, status, created_at)
        VALUES (?, ?, 'pending', NOW())
      `;

          connection.query(queryJoinEvent, [eventId, user_id], (err) => {
            if (err) {
              console.error("Error joining event:", err);
              return res.status(500).json({ error: "Failed to join event" });
            }

            res.status(201).json({
              message: "คุณได้ส่งคำขอเข้าร่วมเรียบร้อยแล้ว",
              created_at: new Date().toISOString(),
            });
          });
        }
      );
    }
  );
};

// ดึงข้อมูลที่กำลังรออนุมัติจากแอดมินของผู้ใช้ตาม userId
exports.getPendingRequestsByUser = (req, res) => {
  const userId = req.params.userId;

  const query = `
      SELECT epj.id_join, ea.event_date, ea.event_start_time, epj.status, epj.created_at, ea.event_location
      FROM event_participants_join AS epj
      INNER JOIN events_admin AS ea ON epj.event_id = ea.id_event
      WHERE epj.users_id = ? AND epj.status = 'pending'
      ORDER BY epj.created_at DESC
    `;

  connection.query(query, [userId], (error, results) => {
    if (error) {
      console.error("Error fetching pending requests:", error);
      return res.status(500).json({ error: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
    }
    res.json({ pendingRequests: results });
  });
};

// ดึงข้อมูลที่อนุมัติแล้วจากแอดมินของผู้ใช้ตาม userId
exports.getApprovedRequestsByUser = (req, res) => {
  const userId = req.params.userId;

  const query = `
      SELECT epj.id_join, ea.id_event, ea.event_date, ea.event_start_time, epj.status, epj.created_at, ea.event_location, ea.event_status
      FROM event_participants_join AS epj
      INNER JOIN events_admin AS ea ON epj.event_id = ea.id_event
      WHERE epj.users_id = ? AND epj.status = 'approved'
      ORDER BY epj.created_at DESC
    `;

  connection.query(query, [userId], (error, results) => {
    if (error) {
      console.error("Error fetching approved requests:", error);
      return res.status(500).json({ error: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
    }
    res.json({ approvedRequests: results });
  });
};

// ยกเลิกคำขอเข้าร่วมตาม id_join ที่ userId เลือก
exports.cancelPendingJoinRequest = (req, res) => {
  const { id_join } = req.params;

  const deleteQuery = `DELETE FROM event_participants_join WHERE id_join = ?`;

  connection.query(deleteQuery, [id_join], (error, results) => {
    if (error) {
      console.error("Error deleting join request:", error);
      return res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบคำขอ" });
    }

    res.json({ message: "คำขอเข้าร่วมกิจกรรมถูกยกเลิกเรียบร้อยแล้ว" });
  });
};

// ดึงรายชื่อผู้เข้าร่วมกิจกรรมตาม id_event พร้อมรายละเอียด
exports.getApprovedUsersInEvent = (req, res) => {
  const { eventId } = req.params;
  const { user_id } = req.query;

  const query = `
    SELECT
      epj.id_join,
      epj.event_id,
      u.id AS user_id,
      u.sname AS user_name,
      u.rank_play,
      u.sex,
      u.images_user,
      epj.status_real_join,
      COALESCE(ul.rating, 0) AS rating
    FROM event_participants_join epj
    JOIN users u ON epj.users_id = u.id
    LEFT JOIN user_likes ul ON ul.liked_user_id = u.id AND ul.user_id = ?
    WHERE epj.event_id = ?
      AND epj.status = 'approved'
      AND u.id != ?
      AND (u.status_login IS NULL OR u.status_login != 'admin')
    ORDER BY u.sname ASC
  `;

  connection.query(query, [user_id, eventId, user_id], (err, results) => {
    if (err) {
      console.error("Error fetching approved users:", err);
      return res.status(500).json({ message: "Failed to fetch users" });
    }

    const users = results.map((user) => ({
      ...user,
      images_user: user.images_user
        ? `${req.protocol}://${req.get("host")}/uploads/${user.images_user}`
        : null,
    }));

    res.status(200).json(users);
  });
};

// ยกเลิกเข้าร่วมกิจกรรมที่เข้าร่วมแล้วของ users เลือก events
exports.cancelApprovedEvent = (req, res) => {
  const { id_join } = req.params;

  const querySelect = `
    SELECT event_id, users_id
    FROM event_participants_join
    WHERE id_join = ?
  `;

  connection.query(querySelect, [id_join], (err, results) => {
    if (err) {
      console.error("Error fetching event data for cancellation:", err);
      return res
        .status(500)
        .json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลกิจกรรม" });
    }

    if (results.length === 0) {
      return res
        .status(404)
        .json({ message: "ไม่พบข้อมูลคำขอสำหรับการยกเลิกกิจกรรม" });
    }

    const { event_id, users_id } = results[0];

    const queryUpdateParticipants = `
      UPDATE events_admin
      SET participants = TRIM(BOTH ',' FROM REPLACE(CONCAT(',', participants, ','), CONCAT(',', ?, ','), ','))
      WHERE id_event = ?
    `;

    connection.query(queryUpdateParticipants, [users_id, event_id], (err) => {
      if (err) {
        console.error("Error updating participants:", err);
        return res
          .status(500)
          .json({ message: "เกิดข้อผิดพลาดในการอัปเดต participants" });
      }

      const queryDeleteRequest = `
        DELETE FROM event_participants_join
        WHERE id_join = ?
      `;

      connection.query(queryDeleteRequest, [id_join], (err) => {
        if (err) {
          console.error("Error deleting join request:", err);
          return res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบคำขอ" });
        }

        res.status(200).json({ message: "คำขอเข้าร่วมถูกยกเลิกเรียบร้อยแล้ว" });
      });
    });
  });
};
