require("dotenv").config();
var express = require("express");
var app = express();
var bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const cors = require("cors");
const saltRounds = 10;
const jwt = require("jsonwebtoken");
const secret = "login-api";
const nodemailer = require("nodemailer");
const otpGenerator = require("otp-generator");
const multer = require("multer");
const fs = require("fs-extra");
const path = require("path");
const cron = require("node-cron");
const axios = require("axios");

const connection = require("./config/db");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ======================
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(cors());
app.use(express.json());
app.use(bodyParser.json({ type: "application/json" }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
// ======================

// Import Middlewares
const authenticateToken = require("./middlewares/authenticateToken");

// Import route
const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/authRoutes");
const eventRoutes = require("./routes/eventRoutes");
const adminRoutes = require("./routes/adminRoutes");
const adminUserRoutes = require("./routes/adminUserRoutes");
const participantRoutes = require("./routes/participantRoutes");

// ====================== USE Routes ======================
app.use("/api/users", userRoutes); // ผู้ใช้ทั่วไป: โปรไฟล์, ไลค์, etc.
// login & authen check & register & send-otp & reset-password
app.use("/api/auth", authRoutes); // login, authen, register, otp
app.use("/api/event", eventRoutes); // user เข้าร่วมกิจกรรม, ตรวจสอบเวลา/สถานที่
app.use("/api/admin", adminRoutes); // admin: สร้าง/ลบ event, ตั้งค่าห้อง
app.use("/api", adminUserRoutes); // admin: จัดการ users (/api/admin/users/*)
app.use("/api", participantRoutes); // admin: อนุมัติ/ปฏิเสธคำขอ, สถานะ online/offline/payment

// ====================== USE Routes ======================

// กำหนดตำแหน่งที่เก็บไฟล์
// const upload = multer({ dest: "uploads/" });
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname); // เช่น .jpg
    const originalName = path.basename(file.originalname, ext); // ตัด .jpg ออก เหลือเฉพาะชื่อ
    const userId = req.body.user_id || "unknown"; // รับ user_id จากฟอร์ม
    const safeOriginalName = originalName.replace(/\s+/g, "_"); // แทนช่องว่างด้วย _
    const filename = `${userId}_${safeOriginalName}_${Date.now()}${ext}`;
    // const filename = `${userId}_${safeOriginalName}${ext}`;
    cb(null, filename);
  },
});

const upload = multer({ storage: storage });

// ====================== Delete Event Time ======================
function deleteExpiredEvents() {
  const expiredEventsQuery = `
    SELECT id_event FROM events_admin WHERE DATE(event_date) < CURDATE()
  `;

  connection.query(expiredEventsQuery, (err, results) => {
    if (err) {
      console.error("Error fetching expired events:", err);
      return;
    }

    const expiredIds = results.map((row) => row.id_event);
    if (expiredIds.length === 0) {
      console.log("No expired events found.");
      return;
    }

    // 1. สำรอง event_id ใน game_details
    const backupGameDetailsQuery = `
      UPDATE game_details
      SET original_event_id = event_id
      WHERE event_id IN (?)
    `;
    connection.query(backupGameDetailsQuery, [expiredIds], (err) => {
      if (err) {
        console.error("Error backing up event_id in game_details:", err);
        return;
      }
      console.log("Backed up event_id in game_details.");

      // 2. สำรอง event_id ใน group_matching
      const backupGroupMatchingQuery = `
        UPDATE group_matching
        SET original_event_id = event_id
        WHERE event_id IN (?)
      `;
      connection.query(backupGroupMatchingQuery, [expiredIds], (err) => {
        if (err) {
          console.error("Error backing up event_id in group_matching:", err);
          return;
        }
        console.log("Backed up event_id in group_matching.");

        // 3. สำรอง event_id ใน payments
        const backupPaymentsQuery = `
          UPDATE payments
          SET original_event_id = event_id
          WHERE event_id IN (?)
        `;
        connection.query(backupPaymentsQuery, [expiredIds], (err) => {
          if (err) {
            console.error("Error backing up event_id in payments:", err);
            return;
          }
          console.log("Backed up event_id in payments.");

          // 3.5 อัปเดต is_finished = 1 ใน game_details ของ event เหล่านั้น
          const markGameFinishedQuery = `
            UPDATE game_details
            SET is_finished = 1
            WHERE event_id IN (?)
          `;
          connection.query(markGameFinishedQuery, [expiredIds], (err) => {
            if (err) {
              console.error("Error updating is_finished in game_details:", err);
              return;
            }
            console.log("Marked games as finished in game_details.");

            // 4. ลบจาก event_participants_join
            const deleteParticipantsQuery = `
              DELETE FROM event_participants_join WHERE event_id IN (?)
            `;
            connection.query(deleteParticipantsQuery, [expiredIds], (err) => {
              if (err) {
                console.error("Error deleting participants:", err);
                return;
              }
              console.log("Deleted participants.");

              // 5. ลบจาก events_admin
              const deleteEventsQuery = `
                DELETE FROM events_admin WHERE id_event IN (?)
              `;
              connection.query(
                deleteEventsQuery,
                [expiredIds],
                (err, result) => {
                  if (err) {
                    console.error("Error deleting expired events:", err);
                  } else {
                    console.log(
                      `Deleted ${result.affectedRows} expired events.`
                    );
                  }
                }
              );
            });
          });
        });
      });
    });
  });
}

