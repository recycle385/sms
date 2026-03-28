const config = require("../config");

// 로그 레벨 우선순위 정의
const levels = { error: 0, warn: 1, info: 2, debug: 3 };

const logger = {
  error: (msg, ...args) => {
    if (levels[config.LOG_LEVEL] >= levels.error)
      console.error(`[ERROR] ${msg}`, ...args);
  },
  warn: (msg, ...args) => {
    if (levels[config.LOG_LEVEL] >= levels.warn)
      console.warn(`[WARN] ${msg}`, ...args);
  },
  info: (msg, ...args) => {
    if (levels[config.LOG_LEVEL] >= levels.info)
      console.log(`[INFO] ${msg}`, ...args);
  },
  debug: (msg, ...args) => {
    if (levels[config.LOG_LEVEL] >= levels.debug)
      console.log(`[DEBUG] ${msg}`, ...args);
  },
};

module.exports = logger;
