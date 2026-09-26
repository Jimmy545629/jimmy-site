/* ui.js —— 只干两件事：把算好的结果画到页面上；把用户的点击和输入收起来。
   它不碰 localStorage（一律走 SBStore），也不做计算（一律走 SBRules）。
   页面上出现的每一段"用户自己输入的字符串"，都用 textContent 塞进去，绝不拼 innerHTML
   ——因为标题里万一有 < > 这类符号，拼 HTML 会让页面整个错乱（AGENTS.md 第 4 条第 5 项）。

   Day 8 余力加练（2026-09-26 补做）：把「长什么样」搬到 assets/components.js。
   这个文件现在只负责「摆哪些积木、每块里放什么内容」；
   卡片/列表行/按钮/标签/表单字段/弹窗底部按钮的**结构和 class 名**，
   统一由 SBComponents 提供——同一个东西不再有四五份手抄版本。 */

(function (global) {
  'use strict';

  var CFG = global.SB_CONFIG;
  var Store = global.SBStore;
  var Rules = global.SBRules;
  var C = global.SBComponents;

  /* 输入框的长度上限（PRD 4.1 / 4.2 定的） */
  var NAME_MAX = 20;
  var TITLE_MAX = 100;
  var NOTE_MAX = 200;

  var state = {
    page: 'home',      // 'home' = 首页，'source' = 来源详情页
    data: null,
    sourceId: null,    // 详情页在看哪个来源
    filter: 'all'      // 首页时间线当前筛到哪个来源；'all' = 全部
  };

  /* ================= 通用小工具 ================= */

  function $(id) { return document.getElementById(id); }

  /* el() 现在只是 components.js 里 h() 的一层薄壳。
     留着这个写法是因为页面里调用点很多，全换成 h() 要改几十处、风险不值当；
     但底层已经只有一份实现——"造元素"的规矩集中在 SBComponents.h 里。 */
  function el(tag, cls, text) {
    return C.h(tag, cls ? { class: cls } : null, text);
  }

  /* 说明：这里原来有个 append(parent, ...子节点) 的小工具，
     Day 8 抽组件时它的调用点全部改成 C.h(...) 的多参数写法了，所以删掉。 */

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function findSource(id) {
    var arr = state.data.sources;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) return arr[i];
    }
    return null;
  }

  function sourceName(id) {
    var s = findSource(id);
    return s ? s.name : '（来源已删除）';
  }

  /* 地址看着像个网址时才做成能点的链接。
     PRD F3 边界：链接填了但不是合法网址 → 仍然允许保存，只是不做成链接。 */
  function looksLikeUrl(text) {
    return /^https?:\/\/\S+$/i.test(String(text || '').trim());
  }

  function linkOrText(text, cls) {
    var t = String(text || '');
    if (looksLikeUrl(t)) {
      var a = el('a', cls, t);
      a.href = t;
      a.target = '_blank';
      a.rel = 'noreferrer';
      return a;
    }
    return el('span', cls, t);
  }

  /* 时间显示成人话：今天 / N 天前 */
  function relTimeText(iso) {
    return Rules.daysText(Rules.daysSince(iso, new Date()));
  }

  function queryParam(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(global.location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  }

  /* 页面下方浮出来的一句提示 */
  function toast(msg, kind) {
    var box = $('toast');
    if (!box) {
      box = el('div', 'toast');
      box.id = 'toast';
      document.body.appendChild(box);
    }
    box.textContent = msg;
    box.className = 'toast' + (kind === 'error' ? ' is-error' : '') + ' is-on';
    global.clearTimeout(toast._timer);
    toast._timer = global.setTimeout(function () {
      box.className = 'toast' + (kind === 'error' ? ' is-error' : '');
    }, 3600);
  }

  /* ================= 弹窗 ================= */

  /* 打开一个弹窗，返回它的「关闭」方法 */
  function openModal() {
    var root = $('modal-root');
    clear(root);

    var back = el('div', 'modal-back');
    var box = el('div', 'modal');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    back.appendChild(box);
    root.appendChild(back);

    function close() {
      clear(root);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });

    return { box: box, close: close };
  }

  /* 删除类操作统一走这里（AGENTS.md 第 4 条第 8 项）。
     调用它的地方必须把「会连带删掉多少」写进 message 里，不许只弹一句「确定吗」。 */
  function confirmDanger(opts) {
    if (!$('modal-root')) return;
    var m = openModal();
    m.box.appendChild(el('h3', 'modal-title', opts.title || '请确认'));
    m.box.appendChild(el('p', 'modal-text', opts.message || ''));

    var foot = C.ModalFoot({
      cancel: opts.cancelText || '取消',
      confirm: opts.confirmText || '确定删除',
      confirmKind: 'danger',            // 删除类操作，主按钮用危险色
      onCancel: m.close,
      onConfirm: function () {
        m.close();
        if (typeof opts.onConfirm === 'function') opts.onConfirm();
      }
    });
    m.box.appendChild(foot.el);
    foot.confirm.focus();
  }

  /* 新增 / 编辑一条记录（F3、F8） */
  function openItemModal(item, presetSourceId) {
    var editing = !!item;
    var sources = Rules.sortSources(state.data.sources);

    if (!sources.length) {
      toast('先添加一个来源，再记录。');
      return;
    }

    var m = openModal();
    m.box.appendChild(el('h3', 'modal-title', editing ? '编辑这条记录' : '记录一条'));

    /* 来源 */
    var sel = document.createElement('select');
    sel.className = 'input';
    for (var i = 0; i < sources.length; i++) {
      var opt = document.createElement('option');
      opt.value = sources[i].id;
      opt.textContent = sources[i].name;
      sel.appendChild(opt);
    }
    sel.value = editing ? item.sourceId : (presetSourceId || sources[0].id);

    /* 标题 */
    var titleIn = document.createElement('input');
    titleIn.type = 'text';
    titleIn.className = 'input';
    titleIn.maxLength = TITLE_MAX;
    titleIn.value = editing ? item.title : '';
    titleIn.placeholder = '看到的那条东西叫什么';

    /* 链接 */
    var urlIn = document.createElement('input');
    urlIn.type = 'text';
    urlIn.className = 'input';
    urlIn.value = editing ? (item.url || '') : '';
    urlIn.placeholder = '原文地址';

    /* 我的一句话 */
    var noteIn = document.createElement('textarea');
    noteIn.className = 'input';
    noteIn.rows = 3;
    noteIn.maxLength = NOTE_MAX;
    noteIn.value = editing ? (item.note || '') : '';
    noteIn.placeholder = '为什么值得记';

    /* 记录时间 */
    var dateIn = document.createElement('input');
    dateIn.type = 'date';
    dateIn.className = 'input';
    dateIn.value = Store.dateStamp(editing && item.recordedAt ? item.recordedAt : null);

    /* 五个字段交给 Field() 统一包成 <label class="field">：
       标签在上、控件在下、提示最后——四处弹窗用的是同一套结构。 */
    m.box.appendChild(C.h('div', { class: 'form' },
      C.Field({ label: '来源 *', control: sel }),
      C.Field({ label: '标题 *', control: titleIn }),
      C.Field({ label: '链接（可以不填）', control: urlIn }),
      C.Field({ label: '我的一句话（可以不填）', control: noteIn }),
      C.Field({
        label: '记录时间',
        control: dateIn,
        hint: '默认是今天。如果是补记前几天看到的东西，可以改成那天。'
      })));

    var err = el('p', 'form-error');
    err.hidden = true;
    m.box.appendChild(err);

    var foot = C.ModalFoot({
      cancel: '取消',
      confirm: editing ? '保存修改' : '保存',
      onCancel: m.close,
      onConfirm: function () {
        var title = titleIn.value.trim();
        if (!title) {
          err.hidden = false;
          err.textContent = '标题不能空着。';      // AC-09 要求有这句提示
          titleIn.focus();
          return;
        }

        var recordedAt = isoFromDateInput(dateIn.value);

        if (editing) {
          item.sourceId = sel.value;
          item.title = title;
          item.url = urlIn.value.trim();
          item.note = noteIn.value.trim();
          item.recordedAt = recordedAt;
          /* savedAt 故意不动：它记的是「这条什么时候被贴进来的」，
             改内容不该改变这个时间（TECH_DESIGN 3.4） */
        } else {
          state.data.items.push({
            id: Store.newId('i'),
            sourceId: sel.value,
            title: title,
            url: urlIn.value.trim(),
            note: noteIn.value.trim(),
            recordedAt: recordedAt,
            savedAt: Store.nowISO()
          });
        }

        Store.save(state.data);
        m.close();
        renderAll();
        toast(editing ? '已保存修改。' : '记下了：' + title);
      }
    });
    m.box.appendChild(foot.el);

    titleIn.focus();
  }

  /* 把 <input type="date"> 里的 2026-09-22 变回带时区的完整写法 */
  function isoFromDateInput(value) {
    if (!value) return Store.nowISO();
    var p = value.split('-');
    var now = new Date();
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]),
                     now.getHours(), now.getMinutes(), now.getSeconds());
    return Store.toISO(d);
  }

  /* 新增一个来源（F6） */
  function openSourceModal() {
    if (state.data.sources.length >= CFG.MAX_SOURCES) {
      toast('已经 ' + CFG.MAX_SOURCES + ' 个了。想加新的，先去掉一个。');
      return;
    }

    var m = openModal();
    m.box.appendChild(el('h3', 'modal-title', '添加一个来源'));

    var nameIn = document.createElement('input');
    nameIn.type = 'text';
    nameIn.className = 'input';
    nameIn.maxLength = NAME_MAX;
    nameIn.placeholder = '比如 掘金、36氪、GitHub Trending';

    var urlIn = document.createElement('input');
    urlIn.type = 'text';
    urlIn.className = 'input';
    urlIn.placeholder = '填了就能从卡片上一键点过去看';

    m.box.appendChild(C.h('div', { class: 'form' },
      C.Field({ label: '名称 *', control: nameIn }),
      C.Field({ label: '地址（可以不填）', control: urlIn })));

    var err = el('p', 'form-error');
    err.hidden = true;
    m.box.appendChild(err);

    var foot = C.ModalFoot({
      cancel: '取消',
      confirm: '添加',
      onCancel: m.close,
      onConfirm: function () {
        var name = nameIn.value.trim();
        if (!name) {
          err.hidden = false;
          err.textContent = '名称不能空着。';
          nameIn.focus();
          return;
        }
        if (name.length > NAME_MAX) {
          err.hidden = false;
          err.textContent = '名称最多 ' + NAME_MAX + ' 个字，现在有 ' + name.length + ' 个。';
          return;
        }
        /* 每次都要重新判断一次，防止在弹窗里放着的时候已经被加满了 */
        if (state.data.sources.length >= CFG.MAX_SOURCES) {
          err.hidden = false;
          err.textContent = '已经 ' + CFG.MAX_SOURCES + ' 个了，加不进去了。';
          return;
        }

        state.data.sources.push({
          id: Store.newId('s'),
          name: name,
          url: urlIn.value.trim(),
          createdAt: Store.nowISO()
        });

        Store.save(state.data);
        m.close();
        renderAll();
        toast('加好了：' + name);
      }
    });
    m.box.appendChild(foot.el);

    nameIn.focus();
  }

  /* 重命名来源、改地址（F7 的前半截） */
  function openRenameModal(source) {
    var m = openModal();
    m.box.appendChild(el('h3', 'modal-title', '改一下这个来源'));

    var nameIn = document.createElement('input');
    nameIn.type = 'text';
    nameIn.className = 'input';
    nameIn.maxLength = NAME_MAX;
    nameIn.value = source.name;

    var urlIn = document.createElement('input');
    urlIn.type = 'text';
    urlIn.className = 'input';
    urlIn.value = source.url || '';

    m.box.appendChild(C.h('div', { class: 'form' },
      C.Field({ label: '名称 *', control: nameIn }),
      C.Field({ label: '地址（可以不填）', control: urlIn })));

    var err = el('p', 'form-error');
    err.hidden = true;
    m.box.appendChild(err);

    var foot = C.ModalFoot({
      cancel: '取消',
      confirm: '保存',
      onCancel: m.close,
      onConfirm: function () {
        var name = nameIn.value.trim();
        if (!name) {
          err.hidden = false;
          err.textContent = '名称不能空着。';
          nameIn.focus();
          return;
        }
        source.name = name;
        source.url = urlIn.value.trim();
        Store.save(state.data);
        m.close();
        renderAll();
        toast('改好了。');
      }
    });
    m.box.appendChild(foot.el);

    nameIn.focus();
  }

  /* ================= 删除 ================= */

  function removeSource(source, afterDelete) {
    var n = Rules.itemsOfSource(source.id, state.data.items).length;

    confirmDanger({
      title: '删除来源',
      /* 有条目时，必须把「会连带删掉多少条」写清楚（PRD F7 / AC-11） */
      message: n > 0
        ? '删除「' + source.name + '」会同时删除它下面的 ' + n + ' 条记录，删掉后找不回来。确定吗？'
        : '删除「' + source.name + '」？',
      confirmText: '删除',
      onConfirm: function () {
        state.data.sources = state.data.sources.filter(function (x) { return x.id !== source.id; });
        state.data.items = state.data.items.filter(function (x) { return x.sourceId !== source.id; });
        Store.save(state.data);
        if (typeof afterDelete === 'function') { afterDelete(); return; }
        renderAll();
        toast('已删除「' + source.name + '」' + (n > 0 ? '，连带 ' + n + ' 条记录' : ''));
      }
    });
  }

  function removeItem(item) {
    confirmDanger({
      title: '删除这条记录',
      message: '要删掉「' + item.title + '」吗？删掉后找不回来。',
      confirmText: '删除',
      onConfirm: function () {
        state.data.items = state.data.items.filter(function (x) { return x.id !== item.id; });
        Store.save(state.data);
        renderAll();
        toast('已删除这条记录。');
      }
    });
  }

  /* ================= 画页面 ================= */

  /* 顶部那句话（F2 / AC-04） */
  function renderFocusBar() {
    var bar = $('focus-bar');
    if (!bar) return;

    var stats = Rules.allStats(state.data.sources, state.data.items, new Date());
    var focus = Rules.pickFocus(stats);
    clear(bar);

    if (focus.kind === 'none') {           // 一个来源都没有 → 不显示
      bar.hidden = true;
      return;
    }
    bar.hidden = false;

    if (focus.kind === 'all-fresh') {      // 都在阈值内 → 不点名任何人
      bar.className = 'focus-bar is-ok';
      bar.appendChild(el('span', 'focus-ok-dot'));
      bar.appendChild(el('span', 'focus-text', Rules.focusText(focus)));
      return;
    }

    var stat = focus.stat;
    bar.className = 'focus-bar is-alert';
    bar.appendChild(el('span', 'focus-label', '你现在最该看的是：'));

    if (looksLikeUrl(stat.source.url)) {   // 点名字就能直接去看
      var a = el('a', 'focus-name', stat.source.name);
      a.href = stat.source.url;
      a.target = '_blank';
      a.rel = 'noreferrer';
      bar.appendChild(a);
    } else {
      bar.appendChild(el('strong', 'focus-name', stat.source.name));
    }

    bar.appendChild(el('span', 'focus-tail', stat.lastRecordedAt === null
      ? '（还没有记录过）'
      : '（' + stat.daysSince + ' 天没记录了）'));
  }

  /* 一张来源卡片（F1）
     结构全交给 SBComponents.Card —— 包括「该看了」那个标签：
     只要告诉它 stale: true，它会**同时**加上标红的类和「该看了」三个字，
     想漏也漏不掉（规则 6：状态不能只靠颜色一个维度）。 */
  function sourceCard(stat) {
    var s = stat.source;
    var href = 'source.html?id=' + encodeURIComponent(s.id);

    var nameLink = el('a', 'src-name', s.name);
    nameLink.href = href;
    nameLink.title = s.name;                       // 名字太长时鼠标停一下能看全

    var countLink = el('a', 'src-count', stat.itemCount + ' 条');
    countLink.href = href;

    var foot = [];
    if (s.url) foot.push(linkOrText(s.url, 'src-url'));
    foot.push(C.Button({
      text: '记录一条',
      kind: 'primary',
      size: 'sm',
      onClick: function () { openItemModal(null, s.id); }
    }));

    return C.Card({
      stale: stat.isStale,
      head: [nameLink, countLink],
      meta: { label: '最后记录：', value: Rules.lastRecordText(stat) },
      foot: foot
    });
  }

  function renderSources() {
    var grid = $('source-grid');
    if (!grid) return;

    var emptyTip = $('source-empty');
    var addSource = $('btn-add-source');
    var addItem = $('btn-add-item');
    var limitHint = $('limit-hint');

    clear(grid);

    var sources = Rules.sortSources(state.data.sources);
    var stats = Rules.allStats(sources, state.data.items, new Date());

    /* 一个来源都没有 → 显示引导语（F1 边界） */
    if (!sources.length) {
      if (emptyTip) {
        emptyTip.hidden = false;
        emptyTip.textContent = '先添加你想盯的来源（最多 ' + CFG.MAX_SOURCES + ' 个）。';
      }
      if (limitHint) limitHint.hidden = true;
      if (addSource) addSource.disabled = false;
      if (addItem) {
        addItem.disabled = true;                       // 没来源就没法记录
        addItem.title = '先添加一个来源';
      }
      return;
    }

    if (emptyTip) emptyTip.hidden = true;

    for (var i = 0; i < stats.length; i++) {
      grid.appendChild(sourceCard(stats[i]));
    }

    var full = sources.length >= CFG.MAX_SOURCES;
    if (addSource) addSource.disabled = full;
    if (limitHint) {
      if (full) {
        /* 满了：说清为什么不能加，同时给出去路（AC-10 要求有这句） */
        limitHint.hidden = false;
        limitHint.className = 'limit-hint is-full';
        limitHint.textContent = '已经 ' + CFG.MAX_SOURCES +
          ' 个了。来源一多就不会挨个看——想加新的，先去掉一个。';
      } else {
        limitHint.hidden = true;
      }
    }

    if (addItem) {
      addItem.disabled = false;
      addItem.title = '';
    }
  }

  /* 时间线上方那排筛选按钮（F5） */
  function renderFilters() {
    var bar = $('filter-bar');
    if (!bar) return;

    clear(bar);

    var sources = Rules.sortSources(state.data.sources);
    if (!sources.length) return;                       // 一个来源都没有就不显示这排

    bar.appendChild(filterChip('all', '全部'));
    for (var i = 0; i < sources.length; i++) {
      bar.appendChild(filterChip(sources[i].id, sources[i].name));
    }
  }

  function filterChip(id, label) {
    return C.Button({
      variant: 'chip',
      text: label,
      title: label,
      active: state.filter === id,
      onClick: function () {
        state.filter = id;
        renderFilters();
        renderTimeline();
      }
    });
  }

  /* 时间线上的一条（F4）
     结构交给 SBComponents.Row。连「标题什么时候做成链接」这个判断也收进去了：
     传 href 就是链接（新窗口打开），不传就是普通文字。 */
  function itemRow(item) {
    var isLink = looksLikeUrl(item.url);

    var when = el('span', 'item-time', relTimeText(item.recordedAt));
    when.title = item.recordedAt || '';

    var acts = [];
    if (isLink) acts.push(linkOrText(item.url, 'item-url'));
    acts.push(C.Button({
      variant: 'link', text: '编辑',
      onClick: function () { openItemModal(item, item.sourceId); }
    }));
    acts.push(C.Button({
      variant: 'link', text: '删除', danger: true,
      onClick: function () { removeItem(item); }
    }));

    return C.Row({
      head: [
        /* Tag() 只接受 SBRules 白名单里的颜色 ——
           标签是白字压色块，名单外的颜色很可能根本读不清（规则 1） */
        C.Tag(sourceName(item.sourceId), Rules.sourceColor(state.data.sources, item.sourceId)),
        when
      ],
      title: { text: item.title, href: isLink ? item.url : null },
      note: item.note,
      acts: acts
    });
  }

  function renderTimeline() {
    var list = $('timeline');
    if (!list) return;

    clear(list);

    var pool, emptyText;

    if (state.page === 'source') {
      pool = Rules.itemsOfSource(state.sourceId, state.data.items);
      emptyText = '这个来源还没有记录。';
    } else if (state.filter !== 'all') {
      pool = Rules.itemsOfSource(state.filter, state.data.items);
      emptyText = '这个来源还没有记录。';
    } else {
      pool = state.data.items;
      emptyText = state.data.sources.length
        ? '还没有记录。去看一个来源，把看到的东西贴进来。'
        : '还没有记录。先添加一个来源，再把它那里看到的东西贴进来。';
    }

    var sorted = Rules.sortItems(pool);
    if (!sorted.length) {
      list.appendChild(el('li', 'timeline-empty', emptyText));
      return;
    }

    for (var i = 0; i < sorted.length; i++) {
      list.appendChild(itemRow(sorted[i]));
    }
  }

  /* 详情页顶部那块（P2） */
  function renderSourceDetail() {
    var s = findSource(state.sourceId);
    if (!s) return;

    var stat = Rules.statsOf(s, state.data.items, new Date());

    $('sd-name').textContent = s.name;

    var lastEl = $('sd-last');
    lastEl.textContent = '最后记录：' + Rules.lastRecordText(stat);
    lastEl.className = 'src-detail-last' + (stat.isStale ? ' is-stale' : '');

    $('sd-count').textContent = stat.itemCount + ' 条';

    var urlRow = $('sd-url-row');
    var urlEl = $('sd-url');
    clear(urlEl);
    if (s.url) {
      urlRow.hidden = false;
      urlEl.appendChild(linkOrText(s.url, ''));
    } else {
      urlRow.hidden = true;
    }

    /* 该看了的时候，跟首页卡片一样，颜色 + 文字都给上 */
    var meta = document.querySelector('.src-detail-meta');
    var old = meta.querySelector('.stale-tag');
    if (old) old.parentNode.removeChild(old);
    if (stat.isStale) meta.appendChild(el('span', 'stale-tag', '该看了'));
  }

  function renderAll() {
    if (state.page === 'home') {
      renderFocusBar();
      renderSources();
      renderFilters();
      renderTimeline();
    } else {
      renderSourceDetail();
      renderTimeline();
    }
  }

  /* 详情页的 id 在数据里找不到（比如来源被删了、或者地址被手改了） */
  function showSourceMissing() {
    var panel = $('source-panel');
    if (panel) panel.hidden = true;

    var missing = $('source-missing');
    if (!missing) return;
    missing.hidden = false;
    missing.textContent = '找不到这个来源——它可能已经被删掉了。';

    var back = el('a', 'back-link', '回首页看看');
    back.href = 'index.html';
    missing.appendChild(document.createTextNode(' '));
    missing.appendChild(back);
  }

  /* ================= 绑定按钮 ================= */

  /* 导出 / 导入：两个页面都有 */
  function bindGlobalActions() {
    var exp = $('btn-export');
    if (exp) {
      exp.addEventListener('click', function () {
        var name = Store.exportData(state.data);
        toast('已导出 ' + name + '（在你的「下载」文件夹里）。');
      });
    }

    var impBtn = $('btn-import');
    var fileInput = $('file-import');
    if (impBtn && fileInput) {
      impBtn.addEventListener('click', function () { fileInput.click(); });

      fileInput.addEventListener('change', function () {
        var f = fileInput.files && fileInput.files[0];
        if (!f) return;

        confirmDanger({
          title: '导入会覆盖现在的数据',
          message: '导入前我会自动把现在这份数据先导出一份当备份。但导入之后，页面上显示的就是「' +
                   f.name + '」里的内容了。要用它覆盖吗？',
          confirmText: '导入并覆盖',
          onConfirm: function () {
            Store.importFromFile(f, function (res) {
              fileInput.value = '';
              if (!res.ok) { toast(res.message, 'error'); return; }
              state.data = Store.load();
              renderAll();
              toast(res.message);
            });
          }
        });
      });
    }
  }

  function bindHomeActions() {
    var addSource = $('btn-add-source');
    if (addSource) addSource.addEventListener('click', openSourceModal);

    var addItem = $('btn-add-item');
    if (addItem) {
      addItem.addEventListener('click', function () {
        if (!state.data.sources.length) {
          toast('先添加一个来源，再记录。');
          return;
        }
        openItemModal(null, null);
      });
    }
  }

  function bindSourceActions(source) {
    var rec = $('btn-record-here');
    if (rec) rec.addEventListener('click', function () { openItemModal(null, source.id); });

    var ren = $('btn-rename');
    if (ren) ren.addEventListener('click', function () { openRenameModal(source); });

    var del = $('btn-delete-source');
    if (del) {
      del.addEventListener('click', function () {
        removeSource(source, function () {
          /* 删掉的正是当前正在看的这个来源 → 回首页 */
          global.location.href = 'index.html';
        });
      });
    }
  }

  /* ================= 启动 ================= */

  function init() {
    state.page = document.body.getAttribute('data-page') || 'home';
    if (state.page === 'source') state.sourceId = queryParam('id');

    state.data = Store.load();
    bindGlobalActions();

    if (state.page === 'source') {
      if (!findSource(state.sourceId)) { showSourceMissing(); return; }
      bindSourceActions(findSource(state.sourceId));
    } else {
      bindHomeActions();
    }

    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