// ตั้งค่า Cron Job ให้รันทุกวันเวลาเที่ยงคืน 0 0 * * *
// *    *    *    *    *
// |    |    |    |    |
// |    |    |    |    +----- วันในสัปดาห์ (0 - 7) (0 หรือ 7 = วันอาทิตย์)
// |    |    |    +---------- เดือน (1 - 12)
// |    |    +--------------- วันที่ในเดือน (1 - 31)
// |    +-------------------- ชั่วโมง (0 - 23)
// +------------------------- นาที (0 - 59)

cron.schedule("45 0 * * *", () => {
  console.log("Running cron job: Deleting expired events...");
  deleteExpiredEvents();
});
// ====================== Delete Event Time ======================

// server start
const server = app.listen(3333, () => {
  const { address, port } = server.address();
  console.log(`Server running on http://${address}:${port}`);
});

// -----------------------LLM Matching Algorithm-----------------------

// ปรับ getPlayersForEvent() ให้ดึงจาก user_match_stats แทน user_likes
async function getPlayersForEvent(event_id) {
  return new Promise((resolve, reject) => {
    connection.query(
      `SELECT u.id, u.sname AS name, u.rank_play
       FROM event_participants_join epj
       JOIN users u ON epj.users_id = u.id
       WHERE epj.event_id = ? AND epj.status = 'approved' AND epj.status_real_join = 'online'`,
      [event_id],
      (err, approvedResult) => {
        if (err) return reject(err);

        connection.query(
          `SELECT * FROM user_match_stats`,
          (err, statsResult) => {
            if (err) return reject(err);

            const userMap = approvedResult.map((user) => {
              const preferences = statsResult.filter(
                (s) => s.liked_by_user_id === user.id
              );
              return {
                id: user.id,
                name: user.name,
                rank_play: user.rank_play,
                preference_to: preferences.map((p) => ({
                  target_id: p.user_id,
                  rating: p.sum_rate,
                  comment_user: null, // ไม่ใช้ comment จาก stat
                })),
              };
            });

            return resolve(userMap);
          }
        );
      }
    );
  });
}
// สร้าง group + game detail
async function saveMatchedGroups(event_id, groups) {
  const conn = connection.promise(); // 👈 เพิ่มบรรทัดนี้

  if (!Array.isArray(groups)) {
    throw new Error("❌ groups ที่ได้ไม่ใช่ array");
  }

  for (const groupObj of groups) {
    if (!groupObj || !Array.isArray(groupObj.members)) {
      console.error(
        "❌ groupObj.members ไม่ใช่ array หรือ undefined:",
        groupObj
      );
      continue;
    }

    const memberIds = groupObj.members
      .map((m) => m?.id)
      .filter((id) => typeof id === "number");

    if (memberIds.length < 1) {
      console.warn("⚠️ กลุ่มไม่มีสมาชิกที่มี id ที่ถูกต้อง:", groupObj);
      continue;
    }

    // ✅ ใช้ promise แบบนี้แทน
    const [result] = await conn.execute(
      "INSERT INTO group_matching (event_id) VALUES (?)",
      [event_id]
    );
    const group_id = result.insertId;

    for (const user_id of memberIds) {
      await conn.execute(
        "INSERT INTO group_members (group_id, user_id) VALUES (?, ?)",
        [group_id, user_id]
      );
    }

    await conn.execute(
      `INSERT INTO game_details (event_id, group_id, shuttlecock_cost, shuttlecock_count, total_cost, game_sequence, is_finished)
       VALUES (?, ?, NULL, NULL, NULL, NULL, 0)`,
      [event_id, group_id]
    );
  }
}

