const cryptoUtils = require("../utils/crypto_utils");
const logger = require("../utils/logger");

/**
 * 추출된 메일 코드와 서버 데이터를 비교 검증하는 순수 서비스
 */
const VerifyService = {
  validateMailData: (serverParams, mailParams) => {
    const { sFingerprint, sChallengeCode, sTimeStamp } = serverParams;
    const { mFingerprint, mChallengeCode, mHmac, mTimeStamp } = mailParams;

    logger.debug(`[VERIFY-START] 검증 프로세스 시작`);

    // 1. TimeStamp 비교
    if (mTimeStamp !== sTimeStamp) {
      logger.warn(
        `[VERIFY-FAIL] TimeStamp 불일치 (S:${sTimeStamp} / M:${mTimeStamp})`,
      );
      return { success: false, error: "TimeStamp 불일치" };
    }
    logger.debug(`[VERIFY-OK] 1/4 TimeStamp 일치`);

    // 2. Fingerprint 비교
    if (mFingerprint !== sFingerprint) {
      logger.warn(`[VERIFY-FAIL] Fingerprint 불일치`);
      return { success: false, error: "Fingerprint 불일치" };
    }
    logger.debug(`[VERIFY-OK] 2/4 Fingerprint 일치`);

    // 3. ChallengeCode 비교
    const expectedChallenge = cryptoUtils.generateChallengePlain(
      sFingerprint,
      sTimeStamp,
    );
    if (mChallengeCode !== expectedChallenge) {
      logger.warn(`[VERIFY-FAIL] ChallengeCode 불일치`);
      return { success: false, error: "ChallengeCode 불일치" };
    }
    logger.debug(`[VERIFY-OK] 3/4 ChallengeCode 일치`);

    // 4. HMAC 비교
    const expectedHmac = cryptoUtils.generateHmacResponse(sChallengeCode);
    if (mHmac !== expectedHmac) {
      logger.warn(
        `[VERIFY-FAIL] HMAC 불일치 (Expected: ${expectedHmac} / Mail: ${mHmac})`,
      );
      return { success: false, error: "HMAC 불일치" };
    }
    logger.debug(`[VERIFY-OK] 4/4 HMAC 일치`);

    logger.info(`[VERIFY-SUCCESS] 모든 검증 통과: ${sFingerprint}`);
    return { success: true };
  },
};

module.exports = VerifyService;
