require("dotenv").config();
const imaps = require("imap-simple");
const config = require("./config");
const redisClient = require("./utils/redis_client");
const logger = require("./utils/logger"); // 로거 추가
const EmailService = require("./services/email_service"); // 중복 코드 제거를 위해 불러옴

// config.js에 등록된 허용된 통신사 도메인 목록 추출
const ALLOWED_DOMAINS = Object.values(config.EMAIL_DOMAIN);

// 지속적으로 새 메일을 확인하고 Redis에 저장하는 함수
async function startWorker() {
  let connection;
  let pollingInterval;
  let isProcessing = false; // 중복 실행 방지 플래그 추가

  try {
    logger.debug("[WORKER] 구글 IMAP 서버 접속 시도 중...");
    connection = await imaps.connect({ imap: config.IMAP_CONFIG });
    await connection.openBox("INBOX");
    logger.info("[WORKER] IMAP 연결 성공! 새 메일 실시간 감시 시작");

    const fetchNewMails = async () => {
      if (isProcessing) return; // 이미 작업 중이면 건너뜀
      isProcessing = true;

      try {
        const searchCriteria = ["UNSEEN"];
        const fetchOptions = {
          bodies: ["HEADER", "TEXT"],
          struct: true,
          markSeen: true,
        };

        const messages = await connection.search(searchCriteria, fetchOptions);

        for (const msg of messages) {
          const headerPart = msg.parts.find((p) => p.which === "HEADER");
          const fromHeader = headerPart.body.from[0];

          const emailMatch = fromHeader.match(
            /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/,
          );
          const senderEmail = emailMatch ? emailMatch[1] : null;

          if (!senderEmail) continue;

          // 도메인 검증
          const isAllowedSender = ALLOWED_DOMAINS.some((domain) =>
            senderEmail.endsWith(domain),
          );

          if (!isAllowedSender) {
            logger.debug(`[WORKER] 스팸/미허용 도메인 무시: ${senderEmail}`);
            continue;
          }

          // EmailService의 함수를 재사용하여 코드 중복 제거
          const code = await EmailService.extractEmailCode(msg);

          if (code) {
            await redisClient.setEx(`verify:${senderEmail}`, 300, code);
            logger.info(`[WORKER] 인증 코드 Redis 저장 완료: ${senderEmail}`);
          } else {
            logger.debug(`[WORKER] 메일 본문 내 코드 없음: ${senderEmail}`);
          }
        }
      } catch (err) {
        logger.error(`[WORKER-FETCH] 메일 처리 중 오류: ${err.message}`);
      } finally {
        isProcessing = false;
      }
    };

    // [트랙 1] IMAP 이벤트 감지
    connection.imap.on("mail", () => {
      logger.debug("[WORKER] 📧 새 메일 도착 이벤트 감지");
      fetchNewMails();
    });

    // [트랙 2] 안전장치 폴링 (10초)
    pollingInterval = setInterval(fetchNewMails, 10000);

    connection.on("error", (err) =>
      logger.error(`[WORKER-CONN] IMAP 오류: ${err.message}`),
    );

    connection.on("end", () => {
      logger.warn("[WORKER-CONN] 연결 종료됨. 5초 후 재시도...");
      clearInterval(pollingInterval);
      setTimeout(startWorker, 5000);
    });
  } catch (err) {
    logger.error(`[WORKER-FATAL] 치명적 오류: ${err.message}`);
    if (pollingInterval) clearInterval(pollingInterval);
    setTimeout(startWorker, 5000);
  }
}

startWorker();
