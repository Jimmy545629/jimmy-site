/* rules.js —— 只做计算，不碰数据（不碰 localStorage）、不碰界面（不碰 DOM）。
   里面全是「纯函数」：给同样的输入，永远算出同样的结果。
   算得对不对，全看这个文件；画得好不好看，不归它管。 */

(function (global) {
  'use strict';

  var CFG = global.SB_CONFIG;

  /* 把任意时间抹成「那一天的 0 点」，用来按自然日算天数 */
  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function timeOf(iso) {
    var t = new Date(iso).getTime();
    return isNaN(t) ? null : t;
  }

  /* 「X 天前」怎么算（TECH_DESIGN 5.1 单独写清楚过）：
     两边都先抹掉时分秒、只留日期再相减——这是「自然日」算法。
     不许用「现在时间减记录时间再除以 24 小时」，
     否则 18 号 23:50 的记录到 20 号 00:10 会算成 1 天，跟直觉对不上。 */
  function daysSince(fromISO, now) {
    var t = timeOf(fromISO);
    if (t === null) return null;
    var a = new Date(t);
    var base = now ? new Date(now) : new Date();
    return Math.round((startOfDay(base) - startOfDay(a)) / 86400000);   // 86400000 = 一天的毫秒数
  }

  /* 挑出某个来源下的全部条目 */
  function itemsOfSource(sourceId, items) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].sourceId === sourceId) out.push(items[i]);
    }
    return out;
  }

  /* 一个来源的「派生值」：不单独存，每次打开时算出来（PRD 4.1） */
  function statsOf(source, items, now) {
    var mine = itemsOfSource(source.id, items);

    var last = null;                                // 最新的那条记录时间
    for (var i = 0; i < mine.length; i++) {
      var t = mine[i].recordedAt;
      if (!t) continue;
      if (last === null || (timeOf(t) || 0) > (timeOf(last) || 0)) last = t;
    }

    var stat = {
      source: source,
      itemCount: mine.length,
      lastRecordedAt: last,                         // null = 从来没记录过
      daysSince: last === null ? null : daysSince(last, now),
      isStale: false                                // 要不要标红
    };

    /* 「该看了」的判断（PRD F2 / TECH_DESIGN 5.2）：
       从来没记录过 → 算该看了；天数 ≥ 阈值 → 算该看了 */
    stat.isStale = (last === null) || (stat.daysSince >= CFG.STALE_DAYS);
    return stat;
  }

  function allStats(sources, items, now) {
    var out = [];
    for (var i = 0; i < sources.length; i++) out.push(statsOf(sources[i], items, now));
    return out;
  }

  /* 来源卡片排序：按加入顺序固定排（PRD F1 明确要求）。
     刻意不按「最久没记录」排——卡片位置天天跳会让人找不到东西。 */
  function sortSources(sources) {
    return sources.slice().sort(function (a, b) {
      var x = timeOf(a.createdAt) || 0;
      var y = timeOf(b.createdAt) || 0;
      if (x !== y) return x - y;
      return String(a.id) < String(b.id) ? -1 : 1;   // 兜底，保证顺序永远稳定
    });
  }

  /* 时间线排序：先按「记录时间」从新到旧；
     时间一模一样时，再按「贴进来的时间」从新到旧。
     第二个排序键是为了 PRD AC-07「同一天的多条按保存先后，不能乱」——
     因为「记录时间」是允许手改的，改完很可能撞在一起。 */
  function sortItems(items) {
    return items.slice().sort(function (a, b) {
      var r = (timeOf(b.recordedAt) || 0) - (timeOf(a.recordedAt) || 0);
      if (r !== 0) return r;
      var s = (timeOf(b.savedAt) || timeOf(b.recordedAt) || 0) -
              (timeOf(a.savedAt) || timeOf(a.recordedAt) || 0);
      if (s !== 0) return s;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
  }

  /* 首页顶部那句话该点名谁（PRD F2 / AC-04）。
     返回 { kind, stat }：
       kind = 'none'       一个来源都还没建 → 顶部不显示
       kind = 'all-fresh'  所有来源都在阈值内记录过 → 不点名任何来源
       kind = 'focus'      点名一个最该看的 */
  function pickFocus(stats) {
    if (!stats.length) return { kind: 'none' };

    var stale = [];
    for (var i = 0; i < stats.length; i++) {
      if (stats[i].isStale) stale.push(stats[i]);
    }
    if (!stale.length) return { kind: 'all-fresh' };

    /* 排在最前的那个最该看：
       从没记录过的排最前（视为「无限天」）；
       其余按天数多的优先；天数一样就取加入顺序更早的 */
    stale.sort(function (a, b) {
      var ax = a.daysSince === null ? Infinity : a.daysSince;
      var bx = b.daysSince === null ? Infinity : b.daysSince;
      if (ax !== bx) return bx - ax;
      return (timeOf(a.source.createdAt) || 0) - (timeOf(b.source.createdAt) || 0);
    });

    return { kind: 'focus', stat: stale[0] };
  }

  /* 天数 → 人话。0 天说「今天」，其余说「N 天前」 */
  function daysText(days) {
    if (days === null || days === undefined) return '今天';
    if (days <= 0) return '今天';
    return days + ' 天前';
  }

  /* 卡片上「最后记录」那一行怎么写。
     从来没记录过时写「还没有记录过」，不许写「0 天前」（PRD AC-02）。 */
  function lastRecordText(stat) {
    if (stat.lastRecordedAt === null) return '还没有记录过';
    if (stat.daysSince === null) return '还没有记录过';
    return daysText(stat.daysSince);
  }

  /* 顶部那句提示语的完整文字（PRD AC-04 有固定格式） */
  function focusText(focus) {
    if (!focus || focus.kind === 'none') return null;
    if (focus.kind === 'all-fresh') {
      return '所有来源都在 ' + CFG.STALE_DAYS + ' 天内记录过，暂时不用补看';
    }
    var stat = focus.stat;
    if (stat.lastRecordedAt === null) {
      return '你现在最该看的是：' + stat.source.name + '（还没有记录过）';
    }
    return '你现在最该看的是：' + stat.source.name + '（' + stat.daysSince + ' 天没记录了）';
  }

  /* 时间线上每条左边那个来源标签用什么颜色。
     按来源在「加入顺序」里的位置取一个固定颜色，同一个来源永远同色。

     Day 9（规则 1）：标签是"白字压在色块上"，所以每个色都必须让白字达到 4.5:1。
     逐个实测（白字 / 该底色）：
       #2f6feb 4.57:1 ✓   #0b7a5e 5.30:1 ✓   #b4591f 4.78:1 ✓
       #7a4bd0 5.61:1 ✓   #c02b6b 5.53:1 ✓
     只有第 2 个原来写的 #0f8a6a 是 4.32:1，差一点点，所以这次只加深了它这一个。
     其余四个一个没动——改配色要改"刚好不过线的那一个"，不是整盘重来。 */
  var TAG_COLORS = ['#2f6feb', '#0b7a5e', '#b4591f', '#7a4bd0', '#c02b6b'];

  function sourceColorIndex(sources, sourceId) {
    var ordered = sortSources(sources);
    for (var i = 0; i < ordered.length; i++) {
      if (ordered[i].id === sourceId) return i % TAG_COLORS.length;
    }
    return 0;
  }

  function sourceColor(sources, sourceId) {
    return TAG_COLORS[sourceColorIndex(sources, sourceId)];
  }

  global.SBRules = {
    daysSince: daysSince,
    itemsOfSource: itemsOfSource,
    statsOf: statsOf,
    allStats: allStats,
    sortSources: sortSources,
    sortItems: sortItems,
    pickFocus: pickFocus,
    daysText: daysText,
    lastRecordText: lastRecordText,
    focusText: focusText,
    sourceColor: sourceColor,
    tagColors: TAG_COLORS
  };
})(window);
