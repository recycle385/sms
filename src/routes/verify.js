const express = require("express");
const router = express.Router();
const config = require("../config");
const cryptoUtils = require("../utils/crypto_utils");
const VerifyService = require("../services/verify_service");
const redisClient = require("../utils/redis_client"); // Redis 모듈 불러오기
const logger = require("../utils/logger");

const {
  keyLimiter,
  requestLimiter,
  targetLimiter,
} = require("../utils/rate_limiter");

const SEARCH_QUEUE_KEY = "verify:search_queue";
const WORKER_CHANNEL = "worker_channel";

router.post("/request", requestLimiter, async (req, res) => {
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

    const rlKey = `rl:req:target:${phoneNumber}`;
    const attempts = await redisClient.incr(rlKey);
    if (attempts === 1) await redisClient.expire(rlKey, 60);
    if (attempts > 10) {
      logger.warn(`[RATE-LIMIT] /request target 초과: ${phoneNumber}`);
      return res.status(429).json({ error: "잠시 후 다시 시도해주세요." });
    }

    const targetSender = `${phoneNumber}@${config.EMAIL_DOMAIN[carrier]}`;

    const mailCode = await redisClient.get(`verify:${targetSender}`);

    if (!mailCode) {
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
    await redisClient.zRem(SEARCH_QUEUE_KEY, targetSender);

    return res.status(200).json({ message: "telephone_Verification_Success" });
  } catch (err) {
    logger.error("[ERROR] 인증 라우터 오류:", err);
    return res.status(500).json({ error: err.message });
  }
});

router.post("/key", targetLimiter, keyLimiter, async (req, res) => {
  try {
    const challengeCode = req.body.d;
    const phoneNumber = req.body.p;
    const carrier = req.body.c;

    if (!challengeCode || !phoneNumber || !carrier) {
      return res.status(400).json({ error: "필수 데이터 누락" });
    }

    if (!config.EMAIL_DOMAIN[carrier]) {
      return res.status(400).json({ error: "지원하지 않는 통신사" });
    }

    if (!/^\d{10,11}$/.test(phoneNumber)) {
      return res.status(400).json({ error: "유효하지 않은 전화번호" });
    }

    const hmacResponse = cryptoUtils.generateHmacResponse(challengeCode);

    const nowSec = Math.floor(Date.now() / 1000);
    const startAt = nowSec;
    const targetSender = `${phoneNumber}@${config.EMAIL_DOMAIN[carrier]}`;

    await redisClient.del(`verify:${targetSender}`);

    await redisClient.zAdd(SEARCH_QUEUE_KEY, {
      score: startAt,
      value: targetSender,
    });

    await redisClient.expire(SEARCH_QUEUE_KEY, 120);

    await redisClient.publish(WORKER_CHANNEL, "start");

    logger.info(
      `[API] 탐색 예약: search:${targetSender} (StartAt: ${startAt})`,
    );

    return res.json({ hmac: hmacResponse });
  } catch (err) {
    logger.error("[ERROR] /key 오류:", err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