//
// ============= ใช้สำหรับ "จับกลุ่มเกม" ต่อสนามใหม่ (เปลี่ยนกลุ่ม, เปลี่ยน group_id) =============

// แก้ไขให้ LLM จัดกลุ่มเดียว (1 กลุ่ม 4 คนเท่านั้น) โดยเฉพาะสนามนั้น
app.post("/api/generate-court-match", async (req, res) => {
  const { event_id, court_number } = req.body;

  if (!event_id || !court_number) {
    return res.status(400).json({
      success: false,
      message: "กรุณาระบุ event_id และ court_number",
    });
  }

  try {
    const [allPlayers] = await connection.promise().execute(
      `SELECT u.id, u.sname AS name, u.rank_play
       FROM event_participants_join epj
       JOIN users u ON epj.users_id = u.id
       WHERE epj.event_id = ?
         AND epj.status = 'approved'
         AND epj.status_real_join = 'online'
         AND u.id NOT IN (
           SELECT gm.user_id
           FROM group_members gm
           JOIN game_details gd ON gm.group_id = gd.group_id
           WHERE gd.event_id = ? AND gd.is_finished = 0
         )`,
      [event_id, event_id]
    );

    if (allPlayers.length < 4) {
      return res.status(400).json({
        success: false,
        message: "ต้องมีผู้เล่นอย่างน้อย 4 คนเพื่อจัดกลุ่ม",
      });
    }

    const allPlayerIds = allPlayers.map((p) => p.id);
    const [statsResult] = await connection
      .promise()
      .execute("SELECT * FROM user_match_stats");

    const userMap = allPlayers.map((user) => {
      const rated = statsResult.filter((s) => s.liked_by_user_id === user.id);
      const ratedMap = {};
      rated.forEach((r) => {
        ratedMap[r.user_id] = r.sum_rate;
      });

      const filledPrefs = allPlayerIds
        .filter((targetId) => targetId !== user.id)
        .map((targetId) => ({
          target_id: targetId,
          rating: ratedMap[targetId] ?? 3,
          comment_user: null,
        }));

      return {
        id: user.id,
        name: user.name,
        rank_play: user.rank_play,
        preference_to: filledPrefs,
      };
    });

    const groupHistory = await getPlayerGroupHistory(
      event_id,
      allPlayers.map((p) => p.id)
    );

    const prompt = `คุณคือระบบ AI สำหรับจัดกลุ่มผู้เล่นแบดมินตัน โดยต้องจับกลุ่มละ 4 คน เท่านั้น (ห้ามมากกว่าหรือน้อยกว่า 4 คน)
- ให้ตอบกลับมาเฉพาะ JSON ที่จัดกลุ่มผู้เล่น
- ห้ามมีคำอธิบายใด ๆ เพิ่ม
- ห้ามขึ้นต้นด้วยข้อความ เช่น "แน่นอนครับ" หรือ "นี่คือตัวอย่าง"
- ห้ามใช้เครื่องหมาย \`\`\` ใด ๆ ทั้งสิ้น
- ตอบกลับเป็น JSON เท่านั้น โดยการจับคู่เงื่อนไขดังนี้
1. ความชอบที่มีระดับใกล้เคียงกัน (1 น้อยมาก ถึง 5 ชอบมาก -> preference: 1-5, ค่า default คือ 3)
2. ความสามารถที่ใกล้เคียงกัน (N/B, N, S, P, C/B/A)
3. ค่า Moving Average ที่ได้จากการเล่นร่วมกันก่อนหน้า (sum_rate) ให้พิจารณาจับกลุ่มคนที่ให้คะแนนกันในระดับที่ไม่ห่างกันมากเกินไป
4. หลีกเลี่ยงไม่ให้ผู้เล่นเคยอยู่กลุ่มเดียวกันมาก่อน (ตรวจสอบจาก groupHistory ว่าเคยอยู่ใน group_id เดียวกันหรือไม่)

ข้อมูลผู้เล่น:
${JSON.stringify(userMap, null, 2)}

ประวัติกลุ่มเดิม:
${JSON.stringify(groupHistory, null, 2)}

ตัวอย่างผลลัพธ์:
[
  {
    "group": 1,
    "members": [
      { "id": 1, "name": "..." },
      { "id": 2, "name": "..." },
      { "id": 3, "name": "..." },
      { "id": 4, "name": "..." }
    ]
  }
]`;

    const openaiResponse = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
      }
    );

    let text = openaiResponse.data.choices[0].message.content.trim();
    text = text
      .replace(/```(?:json)?/g, "")
      .replace(/```/g, "")
      .trim();

    let matchedGroups;
    try {
      matchedGroups = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({
        success: false,
        message: "ผลลัพธ์ไม่เป็น JSON",
        raw: text,
      });
    }

    // กรองเฉพาะกลุ่มแรก และเช็คให้มี 4 คนจริง
    const firstGroup = matchedGroups[0];
    if (
      !firstGroup ||
      !Array.isArray(firstGroup.members) ||
      firstGroup.members.length !== 4
    ) {
      return res.status(400).json({
        success: false,
        message: "กลุ่มที่ตอบกลับไม่มีสมาชิกครบ 4 คน",
      });
    }

    const conn = connection.promise();
    const [groupResult] = await conn.execute(
      "INSERT INTO group_matching (event_id) VALUES (?)",
      [event_id]
    );
    const group_id = groupResult.insertId;

    for (const member of firstGroup.members) {
      await conn.execute(
        "INSERT INTO group_members (group_id, user_id) VALUES (?, ?)",
        [group_id, member.id]
      );
    }

    await conn.execute(
      `INSERT INTO game_details (
         event_id, group_id, court_number,
         shuttlecock_cost, shuttlecock_count,
         total_cost, game_sequence, is_finished
       ) VALUES (?, ?, ?, NULL, NULL, NULL, 1, 0)`,
      [event_id, group_id, court_number]
    );

    return res.json({
      success: true,
      message: "จัดกลุ่มสำเร็จ",
      group: firstGroup,
    });
  } catch (error) {
    console.error("generate-court-match error:", error);
    return res.status(500).json({
      success: false,
      message: "ไม่สามารถจับกลุ่มได้",
      error: error.message,
    });
  }
});

