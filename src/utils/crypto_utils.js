const crypto = require("crypto");
const config = require("../config");
const logger = require("./logger"); // 로거 추가

/**
 * RSA 복호화 (PKCS1_OAEP)
 */
function decryptWithRsa(encryptedData) {
  if (!encryptedData) {
    logger.warn("[CRYPTO-RSA] 복호화할 데이터가 없습니다.");
    throw new Error("No data provided");
  }

  if (encryptedData.length > config.MAX_DECRYPT_SIZE) {
    logger.error(
      `[CRYPTO-RSA] 데이터 크기 초과: ${encryptedData.length} bytes`,
    );
    throw new Error("입력 데이터가 최대 허용 크기를 초과했습니다.");
  }

  try {
    logger.debug("[CRYPTO-RSA] 복호화 시도 중...");

    // [수정 포인트] \n 문자열을 실제 줄바꿈 문자로 변환
    const privateKey = config.P_K_CONTENT.replace(/\\n/g, "\n");

    const base64 = encryptedData.replace(/-/g, "+").replace(/_/g, "/");
    const buffer = Buffer.from(base64, "base64");

    const decrypted = crypto.privateDecrypt(
      {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha1",
      },
      buffer,
    );

    logger.debug("[CRYPTO-RSA] 복호화 성공");
    return decrypted.toString("utf8");
  } catch (err) {
    logger.error(`[CRYPTO-RSA] 복호화 실패: ${err.message}`);
    throw new Error(`RSA 복호화 실패: ${err.message}`);
  }
}

/**
 * HMAC-SHA256 응답 생성
 */
function generateHmacResponse(challengeCode) {
  if (!config.HMAC_KEY) {
    logger.error("[CRYPTO-HMAC] 환경변수 'HMAC_KEY' 누락");
    throw new Error("환경변수 'HMAC_KEY'가 설정되지 않았습니다.");
  }

  const hmac = crypto
    .createHmac("sha256", config.HMAC_KEY)
    .update(challengeCode)
    .digest("hex");

  return hmac.slice(config.HMAC_SLICE_START, config.HMAC_SLICE_END);
}

/**
 * 챌린지 코드 생성 (SHA256)
 */
function generateChallengePlain(text, timeStamp) {
  const plain = `${text}|${timeStamp}`;
  const hash = crypto.createHash("sha256").update(plain).digest("hex");

  return hash.slice(config.CHALLENGE_SLICE_START, config.CHALLENGE_SLICE_END);
}

/**
 * Base64url 디코딩
 */
function decodeString(encodedStr) {
  try {
    const base64 = encodedStr.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(base64, "base64").toString("utf8");
  } catch (err) {
    logger.error(`[CRYPTO-DECODE] 디코딩 실패: ${err.message}`);
    throw new Error(`디코딩 실패: ${err.message}`);
  }
}

module.exports = {
  decryptWithRsa,
  generateHmacResponse,
  generateChallengePlain,
  decodeString,
};
