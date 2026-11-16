/**
 * 大肥鱼 3.0 · 场景化工作台（Host 侧）
 *
 * 一个场景 = 一份 JSON + 一套文档 + 一条常驻 AI 会话：
 *   scenarios/<id>.json         面板网格（id/name/description/root/panels）
 *   scenes/<id>/定位卡.md        职责 / 资产 / 触发词 / 铁律
 *   scenes/<id>/场景记忆.md      §〇 交接 + 长期决策
 *   scenes/身份索引.md           面板 ↔ 会话（唯一权威）
 *
 * 面板类型：harness / file / view / web / note / reserved。
 * 职责：场景读写、文件读写与预览、会话与输入框增强、版本接口。
 */

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fsp, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const name = 'dafeiyu';
export const inject = ['webServer'];

const API_BASE = '/dafeiyu/api';
const BODY_LIMIT = 4 * 1024 * 1024;
const TEXT_LIMIT = 1024 * 1024;
const TREE_LIMIT = 900;
const SCENE_LIMIT = 60;
const PANEL_TYPES = ['harness', 'file', 'view', 'web', 'note', 'reserved'];
const NOTE_SOURCES = ['context', 'memory'];

const PREVIEW_DPI = 110;
const PREVIEW_MAX_PAGES = 20;
const PREVIEW_TIMEOUT = 180000;
const PREVIEW_MAX_AGE = 14 * 24 * 60 * 60 * 1000;
const PREVIEW_MAX_PIXELS = 16 * 1024 * 1024;
const PREVIEW_MAX_DIMENSION = 8192;
const PREVIEW_MAX_BYTES = 24 * 1024 * 1024;

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.avif']);
const OFFICE_EXT = new Set(['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.xlsm', '.docm', '.pptm', '.vsdx']);
const TEXT_EXT = new Set([
  '.md', '.markdown', '.txt', '.json', '.jsonc', '.csv', '.tsv', '.yml', '.yaml', '.log', '.ini', '.conf',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.scss', '.less', '.html', '.htm', '.xml', '.svg',
  '.py', '.go', '.rs', '.java', '.cs', '.php', '.rb', '.sh', '.ps1', '.bat', '.cmd', '.sql', '.toml', '.env'
]);
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.avif': 'image/avif', '.pdf': 'application/pdf'
};
const SKIP_DIRS = new Set(['.git', 'node_modules', '.dsh', '__pycache__', '.venv', 'dist', 'build', '.next', 'target']);

const DATA_DIR_NAME = 'dafeiyu';
const LEGACY_DATA_DIR_NAMES = ['pm-workbench'];
const SCENARIO_DIR_NAME = 'scenarios';
const SCENE_DIR_NAME = 'scenes';
const CONTEXT_FILE = '定位卡.md';
const MEMORY_FILE = '场景记忆.md';
const INDEX_FILE = '身份索引.md';

function dataRoot() {
  const explicit = process.env.DAFEIYU_HOME || process.env.PM_WORKBENCH_HOME;
  if (explicit && explicit.trim()) return path.resolve(explicit.trim());
  const home = process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME.trim()) : path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh');
  return path.join(home, DATA_DIR_NAME);
}

function packageDir() {
  return fileURLToPath(new URL('.', import.meta.url));
}

function packageVersionFile() {
  return path.join(packageDir(), 'version.json');
}

const scenarioDirOf = (root) => path.join(root, SCENARIO_DIR_NAME);
const sceneDocDirOf = (root, id) => path.join(root, SCENE_DIR_NAME, id);
const sceneContextFile = (root, id) => path.join(sceneDocDirOf(root, id), CONTEXT_FILE);
const sceneMemoryFile = (root, id) => path.join(sceneDocDirOf(root, id), MEMORY_FILE);
const sceneIndexFile = (root) => path.join(root, SCENE_DIR_NAME, INDEX_FILE);

async function migrateLegacyData(root) {
  const hasState = existsSync(path.join(root, 'state.json'));
  const hasScenes = existsSync(scenarioDirOf(root));
  if (hasState || hasScenes) return false;
  for (const legacyName of LEGACY_DATA_DIR_NAMES) {
    const legacy = path.join(path.dirname(root), legacyName);
    if (!existsSync(legacy)) continue;
    try {
      await fsp.mkdir(root, { recursive: true });
      await fsp.cp(legacy, root, { recursive: true, force: false, errorOnExist: false });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ 通用工具 */

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}

function cleanText(value, limit, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  if (!text) return fallback;
  if (/^[?\uFF1F\s]+$/.test(text)) return fallback;
  return text.slice(0, limit);
}

function clampInt(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder('gb18030').decode(buffer);
    } catch {
      return buffer.toString('utf8');
    }
  }
}

function kindOf(abs) {
  const ext = path.extname(abs || '').toLowerCase();
  if (IMAGE_EXT.has(ext) || MIME[ext]) return ext === '.pdf' ? 'pdf' : 'image';
  if (OFFICE_EXT.has(ext)) return 'office';
  if (TEXT_EXT.has(ext)) return 'text';
  return 'unknown';
}

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text)
  });
  res.end(text);
}

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > BODY_LIMIT) throw fail(413, 'TOO_LARGE', '请求体太大了');
    chunks.push(chunk);
  }
  if (!chunks.length) return '';
  return Buffer.concat(chunks).toString('utf8');
}

function isTrustedLoopback(req) {
  const host = String(req.headers.host || '');
  const remote = String(req.socket && req.socket.remoteAddress || '');
  const localHost = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host);
  const localRemote = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  return localHost && localRemote;
}

function openWithSystem(abs) {
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', '', abs], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return;
  }
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(opener, [abs], { detached: true, stdio: 'ignore' }).unref();
}

function openUrlInBrowser(url) {
  let target = String(url || '').trim();
  if (!target) return false;
  if (!/^https?:\/\//i.test(target)) target = `https://${target.replace(/^\/+/, '')}`;
  if (process.platform === 'win32') {
    spawn('explorer.exe', [target], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return true;
  }
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(opener, [target], { detached: true, stdio: 'ignore' }).unref();
  return true;
}

/* -------------------------------------------------------------- 场景存储 */

function normalizePanel(raw, index) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const type = PANEL_TYPES.includes(input.type) ? input.type : 'reserved';
  const panel = {
    id: cleanText(input.id, 60, `p${index + 1}`),
    title: cleanText(input.title, 40, `面板 ${index + 1}`),
    type,
    sub: cleanText(input.sub, 160, ''),
    col: clampInt(input.col, index + 1, 1, 12),
    row: clampInt(input.row, 1, 1, 60),
    w: clampInt(input.w, 2, 1, 12),
    h: clampInt(input.h, 2, 1, 60)
  };
  if (input.expand) panel.expand = true;
  if (type === 'web') {
    panel.url = cleanText(input.url, 2000, '');
    panel.failHint = cleanText(input.failHint, 300, '');
  }
  if (type === 'note') {
    panel.source = NOTE_SOURCES.includes(input.source) ? input.source : 'memory';
  }
  if (type === 'file' || type === 'view') {
    panel.root = cleanText(input.root, 500, '');
    panel.home = cleanText(input.home, 500, '');
    panel.viewPanel = cleanText(input.viewPanel, 60, '');
    panel.filesPanel = cleanText(input.filesPanel, 60, '');
  }
  if (type === 'harness') {
    panel.sessionId = cleanText(input.sessionId, 200, '');
    panel.sessionTitle = cleanText(input.sessionTitle, 80, '');
    panel.pinTarget = cleanText(input.pinTarget, 120, '');
  }
  return panel;
}

function normalizeScene(raw, fallbackId) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const id = cleanText(input.id, 60, fallbackId || newId('scene')).replace(/[^\w.\-]/g, '-');
  const panels = (Array.isArray(input.panels) ? input.panels : []).slice(0, 24).map(normalizePanel);
  const cols = clampInt(input.cols, Math.min(4, Math.max(...panels.map((p) => p.col + p.w - 1), 1)), 1, 12);
  const rows = Math.max(...panels.map((p) => p.row + p.h - 1), 1);
  return {
    id,
    name: cleanText(input.name, 40, id),
    description: cleanText(input.description, 240, ''),
    root: typeof input.root === 'string' ? input.root.trim().slice(0, 500) : '',
    cols,
    rows,
    panels
  };
}