// ===================================================================================
app.post("/api/clear-court", async (req, res) => {
  const { event_id, court_number } = req.body;

  if (!event_id || !court_number) {
    return res.status(400).json({ success: false, message: "ข้อมูลไม่ครบ" });
  }

  try {
    // อัปเดตให้เกมในสนามนี้เป็น is_finished = 1
    await connection.promise().execute(
      `UPDATE game_details
       SET is_finished = 1
       WHERE event_id = ? AND court_number = ? AND is_finished = 0`,
      [event_id, court_number]
    );

    res.json({ success: true, message: "ล้างสนามสำเร็จแล้ว" });
  } catch (err) {
    console.error("Clear Court Error:", err);
    res.status(500).json({ success: false, message: "ล้างสนามล้มเหลว" });
  }
});

// ============= ใช้ให้ LLM หลีกเลี่ยงการจัดกลุ่มซ้ำ =============
async function getPlayerGroupHistory(event_id, player_ids) {
  const [rows] = await connection.promise().execute(
    `SELECT gm.group_id, gmb.user_id
     FROM group_matching gm
     JOIN group_members gmb ON gm.group_id = gmb.group_id
     WHERE gm.event_id = ? AND gmb.user_id IN (?)`,
    [event_id, player_ids]
  );

  const historyMap = {};
  rows.forEach((row) => {
    if (!historyMap[row.user_id]) historyMap[row.user_id] = [];
    historyMap[row.user_id].push(row.group_id);
  });

  return historyMap;
}
// ======================================================

