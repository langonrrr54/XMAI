/**
 * 注入到番茄作家后台页面的脚本（通过 executeJavaScript 注入）
 * 职责：
 *  1. 挂钩 fetch / XHR，记录请求与响应（用于"录制→回放"直发）
 *  2. 提供 DOM 自动化辅助：定位标题框、正文编辑器、按文字点击按钮
 */
export const FANQIE_INJECTOR = String.raw`
(() => {
  if (window.__XM_HOOKED__) return 'already';
  window.__XM_HOOKED__ = true;
  const MAX = 150;
  const store = (window.__XM_CAPTURE__ = []);
  const seq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const shouldSniff = (url, method) => {
    if (!url) return false;
    if (method === 'GET' || method === 'HEAD') return false;
    return /fanqienovel\.com/.test(url);
  };
  const push = (entry) => { try { store.push(entry); if (store.length > MAX) store.shift(); } catch (e) {} };
  const headersToObj = (h) => {
    const out = {};
    try {
      if (!h) return out;
      if (typeof h.forEach === 'function' && !Array.isArray(h)) { h.forEach((v, k) => { out[k] = v; }); return out; }
      if (Array.isArray(h)) { for (const [k, v] of h) out[k] = v; return out; }
      if (typeof h === 'object') { for (const k of Object.keys(h)) out[k] = h[k]; }
    } catch (e) {}
    return out;
  };
  const bodyToStr = (b) => {
    try {
      if (b == null) return '';
      if (typeof b === 'string') return b.slice(0, 200000);
      if (b instanceof FormData) { const o = {}; b.forEach((v, k) => { o[k] = typeof v === 'string' ? v : '[file]'; }); return JSON.stringify(o); }
      if (b instanceof URLSearchParams) return b.toString();
      if (b instanceof ArrayBuffer) return new TextDecoder().decode(b).slice(0, 200000);
      return String(b).slice(0, 200000);
    } catch (e) { return ''; }
  };

  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const reqHeaders = headersToObj((init && init.headers) || (input && input.headers));
      const reqBody = bodyToStr(init && init.body);
      const started = Date.now();
      const res = await origFetch.apply(this, arguments);
      if (shouldSniff(url, method)) {
        try {
          const text = await res.clone().text();
          push({
            id: seq(), at: Date.now(), duration: Date.now() - started,
            url: res.url || url, method, status: res.status,
            reqHeaders: reqHeaders, reqBody: reqBody,
            resHeaders: headersToObj(res.headers), resBody: (text || '').slice(0, 400000),
            source: 'fetch'
          });
        } catch (e) {}
      }
      return res;
    };
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__xm = { method: (method || 'GET').toUpperCase(), url, headers: {} };
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (this.__xm) this.__xm.headers[k] = v; } catch (e) {}
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      const meta = this.__xm;
      if (meta && shouldSniff(meta.url, meta.method)) {
        const reqBody = bodyToStr(body);
        const started = Date.now();
        this.addEventListener('loadend', () => {
          let resBody = '';
          try {
            if (this.responseType === '' || this.responseType === 'text') resBody = this.responseText || '';
            else if (this.responseType === 'json') resBody = JSON.stringify(this.response || {});
            else if (this.responseType === 'arraybuffer') resBody = new TextDecoder().decode(this.response || new ArrayBuffer(0));
          } catch (e) {}
          push({
            id: seq(), at: Date.now(), duration: Date.now() - started,
            url: meta.url, method: meta.method, status: this.status,
            reqHeaders: meta.headers, reqBody,
            resHeaders: (() => { const h = {}; try { (this.getAllResponseHeaders() || '').trim().split(/[\r\n]+/).forEach((line) => { const i = line.indexOf(': '); if (i > 0) h[line.slice(0, i)] = line.slice(i + 2); }); } catch (e) {} return h; })(),
            resBody: (resBody || '').slice(0, 400000),
            source: 'xhr'
          });
        });
      }
    } catch (e) {}
    return origSend.apply(this, arguments);
  };

  const visible = (el) => {
    try {
      const r = el.getBoundingClientRect();
      return r.width > 20 && r.height > 10 && getComputedStyle(el).visibility !== 'hidden';
    } catch (e) { return false; }
  };

  const findTitleInput = () => {
    const sels = [
      'input[placeholder*="标题"]', 'textarea[placeholder*="标题"]',
      'input[placeholder*="章节名"]', 'input[name*="title"]',
      '.chapter-title input', '.title-input input', 'input.maxLength'
    ];
    for (const s of sels) {
      const el = Array.from(document.querySelectorAll(s)).find(visible);
      if (el) return el;
    }
    return null;
  };

  const findEditor = () => {
    const sels = ['.ProseMirror', '[contenteditable="true"]', '.ql-editor', '.bytemd-body', 'textarea[placeholder*="正文"]', 'textarea'];
    let best = null;
    let bestArea = 0;
    for (const s of sels) {
      for (const el of Array.from(document.querySelectorAll(s))) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        const area = r.width * r.height;
        if (area > bestArea) { bestArea = area; best = el; }
      }
      if (best && bestArea > 60000) break;
    }
    return best;
  };

  const setNativeValue = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const clickByText = (texts) => {
    const nodes = Array.from(document.querySelectorAll('button, .btn, [role="button"], a, span, div'));
    for (const el of nodes) {
      if (!visible(el)) continue;
      const t = (el.textContent || '').trim();
      if (t.length > 20) continue;
      if (texts.some((x) => t === x || t.includes(x))) {
        try { el.click(); return t; } catch (e) {}
      }
    }
    return null;
  };

  const findAll = (root, sel) => {
    const out = [];
    try { root.querySelectorAll(sel).forEach((el) => out.push(el)); } catch (e) {}
    return out;
  };

  /** 读取「阅读标签」弹窗当前选中的标签（按分组） */
  const readTagSelection = () => {
    const result = { main: [], theme: [], character: [], plot: [], other: [] };
    const groups = ['main', 'theme', 'character', 'plot'];
    for (const g of groups) {
      const box = document.querySelector('[data-xm-group="' + g + '"]');
      if (box) {
        findAll(box, '*').forEach((el) => {
          const t = (el.textContent || '').trim();
          if (!t || t.length > 12) return;
          const cls = String(el.className || '');
          const parentCls = String((el.parentElement && el.parentElement.className) || '');
          if (/active|selected|checked|is-check|choose/i.test(cls + ' ' + parentCls)) {
            if (!result[g].includes(t)) result[g].push(t);
          }
        });
      }
    }
    return result;
  };

  /**
   * 点击匹配文字的标签按钮。
   * 番茄弹窗的标签是扁平的 div/span，没有稳定的分组 class，
   * 因此做三件事：①按弹窗内文字精确定位；②同组内排除已选中的；③点击后校验状态变化。
   */
  const clickTagByText = (text, scopeRoot) => {
    const root = scopeRoot || document;
    const nodes = findAll(root, 'div,span,button,a,li,label');
    const exact = [];
    for (const el of nodes) {
      if (!visible(el)) continue;
      const t = (el.textContent || '').trim();
      if (t !== text) continue;
      // 只取最内层：排除包含其它候选文字的大容器
      const kids = el.querySelectorAll('*');
      let inner = false;
      for (const k of kids) { if ((k.textContent || '').trim() === text) { inner = true; break; } }
      if (inner) continue;
      exact.push(el);
    }
    if (!exact.length) return { clicked: false, reason: 'not-found' };
    const el = exact[0];
    try {
      el.scrollIntoView({ block: 'center' });
      el.click();
      return { clicked: true, text: (el.textContent || '').trim() };
    } catch (e) {
      return { clicked: false, reason: String(e) };
    }
  };

  /** 打开「阅读标签」弹窗：找带有该文字的可点击入口 */
  const openTagDialog = () => {
    const triggers = findAll(document, 'button,a,div,span').filter((el) => {
      if (!visible(el)) return false;
      const t = (el.textContent || '').trim();
      return t === '阅读标签' || t === '修改标签' || t === '设置标签' || t === '编辑标签';
    });
    for (const el of triggers) {
      try { el.click(); return true; } catch (e) {}
    }
    return false;
  };

  window.__XM_HELPERS__ = {
    openTagDialog,
    readTagSelection,
    clickTagByText,
    /**
     * 按分组依次点选。tabs 顺序：主分类 → 主题 → 角色 → 情节。
     * 每选一个后等待 120ms 让 React 完成状态更新。
     */
    async applyTags(pick, tabOrder) {
      const defaults = pick && pick.mode === 'short'
        ? ['main', 'plot', 'character', 'emotion', 'background']
        : ['main', 'theme', 'character', 'plot'];
      const order = tabOrder || defaults;
      const labels = { main: '主分类', theme: '主题', character: '角色', plot: '情节', emotion: '情绪', background: '背景' };
      const report = { ok: false, steps: [], missing: [] };
      if (!openTagDialog()) {
        report.reason = 'dialog-not-found';
        return report;
      }
      await new Promise((r) => setTimeout(r, 600));

      for (const g of order) {
        const want = pick[g];
        const list = Array.isArray(want) ? want : want ? [want] : [];
        if (!list.length) continue;
        // 切到该分组页签
        const tab = clickTagByText(labels[g]);
        report.steps.push({ group: g, tab: tab.clicked, tabReason: tab.reason || '' });
        await new Promise((r) => setTimeout(r, 350));
        for (const name of list) {
          const r = clickTagByText(name);
          report.steps.push({ group: g, tag: name, clicked: r.clicked, reason: r.reason || '' });
          if (!r.clicked) report.missing.push(g + ':' + name);
          await new Promise((r) => setTimeout(r, 160));
        }
      }
      report.ok = report.missing.length === 0;
      report.selection = readTagSelection();
      report.url = location.href;
      return report;
    },
    fill(title, content) {
      const result = { titleFound: false, editorFound: false, method: '' };
      const t = findTitleInput();
      if (t) { t.focus(); setNativeValue(t, title || ''); result.titleFound = true; }
      const ed = findEditor();
      if (ed) {
        result.editorFound = true;
        ed.focus();
        if (ed.tagName === 'TEXTAREA') {
          setNativeValue(ed, content || '');
          result.method = 'textarea';
        } else {
          try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(ed);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('delete', false);
            document.execCommand('insertText', false, content || '');
            result.method = 'execCommand';
          } catch (e) {
            ed.textContent = content || '';
            ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content }));
            result.method = 'textContent';
          }
          // 触发 React 受控组件更新
          ed.dispatchEvent(new Event('input', { bubbles: true }));
          ed.dispatchEvent(new Event('blur', { bubbles: true }));
        }
      }
      return result;
    },
    click(texts) { return clickByText(texts); },
    probe() {
      return {
        title: findTitleInput() ? 'found' : 'missing',
        editor: findEditor() ? 'found' : 'missing',
        url: location.href,
        titleText: document.title
      };
    },
    clear() { store.length = 0; return true; },
    list() { return store; }
  };
  return 'hooked';
})();
`

/** 从页面读取已捕获请求 */
export const READ_CAPTURES_JS = `JSON.stringify((window.__XM_CAPTURE__ || []).slice(-100))`
