const express = require("express");
const router = express.Router();
const config = require("../config");
const cryptoUtils = require("../utils/crypto_utils");
const VerifyService = require("../services/verify_service");
const redisClient = require("../utils/redis_client"); // Redis 모듈 불러오기
const logger = require("../utils/logger");

router.post("/request", async (req, res) => {
  try {
    const encryptedData = req.body.d;
    if (!encryptedData)
      return res.status(400).json({ error: "No data provided" });

    // 1. RSA 복호화
    const decrypted = cryptoUtils.decryptWithRsa(encryptedData);
    const [
      phoneNumber,
      carrier,
      sFingerprint,
      sChallengeCode,
      sHmac,
      sTimeStamp,
    ] = decrypted.split("|");

    if (!config.EMAIL_DOMAIN[carrier]) {
      return res.status(400).json({ error: "지원하지 않는 통신사입니다." });
    }

    const targetSender = `${phoneNumber}@${config.EMAIL_DOMAIN[carrier]}`;

    const mailCode = await redisClient.get(`verify:${targetSender}`);

    if (!mailCode) {
      // 워커가 아직 메일을 처리하지 못했거나, 메일이 안 온 상태
      return res
        .status(404)
        .json({ message: "유효한 인증 코드가 없습니다 (잠시 후 다시 시도)" });
    }

    // 3. 순수 검증 로직 진행
    const decodedMailCode = cryptoUtils.decodeString(mailCode);
    const [mFingerprint, mChallengeCode, mHmac, mTimeStamp] =
      decodedMailCode.split("|");

    const validationResult = VerifyService.validateMailData(
      { sFingerprint, sChallengeCode, sTimeStamp },
      { mFingerprint, mChallengeCode, mHmac, mTimeStamp },
    );

    if (!validationResult.success) {
      return res.status(400).json({ error: validationResult.error });
    }

    // 4. 인증 성공 시, 재사용 방지를 위해 Redis에서 데이터 삭제
    await redisClient.del(`verify:${targetSender}`);

    return res.status(200).json({ message: "telephone_Verification_Success" });
  } catch (err) {
    logger.error("[ERROR] 인증 라우터 오류:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.post("/key", (req, res) => {
  // 기존 코드 동일 유지
  try {
    const challengeCode = req.body.d;
    if (!challengeCode)
      return res.status(400).json({ error: "No challenge code provided" });
    const hmacResponse = cryptoUtils.generateHmacResponse(challengeCode);
    return res.json({ hmac: hmacResponse });
  } catch (err) {
    logger.error("[ERROR] 인증 라우터 오류:", err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