// ============= ใช้ดึงผู้เล่นในสนาม =============
// สร้าง API รองรับการดึงผู้เล่นในแต่ละสนาม (court)
app.get("/api/court-players", async (req, res) => {
  const { event_id, court_number } = req.query;

  if (!event_id || !court_number) {
    return res.status(400).json({
      success: false,
      message: "กรุณาระบุ event_id และ court_number",
    });
  }

  try {
    const conn = connection.promise();

    const [latestGroupRows] = await conn.execute(
      `SELECT group_id, game_sequence FROM game_details
       WHERE event_id = ? AND court_number = ? AND is_finished = 0
       ORDER BY id DESC LIMIT 1`,
      [event_id, court_number]
    );

    if (latestGroupRows.length === 0) {
      // กรณีไม่มีเกมเลยในคอร์ดนี้
      return res.json({
        success: true,
        group_id: null,
        // game_sequence: latestGroupRows[0].game_sequence ?? 1,
        game_sequence: null,
        players: [],
      });
    }

    const group_id = latestGroupRows[0].group_id;

    const [rows] = await conn.execute(
      `SELECT u.id, u.sname AS name, u.rank_play, u.sex, u.images_user
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = ?`,
      [group_id]
    );

    return res.json({
      success: true,
      group_id,
      game_sequence: latestGroupRows[0].game_sequence ?? 1,
      players: rows || [],
    });
  } catch (err) {
    console.error("Error fetching court players:", err);
    return res.status(500).json({
      success: false,
      message: "ไม่สามารถโหลดข้อมูลผู้เล่นในสนามนี้ได้",
      error: err.message,
    });
  }
});

// ==========================================
// ==========================================
// สำหรับ Admin แสดงทุกกลุ่ม + event_status
app.get("/api/get-group-display/:event_id", async (req, res) => {
  const { event_id } = req.params;
  try {
    const [eventRows] = await connection.promise().execute(
      `SELECT event_status, number_courts, cost_shuttlecock
       FROM events_admin
       WHERE id_event = ?
       LIMIT 1`,
      [event_id]
    );

    const [activeGames] = await connection.promise().execute(
      `SELECT gd.group_id, gd.court_number, gd.shuttlecock_cost
FROM game_details gd
JOIN (
    SELECT court_number, MAX(id) AS max_id
    FROM game_details
    WHERE event_id = ? AND is_finished = 0
    GROUP BY court_number
) latest ON gd.id = latest.max_id
ORDER BY gd.id DESC`,
      [event_id]
    );

    const activeGroupIds = activeGames.map((g) => g.group_id);
    if (activeGroupIds.length === 0) {
      return res.json({
        success: true,
        event_status: eventRows[0]?.event_status || "offline",
        number_courts: eventRows[0]?.number_courts || 0,
        groups: [],
      });
    }

    // ใช้ placeholders สำหรับ array
    const placeholders = activeGroupIds.map(() => "?").join(", ");
    const [rows] = await connection.promise().execute(
      `SELECT gm.group_id, u.id AS user_id, u.sname AS name,
              u.rank_play, u.sex, u.images_user
       FROM group_matching g
       JOIN group_members gm ON g.group_id = gm.group_id
       JOIN users u ON gm.user_id = u.id
       WHERE g.event_id = ? AND gm.group_id IN (${placeholders})
       ORDER BY gm.group_id, u.id`,
      [event_id, ...activeGroupIds]
    );

    const grouped = {};
    rows.forEach((row) => {
      if (!grouped[row.group_id]) grouped[row.group_id] = [];
      grouped[row.group_id].push({
        id: row.user_id,
        name: row.name,
        rank_play: row.rank_play,
        sex: row.sex,
        images_user: row.images_user,
      });
    });

    const formatted = Object.entries(grouped).map(([group_id, members]) => ({
      group_id,
      members,
    }));

    return res.json({
      success: true,
      event_status: eventRows[0]?.event_status || "offline",
      number_courts: eventRows[0]?.number_courts || 0,
      cost_shuttlecock: eventRows[0]?.cost_shuttlecock || 0,
      groups: formatted,
    });
  } catch (err) {
    console.error("Admin group display error:", err);
    return res.status(500).json({
      success: false,
      message: "ไม่สามารถโหลดข้อมูลกลุ่มได้",
    });
  }
});

// ดึงผู้เล่น approved + online
app.get("/api/event/approved-online-players", async (req, res) => {
  const { event_id } = req.query;

  if (!event_id) {
    return res.status(400).json({
      success: false,
      message: "กรุณาระบุ event_id",
    });
  }

  try {
    const [rows] = await connection.promise().execute(
      `SELECT u.id, u.sname AS name, u.rank_play, u.sex, u.images_user
FROM event_participants_join epj
JOIN users u ON epj.users_id = u.id
WHERE epj.event_id = ?
  AND epj.status = 'approved'
  AND epj.status_real_join = 'online'
  AND u.id NOT IN (
    SELECT gm.user_id
    FROM group_members gm
    JOIN game_details gd ON gm.group_id = gd.group_id
    WHERE gd.event_id = ? AND gd.is_finished = 0
  )`,
      [event_id, event_id]
    );

    res.json({ success: true, players: rows });
  } catch (err) {
    console.error("approved-online-players error:", err);
    res.status(500).json({ success: false, message: "โหลดผู้เล่นล้มเหลว" });
  }
});

