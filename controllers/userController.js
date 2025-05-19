const path = require("path");
const fs = require("fs-extra");
const connection = require("../config/db");

// อัปเดตรูปโปรไฟล์ของผู้ใช้
exports.updateProfile = async (req, res) => {
  const { sname, phone, sex, rank_play } = req.body;
  const { userId } = req.params;
  let newImageName = null;

  try {
    if (req.file) {
      const fileExtension = path.extname(req.file.originalname);
      newImageName = `${userId}_${Date.now()}${fileExtension}`;
      const newImagePath = path.join(__dirname, "../uploads", newImageName);

      const [user] = await connection
        .promise()
        .query("SELECT images_user FROM users WHERE id = ?", [userId]);

      if (user.length > 0 && user[0].images_user) {
        const oldImagePath = path.join(
          __dirname,
          "../uploads",
          user[0].images_user
        );
        await fs.remove(oldImagePath);
      }

      await fs.move(req.file.path, newImagePath);
    }

    if (!sname && !phone && !sex && !rank_play && !newImageName) {
      return res.status(400).json({ message: "ไม่มีข้อมูลที่จะอัปเดต" });
    }

    const updateFields = [];
    const values = [];

    if (sname) {
      updateFields.push("sname = ?");
      values.push(sname);
    }
    if (phone) {
      updateFields.push("phone = ?");
      values.push(phone);
    }
    if (sex) {
      updateFields.push("sex = ?");
      values.push(sex);
    }
    if (rank_play) {
      updateFields.push("rank_play = ?");
      values.push(rank_play);
    }
    if (newImageName) {
      updateFields.push("images_user = ?");
      values.push(newImageName);
    }

    values.push(userId);

    const sqlQuery = `UPDATE users SET ${updateFields.join(", ")} WHERE id = ?`;
    await connection.promise().query(sqlQuery, values);

    res.status(200).json({ message: "โปรไฟล์อัปเดตสำเร็จ" });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดต" });
  }
};

// ดึงข้อมูลโปรไฟล์ผู้ใช้ user id
exports.getUserProfile = (req, res) => {
  const email_add = req.user.email_add;

  connection.query(
    `SELECT sname, email_add, phone, sex, rank_play, images_user, status_login 
     FROM users WHERE email_add = ?`,
    [email_add],
    (err, result) => {
      if (err) {
        return res
          .status(500)
          .json({ status: "error", message: "Database error", err });
      }

      if (result.length === 0) {
        return res
          .status(404)
          .json({ status: "error", message: "User not found" });
      }

      const imageUrl = result[0].images_user
        ? `${req.protocol}://${req.get("host")}/uploads/${
            result[0].images_user
          }`
        : null;

      res.json({
        status: "ok",
        sname: result[0].sname,
        email_add: result[0].email_add,
        phone: result[0].phone,
        sex: result[0].sex,
        rank_play: result[0].rank_play,
        status_login: result[0].status_login,
        images_user: imageUrl,
      });
    }
  );
};

// อัพเดทข้อมูลโปรไฟล์ส่วนตัว ไม่รวมรูป
exports.updateUserProfile = (req, res) => {
  const { sname, phone, sex, rank_play } = req.body;
  const email_add = req.user.email_add;

  if (!sname && !phone && !sex && !rank_play) {
    return res
      .status(400)
      .json({ status: "error", message: "กรุณาระบุข้อมูลที่ต้องการอัพเดท" });
  }

  let updateFields = [];
  let values = [];

  if (sname) {
    updateFields.push("sname = ?");
    values.push(sname);
  }
  if (phone) {
    updateFields.push("phone = ?");
    values.push(phone);
  }
  if (sex) {
    updateFields.push("sex = ?");
    values.push(sex);
  }
  if (rank_play) {
    updateFields.push("rank_play = ?");
    values.push(rank_play);
  }

  values.push(email_add);

  const sqlQuery = `UPDATE users SET ${updateFields.join(
    ", "
  )} WHERE email_add = ?`;

  connection.query(sqlQuery, values, (err, result) => {
    if (err) {
      return res
        .status(500)
        .json({ status: "error", message: "Database error", err });
    }

    res.json({ status: "ok", message: "ข้อมูลผู้ใช้ถูกอัพเดทเรียบร้อยแล้ว" });
  });
};

// ดึงข้อมูลของผู้ใช้คนอื่น ๆ พร้อมกับระดับความชอบที่เคยตั้งไว้ (ถ้ามี)
exports.getAllUsersWithLikes = (req, res) => {
  const { user_id } = req.params;

  const query = `
    SELECT u.id, u.sname, u.email_add, u.sex, u.rank_play, u.images_user,
           COALESCE(ul.rating, 3) AS rating
    FROM users u
    LEFT JOIN user_likes ul ON ul.liked_user_id = u.id AND ul.user_id = ?
    WHERE u.id != ? AND (u.status_login != 'admin' OR u.status_login IS NULL)
  `;

  connection.query(query, [user_id, user_id], (err, results) => {
    if (err) {
      console.error("Error fetching users with likes:", err);
      return res.status(500).json({ error: "Failed to retrieve users" });
    }
    res.json(results);
  });
};

// อัปเดตระดับความชอบของผู้ใช้
exports.updateUserLikeRating = (req, res) => {
  const { user_id, liked_user_id } = req.params;
  const { rating } = req.body;

  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: "Rating must be between 1 and 5" });
  }

  const query = `
    INSERT INTO user_likes (user_id, liked_user_id, rating)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE rating = VALUES(rating), updated_at = CURRENT_TIMESTAMP;
  `;

  connection.query(query, [user_id, liked_user_id, rating], (err) => {
    if (err) {
      console.error("Error updating rating:", err);
      return res.status(500).json({ error: "Failed to update rating" });
    }

    res.json({ message: "Rating updated successfully" });
  });
};

// ข้อมูลโปรไฟล์ผู้ใช้งานคนอื่นที่กดเข้าไปดูโปรไฟล์ พร้อมระดับดาวที่ผู้ใช้ล็อกอินให้ไว้
exports.viewOtherUserProfile = async (req, res) => {
  const { id } = req.params;
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ message: "User ID is required in query" });
  }

  const query = `
    SELECT u.id, u.sname, u.email_add, u.phone, u.sex, u.rank_play, u.images_user,
           COALESCE(ul.rating, 0) AS rating
    FROM users u
    LEFT JOIN user_likes ul ON ul.liked_user_id = u.id AND ul.user_id = ?
    WHERE u.id = ?
  `;

  try {
    const [rows] = await connection.promise().execute(query, [user_id, id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = rows[0];
    user.rank_play = user.rank_play || "N/B";

    if (!user.images_user) {
      user.images_user = "/uploads/avatar-placeholder.png";
    } else {
      const imagePath = path.join(__dirname, "../uploads", user.images_user);
      if (!fs.existsSync(imagePath)) {
        user.images_user = "/uploads/avatar-placeholder.png";
      } else {
        user.images_user = `/uploads/${user.images_user}`;
      }
    }

    res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching user profile:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
