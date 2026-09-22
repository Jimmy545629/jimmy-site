/* config.js —— 全站常量只在这里出现一次。
   别的文件要用「几天算该看了」「最多几个来源」，一律写 SB_CONFIG.XXX，
   不许再写一个 7 或 5 出来（AGENTS.md 第 4 条第 7 项，TC-08 会逐文件检查）。 */

window.SB_CONFIG = {
  STALE_DAYS: 7,                        // 「多久没记录算该看了」——PRD F2
  MAX_SOURCES: 5,                       // 来源上限——PRD 硬约束 C3
  STORAGE_KEY: 'sourceboard.data.v1',   // 数据存在浏览器哪个格子里
  SCHEMA_VERSION: 1                     // 导出文件的格式版本号
};