// ดึง court_number จาก group_id + event_id
app.get("/api/get-court-from-group", async (req, res) => {
  const { event_id, group_id } = req.query;

  if (!event_id || !group_id) {
    return res.status(400).json({
      success: false,
      message: "กรุณาระบุ event_id และ group_id",
    });
  }

  try {
    const conn = connection.promise();

    const [rows] = await conn.execute(
      `SELECT court_number, game_sequence
       FROM game_details
       WHERE event_id = ? AND group_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [event_id, group_id]
    );

    if (rows.length === 0 || !rows[0].court_number) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบ court_number สำหรับ group_id นี้",
      });
    }

    return res.json({
      success: true,
      court_number: rows[0].court_number,
      game_sequence: rows[0].game_sequence ?? null, // เพิ่มจำนวนรอบ
    });
  } catch (err) {
    console.error("get-court-from-group error:", err);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์",
      error: err.message,
    });
  }
});

// สำหรับ User ดูเฉพาะกลุ่มตัวเอง
app.get("/api/user-group/:event_id/:user_id", async (req, res) => {
  const { event_id, user_id } = req.params;

  try {
    // 1) ตรวจสอบสถานะ event
    const [eventRows] = await connection
      .promise()
      .execute(`SELECT event_status FROM events_admin WHERE id_event = ?`, [
        event_id,
      ]);

    if (eventRows.length === 0 || eventRows[0].event_status !== "online") {
      return res.json({
        success: false,
        message: "ห้องกิจกรรมยังไม่ได้เปิดใช้งาน",
        event_status: "offline",
      });
    }

    // 2) หา group_id ล่าสุดของ user ที่ยังไม่จบเกม (is_finished = 0)
    const [groupResult] = await connection.promise().execute(
      `SELECT gm.group_id
       FROM group_members gm
       JOIN group_matching gmch ON gm.group_id = gmch.group_id
       JOIN game_details gd ON gm.group_id = gd.group_id
       WHERE gm.user_id = ? AND gmch.event_id = ? AND gd.is_finished = 0
       ORDER BY gd.id DESC
       LIMIT 1`,
      [user_id, event_id]
    );

    if (groupResult.length === 0) {
      return res.json({
        success: false,
        message: "ไม่พบกลุ่มที่กำลังเล่นอยู่ของผู้ใช้ในกิจกรรมนี้",
        event_status: "online",
      });
    }

    const groupId = groupResult[0].group_id;

    // 3) ดึงสมาชิกในกลุ่มนั้น
    const [membersRows] = await connection.promise().execute(
      `SELECT u.id AS user_id, u.sname AS name,
              u.rank_play, u.sex, u.images_user
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = ?`,
      [groupId]
    );

    return res.json({
      success: true,
      event_status: "online",
      group: {
        group_id: groupId,
        members: membersRows,
      },
    });
  } catch (err) {
    console.error("Error fetching group data:", err);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูล",
      error: err.message,
      event_status: "offline",
    });
  }
});

// อัปเดตคำนวณ Moving Average
app.post("/api/user/rate-round", async (req, res) => {
  const { event_id, group_id, user_id, ratings } = req.body;

  if (!event_id || !group_id || !user_id || !Array.isArray(ratings)) {
    return res.status(400).json({ success: false, message: "ข้อมูลไม่ครบ" });
  }

  const conn = connection.promise();

  try {
    for (const rating of ratings) {
      const { like_user, rate_com, comment_round } = rating;
      if (!like_user) continue;

      // 1. บันทึกผลประเมินรายรอบ
      await conn.execute(
        `INSERT INTO group_members_likes (event_id, group_id, user_id, like_user, rate_com, comment_round)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          event_id,
          group_id,
          user_id,
          like_user,
          rate_com || null,
          comment_round || null,
        ]
      );

      // 2. ดึงข้อมูลจาก user_match_stats เพื่อลง Moving Average
      const [rows] = await conn.execute(
        `SELECT * FROM user_match_stats WHERE user_id = ? AND liked_by_user_id = ?`,
        [like_user, user_id]
      );

      if (rows.length > 0) {
        // มีอยู่แล้ว -> คำนวณ Moving Average
        const oldSum = rows[0].sum_rate;
        const oldCount = rows[0].rate_count;
        const newCount = oldCount + 1;
        const newAvg = (oldSum * oldCount + rate_com) / newCount;

        await conn.execute(
          `UPDATE user_match_stats SET sum_rate = ?, rate_count = ?
           WHERE user_id = ? AND liked_by_user_id = ?`,
          [newAvg, newCount, like_user, user_id]
        );
      } else {
        // ยังไม่มี -> insert ครั้งแรก
        await conn.execute(
          `INSERT INTO user_match_stats (user_id, liked_by_user_id, sum_rate, rate_count)
           VALUES (?, ?, ?, 1)`,
          [like_user, user_id, rate_com]
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Insert round rating error:", err);
    res.status(500).json({ success: false, message: "บันทึกล้มเหลว" });
  }
});
// ============= ใช้สำหรับบันทึกข้อมูลรอบเกมใหม่ =============
// ในกลุ่มเดิม (group_id เดิม) โดยเพิ่ม game_sequence ต่อไป เช่น รอบที่ 1, 2, 3
//  โดยอัปเดตให้สร้าง row ใหม่แทนการ UPDATE
// อัปเดตรอบล่าสุด ลูกขนไก่, จำนวนลูก และคำนวณ total_cost
app.post("/api/update-last-game", async (req, res) => {
  const { event_id, court_number, shuttlecock_cost, shuttlecock_count } =
    req.body;
  const totalCost = shuttlecock_cost * shuttlecock_count;

  try {
    const conn = connection.promise();

    // หาเกมล่าสุดในสนามนี้ (ที่ยังไม่จบ)
    const [latestRows] = await conn.execute(
      `SELECT id, group_id, game_sequence, shuttlecock_cost, shuttlecock_count
       FROM game_details
       WHERE event_id = ? AND court_number = ? AND is_finished = 0
       ORDER BY id DESC LIMIT 1`,
      [event_id, court_number]
    );

    if (!latestRows.length) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบเกมล่าสุดในสนามนี้",
      });
    }

    const latest = latestRows[0];

    if (latest.shuttlecock_cost == null || latest.shuttlecock_count == null) {
      // อัปเดตรอบแรก
      await conn.execute(
        `UPDATE game_details
         SET shuttlecock_cost = ?, shuttlecock_count = ?, total_cost = ?
         WHERE id = ?`,
        [shuttlecock_cost, shuttlecock_count, totalCost, latest.id]
      );

      // ดึงจำนวนสมาชิกในกลุ่ม แล้วคำนวณค่าเฉลี่ย
      const [members] = await conn.execute(
        `SELECT COUNT(*) AS count FROM group_members WHERE group_id = ?`,
        [latest.group_id]
      );
      const memberCount = members[0].count || 1;
      const avg = totalCost / memberCount;

      await conn.execute(`UPDATE game_details SET avr_total = ? WHERE id = ?`, [
        avg,
        latest.id,
      ]);

      return res.json({
        success: true,
        message: `อัปเดตรอบแรกเรียบร้อยแล้ว (ไม่มีการสร้างรอบใหม่)`,
      });
    }

    return res.json({
      success: false,
      message: "รอบนี้มีข้อมูลลูกขนไก่อยู่แล้ว ไม่สามารถอัปเดตซ้ำได้",
    });
  } catch (err) {
    console.error("Update Last Game Error:", err);
    return res.status(500).json({ success: false, message: "Insert failed" });
  }
});

