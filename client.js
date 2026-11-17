/**
 * 大肥鱼 3.0 · 场景化工作台（Web 客户端）
 *
 * 顶部场景标签栏 + 网格面板：harness（常驻 AI）/ file（文件树）/ view（预览编辑）
 * / web（内嵌网页）/ note（定位卡·场景记忆）/ reserved（预留位）。
 * 所有能力都由 Host 的 /dafeiyu/api 提供，这里只负责渲染与交互。
 */
window.__ModuleLoader__.load({
  id: '@local/dafeiyu',
  factory(require) {
    const React = require('react');
    const { useState, useEffect, useCallback, useRef } = React;
    const h = React.createElement;

    const API = '/dafeiyu/api';
    const PANEL_ID = 'dafeiyu';

    /* ------------------------------------------------------------------ 基础 */

    function cx(...args) {
      return args.filter(Boolean).join(' ');
    }

    function msg(error) {
      if (!error) return '出错了';
      if (typeof error === 'string') return error;
      return String(error.message || error.code || error);
    }

    function fmtTime(ms) {
      if (!ms) return '';
      const date = new Date(Number(ms));
      if (Number.isNaN(date.getTime())) return '';
      const today = new Date();
      const sameDay = date.toDateString() === today.toDateString();
      return sameDay
        ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
        : `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    async function call(pathname, options) {
      const init = options ? { ...options } : {};
      init.headers = { ...(init.headers || {}) };
      if (init.body && typeof init.body !== 'string') {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(init.body);
      }
      const response = await fetch(API + pathname, init);
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok || (payload && payload.ok === false)) {
        const detail = payload && payload.error ? payload.error : null;
        const error = new Error((detail && detail.message) || `请求失败（HTTP ${response.status}）`);
        error.code = detail && detail.code;
        error.status = response.status;
        throw error;
      }
      return payload ? payload.value : null;
    }

    const get = (pathname) => call(pathname);
    const post = (pathname, body) => call(pathname, { method: 'POST', body: body || {} });

    function readPref(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
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
        window.localStorage.setItem(key, typeof value === 'boolean' ? (value ? 'on' : 'off') : JSON.stringify(value));
      } catch {
        /* 忽略 */
      }
    }

    function kindLabel(kind) {
      return { text: '文档', image: '图片', pdf: 'PDF', office: 'Office', dir: '文件夹', unknown: '文件' }[kind] || '文件';
    }

    function fmtSize(bytes) {
      const size = Number(bytes) || 0;
      if (size < 1024) return `${size} B`;
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
      return `${(size / 1024 / 1024).toFixed(1)} MB`;
    }

    function renderInline(text, keyPrefix) {
      const nodes = [];
      const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
      let last = 0;
      let match = null;
      let index = 0;
      while ((match = pattern.exec(text))) {
        if (match.index > last) nodes.push(text.slice(last, match.index));
        const token = match[0];
        if (token.startsWith('`')) nodes.push(h('code', { key: `${keyPrefix}-c${index}` }, token.slice(1, -1)));
        else if (token.startsWith('**')) nodes.push(h('strong', { key: `${keyPrefix}-b${index}` }, token.slice(2, -2)));
        else {
          const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
          nodes.push(h('a', { key: `${keyPrefix}-a${index}`, href: link[2], target: '_blank', rel: 'noreferrer' }, link[1]));
        }
        last = match.index + token.length;
        index += 1;
      }
      if (last < text.length) nodes.push(text.slice(last));
      return nodes;
    }

    /** 极简 Markdown（标题 / 列表 / 引用 / 代码块 / 表格不处理） */
    function renderMarkdown(source) {
      const lines = String(source || '').split(/\r?\n/);
      const blocks = [];
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        if (/^```/.test(line)) {
          const code = [];
          i += 1;
          while (i < lines.length && !/^```/.test(lines[i])) {
            code.push(lines[i]);
            i += 1;
          }
          i += 1;
          blocks.push(h('pre', { key: `pre${blocks.length}`, className: 'pm-md-pre' }, h('code', null, code.join('\n'))));
          continue;
        }
        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        if (heading) {
          const level = Math.min(6, heading[1].length + 1);
          blocks.push(h(`h${level}`, { key: `h${blocks.length}` }, renderInline(heading[2], `h${blocks.length}`)));
          i += 1;
          continue;
        }
        if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
          const items = [];
          while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
            items.push(h('li', { key: `li${i}` }, renderInline(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''), `li${i}`)));
            i += 1;
          }
          blocks.push(h('ul', { key: `ul${blocks.length}`, className: 'pm-md-ul' }, items));
          continue;
        }
        if (/^>\s?/.test(line)) {
          const quote = [];
          while (i < lines.length && /^>\s?/.test(lines[i])) {
            quote.push(lines[i].replace(/^>\s?/, ''));
            i += 1;
          }
          blocks.push(h('blockquote', { key: `q${blocks.length}`, className: 'pm-md-quote' }, renderInline(quote.join(' '), `q${blocks.length}`)));
          continue;
        }
        if (!line.trim()) {
          i += 1;
          continue;
        }
        const para = [];
        while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([-*+]|\d+\.)\s)/.test(lines[i])) {
          para.push(lines[i]);
          i += 1;
        }
        blocks.push(h('p', { key: `p${blocks.length}`, className: 'pm-md-p' }, renderInline(para.join(' '), `p${blocks.length}`)));
      }
      return h('div', { className: 'pm-md' }, blocks);
    }

    /* ------------------------------------------------------------ 小部件 */

    function Spinner(props) {
      return h('span', { className: cx('pm-spinner', props && props.large && 'is-large'), 'aria-label': '加载中' });
    }

    function Empty(props) {
      return h('div', { className: 'pm-empty' },
        h('div', { className: 'pm-empty-title' }, props.title || '还没有内容'),
        props.hint ? h('div', { className: 'pm-empty-hint' }, props.hint) : null,
        props.children || null);
    }

    function Toast(props) {
      if (!props.toast) return null;
      return h('div', { className: cx('pm-toast', `is-${props.toast.kind || 'ok'}`) }, props.toast.text);
    }

    /* --------------------------------------------------------- AI 面板里的小件 */

    function MentionList(props) {
      const items = props.items || [];
      if (!items.length) return null;
      return h('div', { className: 'pm-picker' },
        h('div', { className: 'pm-picker-title' }, '引用文件'),
        h('div', { className: 'pm-picker-list' }, items.map((item, index) => h('button', {
          key: item.path,
          type: 'button',
          className: cx('pm-picker-item', index === props.index && 'is-active'),
          onMouseEnter: () => props.onHover(index),
          onClick: () => props.onPick(item)
        },
          h('span', { className: 'pm-picker-name' }, item.path.split('/').pop()),
          h('span', { className: 'pm-picker-path' }, item.path)))));
    }

    function ChatFeed(props) {
      const feedRef = useRef(null);
      useEffect(() => {
        if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
      }, [props.items.length, props.running]);
      if (!props.items.length) {
        return h('div', { className: 'pm-chat-empty' },
          props.bound ? '还没有消息，下面输入框说一句就开始' : '还没绑定会话：右上角选一个，或点「新建会话」');
      }
      return h('div', { className: 'pm-chat-feed', ref: feedRef },
        props.items.map((item, index) => h('div', { key: index, className: cx('pm-bubble', `is-${item.role}`) },
          h('div', { className: 'pm-bubble-role' }, item.role === 'user' ? '我' : 'AI', h('span', { className: 'pm-bubble-time' }, fmtTime(item.time))),
          h('div', { className: 'pm-bubble-body' }, renderMarkdown(item.text)))),
        props.running ? h('div', { className: 'pm-chat-running' }, h(Spinner, null), 'AI 正在回…') : null);
    }

    /* -------------------------------------------------------------- 会话主件 */

    function HarnessPanel(props) {
      const { scene, panel, say, sessionState } = props;
      const [items, setItems] = useState([]);
      const [running, setRunning] = useState(false);
      const [bound, setBound] = useState(Boolean(sessionState && sessionState.sessionId));
      const [sessions, setSessions] = useState([]);
      const [picker, setPicker] = useState('');
      const [pickIndex, setPickIndex] = useState(0);
      const [mentions, setMentions] = useState([]);
      const [composer, setComposer] = useState(null);
      const [notices, setNotices] = useState([]);
      const [draft, setDraft] = useState('');
      const [busy, setBusy] = useState('');
      const inputRef = useRef(null);

      const sessionId = (sessionState && sessionState.sessionId) || '';

      const loadMessages = useCallback(async () => {
        try {
          const value = await get(`/chat/messages?sceneId=${encodeURIComponent(scene.id)}&panelId=${encodeURIComponent(panel.id)}`);
          setItems(value && Array.isArray(value.items) ? value.items : []);
          setBound(Boolean(value && value.bound));
        } catch (error) {
          say(msg(error), 'error');
        }
      }, [scene.id, panel.id, say]);

      const loadComposer = useCallback(async () => {
        try {
          const value = await get(`/composer?sceneId=${encodeURIComponent(scene.id)}&panelId=${encodeURIComponent(panel.id)}`);
          setComposer(value || null);
          setBound(Boolean(value && value.bound));
        } catch {
          setComposer(null);
        }
      }, [scene.id, panel.id]);

      const loadSessions = useCallback(async () => {
        try {
          const value = await get('/sessions');
          setSessions(value && Array.isArray(value.items) ? value.items : []);
        } catch {
          setSessions([]);
        }
      }, []);

      useEffect(() => {
        void loadMessages();
        void loadComposer();
        void loadSessions();
      }, [loadMessages, loadComposer, loadSessions]);

      useEffect(() => {
        let alive = true;
        const timer = setInterval(async () => {
          if (!alive) return;
          try {
            const value = await get(`/chat/messages?sceneId=${encodeURIComponent(scene.id)}&panelId=${encodeURIComponent(panel.id)}`);
            if (!alive) return;
            setItems(value && Array.isArray(value.items) ? value.items : []);
            setRunning(Boolean(value && value.running));
          } catch {
            /* 轮询失败不打扰 */
          }
        }, 2500);
        return () => {
          alive = false;
          clearInterval(timer);
        };
      }, [scene.id, panel.id]);

      useEffect(() => {
        const word = /(^|\s)@([^\s@]*)$/.exec(draft);
        if (!word) {
          setMentions([]);
          if (picker === 'file') setPicker('');
          return undefined;
        }
        let alive = true;
        const timer = setTimeout(async () => {
          try {
            const value = await get(`/mentions?sceneId=${encodeURIComponent(scene.id)}&panelId=${encodeURIComponent(panel.id)}&q=${encodeURIComponent(word[2])}`);
            if (!alive) return;
            setMentions(value && Array.isArray(value.items) ? value.items : []);
            setPicker('file');
            setPickIndex(0);
          } catch {
            if (alive) setMentions([]);
          }
        }, 160);
        return () => {
          alive = false;
          clearTimeout(timer);
        };
      }, [draft, scene.id, panel.id, picker]);

      const insertMention = (path) => {
        setDraft((prev) => `${prev.replace(/(^|\s)@([^\s@]*)$/, `$1@${path} `)}`);
        setPicker('');
        setMentions([]);
        if (inputRef.current) inputRef.current.focus();
      };

      const insertCommand = (name) => {
        setDraft(`/${name} `);
        setPicker('');
        if (inputRef.current) inputRef.current.focus();
      };

      const bindSession = async (nextId) => {
        if (!nextId) return;
        setBusy('bind');
        try {
          await post('/session/bind', { sceneId: scene.id, panelId: panel.id, sessionId: nextId });
          say('已绑定会话', 'ok');
          setPicker('');
          await loadMessages();
          await loadComposer();
        } catch (error) {
          say(msg(error), 'error');
        } finally {
          setBusy('');
        }
      };

      const newSession = async () => {
        setBusy('new');
        try {
          const value = await post('/session/new', { sceneId: scene.id, panelId: panel.id });
          say('已新建会话', 'ok');
          setPicker('');
          await loadMessages();
          await loadComposer();
          await loadSessions();
          return value;
        } catch (error) {
          say(msg(error), 'error');
          return null;
        } finally {
          setBusy('');
        }
      };

      const renameSession = async (item) => {
        const next = window.prompt('给这个会话起个名字（比如「福利商城 · 日常」）', item.title || '');
        if (!next || !next.trim()) return;
        setBusy('rename');
        try {
          await post('/session/rename', { sessionId: item.sessionId, title: next.trim() });
          say('会话已改名', 'ok');
          await loadSessions();
        } catch (error) {
          say(msg(error), 'error');
        } finally {
          setBusy('');
        }
      };

      const claim = async () => {
        setBusy('claim');
        try {
          await post('/claim', { sceneId: scene.id, panelId: panel.id });
          say('已把「认领身份」的指令发给会话', 'ok');
        } catch (error) {
          say(msg(error), 'error');
        } finally {
          setBusy('');
        }
      };

      const pushNotice = (text) => {
        setNotices((prev) => [{ text, time: Date.now() }, ...prev].slice(0, 4));
      };

      const send = async () => {
        const text = draft.trim();
        if (!text) return;
        if (!bound) {
          say('先绑一个会话（右上角选一个，或点「新建会话」）', 'error');
          return;
        }
        const base = { sceneId: scene.id, panelId: panel.id };
        try {
          if (text.startsWith('/')) {
            const value = await post('/command', { ...base, line: text });
            pushNotice(`/${text.slice(1)} → ${value.kind || 'ok'}${value.text ? '：' + value.text : ''}`);
            setDraft('');
            await loadComposer();
          } else {
            await post('/chat/send', { ...base, text });
            setDraft('');
            await loadMessages();
          }
        } catch (error) {
          say(msg(error), 'error');
        }
      };

      const pickModel = async (model) => {
        if (!bound) {
          say('先发一句话建好会话，再换模型', 'error');
          return;
        }
        try {
          await post('/composer/model', { sceneId: scene.id, panelId: panel.id, provider: model.provider, model: model.model, reasoningEffort: model.reasoningEffort });
          say(`已切到 ${model.modelName}`, 'ok');
          setPicker('');
          await loadComposer();
        } catch (error) {
          say(msg(error), 'error');
        }
      };

      const cycleEffort = async () => {
        const selection = composer && composer.selection;
        const current = composer && composer.models && composer.models.find((item) => item.model === (selection && selection.model));
        const efforts = (current && current.efforts) || [];
        if (!bound || !efforts.length) {
          say('先发一句话建好会话，再调档位', 'error');
          return;
        }
        const now = (selection && selection.reasoningEffort) || '';
        const index = Math.max(0, efforts.findIndex((item) => item.id === now));
        const next = efforts[(index + 1) % efforts.length];
        await pickModel({ provider: selection.provider, model: selection.model, modelName: current.modelName, reasoningEffort: next.id });
      };

      const pickPermission = async (preset) => {
        if (!bound) {
          say('先发一句话建好会话，再改权限', 'error');
          return;
        }
        try {
          await post('/composer/permission', { sceneId: scene.id, panelId: panel.id, preset });
          say('权限已切换', 'ok');
          setPicker('');
          await loadComposer();
        } catch (error) {
          say(msg(error), 'error');
        }
      };

      const runPicker = () => {
        if (picker === 'file') {
          const item = mentions[pickIndex];
          if (item) insertMention(item.path);
          return;
        }
        if (picker === 'command') {
          const item = (composer && composer.commands ? composer.commands : [])[pickIndex];
          if (item) insertCommand(item.name);
          return;
        }
        if (picker === 'model') {
          const item = (composer && composer.models ? composer.models : [])[pickIndex];
          if (item) void pickModel(item);
          return;
        }
        if (picker === 'permission') {
          const item = (composer && composer.permission ? composer.permission.presets : [])[pickIndex];
          if (item) void pickPermission(item.id);
        }
      };

      const pickerLength = () => {
        if (picker === 'file') return mentions.length;
        if (picker === 'command') return (composer && composer.commands ? composer.commands : []).length;
        if (picker === 'model') return (composer && composer.models ? composer.models : []).length;
        if (picker === 'permission') return (composer && composer.permission ? composer.permission.presets : []).length;
        return 0;
      };

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          setPicker('');
          return;
        }
        if (picker && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault();
          const total = pickerLength();
          if (!total) return;
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          setPickIndex((prev) => (prev + delta + total) % total);
          return;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          if (picker && pickerLength()) runPicker();
          else void send();
        }
      };

      const onChange = (event) => {
        const text = event.target.value;
        setDraft(text);
        if (text.startsWith('/') && !text.includes('\n') && text.trim().indexOf(' ') < 0) {
          setPicker('command');
          setPickIndex(0);
        } else if (picker === 'command' && !text.startsWith('/')) {
          setPicker('');
        }
      };

      const selection = (composer && composer.selection) || null;
      const modelName = selection ? ((composer.models.find((item) => item.model === selection.model) || {}).modelName || selection.model) : '模型';
      const permissionName = (composer && composer.permission && (composer.permission.presets.find((item) => item.id === composer.permission.preset) || {}).name) || '权限';

      return h('section', { className: 'pm-pane pm-pane-harness' },
        h('header', { className: 'pm-pane-head' },
          h('div', { className: 'pm-pane-title' },
            h('span', { className: 'pm-pane-dot is-harness' }),
            h('span', null, panel.title || 'AI'),
            h('span', { className: 'pm-pane-hint' }, bound ? '已绑会话' : '未绑会话')),
          h('div', { className: 'pm-pane-actions' },
            h('button', {
              type: 'button',
              className: 'pm-btn is-mini',
              disabled: busy !== '',
              onClick: () => { setPicker(picker === 'session' ? '' : 'session'); void loadSessions(); }
            }, '会话'),
            h('button', {
              type: 'button',
              className: 'pm-btn is-mini is-ghost',
              disabled: !bound || busy !== '',
              title: '把「铁律 / 共享层 / 定位卡 / §〇」一次性发给这个会话，让它知道自己属于哪个场景。不发也能正常聊天。',
              onClick: claim
            }, '认领身份'))),
        bound ? null : h('div', { className: 'pm-claim-hint' }, '先点「会话」选一个（或新建），再点「认领身份」把场景身份发过去 —— 不发也能聊，只是它不知道自己在哪个场景。'),
        picker === 'session' ? h('div', { className: 'pm-session-list' },
          h('div', { className: 'pm-session-head' }, '选一个会话绑到这块面板'),
          h('button', { type: 'button', className: 'pm-btn is-mini is-primary', disabled: busy !== '', onClick: newSession }, busy === 'new' ? '新建中…' : '＋ 新建会话'),
          sessions.length ? sessions.map((item) => h('div', {
            key: item.sessionId,
            className: cx('pm-session-row', item.sessionId === sessionId && 'is-active')
          },
            h('button', {
              type: 'button',
              className: 'pm-session-item',
              title: item.cwd || item.title || '',
              onClick: () => void bindSession(item.sessionId)
            },
              h('span', { className: 'pm-session-title' }, item.title || '（还没起名字的会话）')),
            h('button', {
              type: 'button',
              className: 'pm-btn is-mini is-ghost',
              disabled: busy !== '',
              title: '给这个会话改个名字',
              onClick: () => void renameSession(item)
            }, '改名')))
            : h('div', { className: 'pm-session-empty' }, '没读到会话列表，可以直接点「新建会话」')) : null,
        h(ChatFeed, { items, running, bound }),
        notices.length ? h('div', { className: 'pm-notices' }, notices.map((item, index) => h('div', { key: `${item.time}-${index}`, className: 'pm-notice' }, item.text))) : null,
        h('div', { className: 'pm-composer' },
          picker === 'command' ? h('div', { className: 'pm-picker' },
            h('div', { className: 'pm-picker-title' }, '命令'),
            h('div', { className: 'pm-picker-list' }, (composer && composer.commands ? composer.commands : []).map((item, index) => h('button', {
              key: item.name,
              type: 'button',
              className: cx('pm-picker-item', index === pickIndex && 'is-active'),
              onMouseEnter: () => setPickIndex(index),
              onClick: () => insertCommand(item.name)
            },
              h('span', { className: 'pm-picker-name' }, `/${item.name}`),
              h('span', { className: 'pm-picker-path' }, item.description || ''))))) : null,
          picker === 'model' ? h('div', { className: 'pm-picker' },
            h('div', { className: 'pm-picker-title' }, '模型'),
            h('div', { className: 'pm-picker-list' }, (composer && composer.models ? composer.models : []).map((item, index) => h('button', {
              key: `${item.provider}/${item.model}`,
              type: 'button',
              className: cx('pm-picker-item', index === pickIndex && 'is-active'),
              onMouseEnter: () => setPickIndex(index),
              onClick: () => void pickModel(item)
            },
              h('span', { className: 'pm-picker-name' }, item.modelName),
              h('span', { className: 'pm-picker-path' }, `${item.providerName}${selection && selection.model === item.model ? ' · 当前' : ''}`))))) : null,
          picker === 'permission' ? h('div', { className: 'pm-picker' },
            h('div', { className: 'pm-picker-title' }, '权限模式'),
            h('div', { className: 'pm-picker-list' }, (composer && composer.permission ? composer.permission.presets : []).map((item, index) => h('button', {
              key: item.id,
              type: 'button',
              className: cx('pm-picker-item', index === pickIndex && 'is-active'),
              onMouseEnter: () => setPickIndex(index),
              onClick: () => void pickPermission(item.id)
            },
              h('span', { className: 'pm-picker-name' }, item.name),
              h('span', { className: 'pm-picker-path' }, item.hint || ''))))) : null,
          picker === 'file' ? h(MentionList, { items: mentions, index: pickIndex, onHover: setPickIndex, onPick: (item) => insertMention(item.path) }) : null,
          h('textarea', {
            className: 'pm-composer-input',
            ref: inputRef,
            value: draft,
            rows: 2,
            placeholder: bound ? '说点什么…  输入 @ 引文件，/ 跑命令' : '先绑一个会话再说话',
            onChange,
            onKeyDown
          }),
          h('div', { className: 'pm-composer-bar' },
            h('div', { className: 'pm-composer-left' },
              h('button', { type: 'button', className: 'pm-chip-btn', onClick: () => setPicker(picker === 'file' ? '' : 'file') }, '＋ 文件'),
              h('button', { type: 'button', className: 'pm-chip-btn', onClick: () => setPicker(picker === 'command' ? '' : 'command') }, '/ 命令'),
              h('button', { type: 'button', className: 'pm-chip-btn', onClick: () => setPicker(picker === 'permission' ? '' : 'permission') }, permissionName)),
            h('div', { className: 'pm-composer-right' },
              h('button', { type: 'button', className: 'pm-chip-btn is-effort', onClick: () => void cycleEffort(), title: '切换思考档位' }, (selection && selection.reasoningEffort) || '档位'),
              h('button', { type: 'button', className: 'pm-chip-btn is-model', onClick: () => setPicker(picker === 'model' ? '' : 'model') }, modelName),
              h('button', { type: 'button', className: cx('pm-send', busy === 'send' && 'is-busy'), onClick: () => void send(), title: '发送（Enter）' }, '↑')))));
    }

    /* ------------------------------------------------------------- 文件面板 */

    function FilePanel(props) {
      const { scene, panel, selection, onPick, say } = props;
      const [nodes, setNodes] = useState({});
      const [open, setOpen] = useState({});
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const root = panel.root || scene.root || '';

      const loadDir = useCallback(async (rel) => {
        try {
          const value = await get(`/tree?sceneId=${encodeURIComponent(scene.id)}&panelId=${encodeURIComponent(panel.id)}&path=${encodeURIComponent(rel)}`);
          setNodes((prev) => ({ ...prev, [rel]: value.nodes || [] }));
          setError('');
        } catch (err) {
          setError(msg(err));
        }
      }, [scene.id, panel.id]);

      useEffect(() => {
        setNodes({});
        setOpen({});
        if (!root) return;
        setBusy(true);
        void loadDir('').finally(() => setBusy(false));
      }, [root, loadDir]);

      const toggle = async (node) => {
        const rel = node.path;
        const next = { ...open, [rel]: !open[rel] };
        setOpen(next);
        if (next[rel] && !nodes[rel]) await loadDir(rel);
      };

      const renderNodes = (rel, depth) => {
        const list = nodes[rel] || [];
        if (!list.length) return null;
        return h('div', { className: 'pm-tree-group' }, list.map((node) => {
          const isOpen = Boolean(open[node.path]);
          const picked = selection && selection.path === node.path;
          return h('div', { key: node.path, className: 'pm-tree-node' },
            h('button', {
              type: 'button',
              className: cx('pm-tree-row', picked && 'is-active', node.dir && 'is-dir'),
              style: { paddingLeft: `${6 + depth * 12}px` },
              title: node.path,
              onClick: () => (node.dir ? void toggle(node) : onPick({ panelId: panel.id, path: node.path, name: node.name, kind: node.kind }))
            },
              h('span', { className: 'pm-tree-caret' }, node.dir ? (isOpen ? '▾' : '▸') : '·'),
              h('span', { className: 'pm-tree-name' }, node.name),
              h('span', { className: 'pm-tree-kind' }, node.dir ? '' : kindLabel(node.kind))),
            node.dir && isOpen ? renderNodes(node.path, depth + 1) : null);
        }));
      };

      return h('section', { className: 'pm-pane pm-pane-file' },
        h('header', { className: 'pm-pane-head' },
          h('div', { className: 'pm-pane-title' }, h('span', { className: 'pm-pane-dot is-file' }), h('span', null, panel.title || '文件')),
          h('div', { className: 'pm-pane-actions' },
            h('button', { type: 'button', className: 'pm-btn is-mini', disabled: busy, onClick: () => { setBusy(true); void loadDir('').finally(() => setBusy(false)); } }, '刷新'),
            h('button', { type: 'button', className: 'pm-btn is-mini', onClick: () => post('/open', { sceneId: scene.id, panelId: panel.id, path: '' }).catch((err) => say(msg(err), 'error')) }, '目录'))),
        h('div', { className: 'pm-tree' },
          busy && !Object.keys(nodes).length ? h('div', { className: 'pm-tree-loading' }, h(Spinner, null)) : null,
          error ? h('div', { className: 'pm-tree-error' }, error) : null,
          !root ? h(Empty, { title: '这个场景还没设根目录', hint: '编辑场景 JSON，把 root 填成要看的目录' }) : null,
          root && !error && !busy && !(nodes[''] || []).length ? h(Empty, { title: '目录是空的', hint: root }) : null,
          root ? renderNodes('', 0) : null));
    }

    /* --------------------------------------------------------- 预览 / 编辑 */

    function OfficePreview(props) {
      const { scene, panel, path, say } = props;
      const [state, setState] = useState({ status: 'idle', tiles: [], error: '' });

      const render = useCallback(async (refresh) => {
        setState((prev) => ({ ...prev, status: 'loading', error: '' }));
        try {
          const value = await post('/preview', { sceneId: scene.id, panelId: panel.id, path, refresh: Boolean(refresh) });
          setState({ status: 'ready', tiles: value.tiles || [], error: '', key: value.key, pageCount: value.pageCount, backend: value.backend, missingFonts: value.missingFonts || [] });
        } catch (err) {
          setState({ status: 'error', tiles: [], error: msg(err) });
        }
      }, [scene.id, panel.id, path]);

      useEffect(() => {
        void render(false);
      }, [render]);

      if (state.status === 'loading' || state.status === 'idle') {
        return h('div', { className: 'pm-preview-loading' }, h(Spinner, { large: true }), h('div', null, '正在用内置引擎渲染…'));
      }
      if (state.status === 'error') {
        return h('div', { className: 'pm-preview-error' },
          h('div', { className: 'pm-preview-error-title' }, '渲染不出来'),
          h('div', { className: 'pm-preview-error-text' }, state.error),
          h('div', { className: 'pm-preview-error-actions' },
            h('button', { type: 'button', className: 'pm-btn is-mini', onClick: () => void render(true) }, '重试'),
            h('button', { type: 'button', className: 'pm-btn is-mini', onClick: () => post('/open', { sceneId: scene.id, panelId: panel.id, path }).catch((err) => say(msg(err), 'error')) }, '用系统程序打开')));
      }
      return h('div', { className: 'pm-preview' },
        h('div', { className: 'pm-preview-bar' },
          h('span', null, `共 ${state.pageCount || state.tiles.length} 页 · ${state.backend || 'engine'}`),
          h('span', { className: 'pm-preview-spacer' }),
          h('button', { type: 'button', className: 'pm-btn is-mini', onClick: () => void render(true) }, '重新渲染'),
          h('button', { type: 'button', className: 'pm-btn is-mini', onClick: () => post('/open', { sceneId: scene.id, panelId: panel.id, path }).catch((err) => say(msg(err), 'error')) }, '外部打开')),
        h('div', { className: 'pm-preview-pages' }, state.tiles.map((tile) => h('img', {
          key: tile.name,
          className: 'pm-preview-page',
          alt: tile.name,
          src: `${API}/preview/tile?key=${encodeURIComponent(state.key)}&name=${encodeURIComponent(tile.name)}`
        }))));
    }

    function ViewPanel(props) {
      const { scene, panel, selection, say } = props;
      const path = selection && selection.path ? selection.path : '';
      const [info, setInfo] = useState(null);
      const [draft, setDraft] = useState('');
      const [savedText, setSavedText] = useState('');
      const [mtimeMs, setMtimeMs] = useState(0);
      const [saving, setSaving] = useState(false);
      const [loading, setLoading] = useState(false);
      const [preview, setPreview] = useState(false);
      const [autoSave, setAutoSave] = useState(() => readPref('dafeiyu.view.autosave', true));
      const editorRef = useRef(null);

      const load = useCallback(async (rel) => {
        if (!rel) {
          setInfo(null);
          return;
        }
        setLoading(true);
        try {
          const value = await get(`/file?sceneId=${encodeURIComponent(scene.id)}&panelId=${encodeURIComponent(panel.id)}&path=${encodeURIComponent(rel)}`);
          setInfo(value);
          setDraft(typeof value.text === 'string' ? value.text : '');
          setSavedText(typeof value.text === 'string' ? value.text : '');
          setMtimeMs(value.mtimeMs || 0);
        } catch (err) {
          say(msg(err), 'error');
          setInfo(null);
        } finally {
          setLoading(false);
        }
      }, [scene.id, panel.id, say]);

      useEffect(() => {
        void load(path);
      }, [path, load]);

      useEffect(() => {
        writePref('dafeiyu.view.autosave', autoSave);
      }, [autoSave]);

      const dirty = Boolean(info) && draft !== savedText;

      const save = useCallback(async (options) => {
        if (!info || !dirty) return;
        setSaving(true);
        try {
          const value = await post('/file/save', {
            sceneId: scene.id,
            panelId: panel.id,
            path: info.path,
            text: draft,
            baseMtimeMs: mtimeMs
          });
          setMtimeMs(value.mtimeMs);
          setSavedText(draft);
          if (!(options && options.silent)) say('已保存', 'ok');
        } catch (err) {
          say(msg(err), 'error');
        } finally {
          setSaving(false);
        }
      }, [info, dirty, draft, mtimeMs, scene.id, panel.id, say]);

      useEffect(() => {
        if (!autoSave || !dirty || saving || !info || info.kind !== 'text') return undefined;
        const timer = setTimeout(() => { void save({ silent: true }); }, 1200);
        return () => clearTimeout(timer);
      }, [autoSave, dirty, saving, draft, info, save]);

      if (!path) {
        return h('section', { className: 'pm-pane pm-pane-view' },
          h('header', { className: 'pm-pane-head' }, h('div', { className: 'pm-pane-title' }, h('span', { className: 'pm-pane-dot is-view' }), h('span', null, panel.title || '预览'))),
          h(Empty, { title: '还没选文件', hint: '左边文件树点一个文件，这里就地看 / 改' }));
      }

      if (loading && !info) {
        return h('section', { className: 'pm-pane pm-pane-view' }, h('div', { className: 'pm-view-loading' }, h(Spinner, null)));
      }

      const head = h('header', { className: 'pm-pane-head' },
        h('div', { className: 'pm-pane-title' },
          h('span', { className: 'pm-pane-dot is-view' }),
          h('span', { className: 'pm-pane-title-text', title: path }, info ? info.name : path),
          info ? h('span', { className: 'pm-pane-hint' }, `${kindLabel(info.kind)} · ${fmtSize(info.size)}`) : null),
        h('div', { className: 'pm-pane-actions' },
          info && info.kind === 'text' ? h('button', { type: 'button', className: 'pm-btn is-mini', onClick: () => setPreview(!preview) }, preview ? '改' : '看') : null,
          info && info.kind === 'text' ? h('button', { type: 'button', className: cx('pm-btn is-mini', autoSave && 'is-primary'), onClick: () => setAutoSave(!autoSave) }, autoSave ? '自动保存' : '手动保存') : null,
          info && info.kind === 'text' ? h('button', { type: 'button', className: 'pm-btn is-mini', disabled: !dirty || saving, onClick: () => void save() }, saving ? '保存中…' : dirty ? '保存' : '已保存') : null,
          h('button', { type: 'button', className: 'pm-btn is-mini', onClick: () => void load(path) }, '重新读取'),
          h('button', { type: 'button', className: 'pm-btn is-mini', onClick: () => post('/open', { sceneId: scene.id, panelId: panel.id, path }).catch((err) => say(msg(err), 'error')) }, '外部打开')));

      let body = null;
      if (info && info.kind === 'text') {
        body = preview
          ? h('div', { className: 'pm-view-md' }, renderMarkdown(draft))
          : h('div', { className: 'pm-view-text' },
            h('textarea', {
              className: 'pm-view-textarea',
              ref: editorRef,
              value: draft,
              spellCheck: false,
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => {
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                  event.preventDefault();
                  void save();
                }
              }
            }),
            h('div', { className: 'pm-view-foot' }, dirty ? (autoSave ? '● 未保存（停手即存）' : '● 未保存') : '已保存',
              mtimeMs ? h('span', { className: 'pm-view-foot-time' }, ` · ${fmtTime(mtimeMs)}`) : null));
      } else if (info && info.kind === 'image') {
        body = h('div', { className: 'pm-view-image' }, h('img', { alt: info.name, src: `${API}/raw?sceneId=${encodeURIComponent(scene.id)}&panelId=${encodeURIComponent(panel.id)}&path=${encodeURIComponent(path)}` }));
      } else if (info && info.kind === 'pdf') {
        body = h('iframe', { className: 'pm-view-pdf', title: info.name, src: `${API}/raw?sceneId=${encodeURIComponent(scene.id)}&panelId=${encodeURIComponent(panel.id)}&path=${encodeURIComponent(path)}` });
      } else if (info && info.kind === 'office') {
        body = h(OfficePreview, { scene, panel, path, say });
      } else if (info) {
        body = h(Empty, { title: '这种文件不内嵌', hint: `${info.name}（${fmtSize(info.size)}） · 可以「外部打开」` });
      }

      return h('section', { className: 'pm-pane pm-pane-view' }, head, body);
    }

    /* ------------------------------------------------------------- 网页面板 */

    function WebPanel(props) {
      const { panel, say } = props;
      const url = panel.url || '';
      const [zoom, setZoom] = useState(1);
      const [reloadKey, setReloadKey] = useState(0);
      const [blocked, setBlocked] = useState(false);
      const [loaded, setLoaded] = useState(false);

      useEffect(() => {
        if (!url) return undefined;
        setBlocked(false);
        setLoaded(false);
        const timer = setTimeout(() => {
          setBlocked((prev) => (prev || loaded ? prev : true));
        }, 8000);
        return () => clearTimeout(timer);
      }, [url, reloadKey, loaded]);

      return h('section', { className: 'pm-pane pm-pane-web' },
        h('header', { className: 'pm-pane-head' },
          h('div', { className: 'pm-pane-title' }, h('span', { className: 'pm-pane-dot is-web' }), h('span', null, panel.title || '网页')),
          h('div', { className: 'pm-pane-actions' },
            h('button', { type: 'button', className: 'pm-btn is-mini', onClick: () => setZoom(Math.max(0.6, Number((zoom - 0.1).toFixed(2)))) }, '−'),
            h('span', { className: 'pm-zoom-label' }, `${Math.round(zoom * 100)}%`),
            h('button', { type: 'button', className: 'pm-btn is-mini', onClick: () => setZoom(Math.min(1.8, Number((zoom + 0.1).toFixed(2)))) }, '＋'),
            h('button', { type: 'button', className: 'pm-btn is-mini', onClick: () => setReloadKey(reloadKey + 1) }, '刷新'),
            h('button', { type: 'button', className: 'pm-btn is-mini', onClick: () => post('/openlink', { url }).catch((err) => say(msg(err), 'error')) }, '浏览器'))),
        !url ? h(Empty, { title: '这块没填网址', hint: '编辑场景 JSON，给这块加上 url' }) : null,
        url && blocked && !loaded
          ? h('div', { className: 'pm-blocked' },
            h('div', { className: 'pm-blocked-title' }, '这个网站不让嵌在面板里'),
            h('div', { className: 'pm-blocked-text' }, '多半是对方设了 X-Frame-Options / CSP。可以用系统浏览器打开，登录态还在。'),
            h('div', { className: 'pm-blocked-actions' },
              h('button', { type: 'button', className: 'pm-btn is-mini is-primary', onClick: () => post('/openlink', { url }).catch((err) => say(msg(err), 'error')) }, '用系统浏览器打开'),
              h('button', { type: 'button', className: 'pm-btn is-mini', onClick: () => setReloadKey(reloadKey + 1) }, '再试一次')))
          : null,
        url ? h('div', { className: 'pm-web-wrap' },
          h('iframe', {
            key: reloadKey,
            className: 'pm-web-frame',
            title: panel.title || '网页',
            src: url,
            referrerPolicy: 'no-referrer',
            allow: 'clipboard-read; clipboard-write; fullscreen',
            style: { width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})` },
            onLoad: () => setLoaded(true)
          })) : null);
    }

    /* ----------------------------------------------------- 定位卡 / 场景记忆 */

    function NotePanel(props) {
      const { scene, panel, say } = props;
      const source = panel.source === 'context' ? 'context' : 'memory';
      const [text, setText] = useState('');
      const [saved, setSaved] = useState('');
      const [loading, setLoading] = useState(true);
      const [busy, setBusy] = useState(false);

      const load = useCallback(async () => {
        setLoading(true);
        try {
          const value = await get(`/scene/notes?id=${encodeURIComponent(scene.id)}`);
          const next = source === 'context' ? value.context : value.memory;
          setText(next || '');
          setSaved(next || '');
        } catch (err) {
          say(msg(err), 'error');
        } finally {
          setLoading(false);
        }
      }, [scene.id, source, say]);

      useEffect(() => { void load(); }, [load]);

      const save = useCallback(async (options) => {
        if (busy) return;
        setBusy(true);
        try {
          await post('/scene/note', { sceneId: scene.id, source, text });
          setSaved(text);
          if (!(options && options.silent)) say('已保存', 'ok');
        } catch (err) {
          say(msg(err), 'error');
        } finally {
          setBusy(false);
        }
      }, [scene.id, source, text, busy, say]);

      const dirty = text !== saved;
      useEffect(() => {
        if (!dirty || loading) return undefined;
        const timer = setTimeout(() => { void save({ silent: true }); }, 1200);
        return () => clearTimeout(timer);
      }, [dirty, loading, text, save]);

      return h('section', { className: 'pm-pane pm-pane-note' },
        h('header', { className: 'pm-pane-head' },
          h('div', { className: 'pm-pane-title' },
            h('span', { className: 'pm-pane-dot is-note' }),
            h('span', null, panel.title || (source === 'context' ? '定位卡' : '场景记忆')),
            h('span', { className: 'pm-pane-hint' }, dirty ? '未保存' : '已保存')),
          h('div', { className: 'pm-pane-actions' },
            h('button', { type: 'button', className: 'pm-btn is-mini', onClick: () => void load() }, '重新读取'),
            h('button', { type: 'button', className: 'pm-btn is-mini', disabled: !dirty || busy, onClick: () => void save() }, busy ? '保存中…' : '保存'))),
        loading ? h('div', { className: 'pm-view-loading' }, h(Spinner, null)) : h('textarea', {
          className: 'pm-note-textarea',
          value: text,
          spellCheck: false,
          placeholder: source === 'context' ? '写这个场景是干什么的、资产在哪、什么话能触发它' : '§〇 交接 + 长期决策',
          onChange: (event) => setText(event.target.value)
        }));
    }

    /* ------------------------------------------------------- 记忆层 L0–L3 */

    const LAYER_TABS = [
      { key: 'scene', label: '场景', kinds: ['context', 'memory'] },
      { key: 'rules', label: '宪法', kinds: ['constitution'] },
      { key: 'shared', label: '共享层', kinds: ['shared'] },
      { key: 'project', label: '项目记忆', kinds: ['project'] }
    ];

    function LayersPanel(props) {
      const { scene, panel, say } = props;
      const [data, setData] = useState(null);
      const [tab, setTab] = useState('scene');
      const [picked, setPicked] = useState(null);
      const [text, setText] = useState('');
      const [saved, setSaved] = useState('');
      const [loading, setLoading] = useState(true);
      const [busy, setBusy] = useState(false);
      const [draftName, setDraftName] = useState('');

      const load = useCallback(async (keepPick) => {
        setLoading(true);
        try {
          const value = await get(`/layers?id=${encodeURIComponent(scene.id)}`);
          setData(value);
          const all = [].concat(value.docs || [], value.constitution || [], value.shared || [], value.projects || []);
          const next = keepPick || all[0] || null;
          setPicked(next);
          setText(next ? next.text : '');
          setSaved(next ? next.text : '');
        } catch (err) {
          say(msg(err), 'error');
        } finally {
          setLoading(false);
        }
      }, [scene.id, say]);

      useEffect(() => { void load(null); }, [load]);

      const documents = data
        ? [].concat(data.docs || [], data.constitution || [], data.shared || [], data.projects || [])
        : [];
      const visible = documents.filter((doc) => {
        const group = LAYER_TABS.find((item) => item.key === tab);
        return group ? group.kinds.includes(doc.kind) : true;
      });

      const pick = useCallback((doc) => {
        setPicked(doc);
        setText(doc.text || '');
        setSaved(doc.text || '');
      }, []);

      const save = useCallback(async (options) => {
        if (!picked || busy) return;
        setBusy(true);
        try {
          await post('/layer/save', { sceneId: scene.id, kind: picked.kind, name: picked.name, text });
          setSaved(text);
          if (!(options && options.silent)) say('已保存', 'ok');
          setData((prev) => {
            if (!prev) return prev;
            const fix = (list) => (list || []).map((doc) => (doc.kind === picked.kind && doc.name === picked.name ? { ...doc, text } : doc));
            return { ...prev, docs: fix(prev.docs), constitution: fix(prev.constitution), shared: fix(prev.shared), projects: fix(prev.projects) };
          });
        } catch (err) {
          say(msg(err), 'error');
        } finally {
          setBusy(false);
        }
      }, [scene.id, picked, text, busy, say]);

      const create = useCallback(async () => {
        const name = draftName.trim();
        if (!name || busy) return;
        setBusy(true);
        try {
          await post('/layer/create', { sceneId: scene.id, kind: tab === 'scene' ? 'project' : (tab === 'rules' ? 'constitution' : tab), name });
          setDraftName('');
          await load(null);
          say('已新建 ' + name, 'ok');
        } catch (err) {
          say(msg(err), 'error');
        } finally {
          setBusy(false);
        }
      }, [scene.id, draftName, tab, busy, load, say]);

      const dirty = Boolean(picked) && text !== saved;
      useEffect(() => {
        if (!dirty || loading) return undefined;
        const timer = setTimeout(() => { void save({ silent: true }); }, 1200);
        return () => clearTimeout(timer);
      }, [dirty, loading, text, save]);

      return h('section', { className: 'pm-pane pm-pane-layers' },
        h('header', { className: 'pm-pane-head' },
          h('div', { className: 'pm-pane-title' },
            h('span', { className: 'pm-pane-dot is-note' }),
            h('span', null, panel.title || '记忆层'),
            h('span', { className: 'pm-pane-hint' }, dirty ? '未保存' : `${documents.length} 份`)),
          h('div', { className: 'pm-pane-actions' },
            h('button', { type: 'button', className: 'pm-btn is-mini', onClick: () => void load(picked) }, '刷新'),
            h('button', { type: 'button', className: 'pm-btn is-mini', disabled: !dirty || busy, onClick: () => void save() }, busy ? '保存中…' : '保存'))),
        h('div', { className: 'pm-layer-tabs' }, LAYER_TABS.map((item) => h('button', {
          key: item.key,
          type: 'button',
          className: cx('pm-layer-tab', tab === item.key ? 'is-active' : ''),
          onClick: () => setTab(item.key)
        }, item.label))),
        loading
          ? h('div', { className: 'pm-view-loading' }, h(Spinner, null))
          : h('div', { className: 'pm-layer-body' },
            h('div', { className: 'pm-layer-list' },
              visible.length
                ? visible.map((doc) => h('button', {
                  key: `${doc.kind}:${doc.name}`,
                  type: 'button',
                  className: cx('pm-layer-item', picked && picked.kind === doc.kind && picked.name === doc.name ? 'is-active' : ''),
                  title: doc.rel || doc.path,
                  onClick: () => pick(doc)
                }, doc.name.replace(/\.(md|txt)$/i, '')))
                : h('div', { className: 'pm-layer-empty' }, '这里还没有文件'),
              h('div', { className: 'pm-layer-new' },
                h('input', {
                  className: 'pm-input pm-layer-new-input',
                  placeholder: tab === 'project' ? '新项目记忆名' : '新文件名',
                  value: draftName,
                  onChange: (event) => setDraftName(event.target.value),
                  onKeyDown: (event) => { if (event.key === 'Enter') void create(); }
                }),
                h('button', { type: 'button', className: 'pm-btn is-mini', disabled: !draftName.trim() || busy, onClick: () => void create() }, '＋'))),
            h('textarea', {
              className: 'pm-note-textarea pm-layer-textarea',
              value: text,
              spellCheck: false,
              disabled: !picked,
              placeholder: picked ? '在这里直接改，停手 1.2 秒自动保存' : '左边选一份文件',
              onChange: (event) => setText(event.target.value)
            })));
    }

    function ReservedPanel(props) {
      const { panel, scene } = props;
      return h('section', { className: 'pm-pane pm-pane-reserved' },
        h('header', { className: 'pm-pane-head' },
          h('div', { className: 'pm-pane-title' }, h('span', { className: 'pm-pane-dot is-reserved' }), h('span', null, panel.title || '预留位'))),
        h('div', { className: 'pm-reserved-body' },
          h('div', { className: 'pm-reserved-title' }, '这块留着'),
          h('div', { className: 'pm-reserved-text' }, panel.sub || '想换成网页 / 清单 / 图表，就编辑场景 JSON 改这块的 type。'),
          h('div', { className: 'pm-reserved-hint' }, `场景：${scene.name} · 面板 id：${panel.id}`)));
    }

    /* ------------------------------------------------------------ 场景网格 */

    function SceneGrid(props) {
      const { scene, selection, onPick, say, sessionState } = props;
      const cols = Math.max(1, Number(scene.cols) || 1);
      const rows = Math.max(1, Math.max(...scene.panels.map((item) => (Number(item.row) || 1) + (Number(item.h) || 1) - 1), 1));
      const styleFor = (panel) => ({
        gridColumn: `${Number(panel.col) || 1} / span ${Math.max(1, Number(panel.w) || 1)}`,
        gridRow: `${Number(panel.row) || 1} / span ${Math.max(1, Number(panel.h) || 1)}`
      });
      const render = (panel) => {
        const shared = { key: panel.id, scene, panel, selection, onPick, say, sessionState: sessionState && sessionState[panel.id] };
        if (panel.type === 'harness') return h('div', { key: panel.id, className: 'pm-cell', style: styleFor(panel) }, h(HarnessPanel, shared));
        if (panel.type === 'file') return h('div', { key: panel.id, className: 'pm-cell', style: styleFor(panel) }, h(FilePanel, shared));
        if (panel.type === 'view') return h('div', { key: panel.id, className: 'pm-cell', style: styleFor(panel) }, h(ViewPanel, shared));
        if (panel.type === 'web') return h('div', { key: panel.id, className: 'pm-cell', style: styleFor(panel) }, h(WebPanel, shared));
        if (panel.type === 'note') return h('div', { key: panel.id, className: 'pm-cell', style: styleFor(panel) }, h(NotePanel, shared));
      if (panel.type === 'layers') return h('div', { key: panel.id, className: 'pm-cell', style: styleFor(panel) }, h(LayersPanel, shared));
        return h('div', { key: panel.id, className: 'pm-cell', style: styleFor(panel) }, h(ReservedPanel, shared));
      };
      if (!scene.panels.length) {
        return h(Empty, { title: '这个场景还是空白的', hint: '点右上「编辑场景」加几块面板，或者换一个场景' });
      }
      return h('div', {
        className: 'pm-grid',
        style: {
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
        }
      }, scene.panels.map(render));
    }

    /* ---------------------------------------------------------- 场景 / 版本弹层 */

    function Modal(props) {
      if (!props.open) return null;
      return h('div', { className: 'pm-modal', onClick: props.onClose },
        h('div', { className: cx('pm-modal-card', props.wide && 'is-wide'), onClick: (event) => event.stopPropagation() },
          h('header', { className: 'pm-modal-head' },
            h('h3', { className: 'pm-modal-title' }, props.title),
            h('button', { type: 'button', className: 'pm-modal-close', onClick: props.onClose }, '×')),
          h('div', { className: 'pm-modal-body' }, props.children),
          props.footer ? h('footer', { className: 'pm-modal-foot' }, props.footer) : null));
    }

    function SceneEditor(props) {
      const { scene, onClose, onSaved, say } = props;
      const [text, setText] = useState('');
      const [busy, setBusy] = useState(false);

      useEffect(() => {
        if (!scene) return;
        const payload = {
          id: scene.id,
          name: scene.name,
          description: scene.description || '',
          root: scene.root || '',
          cols: scene.cols,
          panels: scene.panels
        };
        setText(JSON.stringify(payload, null, 2));
      }, [scene]);

      const save = async () => {
        setBusy(true);
        try {
          const parsed = JSON.parse(text);
          const value = await post('/scene/save', { scene: parsed });
          say('场景已保存', 'ok');
          onSaved(value.scene);
        } catch (err) {
          say(msg(err), 'error');
        } finally {
          setBusy(false);
        }
      };

      return h(Modal, {
        open: Boolean(scene),
        title: scene ? `编辑场景 · ${scene.name}` : '编辑场景',
        wide: true,
        onClose,
        footer: [
          h('button', { key: 'cancel', type: 'button', className: 'pm-btn', onClick: onClose }, '取消'),
          h('button', { key: 'save', type: 'button', className: 'pm-btn is-primary', disabled: busy, onClick: () => void save() }, busy ? '保存中…' : '保存')
        ]
      },
        h('div', { className: 'pm-form-hint' }, 'JSON 直接改：id / name / description / root / cols / panels（type 支持 harness · file · view · web · note · reserved）'),
        h('textarea', { className: 'pm-code-textarea', value: text, spellCheck: false, onChange: (event) => setText(event.target.value) }));
    }

    function NewSceneForm(props) {
      const { onClose, onCreated, say } = props;
      const [form, setForm] = useState({ name: '', root: '', cols: 4, preset: 'doc' });
      const [busy, setBusy] = useState(false);

      /** 从场景名生成 id；中文名生成不出字母时退回时间戳，用户完全不用管。 */
      const autoId = () => {
        const fromName = String(form.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (fromName) return fromName.slice(0, 40);
        return 'scene-' + Date.now().toString(36);
      };

      const submit = async () => {
        const name = String(form.name || '').trim();
        if (!name) {
          say('先给场景起个名字（比如「物流商城 206」）', 'error');
          return;
        }
        const id = autoId();
        setBusy(true);
        try {
          const panels = form.preset === 'doc'
            ? [
              { id: 'p-doc', title: '文档', type: 'view', col: 1, row: 1, w: 3, h: 3 },
              { id: 'p-file', title: '文件', type: 'file', col: 4, row: 1, w: 1, h: 3 },
              { id: 'p-note', title: '记忆层', type: 'layers', col: 1, row: 4, w: 2, h: 2 },
              { id: 'p-ai', title: 'AI', type: 'harness', col: 3, row: 4, w: 2, h: 2 }
            ]
            : [
              { id: 'p-file', title: '文件', type: 'file', col: 1, row: 1, w: 1, h: 3 },
              { id: 'p-ai', title: 'AI', type: 'harness', col: 2, row: 1, w: 2, h: 3 }
            ];
          const value = await post('/scene/save', {
            scene: { id, name: form.name || id, description: '', root: form.root, cols: Number(form.cols) || 4, panels }
          });
          say('场景已建好', 'ok');
          onCreated(value.scene);
        } catch (err) {
          say(msg(err), 'error');
        } finally {
          setBusy(false);
        }
      };

      return h(Modal, {
        open: true,
        title: '新建场景',
        onClose,
        footer: [
          h('button', { key: 'cancel', type: 'button', className: 'pm-btn', onClick: onClose }, '取消'),
          h('button', { key: 'ok', type: 'button', className: 'pm-btn is-primary', disabled: busy, onClick: () => void submit() }, busy ? '创建中…' : '创建')
        ]
      },
        h('div', { className: 'pm-form-grid' },
          h('label', { className: 'pm-field' }, h('span', null, '场景名称'), h('input', { className: 'pm-input', value: form.name, placeholder: '如 物流商城 206', autoFocus: true, onChange: (event) => setForm({ ...form, name: event.target.value }) })),
          h('label', { className: 'pm-field' }, h('span', null, '工作根目录'), h('input', { className: 'pm-input', value: form.root, placeholder: 'D:\\蓝宝\\01_福利商城', onChange: (event) => setForm({ ...form, root: event.target.value }) })),
          h('label', { className: 'pm-field' }, h('span', null, '列数'), h('input', { className: 'pm-input', type: 'number', min: 1, max: 8, value: form.cols, onChange: (event) => setForm({ ...form, cols: event.target.value }) })),
          h('label', { className: 'pm-field' }, h('span', null, '初始面板'), h('select', { className: 'pm-input', value: form.preset, onChange: (event) => setForm({ ...form, preset: event.target.value }) },
            h('option', { value: 'doc' }, '文档 + 文件 + 记忆 + AI（4 列）'),
            h('option', { value: 'work' }, '文件 + AI（3 列）')))),
        h('div', { className: 'pm-form-hint' }, '场景内部 id 会自动生成，你不用管。'));
    }

    function VersionPanel(props) {
      const { onClose, say } = props;
      const [info, setInfo] = useState(null);
      const [repo, setRepo] = useState('');
      const [busy, setBusy] = useState(false);

      const load = useCallback(async () => {
        try {
          const value = await get('/version');
          setInfo(value);
          setRepo(value.repositoryUrl || (value.repository && value.repository.url) || '');
        } catch (err) {
          say(msg(err), 'error');
        }
      }, [say]);

      useEffect(() => { void load(); }, [load]);

      const saveRepo = async () => {
        setBusy(true);
        try {
          await post('/version/repository', { url: repo.trim() });
          say('仓库地址已保存', 'ok');
          await load();
        } catch (err) {
          say(msg(err), 'error');
        } finally {
          setBusy(false);
        }
      };

      const snapshot = async () => {
        setBusy(true);
        try {
          await post('/version/snapshot', { note: '手动留档' });
          say('已留档', 'ok');
          await load();
        } catch (err) {
          say(msg(err), 'error');
        } finally {
          setBusy(false);
        }
      };

      const rollback = async (id) => {
        if (!window.confirm(`回滚到 ${id}？会先给当前版本留档，然后覆盖插件文件，之后 Ctrl+R 刷新。`)) return;
        setBusy(true);
        try {
          const value = await post('/version/rollback', { id });
          say(`已回滚到 ${value.current}，Ctrl+R 刷新面板`, 'ok');
          await load();
        } catch (err) {
          say(msg(err), 'error');
        } finally {
          setBusy(false);
        }
      };

      const commits = (info && info.commits) || null;
      return h(Modal, {
        open: true,
        title: '版本与仓库',
        wide: true,
        onClose,
        footer: [
          h('button', { key: 'snap', type: 'button', className: 'pm-btn', disabled: busy, onClick: () => void snapshot() }, '留一个快照'),
          h('button', { key: 'close', type: 'button', className: 'pm-btn is-primary', onClick: onClose }, '关闭')
        ]
      },
        !info ? h('div', { className: 'pm-view-loading' }, h(Spinner, null)) : h('div', { className: 'pm-version' },
          h('div', { className: 'pm-version-head' },
            h('div', null, h('div', { className: 'pm-version-name' }, `${info.display} ${info.version}`), h('div', { className: 'pm-version-sub' }, info.releasedAt || '')),
            h('div', { className: 'pm-version-path' }, info.dir)),
          h('label', { className: 'pm-field' }, h('span', null, 'GitHub 仓库地址'), h('div', { className: 'pm-repo' },
            h('input', { className: 'pm-input', value: repo, placeholder: 'https://github.com/lliujie/dsh-my-fish', onChange: (event) => setRepo(event.target.value) }),
            h('button', { type: 'button', className: 'pm-btn is-mini', disabled: busy, onClick: () => void saveRepo() }, '保存'))),
          commits ? h('div', { className: 'pm-version-block' },
            h('div', { className: 'pm-version-block-title' }, '提交记录'),
            commits.remote ? h('div', { className: 'pm-version-sub' }, commits.remote) : null,
            commits.error ? h('div', { className: 'pm-version-error' }, commits.error) : null,
            (commits.commits || []).map((item) => h('div', { key: `${item.hash}-${item.subject}`, className: 'pm-commit' },
              h('span', { className: 'pm-commit-hash' }, item.hash),
              h('span', { className: 'pm-commit-subject' }, item.subject),
              h('span', { className: 'pm-commit-meta' }, `${item.date || ''} ${item.author || ''}`)))) : null,
          h('div', { className: 'pm-version-block' },
            h('div', { className: 'pm-version-block-title' }, '变更日志'),
            (info.changelog || []).map((entry) => h('div', { key: entry.version, className: 'pm-log-item' },
              h('div', { className: 'pm-log-head' }, h('span', { className: 'pm-log-version' }, entry.version), h('span', { className: 'pm-log-title' }, entry.title || ''), h('span', { className: 'pm-log-date' }, entry.date || '')),
              h('ul', { className: 'pm-log-changes' }, (entry.changes || []).map((change, index) => h('li', { key: index }, change)))))),
          h('div', { className: 'pm-version-block' },
            h('div', { className: 'pm-version-block-title' }, '历史快照'),
            (info.history || []).length ? (info.history || []).slice().reverse().map((entry) => h('div', { key: entry.id, className: 'pm-history-row' },
              h('div', { className: 'pm-history-main' },
                h('span', { className: 'pm-history-version' }, entry.version),
                h('span', { className: 'pm-history-kind' }, entry.kind || ''),
                h('span', { className: 'pm-history-at' }, (entry.at || '').slice(0, 16).replace('T', ' '))),
              h('button', { type: 'button', className: 'pm-btn is-mini is-danger', disabled: busy, onClick: () => void rollback(entry.id) }, '回滚')))
              : h('div', { className: 'pm-version-sub' }, '还没有快照'))));
    }

    /* ------------------------------------------------------------- 根面板 */

    function PanelIcon() {
      return h('svg', { width: '18', height: '18', viewBox: '0 0 64 64', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
        h('path', { d: 'M45 32c0 9.4-8.3 17-18.5 17S8 40.4 8 32s8.3-16 18.5-16S45 22.6 45 32Z', stroke: 'currentColor', strokeWidth: '3.4' }),
        h('path', { d: 'M45 32 58 20v24L45 32Z', stroke: 'currentColor', strokeWidth: '3.4', strokeLinejoin: 'round' }),
        h('circle', { cx: '17', cy: '27', r: '2.6', fill: 'currentColor' }));
    }

    function Workbench() {
      const [snapshot, setSnapshot] = useState(null);
      const [activeId, setActiveId] = useState('');
      const [error, setError] = useState('');
      const [toast, setToast] = useState(null);
      const [selection, setSelection] = useState(null);
      const [sessionState, setSessionState] = useState({});
      const [editing, setEditing] = useState(null);
      const [creating, setCreating] = useState(false);
      const [showingVersion, setShowingVersion] = useState(false);
      const [busy, setBusy] = useState(false);

      const say = useCallback((text, kind) => {
        setToast({ text, kind: kind || 'ok', at: Date.now() });
      }, []);

      useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => setToast(null), 2600);
        return () => clearTimeout(timer);
      }, [toast]);

      const refresh = useCallback(async () => {
        setBusy(true);
        try {
          const value = await get('/state');
          setSnapshot(value);
          setError('');
          const scenes = (value && value.scenes) || [];
          const wanted = activeId || (value && value.settings && value.settings.lastScene) || '';
          const found = scenes.find((scene) => scene.id === wanted) || scenes[0] || null;
          setActiveId(found ? found.id : '');
        } catch (err) {
          setError(msg(err));
        } finally {
          setBusy(false);
        }
      }, [activeId]);

      useEffect(() => { void refresh(); }, [refresh]);

      const scenes = (snapshot && snapshot.scenes) || [];
      const active = scenes.find((scene) => scene.id === activeId) || null;

      const switchScene = async (id) => {
        setActiveId(id);
        setSelection(null);
        try {
          await post('/settings/update', { lastScene: id });
        } catch {
          /* 记住上次场景失败不影响使用 */
        }
      };

      const deleteScene = async (scene) => {
        const ok = window.confirm('删除场景「' + scene.name + '」？\n只删这份场景配置（面板布局与绑定），你目录里的文件一个都不动。');
        if (!ok) return;
        try {
          await post('/scene/delete', { id: scene.id });
          say('场景「' + scene.name + '」已删除', 'ok');
          if (activeId === scene.id) setActiveId('');
          await refresh();
        } catch (error) {
          say(msg(error), 'error');
        }
      };

      const onSavedScene = async (scene) => {
        setEditing(null);
        await refresh();
        if (scene && scene.id) setActiveId(scene.id);
      };

      const harnessPanels = active ? active.panels.filter((panel) => panel.type === 'harness') : [];

      useEffect(() => {
        if (!active || !harnessPanels.length) return undefined;
        let alive = true;
        const tick = async () => {
          const next = {};
          for (const panel of harnessPanels) {
            try {
              const value = await get(`/chat/state?sceneId=${encodeURIComponent(active.id)}&panelId=${encodeURIComponent(panel.id)}`);
              next[panel.id] = value || {};
            } catch {
              /* 忽略 */
            }
          }
          if (alive) setSessionState(next);
        };
        void tick();
        const timer = setInterval(tick, 4000);
        return () => {
          alive = false;
          clearInterval(timer);
        };
      }, [active, harnessPanels.map((panel) => panel.id).join(',')]);

      return h('div', { className: 'pm-root' },
        h('style', null, CSS),
        h('header', { className: 'pm-top' },
          h('div', { className: 'pm-brand' },
            h('span', { className: 'pm-brand-mark' }, h(PanelIcon, null)),
            h('span', { className: 'pm-brand-name' }, '大肥鱼'),
            snapshot && snapshot.version ? h('span', { className: 'pm-brand-version' }, `v${snapshot.version.version}`) : null),
          h('div', { className: 'pm-tabs' },
            scenes.map((scene) => h('div', {
              key: scene.id,
              className: cx('pm-tab-wrap', scene.id === activeId && 'is-active')
            },
              h('button', {
                type: 'button',
                title: `${scene.name}${scene.description ? ' · ' + scene.description : ''}`,
                className: cx('pm-tab', scene.id === activeId && 'is-active'),
                onClick: () => void switchScene(scene.id)
              }, scene.name),
              h('button', {
                type: 'button',
                className: 'pm-tab-x',
                title: '删除这个场景（只删配置，不动文件）',
                onClick: (event) => { event.stopPropagation(); void deleteScene(scene); }
              }, '×'))),
            scenes.length ? null : h('span', { className: 'pm-tabs-empty' }, '还没有场景'),
            h('button', { type: 'button', className: 'pm-tab is-add', title: '新建场景', onClick: () => setCreating(true) }, '＋')),
          h('div', { className: 'pm-top-actions' },
            h('button', { type: 'button', className: 'pm-btn is-mini', disabled: busy, onClick: () => void refresh() }, busy ? '刷新中…' : '⟳ 刷新'),
            h('button', { type: 'button', className: 'pm-btn is-mini', disabled: !active, onClick: () => setEditing(active) }, '编辑场景'),
            h('button', { type: 'button', className: 'pm-btn is-mini', onClick: () => setShowingVersion(true) }, '版本'))),
        error ? h('div', { className: 'pm-error' }, error) : null,
        active
          ? h(SceneGrid, { scene: active, selection, onPick: setSelection, say, sessionState })
          : h('div', { className: 'pm-empty-scene' },
            h(Empty, { title: busy ? '正在读场景…' : '还没有场景', hint: '点右上「＋」建一个：给它起个名字、指一个目录，就能开会话干活了' })),
        h(Toast, { toast }),
        h(SceneEditor, { scene: editing, onClose: () => setEditing(null), onSaved: onSavedScene, say }),
        creating ? h(NewSceneForm, { onClose: () => setCreating(false), onCreated: onSavedScene, say }) : null,
        showingVersion ? h(VersionPanel, { onClose: () => setShowingVersion(false), say }) : null);
    }

    /* ------------------------------------------------------------------ 样式 */

    const CSS = [
      '.pm-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;}',
      '.pm-top{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto;}',
      '.pm-brand{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-brand-primary);font-weight:600;}',
      '.pm-brand-mark{display:inline-flex;align-items:center;}',
      '.pm-brand-version{font-size:11px;color:var(--dsw-alias-label-caption);font-weight:400;}',
      '.pm-tabs{display:inline-flex;align-items:center;gap:4px;padding:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);flex-wrap:wrap;}',
      '.pm-tab{border:0;background:transparent;color:var(--dsw-alias-label-secondary);height:26px;padding:0 10px;border-radius:var(--dsw-radius-sm);cursor:pointer;font-size:12.5px;transition:background-color .12s,color .12s;}',
      '.pm-tab:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.pm-tab.is-active{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv1);}',
      '.pm-tab.is-add{color:var(--dsw-alias-label-caption);width:26px;padding:0;}',
      '.pm-tabs-empty{font-size:12px;color:var(--dsw-alias-label-caption);padding:0 6px;}',
      '.pm-tab-wrap{display:inline-flex;align-items:center;border-radius:var(--dsw-radius-sm);}',
      '.pm-tab-wrap:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.pm-tab-wrap .pm-tab{padding-right:6px;}',
      '.pm-tab-x{border:0;background:transparent;color:var(--dsw-alias-label-caption);width:18px;height:18px;line-height:1;border-radius:4px;cursor:pointer;font-size:12px;opacity:.45;transition:opacity .12s,background-color .12s,color .12s;}',
      '.pm-tab-wrap:hover .pm-tab-x{opacity:1;}',
      '.pm-tab-x:hover{background:var(--dsw-alias-state-error-primary);color:#fff;}',
      '.pm-top-actions{margin-left:auto;display:flex;align-items:center;gap:6px;}',
      '.pm-grid{display:grid;flex:1 1 auto;min-height:0;gap:8px;padding:8px 10px 10px;}',
      '.pm-cell{min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;}',
      '.pm-pane{display:flex;flex-direction:column;min-height:0;min-width:0;height:100%;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);overflow:hidden;}',
      '.pm-pane-head{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto;background:var(--dsw-alias-bg-layer-2);}',
      '.pm-pane-title{display:flex;align-items:center;gap:6px;font-weight:600;font-size:12.5px;min-width:0;}',
      '.pm-pane-title-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:320px;}',
      '.pm-pane-hint{font-weight:400;color:var(--dsw-alias-label-caption);font-size:11.5px;}',
      '.pm-pane-actions{margin-left:auto;display:flex;align-items:center;gap:4px;}',
      '.pm-pane-dot{width:7px;height:7px;border-radius:999px;background:var(--dsw-alias-label-caption);flex:0 0 auto;}',
      '.pm-pane-dot.is-harness{background:var(--dsw-alias-brand-primary);}',
      '.pm-pane-dot.is-file{background:var(--dsw-alias-state-success-primary);}',
      '.pm-pane-dot.is-view{background:var(--dsw-alias-state-business-primary);}',
      '.pm-pane-dot.is-web{background:var(--dsw-alias-state-warn-primary);}',
      '.pm-pane-dot.is-note{background:var(--dsw-alias-state-done-primary);}',
      '.pm-btn{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 10px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px;transition:background-color .12s,border-color .12s;}',
      '.pm-btn:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.pm-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;}',
      '.pm-btn:disabled{opacity:.45;cursor:default;}',
      '.pm-btn.is-primary{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 82%, var(--dsw-alias-label-primary));border-color:transparent;color:var(--dsw-alias-bg-base);font-weight:600;}',
      '.pm-btn.is-primary:hover{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, var(--dsw-alias-label-primary));}',
      '.pm-btn.is-ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary);}',
      '.pm-btn.is-ghost:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.pm-btn.is-danger{color:var(--dsw-alias-state-error-primary);}',
      '.pm-btn.is-mini{height:24px;padding:0 8px;font-size:11.5px;}',
      '.pm-tree{flex:1 1 auto;min-height:0;overflow:auto;padding:6px;}',
      '.pm-tree-row{display:flex;align-items:center;gap:5px;width:100%;border:0;background:transparent;color:inherit;text-align:left;padding:4px 6px;border-radius:var(--dsw-radius-sm);cursor:pointer;font-size:12.5px;transition:background-color .12s;}',
      '.pm-tree-row:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.pm-tree-row.is-active{background:var(--dsw-alias-bg-layer-3);}',
      '.pm-tree-row.is-dir{font-weight:500;}',
      '.pm-tree-caret{width:12px;color:var(--dsw-alias-label-caption);}',
      '.pm-tree-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pm-tree-kind{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-caption);}',
      '.pm-tree-loading{padding:12px;color:var(--dsw-alias-label-caption);}',
      '.pm-tree-error{padding:10px;color:var(--dsw-alias-state-error-primary);font-size:12px;}',
      '.pm-view-text{flex:1 1 auto;display:flex;flex-direction:column;min-height:0;}',
      '.pm-view-textarea{flex:1 1 auto;min-height:0;resize:none;border:0;outline:none;padding:10px 12px;background:transparent;color:inherit;font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:12.5px;line-height:1.6;}',
      '.pm-view-foot{flex:0 0 auto;padding:4px 12px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-caption);font-size:11px;}',
      '.pm-view-md{flex:1 1 auto;overflow:auto;padding:12px 16px;}',
      '.pm-md p,.pm-md ul,.pm-md pre,.pm-md blockquote{margin:0 0 8px;}',
      '.pm-md h1,.pm-md h2,.pm-md h3,.pm-md h4{margin:12px 0 6px;line-height:1.35;}',
      '.pm-md h1{font-size:19px;}.pm-md h2{font-size:16px;}.pm-md h3{font-size:14px;}.pm-md h4{font-size:13px;}',
      '.pm-md code{background:var(--dsw-alias-bg-layer-2);padding:1px 4px;border-radius:4px;font-size:12px;}',
      '.pm-md-pre{background:var(--dsw-alias-bg-layer-2);padding:8px 10px;border-radius:var(--dsw-radius-sm);overflow:auto;}',
      '.pm-md-quote{border-left:2px solid var(--dsw-alias-border-l2);padding-left:8px;color:var(--dsw-alias-label-secondary);}',
      '.pm-view-image{flex:1 1 auto;min-height:0;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:10px;}',
      '.pm-view-image img{max-width:100%;height:auto;}',
      '.pm-view-pdf{flex:1 1 auto;min-height:0;border:0;width:100%;background:#fff;}',
      '.pm-preview{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;}',
      '.pm-preview-bar{display:flex;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11.5px;color:var(--dsw-alias-label-caption);}',
      '.pm-preview-spacer{flex:1 1 auto;}',
      '.pm-preview-pages{flex:1 1 auto;min-height:0;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:10px;}',
      '.pm-preview-page{width:100%;height:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:#fff;}',
      '.pm-preview-loading,.pm-view-loading{flex:1 1 auto;display:flex;align-items:center;justify-content:center;gap:8px;color:var(--dsw-alias-label-caption);}',
      '.pm-preview-error{padding:16px;display:flex;flex-direction:column;gap:6px;}',
      '.pm-preview-error-title{font-weight:600;color:var(--dsw-alias-state-error-primary);}',
      '.pm-preview-error-actions{display:flex;gap:6px;margin-top:6px;}',
      '.pm-web-wrap{flex:1 1 auto;min-height:0;overflow:hidden;position:relative;}',
      '.pm-web-frame{border:0;transform-origin:0 0;background:#fff;}',
      '.pm-blocked{padding:16px;display:flex;flex-direction:column;gap:6px;}',
      '.pm-blocked-title{font-weight:600;}',
      '.pm-blocked-text{color:var(--dsw-alias-label-secondary);font-size:12px;max-width:520px;}',
      '.pm-blocked-actions{display:flex;gap:6px;margin-top:4px;}',
      '.pm-note-textarea{flex:1 1 auto;min-height:0;resize:none;border:0;outline:none;padding:10px 12px;background:transparent;color:inherit;font-size:12.5px;line-height:1.65;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}',
      '.pm-layer-tabs{display:flex;gap:2px;padding:6px 8px 0;border-bottom:1px solid var(--dsw-alias-border-l1);}',
      '.pm-layer-tab{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:18px;padding:4px 9px;border-radius:var(--dsw-radius-sm) var(--dsw-radius-sm) 0 0;cursor:pointer;transition:background-color .12s,color .12s;}',
      '.pm-layer-tab:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);}',
      '.pm-layer-tab.is-active{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 -2px 0 var(--dsw-alias-brand-primary);}',
      '.pm-layer-body{flex:1 1 auto;min-height:0;display:flex;}',
      '.pm-layer-list{flex:0 0 128px;min-height:0;overflow:auto;border-right:1px solid var(--dsw-alias-border-l1);padding:6px;display:flex;flex-direction:column;gap:2px;}',
      '.pm-layer-item{appearance:none;border:0;background:transparent;text-align:left;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:18px;padding:5px 7px;border-radius:var(--dsw-radius-sm);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background-color .12s,color .12s;}',
      '.pm-layer-item:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);}',
      '.pm-layer-item.is-active{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:500;}',
      '.pm-layer-empty{padding:6px 7px;font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-layer-new{display:flex;gap:4px;margin-top:auto;padding-top:6px;}',
      '.pm-layer-new-input{flex:1 1 auto;min-width:0;font-size:11px;height:24px;padding:0 6px;}',
      '.pm-layer-textarea{padding:8px 10px;}',
      '.pm-reserved-body{flex:1 1 auto;margin:8px;padding:12px;border:1.5px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);display:flex;flex-direction:column;justify-content:center;gap:6px;}',
      '.pm-reserved-title{font-weight:600;font-size:12.5px;color:var(--dsw-alias-label-secondary);}',
      '.pm-reserved-text{font-size:12px;color:var(--dsw-alias-label-secondary);}',
      '.pm-reserved-hint{font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-chat-feed{flex:1 1 auto;min-height:0;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:8px;}',
      '.pm-chat-empty{flex:1 1 auto;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-caption);font-size:12px;padding:12px;text-align:center;}',
      '.pm-bubble{border-radius:var(--dsw-radius-md);padding:7px 9px;max-width:100%;background:var(--dsw-alias-bg-layer-2);}',
      '.pm-bubble.is-user{background:var(--dsw-alias-bg-layer-3);align-self:flex-end;max-width:88%;}',
      '.pm-bubble.is-assistant{align-self:flex-start;max-width:94%;}',
      '.pm-bubble-role{font-size:10.5px;color:var(--dsw-alias-label-caption);margin-bottom:3px;display:flex;gap:6px;}',
      '.pm-bubble-body{font-size:12.5px;line-height:1.6;word-break:break-word;}',
      '.pm-chat-running{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-caption);font-size:11.5px;}',
      '.pm-notices{flex:0 0 auto;padding:4px 10px;display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--dsw-alias-border-l1);}',
      '.pm-notice{font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-composer{position:relative;flex:0 0 auto;border-top:1px solid var(--dsw-alias-border-l1);padding:6px 8px 8px;display:flex;flex-direction:column;gap:5px;background:var(--dsw-alias-bg-layer-1);}',
      '.pm-composer-input{width:100%;box-sizing:border-box;resize:none;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:inherit;padding:6px 8px;font-size:12.5px;line-height:1.5;outline:none;}',
      '.pm-composer-input:focus{border-color:var(--dsw-alias-brand-primary);}',
      '.pm-composer-bar{display:flex;align-items:center;gap:6px;}',
      '.pm-composer-left,.pm-composer-right{display:flex;align-items:center;gap:4px;}',
      '.pm-composer-right{margin-left:auto;}',
      '.pm-chip-btn{height:22px;padding:0 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:background-color .12s,color .12s;}',
      '.pm-chip-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.pm-chip-btn.is-model{color:var(--dsw-alias-brand-primary);border-color:transparent;}',
      '.pm-send{width:28px;height:22px;border-radius:999px;border:0;background:var(--dsw-alias-brand-primary);color:#fff;cursor:pointer;font-size:13px;}',
      '.pm-send:disabled{opacity:.4;}',
      '.pm-picker{position:absolute;left:8px;right:8px;bottom:calc(100% - 4px);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);box-shadow:var(--dsw-shadow-lv2);overflow:hidden;z-index:20;}',
      '.pm-picker-title{font-size:11px;color:var(--dsw-alias-label-caption);padding:6px 10px 2px;}',
      '.pm-picker-list{max-height:180px;overflow:auto;}',
      '.pm-picker-item{display:flex;align-items:baseline;gap:8px;width:100%;border:0;background:transparent;color:inherit;text-align:left;padding:5px 10px;cursor:pointer;font-size:12px;}',
      '.pm-picker-item.is-active,.pm-picker-item:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.pm-picker-name{font-weight:500;}',
      '.pm-picker-path{color:var(--dsw-alias-label-caption);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pm-session-list{flex:0 0 auto;max-height:200px;overflow:auto;border-bottom:1px solid var(--dsw-alias-border-l1);padding:6px 8px;display:flex;flex-direction:column;gap:4px;background:var(--dsw-alias-bg-layer-2);}',
      '.pm-session-head{font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-session-item{display:flex;align-items:center;gap:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:var(--dsw-radius-sm);padding:4px 8px;cursor:pointer;color:inherit;font-size:12px;text-align:left;}',
      '.pm-session-item.is-active{border-color:var(--dsw-alias-brand-primary);}',
      '.pm-session-id{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-caption);}',
      '.pm-session-empty{font-size:11.5px;color:var(--dsw-alias-label-caption);}',
      '.pm-session-row{display:flex;align-items:center;gap:4px;}',
      '.pm-session-row .pm-session-item{flex:1 1 auto;min-width:0;}',
      '.pm-session-row.is-active .pm-session-item{border-color:var(--dsw-alias-brand-primary);}',
      '.pm-session-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pm-claim-hint{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-caption);padding:4px 10px 0;}',
      '.pm-form-hint{font-size:11px;color:var(--dsw-alias-label-caption);margin-top:6px;}',
      '.pm-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:100%;padding:18px;color:var(--dsw-alias-label-caption);text-align:center;}',
      '.pm-empty-title{font-size:12.5px;color:var(--dsw-alias-label-secondary);}',
      '.pm-empty-hint{font-size:11.5px;}',
      '.pm-empty-scene{flex:1 1 auto;display:flex;align-items:center;justify-content:center;}',
      '.pm-error{margin:8px 10px 0;padding:6px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);font-size:12px;}',
      '.pm-toast{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);padding:6px 12px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-shadow-lv2);font-size:12px;z-index:40;max-width:70%;}',
      '.pm-toast.is-error{color:var(--dsw-alias-state-error-primary);}',
      '.pm-spinner{width:12px;height:12px;border-radius:999px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);display:inline-block;animation:pm-spin .8s linear infinite;}',
      '.pm-spinner.is-large{width:18px;height:18px;}',
      '@keyframes pm-spin{to{transform:rotate(360deg);}}',
      '.pm-modal{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px;}',
      '.pm-modal-card{width:min(560px,94vw);max-height:86vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);box-shadow:var(--dsw-shadow-lv3);overflow:hidden;}',
      '.pm-modal-card.is-wide{width:min(860px,94vw);}',
      '.pm-modal-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);}',
      '.pm-modal-title{margin:0;font-size:13.5px;}',
      '.pm-modal-close{margin-left:auto;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:16px;cursor:pointer;}',
      '.pm-modal-body{padding:12px 14px;overflow:auto;min-height:0;display:flex;flex-direction:column;gap:8px;}',
      '.pm-modal-foot{display:flex;justify-content:flex-end;gap:6px;padding:8px 14px;border-top:1px solid var(--dsw-alias-border-l1);}',
      '.pm-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}',
      '.pm-field{display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--dsw-alias-label-secondary);}',
      '.pm-input{height:28px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:inherit;padding:0 8px;font-size:12.5px;outline:none;}',
      '.pm-input:focus{border-color:var(--dsw-alias-brand-primary);}',
      '.pm-form-hint{font-size:11.5px;color:var(--dsw-alias-label-caption);}',
      '.pm-code-textarea{width:100%;box-sizing:border-box;height:340px;resize:vertical;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:inherit;padding:8px;font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.5;outline:none;}',
      '.pm-version{display:flex;flex-direction:column;gap:10px;}',
      '.pm-version-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}',
      '.pm-version-name{font-size:15px;font-weight:600;}',
      '.pm-version-sub{font-size:11.5px;color:var(--dsw-alias-label-caption);}',
      '.pm-version-path{font-size:10.5px;color:var(--dsw-alias-label-caption);word-break:break-all;max-width:46%;text-align:right;}',
      '.pm-repo{display:flex;gap:6px;align-items:center;}',
      '.pm-repo .pm-input{flex:1 1 auto;min-width:0;}',
      '.pm-version-block{display:flex;flex-direction:column;gap:4px;}',
      '.pm-version-block-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);}',
      '.pm-version-error{font-size:11.5px;color:var(--dsw-alias-state-error-primary);}',
      '.pm-commit{display:flex;align-items:baseline;gap:8px;font-size:11.5px;}',
      '.pm-commit-hash{font-family:ui-monospace,Consolas,monospace;color:var(--dsw-alias-state-business-primary);}',
      '.pm-commit-subject{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pm-commit-meta{margin-left:auto;color:var(--dsw-alias-label-caption);white-space:nowrap;}',
      '.pm-log-item{border-left:2px solid var(--dsw-alias-border-l2);padding-left:8px;display:flex;flex-direction:column;gap:2px;}',
      '.pm-log-head{display:flex;gap:6px;align-items:baseline;font-size:12px;}',
      '.pm-log-version{font-weight:600;}',
      '.pm-log-title{color:var(--dsw-alias-label-secondary);}',
      '.pm-log-date{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-caption);}',
      '.pm-log-changes{margin:2px 0 0;padding-left:16px;font-size:11.5px;color:var(--dsw-alias-label-caption);}',
      '.pm-history-row{display:flex;align-items:center;gap:8px;font-size:11.5px;}',
      '.pm-history-main{display:flex;gap:8px;align-items:baseline;}',
      '.pm-history-version{font-weight:600;}',
      '.pm-history-kind{color:var(--dsw-alias-label-caption);}',
      '.pm-history-at{color:var(--dsw-alias-label-caption);}',
      '.pm-history-row .pm-btn{margin-left:auto;}',
      '.pm-zoom-label{font-size:11px;color:var(--dsw-alias-label-caption);min-width:34px;text-align:center;}',
      '.pm-scroll::-webkit-scrollbar{width:5px;height:5px;}',
      '.pm-scroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l1);border-radius:999px;}',
      '.pm-scroll::-webkit-scrollbar-track{background:transparent;}'
    ].join('\n');

    /* --------------------------------------------------------------- 注册 */

    return {
      inject: ['slots'],
      apply(ctx) {
        const Entry = (props) => h(Workbench, props);
        try {
          ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Entry));
          ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 5,
            label: () => '大肥鱼'
          }, PanelIcon));
        } catch (error) {
          console.error('[dafeiyu] 注册面板失败', error);
        }
      }
    };
  }
});
