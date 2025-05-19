const jwt = require("jsonwebtoken");
const secret = "login-api";

// Middleware ตรวจสอบ JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      status: "error",
      message: "No token provided",
      action: "logout", // ใช้สำหรับ frontend ล้างข้อมูล
    });
  }

  jwt.verify(token, secret, (err, user) => {
    if (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({
          status: "error",
          message: "Token expired",
          action: "logout", // ให้ frontend redirect + clear
        });
      }
      return res.status(403).json({
        status: "error",
        message: "Invalid token",
        action: "logout",
      });
    }
    req.user = user;
    next();
  });
}

module.exports = authenticateToken;
