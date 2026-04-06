if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}
const redisClient = require("./utils/redis_client");
const logger = require("./utils/logger");
const EmailService = require("./services/email_service");

const SEARCH_QUEUE_KEY = "verify:search_queue";
const WORKER_CHANNEL = "worker_channel";
const SEARCH_TIMEOUT_SEC = 40;
const LOOP_INTERVAL_MS = 3000;

let loopTimer = null;

async function runLoop() {
  try {
    const nowSec = Math.floor(Date.now() / 1000);

    const members = await redisClient.zRangeByScore(
      SEARCH_QUEUE_KEY,
      "-inf",
      nowSec,
    );

    if (members.length === 0) {
      logger.info("[WORKER] 대기 유저 없음. 루프 종료 → 구독 대기 전환");
      stopLoop();
      return;
    }

    const timedOutMembers = await redisClient.zRangeByScoreWithScores(
      SEARCH_QUEUE_KEY,
      "-inf",
      nowSec - SEARCH_TIMEOUT_SEC,
    );

    if (timedOutMembers.length > 0) {
      for (const { value: sender } of timedOutMembers) {
        logger.warn(`[WORKER] 타임아웃 제거: ${sender}`);
        await redisClient.zRem(SEARCH_QUEUE_KEY, sender);
        await redisClient.del(`verify:${sender}`);
      }
    }

    const validSenders = members.filter(
      (m) => !timedOutMembers.some((t) => t.value === m),
    );

    if (validSenders.length > 0) {
      logger.debug(`[GMAIL-FETCH] ${validSenders.length}명 탐색 중...`);
      await EmailService.fetchAndMatchMails(validSenders);
    }
  } catch (err) {
    logger.error(`[WORKER-LOOP] 오류: ${err.message}`);
  }
}

function startLoop() {
  if (loopTimer) return;
  logger.info("[WORKER] 루프 시작");
  loopTimer = setInterval(runLoop, LOOP_INTERVAL_MS);
  runLoop();
}

function stopLoop() {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
}

async function startWorker() {
  const subscriber = redisClient.duplicate();

  subscriber.on("error", (err) =>
    logger.error(`[SUBSCRIBER ERROR] ${err.message}`),
  );

  await subscriber.connect();

  await subscriber.subscribe(WORKER_CHANNEL, (message) => {
    logger.info(`[WORKER] 신호 수신: "${message}" → 루프 가동`);
    startLoop();
  });

  logger.info("[WORKER] SUBSCRIBE 대기 중...");
}

startWorker();