// ============= update เฉพาะ court_number ที่กดปุ่มเท่านั้น =============
// อัพเดท is_finished = 1 ของเกมเก่าทั้งหมดใน event
app.post("/api/finish-current-games", async (req, res) => {
  const { event_id, court_number } = req.body;

  if (!event_id || !court_number) {
    return res.status(400).json({
      success: false,
      message: "กรุณาระบุ event_id และ court_number",
    });
  }

  try {
    await connection.promise().execute(
      `UPDATE game_details
       SET is_finished = 1
       WHERE event_id = ? AND court_number = ? AND is_finished = 0`,
      [event_id, court_number]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Finish Current Games Error:", err);
    res.status(500).json({ success: false, message: "Update failed" });
  }
});
// =================================================================

// แก้ไขการแสดงผลสนาม
// PATCH: บันทึกสถานะกิจกรรม, ราคาค่าสนาม, จำนวนคอร์ด
app.patch("/api/admin/input-number-courts-event", async (req, res) => {
  const { event_id, event_status, cost_stadium, number_courts, cost_shuttlecock } = req.body;

  if (!event_id || !event_status) {
    return res.status(400).json({
      success: false,
      message: "กรุณาระบุ event_id และ event_status",
    });
  }

  try {
    const [result] = await connection.promise().execute(
      `UPDATE events_admin 
         SET event_status = ?, cost_stadium = ?, number_courts = ?, cost_shuttlecock = ? 
         WHERE id_event = ?`,
      [
        event_status,
        cost_stadium !== undefined ? cost_stadium : null,
        number_courts !== undefined ? number_courts : null,
        cost_shuttlecock !== undefined ? cost_shuttlecock : null,
        event_id,
      ]
    );

    return res.json({
      success: true,
      message: "อัปเดตข้อมูลกิจกรรมเรียบร้อยแล้ว",
    });
  } catch (error) {
    console.error("Update event settings error:", error);
    return res.status(500).json({
      success: false,
      message: "ไม่สามารถอัปเดตข้อมูลกิจกรรมได้",
      error: error.message,
    });
  }
});

// สรุปค่าใช้จ่าย
app.get("/api/event/cost-summary/:event_id/:user_id", async (req, res) => {
  const { event_id, user_id } = req.params;

  try {
    const conn = connection.promise();

    // ดึงค่าสนาม + วันที่ + เวลา
    const [eventRows] = await conn.execute(
      `SELECT cost_stadium, event_date, event_start_time FROM events_admin WHERE id_event = ?`,
      [event_id]
    );
    const costStadium = eventRows[0]?.cost_stadium || 0;
    const eventDate = eventRows[0]?.event_date || null;
    const eventTime = eventRows[0]?.event_start_time || null;

    // รวม avr_total ที่ไม่เป็น NULL ของทุกเกมที่ user มีส่วนร่วมในกิจกรรมนี้
    const [rows] = await conn.execute(
      `SELECT SUM(gd.avr_total) AS total_avr
       FROM game_details gd
       JOIN group_members gm ON gd.group_id = gm.group_id
       WHERE gd.event_id = ? AND gm.user_id = ? AND gd.avr_total IS NOT NULL`,
      [event_id, user_id]
    );

    const total_avr = Number(rows[0]?.total_avr) || 0;

    return res.json({
      success: true,
      cost_stadium: costStadium,
      total_shuttlecock_cost: total_avr,
      event_date: eventDate,
      event_start_time: eventTime,
    });
  } catch (err) {
    console.error("Cost summary error:", err);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาด",
      error: err.message,
    });
  }
});

