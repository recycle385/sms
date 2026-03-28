const imaps = require("imap-simple");
const { simpleParser } = require("mailparser");
const config = require("../config");
const logger = require("../utils/logger"); // 로거 추가

const EmailService = {
  /**
   * 이메일 본문에서 인증 코드 추출
   */
  extractEmailCode: async (message) => {
    try {
      const all = message.parts.find(
        (part) => part.which === "TEXT" || part.which === "",
      );
      const id = message.attributes.uid;
      const idHeader = "Imap-Id: " + id + "\r\n";

      const mail = await simpleParser(idHeader + all.body);
      const body = mail.text || "";

      const extractedCode = body.split("====")[0].trim();
      if (extractedCode.length >= 60 && extractedCode.length <= 100) {
        logger.debug(
          `[IMAP-EXTRACT] 코드 추출 성공: ${extractedCode.substring(0, 10)}...`,
        ); // 상세 데이터는 debug
        return extractedCode;
      }
      return null;
    } catch (err) {
      logger.error(`[IMAP-EXTRACT] 이메일 코드 추출 실패: ${err.message}`); // 에러 발생 시
      return null;
    }
  },

  /**
   * IMAP에 연결하여 최근 메일에서 인증 코드를 가져옴
   */
  fetchLatestCode: async (targetSender) => {
    let connection;
    try {
      logger.debug(`[IMAP-FETCH] '${targetSender}' 연결 시도 중...`);
      connection = await imaps.connect({ imap: config.IMAP_CONFIG });
      await connection.openBox("INBOX");
      logger.debug("[IMAP-FETCH] INBOX 열기 성공. 연결 완료.");

      const delay = 5 * 60 * 1000; // 5분
      const fiveMinutesAgo = new Date();
      fiveMinutesAgo.setTime(Date.now() - delay);

      logger.debug(
        `[IMAP-SEARCH] 검색 조건: ${targetSender}, SINCE: ${fiveMinutesAgo.toISOString()}`,
      );

      const searchCriteria = [
        ["FROM", targetSender],
        ["SINCE", fiveMinutesAgo.toISOString()],
      ];
      const fetchOptions = { bodies: ["HEADER", "TEXT"], struct: true };

      const messages = await connection.search(searchCriteria, fetchOptions);
      logger.debug(`[IMAP-RESULT] 검색된 메일 총 개수: ${messages.length}개`);

      // 최근 3개 이메일만 확인 (뒤에서부터 3개)
      const targetMessages = messages.slice(-3).reverse();

      for (let i = 0; i < targetMessages.length; i++) {
        const msg = targetMessages[i];
        logger.debug(`[IMAP-CHECK] 메일 #${i + 1} 추출 시도...`);
        const extracted = await EmailService.extractEmailCode(msg);

        if (extracted) {
          logger.info(`[IMAP-SUCCESS] 유효 코드 발견: ${targetSender}`); // 성공 시 info
          return extracted;
        }
      }

      logger.debug(`[IMAP-FAIL] '${targetSender}'로부터 유효 코드를 찾지 못함`);
      return null;
    } catch (err) {
      logger.error(`[IMAP-FATAL] 메일 가져오기 중 치명적 오류: ${err.message}`);
      return null;
    } finally {
      if (connection) {
        logger.debug("[IMAP-CLOSE] 연결 종료 중...");
        connection.end();
      }
    }
  },
};

module.exports = EmailService;
