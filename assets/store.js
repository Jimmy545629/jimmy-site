/* store.js —— 数据的唯一出入口（读、写、导出、导入）。
   全项目只有这个文件可以直接碰 localStorage（AGENTS.md 第 4 条第 6 项，TC-09）。
   将来要换成云端数据库，只改这一个文件就够了。 */

(function (global) {
  'use strict';

  var CFG = global.SB_CONFIG;

  /* ---------- 时间工具：统一存成带时区的 ISO 8601 ---------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* 生成 "2026-09-20T21:12:18+08:00" 这种写法。
     存的时候一律用这个格式，只在显示的时候才变成「今天 / 3 天前」。 */
  function toISO(date) {
    var d = date ? new Date(date) : new Date();
    var off = -d.getTimezoneOffset();          // 东八区是 +480 分钟
    var sign = off >= 0 ? '+' : '-';
    var abs = Math.abs(off);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
      sign + pad2(Math.floor(abs / 60)) + ':' + pad2(abs % 60);
  }

  function nowISO() { return toISO(new Date()); }

  /* 导出文件名里用的日期戳，例如 2026-09-22 */
  function dateStamp(date) {
    var d = date ? new Date(date) : new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* 给来源和条目生成内部编号，页面上不显示给用户看 */
  function newId(prefix) {
    return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- 空数据的样子 / 数据是否像样 ---------- */

  function emptyData() {
    return { schemaVersion: CFG.SCHEMA_VERSION, sources: [], items: [] };
  }

  function looksLikeData(obj) {
    return !!obj && typeof obj === 'object' &&
      Array.isArray(obj.sources) && Array.isArray(obj.items);
  }

  /* ---------- 读 / 写：整份读出、整份写回 ---------- */
  /* 不搞「改一半存一半」，这样不会出现中间状态的数据。 */

  function load() {
    var raw = null;
    try { raw = global.localStorage.getItem(CFG.STORAGE_KEY); }
    catch (e) { return emptyData(); }              // 浏览器不让用存储
    if (!raw) return emptyData();

    var parsed = null;
    try { parsed = JSON.parse(raw); }
    catch (e) { return emptyData(); }              // 存的字符串坏了

    if (!looksLikeData(parsed)) return emptyData();

    return {
      schemaVersion: parsed.schemaVersion || CFG.SCHEMA_VERSION,
      sources: parsed.sources,
      items: parsed.items
    };
  }

  function save(data) {
    global.localStorage.setItem(CFG.STORAGE_KEY, JSON.stringify({
      schemaVersion: CFG.SCHEMA_VERSION,
      sources: data.sources,
      items: data.items
    }));
  }

  /* ---------- 导出：把数据变成磁盘上一个能双击打开的文件 ---------- */
  /* 硬约束 C2 就落在这里：数据必须能变成一个我能直接打开、直接拷走的文件。 */

  function buildExportText(data) {
    var payload = {
      schemaVersion: CFG.SCHEMA_VERSION,
      app: 'sourceboard',
      exportedAt: nowISO(),
      sources: data.sources,
      items: data.items
    };
    return JSON.stringify(payload, null, 2);        // 缩进 2 格，人看着舒服
  }

  function exportFileName() { return 'sourceboard-' + dateStamp() + '.json'; }

  function exportData(data) {
    var name = exportFileName();
    var blob = new global.Blob([buildExportText(data)], { type: 'application/json;charset=utf-8' });
    var url = global.URL.createObjectURL(blob);
    var a = global.document.createElement('a');
    a.href = url;
    a.download = name;
    global.document.body.appendChild(a);
    a.click();
    global.document.body.removeChild(a);
    global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 2000);
    return name;                                    // 返回文件名，界面上可以提示
  }

  /* ---------- 导入：全项目唯一一个会覆盖数据的操作 ---------- */
  /* 顺序是「先备份、再覆盖」：导入前自动把当前数据导出一份，
     万一导入错了还找得回来（TECH_DESIGN 3.4 / TC-07）。 */

  function importFromFile(file, done) {
    var reader = new global.FileReader();

    reader.onerror = function () {
      done({ ok: false, message: '读这个文件出错了，没能读进来。' });
    };

    reader.onload = function () {
      var parsed = null;
      try { parsed = JSON.parse(String(reader.result)); }
      catch (e) {
        done({ ok: false, message: '这个文件读不出内容，它可能不是来源看板导出的 JSON 文件。' });
        return;
      }
      if (!looksLikeData(parsed)) {
        done({ ok: false, message: '这个文件里没有 sources 和 items 两份数据，不敢拿它覆盖现在的东西。' });
        return;
      }

      var backupName = null;
      var backupOK = true;
      try { backupName = exportData(load()); }      // 先备份当前数据
      catch (e) { backupOK = false; }

      save({ sources: parsed.sources, items: parsed.items });   // 再覆盖

      done({
        ok: true,
        message: backupOK
          ? '导入完成（' + parsed.sources.length + ' 个来源 / ' + parsed.items.length +
            ' 条记录）。导入前的旧数据已自动备份成 ' + backupName
          : '导入完成，但自动备份没成功（浏览器拦住了下载）。数据已经被替换，请注意。'
      });
    };

    reader.readAsText(file);
  }

  global.SBStore = {
    toISO: toISO,
    nowISO: nowISO,
    dateStamp: dateStamp,
    newId: newId,
    emptyData: emptyData,
    looksLikeData: looksLikeData,
    load: load,
    save: save,
    exportData: exportData,
    exportFileName: exportFileName,
    importFromFile: importFromFile
  };
})(window);