function sceneSourceDirs(root) {
  return [
    { dir: path.join(packageDir(), SCENARIO_DIR_NAME), source: 'package' },
    { dir: scenarioDirOf(root), source: 'data' }
  ];
}

async function readScenes(root) {
  const found = new Map();
  for (const { dir, source } of sceneSourceDirs(root)) {
    if (!existsSync(dir)) continue;
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
      const file = path.join(dir, entry.name);
      let parsed = null;
      try {
        parsed = JSON.parse(decodeText(await fsp.readFile(file)));
      } catch {
        continue;
      }
      const scene = normalizeScene(parsed, entry.name.replace(/\.json$/i, ''));
      scene.source = source;
      scene.file = file;
      found.set(scene.id, scene);
      if (found.size >= SCENE_LIMIT) break;
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function readScene(root, id) {
  const scenes = await readScenes(root);
  return scenes.find((scene) => scene.id === id) || null;
}

async function writeScene(root, scene) {
  const dir = scenarioDirOf(root);
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${scene.id}.json`);
  const payload = {
    id: scene.id,
    name: scene.name,
    description: scene.description,
    root: scene.root || '',
    cols: scene.cols,
    panels: scene.panels
  };
  await fsp.writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return file;
}

function contextTemplate(scene) {
  return `# 定位卡 · ${scene.name}\n\n> 场景 id：\`${scene.id}\`｜根目录：\`${scene.root || '（未设，文件/预览面板不可用）'}\`\n\n## 职责\n- 这类活是做什么的：\n- 我会反复回来做什么：\n\n## 资产\n- 项目目录：\`${scene.root || '（待填）'}\`\n- 产出物写到哪：\n\n## 触发词\n\n## 铁律\n- 不改与本场景无关的东西；\n- 先看记忆再动手，做完把结论写回记忆。\n\n## 上次进度\n- （日期）\n`;
}

function memoryTemplate(scene) {
  return `# 场景记忆 · ${scene.name}\n\n## §〇 交接\n- 身份：${scene.id}\n- 进度：\n- 下一步：\n- 卡点：\n- 细节在哪：见本文件下方与定位卡\n\n## 长期决策与坑\n`;
}

async function ensureSceneDocs(root, scene) {
  const dir = sceneDocDirOf(root, scene.id);
  await fsp.mkdir(dir, { recursive: true });
  const context = sceneContextFile(root, scene.id);
  const memory = sceneMemoryFile(root, scene.id);
  if (!existsSync(context)) await fsp.writeFile(context, contextTemplate(scene), 'utf8');
  if (!existsSync(memory)) await fsp.writeFile(memory, memoryTemplate(scene), 'utf8');
  return { context, memory };
}

async function readSceneDocs(root, scene) {
  const paths = await ensureSceneDocs(root, scene);
  const context = decodeText(await fsp.readFile(paths.context));
  const memory = decodeText(await fsp.readFile(paths.memory));
  return { context, memory };
}

async function sceneIndex(root) {
  const lock = sceneIndexFile(root);
  await fsp.mkdir(path.dirname(lock), { recursive: true });
  if (!existsSync(lock)) {
    await fsp.writeFile(lock, '# 场景身份索引\n\n| 场景 | 面板 | 会话 id | 会话标题 | 定位卡 | 场景记忆 |\n| --- | --- | --- | --- | --- | --- |\n', 'utf8');
  }
  return lock;
}

async function updateSceneIndex(root, scene, panel, sessionId) {
  const file = await sceneIndex(root);
  const rows = decodeText(await fsp.readFile(file)).split(/\r?\n/);
  const hit = (line) => line.startsWith(`| ${scene.name} `) || line.includes(`| ${scene.id} `);
  const row = `| ${scene.name} | ${panel.title} | ${sessionId || '（未绑定）'} | ${panel.sessionTitle || scene.name} | scenes/${scene.id}/${CONTEXT_FILE} | scenes/${scene.id}/${MEMORY_FILE} |`;
  const kept = rows.filter((line) => !hit(line) && !line.includes(`| ${panel.id} |`));
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  kept.push(row, '');
  await fsp.writeFile(file, `${kept.join('\n')}\n`, 'utf8');
}

/* ---------------------------------------------------------------- 文件 API */

function sceneRootOf(scene, panel) {
  const raw = (panel && panel.root) || (scene && scene.root) || '';
  return raw ? path.resolve(raw) : '';
}

function resolveInside(rootAbs, rel) {
  if (!rootAbs) throw fail(400, 'NO_ROOT', '这个场景还没设根目录（场景 JSON 里的 root）');
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(rootAbs, clean);
  const relCheck = path.relative(rootAbs, abs);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) throw fail(403, 'OUT_OF_ROOT', '不能访问场景根目录以外的文件');
  return abs;
}

function relOf(rootAbs, abs) {
  return path.relative(rootAbs, abs).replace(/\\/g, '/');
}

async function fileInfo(rootAbs, rel) {
  const abs = resolveInside(rootAbs, rel);
  const stat = await fsp.stat(abs);
  const kind = stat.isDirectory() ? 'dir' : kindOf(abs);
  const info = {
    path: relOf(rootAbs, abs) || '.',
    name: path.basename(abs) || path.basename(rootAbs),
    kind,
    size: stat.size,
    mtimeMs: Math.round(stat.mtimeMs)
  };
  if (kind === 'text' && stat.size <= TEXT_LIMIT) {
    info.text = decodeText(await fsp.readFile(abs));
  }
  return info;
}

async function listTree(rootAbs, rel) {
  const abs = resolveInside(rootAbs, rel);
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  const nodes = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const childAbs = path.join(abs, entry.name);
    const childRel = relOf(rootAbs, childAbs);
    let info = null;
    try {
      info = await fsp.stat(childAbs);
    } catch {
      continue;
    }
    nodes.push({
      path: childRel,
      name: entry.name,
      dir: entry.isDirectory(),
      kind: entry.isDirectory() ? 'dir' : kindOf(childAbs),
      size: info.size,
      mtimeMs: Math.round(info.mtimeMs)
    });
    if (nodes.length >= TREE_LIMIT) break;
  }
  nodes.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'zh') : a.dir ? -1 : 1));
  return nodes;
}

async function walkFiles(rootAbs, options = {}) {
  const limit = options.limit || 2000;
  const out = [];
  const queue = [''];
  while (queue.length && out.length < limit) {
    const rel = queue.shift();
    let entries = [];
    try {
      entries = await fsp.readdir(path.join(rootAbs, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) queue.push(childRel);
      else out.push({ path: childRel, kind: kindOf(entry.name) });
    }
  }
  return out;
}

/* ------------------------------------------------------------ 场景文档面板 */

async function readNote(root, scene, panel) {
  await ensureSceneDocs(root, scene);
  const file = panel.source === 'context' ? sceneContextFile(root, scene.id) : sceneMemoryFile(root, scene.id);
  const stat = await fsp.stat(file);
  return { source: panel.source, path: file, text: decodeText(await fsp.readFile(file)), mtimeMs: Math.round(stat.mtimeMs) };
}

async function saveNote(root, scene, panel, text) {
  if (Buffer.byteLength(text, 'utf8') > TEXT_LIMIT) throw fail(413, 'TOO_LARGE', '内容超过 1 MB');
  await ensureSceneDocs(root, scene);
  const file = panel.source === 'context' ? sceneContextFile(root, scene.id) : sceneMemoryFile(root, scene.id);
  await fsp.writeFile(file, text, 'utf8');
  return { ok: true };
}

/* ---------------------------------------------------------------- 文档预览 */

const PREVIEW_EXT = new Set(['.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt', '.xlsm', '.docm', '.pptm']);

let kitPromise = null;
let converterPromise = null;
const previewFlight = new Map();

function engineEntry() {
  const candidates = [];
  const push = (value) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };
  try {
    if (process.resourcesPath) {
      push(path.join(process.resourcesPath, 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'index.js'));
    }
  } catch {
    /* 忽略 */
  }
  try {
    push(path.join(path.dirname(process.execPath), 'resources', 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'index.js'));
  } catch {
    /* 忽略 */
  }
  try {
    const install = process.env.DSH_INSTALL_DIR;
    if (install) {
      const modules = path.dirname(path.dirname(install));
      push(path.join(modules, '@deepseek-ai', 'libreoffice-kit', 'lib', 'index.js'));
      push(path.join(modules, 'libreoffice-kit', 'lib', 'index.js'));
    }
  } catch {
    /* 忽略 */
  }
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      /* 忽略 */
    }
  }
  return null;
}

