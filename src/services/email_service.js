const { google } = require("googleapis");
const { simpleParser } = require("mailparser");
const config = require("../config");
const logger = require("../utils/logger");
const redisClient = require("../utils/redis_client");

const SEARCH_QUEUE_KEY = "verify:search_queue";
const MAIL_SIZE_LIMIT = 5 * 1024; // 10KB

const oauth2Client = new google.auth.OAuth2(
  config.GMAIL_CONFIG.clientId,
  config.GMAIL_CONFIG.clientSecret,
);
oauth2Client.setCredentials({
  refresh_token: config.GMAIL_CONFIG.refreshToken,
});

const gmail = google.gmail({ version: "v1", auth: oauth2Client });

function buildCarrierQuery() {
  const domains = Object.values(config.EMAIL_DOMAIN).filter(Boolean);
  if (domains.length === 0) return "is:unread";
  return `from:(${domains.join(" OR ")}) is:unread`;
}

function isAuthValid(parsedMail) {
  const authResults = parsedMail.headers.get("authentication-results");
  if (!authResults) {
    logger.warn("[GMAIL-AUTH] authentication-results 헤더 없음 → 무시");
    return false;
  }
  const headerStr = Array.isArray(authResults)
    ? authResults.join(" ")
    : String(authResults);

  const spfPass = /spf=pass/i.test(headerStr);
  const dkimPass = /dkim=pass/i.test(headerStr);

  if (!spfPass && !dkimPass) {
    logger.warn(`[GMAIL-AUTH] SPF/DKIM 모두 실패 → 위조 메일 의심, 무시`);
    return false;
  }
  return true;
}

const EmailService = {
  fetchAndMatchMails: async (validSenders) => {
    try {
      const query = buildCarrierQuery();

      // 1. 읽지 않은 메일 목록 조회
      const res = await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: validSenders.length + 1, // 여유분 1
      });

      if (!res.data.messages) return;

      for (const msgInfo of res.data.messages) {
        // 2. 메일을 "원본(Raw)" 포맷으로 가져오기
        const meta = await gmail.users.messages.get({
          userId: "me",
          id: msgInfo.id,
          format: "metadata",
          metadataHeaders: ["From", "Authentication-Results"],
        });

        if ((meta.data.sizeEstimate || 0) > MAIL_SIZE_LIMIT) {
          logger.warn(
            `[GMAIL-SIZE] 크기 초과 메일 폐기: ${meta.data.sizeEstimate} bytes`,
          );
          continue;
        }

        const msg = await gmail.users.messages.get({
          userId: "me",
          id: msgInfo.id,
          format: "raw",
        });

        if (!msg.data.raw) continue;

        // 3. Base64url 디코딩 후 버퍼로 변환
        const base64 = msg.data.raw.replace(/-/g, "+").replace(/_/g, "/");
        const buffer = Buffer.from(base64, "base64");

        const parsedMail = await simpleParser(buffer);

        await gmail.users.messages.batchModify({
          userId: "me",
          requestBody: { ids: [msgInfo.id], removeLabelIds: ["UNREAD"] },
        });

        if (!isAuthValid(parsedMail)) continue;

        // 보낸 사람 주소 추출
        const sender = parsedMail.from?.value[0]?.address;

        if (sender && validSenders.includes(sender)) {
          const body = parsedMail.text || parsedMail.textAsHtml || "";
          const extractedCode = body.split("====")[0].trim();

          if (extractedCode.length >= 60) {
            await redisClient.setEx(`verify:${sender}`, 300, extractedCode);
            await redisClient.zRem(SEARCH_QUEUE_KEY, sender);

            logger.info(`[GMAIL-SUCCESS] 코드 획득: ${sender}`);
          } else {
            logger.warn(
              `[GMAIL-WARN] 추출 실패 - 본문 길이 미달 (${extractedCode.length}자)`,
            );
          }
        }
      }
    } catch (err) {
      logger.error(`[GMAIL-API] 오류: ${err.message}`);
    }
  },
};

module.exports = EmailService;
