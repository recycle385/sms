const express = require("express");
const verifyRouter = require("./routes/verify");
const logger = require("./utils/logger"); // 로거 추가

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/verify", verifyRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

app.listen(PORT, "0.0.0.0", () => {
  // console.log 대신 logger.info 사용
  logger.info(`Node.js API 서버가 포트 ${PORT}에서 실행 중입니다.`);
});