function loadKit() {
  if (!kitPromise) {
    kitPromise = (async () => {
      const entry = engineEntry();
      if (!entry) throw fail(503, 'ENGINE_MISSING', '找不到内置文档渲染引擎（libreoffice-kit 不在安装目录里）');
      const mod = await import(pathToFileURL(entry).href);
      if (!mod || typeof mod.createConverter !== 'function') {
        throw fail(503, 'ENGINE_MISSING', '内置文档渲染引擎入口不完整（缺少 createConverter）');
      }
      return mod;
    })();
    kitPromise.then(null, () => { kitPromise = null; });
  }
  return kitPromise;
}

function getConverter() {
  if (!converterPromise) {
    converterPromise = (async () => {
      const kit = await loadKit();
      return kit.createConverter({ timeoutMs: PREVIEW_TIMEOUT });
    })();
    converterPromise.then(null, () => { converterPromise = null; });
  }
  return converterPromise;
}

function previewBase(root) {
  return path.join(root, 'preview');
}

async function renderWithOfficeKit(ctx, abs, ext, stat, dir, dpi) {
  let service = null;
  try {
    service = ctx && typeof ctx.get === 'function' ? ctx.get('officeKit') : null;
  } catch {
    service = null;
  }
  if (!service || typeof service.renderImages !== 'function') return null;

  const version = String(Math.round(stat.mtimeMs));
  const result = await service.renderImages({
    extension: ext.replace(/^\./, ''),
    source: {
      key: abs,
      version,
      bytes: stat.size,
      read: async () => ({ bytes: await fsp.readFile(abs), version })
    },
    dpi,
    maxImages: PREVIEW_MAX_PAGES,
    maxPixels: PREVIEW_MAX_PIXELS,
    maxDimension: PREVIEW_MAX_DIMENSION,
    maxBytes: PREVIEW_MAX_BYTES
  });

  const images = Array.isArray(result && result.images) ? result.images : [];
  if (!images.length) return { manifest: null };

  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    backend: String((result && result.backend) || 'officeKit'),
    rasterEngine: 'officeKit',
    source: 'dafeiyu',
    inputPath: abs,
    dpi: Number(result && result.dpi) || dpi,
    pageCount: Number(result && result.pageCount) || images.length,
    missingFonts: Array.isArray(result && result.missingFonts) ? result.missingFonts : [],
    images: []
  };
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const name = `page-${String(index + 1).padStart(4, '0')}.png`;
    const file = path.join(dir, name);
    const bytes = Buffer.from(image.png);
    await fsp.writeFile(file, bytes);
    manifest.images.push({
      index: index + 1,
      page: image.page ?? null,
      sheet: image.sheet ?? null,
      range: image.range ?? null,
      path: file,
      width: Number(image.width) || 0,
      height: Number(image.height) || 0,
      byteLength: bytes.length
    });
  }
  await fsp.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return { manifest };
}

function previewKey(abs, stat, dpi) {
  return createHash('sha1')
    .update(`${abs}|${stat.size}|${Math.round(stat.mtimeMs)}|${dpi}|v3`)
    .digest('hex')
    .slice(0, 20);
}

async function readManifest(dir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

function describeEngineError(error) {
  const message = String((error && (error.message || error)) || error);
  if (/EPIPE|broken pipe|spawn|ENOENT|EACCES/i.test(message)) {
    return `内置渲染引擎启动失败：${message}。可以先用「外部打开」在本机 Office 里查看。`;
  }
  if (/timeout|ETIMEDOUT/i.test(message)) {
    return `渲染超时（文档可能太大）：${message}。可以先用「外部打开」查看。`;
  }
  return `渲染失败：${message}`;
}

function shapePreview(key, manifest, stat) {
  const images = Array.isArray(manifest && manifest.images) ? manifest.images : [];
  return {
    key,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    pageCount: Number(manifest && manifest.pageCount) || images.length,
    dpi: Number(manifest && manifest.dpi) || PREVIEW_DPI,
    backend: String((manifest && manifest.backend) || 'native'),
    missingFonts: Array.isArray(manifest && manifest.missingFonts) ? manifest.missingFonts : [],
    tiles: images.map((image) => ({
      name: path.basename(String(image.path || '')) || `page-${String(image.index || 0).padStart(4, '0')}.png`,
      width: Number(image.width) || 0,
      height: Number(image.height) || 0,
      page: image.page ?? null,
      sheet: image.sheet ?? null,
      range: image.range ?? null
    }))
  };
}

async function renderPreview(ctx, root, rootAbs, rel, refresh) {
  if (!rel) throw fail(400, 'BAD_REQUEST', '要带 path');
  const abs = resolveInside(rootAbs, rel);
  const ext = path.extname(abs).toLowerCase();
  if (!PREVIEW_EXT.has(ext)) throw fail(415, 'NOT_PREVIEWABLE', '这种文件不支持内联预览');
  let stat = null;
  try {
    stat = await fsp.stat(abs);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isFile()) throw fail(404, 'NO_FILE', '文件不存在');

  const key = previewKey(abs, stat, PREVIEW_DPI);
  const dir = path.join(previewBase(root), key);

  if (!refresh) {
    const cached = await readManifest(dir);
    if (cached && Array.isArray(cached.images) && cached.images.length) {
      return { status: 'ready', cached: true, elapsedMs: 0, ...shapePreview(key, cached, stat) };
    }
  }

  const running = previewFlight.get(key);
  if (running) return running;

  const job = (async () => {
    const started = Date.now();
    await fsp.mkdir(previewBase(root), { recursive: true });
    if (refresh) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});

    let manifest = null;
    let serviceError = null;
    try {
      const viaService = await renderWithOfficeKit(ctx, abs, ext, stat, dir, PREVIEW_DPI);
      if (viaService && viaService.manifest) manifest = viaService.manifest;
    } catch (error) {
      serviceError = error;
    }

    if (!manifest) {
      try {
        const converter = await getConverter();
        if (typeof converter.renderImages !== 'function') {
          throw fail(503, 'ENGINE_INCOMPLETE', '内置渲染引擎不支持图片渲染（renderImages）');
        }
        manifest = await converter.renderImages({
          inputPath: abs,
          outputDir: dir,
          dpi: PREVIEW_DPI,
          maxPages: PREVIEW_MAX_PAGES
        });
      } catch (error) {
        if (error && error.code && error.status) throw error;
        throw fail(502, 'RENDER_FAILED', describeEngineError(serviceError || error));
      }
    }
    if (!manifest || !Array.isArray(manifest.images) || !manifest.images.length) {
      throw fail(502, 'RENDER_EMPTY', '引擎没有渲染出任何页面（文档可能是空的）');
    }
    return { status: 'ready', cached: false, elapsedMs: Date.now() - started, ...shapePreview(key, manifest, stat) };
  })();

  previewFlight.set(key, job);
  try {
    return await job;
  } finally {
    previewFlight.delete(key);
  }
}