// แนบชำระเงิน + บันทึกสถานะชำระเงินไปอัพเดต
app.post(
  "/api/payments/upload-slip",
  upload.single("slip_image"),
  async (req, res) => {
    const { user_id, event_id, payment_method, amount } = req.body;
    const slipPath = req.file ? req.file.filename : null;

    if (!user_id || !event_id || !payment_method || !amount) {
      return res.status(400).json({ success: false, message: "ข้อมูลไม่ครบ" });
    }

    try {
      // UPDATE ถ้ามี, INSERT ถ้าไม่มี
      const [rows] = await connection
        .promise()
        .execute(`SELECT * FROM payments WHERE user_id = ? AND event_id = ?`, [
          user_id,
          event_id,
        ]);

      const now = new Date();

      if (rows.length > 0) {
        await connection.promise().execute(
          `UPDATE payments
     SET payment_method = ?, amount = ?, status = 'pending', images_slip = ?, date_pay = ?
     WHERE user_id = ? AND event_id = ?`,
          [payment_method, amount, slipPath, now, user_id, event_id]
        );
      } else {
        await connection.promise().execute(
          `INSERT INTO payments 
     (user_id, event_id, amount, payment_method, images_slip, status, created_at, date_pay)
     VALUES (?, ?, ?, ?, ?, 'pending', NOW(), ?)`,
          [user_id, event_id, amount, payment_method, slipPath, now]
        );
      }

      res.json({ success: true, message: "อัปโหลดสลิปและบันทึกข้อมูลสำเร็จ" });
    } catch (err) {
      console.error("Upload slip error:", err);
      res.status(500).json({ success: false, message: "บันทึกล้มเหลว" });
    }
  }
);

app.get("/api/test", (req, res) => {
  res.json({ message: "Hello from API" });
});
