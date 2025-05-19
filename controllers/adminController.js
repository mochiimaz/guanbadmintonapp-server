const connection = require("../config/db");

// สร้าง Event ใหม่
exports.createEvent = (req, res) => {
  const {
    event_date,
    event_start_time,
    event_location,
    participants,
    event_status,
  } = req.body;

  const checkEventQuery = `
    SELECT * FROM events_admin
    WHERE event_date = ? AND event_start_time = ? AND event_location = ?
  `;

  connection.query(
    checkEventQuery,
    [event_date, event_start_time, event_location],
    (err, existingEvents) => {
      if (err) {
        console.error("Error checking existing events:", err);
        return res.status(500).json({ message: "Internal Server Error" });
      }

      if (existingEvents.length > 0) {
        return res.status(200).json({
          duplicate: true,
          message:
            "คุณได้ทำการสร้างกิจกรรมในช่วงเวลาดังกล่าวที่สถานที่นี้ไปแล้ว กรุณาเปลี่ยนวันหรือช่วงเวลาใหม่",
        });
      }

      const sql = `
        INSERT INTO events_admin (event_date, event_start_time, event_location, participants, event_status)
        VALUES (?, ?, ?, ?, ?)
      `;

      connection.query(
        sql,
        [
          event_date,
          event_start_time,
          event_location,
          participants || null,
          event_status || "offline",
        ],
        (err, result) => {
          if (err) {
            console.error("Error inserting event:", err);
            return res.status(500).json({ message: "Failed to create event" });
          }

          res.status(201).json({
            duplicate: false,
            message: "Event created successfully",
            eventId: result.insertId,
          });
        }
      );
    }
  );
};

// ดึงข้อมูลกิจกรรมทั้งหมดที่สร้าง
exports.getAllEvents = (req, res) => {
  const sql = `
    SELECT * FROM events_admin 
    ORDER BY event_date, event_start_time, id_event
  `;

  connection.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching events:", err);
      return res.status(500).json({ message: "Failed to retrieve events" });
    }

    res.status(200).json({
      success: true,
      events: results,
    });
  });
};

// ลบกิจกรรมตาม id_event ที่สร้างกิจกรรมไว้
exports.deleteEvent = (req, res) => {
  const { id_event } = req.params;

  const sql = "DELETE FROM events_admin WHERE id_event = ?";
  connection.query(sql, [id_event], (err, result) => {
    if (err) {
      console.error("Error deleting event:", err);
      return res.status(500).json({ message: "Failed to delete event" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Event not found" });
    }

    res.status(200).json({ message: "Event deleted successfully" });
  });
};

// โหลดค่าสถานะหลังเปลี่ยนการใช้งาน การชำระเงิน ของผู้เล่นแต่ละคน
exports.getUserStatus = async (req, res) => {
  const { user_id, event_id } = req.query;

  if (!user_id || !event_id) {
    return res.status(400).json({
      success: false,
      message: "กรุณาระบุ user_id และ event_id",
    });
  }

  try {
    const query = `
        SELECT epj.status_real_join,
               COALESCE(p.status, 'pending') AS payment_status
        FROM event_participants_join epj
        LEFT JOIN payments p ON epj.users_id = p.user_id AND epj.event_id = p.event_id
        WHERE epj.users_id = ? AND epj.event_id = ?
      `;

    const [rows] = await connection.promise().query(query, [user_id, event_id]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูลสถานะของผู้ใช้",
        status_real_join: null,
        payment_status: null,
      });
    }

    return res.json({
      success: true,
      status_real_join: rows[0].status_real_join || "offline",
      payment_status: rows[0].payment_status || "pending",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการโหลดสถานะ",
      error: error.message,
    });
  }
};

// อัปเดตสถานะห้องกิจกรรม และราคาสนาม
exports.updateRoomStatusAndCost = async (req, res) => {
  const { event_id, event_status, cost_stadium } = req.body;

  if (!event_id) {
    return res
      .status(400)
      .json({ success: false, message: "กรุณาระบุ event_id" });
  }

  const connectionPromise = connection.promise();

  try {
    const checkQuery = `SELECT event_status, cost_stadium FROM events_admin WHERE id_event = ?`;
    const [eventRow] = await connectionPromise.query(checkQuery, [event_id]);

    if (eventRow.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบกิจกรรมนี้" });
    }

    let currentStatus = eventRow[0].event_status;
    let currentCost = eventRow[0].cost_stadium;

    if (event_status !== undefined && event_status !== currentStatus) {
      await connectionPromise.query(
        `UPDATE events_admin SET event_status = ? WHERE id_event = ?`,
        [event_status, event_id]
      );
    }

    if (cost_stadium !== undefined) {
      if (cost_stadium === "" || cost_stadium === null) {
        await connectionPromise.query(
          `UPDATE events_admin SET cost_stadium = NULL WHERE id_event = ?`,
          [event_id]
        );
      } else {
        if (isNaN(cost_stadium) || cost_stadium < 1 || cost_stadium > 999) {
          return res.status(400).json({
            success: false,
            message: "เกินช่วงราคาที่กำหนดไว้ (1-999)",
          });
        }
        await connectionPromise.query(
          `UPDATE events_admin SET cost_stadium = ? WHERE id_event = ?`,
          [cost_stadium, event_id]
        );
      }
    }

    return res.json({
      success: true,
      message: "อัปเดตข้อมูลกิจกรรมเรียบร้อย",
      updated_data: {
        event_status: event_status || currentStatus,
        cost_stadium: cost_stadium === "" ? null : cost_stadium || currentCost,
      },
    });
  } catch (error) {
    await connectionPromise.rollback();
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาด",
      error: error.message,
    });
  }
};

// โหลดค่าเดิมของ สถานะห้องกิจกรรม และราคาสนาม กับจำนวนสนาม
exports.getRoomStatusAndCost = async (req, res) => {
  const { event_id } = req.query;

  if (!event_id) {
    return res.status(400).json({
      success: false,
      message: "กรุณาระบุ event_id",
    });
  }

  try {
    const query = `SELECT event_status, cost_stadium, number_courts FROM events_admin WHERE id_event = ?`;
    const [rows] = await connection.promise().query(query, [event_id]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบกิจกรรมนี้",
      });
    }

    return res.json({
      success: true,
      event_status: rows[0].event_status || "offline",
      cost_stadium: rows[0].cost_stadium || null,
      number_courts: rows[0].number_courts || null,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการโหลดข้อมูลกิจกรรม",
      error: error.message,
    });
  }
};