async function prunePreviews(root) {
  let entries = [];
  try {
    entries = await fsp.readdir(previewBase(root), { withFileTypes: true });
  } catch {
    return;
  }
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(previewBase(root), entry.name);
    try {
      const stat = await fsp.stat(dir);
      if (now - stat.mtimeMs > PREVIEW_MAX_AGE) await fsp.rm(dir, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  }
}

/* ------------------------------------------------- 会话 / 对话 / 输入框增强 */

function serviceOf(ctx, serviceName) {
  try {
    const service = ctx.get(serviceName);
    return service && typeof service === 'object' ? service : null;
  } catch {
    return null;
  }
}

function sessionControllerOf(ctx) {
  const service = serviceOf(ctx, 'sessionController');
  return service && typeof service.prompt === 'function' ? service : null;
}

function requireController(ctx) {
  const service = sessionControllerOf(ctx);
  if (!service) throw fail(501, 'NO_CONTROLLER', '当前 DSH 版本没有 sessionController，面板内对话不可用');
  return service;
}

function textFromPart(part) {
  if (!part) return '';
  if (typeof part === 'string') return part;
  const type = String(part.type || part.kind || '');
  if (type && !/^(text|input_text|output_text)$/i.test(type)) return '';
  if (typeof part.text === 'string') return part.text;
  if (typeof part.content === 'string') return part.content;
  return '';
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(textFromPart).filter(Boolean).join('\n').trim();
}

function shapeMessages(raw) {
  const items = [];
  for (const message of raw) {
    if (!message || typeof message !== 'object') continue;
    const role = String(message.role || (message.author && message.author.role) || message.source || '').toLowerCase();
    const normalized = role === 'user' || role === 'human' ? 'user'
      : role === 'assistant' || role === 'agent' ? 'assistant' : '';
    if (!normalized) continue;
    const text = textFromContent(message.content ?? message.parts ?? message.text);
    if (!text) continue;
    if (normalized === 'user' && /^(<system-reminder|Time sampled|The user changed the)/i.test(text.trim())) continue;
    items.push({ role: normalized, text: text.slice(0, 20000), time: Number(message.time || message.createdAt || 0) || 0 });
  }
  return items;
}

async function readMessages(ctx, sessionId, limit) {
  const sessionsService = serviceOf(ctx, 'sessions');
  let raw = null;
  try {
    const session = sessionsService && typeof sessionsService.get === 'function' ? sessionsService.get(sessionId) : null;
    if (session && typeof session.deriveMessages === 'function') raw = session.deriveMessages();
  } catch {
    raw = null;
  }
  if (!Array.isArray(raw)) {
    const controller = sessionControllerOf(ctx);
    if (controller) {
      let page = null;
      try {
        page = await controller.events({ address: { kind: 'session', sessionId }, maxMessages: limit }, new AbortController().signal);
      } catch {
        page = null;
      }
      raw = (page && page.records ? page.records : []).map((record) => {
        const event = (record && record.event) || {};
        const data = event.data || {};
        const role = event.type === 'user/message' ? 'user' : event.type === 'assistant/message' ? 'assistant' : '';
        return role ? { role, content: data.content ?? data.message ?? data, time: event.time } : null;
      }).filter(Boolean);
    }
  }
  return shapeMessages(Array.isArray(raw) ? raw : []).slice(-Math.max(1, limit));
}

async function chatState(ctx, sessionId) {
  const controller = sessionControllerOf(ctx);
  if (!controller || !sessionId) return { running: false, active: false, queued: 0 };
  try {
    const state = await controller.state({ sessionId }, new AbortController().signal);
    return {
      running: Boolean(state && state.running),
      active: Boolean(state && state.active),
      queued: Array.isArray(state && state.queue) ? state.queue.length : 0
    };
  } catch {
    return { running: false, active: false, queued: 0 };
  }
}

async function sendChat(ctx, sessionId, text) {
  const controller = requireController(ctx);
  const requestId = `dfy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await controller.prompt({
    requestId,
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text }],
    clientTimeZone: 'Asia/Shanghai'
  }, new AbortController().signal);
  return { accepted: true, requestId };
}

function sessionKey(sceneId, panelId) {
  return `${sceneId}/${panelId}`;
}

function boundSessionOf(state, scene, panel) {
  const key = sessionKey(scene.id, panel.id);
  const stored = state.settings && state.settings.sessions ? state.settings.sessions[key] : '';
  return String(stored || panel.sessionId || '');
}

async function listSessions(ctx) {
  const controller = sessionControllerOf(ctx);
  if (!controller) return [];
  const out = [];
  const pushList = (list) => {
    for (const item of Array.isArray(list) ? list : []) {
      const sessionId = String(item.sessionId || item.id || '');
      if (!sessionId) continue;
      out.push({
        sessionId,
        title: String(item.title || item.name || sessionId.slice(0, 24)),
        updatedAt: String(item.updatedAt || item.time || '')
      });
    }
  };
  try {
    if (typeof controller.list === 'function') {
      const value = await controller.list();
      if (Array.isArray(value)) pushList(value);
      else if (value && Array.isArray(value.sessions)) pushList(value.sessions);
      else if (value && Array.isArray(value.items)) pushList(value.items);
    }
  } catch {
    /* 忽略 */
  }
  return out.slice(0, 80);
}

const PERMISSION_PRESETS = [
  { id: 'read-only', name: '只读', hint: '只能看，不能改文件' },
  { id: 'workspace-write', name: '标准模式', hint: '能改文件，其它操作先问你' },
  { id: 'danger-full-access', name: '完全权限', hint: '不再逐条征求批准' }
];

function agentOf(ctx, sessionId) {
  if (!sessionId) return null;
  const agents = serviceOf(ctx, 'agents');
  try {
    return (agents && typeof agents.get === 'function' ? agents.get(sessionId) : null) || null;
  } catch {
    return null;
  }
}

function sessionLogOf(ctx, sessionId) {
  const agent = agentOf(ctx, sessionId);
  const log = agent && agent.model && agent.model.session ? agent.model.session.log : null;
  return Array.isArray(log) ? log : [];
}

function permissionPresetOf(ctx, sessionId) {
  const log = sessionLogOf(ctx, sessionId);
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const event = log[index];
    if (event && event.type === 'permission/preset' && event.data && event.data.preset) return String(event.data.preset);
  }
  return '';
}

function modelSelectionOf(ctx, sessionId) {
  const log = sessionLogOf(ctx, sessionId);
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const event = log[index];
    const data = event && event.data;
    if (!data) continue;
    const pick = data.selection || data;
    if (pick && pick.model && (data.selection || /model/i.test(String(event.type || '')))) {
      return {
        provider: String(pick.provider || ''),
        model: String(pick.model),
        reasoningEffort: String(pick.reasoningEffort || pick.effort || '')
      };
    }
  }
  return null;
}

async function modelCatalogOf(ctx) {
  const controller = serviceOf(ctx, 'sessionController');
  if (!controller || typeof controller.modelCatalog !== 'function') return null;
  try {
    return await controller.modelCatalog();
  } catch {
    return null;
  }
}

function flattenCatalog(catalog) {
  const out = [];
  const groups = catalog && Array.isArray(catalog.groups) ? catalog.groups : [];
  for (const group of groups) {
    for (const model of Array.isArray(group.models) ? group.models : []) {
      const efforts = model.reasoning && Array.isArray(model.reasoning.efforts) ? model.reasoning.efforts : [];
      out.push({
        provider: String(group.id || ''),
        providerName: String(group.name || group.id || ''),
        model: String(model.id || ''),
        modelName: String(model.name || model.id || ''),
        description: String(model.description || ''),
        defaultEffort: String((model.reasoning && model.reasoning.defaultEffort) || ''),
        efforts: efforts.map((effort) => ({ id: String(effort.id || ''), name: String(effort.name || effort.id || '') }))
      });
    }
  }
  return out;
}

async function commandListOf(ctx, sessionId) {
  const agent = agentOf(ctx, sessionId);
  const commands = serviceOf(ctx, 'commands');
  if (!agent || !commands || typeof commands.list !== 'function') return [];
  try {
    const list = await commands.list(agent);
    return (Array.isArray(list) ? list : []).map((item) => ({
      name: String(item.name || ''),
      description: String(item.description || ''),
      hint: item.input && item.input.hint ? String(item.input.hint) : ''
    })).filter((item) => item.name);
  } catch {
    return [];
  }
}

async function composerValue(ctx, state, sessionId) {
  const catalog = await modelCatalogOf(ctx);
  const stored = sessionId && state.settings && state.settings.models ? state.settings.models[sessionId] : null;
  return {
    sessionId: sessionId || '',
    models: flattenCatalog(catalog),
    defaultSelection: (catalog && catalog.default) || null,
    selection: stored || modelSelectionOf(ctx, sessionId) || (catalog && catalog.default) || null,
    permission: { preset: permissionPresetOf(ctx, sessionId), presets: PERMISSION_PRESETS },
    commands: await commandListOf(ctx, sessionId)
  };
}

async function mentionCandidates(rootAbs, query) {
  const files = await walkFiles(rootAbs, { limit: 3000 });
  const keyword = String(query || '').toLowerCase();
  const scored = [];
  for (const file of files) {
    const lower = file.path.toLowerCase();
    if (keyword && !lower.includes(keyword)) continue;
    const nameHit = path.basename(lower).includes(keyword);
    scored.push({ path: file.path, score: keyword ? (nameHit ? 0 : 1) : 0 });
  }
  scored.sort((a, b) => (a.score - b.score) || (a.path.length - b.path.length) || a.path.localeCompare(b.path));
  return scored.slice(0, 30).map((item) => ({ path: item.path, kind: 'file' }));
}

async function runCommand(ctx, sessionId, line) {
  const agent = agentOf(ctx, sessionId);
  if (!agent) throw fail(409, 'NO_AGENT', '这个会话还没活着，先发一句话再试命令');
  const commands = serviceOf(ctx, 'commands');
  if (!commands || typeof commands.execute !== 'function') throw fail(501, 'NO_COMMANDS', '当前 DSH 版本不支持命令');
  const executed = await commands.execute(agent, line, [], new AbortController().signal);
  const result = (executed && executed.result) || {};
  return {
    commandId: executed ? executed.commandId : '',
    kind: String(result.kind || result.type || ''),
    text: String(result.text || result.message || '').slice(0, 4000)
  };
}

/** 认领身份：把「查索引 → 读定位卡 → 读 §〇 → 报进度」四步发给会话 */
async function claimText(ctx, root, scene, panel) {
  const docs = await readSceneDocs(root, scene);
  const memory = docs.memory.split(/\r?\n/).slice(0, 24).join('\n');
  return [
    `你是「${scene.name}」这个场景的常驻智能体（面板：${panel.title}）。`,
    `场景 id：${scene.id}；工作根目录：${scene.root || '（未设）'}。`,
    '',
    '认领身份的步骤：',
    '1. 读定位卡：' + sceneContextFile(root, scene.id),
    '2. 读场景记忆的 §〇 交接：' + sceneMemoryFile(root, scene.id),
    '3. 用一两句话回报：这个场景是做什么的、现在做到哪、下一步是什么。',
    '',
    '定位卡内容：',
    docs.context.slice(0, 4000),
    '',
    '场景记忆开头（§〇）：',
    memory
  ].join('\n');
}

/* ------------------------------------------------------------------ 版本 */

const VERSION_DIR_NAME = 'versions';
const SNAPSHOT_FILES = ['index.js', 'client.js', 'package.json', 'version.json', 'cordis.patch.yml', 'icon.svg'];

const versionRoot = (root) => path.join(root, VERSION_DIR_NAME);
const versionIndexFile = (root) => path.join(versionRoot(root), 'history.json');

async function readPackageVersion() {
  try {
    const manifest = JSON.parse(await fsp.readFile(packageVersionFile(), 'utf8'));
    return manifest && typeof manifest === 'object' ? manifest : {};
  } catch {
    try {
      const pkg = JSON.parse(await fsp.readFile(path.join(packageDir(), 'package.json'), 'utf8'));
      return { display: '大肥鱼', version: String(pkg.version || '0.0.0') };
    } catch {
      return { display: '大肥鱼', version: '0.0.0' };
    }
  }
}

async function readVersionIndex(root) {
  try {
    const value = JSON.parse(await fsp.readFile(versionIndexFile(root), 'utf8'));
    return value && Array.isArray(value.entries) ? value.entries : [];
  } catch {
    return [];
  }
}

async function writeVersionIndex(root, entries) {
  await fsp.mkdir(versionRoot(root), { recursive: true });
  const file = versionIndexFile(root);
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify({ entries }, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, file);
}

function runGit(args, cwd, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let done = false;
    let child = null;
    const finish = (value) => {
      if (!done) {
        done = true;
        resolve(value);
      }
    };
    try {
      child = spawn('git', args, { cwd, windowsHide: true });
    } catch {
      finish('');
      return;
    }
    let out = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* 忽略 */
      }
      finish('');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { out += chunk.toString('utf8'); });
    child.on('error', () => {
      clearTimeout(timer);
      finish('');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish(code === 0 ? out : '');
    });
  });
}

async function localGitLog(limit = 20) {
  const dir = packageDir();
  if (!existsSync(path.join(dir, '.git'))) return null;
  const out = await runGit(['log', `-n${limit}`, '--date=short', '--pretty=format:%h%x1f%ad%x1f%an%x1f%s'], dir);
  if (!out.trim()) return null;
  const commits = out.split('\n').map((line) => {
    const [hash, date, author, subject] = line.split('\x1f');
    return { hash, date, author, subject };
  }).filter((item) => item.hash);
  const remote = (await runGit(['remote', 'get-url', 'origin'], dir)).trim();
  const branch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).trim();
  return { source: 'git', remote, branch, commits };
}

async function bundledGitLog(limit = 20) {
  try {
    const value = JSON.parse(await fsp.readFile(path.join(packageDir(), 'gitlog.json'), 'utf8'));
    const commits = Array.isArray(value.commits) ? value.commits.slice(0, limit) : [];
    if (!commits.length) return null;
    return { source: 'bundled', remote: String(value.remote || ''), branch: String(value.branch || ''), builtAt: String(value.builtAt || ''), commits };
  } catch {
    return null;
  }
}

function githubSlug(url) {
  const match = /github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i.exec(String(url || '').trim());
  return match ? { owner: match[1], repo: match[2] } : null;
}

async function githubLog(repositoryUrl, limit = 20) {
  const slug = githubSlug(repositoryUrl);
  if (!slug) return { source: 'github', available: false, commits: [], error: '仓库地址不是 GitHub 的' };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dafeiyu/3.0' };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const response = await fetch(`https://api.github.com/repos/${slug.owner}/${slug.repo}/commits?per_page=${limit}`, {
      headers,
      signal: AbortSignal.timeout(8000)
    });
    if (response.status === 403 || response.status === 429) {
      return { source: 'github', available: false, commits: [], error: 'GitHub 限流了（未登录每小时 60 次，本机出口 IP 已经用完）。过一会儿再试，或者给 DSH 设一个 GITHUB_TOKEN 环境变量。' };
    }
    if (response.status === 404) {
      return { source: 'github', available: false, commits: [], error: 'GitHub 上找不到这个仓库（地址写错，或者仓库是私有的）' };
    }
    if (!response.ok) {
      return { source: 'github', available: false, commits: [], error: `GitHub 返回 ${response.status}` };
    }
    const list = await response.json();
    const commits = (Array.isArray(list) ? list : []).map((item) => ({
      hash: String(item.sha || '').slice(0, 7),
      subject: String(((item.commit && item.commit.message) || '').split('\n')[0]),
      date: String(((item.commit && item.commit.author) || {}).date || '').slice(0, 10),
      author: String(((item.commit && item.commit.author) || {}).name || '')
    }));
    return { source: 'github', available: true, remote: repositoryUrl, commits };
  } catch (error) {
    return { source: 'github', available: false, commits: [], error: `连不上 GitHub：${(error && error.message) || error}` };
  }
}

