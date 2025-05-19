const connection = require("../config/db");

// ดึงผู้ใช้ทั้งหมด
exports.getAllUsers = (req, res) => {
  const query = "SELECT * FROM users";
  connection.query(query, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
};

// ลบผู้ใช้ตาม id
exports.deleteUserById = (req, res) => {
  const { id } = req.params;
  const query = "DELETE FROM users WHERE id = ?";
  connection.query(query, [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "User deleted" });
  });
};

// แก้ไข rank_play ของผู้ใช้
exports.updateUserRank = (req, res) => {
  const { id } = req.params;
  const { rank_play } = req.body;
  const query = "UPDATE users SET rank_play = ? WHERE id = ?";
  connection.query(query, [rank_play, id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "อัปเดตระดับการเล่นเรียบร้อยแล้ว" });
  });
};


