/**
 * 大肥鱼 · Client 半边
 *
 * 纯 JS + React.createElement（动态客户端没有 JSX 变换）。
 * 结构：左侧模块导航（项目 / 版本）→ 右侧对应模块面板。
 */
window.__ModuleLoader__.load({
  id: '@local/dafeiyu',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useRef } = React;

    const PANEL_ID = 'dafeiyu';
    const API = '/dafeiyu/api';

    /* ------------------------------------------------------------ 基础工具 */

    function cx() {
      const parts = [];
      for (let i = 0; i < arguments.length; i += 1) {
        const value = arguments[i];
        if (value) parts.push(String(value));
      }
      return parts.join(' ');
    }

    function msg(error) {
      if (!error) return '未知错误';
      return String(error.message || error);
    }

    function fmtSize(bytes) {
      const n = Number(bytes) || 0;
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
      return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    function fmtTime(ms) {
      const value = Number(ms) || 0;
      if (!value) return '';
      const d = new Date(value);
      const pad = (x) => String(x).padStart(2, '0');
      return (
        d.getFullYear() +
        '-' + pad(d.getMonth() + 1) +
        '-' + pad(d.getDate()) +
        ' ' + pad(d.getHours()) +
        ':' + pad(d.getMinutes())
      );
    }

    function parentOf(rel) {
      const index = String(rel || '').lastIndexOf('/');
      return index < 0 ? '' : rel.slice(0, index);
    }

    function slugify(text) {
      const base = String(text || '')
        .trim()
        .toLowerCase()
        .replace(/[\\/:*?"<>|\s]+/g, '-')
        .replace(/^-+|-+$/g, '');
      return base || 'module';
    }

    function svc(get, name) {
      try {
        return get(name) || null;
      } catch {
        return null;
      }
    }

    function normPath(value) {
      return String(value || '')
        .replace(/[\\/]+/g, '\\')
        .replace(/\\+$/, '')
        .toLowerCase();
    }

    /* 按根目录找一个已有工作区，避免重复创建 */
    function findWorkspace(get, root) {
      try {
        const workspaces = svc(get, 'workspaces');
        if (!workspaces || !workspaces.list || typeof workspaces.list.getSnapshot !== 'function') return null;
        const items = workspaces.list.getSnapshot().items || [];
        const want = normPath(root);
        for (const item of items) {
          const path = item.path || (item.workspace && item.workspace.path);
          if (normPath(path) !== want) continue;
          return item.workspaceId || (item.workspace && item.workspace.workspaceId) || null;
        }
        return null;
      } catch {
        return null;
      }
    }

    async function decodeJson(res) {
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (!body) {
        const error = new Error('接口没有返回内容（HTTP ' + res.status + '）');
        error.code = 'HTTP_' + res.status;
        throw error;
      }
      if (!body.ok) {
        const error = new Error((body.error && body.error.message) || '请求失败（HTTP ' + res.status + '）');
        error.code = body.error && body.error.code ? body.error.code : 'HTTP_' + res.status;
        throw error;
      }
      return body.value;
    }

    async function call(route, params) {
      const search = params ? '?' + new URLSearchParams(params).toString() : '';
      const res = await fetch(API + route + search, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin'
      });
      return decodeJson(res);
    }

    async function post(route, payload) {
      const res = await fetch(API + route, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload || {})
      });
      return decodeJson(res);
    }

    async function copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch {
        /* 落到 execCommand */
      }
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', 'readonly');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    }

    /* 本地界面偏好：布局开关、自动保存等，存在浏览器里 */
    function readPref(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        if (raw === 'on') return true;
        if (raw === 'off') return false;
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    }

    function writePref(key, value) {
      try {
        localStorage.setItem(key, typeof value === 'boolean' ? (value ? 'on' : 'off') : JSON.stringify(value));
      } catch {
        /* 隐私模式等场景忽略 */
      }
    }

    const BADGE = {
      docx: 'DOC', doc: 'DOC', md: 'MD', markdown: 'MD', txt: 'TXT', rtf: 'RTF',
      xlsx: 'XLS', xls: 'XLS', xlsm: 'XLS', csv: 'CSV', tsv: 'CSV',
      pptx: 'PPT', ppt: 'PPT', key: 'KEY',
      pdf: 'PDF', png: 'IMG', jpg: 'IMG', jpeg: 'IMG', gif: 'IMG', webp: 'IMG', bmp: 'IMG', svg: 'SVG',
      json: 'JSON', yml: 'YML', yaml: 'YML', toml: 'TOML', xml: 'XML', html: 'HTML', css: 'CSS',
      js: 'JS', mjs: 'JS', ts: 'TS', tsx: 'TSX', jsx: 'JSX', py: 'PY', java: 'JAVA', cs: 'CS',
      sql: 'SQL', sh: 'SH', ps1: 'PS1', bat: 'BAT', zip: 'ZIP', rar: 'RAR', '7z': '7Z'
    };

    const TONE = {
      doc: 't-doc', md: 't-doc', txt: 't-doc',
      xlsx: 't-xls', xls: 't-xls', xlsm: 't-xls', csv: 't-xls', tsv: 't-xls',
      pptx: 't-ppt', ppt: 't-ppt', key: 't-ppt',
      pdf: 't-pdf', png: 't-img', jpg: 't-img', jpeg: 't-img', gif: 't-img', webp: 't-img', svg: 't-img'
    };

    function badgeOf(entry) {
      if (entry.dir) return { text: 'DIR', tone: 't-dir' };
      const ext = String(entry.name || '').split('.').pop().toLowerCase();
      const text = BADGE[ext] || (ext ? ext.slice(0, 4).toUpperCase() : 'FILE');
      return { text, tone: TONE[ext] || 't-other' };
    }

    /* ------------------------------------------------------------ 组件 */

    function PanelIcon(props) {
      const size = props && Number(props.size) > 0 ? Number(props.size) : 20;
      return h(
        'span',
        { className: 'pm-icon' },
        h(
          'svg',
          {
            viewBox: '0 0 24 24',
            width: size,
            height: size,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
            strokeLinejoin: 'round'
          },
          h('ellipse', { cx: 13.6, cy: 12, rx: 7.2, ry: 4.8 }),
          h('path', { d: 'M6.4 12 2.4 9v6l4-3Z' }),
          h('path', { d: 'M12.6 8c.9 1.3.9 2.7 0 4' }),
          h('circle', { cx: 17.4, cy: 10.4, r: 0.9, fill: 'currentColor', stroke: 'none' })
        )
      );
    }

    function Spinner() {
      return h('span', { className: 'pm-spinner' });
    }

    function Toast(props) {
      if (!props.toast) return null;
      return h(
        'div',
        {
          className: cx('pm-toast', props.toast.tone === 'error' ? 'is-error' : 'is-ok'),
          onClick: props.onClose,
          role: 'status'
        },
        props.toast.text
      );
    }

    /* ------------------------------ Markdown 预览 */

    function inlineNodes(text, keyPrefix) {
      const out = [];
      const source = String(text || '');
      const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
      let last = 0;
      let match = null;
      let index = 0;
      while ((match = pattern.exec(source)) !== null) {
        if (match.index > last) out.push(source.slice(last, match.index));
        const token = match[0];
        if (token.startsWith('**')) {
          out.push(h('strong', { key: keyPrefix + '-b' + index }, token.slice(2, -2)));
        } else {
          out.push(h('code', { key: keyPrefix + '-c' + index, className: 'pm-code' }, token.slice(1, -1)));
        }
        last = match.index + token.length;
        index += 1;
      }
      if (last < source.length) out.push(source.slice(last));
      return out;
    }

    function renderMarkdown(text) {
      const lines = String(text || '').split(/\r?\n/);
      const out = [];
      let i = 0;
      let key = 0;
      while (i < lines.length) {
        const line = lines[i];
        if (/^\s*```/.test(line)) {
          const fence = line.replace(/^\s*```/, '');
          const body = [];
          i += 1;
          while (i < lines.length && !/^\s*```/.test(lines[i])) {
            body.push(lines[i]);
            i += 1;
          }
          i += 1;
          out.push(
            h('pre', { key: 'k' + key, className: 'pm-pre' },
              h('code', { 'data-lang': fence || '' }, body.join('\n')))
          );
          key += 1;
          continue;
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
          const level = heading[1].length;
          out.push(h('h' + level, { key: 'k' + key, className: 'pm-md-h' }, inlineNodes(heading[2], 'h' + key)));
          key += 1;
          i += 1;
          continue;
        }
        if (/^\s*>\s?/.test(line)) {
          const body = [];
          while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
            body.push(lines[i].replace(/^\s*>\s?/, ''));
            i += 1;
          }
          out.push(h('blockquote', { key: 'k' + key, className: 'pm-quote' }, inlineNodes(body.join(' '), 'q' + key)));
          key += 1;
          continue;
        }
        if (/^\s*[-*+]\s+/.test(line)) {
          const items = [];
          while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
            items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
            i += 1;
          }
          out.push(
            h('ul', { key: 'k' + key, className: 'pm-md-list' },
              items.map((item, index) => h('li', { key: 'li' + index }, inlineNodes(item, 'i' + key + index))))
          );
          key += 1;
          continue;
        }
        if (/^\s*\d+[.)]\s+/.test(line)) {
          const items = [];
          while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
            items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
            i += 1;
          }
          out.push(
            h('ol', { key: 'k' + key, className: 'pm-md-list' },
              items.map((item, index) => h('li', { key: 'li' + index }, inlineNodes(item, 'o' + key + index))))
          );
          key += 1;
          continue;
        }
        if (/^\s*\|.*\|\s*$/.test(line)) {
          const rows = [];
          while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
            rows.push(lines[i].trim());
            i += 1;
          }
          const cellsOf = (row) => row.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
          const head = cellsOf(rows[0]);
          const bodyRows = rows.slice(1).filter((row) => !/^\|[\s:|-]+\|$/.test(row));
          out.push(
            h('table', { key: 'k' + key, className: 'pm-table' },
              h('thead', null, h('tr', null, head.map((cell, index) => h('th', { key: 'th' + index }, inlineNodes(cell, 'th' + index))))),
              h('tbody', null, bodyRows.map((row, rowIndex) =>
                h('tr', { key: 'tr' + rowIndex }, cellsOf(row).map((cell, index) =>
                  h('td', { key: 'td' + index }, inlineNodes(cell, 'td' + rowIndex + index))))))
            )
          );
          key += 1;
          continue;
        }
        if (!line.trim()) {
          i += 1;
          continue;
        }
        const body = [];
        while (i < lines.length && lines[i].trim() && !/^(\s*```|\s*#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|\s*>|\s*\|)/.test(lines[i])) {
          body.push(lines[i]);
          i += 1;
        }
        if (!body.length) body.push(lines[i] ? lines[i] : '');
        if (!body.length) {
          i += 1;
          continue;
        }
        out.push(h('p', { key: 'k' + key, className: 'pm-md-p' }, inlineNodes(body.join(' '), 'p' + key)));
        key += 1;
      }
      return out;
    }

    /* ------------------------------ 面板内对话 */

    function ChatPane(props) {
      const isOverview = props.target === 'overview';
      const projectId = props.projectId || '';
      const query = isOverview ? 'target=overview' : 'projectId=' + encodeURIComponent(projectId);
      const payloadBase = isOverview ? { target: 'overview' } : { projectId };
      const [chat, setChat] = useState({ loading: true, sessionId: '', items: [], status: null, error: '' });
      const [draft, setDraft] = useState('');
      const [sending, setSending] = useState(false);
      const [busy, setBusy] = useState(false);
      const [composer, setComposer] = useState({ models: [], selection: null, permission: null, commands: [] });
      const [picker, setPicker] = useState('');
      const [pickIndex, setPickIndex] = useState(0);
      const [mentions, setMentions] = useState({ items: [], loading: false });
      const [notices, setNotices] = useState([]);
      const boxRef = useRef(null);
      const inputRef = useRef(null);
      const say = props.say || (() => {});

      const load = useCallback(async (silent) => {
        if (!silent) setChat((prev) => ({ ...prev, loading: true }));
        try {
          const value = await call('/chat/messages?' + query + '&limit=80');
          setChat({
            loading: false,
            sessionId: value.sessionId || '',
            items: value.items || [],
            status: value.status || null,
            error: ''
          });
        } catch (error) {
          setChat((prev) => ({ ...prev, loading: false, error: msg(error) }));
        }
      }, [query]);

      const loadComposer = useCallback(async () => {
        try {
          const value = await call('/composer?' + query);
          setComposer({
            models: value.models || [],
            selection: value.selection || null,
            permission: value.permission || null,
            commands: value.commands || []
          });
        } catch (error) {
          /* 输入框增强是锦上添花，失败就保持基础输入 */
        }
      }, [query]);

      useEffect(() => {
        load(false);
        loadComposer();
      }, [load, loadComposer]);

      useEffect(() => {
        const timer = setInterval(() => load(true), 2500);
        return () => clearInterval(timer);
      }, [load]);

      useEffect(() => {
        const node = boxRef.current;
        if (node) node.scrollTop = node.scrollHeight;
      }, [chat.items.length, chat.loading, notices.length]);

      const mentionWord = (() => {
        const match = /(^|\s)@([^\s@]*)$/.exec(draft);
        return match ? match[2] : '';
      })();

      useEffect(() => {
        if (picker !== 'file' || isOverview) return undefined;
        let stopped = false;
        const timer = setTimeout(async () => {
          setMentions((prev) => ({ ...prev, loading: true }));
          try {
            const value = await call('/mentions?projectId=' + encodeURIComponent(projectId)
              + '&q=' + encodeURIComponent(mentionWord));
            if (!stopped) setMentions({ items: value.items || [], loading: false });
          } catch (error) {
            if (!stopped) setMentions({ items: [], loading: false });
          }
        }, 160);
        return () => {
          stopped = true;
          clearTimeout(timer);
        };
      }, [picker, mentionWord, projectId, isOverview]);

      const startSession = async () => {
        setBusy(true);
        try {
          const value = await post('/chat/new', payloadBase);
          await load(true);
          if (typeof props.onSession === 'function') props.onSession(value.sessionId);
          return value.sessionId;
        } catch (error) {
          say('新建会话失败：' + msg(error), 'error');
          return '';
        } finally {
          setBusy(false);
        }
      };

      const insertMention = (path) => {
        setDraft((prev) => {
          const match = /(^|\s)@([^\s@]*)$/.exec(prev);
          const token = '@' + path + ' ';
          if (match) return prev.slice(0, match.index + match[1].length) + token;
          return prev + (prev && !/\s$/.test(prev) ? ' ' : '') + token;
        });
        setPicker('');
        setPickIndex(0);
        const node = inputRef.current;
        if (node) node.focus();
      };

      const insertCommand = (name) => {
        setDraft('/' + name + ' ');
        setPicker('');
        setPickIndex(0);
        const node = inputRef.current;
        if (node) node.focus();
      };

      const send = async () => {
        const text = String(draft || '').trim();
        if (!text || sending) return;
        setSending(true);
        try {
          if (!chat.sessionId) {
            const created = await startSession();
            if (!created) return;
          }
          if (text.startsWith('/')) {
            const value = await post('/command', { ...payloadBase, line: text });
            const feedback = String(value.text || '').trim();
            setNotices((prev) => prev.concat([{
              key: 'c' + Date.now(),
              text: feedback || ('已执行 ' + text)
            }]).slice(-4));
            setDraft('');
            await loadComposer();
            await load(true);
          } else {
            await post('/chat/send', { ...payloadBase, text });
            setDraft('');
            await load(true);
          }
        } catch (error) {
          say('发送失败：' + msg(error), 'error');
        } finally {
          setSending(false);
        }
      };

      const bound = Boolean(chat.sessionId);

      const pickModel = async (model) => {
        setPicker('');
        if (!bound) {
          say('先发一句话建好会话，再换模型', 'error');
          return;
        }
        try {
          const value = await post('/composer/model', {
            ...payloadBase,
            provider: model.provider,
            model: model.model,
            reasoningEffort: model.defaultEffort
          });
          setComposer((prev) => ({ ...prev, selection: value.selection || prev.selection }));
          say('已切到 ' + model.modelName, 'ok');
        } catch (error) {
          say('换模型失败：' + msg(error), 'error');
        }
      };

      const cycleEffort = async () => {
        const selection = composer.selection || null;
        if (!bound || !selection) return;
        const model = (composer.models || []).find((item) => item.model === selection.model) || null;
        if (!model || !model.efforts.length) return;
        const list = model.efforts.map((item) => item.id);
        const current = list.indexOf(selection.reasoningEffort);
        const wanted = list[(current + 1) % list.length];
        try {
          const value = await post('/composer/model', {
            ...payloadBase,
            provider: selection.provider,
            model: selection.model,
            reasoningEffort: wanted
          });
          setComposer((prev) => ({ ...prev, selection: value.selection || prev.selection }));
        } catch (error) {
          say('换档位失败：' + msg(error), 'error');
        }
      };

      const pickPermission = async (preset) => {
        setPicker('');
        if (!bound) {
          say('先发一句话建好会话，再改权限', 'error');
          return;
        }
        try {
          await post('/composer/permission', { ...payloadBase, preset: preset.id });
          setComposer((prev) => ({
            ...prev,
            permission: { ...(prev.permission || {}), preset: preset.id }
          }));
          say('权限改成「' + preset.name + '」', 'ok');
        } catch (error) {
          say('改权限失败：' + msg(error), 'error');
        }
      };

      const runPicker = () => {
        if (picker === 'file' && mentions.items[pickIndex]) {
          insertMention(mentions.items[pickIndex].path);
          return true;
        }
        if (picker === 'command') {
          const list = commandSuggestions;
          if (list[pickIndex]) {
            insertCommand(list[pickIndex].name);
            return true;
          }
        }
        return false;
      };

      const running = Boolean(chat.status && chat.status.running);
      const items = chat.items || [];
      const agentName = isOverview ? '总览智能体' : '主智能体';
      const commands = composer.commands || [];
      const commandQuery = String(draft || '').startsWith('/') && !String(draft || '').includes('\n')
        ? String(draft || '').slice(1).toLowerCase()
        : null;
      const commandSuggestions = commandQuery === null
        ? []
        : commands.filter((item) => !commandQuery || item.name.toLowerCase().includes(commandQuery)).slice(0, 8);
      const selection = composer.selection || null;
      const presetId = composer.permission && composer.permission.preset ? composer.permission.preset : '';
      const presetName = (() => {
        const list = (composer.permission && composer.permission.presets) || [];
        const hit = list.find((item) => item.id === presetId);
        return hit ? hit.name : '权限';
      })();
      const modelName = selection
        ? (() => {
          const hit = (composer.models || []).find((item) => item.model === selection.model);
          return (hit && hit.modelName) || selection.model;
        })()
        : '模型';

      return h('section', { className: 'pm-chat' },
        h('div', { className: 'pm-chat-head' },
          h('span', { className: 'pm-chat-title' }, agentName),
          h('span', {
            className: cx('pm-chat-dot', running ? 'is-busy' : (chat.sessionId ? 'is-idle' : 'is-none')),
            title: running ? '正在处理' : (chat.sessionId ? '空闲' : '未建会话')
          }),
          h('span', { className: 'pm-chat-status' },
            running ? '正在处理…' : (chat.sessionId ? '空闲' : '未建会话')),
          h('button', {
            className: 'pm-btn is-ghost pm-icon-btn',
            onClick: startSession,
            disabled: busy,
            title: chat.sessionId ? '新建会话并重新绑定' : '建一个会话'
          }, busy ? h(Spinner) : null, chat.sessionId ? '新会话' : '开始对话')),

        h('div', { className: 'pm-chat-box', ref: boxRef },
          chat.loading ? h('div', { className: 'pm-chat-hint' }, '载入中…') : null,
          !chat.loading && chat.error
            ? h('div', { className: 'pm-chat-hint is-error' }, chat.error)
            : null,
          !chat.loading && !chat.error && !items.length
            ? h('div', { className: 'pm-chat-hint' },
              isOverview
                ? '这里直接和总览智能体对话：可以问「本周各项目改了什么」，也能让它把右侧汇总润色成周报。'
                : '这里直接和主智能体对话，不用跳到会话页：让它读项目档案、按模块派单、汇总产出。')
            : null,
          items.map((item, index) => h('div', {
            key: 'm' + index,
            className: cx('pm-msg', item.role === 'user' ? 'is-user' : 'is-agent')
          },
            h('div', { className: 'pm-msg-role' }, item.role === 'user' ? '我' : agentName),
            h('div', { className: 'pm-msg-text' }, item.text))),
          notices.map((notice) => h('div', { key: notice.key, className: 'pm-chat-notice' }, notice.text)),
          sending ? h('div', { className: 'pm-chat-hint' }, h(Spinner), ' 已发送…') : null),

        h('div', { className: 'pm-chat-composer' },
          picker === 'file' ? h('div', { className: 'pm-picker' },
            h('div', { className: 'pm-picker-title' }, '引用项目里的文件'),
            mentions.loading ? h('div', { className: 'pm-picker-empty' }, '查找中…') : null,
            !mentions.loading && !mentions.items.length
              ? h('div', { className: 'pm-picker-empty' }, '没有匹配的文件')
              : null,
            mentions.items.map((item, index) => h('button', {
              key: item.path,
              className: cx('pm-picker-item', index === pickIndex ? 'is-active' : ''),
              onMouseEnter: () => setPickIndex(index),
              onClick: () => insertMention(item.path)
            }, h('span', { className: 'pm-picker-name' }, item.path.split('/').pop()),
            h('span', { className: 'pm-picker-path' }, item.path)))) : null,

          picker === 'command' ? h('div', { className: 'pm-picker' },
            h('div', { className: 'pm-picker-title' }, '斜杠命令'),
            commandSuggestions.length
              ? null
              : h('div', { className: 'pm-picker-empty' }, '还没有可用命令'),
            commandSuggestions.map((item, index) => h('button', {
              key: item.name,
              className: cx('pm-picker-item', index === pickIndex ? 'is-active' : ''),
              onMouseEnter: () => setPickIndex(index),
              onClick: () => insertCommand(item.name)
            }, h('span', { className: 'pm-picker-name' }, '/' + item.name),
            h('span', { className: 'pm-picker-path' }, item.description || '')))) : null,

          picker === 'model' ? h('div', { className: 'pm-picker is-menu' },
            h('div', { className: 'pm-picker-title' }, '选择模型'),
            (composer.models || []).map((item) => h('button', {
              key: item.provider + '/' + item.model,
              className: cx('pm-picker-item', selection && selection.model === item.model ? 'is-active' : ''),
              onClick: () => pickModel(item)
            }, h('span', { className: 'pm-picker-name' }, item.modelName),
            h('span', { className: 'pm-picker-path' }, item.providerName)))) : null,

          picker === 'permission' ? h('div', { className: 'pm-picker is-menu' },
            h('div', { className: 'pm-picker-title' }, '权限模式'),
            ((composer.permission && composer.permission.presets) || []).map((item) => h('button', {
              key: item.id,
              className: cx('pm-picker-item', presetId === item.id ? 'is-active' : ''),
              onClick: () => pickPermission(item)
            }, h('span', { className: 'pm-picker-name' }, item.name),
            h('span', { className: 'pm-picker-path' }, item.hint || '')))) : null,

          h('textarea', {
            className: 'pm-chat-input',
            rows: 2,
            ref: inputRef,
            value: draft,
            placeholder: running
              ? '它正在处理，可以继续留言（会排队）'
              : '说点什么…（@ 选文件、/ 用命令，Enter 发送，Shift+Enter 换行）',
            onChange: (event) => {
              setDraft(event.target.value);
              const next = event.target.value;
              if (/(^|\s)@[^\s@]*$/.test(next) && !isOverview) {
                setPicker('file');
              } else if (/^\/[^\s]*$/.test(next)) {
                setPicker('command');
              } else if (picker === 'file' || picker === 'command') {
                setPicker('');
              }
            },
            onKeyDown: (event) => {
              if (event.key === 'Escape') {
                setPicker('');
                return;
              }
              if (picker === 'file' || picker === 'command') {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setPickIndex((prev) => prev + 1);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setPickIndex((prev) => (prev > 0 ? prev - 1 : 0));
                  return;
                }
                if (event.key === 'Enter' && !event.shiftKey && runPicker()) {
                  event.preventDefault();
                  return;
                }
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }
          }),

          h('div', { className: 'pm-composer-bar' },
            h('div', { className: 'pm-composer-left' },
              h('button', {
                className: cx('pm-btn is-ghost pm-icon-btn', picker === 'file' ? 'is-primary' : ''),
                title: isOverview ? '总览没有项目文件，去项目页里引用' : '引用项目文件（也可以直接输入 @）',
                disabled: isOverview,
                onClick: () => {
                  const word = mentionWord;
                  if (!word && !/(^|\s)@[^\s@]*$/.test(draft)) setDraft((prev) => prev + (prev && !/\s$/.test(prev) ? ' ' : '') + '@');
                  setPickIndex(0);
                  setPicker('file');
                  const node = inputRef.current;
                  if (node) node.focus();
                }
              }, '＋'),
              h('button', {
                className: cx('pm-btn is-ghost pm-chip-btn', picker === 'command' ? 'is-primary' : ''),
                title: '斜杠命令',
                onClick: () => {
                  if (!String(draft).startsWith('/')) setDraft('/');
                  setPickIndex(0);
                  setPicker('command');
                  const node = inputRef.current;
                  if (node) node.focus();
                }
              }, '/ 命令'),
              h('button', {
                className: cx('pm-btn is-ghost pm-chip-btn', picker === 'permission' ? 'is-primary' : ''),
                title: bound ? '切换权限模式' : '先发一句话建好会话',
                onClick: () => {
                  setPickIndex(0);
                  setPicker(picker === 'permission' ? '' : 'permission');
                }
              }, presetName)),

            h('div', { className: 'pm-composer-right' },
              selection && selection.reasoningEffort
                ? h('button', {
                  className: 'pm-btn is-ghost pm-chip-btn',
                  title: '点击切换思考档位（' + selection.reasoningEffort + '）',
                  onClick: cycleEffort
                }, selection.reasoningEffort)
                : null,
              h('button', {
                className: cx('pm-btn is-ghost pm-chip-btn', picker === 'model' ? 'is-primary' : ''),
                title: bound ? '切换模型' : '先发一句话建好会话',
                onClick: () => {
                  setPickIndex(0);
                  setPicker(picker === 'model' ? '' : 'model');
                }
              }, modelName),
              h('button', {
                className: 'pm-btn is-primary',
                onClick: send,
                disabled: sending || !String(draft || '').trim()
              }, sending ? h(Spinner) : null, '发送'))),
          props.actions || null));
    }

    /* ------------------------------ 总览 */

    function OverviewPane(props) {
      const projects = props.projects || [];
      const [data, setData] = useState(null);
      const [error, setError] = useState('');
      const [query, setQuery] = useState('');
      const [search, setSearch] = useState(null);
      const [busySearch, setBusySearch] = useState(false);
      const [range, setRange] = useState('week');
      const [report, setReport] = useState(null);
      const [busyReport, setBusyReport] = useState(false);
      const say = props.say || (() => {});

      const load = useCallback(async () => {
        try {
          setData(await call('/overview'));
          setError('');
        } catch (err) {
          setError(msg(err));
        }
      }, []);

      useEffect(() => {
        load();
      }, [load]);

      const runSearch = async () => {
        const text = String(query || '').trim();
        if (!text) {
          setSearch(null);
          return;
        }
        setBusySearch(true);
        try {
          setSearch(await call('/search?q=' + encodeURIComponent(text)));
        } catch (err) {
          say('搜索失败：' + msg(err), 'error');
        } finally {
          setBusySearch(false);
        }
      };

      const runReport = async () => {
        setBusyReport(true);
        try {
          const value = await call('/report?range=' + range);
          setReport({ ...value, range, text: value.markdown || value.text || '' });
        } catch (err) {
          say('生成失败：' + msg(err), 'error');
        } finally {
          setBusyReport(false);
        }
      };

      const copyReport = async () => {
        if (!report) return;
        const ok = await copyText(report.text);
        say(ok ? '已复制到剪贴板，可直接贴给智能体' : '复制失败，请手动选中复制', ok ? 'ok' : 'error');
      };

      const saveReport = async () => {
        if (!report) return;
        try {
          const value = await post('/report/save', { text: report.text, range: report.range });
          say('已保存到 ' + value.rel);
        } catch (err) {
          say('保存失败：' + msg(err), 'error');
        }
      };

      const totals = (data && data.totals) || {};
      const cards = (data && data.projects) || [];

      return h('div', { className: 'pm-ov' },
        h('header', { className: 'pm-ov-head' },
          h('div', null,
            h('div', { className: 'pm-ov-title' }, '总览'),
            h('div', { className: 'pm-muted' }, '所有项目的汇总、跨项目检索与周报 / 月报草稿')),
          h('div', { className: 'pm-ov-stats' },
            h('span', { className: 'pm-ov-stat' }, h('b', null, String(totals.projects || 0)), ' 项目'),
            h('span', { className: 'pm-ov-stat' }, h('b', null, String(totals.files || 0)), ' 文件'),
            h('span', { className: 'pm-ov-stat' }, h('b', null, String(totals.weekChanged || 0)), ' 近 7 天改动'),
            h('span', { className: 'pm-ov-stat' }, h('b', null, String(totals.open || 0)), ' 待办'),
            h('button', { className: 'pm-btn is-ghost pm-icon-btn', onClick: load }, '刷新'))),

        h('div', { className: 'pm-ov-body' },
          h('div', { className: 'pm-ov-main' },
            error ? h('div', { className: 'pm-ov-note is-error' }, error) : null,

            h('section', { className: 'pm-ov-section' },
              h('div', { className: 'pm-ov-sec-head' }, '项目'),
              cards.length
                ? h('div', { className: 'pm-ov-cards' }, cards.map((card) =>
                  h('button', {
                    key: card.id,
                    className: 'pm-ov-card',
                    onClick: () => props.onOpenProject(card.id)
                  },
                    h('div', { className: 'pm-ov-card-top' },
                      h('span', { className: 'pm-ov-card-name' }, card.name),
                      card.missing ? h('span', { className: 'pm-pill is-warn' }, '目录缺失') : null),
                    h('div', { className: 'pm-ov-card-path' }, card.root),
                    h('div', { className: 'pm-ov-card-row' },
                      h('span', null, '文档 ' + ((card.stats && card.stats.doc) || 0)),
                      h('span', null, 'PPT ' + ((card.stats && card.stats.ppt) || 0)),
                      h('span', null, '表格 ' + ((card.stats && card.stats.xls) || 0)),
                      h('span', null, 'PDF ' + ((card.stats && card.stats.pdf) || 0))),
                    h('div', { className: 'pm-ov-card-row' },
                      h('span', null, '近 7 天改动 ' + ((card.weekChanged ?? card.recentCount) || 0)),
                      h('span', null, '待办 ' + ((card.board && card.board.open) || 0)),
                      h('span', null, '模块 ' + (card.modules || 0))),
                    card.recent && card.recent.length
                      ? h('div', { className: 'pm-ov-card-files' },
                        card.recent.slice(0, 3).map((file) =>
                          h('span', { key: file.rel, className: 'pm-ov-file' }, file.name)))
                      : null)))
                : h('div', { className: 'pm-empty-small' }, '还没有项目，先在左侧添加一个目录。')),

            h('section', { className: 'pm-ov-section' },
              h('div', { className: 'pm-ov-sec-head' }, '跨项目检索'),
              h('div', { className: 'pm-ov-search' },
                h('input', {
                  className: 'pm-input',
                  value: query,
                  placeholder: '搜文件名或文件内容，如：技术方案 / 里程碑',
                  onChange: (event) => setQuery(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') runSearch();
                  }
                }),
                h('button', { className: 'pm-btn', onClick: runSearch, disabled: busySearch },
                  busySearch ? h(Spinner) : null, '搜一下')),
              search
                ? h('div', { className: 'pm-ov-hits' },
                  search.hits.length === 0
                    ? h('div', { className: 'pm-empty-small' }, '没有命中')
                    : search.hits.map((hit, index) =>
                      h('div', { key: 'h' + index, className: 'pm-ov-hit' },
                        h('span', { className: 'pm-ov-hit-proj' }, hit.projectName),
                        h('span', { className: 'pm-ov-hit-rel' }, hit.rel),
                        h('span', { className: 'pm-ov-hit-kind' }, hit.kind === 'name' ? '文件名' : '第 ' + hit.line + ' 行'),
                        h('div', { className: 'pm-ov-hit-text' }, hit.text || ''))))
                : null),

            h('section', { className: 'pm-ov-section' },
              h('div', { className: 'pm-ov-sec-head' },
                '周报 / 月报',
                h('span', { className: 'pm-ov-sec-actions' },
                  h('button', { className: cx('pm-chip', range === 'week' ? 'is-on' : ''), onClick: () => setRange('week') }, '周报'),
                  h('button', { className: cx('pm-chip', range === 'month' ? 'is-on' : ''), onClick: () => setRange('month') }, '月报'),
                  h('button', { className: 'pm-btn', onClick: runReport, disabled: busyReport },
                    busyReport ? h(Spinner) : null, '生成草稿'))),
              report
                ? h('div', { className: 'pm-ov-report' },
                  h('pre', { className: 'pm-ov-report-body' }, report.text),
                  h('div', { className: 'pm-ov-report-actions' },
                    h('button', { className: 'pm-btn', onClick: copyReport }, '复制'),
                    h('button', { className: 'pm-btn is-ghost', onClick: saveReport }, '保存成 md'),
                    h('span', { className: 'pm-muted' }, '复制后贴到右侧对话，可让智能体润色成正式稿。')))
                : h('div', { className: 'pm-empty-small' },
                  '按时间窗汇总各项目的改动清单、未完成待办与模块名册，生成可直接润色的 Markdown 草稿。'))),

          h('aside', { className: 'pm-ov-chat' },
            h(ChatPane, {
              target: 'overview',
              say,
              onSession: () => load()
            }))));
    }

    /* ------------------------------ 智能体一栏 */

    function AgentPane(props) {
      const project = props.project;
      const presets = props.presets || [];
      const [form, setForm] = useState(null);
      const [busyOpen, setBusyOpen] = useState(false);

      const modules = project.modules || [];
      const active = modules.filter((item) => item.enabled !== false);

      const saveModules = (next) => {
        props.patch({ modules: next });
      };

      const startAdd = () => {
        setForm({ id: '', name: '', role: '', deliverables: '', instructions: '' });
      };

      const startEdit = (item) => {
        setForm({ id: item.id, name: item.name, role: item.role, deliverables: item.deliverables, instructions: item.instructions });
      };

      const applyPreset = (preset) => {
        setForm({
          id: '',
          name: preset.name,
          role: preset.role,
          deliverables: preset.deliverables,
          instructions: preset.instructions
        });
      };

      const commit = () => {
        if (!form) return;
        const name = String(form.name || '').trim();
        if (!name) {
          props.say('模块名不能为空', 'error');
          return;
        }
        const entry = {
          id: form.id || 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name,
          role: String(form.role || '').trim(),
          deliverables: String(form.deliverables || '').trim(),
          instructions: String(form.instructions || '').trim(),
          enabled: form.id ? (modules.find((item) => item.id === form.id) || {}).enabled !== false : true
        };
        const next = form.id
          ? modules.map((item) => (item.id === form.id ? entry : item))
          : modules.concat([entry]);
        saveModules(next);
        setForm(null);
      };

      const openLead = async () => {
        setBusyOpen(true);
        try {
          await props.onOpenLead();
        } catch (error) {
          props.say('打开会话失败：' + msg(error), 'error');
        } finally {
          setBusyOpen(false);
        }
      };

      return h(
        'section',
        { className: 'pm-pane pm-agents' },
        h('div', { className: 'pm-pane-head' },
          h('span', { className: 'pm-pane-title' }, '智能体'),
          h('span', { className: 'pm-pane-sub' }, '1 主 + ' + active.length + ' 子')),

        h('div', { className: 'pm-pane-body pm-agent-body' },
          /* 主智能体：面板内直接对话 */
          h('div', { className: 'pm-chat-slot' },
            h(ChatPane, {
              projectId: project.id,
              say: props.say,
              onSession: (sessionId) => {
                if (sessionId) props.patch({ leadSessionId: sessionId });
              },
              actions: h('span', { className: 'pm-chat-links' },
                h('button', { className: 'pm-btn is-ghost pm-icon-btn', onClick: props.onBrief, disabled: props.briefBusy },
                  props.briefBusy ? h(Spinner) : null, '协作档案'),
                h('button', { className: 'pm-btn is-ghost pm-icon-btn', onClick: props.onCopyLaunch }, '启动指令'),
                project.leadSessionId
                  ? h('button', { className: 'pm-btn is-ghost pm-icon-btn', onClick: openLead, disabled: busyOpen }, '在会话页打开')
                  : null)
            }))

          /* 子智能体模块 */
          , h('div', { className: 'pm-card pm-card-grow' },
            h('div', { className: 'pm-card-head' },
              h('span', { className: 'pm-card-title' }, '子智能体模块'),
              h('button', { className: 'pm-btn is-ghost', onClick: startAdd }, '＋ 新增')),
            h('p', { className: 'pm-card-note' },
              '每个模块一个子智能体，由主智能体按模块派单。名册会写进 _pm/ 供它读取。'),

            form
              ? h('div', { className: 'pm-form' },
                h('div', { className: 'pm-form-row' },
                  h('label', { className: 'pm-label' }, '模块名'),
                  h('input', {
                    className: 'pm-input',
                    value: form.name,
                    placeholder: '如：技术方案',
                    autoFocus: true,
                    onChange: (event) => setForm({ ...form, name: event.target.value })
                  })),
                h('div', { className: 'pm-form-row' },
                  h('label', { className: 'pm-label' }, '职责'),
                  h('textarea', {
                    className: 'pm-input pm-input-multi',
                    rows: 2,
                    value: form.role,
                    placeholder: '这个子智能体负责什么',
                    onChange: (event) => setForm({ ...form, role: event.target.value })
                  })),
                h('div', { className: 'pm-form-row' },
                  h('label', { className: 'pm-label' }, '交付物'),
                  h('input', {
                    className: 'pm-input',
                    value: form.deliverables,
                    placeholder: '如：技术方案.md、架构图',
                    onChange: (event) => setForm({ ...form, deliverables: event.target.value })
                  })),
                h('div', { className: 'pm-form-row' },
                  h('label', { className: 'pm-label' }, '补充要求'),
                  h('textarea', {
                    className: 'pm-input pm-input-multi',
                    rows: 2,
                    value: form.instructions,
                    placeholder: '边界、格式、参考资料等',
                    onChange: (event) => setForm({ ...form, instructions: event.target.value })
                  })),
                presets.length
                  ? h('div', { className: 'pm-presets' },
                    h('span', { className: 'pm-label' }, '快速套用'),
                    presets.map((preset) =>
                      h('button', { key: preset.key, className: 'pm-chip', onClick: () => applyPreset(preset) }, preset.name)))
                  : null,
                h('div', { className: 'pm-actions' },
                  h('button', { className: 'pm-btn is-primary', onClick: commit }, form.id ? '保存模块' : '添加模块'),
                  h('button', { className: 'pm-btn is-ghost', onClick: () => setForm(null) }, '取消')))
              : null,

            modules.length === 0 && !form
              ? h('div', { className: 'pm-empty-small' },
                h('p', null, '还没有配置子智能体模块。'),
                h('p', { className: 'pm-muted' }, '可以从「技术方案 / 评审材料 / 汇报 PPT / 数据表格」等预设开始。'))
              : null,

            h('div', { className: 'pm-mod-list' },
              modules.map((item) =>
                h('div', { key: item.id, className: cx('pm-mod', item.enabled === false ? 'is-off' : '') },
                  h('div', { className: 'pm-mod-head' },
                    h('span', { className: 'pm-mod-name' }, item.name),
                    h('button', {
                      className: cx('pm-switch', item.enabled === false ? '' : 'is-on'),
                      title: item.enabled === false ? '启用' : '停用',
                      onClick: () => saveModules(modules.map((one) =>
                        one.id === item.id ? { ...one, enabled: one.enabled === false } : one))
                    }, h('span', { className: 'pm-switch-dot' }))),
                  item.role ? h('p', { className: 'pm-mod-role' }, item.role) : null,
                  item.deliverables ? h('p', { className: 'pm-mod-meta' }, '交付：' + item.deliverables) : null,
                  h('div', { className: 'pm-mod-actions' },
                    h('button', { className: 'pm-btn is-ghost', onClick: () => startEdit(item) }, '编辑'),
                    h('button', { className: 'pm-btn is-ghost', onClick: () => props.onCopyModule(item) }, '复制简报'),
                    h('button', {
                      className: 'pm-btn is-ghost is-danger',
                      onClick: async () => {
                        if (await props.ask('删除模块「' + item.name + '」？')) {
                          saveModules(modules.filter((one) => one.id !== item.id));
                        }
                      }
                    }, '删除'))))
            ))
        )
      );
    }

    /* ------------------------------ 项目窗口 */

    /* ------------------------------ Office 内嵌预览 */

    function DocPreview(props) {
      const { projectId, rel, info, doc } = props;
      if (!doc || doc.status === 'loading') {
        return h('div', { className: 'pm-doc-loading' },
          h(Spinner),
          h('div', { className: 'pm-doc-loading-text' },
            h('p', { className: 'pm-empty-title' }, '正在生成预览…'),
            h('p', { className: 'pm-muted' }, '首次打开 office 文档需要 1–3 秒，之后直接读缓存。')),
          h('p', { className: 'pm-muted' }, info.name));
      }
      if (doc.status === 'error') {
        return h('div', { className: 'pm-empty' },
          h('p', { className: 'pm-empty-title' }, info.name),
          h('p', { className: 'pm-muted' }, doc.message || '预览失败'),
          h('p', { className: 'pm-muted' }, fmtSize(info.size) + ' · ' + fmtTime(info.mtimeMs)),
          h('div', { className: 'pm-empty-actions' },
            h('button', { className: 'pm-btn is-primary', onClick: props.onRetry }, '重试'),
            h('button', { className: 'pm-btn', onClick: props.onOpenExternal }, '用系统程序打开')));
      }
      const tiles = Array.isArray(doc.tiles) ? doc.tiles : [];
      if (!tiles.length) {
        return h('div', { className: 'pm-empty' },
          h('p', { className: 'pm-empty-title' }, info.name),
          h('p', { className: 'pm-muted' }, '这个文档没有可显示的页面。'),
          h('button', { className: 'pm-btn is-primary', onClick: props.onOpenExternal }, '用系统程序打开'));
      }
      return h('div', { className: 'pm-doc' },
        h('div', { className: 'pm-doc-scroll' },
          ...tiles.map((tile, index) => h('figure', { className: 'pm-page-wrap', key: tile.name },
            h('img', {
              className: 'pm-page',
              alt: tile.sheet ? '工作表 ' + tile.sheet : '第 ' + (tile.page || index + 1) + ' 页',
              loading: 'lazy',
              src: API + '/preview/tile?' + new URLSearchParams({
                projectId,
                path: rel,
                tile: tile.name,
                v: String(doc.mtimeMs || '')
              }).toString()
            }),
            h('figcaption', { className: 'pm-page-cap' },
              tile.sheet ? ('工作表 ' + tile.sheet) : ('第 ' + (tile.page || index + 1) + ' 页'),
              ' / ' + String(doc.pageCount || tiles.length))))),
        h('div', { className: 'pm-doc-foot' },
          h('span', { className: 'pm-doc-note' }, '由内置引擎渲染 · 只读，改文档请用「外部打开」'),
          doc.missingFonts && doc.missingFonts.length
            ? h('span', { className: 'pm-doc-note' }, '缺字体：' + doc.missingFonts.join('、'))
            : null));
    }

    function ProjectWindow(props) {
      const project = props.project;
      const projectId = project.id;
      const say = props.say;
      const get = props.get;

      const [nodes, setNodes] = useState({});
      const [expanded, setExpanded] = useState(() => new Set());
      const [sel, setSel] = useState(null);
      const [draft, setDraft] = useState('');
      const [dirty, setDirty] = useState(false);
      const [saving, setSaving] = useState(false);
      const [preview, setPreview] = useState(false);
      const [doc, setDoc] = useState(null);
      const [busyBrief, setBusyBrief] = useState(false);
      const [renaming, setRenaming] = useState(null);
      const [pendingRel, setPendingRel] = useState(null);
      const [notesOpen, setNotesOpen] = useState(false);
      const [notesDraft, setNotesDraft] = useState(project.notes || '');
      const [aiBusy, setAiBusy] = useState('');
      const [autoSave, setAutoSave] = useState(() => {
        try {
          return localStorage.getItem('dafeiyu.autosave') !== 'off';
        } catch {
          return true;
        }
      });
      const [showFiles, setShowFiles] = useState(() => readPref('dafeiyu.pane.files', true));
      const [showAgent, setShowAgent] = useState(() => readPref('dafeiyu.pane.agent', true));

      const togglePane = (pane) => {
        if (pane === 'files') {
          const next = !showFiles;
          setShowFiles(next);
          writePref('dafeiyu.pane.files', next);
        } else {
          const next = !showAgent;
          setShowAgent(next);
          writePref('dafeiyu.pane.agent', next);
        }
      };

      const toggleFocus = () => {
        const focusing = showFiles || showAgent;
        setShowFiles(!focusing);
        setShowAgent(!focusing);
        writePref('dafeiyu.pane.files', !focusing);
        writePref('dafeiyu.pane.agent', !focusing);
        say(focusing ? '专注模式：只留文档，再点一次恢复' : '已恢复文件树和智能体栏');
      };

      const selRef = useRef(null);
      selRef.current = sel;
      const editorRef = useRef(null);

      const patch = useCallback((changes) => {
        post('/project/update', { id: projectId, patch: changes })
          .then((value) => props.onPatched(value.project, value.stats))
          .catch((error) => say('保存失败：' + msg(error), 'error'));
      }, [projectId, props.onPatched, say]);

      const loadDir = useCallback(async (rel) => {
        setNodes((prev) => ({ ...prev, [rel]: { ...(prev[rel] || {}), loading: true, error: '' } }));
        try {
          const value = await call('/tree', { projectId, path: rel });
          setNodes((prev) => ({ ...prev, [rel]: { entries: value.entries || [], loading: false, error: '' } }));
          return value;
        } catch (error) {
          setNodes((prev) => ({ ...prev, [rel]: { entries: [], loading: false, error: msg(error) } }));
          return null;
        }
      }, [projectId]);

      const openFile = useCallback(async (rel, force) => {
        if (!rel) return;
        if (dirty && !force) {
          const ok = await props.ask('当前文件有未保存的修改，放弃并打开另一个文件？');
          if (!ok) return;
        }
        try {
          const info = await call('/file', { projectId, path: rel });
          setSel({ rel, info });
          setDraft(info.text || '');
          setDirty(false);
          setPreview(info.kind === 'text' && /\.(md|markdown)$/i.test(rel));
          if (project.lastRel !== rel) patch({ lastRel: rel });
        } catch (error) {
          say('打不开：' + msg(error), 'error');
        }
      }, [dirty, patch, project.lastRel, projectId, say]);

      const loadDoc = useCallback(async (rel, force) => {
        if (!rel) return;
        setDoc({ status: 'loading', rel });
        try {
          const value = await post('/preview', { projectId, path: rel, refresh: Boolean(force) });
          setDoc({ status: 'ready', rel, ...value });
        } catch (error) {
          setDoc({ status: 'error', rel, message: msg(error), code: error.code || '' });
        }
      }, [projectId]);

      useEffect(() => {
        const current = sel;
        if (!current || current.info.kind !== 'office') {
          setDoc(null);
          return undefined;
        }
        let alive = true;
        setDoc({ status: 'loading', rel: current.rel });
        post('/preview', { projectId, path: current.rel })
          .then((value) => {
            if (alive) setDoc({ status: 'ready', rel: current.rel, ...value });
          })
          .catch((error) => {
            if (alive) setDoc({ status: 'error', rel: current.rel, message: msg(error), code: error.code || '' });
          });
        return () => {
          alive = false;
        };
        // 换文件时重新渲染；保存不会影响 office 预阅
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [sel && sel.rel, projectId]);

      useEffect(() => {
        let alive = true;
        setExpanded(new Set());
        setNodes({});
        setSel(null);
        setDraft('');
        setDirty(false);
        (async () => {
          const value = await loadDir('');
          if (!alive) return;
          if (project.lastRel) {
            const top = String(project.lastRel).split('/')[0];
            if (top && value && (value.entries || []).some((entry) => entry.name === top && entry.dir)) {
              setExpanded((prev) => new Set(prev).add(top));
            }
            openFile(project.lastRel, true).catch(() => {});
          }
        })();
        return () => {
          alive = false;
        };
        // 只在切换项目时重建
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [projectId]);

      const toggleDir = useCallback((entry) => {
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(entry.rel)) next.delete(entry.rel);
          else {
            next.add(entry.rel);
            if (!nodes[entry.rel] || !nodes[entry.rel].entries) loadDir(entry.rel);
          }
          return next;
        });
      }, [loadDir, nodes]);

      const save = useCallback(async (options) => {
        const current = selRef.current;
        if (!current || !current.info.editable) return;
        const quiet = Boolean(options && options.silent);
        setSaving(true);
        try {
          const value = await post('/file/save', {
            projectId,
            path: current.rel,
            text: draft,
            baseMtimeMs: current.info.mtimeMs
          });
          setSel((prev) => (prev ? { ...prev, info: { ...prev.info, mtimeMs: value.mtimeMs, size: value.size, text: draft } } : prev));
          setDirty(false);
          if (!quiet) say('已保存 ' + current.info.name);
          loadDir(parentOf(current.rel));
        } catch (error) {
          if (error.code === 'CONFLICT') say('文件已被其它程序改动，请先点「重新读取」', 'error');
          else say('保存失败：' + msg(error), 'error');
        } finally {
          setSaving(false);
        }
      }, [draft, loadDir, projectId, say]);

      /* 改完停手 1.2 秒自动落盘；有冲突会照常弹提示，不会静默丢字 */
      useEffect(() => {
        try {
          localStorage.setItem('dafeiyu.autosave', autoSave ? 'on' : 'off');
        } catch {
          /* 隐私模式下写不了，忽略 */
        }
      }, [autoSave]);

      useEffect(() => {
        if (!autoSave || !dirty || saving) return undefined;
        const current = selRef.current;
        if (!current || !current.info.editable) return undefined;
        const timer = setTimeout(() => {
          save({ silent: true });
        }, 1200);
        return () => clearTimeout(timer);
      }, [autoSave, dirty, saving, draft, save]);

      const askAiRewrite = useCallback(async (mode) => {
        const current = selRef.current;
        if (!current || !current.info.editable) return;
        const node = editorRef.current;
        let picked = '';
        try {
          if (node && typeof node.selectionStart === 'number' && node.selectionEnd > node.selectionStart) {
            picked = String(draft || '').slice(node.selectionStart, node.selectionEnd);
          }
        } catch {
          picked = '';
        }
        const body = (picked && picked.trim() ? picked : String(draft || '')).trim();
        if (!body) {
          say('这个文件没有内容可改', 'error');
          return;
        }
        const goal = mode === 'tighten'
          ? '精简压缩：去掉重复和口水话，保留全部结论、数字、条款。'
          : mode === 'struct'
            ? '重排结构：调整段落顺序与层级，让结论在前，保留全部信息与数字。'
            : '润色文字：改措辞与节奏，保持原意，数字、条款、专有名词一律不动。';
        const prompt = [
          '【大肥鱼 · 文档改造请求】',
          '项目：' + project.name,
          '文件：' + current.rel,
          '范围：' + (picked && picked.trim() ? '只改下面这段选中内容' : '整篇'),
          '要求：' + goal,
          '',
          '原文开始 >>>',
          body.slice(0, 12000),
          '<<< 原文结束',
          '',
          '请把改好的版本写回这个文件（可直接覆盖原文件），改完用一句话说明改了哪里。'
        ].join('\n');
        setAiBusy(mode);
        try {
          await post('/chat/send', { projectId, text: prompt });
          say('已发给主智能体，改完看右侧对话或点「重新读取」');
        } catch (error) {
          say('发送失败：' + msg(error), 'error');
        } finally {
          setAiBusy('');
        }
      }, [draft, project.name, projectId, say]);

      const openExternal = useCallback(async (rel) => {
        try {
          await post('/open', { projectId, path: rel || '' });
        } catch (error) {
          say('打开失败：' + msg(error), 'error');
        }
      }, [projectId, say]);

      const runBrief = useCallback(async () => {
        setBusyBrief(true);
        try {
          const value = await post('/brief', { projectId });
          say('已生成协作档案：' + value.files.length + ' 个文件（_pm/）');
          await loadDir('');
          setExpanded((prev) => new Set(prev).add('_pm'));
          await loadDir('_pm');
        } catch (error) {
          say('生成失败：' + msg(error), 'error');
        } finally {
          setBusyBrief(false);
        }
      }, [loadDir, projectId, say]);

      const openLead = useCallback(async () => {
        const uiWorkspace = svc(get, 'uiWorkspace');
        if (!uiWorkspace) throw new Error('界面导航服务不可用（uiWorkspace）');
        if (project.leadSessionId) {
          uiWorkspace.openSession(project.leadSessionId);
          say('已切换到主智能体会话');
          return;
        }
        let workspaceId = project.workspaceId;
        if (!workspaceId) workspaceId = findWorkspace(get, project.root);
        if (!workspaceId) {
          const workspaces = svc(get, 'workspaces');
          if (!workspaces) throw new Error('工作区服务不可用（workspaces）');
          const view = await workspaces.create({ path: project.root });
          workspaceId = view && (view.workspaceId || (view.workspace && view.workspace.workspaceId)) || null;
          if (!workspaceId) throw new Error('创建工作区失败：' + JSON.stringify(view || null));
        }
        if (workspaceId !== project.workspaceId) patch({ workspaceId });
        const sessionId = await uiWorkspace.connectWorkspace(workspaceId);
        if (sessionId) {
          patch({ leadSessionId: sessionId });
          try {
            uiWorkspace.openSession(sessionId);
          } catch {
            /* 导航失败不阻塞绑定 */
          }
          say('已创建主智能体会话');
        } else {
          uiWorkspace.openWorkspace(workspaceId);
          say('已打开项目工作区');
        }
      }, [get, patch, project.leadSessionId, project.root, project.workspaceId, say]);

      const launchText = () => {
        const modules = (project.modules || []).filter((item) => item.enabled !== false);
        const lines = [];
        lines.push('你是「' + project.name + '」项目的主智能体，负责统筹本项目的全部文档工作。');
        lines.push('');
        lines.push('项目根目录：' + project.root);
        lines.push('');
        lines.push('## 一、先读项目档案');
        lines.push('1. `_pm/项目档案.md`（项目全貌与子智能体名册）');
        lines.push('2. `_pm/任务看板.md`（当前任务状态）');
        lines.push('');
        lines.push('## 二、按模块派发子智能体（一个模块一个子智能体）');
        if (modules.length === 0) {
    lines.push('（尚未配置模块：请先在「大肥鱼」里添加子智能体模块）');
        } else {
          modules.forEach((item, index) => {
            lines.push(
              (index + 1) + '. **' + item.name + '** — 简报 `_pm/模块/' + slugify(item.name) + '.md`' +
              (item.role ? '；职责：' + item.role : '') +
              (item.deliverables ? '；交付：' + item.deliverables : '')
            );
          });
        }
        lines.push('');
        lines.push('## 三、派发方式');
        lines.push('1. 用子智能体能力派发（每模块一个子智能体、各自独立会话），也可以交给 Agent Teams 建任务。');
        lines.push('2. 每次派单都要写清：模块简报路径、职责、交付物、边界，并要求子智能体先读简报再动手。');
        lines.push('3. 多个模块可并行推进；你负责汇总、校验、统一口径，必要时自己动笔改写。');
        lines.push('');
        lines.push('## 四、汇报与交付');
        lines.push('1. 每轮结束更新 `_pm/任务看板.md`，并向我汇报：完成项、产出文件路径、待确认事项。');
        lines.push('2. 正式提交件：技术方案用 Markdown 并转 PDF，汇报用 PPT，数据用 Excel。');
        lines.push('3. 需要调整模块分工或新增模块时先问我；确认后由我在大肥鱼里更新名册与简报。');
        return lines.join('\n');
      };

      const copyLaunch = useCallback(async () => {
        const ok = await copyText(launchText());
        say(ok ? '启动指令已复制，粘贴到主智能体会话即可' : '复制失败，请手动选择文本', ok ? 'ok' : 'error');
      }, [project.modules, project.name, project.root, say]);

      const copyModule = useCallback(async (item) => {
        const lines = [
          '你是「' + project.name + '」项目的子智能体，负责「' + item.name + '」模块。',
          '',
          '项目根目录：' + project.root,
          '模块简报：_pm/模块/' + slugify(item.name) + '.md',
          item.role ? '职责：' + item.role : '',
          item.deliverables ? '交付物：' + item.deliverables : '',
          item.instructions ? '补充要求：' + item.instructions : '',
          '',
          '要求：只处理本模块范围；产出写回项目目录；完成后用三行汇报（做了什么 / 文件路径 / 需要谁配合）。'
        ].filter(Boolean);
        const ok = await copyText(lines.join('\n'));
        say(ok ? '「' + item.name + '」派单指令已复制' : '复制失败', ok ? 'ok' : 'error');
      }, [project.modules, project.name, project.root, say]);

      const commitRename = () => {
        const next = String(renaming || '').trim();
        setRenaming(null);
        if (next && next !== project.name) patch({ name: next });
      };

      const removeProject = async () => {
        if (!(await props.ask('从大肥鱼移除「' + project.name + '」？本地文件不会被删除。'))) return;
        props.onDelete(project);
      };

      const onTreeEntry = (entry, depth) => {
        if (entry.dir) toggleDir(entry);
        else openFile(entry.rel);
      };

      const renderTree = (rel, depth) => {
        const node = nodes[rel];
        if (!node) return null;
        if (node.loading && !node.entries) {
          return h('div', { className: 'pm-hint' }, h(Spinner), ' 载入中…');
        }
        if (node.error) return h('div', { className: 'pm-hint is-error' }, node.error);
        return (node.entries || []).map((entry) => {
          const badge = badgeOf(entry);
          const isOpen = expanded.has(entry.rel);
          const isActive = sel && sel.rel === entry.rel;
          return h(
            React.Fragment,
            { key: entry.rel },
            h('button', {
              className: cx('pm-tree-row', entry.dir ? 'is-dir' : '', isActive ? 'is-active' : ''),
              style: { paddingLeft: (6 + depth * 12) + 'px' },
              title: entry.rel,
              onClick: () => onTreeEntry(entry, depth)
            },
              h('span', { className: 'pm-caret' }, entry.dir ? (isOpen ? '▾' : '▸') : ''),
              h('span', { className: 'pm-badge ' + badge.tone }, badge.text),
              h('span', { className: 'pm-tree-name' }, entry.name)),
            entry.dir && isOpen ? renderTree(entry.rel, depth + 1) : null
          );
        });
      };

      const stats = project.stats || {};

      return h(
        'div',
        {
          className: 'pm-main',
          style: { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, gap: 10 }
        },

        /* 头部 */
        h('header', { className: 'pm-head' },
          h('div', { className: 'pm-head-main' },
            h('div', { className: 'pm-head-title-row' },
              renaming !== null
                ? h('input', {
                  className: 'pm-input pm-input-title',
                  value: renaming,
                  autoFocus: true,
                  onChange: (event) => setRenaming(event.target.value),
                  onBlur: commitRename,
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') commitRename();
                    if (event.key === 'Escape') setRenaming(null);
                  }
                })
                : h('button', {
                  className: 'pm-title',
                  title: '点击重命名',
                  onClick: () => setRenaming(project.name)
                }, project.name),
              h('span', { className: cx('pm-pill', stats.exists === false ? 'is-warn' : 'is-ok') },
                stats.exists === false ? '目录不存在' : '本地目录')),
            h('button', {
              className: 'pm-path',
              title: '点击复制路径',
              onClick: async () => {
                const ok = await copyText(project.root);
                say(ok ? '路径已复制' : '复制失败', ok ? 'ok' : 'error');
              }
            }, project.root),
            h('div', { className: 'pm-head-stats' },
              h('span', null, '文档 ' + (stats.doc || 0)),
              h('span', null, 'PPT ' + (stats.ppt || 0)),
              h('span', null, '表格 ' + (stats.xls || 0)),
              h('span', null, 'PDF ' + (stats.pdf || 0)),
              h('span', null, '共 ' + (stats.files || 0) + ' 个文件')))
          ,
          h('div', { className: 'pm-head-actions' },
            h('button', {
              className: cx('pm-btn', showFiles ? 'is-ghost' : 'is-primary'),
              title: '折叠 / 展开左侧文件树，给文档腾地方',
              onClick: () => togglePane('files')
            }, showFiles ? '收起文件树' : '展开文件树'),
            h('button', {
              className: cx('pm-btn', showAgent ? 'is-ghost' : 'is-primary'),
              title: '折叠 / 展开右侧智能体栏',
              onClick: () => togglePane('agent')
            }, showAgent ? '收起 AI 栏' : '展开 AI 栏'),
            h('button', {
              className: cx('pm-btn', (!showFiles && !showAgent) ? 'is-primary' : ''),
              title: '只留文档，屏幕再小也能看全',
              onClick: toggleFocus
            }, '专注'),
            h('button', { className: 'pm-btn', onClick: () => openExternal(''), title: '在资源管理器中打开项目目录' }, '打开文件夹'),
            h('button', {
              className: 'pm-btn',
              onClick: () => setNotesOpen(!notesOpen),
              title: '项目说明会写进协作档案'
            }, '说明'),
            h('button', { className: 'pm-btn is-danger', onClick: removeProject, title: '从大肥鱼移除（不删文件）' }, '移除'))),

        notesOpen
          ? h('div', { className: 'pm-notes' },
            h('textarea', {
              className: 'pm-input pm-input-multi',
              rows: 3,
              value: notesDraft,
              placeholder: '项目背景、干系人、里程碑……写在这里会进入 _pm/项目档案.md',
              onChange: (event) => setNotesDraft(event.target.value)
            }),
            h('div', { className: 'pm-actions' },
              h('button', {
                className: 'pm-btn is-primary',
                onClick: () => {
                  patch({ notes: notesDraft });
                  setNotesOpen(false);
                  say('项目说明已保存');
                }
              }, '保存'),
              h('button', { className: 'pm-btn is-ghost', onClick: () => setNotesOpen(false) }, '取消')))
          : null,

        /* 三栏（文件树 / 编辑预览 / 智能体栏，可各自折叠） */
        h('div', {
          className: cx('pm-body', !showFiles ? 'no-files' : '', !showAgent ? 'no-agent' : '')
        },

          /* 文件树 */
          showFiles ? h('section', { className: 'pm-pane pm-files' },
            h('div', { className: 'pm-pane-head' },
              h('span', { className: 'pm-pane-title' }, '本地文件'),
              h('div', { className: 'pm-pane-tools' },
                h('button', { className: 'pm-btn is-ghost', title: '刷新文件树', onClick: () => loadDir('') }, '刷新'),
                h('button', { className: 'pm-btn is-ghost', title: '在资源管理器中打开', onClick: () => openExternal('') }, '↗'))),
            h('div', { className: 'pm-pane-body pm-tree' }, renderTree('', 0)),
            h('div', { className: 'pm-pane-foot' }, nodes[''] && nodes[''].entries ? nodes[''].entries.length + ' 项' : ''))
            : null,

          /* 编辑器 / 预览 */
          h('section', { className: 'pm-pane pm-editor' },
            h('div', { className: 'pm-pane-head' },
              h('span', { className: 'pm-pane-title pm-editor-name', title: sel ? sel.rel : '' },
                sel ? sel.info.name : '未选择文件'),
              h('div', { className: 'pm-pane-tools' },
                sel && sel.info.editable
                  ? h('button', {
                    className: cx('pm-btn', dirty ? 'is-primary' : ''),
                    onClick: () => save(),
                    disabled: saving || !dirty,
                    title: 'Ctrl+S'
                  }, saving ? h(Spinner) : null, dirty ? '保存' : '已保存')
                  : null,
                sel && sel.info.editable
                  ? h('button', {
                    className: cx('pm-btn', autoSave ? 'is-primary' : 'is-ghost'),
                    title: autoSave ? '改完会自动保存；点一下改成手动保存' : '现在是手动保存（Ctrl+S）；点一下开启自动保存',
                    onClick: () => {
                      setAutoSave(!autoSave);
                      say(autoSave ? '自动保存已关闭' : '自动保存已开启');
                    }
                  }, autoSave ? '自动保存' : '手动保存')
                  : null,
                sel && sel.info.editable && /\.(md|markdown)$/i.test(sel.rel)
                  ? h('button', { className: cx('pm-btn', preview ? 'is-primary' : 'is-ghost'), onClick: () => setPreview(!preview) },
                    preview ? '编辑' : '预览')
                  : null,
                sel && sel.info.kind === 'text'
                  ? h('button', {
                    className: 'pm-btn is-ghost',
                    title: '选中一段再点这里让主智能体改写；没选中就改整篇',
                    disabled: Boolean(aiBusy),
                    onClick: () => askAiRewrite('polish')
                  }, aiBusy === 'polish' ? h(Spinner) : null, 'AI 润色')
                  : null,
                sel && sel.info.kind === 'text'
                  ? h('button', {
                    className: 'pm-btn is-ghost',
                    title: '让主智能体把这段（或整篇）压缩得更紧',
                    disabled: Boolean(aiBusy),
                    onClick: () => askAiRewrite('tighten')
                  }, aiBusy === 'tighten' ? h(Spinner) : null, 'AI 精简')
                  : null,
                sel ? h('button', {
                  className: 'pm-btn is-ghost',
                  title: '重新读取（放弃本地修改）',
                  onClick: () => openFile(sel.rel, true)
                }, '重新读取') : null,
                sel && sel.info.kind === 'office' ? h('button', {
                  className: 'pm-btn is-ghost',
                  title: '重新渲染文档预览',
                  disabled: Boolean(doc && doc.status === 'loading'),
                  onClick: () => loadDoc(sel.rel, true)
                }, doc && doc.status === 'loading' ? '渲染中…' : '重新生成') : null,
                sel ? h('button', {
                  className: 'pm-btn is-ghost',
                  title: '用系统默认程序打开（Word / Excel / PPT / PDF 阅读器）',
                  onClick: () => openExternal(sel.rel)
                }, '外部打开') : null,
                sel ? h('button', { className: 'pm-btn is-ghost', onClick: () => { setSel(null); setDraft(''); setDirty(false); } }, '关闭') : null)),

            h('div', { className: 'pm-editor-body' },
              !sel
                ? h('div', { className: 'pm-empty' },
                  h('p', { className: 'pm-empty-title' }, '左侧选一个文件'),
                  h('p', { className: 'pm-muted' }, '文本 / 代码 / Markdown 直接在这里编辑；'),
                  h('p', { className: 'pm-muted' }, 'docx、xlsx、pptx 与 PDF 会内嵌预览，改文档再用「外部打开」。'))
                : sel.info.kind === 'text'
                  ? (preview
                    ? h('div', { className: 'pm-preview' }, renderMarkdown(draft))
                    : h('textarea', {
                      className: 'pm-textarea',
                      ref: editorRef,
                      value: draft,
                      spellCheck: false,
                      onChange: (event) => {
                        setDraft(event.target.value);
                        setDirty(event.target.value !== (sel.info.text || ''));
                      },
                      onKeyDown: (event) => {
                        if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S')) {
                          event.preventDefault();
                          save();
                        }
                      }
                    }))
                  : sel.info.kind === 'image'
                    ? h('div', { className: 'pm-image-wrap' },
                      h('img', {
                        className: 'pm-image',
                        alt: sel.info.name,
                        src: API + '/raw?' + new URLSearchParams({ projectId, path: sel.rel }).toString()
                      }))
                    : sel.info.kind === 'pdf'
                      ? h('div', { className: 'pm-pdf-wrap' },
                        h('iframe', {
                          className: 'pm-pdf',
                          title: sel.info.name,
                          src: API + '/raw?' + new URLSearchParams({ projectId, path: sel.rel }).toString()
                        }))
                      : sel.info.kind === 'office'
                        ? h(DocPreview, {
                          projectId,
                          rel: sel.rel,
                          info: sel.info,
                          doc,
                          onRetry: () => loadDoc(sel.rel, true),
                          onOpenExternal: () => openExternal(sel.rel)
                        })
                        : h('div', { className: 'pm-empty' },
                          h('p', { className: 'pm-empty-title' }, sel.info.name),
                          h('p', { className: 'pm-muted' }, '这类文件不支持内嵌预览，可用系统程序打开。'),
                          h('p', { className: 'pm-muted' }, fmtSize(sel.info.size) + ' · ' + fmtTime(sel.info.mtimeMs)),
                          h('button', { className: 'pm-btn is-primary', onClick: () => openExternal(sel.rel) }, '用系统程序打开'))),

            sel
              ? h('div', { className: 'pm-editor-foot' },
                h('span', null, fmtSize(sel.info.size)),
                h('span', null, fmtTime(sel.info.mtimeMs)),
                sel.info.editable
                  ? h('span', null, draft.split('\n').length + ' 行')
                  : h('span', null, '只读预览'),
                dirty ? h('span', { className: 'pm-dirty' }, autoSave ? '● 未保存（停手即自动保存）' : '● 未保存') : null)
              : null),

          /* 智能体 */
          showAgent ? h(AgentPane, {
            project,
            presets: props.presets,
            get,
            say,
            patch,
            briefBusy: busyBrief,
            onBrief: runBrief,
            onCopyLaunch: copyLaunch,
            onCopyModule: copyModule,
            onOpenLead: openLead,
            onRebind: async () => {
              if (await props.ask('解除当前会话绑定并新建一个主智能体会话？')) {
                patch({ leadSessionId: null });
                say('已解除绑定，再点「新建主智能体会话」即可');
              }
            }
          }) : null
        )
      );
    }

    /* ------------------------------ 版本模块 */

    const VERSION_KIND_LABEL = {
      manual: '手动备份',
      startup: '启动自动备份',
      rollback: '回滚记录',
      'pre-rollback': '回滚前自动备份',
      auto: '自动'
    };

    function VersionsPane(props) {
      const say = props.say;
      const [info, setInfo] = useState(null);
      const [error, setError] = useState('');
      const [busy, setBusy] = useState('');
      const [repoDraft, setRepoDraft] = useState('');

      const load = useCallback(async () => {
        try {
          const value = await call('/version');
          setInfo(value);
          setError('');
          setRepoDraft(String(value.repositoryUrl || (value.repository && value.repository.url) || ''));
        } catch (err) {
          setError('读取版本信息失败：' + msg(err));
        }
      }, []);

      useEffect(() => {
        load();
      }, [load]);

      const saveRepo = useCallback(async (nextUrl) => {
        setBusy('repo');
        try {
          const value = await post('/version/repository', { url: nextUrl === undefined ? repoDraft.trim() : nextUrl });
          setRepoDraft(value.repositoryUrl || '');
          say(value.repositoryUrl ? '仓库地址已保存，正在读提交记录' : '已清空仓库地址');
          await load();
        } catch (err) {
          say('保存仓库地址失败：' + msg(err), 'error');
        } finally {
          setBusy('');
        }
      }, [load, repoDraft, say]);

      const backup = useCallback(async () => {
        setBusy('backup');
        try {
          await post('/version/snapshot', { note: '手动备份' });
          say('已把当前版本存成一份快照');
          await load();
        } catch (err) {
          say('备份失败：' + msg(err), 'error');
        } finally {
          setBusy('');
        }
      }, [load, say]);

      const rollback = useCallback(async (entry) => {
        const ok = await props.ask('回滚到 ' + entry.id + '？\n当前插件代码会被覆盖，回滚前会自动把现在这版再备份一份。回滚后按 Ctrl+R 刷新界面生效（Host 侧改动需要重启 DSH）。');
        if (!ok) return;
        setBusy(entry.id);
        try {
          const value = await post('/version/rollback', { id: entry.id });
          say('已回滚到 ' + value.restored.version + '，按 Ctrl+R 生效');
          await load();
        } catch (err) {
          say('回滚失败：' + msg(err), 'error');
        } finally {
          setBusy('');
        }
      }, [load, props, say]);

      if (error) {
        return h('div', { className: 'pm-main', style: { flex: '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: 0 } },
          h('div', { className: 'pm-empty' },
            h('p', { className: 'pm-empty-title' }, '读不到版本信息'),
            h('p', { className: 'pm-muted' }, error),
            h('div', { className: 'pm-empty-actions' },
              h('button', { className: 'pm-btn is-primary', onClick: load }, '重试'))));
      }

      if (!info) {
        return h('div', { className: 'pm-main', style: { flex: '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: 0 } },
          h('div', { className: 'pm-empty' }, h(Spinner), h('p', { className: 'pm-muted' }, '读取版本信息…')));
      }

      const history = Array.isArray(info.history) ? info.history : [];
      const changelog = Array.isArray(info.changelog) ? info.changelog : [];
      const commits = info.commits || null;

      return h('div', {
        className: 'pm-main pm-version',
        style: { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, gap: 10 }
      },
        h('header', { className: 'pm-head' },
          h('div', { className: 'pm-head-main' },
            h('div', { className: 'pm-head-title-row' },
              h('span', { className: 'pm-title' }, '版本'),
              h('span', { className: 'pm-pill is-ok' }, 'v' + info.version)),
            h('button', {
              className: 'pm-path',
              title: '点击复制插件目录',
              onClick: async () => {
                const ok = await copyText(info.dir);
                say(ok ? '目录已复制' : '复制失败', ok ? 'ok' : 'error');
              }
            }, info.dir)),
          h('div', { className: 'pm-head-actions' },
            h('button', { className: 'pm-btn', onClick: load }, '刷新'),
            h('button', {
              className: 'pm-btn is-primary',
              onClick: backup,
              disabled: busy === 'backup',
              title: '把当前代码存成一份可回滚的快照'
            }, busy === 'backup' ? h(Spinner) : null, '备份当前版本'))),

        h('div', { className: 'pm-scroll' },
          h('section', { className: 'pm-card' },
            h('div', { className: 'pm-card-title' }, info.display + ' v' + info.version),
            h('div', { className: 'pm-kv' },
              h('span', null, '发布'), info.releasedAt || '—',
              h('span', null, '代码指纹'), info.hash || '—'),
            h('div', { className: 'pm-kv' },
              h('span', null, '数据目录'), info.dataDir || '—',
              h('span', null, '快照数'), String(history.length))),

          changelog.length
            ? h('section', { className: 'pm-card' },
              h('div', { className: 'pm-card-title' }, '变更日志'),
              changelog.map((item) => h('div', { className: 'pm-log-item', key: item.version },
                h('div', { className: 'pm-log-head' },
                  h('span', { className: cx('pm-chip', item.version === info.version ? 'is-on' : '') }, 'v' + item.version),
                  h('span', { className: 'pm-log-title' }, item.title || ''),
                  h('span', { className: 'pm-muted' }, item.at || '')),
                h('ul', { className: 'pm-log-changes' },
                  (item.changes || []).map((line, index) => h('li', { key: index }, line))))))
            : null,

          h('section', { className: 'pm-card' },
            h('div', { className: 'pm-card-head' },
              h('span', { className: 'pm-card-title' }, '提交记录'),
              commits && commits.remote
                ? h('button', {
                  className: 'pm-btn is-ghost',
                  title: '在浏览器里打开这个仓库',
                  onClick: () => post('/openlink', { url: commits.remote })
                    .catch((err) => say('打开失败：' + msg(err), 'error'))
                }, '逛仓库')
                : null),
            h('div', { className: 'pm-repo' },
              h('input', {
                className: 'pm-input',
                placeholder: 'https://github.com/你的账号/dafeiyu',
                value: repoDraft,
                onChange: (event) => setRepoDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') saveRepo();
                }
              }),
              h('button', {
                className: 'pm-btn is-primary',
                onClick: () => saveRepo(),
                disabled: busy === 'repo'
              }, busy === 'repo' ? h(Spinner) : null, '保存'),
              repoDraft
                ? h('button', {
                  className: 'pm-btn',
                  onClick: () => saveRepo(''),
                  disabled: busy === 'repo'
                }, '清除')
                : null),
            commits && commits.available
              ? h('div', { className: 'pm-history' },
                (commits.commits || []).map((item) => h('div', {
                  className: 'pm-history-row',
                  key: (item.hash || '') + (item.date || '') + (item.subject || '')
                },
                  h('div', { className: 'pm-history-main' },
                    h('div', { className: 'pm-history-title' },
                      h('span', { className: 'pm-chip is-on' }, item.hash || '——'),
                      h('span', { className: 'pm-log-title' }, item.subject || '（没有说明）')),
                    h('div', { className: 'pm-muted' },
                      (item.date || '') + (item.author ? ' · ' + item.author : ''))))))
              : h('div', { className: 'pm-hint' }, commits && commits.error ? commits.error : '还没有提交记录'),
            h('div', { className: 'pm-card-hint' },
              commits && commits.source === 'git'
                ? '来自插件目录里的本地 git 仓库' + (commits.branch ? '（分支 ' + commits.branch + '）' : '') + '，最近 20 条'
                : commits && commits.source === 'bundled'
                  ? '来自打包时带上的提交记录' + (commits.builtAt ? '（' + commits.builtAt + ' 打包）' : '')
                    + (commits.branch ? '（分支 ' + commits.branch + '）' : '')
                    + (commits.liveError ? '；联网读取没成功：' + commits.liveError : '')
                  : '在上面的输入框里填 GitHub 仓库地址，存一次就记住（存在数据目录里，重装也不丢）；也可以写在 version.json 的 repository.url 里')),

          h('section', { className: 'pm-card' },
            h('div', { className: 'pm-card-title' }, '历史快照'),
            h('div', { className: 'pm-muted' }, '每次启动、每次手动备份都会留一份；回滚会用快照里的代码覆盖当前插件目录，回滚前先自动备份当前版本。'),
            history.length
              ? h('div', { className: 'pm-history' },
                history.map((entry) => h('div', { className: 'pm-history-row', key: entry.id },
                  h('div', { className: 'pm-history-main' },
                    h('div', { className: 'pm-history-title' },
                      h('span', { className: 'pm-history-version' }, 'v' + entry.version),
                      h('span', { className: 'pm-chip' }, VERSION_KIND_LABEL[entry.kind] || entry.kind || '记录'),
                      h('span', { className: 'pm-muted' }, fmtTime(Date.parse(entry.at) || Date.now()))),
                    h('div', { className: 'pm-muted' }, entry.id + (entry.note ? ' · ' + entry.note : ''))),
                  h('div', { className: 'pm-history-actions' },
                    entry.restorable
                      ? h('button', {
                        className: 'pm-btn is-danger',
                        onClick: () => rollback(entry),
                        disabled: Boolean(busy)
                      }, busy === entry.id ? h(Spinner) : null, '回滚到这版')
                      : h('span', { className: 'pm-muted' }, entry.dir ? '旧插件版本，仅供查档' : '仅记录')))))
              : h('div', { className: 'pm-hint' }, '还没有快照，点右上角「备份当前版本」'))
        )
      );
    }

    /* ------------------------------ 根面板 */

    function Workbench(props) {
      const get = props.get;
      const [snapshot, setSnapshot] = useState(null);
      const [activeId, setActiveId] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState('');
      const [toast, setToast] = useState(null);
      const [manual, setManual] = useState(null);
      const [busy, setBusy] = useState(false);
      const [askState, setAskState] = useState(null);
      const [view, setView] = useState('project');
      const [tab, setTab] = useState('project');

      const say = useCallback((text, tone) => setToast({ text, tone: tone || 'ok', at: Date.now() }), []);

      const ask = useCallback((text) => new Promise((resolve) => {
        setAskState({ text, resolve });
      }), []);

      const answerAsk = useCallback((value) => {
        setAskState((current) => {
          if (current && typeof current.resolve === 'function') current.resolve(value);
          return null;
        });
      }, []);

      useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => setToast(null), 3600);
        return () => clearTimeout(timer);
      }, [toast]);

      const refresh = useCallback(async () => {
        try {
          const value = await call('/state');
          setSnapshot(value);
          setError('');
          setActiveId((current) => {
            if (current && (value.projects || []).some((item) => item.id === current)) return current;
            return value.projects && value.projects.length ? value.projects[0].id : null;
          });
        } catch (err) {
          setError('读取项目台账失败：' + msg(err));
        } finally {
          setLoading(false);
        }
      }, []);

      useEffect(() => {
        refresh();
      }, [refresh]);

      const onPatched = useCallback((project, stats) => {
        setSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            projects: (prev.projects || []).map((item) =>
              item.id === project.id ? { ...project, stats: stats || item.stats } : item)
          };
        });
      }, []);

      const createProject = useCallback(async (dir) => {
        const target = String(dir || '').trim();
        if (!target) return;
        setBusy(true);
        try {
          const created = await post('/project/create', { root: target });
          let project = created.project;
          try {
            let workspaceId = findWorkspace(get, project.root);
            if (!workspaceId) {
              const workspaces = svc(get, 'workspaces');
              if (workspaces) {
                const view = await workspaces.create({ path: project.root });
                workspaceId = view && (view.workspaceId || (view.workspace && view.workspace.workspaceId)) || null;
              }
            }
            if (workspaceId) {
              const updated = await post('/project/update', { id: project.id, patch: { workspaceId } });
              project = updated.project;
            }
          } catch {
            /* 已有工作区或创建失败都不阻塞添加项目 */
          }
          setSnapshot((prev) => ({
            presets: (prev && prev.presets) || [],
            projects: [{ ...project, stats: created.stats }].concat(prev ? prev.projects : [])
          }));
          setActiveId(project.id);
          setManual(null);
          say('已添加项目：' + project.name);
        } catch (err) {
          say('添加失败：' + msg(err), 'error');
        } finally {
          setBusy(false);
        }
      }, [get, say]);

      const pickAndAdd = useCallback(async () => {
        const uiWorkspace = svc(get, 'uiWorkspace');
        if (!uiWorkspace || typeof uiWorkspace.pickDirectory !== 'function') {
          setManual({ value: '' });
          say('这个版本没有目录选择服务，请手填路径', 'error');
          return;
        }
        try {
          const dir = await uiWorkspace.pickDirectory();
          if (!dir) return;
          await createProject(dir);
        } catch (err) {
          say('选择目录失败：' + msg(err), 'error');
        }
      }, [createProject, get, say]);

      const removeProject = useCallback(async (project) => {
        try {
          const value = await post('/project/delete', { id: project.id });
          setSnapshot((prev) => {
            if (!prev) return prev;
            const statsMap = new Map((prev.projects || []).map((item) => [item.id, item.stats]));
            const projects = (value.projects || []).map((item) => ({ ...item, stats: statsMap.get(item.id) || null }));
            return { ...prev, projects };
          });
          setActiveId((current) => {
            if (current !== project.id) return current;
            const left = ((snapshot && snapshot.projects) || []).filter((item) => item.id !== project.id);
            return left.length ? left[0].id : null;
          });
          say('已移除项目：' + project.name);
        } catch (err) {
          say('移除失败：' + msg(err), 'error');
        }
      }, [say, snapshot]);

      const projects = (snapshot && snapshot.projects) || [];
      const presets = (snapshot && snapshot.presets) || [];
      const active = projects.find((item) => item.id === activeId) || null;

      return h(
        'div',
        {
          className: 'pm-root',
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 10,
            position: 'relative',
            width: '100%',
            height: '100%',
            minWidth: 0,
            minHeight: 0,
            boxSizing: 'border-box',
            padding: 'calc(var(--dsh-frame-top-clearance, 0px) + 6px) 12px 10px',
            background: 'var(--dsw-alias-bg-base)',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: 13
          }
        },
        h('style', null, CSS),

        h('nav', { className: 'pm-tabs' },
          [
            { id: 'project', label: '项目', hint: '项目、文件与智能体' },
            { id: 'versions', label: '版本', hint: '变更日志与一键回滚' }
          ].map((item) => h('button', {
            key: item.id,
            className: cx('pm-tab', tab === item.id ? 'is-active' : ''),
            title: item.hint,
            onClick: () => setTab(item.id)
          }, item.label))),

        tab === 'versions'
          ? h(VersionsPane, { say, ask })
          : h('div', { className: 'pm-workspace' },

        h('aside', {
          className: 'pm-rail',
          style: { flex: '0 0 216px', width: 216, maxWidth: 216, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden' }
        },
          h('div', { className: 'pm-rail-head' },
            h('span', { className: 'pm-rail-title' }, '项目'),
            h('span', { className: 'pm-rail-head-right' },
              h('span', { className: 'pm-rail-count' }, projects.length ? String(projects.length) : ''),
              h('button', {
                className: 'pm-btn is-ghost pm-icon-btn',
                onClick: refresh,
                title: '重新读取项目列表'
              }, '刷新'))),
          h('div', { className: 'pm-rail-pin' },
            h('button', {
              className: cx('pm-proj pm-proj-pin', view === 'overview' ? 'is-active' : ''),
              onClick: () => setView('overview'),
              title: '所有项目的汇总、检索与周报'
            },
              h('span', { className: 'pm-proj-name' }, '总览'),
              h('span', { className: 'pm-proj-foot' },
                h('span', { className: 'pm-proj-count' },
                  projects.length ? projects.length + ' 个项目' : '还没有项目')))),
          h('div', { className: 'pm-rail-list' },
            projects.map((project) =>
              h('button', {
                key: project.id,
                className: cx('pm-proj', project.id === activeId && view === 'project' ? 'is-active' : ''),
                onClick: () => {
                  setActiveId(project.id);
                  setView('project');
                },
                title: project.root
              },
                h('span', { className: 'pm-proj-name' }, project.name),
                h('span', { className: 'pm-proj-foot' },
                  h('span', { className: 'pm-proj-count' },
                    (project.stats ? (project.stats.files || 0) : 0) + ' 文件'),
                  project.stats && project.stats.exists === false
                    ? h('span', { className: 'pm-proj-warn' }, '目录缺失')
                    : null))),
            loading && !projects.length ? h('div', { className: 'pm-hint' }, '载入中…') : null,
            !loading && !projects.length
              ? h('div', { className: 'pm-empty-small' },
                h('p', null, '还没有项目'),
                h('p', { className: 'pm-muted' }, '点下面的按钮选一个本地文件夹'))
              : null),
          manual
            ? h('div', { className: 'pm-manual' },
              h('input', {
                className: 'pm-input',
                value: manual.value,
                placeholder: 'D:\\项目\\某某项目',
                autoFocus: true,
                onChange: (event) => setManual({ value: event.target.value }),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') createProject(manual.value);
                  if (event.key === 'Escape') setManual(null);
                }
              }),
              h('div', { className: 'pm-actions' },
                h('button', { className: 'pm-btn is-primary', onClick: () => createProject(manual.value), disabled: busy }, '添加'),
                h('button', { className: 'pm-btn is-ghost', onClick: () => setManual(null) }, '取消')))
            : null,
          h('div', { className: 'pm-rail-foot' },
            h('button', { className: 'pm-btn is-primary pm-block', onClick: pickAndAdd, disabled: busy },
              busy ? h(Spinner) : null, '＋ 添加项目'),
            h('button', {
              className: 'pm-btn is-ghost pm-block',
              onClick: () => setManual({ value: '' })
            }, '手填路径'))),

        view === 'overview'
          ? h(OverviewPane, {
            projects,
            presets,
            say,
            onOpenProject: (id) => {
              setActiveId(id);
              setView('project');
            }
          })
          : active
          ? h(ProjectWindow, {
            key: active.id,
            project: active,
            presets,
            get,
            say,
            ask,
            onPatched,
            onDelete: removeProject
          })
          : h('section', {
            className: 'pm-main pm-main-empty',
            style: { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, gap: 10 }
          },
            error
              ? h('div', { className: 'pm-empty' },
                h('p', { className: 'pm-empty-title' }, '读取失败'),
                h('p', { className: 'pm-muted' }, error))
              : h('div', { className: 'pm-empty' },
                h('p', { className: 'pm-empty-title' }, '大肥鱼'),
                h('p', { className: 'pm-muted' }, '左侧添加一个项目目录：'),
                h('p', { className: 'pm-muted' }, '· 文件树直接浏览本地文件夹，文本文件就地编辑'),
                h('p', { className: 'pm-muted' }, '· Office / PDF 一键用系统程序打开'),
                h('p', { className: 'pm-muted' }, '· 每个项目一个主智能体，按模块派子智能体')))),

        h(Toast, { toast, onClose: () => setToast(null) }),

        askState
          ? h('div', { className: 'pm-modal' },
            h('div', { className: 'pm-modal-card' },
              h('p', { className: 'pm-modal-text' }, askState.text),
              h('div', { className: 'pm-modal-actions' },
                h('button', { className: 'pm-btn is-ghost', onClick: () => answerAsk(false) }, '取消'),
                h('button', { className: 'pm-btn is-primary', onClick: () => answerAsk(true) }, '确定'))))
          : null
      );
    }

    /* ------------------------------------------------------------ 样式 */

    const CSS = [
      '.pm-root{display:grid;grid-template-columns:216px minmax(0,1fr);height:100%;min-height:0;box-sizing:border-box;padding:calc(var(--dsh-frame-top-clearance,0px) + 6px) 12px 10px;gap:10px;color:var(--dsw-alias-label-primary);font-size:13px;background:var(--dsw-alias-bg-base);}',
      '.pm-icon{display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;color:var(--dsw-specific-sidebar-fill,currentColor);}',
      '.pm-rail{display:flex;flex-direction:column;min-height:0;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);overflow:hidden;}',
      '.pm-rail-head{display:flex;align-items:center;justify-content:space-between;padding:9px 11px;border-bottom:1px solid var(--dsw-alias-border-l1);font-weight:600;font-size:12px;color:var(--dsw-alias-label-secondary);letter-spacing:.02em;}',
      '.pm-rail-count{font-weight:400;color:var(--dsw-alias-label-caption);}',
      '.pm-rail-list{flex:1;min-height:0;overflow:auto;padding:6px;}',
      '.pm-proj{display:flex;flex-direction:column;gap:3px;width:100%;padding:7px 8px;margin-bottom:2px;border:1px solid transparent;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;}',
      '.pm-proj:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.pm-proj.is-active{background:var(--dsw-alias-bg-overlay);border-color:var(--dsw-alias-border-l2);}',
      '.pm-proj-name{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pm-proj-foot{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-proj-warn{color:var(--dsw-alias-state-warn-primary);}',
      '.pm-rail-foot{padding:8px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:6px;}',
      '.pm-rail-foot-row{display:flex;gap:6px;justify-content:space-between;}',
      '.pm-rail-head-right{display:flex;align-items:center;gap:6px;}',
      '.pm-icon-btn{padding:2px 8px;font-size:11px;line-height:1.5;border-radius:var(--dsw-radius-sm);}',
      '.pm-manual{padding:8px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:6px;}',
      '.pm-main{display:flex;flex-direction:column;min-width:0;min-height:0;gap:10px;}',
      '.pm-rail,.pm-head,.pm-notes,.pm-pane,.pm-main-empty{backdrop-filter:blur(18px) saturate(1.06);-webkit-backdrop-filter:blur(18px) saturate(1.06);}',
      '.pm-main-empty{justify-content:center;align-items:center;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);}',
      '.pm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);}',
      '.pm-head-main{display:flex;flex-direction:column;gap:4px;min-width:0;}',
      '.pm-head-title-row{display:flex;align-items:center;gap:8px;min-width:0;}',
      '.pm-title{padding:0;border:none;background:transparent;color:inherit;font:inherit;font-size:15px;font-weight:600;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:420px;}',
      '.pm-title:hover{text-decoration:underline dotted;}',
      '.pm-path{padding:0;border:none;background:transparent;color:var(--dsw-alias-label-caption);font:inherit;font-size:11px;cursor:pointer;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}',
      '.pm-path:hover{color:var(--dsw-alias-label-secondary);}',
      '.pm-head-stats{display:flex;gap:10px;font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-head-actions{display:flex;gap:6px;flex:none;}',
      '.pm-pill{padding:1px 7px;border-radius:999px;font-size:11px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-caption);white-space:nowrap;}',
      '.pm-pill.is-ok{color:var(--dsw-alias-state-success-primary);border-color:rgba(90,168,122,.45);}',
      '.pm-pill.is-idle{color:var(--dsw-alias-label-caption);}',
      '.pm-pill.is-warn{color:var(--dsw-alias-state-warn-primary);border-color:rgba(217,139,95,.45);}',
      '.pm-notes{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);}',
      '.pm-body{display:grid;grid-template-columns:minmax(170px,244px) minmax(0,1fr) minmax(286px,356px);gap:10px;flex:1;min-height:0;}',
      '.pm-body.no-files{grid-template-columns:minmax(0,1fr) minmax(286px,356px);}',
      '.pm-body.no-agent{grid-template-columns:minmax(170px,244px) minmax(0,1fr);}',
      '.pm-body.no-files.no-agent{grid-template-columns:minmax(0,1fr);}',
      '.pm-body.no-files.no-agent .pm-editor-body{max-width:none;}',
      '.pm-pane{display:flex;flex-direction:column;min-width:0;min-height:0;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);overflow:hidden;}',
      '.pm-pane-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);min-height:34px;box-sizing:border-box;}',
      '.pm-pane-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pm-pane-sub{font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-pane-tools{display:flex;gap:4px;flex:none;}',
      '.pm-pane-body{flex:1;min-height:0;overflow:auto;padding:6px;}',
      '.pm-pane-foot{padding:4px 10px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-caption);min-height:20px;box-sizing:border-box;}',
      '.pm-tree{display:flex;flex-direction:column;gap:1px;}',
      '.pm-tree-row{display:flex;align-items:center;gap:6px;width:100%;height:24px;padding:0 6px;border:1px solid transparent;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer;}',
      '.pm-tree-row:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.pm-tree-row.is-active{background:var(--dsw-alias-bg-overlay);border-color:var(--dsw-alias-border-l2);}',
      '.pm-caret{width:10px;flex:none;font-size:9px;color:var(--dsw-alias-label-caption);}',
      '.pm-badge{flex:none;min-width:26px;text-align:center;font-size:9px;letter-spacing:.02em;padding:1px 3px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-caption);}',
      '.pm-badge.t-doc{color:var(--dsw-alias-state-business-primary);}',
      '.pm-badge.t-xls{color:var(--dsw-alias-state-success-primary);}',
      '.pm-badge.t-ppt{color:var(--dsw-alias-state-warn-primary);}',
      '.pm-badge.t-pdf{color:var(--dsw-alias-state-error-primary);}',
      '.pm-badge.t-img{color:#a884d8;}',
      '.pm-tree-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pm-textarea{flex:1;width:100%;min-height:100%;box-sizing:border-box;resize:none;border:none;outline:none;background:transparent;color:inherit;font-family:ui-monospace,SFMono-Regular,Consolas,"Cascadia Code",Menlo,monospace;font-size:12px;line-height:1.62;padding:10px 12px;tab-size:2;}',
      '.pm-dirty{color:var(--dsw-alias-state-warn-primary);}',
      '.pm-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:20px;text-align:center;}',
      '.pm-empty-title{font-size:13px;font-weight:600;margin:0;}',
      '.pm-modal{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.34);z-index:60;border-radius:var(--dsw-radius-sm);}',
      '.pm-modal-card{min-width:290px;max-width:min(430px,86%);padding:16px 16px 12px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-shadow-lv3);}',
      '.pm-modal-text{margin:0 0 14px;font-size:13px;line-height:1.55;color:var(--dsw-alias-label-primary);}',
      '.pm-modal-actions{display:flex;justify-content:flex-end;gap:8px;}',
      '.pm-empty-small{padding:10px;font-size:12px;color:var(--dsw-alias-label-secondary);text-align:center;}',
      '.pm-muted{color:var(--dsw-alias-label-caption);font-size:11px;margin:0;}',
      '.pm-image-wrap{flex:1;display:flex;align-items:center;justify-content:center;padding:12px;overflow:auto;background:var(--dsw-alias-bg-base);}',
      '.pm-image{max-width:100%;max-height:100%;object-fit:contain;border-radius:var(--dsw-radius-sm);}',
      '.pm-pdf-wrap{flex:1;display:flex;min-height:0;background:var(--dsw-alias-bg-base);}',
      '.pm-pdf{flex:1;border:none;width:100%;height:100%;}',
      '.pm-doc{flex:1;display:flex;flex-direction:column;min-height:0;}',
      '.pm-doc-scroll{flex:1;overflow:auto;padding:14px 16px 6px;display:flex;flex-direction:column;align-items:center;gap:14px;}',
      '.pm-page-wrap{margin:0;display:flex;flex-direction:column;align-items:center;gap:5px;max-width:100%;}',
      '.pm-page{max-width:100%;height:auto;display:block;border-radius:5px;background:#fff;box-shadow:var(--dsw-shadow-lv3);}',
      '.pm-page-cap{font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-doc-foot{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;padding:4px 12px 6px;}',
      '.pm-doc-note{font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-doc-loading{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:20px;text-align:center;}',
      '.pm-doc-loading-text{display:flex;flex-direction:column;gap:3px;align-items:center;}',
      '.pm-empty-actions{display:flex;gap:6px;margin-top:4px;}',
      '.pm-preview{flex:1;padding:12px 16px;overflow:auto;line-height:1.7;font-size:13px;}',
      '.pm-md-h{margin:14px 0 6px;line-height:1.35;}',
      '.pm-md-h:first-child{margin-top:0;}',
      '.pm-md-p{margin:7px 0;}',
      '.pm-md-list{margin:6px 0 6px 18px;padding:0;}',
      '.pm-md-list li{margin:2px 0;}',
      '.pm-quote{margin:8px 0;padding:2px 10px;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);}',
      '.pm-pre{margin:8px 0;padding:9px 11px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);overflow:auto;font-size:12px;line-height:1.55;}',
      '.pm-code{padding:1px 4px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);font-family:ui-monospace,Consolas,monospace;font-size:11px;}',
      '.pm-table{border-collapse:collapse;margin:8px 0;font-size:12px;}',
      '.pm-table th,.pm-table td{border:1px solid var(--dsw-alias-border-l1);padding:4px 8px;text-align:left;}',
      '.pm-table th{background:var(--dsw-alias-bg-layer-2);font-weight:600;}',
      '.pm-agent-body{display:flex;flex-direction:column;gap:8px;padding:8px;}',
      '.pm-card{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);padding:9px 10px;display:flex;flex-direction:column;gap:6px;}',
      '.pm-card-grow{flex:1;min-height:0;overflow:auto;}',
      '.pm-card-head{display:flex;align-items:center;justify-content:space-between;gap:6px;}',
      '.pm-card-title{font-size:12px;font-weight:600;}',
      '.pm-card-note{margin:0;font-size:11px;color:var(--dsw-alias-label-caption);line-height:1.5;}',
      '.pm-card-hint{margin:0;font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-repo{display:flex;align-items:center;gap:6px;margin:6px 0 2px;}',
      '.pm-repo .pm-input{flex:1 1 auto;min-width:0;font-size:11px;}',
      '.pm-actions{display:flex;flex-wrap:wrap;gap:5px;}',
      '.pm-block{width:100%;justify-content:center;}',
      '.pm-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:26px;padding:0 9px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap;}',
      '.pm-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);}',
      '.pm-btn:disabled{opacity:.45;cursor:not-allowed;}',
      '.pm-btn.is-primary{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}',
      '.pm-btn.is-primary:hover{background:var(--dsw-alias-bg-overlay);}',
      '.pm-btn:disabled{opacity:.5;cursor:default;}',
      '.pm-btn.is-ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary);}',
      '.pm-btn.is-ghost:hover:not(:disabled){background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);}',
      '.pm-btn.is-danger{color:var(--dsw-alias-state-error-primary);}',
      '.pm-chip{padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;}',
      '.pm-chip:hover{background:var(--dsw-alias-bg-overlay);}',
      '.pm-form{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);}',
      '.pm-form-row{display:flex;flex-direction:column;gap:3px;}',
      '.pm-label{font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:5px 7px;font:inherit;font-size:12px;}',
      '.pm-input:focus{outline:none;border-color:var(--dsw-alias-border-l2);}',
      '.pm-input-multi{resize:vertical;line-height:1.5;font-family:inherit;}',
      '.pm-input-title{font-size:14px;font-weight:600;max-width:360px;}',
      '.pm-presets{display:flex;flex-wrap:wrap;gap:4px;align-items:center;}',
      '.pm-mod-list{display:flex;flex-direction:column;gap:6px;}',
      '.pm-mod{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);padding:7px 8px;display:flex;flex-direction:column;gap:3px;background:var(--dsw-alias-bg-layer-1);}',
      '.pm-mod.is-off{opacity:.55;}',
      '.pm-mod-head{display:flex;align-items:center;justify-content:space-between;gap:6px;}',
      '.pm-mod-name{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pm-mod-role{margin:0;font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
      '.pm-mod-meta{margin:0;font-size:11px;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pm-mod-actions{display:flex;gap:2px;margin-top:1px;}',
      '.pm-switch{width:26px;height:15px;flex:none;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);padding:1px;cursor:pointer;display:inline-flex;align-items:center;}',
      '.pm-switch.is-on{background:var(--dsw-alias-brand-primary);border-color:transparent;justify-content:flex-end;}',
      '.pm-switch-dot{width:11px;height:11px;border-radius:50%;background:var(--dsw-alias-label-caption);}',
      '.pm-switch.is-on .pm-switch-dot{background:#fff;}',
      '.pm-hint{padding:8px 10px;font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-hint.is-error{color:var(--dsw-alias-state-error-primary);}',
      '.pm-toast{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);max-width:70%;padding:7px 14px;border-radius:var(--dsw-radius-sm);font-size:12px;cursor:pointer;z-index:20;box-shadow:var(--dsw-shadow-lv2);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);}',
      '.pm-toast.is-error{color:var(--dsw-alias-state-error-primary);}',
      '.pm-rail-pin{padding:6px 6px 0;}',
      '.pm-proj-pin{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);}',
      '.pm-agent-body{display:flex;flex-direction:column;gap:8px;padding:8px;overflow:hidden;}',
      '.pm-chat-slot{flex:0 0 auto;height:48%;min-height:215px;display:flex;min-height:0;}',
      '.pm-chat{flex:1;display:flex;flex-direction:column;min-height:0;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);overflow:hidden;}',
      '.pm-chat-head{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);min-height:32px;box-sizing:border-box;}',
      '.pm-chat-title{font-size:12px;font-weight:600;flex:none;}',
      '.pm-chat-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-label-caption);}',
      '.pm-chat-dot.is-idle{background:var(--dsw-alias-state-success-primary);}',
      '.pm-chat-dot.is-busy{background:var(--dsw-alias-state-warn-primary);animation:pm-pulse 1.1s ease-in-out infinite;}',
      '.pm-chat-status{flex:1;font-size:11px;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '@keyframes pm-pulse{0%,100%{opacity:.35;}50%{opacity:1;}}',
      '.pm-chat-box{flex:1;min-height:0;overflow:auto;padding:8px;display:flex;flex-direction:column;gap:7px;}',
      '.pm-chat-hint{font-size:11px;color:var(--dsw-alias-label-caption);line-height:1.55;}',
      '.pm-chat-hint.is-error{color:var(--dsw-alias-state-error-primary);}',
      '.pm-msg{display:flex;flex-direction:column;gap:2px;max-width:100%;}',
      '.pm-msg-role{font-size:10px;color:var(--dsw-alias-label-caption);}',
      '.pm-msg-text{font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;padding:6px 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);}',
      '.pm-msg.is-user{align-items:flex-end;}',
      '.pm-msg.is-user .pm-msg-text{background:var(--dsw-alias-bg-overlay);border-color:var(--dsw-alias-border-l2);}',
      '.pm-chat-composer{display:flex;flex-direction:column;gap:5px;padding:7px 8px;border-top:1px solid var(--dsw-alias-border-l1);}',
      '.pm-chat-input{width:100%;box-sizing:border-box;resize:none;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:6px 8px;font:inherit;font-size:12px;line-height:1.5;}',
      '.pm-chat-input:focus{outline:none;border-color:var(--dsw-alias-border-l2);}',
      '.pm-chat-actions{display:flex;align-items:center;gap:6px;justify-content:space-between;}',
      '.pm-chat-links{display:flex;gap:2px;flex-wrap:wrap;justify-content:flex-end;}',
      '.pm-ov{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;min-height:0;gap:10px;min-height:0;}',
      '.pm-ov-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);}',
      '.pm-ov-title{font-size:15px;font-weight:600;}',
      '.pm-ov-stats{display:flex;align-items:center;gap:10px;font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-ov-stat b{color:var(--dsw-alias-label-primary);font-size:14px;margin-right:2px;}',
      '.pm-ov-body{flex:1;min-height:0;display:flex;gap:10px;}',
      '.pm-ov-main{flex:1;min-width:0;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;}',
      '.pm-ov-section{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);padding:10px 12px;display:flex;flex-direction:column;gap:8px;}',
      '.pm-ov-sec-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);}',
      '.pm-ov-sec-actions{display:flex;align-items:center;gap:4px;}',
      '.pm-ov-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;}',
      '.pm-ov-card{display:flex;flex-direction:column;gap:4px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;text-align:left;cursor:pointer;}',
      '.pm-ov-card:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);}',
      '.pm-ov-card-top{display:flex;align-items:center;justify-content:space-between;gap:6px;}',
      '.pm-ov-card-name{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pm-ov-card-path{font-size:11px;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pm-ov-card-row{display:flex;flex-wrap:wrap;gap:8px;font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-ov-card-files{display:flex;flex-wrap:wrap;gap:4px;}',
      '.pm-ov-file{font-size:10px;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);}',
      '.pm-ov-search{display:flex;gap:6px;}',
      '.pm-ov-hits{display:flex;flex-direction:column;gap:5px;max-height:260px;overflow:auto;}',
      '.pm-ov-hit{display:flex;flex-wrap:wrap;gap:6px;padding:5px 7px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);font-size:11px;}',
      '.pm-ov-hit-proj{color:var(--dsw-alias-brand-primary);}',
      '.pm-ov-hit-rel{color:var(--dsw-alias-label-secondary);}',
      '.pm-ov-hit-kind{color:var(--dsw-alias-label-caption);}',
      '.pm-ov-hit-text{flex-basis:100%;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pm-ov-report{display:flex;flex-direction:column;gap:6px;}',
      '.pm-ov-report-body{margin:0;max-height:320px;overflow:auto;padding:9px 11px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.6;white-space:pre-wrap;}',
      '.pm-ov-report-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}',
      '.pm-ov-chat{flex:0 0 340px;min-width:0;display:flex;}',
      '.pm-ov-note{font-size:11px;color:var(--dsw-alias-state-error-primary);}',
      '.pm-chip.is-on{background:var(--dsw-alias-bg-overlay);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);}',
      '.pm-tabs{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;align-self:flex-start;padding:3px;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv1);}',
      '.pm-tab{padding:5px 16px;border-radius:var(--dsw-radius-sm);border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;transition:background .12s ease,color .12s ease;}',
      '.pm-tab:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.pm-tab.is-active{background:var(--dsw-alias-bg-overlay);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:var(--dsw-shadow-lv1);}',
      '.pm-workspace{display:flex;align-items:stretch;gap:10px;flex:1;min-height:0;min-width:0;}',
      '.pm-scroll{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding-right:2px;}',
      '.pm-kv{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-kv span{display:inline-flex;gap:4px;min-width:0;overflow:hidden;text-overflow:ellipsis;}',
      '.pm-dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-border-l2);}',
      '.pm-dot.is-ok{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 3px rgba(90,168,122,.16);}',
      '.pm-dot.is-down{background:var(--dsw-alias-state-error-primary);box-shadow:0 0 0 3px rgba(217,122,122,.16);}',
      '.pm-dot.is-idle{background:var(--dsw-alias-label-caption);opacity:.45;}',
      '.pm-form-grid{display:grid;grid-template-columns:56px minmax(0,1fr) 56px minmax(0,1fr);gap:6px 8px;align-items:center;}',
      '.pm-form-grid label{font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-log-item{display:flex;flex-direction:column;gap:4px;padding:7px 9px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);}',
      '.pm-log-head{display:flex;align-items:center;gap:8px;font-size:12px;}',
      '.pm-log-title{font-weight:600;}',
      '.pm-log-changes{margin:0;padding-left:16px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary);}',
      '.pm-history{display:flex;flex-direction:column;gap:5px;max-height:340px;overflow:auto;}',
      '.pm-history-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);}',
      '.pm-history-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;}',
      '.pm-history-title{display:flex;align-items:center;gap:7px;font-size:12px;}',
      '.pm-history-version{font-weight:600;}',
      '.pm-history-actions{display:flex;gap:4px;flex:0 0 auto;}',
      '.pm-spinner{width:10px;height:10px;border-radius:50%;border:1.5px solid currentColor;border-top-color:transparent;display:inline-block;animation:pm-spin .8s linear infinite;}',
      '.pm-btn.is-sm{height:22px;padding:0 7px;font-size:11px;border-radius:var(--dsw-radius-sm);}',
      '.pm-root :focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;}',
      'html[data-input-modality="pointer"] .pm-root :focus-visible:not(:read-write){outline-color:transparent;}',
      '.pm-scroll::-webkit-scrollbar,.pm-pane-body::-webkit-scrollbar,.pm-history::-webkit-scrollbar{width:5px;height:5px;}',
      '.pm-scroll::-webkit-scrollbar-thumb,.pm-pane-body::-webkit-scrollbar-thumb,.pm-history::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l1);border-radius:999px;}',
      '.pm-scroll::-webkit-scrollbar-thumb:hover,.pm-pane-body::-webkit-scrollbar-thumb:hover,.pm-history::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l1);}',
      '.pm-scroll::-webkit-scrollbar-track,.pm-pane-body::-webkit-scrollbar-track,.pm-history::-webkit-scrollbar-track{background:transparent;}',
      '.pm-btn,.pm-tab,.pm-chip,.pm-tree-row{transition:background-color 120ms ease,color 120ms ease,border-color 120ms ease;}',
      '.pm-btn:disabled{opacity:.45;cursor:not-allowed;}',
      '.pm-empty{border:1.5px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:transparent;}',
      '.pm-input:focus-visible{border-color:var(--dsw-alias-state-business-primary);}',
      '.pm-card{background:var(--dsw-alias-bg-layer-3);}',
      '@keyframes pm-spin{to{transform:rotate(360deg);}}',
      '.pm-composer-bar{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;padding:5px 8px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);}',
      '.pm-composer-left,.pm-composer-right{display:flex;align-items:center;gap:4px;min-width:0;}',
      '.pm-chip-btn{height:24px;padding:0 8px;font-size:11px;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-secondary);max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pm-chip-btn.is-primary{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);}',
      '.pm-picker{position:absolute;left:8px;right:8px;bottom:100%;margin-bottom:4px;max-height:260px;overflow:auto;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);box-shadow:var(--dsw-elevation-panel);padding:4px;z-index:40;}',
      '.pm-picker.is-menu{left:auto;right:8px;min-width:220px;}',
      '.pm-picker-title{padding:4px 6px;font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-picker-empty{padding:6px;font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-picker-item{display:flex;align-items:baseline;gap:8px;width:100%;padding:5px 7px;border:0;background:transparent;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-primary);font-size:12px;text-align:left;cursor:pointer;}',
      '.pm-picker-item.is-active,.pm-picker-item:hover{background:var(--dsw-alias-bg-layer-3);}',
      '.pm-picker-name{flex:0 0 auto;max-width:52%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pm-picker-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-chat-notice{margin:2px 0 6px;padding:5px 8px;font-size:11.5px;line-height:1.5;border-left:2px solid var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-layer-2);border-radius:0 var(--dsw-radius-sm) var(--dsw-radius-sm) 0;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;}',
      '.pm-chat-composer{position:relative;}',
    ].join('\n');

    /* ------------------------------------------------------------ 注册 */

    return {
      inject: ['slots'],
      apply(ctx) {
        const get = (name) => {
          try {
            return ctx.get(name) || null;
          } catch {
            return null;
          }
        };
        let workspaceNav = null;
        try {
          workspaceNav = ctx.get('uiWorkspace') || null;
        } catch {
          workspaceNav = null;
        }
        const Entry = (props) => h(Workbench, { ...props, get, workspaceNav });
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, Entry));
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 5,
            label: () => '大肥鱼'
          }, PanelIcon));
      }
    };
  }
});