async function commitLog(manifest, limit = 20, settingsUrl = '') {
  const local = await localGitLog(limit);
  if (local) return local;
  const url = String(settingsUrl || (manifest && manifest.repository && manifest.repository.url) || '').trim();
  const live = url ? await githubLog(url, limit) : null;
  if (live && live.available) return live;
  const bundled = await bundledGitLog(limit);
  if (bundled) return { ...bundled, liveError: live && live.error ? live.error : '' };
  return live || { source: 'none', available: false, remote: url, commits: [], error: '还没配置 GitHub 仓库地址：在版本面板里填一下仓库地址就行' };
}

async function currentVersionInfo() {
  const manifest = await readPackageVersion();
  return {
    display: cleanText(manifest.display, 40, '大肥鱼'),
    version: cleanText(manifest.version, 24, '0.0.0'),
    releasedAt: cleanText(manifest.releasedAt, 24, ''),
    changelog: Array.isArray(manifest.changelog) ? manifest.changelog.slice(0, 12) : [],
    repository: (manifest && manifest.repository) || null,
    homepage: cleanText(manifest.homepage, 200, ''),
    dir: packageDir()
  };
}

async function snapshotVersion(root, options = {}) {
  const info = await currentVersionInfo();
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const id = `${info.version}-${stamp}`;
  const dir = path.join(versionRoot(root), id);
  const entries = await readVersionIndex(root);
  if (!options.force) {
    const last = entries[entries.length - 1];
    if (last && last.version === info.version && Date.now() - Date.parse(last.at || 0) < 60 * 1000) {
      return { entry: last, reused: true };
    }
  }
  await fsp.mkdir(dir, { recursive: true });
  for (const file of SNAPSHOT_FILES) {
    const from = path.join(packageDir(), file);
    if (!existsSync(from)) continue;
    await fsp.copyFile(from, path.join(dir, file));
  }
  const entry = {
    id,
    version: info.version,
    display: info.display,
    kind: options.kind || 'manual',
    note: cleanText(options.note, 200, ''),
    dir: id,
    at: new Date().toISOString()
  };
  entries.push(entry);
  await writeVersionIndex(root, entries.slice(-200));
  return { entry, reused: false };
}

