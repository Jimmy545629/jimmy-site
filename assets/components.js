/* components.js —— 可复用的「积木」。
   （Day 8 余力加练「抽一个可复用卡片/列表组件」，2026-09-26 补做）

   ============================================================
   这个文件是干什么的
   ============================================================
   在这之前，页面上那些「来源卡片」「时间线里的一条」「弹窗里的输入框」，
   都是在 assets/ui.js 里一段一段手写出来的：同一个结构抄了四五遍。
   想改一处（比如给卡片加个东西），得挨个地方改，很容易漏掉一处——
   漏了的那处就成了"跟别人长得不一样"的异类。

   现在把它们抽成**共用的积木**：
     ui.js 只负责「这次要摆哪些积木、每个积木里放什么内容」；
     这个文件负责「积木长什么样（有哪些元素、哪些 class）」。

   ============================================================
   它和另外几个文件的分工（AGENTS.md 第 4 条）
   ============================================================
     config.js      → 常量（7 天 / 5 个 / 存储键名）
     store.js       → 存取数据
     rules.js       → 算（几天前、该看哪个）
     components.js  → 造积木（只管"结构"）
     ui.js          → 把积木摆到页面上、收集用户输入

   ============================================================
   两条铁律
   ============================================================
   ① 只用 document.createElement + textContent 造元素，绝不拼 innerHTML
      （AGENTS.md 第 4 条第 5 项）——用户贴的标题里可能有 < > 这类符号，
      拼 HTML 会让整个页面错乱。所以下面 h() 里，文字只有 textContent 一条路。
   ② 这里生成的 class 名，必须和 assets/style.css 里写的完全对得上。
      积木只管「该有哪些 class」，颜色 / 间距 / 字号全部在 style.css 里。
      → 改视觉去 style.css，改结构来这里，两边不打架。
*/

