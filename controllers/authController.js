const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const connection = require("../config/db");
const otpGenerator = require("otp-generator");
const { sendOtpEmail } = require("../utils/emailService");

const secret = "login-api";

// exports.login = (req, res) => {
//   connection.execute(
//     "SELECT * FROM users WHERE email_add=?",
//     [req.body.email_add],
//     function (err, users) {
//       if (err) {
//         console.log("ผู้ใช้เข้าสู่ระบบ:", users[0]);
//         return res.status(500).json({ status: "error", message: err });
//       }
//       if (users.length === 0) {
//         return res.status(404).json({
//           status: "error",
//           message: "User not found",
//         });
//       }

//       bcrypt.compare(req.body.password, users[0].password, (err, isLogin) => {
//         if (err) {
//           return res.status(500).json({
//             status: "error",
//             message: "Server error",
//           });
//         }

//         if (isLogin) {
//           // const token = jwt.sign({ email_add: users[0].email_add }, secret, {
//           //   expiresIn: "1h",
//           // });
//           const token = jwt.sign({ email_add: users[0].email_add }, secret);

//           //   Token out time
//           // const expirationTime = Math.floor(Date.now() / 1000) + 3600;
//           res.json({
//             status: "ok",
//             message: "Login success",
//             token,
//             // expirationTime,
//             id: users[0].id,
//             sname: users[0].sname,
//             email_add: users[0].email_add,
//             phone: users[0].phone,
//             sex: users[0].sex,
//             images_user: users[0].images_user,
//             status_login: users[0].status_login,
//           });
//         } else {
//           res.status(401).json({
//             status: "error",
//             message: "Login failed",
//           });
//         }
//       });
//     }
//   );
// };

// ตรวจสอบ Token ว่ามีอยู่ในระบบขณะนี้
exports.authen = (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        status: "error",
        message: "No token provided",
        action: "logout",
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, secret);
    res.json({ status: "Authen ok", decoded });
  } catch (err) {
    res.status(401).json({
      status: "error",
      message: err.message,
      action: "logout",
    });
  }
};

exports.login = async (req, res) => {
  const { email_add, password } = req.body;

  try {
    const [users] = await connection
      .promise()
      .execute("SELECT * FROM users WHERE email_add = ?", [email_add]);

    if (!users || users.length === 0) {
      return res.status(404).json({ message: "ไม่พบอีเมลนี้ในระบบ" });
    }

    const user = users[0];
    const isLogin = await bcrypt.compare(password, user.password);
    if (!isLogin) {
      return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
    }

    const token = jwt.sign({ email_add: user.email_add }, secret);
    // const expirationTime = Math.floor(Date.now() / 1000) + 7200;

    res.json({
      status: "ok",
      message: "Login success",
      token,
      // expirationTime,
      id: user.id,
      sname: user.sname,
      email_add: user.email_add,
      phone: user.phone,
      sex: user.sex,
      images_user: user.images_user,
      status_login: user.status_login,
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
  }
};

// สมัครสมาชิกและ hash password
exports.register = (req, res) => {
  const saltRounds = 10;
  const { sname, email_add, password, phone, sex, status_login } = req.body;

  bcrypt.hash(password, saltRounds, function (err, hash) {
    if (err) {
      return res.status(500).json({ status: "error", message: err.message });
    }

    // บันทึกข้อมูลลงฐานข้อมูล
    connection.execute(
      "INSERT INTO users (sname, email_add, password, phone, sex, status_login) VALUES (?, ?, ?, ?, ?, ?)",
      [sname, email_add, hash, phone, sex, status_login],
      function (err, result) {
        if (err) {
          if (err.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
              status: "error",
              message:
                "อีเมลล์นี้มีการสมัครสมาชิกไปแล้วเรียบร้อย, กรุณาเปลี่ยนเป็นอีเมลล์อื่น",
            });
          } else {
            return res
              .status(500)
              .json({ status: "error", message: err.message });
          }
        }

        res.json({ status: "ok", message: "สมัครสมาชิกเรียบร้อย!" });
      }
    );
  });
};

// ส่ง OTP ไปอีเมล
exports.sendOtp = (req, res) => {
  const { email_add } = req.body;

  connection.query(
    "SELECT * FROM users WHERE email_add = ?",
    [email_add],
    async (err, result) => {
      if (err) return res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
      if (result.length === 0) {
        return res.status(404).json({ message: "ไม่พบอีเมลนี้ในระบบ" });
      }

      const otp = otpGenerator.generate(6, {
        upperCaseAlphabets: false,
        specialChars: false,
      });

      try {
        await sendOtpEmail(email_add, otp);

        connection.query(
          "UPDATE users SET otp = ? WHERE email_add = ?",
          [otp, email_add],
          (err) => {
            if (err) {
              return res
                .status(500)
                .json({ message: "เกิดข้อผิดพลาดในการบันทึก OTP" });
            }
            res.status(200).json({ message: "ส่ง OTP เรียบร้อยแล้ว", otp });
          }
        );
      } catch (error) {
        res
          .status(500)
          .json({ message: "ไม่สามารถส่งอีเมลได้", error: error.message });
      }
    }
  );
};

// รีเซ็ตรหัสผ่าน
exports.resetPassword = (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !newPassword || !otp) {
    return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
  }

  connection.query(
    "SELECT * FROM users WHERE email_add = ? AND otp = ?",
    [email, otp],
    async (err, result) => {
      if (err)
        return res.status(500).json({ message: "เชื่อมต่อฐานข้อมูลล้มเหลว" });
      if (result.length === 0) {
        return res
          .status(404)
          .json({ message: "OTP ไม่ถูกต้องหรือไม่พบอีเมลนี้ในระบบ" });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);

      connection.query(
        "UPDATE users SET password = ?, otp = NULL WHERE email_add = ?",
        [hashedPassword, email],
        (err) => {
          if (err)
            return res
              .status(500)
              .json({ message: "เกิดข้อผิดพลาดในการอัปเดต" });
          res.status(200).json({ message: "เปลี่ยนรหัสผ่านสำเร็จ" });
        }
      );
    }
  );
};