async function restoreVersion(root, id) {
  const entries = await readVersionIndex(root);
  const entry = entries.find((item) => item.id === id);
  if (!entry) throw fail(404, 'NO_ENTRY', '找不到这个版本快照');
  const dir = path.join(versionRoot(root), entry.dir);
  if (!existsSync(dir)) throw fail(404, 'NO_FILES', '快照目录不见了');
  const backup = await snapshotVersion(root, { kind: 'pre-rollback', note: `回滚到 ${id} 前留档`, force: true });
  const restored = [];
  for (const file of SNAPSHOT_FILES) {
    const from = path.join(dir, file);
    if (!existsSync(from)) continue;
    await fsp.copyFile(from, path.join(packageDir(), file));
    restored.push(file);
  }
  const fresh = await currentVersionInfo();
  const next = (await readVersionIndex(root)).concat([{
    id: `${fresh.version}-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`,
    version: entry.version,
    display: entry.display,
    kind: 'rollback',
    note: `回滚到 ${id}`,
    dir: entry.dir,
    at: new Date().toISOString()
  }]);
  await writeVersionIndex(root, next.slice(-200));
  return { restored, backup: backup.entry, current: fresh.version };
}

/* ---------------------------------------------------------------- 状态存储 */

function stateFile(root) {
  return path.join(root, 'state.json');
}

let stateCache = null;

async function loadState(root) {
  if (stateCache && stateCache.root === root) return stateCache.value;
  let value = null;
  try {
    const parsed = JSON.parse(await fsp.readFile(stateFile(root), 'utf8'));
    const settings = parsed && typeof parsed.settings === 'object' && parsed.settings ? parsed.settings : {};
    const sessions = {};
    if (settings.sessions && typeof settings.sessions === 'object') {
      for (const [key, sessionId] of Object.entries(settings.sessions)) {
        if (typeof key === 'string' && typeof sessionId === 'string' && sessionId) sessions[key.slice(0, 160)] = sessionId.slice(0, 200);
      }
    }
    const models = {};
    if (settings.models && typeof settings.models === 'object') {
      for (const [key, pick] of Object.entries(settings.models)) {
        if (!pick || typeof pick !== 'object' || !pick.model) continue;
        models[String(key).slice(0, 200)] = {
          provider: String(pick.provider || ''),
          model: String(pick.model),
          reasoningEffort: String(pick.reasoningEffort || '')
        };
      }
    }
    value = {
      version: 3,
      settings: {
        lastScene: cleanText(settings.lastScene, 60, ''),
        repositoryUrl: cleanText(settings.repositoryUrl, 300, ''),
        sessions,
        models
      }
    };
  } catch {
    value = { version: 3, settings: { lastScene: '', repositoryUrl: '', sessions: {}, models: {} } };
  }
  stateCache = { root, value };
  return value;
}

async function saveState(root, state) {
  await fsp.mkdir(root, { recursive: true });
  const file = stateFile(root);
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, file);
  stateCache = { root, value: state };
}

/* ------------------------------------------------------------------ 路由 */

function scenePanelOf(scene, panelId) {
  const panel = scene.panels.find((item) => item.id === panelId);
  if (!panel) throw fail(404, 'NO_PANEL', '这个场景里没有这块面板');
  return panel;
}