(function (global) {
  'use strict';

  /* ============================================================
     一、把设计规则写成「积木自己就遵守的约束」
     ============================================================
     下面这些数字来自 docs/day9-design-rules.md（Day 9 定的 7 条规则）。
     写在代码里、而不是只留在文档里，好处有两个：
       · 以后要加新积木，不用回头翻文档，照抄这里的数值就是对的；
       · 测试脚本可以读同一份数值来做断言（避免"文档说 4 档、实际有 8 档"）。
     注意：这里只声明「约束是什么」，具体生效靠 style.css 里的变量
     （--sp-* / --fs-* / --ink-*）。两处对得上，才算真约束。
  */
  var RULES = {
    spacingScale: 4,                  // 规则 2：所有间距都是 4 的倍数
    fontSizeScale: [12, 14, 16, 24],  // 规则 4：字号只准这 4 档（--fs-4 ~ --fs-1）
    minTarget: 32,                    // 规则 5：可点元素最小 32×32
    contrastNormal: 4.5,              // 规则 1：正文文字的对比度下限
    contrastLarge: 3                  // 规则 1：大字号（≥24px，或 ≥18.66px 加粗）的下限
  };

  /* ============================================================
     二、最小构建器 h() —— 所有积木都由它造出来
     ============================================================
     h('div', { class: 'box', text: '你好' }, 子节点…)

     支持三种属性写法：
       class / id / title / href …   → 原样当成 HTML 属性
       text                          → 写进 textContent（唯一被允许的文字入口）
       style（对象）                 → 逐条设到 style 上
     子节点可以是：字符串、元素、数组、null（null 直接跳过，方便三元表达式）。

     为什么不直接用 innerHTML？见文件头的铁律 ①。
  */
  function h(tag, props) {
    var node = document.createElement(tag);

    if (props) {
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        var v = props[k];
        if (v === null || v === undefined || v === false) continue;

        if (k === 'class') {
          node.className = v;
        } else if (k === 'text') {
          node.textContent = String(v);        // ← 唯一的文字入口
        } else if (k === 'style') {
          for (var s in v) {
            if (Object.prototype.hasOwnProperty.call(v, s) && v[s] !== null) node.style[s] = v[s];
          }
        } else {
          node.setAttribute(k, v);
        }
      }
    }

    for (var i = 2; i < arguments.length; i++) pushChild(node, arguments[i]);
    return node;
  }

  /* 把任意东西塞进父节点。数组会被摊平，null/undefined/false 被忽略。 */
  function pushChild(parent, c) {
    if (c === null || c === undefined || c === false || c === '') return;
    if (Object.prototype.toString.call(c) === '[object Array]') {
      for (var i = 0; i < c.length; i++) pushChild(parent, c[i]);
      return;
    }
    if (c.nodeType === 1 || c.nodeType === 11) {   // 元素 / DocumentFragment
      parent.appendChild(c);
      return;
    }
    parent.appendChild(document.createTextNode(String(c)));   // 纯文字
  }

  /* ============================================================
     三、积木们
     ============================================================ */

  /* ---- Button：所有能点的按钮 ----
     variant: 'btn'（默认，实心/描边方块）| 'link'（伪装成文字）| 'chip'（筛选用的小胶囊）
     kind:    'primary' | 'ghost' | 'danger'      —— 只管 variant 是 'btn' 时
     size:    'sm'                                 —— 更小一号
     danger:  true                                 —— ghost / link 的"危险"配色
     active:  true                                 —— chip 被选中
     onClick: 点击要做的事

     约束（规则 5）：一律造成真正的 <button type="button">，
     尺寸由 style.css 的 .btn{min-height:32px} 保证。
     造成 <div onclick> 那种写法，键盘用户按 Tab 根本走不到它。 */
  function Button(o) {
    o = o || {};
    var cls;
    if (o.variant === 'link') {
      cls = 'link-btn';
    } else if (o.variant === 'chip') {
      cls = 'chip' + (o.active ? ' is-active' : '');
    } else {
      cls = 'btn btn-' + (o.kind || 'ghost');
      if (o.size === 'sm') cls += ' btn-sm';
    }
    if (o.danger) cls += ' is-danger';

    var b = h('button', { class: cls, type: 'button', text: o.text, title: o.title });
    if (typeof o.onClick === 'function') b.addEventListener('click', o.onClick);
    return b;
  }

  /* ---- Tag：来源做成的小色块 ----
     约束（规则 1）：它是"白字压在色块上"，所以每个底色都必须让白字到得了 4.5:1。
     因此这里**只接受** SBRules.tagColors 白名单里的颜色。
     万一有人传了名单外的颜色，不硬画（那很可能就是看不清的），退回第一个并在控制台说一声。 */
  function Tag(text, color) {
    var palette = (global.SBRules && global.SBRules.tagColors) || [];
    var safe = palette.indexOf(color) >= 0 ? color : palette[0];
    if (palette.length && safe !== color && global.console) {
      global.console.warn('[components] 标签色 ' + color + ' 不在白名单里，已退回 ' + safe);
    }
    return h('span', { class: 'tag', style: { background: safe }, text: text });
  }

  /* ---- Field：弹窗里的一个输入项（标签 + 控件 + 可选提示） ----
     以前每个弹窗都要手写三行，四处重复。
     hint 是"可选的补充说明"，用更淡的字（规则 4 的 --fs-4）。 */
  function Field(o) {
    o = o || {};
    return h('label', { class: 'field' },
      h('span', { class: 'field-label', text: o.label }),
      o.control,
      o.hint ? h('span', { class: 'field-hint', text: o.hint }) : null);
  }

  /* ---- ModalFoot：弹窗底部那两个按钮 ----
     固定「次要在左、主要在右，右对齐」（style.css 的 .modal-foot）。
     以前四处弹窗各写一遍，顺序和类名靠自觉；现在只有这一处。
     注意：**不在这里调 focus()** —— 元素这时还没进页面，聚焦会失败。
     调用方 appendChild 之后自己 focus。 */
  function ModalFoot(o) {
    o = o || {};
    var foot = h('div', { class: 'modal-foot' });
    var cancel = null, confirm = null;

    if (o.cancel) {
      cancel = Button({ text: o.cancel, kind: 'ghost', onClick: o.onCancel });
      foot.appendChild(cancel);
    }
    if (o.confirm) {
      confirm = Button({
        text: o.confirm,
        kind: o.confirmKind === 'danger' ? 'danger' : 'primary',
        onClick: o.onConfirm
      });
      foot.appendChild(confirm);
    }
    return { el: foot, cancel: cancel, confirm: confirm };
  }

  /* ---- Card：一张来源卡片 ----
     head: 头部内容（组件会包成 <div class="src-head">，flex 两端对齐）
     meta: { label: '最后记录：', value: '3 天前' } —— 中间那一行
     foot: 底部内容（组件会包成 <div class="src-foot">）
     stale: 这个来源是不是"该看了"

     ⭐ 约束（规则 6：状态不能只靠一个维度表达）：
     stale 为真时，组件**同时**做两件事——
       ① 给卡片加 is-stale 类（颜色变化）
       ② 在那一行右端补一个「该看了」小标签（文字）
     调用方说了 stale 就一定会拿到这两样，没办法只给颜色、忘了文字。
     这正是"把视觉规则写成组件约束"最实在的一处。 */
  function Card(o) {
    o = o || {};
    var card = h('article', { class: 'source-card' + (o.stale ? ' is-stale' : '') });

    if (o.head) pushChild(card, h('div', { class: 'src-head' }, o.head));

    if (o.meta) {
      var line = h('p', { class: 'src-last' },
        h('span', { class: 'src-last-text' },
          h('span', { class: 'src-last-label', text: o.meta.label }),
          h('span', { class: 'src-last-value', text: o.meta.value })));
      if (o.stale) pushChild(line, h('span', { class: 'stale-tag', text: o.staleText || '该看了' }));
      pushChild(card, line);
    }

    if (o.foot) pushChild(card, h('div', { class: 'src-foot' }, o.foot));
    return card;
  }

  /* ---- Row：时间线里的一条记录 ----
     head:  顶部一行（来源标签 + 时间），组件包成 <div class="item-head">
     title: { text: '标题', href: 'https://…' 或 null }
            href 有值就做成链接（新窗口打开），没有就做成普通文字。
            这个判断以前散在 ui.js 里，收进来之后"标题什么时候可点"只有这一处定义。
     note:  我的一句话（可选，会自动包成 <p class="item-note">）
     acts:  底部操作行（可选，组件包成 <div class="item-acts">）
     返回 <li>，因为它的父元素是 <ul class="timeline">。 */
  function Row(o) {
    o = o || {};
    var li = h('li', { class: 'item' });

    if (o.head) pushChild(li, h('div', { class: 'item-head' }, o.head));

    if (o.title) {
      li.appendChild(o.title.href
        ? h('a', { class: 'item-title', href: o.title.href, target: '_blank',
                   rel: 'noreferrer', text: o.title.text })
        : h('div', { class: 'item-title', text: o.title.text }));
    }

    if (o.note) pushChild(li, h('p', { class: 'item-note', text: o.note }));
    if (o.acts) pushChild(li, h('div', { class: 'item-acts' }, o.acts));

    return li;
  }

  global.SBComponents = {
    RULES: RULES,
    h: h,
    Button: Button,
    Tag: Tag,
    Field: Field,
    ModalFoot: ModalFoot,
    Card: Card,
    Row: Row
  };
})(window);