async function handleGet(ctx, req, res, route, params, root) {
  const state = await loadState(root);

  if (route === '/state') {
    const scenes = await readScenes(root);
    const info = await currentVersionInfo();
    sendJson(res, 200, {
      ok: true,
      value: {
        scenes,
        settings: state.settings,
        version: { display: info.display, version: info.version, releasedAt: info.releasedAt },
        dataDir: root
      }
    });
    return;
  }

  if (route === '/scene') {
    const scene = await readScene(root, String(params.get('id') || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const docs = await readSceneDocs(root, scene);
    sendJson(res, 200, { ok: true, value: { scene, docs, index: sceneIndexFile(root) } });
    return;
  }

  if (route === '/tree') {
    const scene = await readScene(root, String(params.get('sceneId') || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const panel = scenePanelOf(scene, String(params.get('panelId') || ''));
    const rootAbs = sceneRootOf(scene, panel);
    const nodes = await listTree(rootAbs, String(params.get('path') || ''));
    sendJson(res, 200, { ok: true, value: { root: rootAbs, path: String(params.get('path') || ''), nodes } });
    return;
  }

  if (route === '/file') {
    const scene = await readScene(root, String(params.get('sceneId') || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const panel = scenePanelOf(scene, String(params.get('panelId') || ''));
    const rootAbs = sceneRootOf(scene, panel);
    const info = await fileInfo(rootAbs, String(params.get('path') || ''));
    sendJson(res, 200, { ok: true, value: info });
    return;
  }

  if (route === '/raw') {
    const scene = await readScene(root, String(params.get('sceneId') || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const panel = scenePanelOf(scene, String(params.get('panelId') || ''));
    const abs = resolveInside(sceneRootOf(scene, panel), String(params.get('path') || ''));
    const stat = await fsp.stat(abs);
    if (!stat.isFile()) throw fail(400, 'NOT_A_FILE', '这不是文件');
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-store'
    });
    (await import('node:fs')).createReadStream(abs).pipe(res);
    return;
  }

  if (route === '/preview/tile') {
    const key = String(params.get('key') || '').replace(/[^\w\-]/g, '');
    const name = String(params.get('name') || '').replace(/[^\w.\-]/g, '');
    if (!key || !name) throw fail(400, 'BAD_REQUEST', '要带 key 和 name');
    const file = path.join(previewBase(root), key, name);
    const stat = await fsp.stat(file);
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': stat.size, 'cache-control': 'max-age=600' });
    (await import('node:fs')).createReadStream(file).pipe(res);
    return;
  }

  if (route === '/scene/notes') {
    const scene = await readScene(root, String(params.get('id') || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const docs = await readSceneDocs(root, scene);
    sendJson(res, 200, { ok: true, value: docs });
    return;
  }

  if (route === '/sessions') {
    sendJson(res, 200, { ok: true, value: { items: await listSessions(ctx) } });
    return;
  }

  if (route === '/chat/messages') {
    const scene = await readScene(root, String(params.get('sceneId') || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const panel = scenePanelOf(scene, String(params.get('panelId') || ''));
    const sessionId = boundSessionOf(state, scene, panel);
    if (!sessionId) {
      sendJson(res, 200, { ok: true, value: { sessionId: '', items: [], bound: false } });
      return;
    }
    const items = await readMessages(ctx, sessionId, clampInt(params.get('limit'), 80, 1, 400));
    sendJson(res, 200, { ok: true, value: { sessionId, items, bound: true } });
    return;
  }

  if (route === '/chat/state') {
    const scene = await readScene(root, String(params.get('sceneId') || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const panel = scenePanelOf(scene, String(params.get('panelId') || ''));
    const sessionId = boundSessionOf(state, scene, panel);
    sendJson(res, 200, { ok: true, value: { sessionId, ...(await chatState(ctx, sessionId)) } });
    return;
  }

  if (route === '/composer') {
    const sceneId = String(params.get('sceneId') || '');
    const panelId = String(params.get('panelId') || '');
    let sessionId = '';
    if (sceneId && panelId) {
      const scene = await readScene(root, sceneId);
      if (scene) sessionId = boundSessionOf(state, scene, scenePanelOf(scene, panelId));
    }
    sendJson(res, 200, { ok: true, value: { ...(await composerValue(ctx, state, sessionId)), bound: Boolean(sessionId) } });
    return;
  }

  if (route === '/mentions') {
    const scene = await readScene(root, String(params.get('sceneId') || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const panel = scene.panels.find((item) => item.id === String(params.get('panelId') || '')) || null;
    const rootAbs = sceneRootOf(scene, panel);
    if (!rootAbs) throw fail(400, 'NO_ROOT', '这个场景还没设根目录');
    sendJson(res, 200, { ok: true, value: { items: await mentionCandidates(rootAbs, String(params.get('q') || '')) } });
    return;
  }

  if (route === '/version') {
    const info = await currentVersionInfo();
    const history = await readVersionIndex(root);
    const repositoryUrl = state.settings.repositoryUrl || '';
    sendJson(res, 200, {
      ok: true,
      value: {
        ...info,
        repositoryUrl,
        history,
        commits: await commitLog(info, 20, repositoryUrl),
        dataDir: root
      }
    });
    return;
  }

  throw fail(404, 'NO_ROUTE', `未知接口 ${route}`);
}

async function handlePost(ctx, req, res, route, root) {
  const payload = JSON.parse((await readBody(req)) || '{}');
  const state = await loadState(root);

  if (route === '/scene/save') {
    const scene = normalizeScene(payload.scene || {}, payload.scene && payload.scene.id);
    if (!scene.id) throw fail(400, 'BAD_SCENE', '场景缺 id');
    const file = await writeScene(root, scene);
    await ensureSceneDocs(root, scene);
    sendJson(res, 200, { ok: true, value: { scene, file } });
    return;
  }

  if (route === '/scene/delete') {
    const id = String(payload.id || '').replace(/[^\w.\-]/g, '');
    if (!id) throw fail(400, 'BAD_SCENE', '要带 id');
    const file = path.join(scenarioDirOf(root), `${id}.json`);
    if (!existsSync(file)) throw fail(404, 'NO_SCENE', '数据目录里没有这个场景（内置模板不能删）');
    await fsp.rm(file, { force: true });
    sendJson(res, 200, { ok: true, value: { removed: file } });
    return;
  }

  if (route === '/scene/note') {
    const scene = await readScene(root, String(payload.sceneId || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const source = NOTE_SOURCES.includes(payload.source) ? payload.source : 'memory';
    const value = await saveNote(root, scene, { source }, String(payload.text || ''));
    sendJson(res, 200, { ok: true, value });
    return;
  }

  if (route === '/settings/update') {
    if (typeof payload.lastScene === 'string') state.settings.lastScene = cleanText(payload.lastScene, 60, '');
    if (typeof payload.repositoryUrl === 'string') state.settings.repositoryUrl = cleanText(payload.repositoryUrl, 300, '');
    await saveState(root, state);
    sendJson(res, 200, { ok: true, value: state.settings });
    return;
  }

  if (route === '/session/bind') {
    const scene = await readScene(root, String(payload.sceneId || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const panel = scenePanelOf(scene, String(payload.panelId || ''));
    const sessionId = cleanText(payload.sessionId, 200, '');
    if (!sessionId) throw fail(400, 'BAD_SESSION', '要选一个会话');
    state.settings.sessions[sessionKey(scene.id, panel.id)] = sessionId;
    await saveState(root, state);
    await updateSceneIndex(root, scene, panel, sessionId);
    sendJson(res, 200, { ok: true, value: { sessionId } });
    return;
  }

  if (route === '/session/new') {
    const scene = await readScene(root, String(payload.sceneId || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const panel = scenePanelOf(scene, String(payload.panelId || ''));
    const controller = requireController(ctx);
    const created = await controller.create(scene.root ? { cwd: scene.root } : { cwd: root });
    const sessionId = String((created && created.sessionId) || '');
    if (!sessionId) throw fail(502, 'CREATE_FAILED', '新建会话失败');
    state.settings.sessions[sessionKey(scene.id, panel.id)] = sessionId;
    await saveState(root, state);
    await updateSceneIndex(root, scene, panel, sessionId);
    sendJson(res, 200, { ok: true, value: { sessionId } });
    return;
  }

  if (route === '/chat/send') {
    const text = String(payload.text || '').trim();
    if (!text) throw fail(400, 'BAD_REQUEST', '消息不能为空');
    if (Buffer.byteLength(text, 'utf8') > 64 * 1024) throw fail(413, 'TOO_LARGE', '这条消息太长了');
    const scene = await readScene(root, String(payload.sceneId || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const panel = scenePanelOf(scene, String(payload.panelId || ''));
    const sessionId = boundSessionOf(state, scene, panel);
    if (!sessionId) throw fail(409, 'NO_SESSION', '这块 AI 面板还没绑会话（右上角选一个，或点「新建会话」）');
    const value = await sendChat(ctx, sessionId, text);
    sendJson(res, 200, { ok: true, value: { ...value, sessionId } });
    return;
  }

  if (route === '/claim') {
    const scene = await readScene(root, String(payload.sceneId || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const panel = scenePanelOf(scene, String(payload.panelId || ''));
    const sessionId = boundSessionOf(state, scene, panel);
    if (!sessionId) throw fail(409, 'NO_SESSION', '这块 AI 面板还没绑会话');
    const text = await claimText(ctx, root, scene, panel);
    const value = await sendChat(ctx, sessionId, text);
    sendJson(res, 200, { ok: true, value });
    return;
  }

  if (route === '/composer/model') {
    const scene = await readScene(root, String(payload.sceneId || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const panel = scenePanelOf(scene, String(payload.panelId || ''));
    const sessionId = boundSessionOf(state, scene, panel);
    if (!sessionId) throw fail(409, 'NO_SESSION', '先绑一个会话再换模型');
    const controller = requireController(ctx);
    const pick = String(payload.model || '');
    if (!pick) throw fail(400, 'BAD_REQUEST', '要指定模型');
    const models = flattenCatalog(await modelCatalogOf(ctx));
    const wanted = models.find((item) => item.model === pick && (!payload.provider || item.provider === String(payload.provider)));
    if (!wanted) throw fail(400, 'BAD_MODEL', '这个模型不在可选列表里');
    const selection = {
      provider: String(payload.provider || wanted.provider),
      model: pick,
      reasoningEffort: String(payload.reasoningEffort || wanted.defaultEffort || '')
    };
    const result = await controller.selectModel({
      sessionId,
      provider: selection.provider,
      model: selection.model,
      reasoningEffort: selection.reasoningEffort
    });
    const saved = (result && result.selected) || selection;
    state.settings.models[sessionId] = {
      provider: String(saved.provider || selection.provider),
      model: String(saved.model || selection.model),
      reasoningEffort: String(saved.reasoningEffort || selection.reasoningEffort)
    };
    await saveState(root, state);
    sendJson(res, 200, { ok: true, value: { selection: state.settings.models[sessionId] } });
    return;
  }

  if (route === '/composer/permission') {
    const scene = await readScene(root, String(payload.sceneId || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const panel = scenePanelOf(scene, String(payload.panelId || ''));
    const sessionId = boundSessionOf(state, scene, panel);
    if (!sessionId) throw fail(409, 'NO_SESSION', '先绑一个会话再改权限');
    const preset = String(payload.preset || '');
    if (!PERMISSION_PRESETS.some((item) => item.id === preset)) throw fail(400, 'BAD_PRESET', '没有这个权限模式');
    const run = await runCommand(ctx, sessionId, `/permission ${preset}`);
    sendJson(res, 200, { ok: true, value: { preset, ...run } });
    return;
  }

  if (route === '/command') {
    const line = String(payload.line || '').trim();
    if (!line.startsWith('/')) throw fail(400, 'BAD_COMMAND', '命令要以 / 开头');
    const scene = await readScene(root, String(payload.sceneId || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const panel = scenePanelOf(scene, String(payload.panelId || ''));
    const sessionId = boundSessionOf(state, scene, panel);
    if (!sessionId) throw fail(409, 'NO_SESSION', '先绑一个会话再执行命令');
    const value = await runCommand(ctx, sessionId, line);
    sendJson(res, 200, { ok: true, value });
    return;
  }

  if (route === '/file/save') {
    const scene = await readScene(root, String(payload.sceneId || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const panel = scenePanelOf(scene, String(payload.panelId || ''));
    const abs = resolveInside(sceneRootOf(scene, panel), String(payload.path || ''));
    const text = String(payload.text ?? '');
    if (Buffer.byteLength(text, 'utf8') > TEXT_LIMIT) throw fail(413, 'TOO_LARGE', '文件超过 1 MB，不能在这里编辑');
    const baseMtimeMs = Number(payload.baseMtimeMs) || 0;
    let stat = null;
    try {
      stat = await fsp.stat(abs);
    } catch {
      stat = null;
    }
    if (!stat || !stat.isFile()) throw fail(404, 'NO_FILE', '文件不存在');
    if (baseMtimeMs && Math.round(stat.mtimeMs) !== Math.round(baseMtimeMs)) {
      throw fail(409, 'MTIME_CONFLICT', '文件已经被其它程序改过了，点「重新读取」再改');
    }
    await fsp.writeFile(abs, text, 'utf8');
    const fresh = await fsp.stat(abs);
    sendJson(res, 200, { ok: true, value: { path: payload.path, mtimeMs: Math.round(fresh.mtimeMs), size: fresh.size } });
    return;
  }

  if (route === '/file/mkdir') {
    const scene = await readScene(root, String(payload.sceneId || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const panel = scenePanelOf(scene, String(payload.panelId || ''));
    const abs = resolveInside(sceneRootOf(scene, panel), String(payload.path || ''));
    await fsp.mkdir(abs, { recursive: true });
    sendJson(res, 200, { ok: true, value: { path: payload.path } });
    return;
  }

  if (route === '/preview') {
    const scene = await readScene(root, String(payload.sceneId || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const panel = scenePanelOf(scene, String(payload.panelId || ''));
    const value = await renderPreview(ctx, root, sceneRootOf(scene, panel), String(payload.path || ''), Boolean(payload.refresh));
    sendJson(res, 200, { ok: true, value });
    return;
  }

  if (route === '/open') {
    const scene = await readScene(root, String(payload.sceneId || ''));
    if (!scene) throw fail(404, 'NO_SCENE', '找不到这个场景');
    const panel = scenePanelOf(scene, String(payload.panelId || ''));
    const abs = resolveInside(sceneRootOf(scene, panel), String(payload.path || ''));
    await openWithSystem(abs);
    sendJson(res, 200, { ok: true, value: { opened: abs } });
    return;
  }

  if (route === '/openlink') {
    const url = String(payload.url || '').trim();
    if (!/^(https?:\/\/|\/\/)/i.test(url) && !/^[\w.-]+\.[a-z]{2,}([/:?#]|$)/i.test(url)) throw fail(400, 'BAD_URL', '这不是一个网址');
    openUrlInBrowser(url);
    sendJson(res, 200, { ok: true, value: { opened: url } });
    return;
  }

  if (route === '/version/snapshot') {
    const value = await snapshotVersion(root, { kind: 'manual', note: String(payload.note || ''), force: true });
    sendJson(res, 200, { ok: true, value });
    return;
  }

  if (route === '/version/rollback') {
    const value = await restoreVersion(root, String(payload.id || ''));
    sendJson(res, 200, { ok: true, value });
    return;
  }

  if (route === '/version/repository') {
    const url = String(payload.url || '').trim();
    if (url && (!/^https?:\/\//i.test(url) || !githubSlug(url))) {
      throw fail(400, 'BAD_URL', '要填 GitHub 仓库地址，例如 https://github.com/你的账号/dafeiyu');
    }
    state.settings.repositoryUrl = url;
    await saveState(root, state);
    sendJson(res, 200, { ok: true, value: { repositoryUrl: url } });
    return;
  }

  throw fail(404, 'NO_ROUTE', `未知接口 ${route}`);
}

async function handleApi(ctx, req, res) {
  const root = dataRoot();
  const parsed = new URL(req.url || '/', 'http://127.0.0.1');
  let route = parsed.pathname;
  if (route.startsWith(API_BASE)) route = route.slice(API_BASE.length) || '/';
  const method = String(req.method || 'GET').toUpperCase();

  try {
    if (method === 'GET') {
      await handleGet(ctx, req, res, route, parsed.searchParams, root);
      return;
    }
    if (method === 'POST') {
      await handlePost(ctx, req, res, route, root);
      return;
    }
    throw fail(405, 'BAD_METHOD', '只支持 GET / POST');
  } catch (error) {
    const status = Number(error && error.status) || 500;
    const code = String((error && error.code) || 'INTERNAL');
    const message = String((error && error.message) || error);
    sendJson(res, status, { ok: false, error: { code, message } });
  }
}

function normalizeDispose(registered) {
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    try {
      if (typeof registered === 'function') registered();
      else if (registered && typeof registered.dispose === 'function') registered.dispose();
    } catch {
      /* 注销失败不阻断 */
    }
  };
  if (registered && typeof registered.then === 'function') {
    registered
      .then((value) => {
        if (typeof value === 'function') value();
        else if (value && typeof value.dispose === 'function') value.dispose();
      })
      .catch(() => {});
  }
  return cleanup;
}

// 宿主装了 auth 插件时用它判一次。插件只声明了 inject=['webServer']，直接读 ctx.connection
// 会抛「cannot get property connection without inject」——抛了就按匿名处理，后面还有回环校验兜底。
async function requestRejectionOf(ctx, req) {
  try {
    const connection = ctx ? ctx.connection : null;
    if (connection && typeof connection.requestRejection === 'function') return await connection.requestRejection(req);
  } catch {
    /* 没声明 inject / 没这个服务：当匿名 */
  }
  return null;
}

export function apply(ctx) {
  const log = (ctx && typeof ctx.logger === 'function' ? ctx.logger(name) : null) || console;
  const route = {
    kind: 'prefix',
    path: API_BASE,
    async handler(req, res) {
      try {
        const rejection = await requestRejectionOf(ctx, req);
        if (rejection === 401 || rejection === 403) {
          res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
          return;
        }
        if (!rejection && !isTrustedLoopback(req)) {
          res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('forbidden');
          return;
        }
        await handleApi(ctx, req, res);
      } catch (error) {
        log.warn?.(`[dafeiyu] ${(error && error.stack) || error}`);
        try {
          sendJson(res, 500, { ok: false, error: { code: 'INTERNAL', message: String((error && error.message) || error) } });
        } catch {
          /* 头已发出 */
        }
      }
    }
  };

  const disposeRoute = normalizeDispose(ctx.webServer.register(route));
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => disposeRoute(), 'dafeiyu：注销大肥鱼 API 路由');
    ctx.effect(() => () => {
      const pending = converterPromise;
      converterPromise = null;
      kitPromise = null;
      if (pending) {
        pending.then((converter) => converter && typeof converter.dispose === 'function' && converter.dispose()).catch(() => {});
      }
    }, 'dafeiyu：释放文档渲染引擎');
  }

  void (async () => {
    const root = dataRoot();
    try {
      const migrated = await migrateLegacyData(root);
      if (migrated) log.info?.(`[dafeiyu] 已把旧数据目录复制到 ${root}`);
    } catch (error) {
      log.warn?.(`[dafeiyu] 旧数据迁移失败：${(error && error.message) || error}`);
    }
    try {
      await loadState(root);
      const scenes = await readScenes(root);
      for (const scene of scenes) await ensureSceneDocs(root, scene);
      log.info?.(`[dafeiyu] 就绪 · ${scenes.length} 个场景 · 数据目录 ${root}`);
    } catch (error) {
      log.warn?.(`[dafeiyu] 初始化场景失败：${(error && error.message) || error}`);
    }
    prunePreviews(root).catch(() => {});
  })();

  log.info?.(`[dafeiyu] 大肥鱼 API 挂在 ${API_BASE}，数据目录 ${dataRoot()}`);
}

