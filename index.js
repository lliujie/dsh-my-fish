/**
 * 大肥鱼 · Host 半边
 *
 * 职责：
 *  1. 项目台账（增 / 删 / 改）落盘到 <数据目录>/state.json
 *  2. 项目根目录的文件浏览、读取、保存（受项目根约束，不能越界）
 *  3. 生成「协作档案」：把项目与子智能体模块名册写成 markdown，供主智能体分派
 *  4. 用系统默认程序打开 docx / pptx / xlsx / pdf 等文档
 *  5. 把 docx / xlsx / pptx 渲染成图片，供面板内嵌预览（内置 libreoffice-kit 引擎）
 *  7. 版本中心：当前版本、变更日志、快照备份、一键回滚
 *
 * 客户端通过同源 HTTP（/dafeiyu/api）访问这里的接口。
 */
import { promises as fsp, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

export const name = 'dafeiyu';
export const inject = ['webServer'];

const API_BASE = '/dafeiyu/api';
const BODY_LIMIT = 4 * 1024 * 1024;
const TEXT_LIMIT = 1024 * 1024;
const TREE_LIMIT = 900;
const STATS_TTL = 15000;

/* 内嵌预览：把 office 文档渲染成分页 PNG 缓存起来 */
const PREVIEW_DPI = 110;
const PREVIEW_MAX_PAGES = 20;
const PREVIEW_TIMEOUT = 180000;
const PREVIEW_MAX_AGE = 14 * 24 * 60 * 60 * 1000;
/* officeKit 服务的单次渲染上限 */
const PREVIEW_MAX_PIXELS = 16 * 1024 * 1024;
const PREVIEW_MAX_DIMENSION = 8192;
const PREVIEW_MAX_BYTES = 24 * 1024 * 1024;
const PREVIEW_EXT = new Set(['.docx', '.doc', '.odt', '.xlsx', '.xls', '.ods', '.pptx', '.ppt', '.odp']);
const SHEET_EXT = new Set(['.xlsx', '.xls', '.ods']);
/** 表格按「已用区域」裁切，原生像素很小，给更高 dpi 才不至于糊 */
function previewDpiFor(ext) {
  return SHEET_EXT.has(ext) ? 200 : PREVIEW_DPI;
}

const SKIP_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', '.venv', 'venv', '__pycache__',
  '.idea', '.vs', '.vscode', '.next', '.cache', '.obsidian', '.tmp',
  '$RECYCLE.BIN', 'System Volume Information'
]);

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.avif']);
const OFFICE_EXT = new Set(['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.xlsm', '.docm', '.pptm', '.vsdx']);
const TEXT_EXT = new Set([
  '.md', '.markdown', '.txt', '.json', '.jsonc', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf',
  '.csv', '.tsv', '.log', '.xml', '.html', '.htm', '.css', '.scss', '.less', '.js', '.mjs', '.cjs',
  '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.go', '.rs', '.rb',
  '.php', '.sh', '.bat', '.ps1', '.sql', '.gitignore', '.gitattributes', '.env', '.editorconfig'
]);
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.avif': 'image/avif', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

const MODULE_PRESETS = [
  {
    key: 'tech-plan',
    name: '技术方案',
    role: '负责需求拆解、技术选型、总体架构与详细设计文档',
    deliverables: '技术方案.md、架构图、接口清单',
    instructions: '先读 _pm/项目档案.md；方案里的接口与数据模型需与代码、表格一致。',
  },
  {
    key: 'review',
    name: '评审材料',
    role: '负责评审会材料：问题清单、决策点、风险与待确认项',
    deliverables: '评审纪要.md、问题清单.xlsx',
    instructions: '每条结论标注责任人；未定事项进「待确认」。',
  },
  {
    key: 'report',
    name: '汇报 PPT',
    role: '负责汇报演示：进度、里程碑、风险、资源诉求',
    deliverables: '汇报材料.pptx、讲稿.md',
    instructions: '一页一个结论；图表数据注明来源与日期。',
  },
  {
    key: 'sheet',
    name: '数据表格',
    role: '负责计划表、预算表、资源表、验收清单等 Excel',
    deliverables: '项目计划.xlsx、工作量统计.xlsx',
    instructions: '表头样式统一，公式保留，不覆盖人工填写列。',
  },
  {
    key: 'doc-ops',
    name: '文档归档',
    role: '负责把散落的文档整理归档为 PDF 与目录索引',
    deliverables: '归档目录.md、终稿 PDF',
    instructions: '命名规则：日期_模块_版本.pdf；归档前确认定稿。',
  }
];

/* -------------------------------------------------------------- 存储 */

const DATA_DIR_NAME = 'dafeiyu';
/** 上一代插件用过的数据目录，首次启动会把内容复制过来 */
const LEGACY_DATA_DIR_NAMES = ['pm-workbench'];

function dataRoot() {
  const explicit = process.env.DAFEIYU_HOME || process.env.PM_WORKBENCH_HOME;
  if (explicit) return explicit;
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(dshHome, DATA_DIR_NAME);
}

/** 插件包自身目录（读 package.json / version.json，写版本快照） */
function packageDir() {
  return fileURLToPath(new URL('.', import.meta.url));
}

function packageVersionFile() {
  return path.join(packageDir(), 'version.json');
}

function stateFile(root) {
  return path.join(root, 'state.json');
}

/**
 * 首次启动：把旧版（pm-workbench）数据目录整体复制到新目录。
 * 只复制、不删除，旧目录留着当保险；已经迁移过（state.json 存在）就跳过。
 */
async function migrateLegacyData(root) {
  if (process.env.DAFEIYU_HOME || process.env.PM_WORKBENCH_HOME) return null;
  if (existsSync(stateFile(root))) return null;
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  for (const legacyName of LEGACY_DATA_DIR_NAMES) {
    const legacy = path.join(dshHome, legacyName);
    if (!existsSync(legacy)) continue;
    try {
      await fsp.mkdir(root, { recursive: true });
      await fsp.cp(legacy, root, { recursive: true, force: false, errorOnExist: false });
      return legacy;
    } catch {
      /* 迁移失败不阻塞启动 */
    }
  }
  return null;
}


let cache = null;
let cacheRoot = '';

async function loadState(root) {
  if (cache && cacheRoot === root) return cache;
  let parsed = null;
  try {
    const text = await fsp.readFile(stateFile(root), 'utf8');
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const state = {
    version: 2,
    projects: [],
    settings: { overviewSessionId: null, repositoryUrl: '', models: {} }
  };
  if (parsed && Array.isArray(parsed.projects)) {
    state.projects = parsed.projects.map(normalizeProject).filter(Boolean);
  }
  if (parsed && parsed.settings && typeof parsed.settings === 'object') {
    state.settings.overviewSessionId = typeof parsed.settings.overviewSessionId === 'string'
      ? parsed.settings.overviewSessionId
      : null;
    state.settings.repositoryUrl = typeof parsed.settings.repositoryUrl === 'string'
      ? parsed.settings.repositoryUrl.trim()
      : '';
    if (parsed.settings.models && typeof parsed.settings.models === 'object') {
      for (const [sessionId, selection] of Object.entries(parsed.settings.models)) {
        if (!sessionId || !selection || typeof selection !== 'object') continue;
        const model = String(selection.model || '');
        if (!model) continue;
        state.settings.models[sessionId] = {
          provider: String(selection.provider || ''),
          model,
          reasoningEffort: String(selection.reasoningEffort || '')
        };
      }
    }
  }
  cache = state;
  cacheRoot = root;
  return state;
}

async function saveState(root, state) {
  await fsp.mkdir(root, { recursive: true });
  const target = stateFile(root);
  const tmp = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await fsp.rename(tmp, target);
  cache = state;
  cacheRoot = root;
  return state;
}

/* -------------------------------------------------------------- 版本中心 */

const VERSION_DIR_NAME = 'versions';
/** 回滚只需要这些代码文件；docs/截图不进快照，省空间 */
const SNAPSHOT_FILES = ['index.js', 'client.js', 'package.json', 'version.json', 'cordis.patch.yml', 'icon.svg'];

function versionRoot(root) {
  return path.join(root, VERSION_DIR_NAME);
}

function versionIndexFile(root) {
  return path.join(versionRoot(root), 'history.json');
}

async function readPackageVersion() {
  try {
    const text = await fsp.readFile(packageVersionFile(), 'utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function currentVersionInfo() {
  const manifest = await readPackageVersion();
  let pkgVersion = '';
  try {
    const pkg = JSON.parse(await fsp.readFile(path.join(packageDir(), 'package.json'), 'utf8'));
    pkgVersion = String(pkg && pkg.version ? pkg.version : '');
  } catch {
    pkgVersion = '';
  }
  return {
    name: String(manifest && manifest.name ? manifest.name : ''),
    display: String(manifest && manifest.display ? manifest.display : '大肥鱼'),
    version: String((manifest && manifest.version) || pkgVersion || '0.0.0'),
    releasedAt: String(manifest && manifest.releasedAt ? manifest.releasedAt : ''),
    title: String(manifest && manifest.title ? manifest.title : ''),
    changelog: manifest && Array.isArray(manifest.changelog) ? manifest.changelog : [],
    repository: manifest && manifest.repository ? manifest.repository : null,
    homepage: manifest && manifest.homepage ? String(manifest.homepage) : '',
    dir: packageDir()
  };
}

/* ------------------------------------------------------------ Git / GitHub 提交记录 */

function runGit(args, cwd, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let child;
    try {
      child = spawn('git', args, { cwd, windowsHide: true });
    } catch {
      finish('');
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* 已经退出 */
      }
      finish('');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    child.stderr.on('data', () => {});
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

/** 插件目录如果是 git 仓库，就读本地提交记录 */
async function localGitLog(limit = 20) {
  const dir = packageDir();
  if (!existsSync(path.join(dir, '.git'))) {
    return { source: 'none', available: false, dir, remote: '', branch: '', commits: [] };
  }
  const raw = await runGit(
    ['log', `-n${limit}`, '--date=short', '--pretty=format:%h%x1f%ad%x1f%an%x1f%s'],
    dir
  );
  const commits = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, date, author, subject] = line.split('\x1f');
      return { hash: hash || '', date: date || '', author: author || '', subject: subject || '' };
    });
  let remote = '';
  let branch = '';
  if (commits.length) {
    remote = (await runGit(['remote', 'get-url', 'origin'], dir)).trim();
    branch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).trim();
  }
  return { source: 'git', available: commits.length > 0, dir, remote, branch, commits };
}

function githubSlug(url) {
  const match = /github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i.exec(String(url || '').trim());
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/** 没有本地 .git 时，用 GitHub 公开接口读提交记录 */
async function githubLog(repositoryUrl, limit = 20) {
  const slug = githubSlug(repositoryUrl);
  if (!slug) return { source: 'github', available: false, commits: [], remote: String(repositoryUrl || ''), error: '仓库地址不像 GitHub' };
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dafeiyu-status/1.0' };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${slug.owner}/${slug.repo}/commits?per_page=${limit}`, {
      headers,
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      let hint = `GitHub 返回 HTTP ${res.status}`;
      if (res.status === 404) hint = 'GitHub 上找不到这个仓库（地址写错，或者仓库是私有的）';
      if (res.status === 403 || res.status === 429) {
        hint = token
          ? 'GitHub 限流了（token 额度用完或权限不足），过一会儿再试'
          : 'GitHub 限流了（未登录每小时 60 次，本机出口 IP 已经用完）。过一会儿再试，或者给 DSH 设一个 GITHUB_TOKEN 环境变量';
      }
      return { source: 'github', available: false, commits: [], remote: String(repositoryUrl), error: hint };
    }
    const list = await res.json();
    const commits = (Array.isArray(list) ? list : []).map((item) => {
      const commit = item && item.commit ? item.commit : {};
      const author = commit.author && commit.author.date ? commit.author : (commit.committer || {});
      return {
        hash: String(item && item.sha ? item.sha : '').slice(0, 7),
        date: String(author.date || '').slice(0, 10),
        author: String(author.name || ''),
        subject: String(commit.message || '').split('\n')[0]
      };
    });
    return { source: 'github', available: commits.length > 0, commits, remote: String(repositoryUrl) };
  } catch (error) {
    return {
      source: 'github',
      available: false,
      commits: [],
      remote: String(repositoryUrl),
      error: error && error.name === 'TimeoutError' ? '请求 GitHub 超时' : String(error && error.message ? error.message : error)
    };
  }
}

/** 版本页要显示的提交记录：优先本地仓库，其次面板里配的地址，再次 version.json */
async function bundledGitLog(limit = 20) {
  const dir = packageDir();
  let parsed = null;
  try {
    parsed = JSON.parse(await fsp.readFile(path.join(dir, 'gitlog.json'), 'utf8'));
  } catch {
    return null;
  }
  const list = Array.isArray(parsed && parsed.commits) ? parsed.commits : [];
  const commits = list
    .filter((item) => item && item.subject)
    .slice(0, limit)
    .map((item) => ({
      hash: String(item.hash || ''),
      date: String(item.date || ''),
      author: String(item.author || ''),
      subject: String(item.subject || '')
    }));
  if (!commits.length) return null;
  return {
    source: 'bundled',
    available: true,
    dir,
    remote: String((parsed && parsed.remote) || ''),
    branch: String((parsed && parsed.branch) || ''),
    builtAt: String((parsed && parsed.generatedAt) || ''),
    commits
  };
}

async function commitLog(manifest, limit = 20, settingsUrl = '') {
  const local = await localGitLog(limit);
  if (local.available) return local;
  const repository = manifest && manifest.repository ? manifest.repository : null;
  const fromManifest = typeof repository === 'string' ? repository : (repository && repository.url) || '';
  const url = String(settingsUrl || '').trim() || fromManifest;
  if (!url) {
    const bundled = await bundledGitLog(limit);
    if (bundled) return bundled;
    return { source: 'none', available: false, commits: [], remote: '', error: '还没配置 GitHub 仓库地址：在版本页的输入框里填一下仓库地址就行' };
  }
  const remote = await githubLog(url, limit);
  if (remote && remote.available) return remote;
  const bundled = await bundledGitLog(limit);
  if (bundled) {
    return Object.assign(bundled, {
      remote: bundled.remote || url,
      liveError: String((remote && remote.error) || ''),
      note: '联网读取没成功，先显示打包时带上的提交记录'
    });
  }
  return remote;
}

async function readVersionIndex(root) {
  try {
    const text = await fsp.readFile(versionIndexFile(root), 'utf8');
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.entries)) return parsed;
  } catch {
    /* 还没有历史 */
  }
  return { entries: [] };
}

async function writeVersionIndex(root, index) {
  await fsp.mkdir(versionRoot(root), { recursive: true });
  const target = versionIndexFile(root);
  const tmp = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(index, null, 2), 'utf8');
  await fsp.rename(tmp, target);
}

async function hashSnapshotFiles() {
  const hash = crypto.createHash('sha256');
  for (const fileName of SNAPSHOT_FILES) {
    hash.update(fileName);
    try {
      hash.update(await fsp.readFile(path.join(packageDir(), fileName)));
    } catch {
      hash.update('missing');
    }
  }
  return hash.digest('hex').slice(0, 16);
}

/** 把当前正在运行的版本存一份可回滚的快照 */
async function snapshotVersion(root, options = {}) {
  const info = await currentVersionInfo();
  const hash = await hashSnapshotFiles();
  const index = await readVersionIndex(root);
  if (!options.force) {
    const same = index.entries.find((item) => item.hash === hash && item.dir);
    if (same) return { entry: same, created: false, index };
  }
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const id = `${info.version}-${stamp}`;
  const dir = path.join(versionRoot(root), id);
  await fsp.mkdir(dir, { recursive: true });
  for (const fileName of SNAPSHOT_FILES) {
    try {
      await fsp.copyFile(path.join(packageDir(), fileName), path.join(dir, fileName));
    } catch {
      /* 缺文件就跳过 */
    }
  }
  const entry = {
    id,
    version: info.version,
    display: info.display,
    hash,
    dir: id,
    kind: String(options.kind || 'auto'),
    note: String(options.note || '').trim(),
    at: new Date().toISOString()
  };
  index.entries.unshift(entry);
  index.entries = index.entries.slice(0, 200);
  await writeVersionIndex(root, index);
  return { entry, created: true, index };
}

async function readSnapshotName(dir) {
  try {
    const pkg = JSON.parse(await fsp.readFile(path.join(dir, 'package.json'), 'utf8'));
    return String(pkg && pkg.name ? pkg.name : '');
  } catch {
    return '';
  }
}

async function readCurrentPackageName() {
  try {
    const pkg = JSON.parse(await fsp.readFile(path.join(packageDir(), 'package.json'), 'utf8'));
    return String(pkg && pkg.name ? pkg.name : '');
  } catch {
    return '';
  }
}

async function restoreVersion(root, id) {
  const index = await readVersionIndex(root);
  const entry = index.entries.find((item) => item.id === id);
  if (!entry) throw fail(404, 'NO_VERSION', '找不到这个版本快照');
  const dir = path.join(versionRoot(root), entry.dir || entry.id);
  if (!existsSync(dir)) throw fail(404, 'NO_SNAPSHOT', '快照文件已丢失，无法回滚');
  /* 只允许回滚同一个插件包：旧版「工作台」的快照覆盖当前目录会直接装坏 */
  const snapshotName = await readSnapshotName(dir);
  const currentName = await readCurrentPackageName();
  if (snapshotName && currentName && snapshotName !== currentName) {
    throw fail(400, 'CROSS_PLUGIN',
      `这份快照属于 ${snapshotName}，不能回滚到 ${currentName}`);
  }
  /* 先给当前版本留一份，回滚也能再回滚回来 */
  const safety = await snapshotVersion(root, {
    kind: 'pre-rollback',
    note: `回滚到 ${entry.id} 之前自动备份`,
    force: true
  });
  for (const fileName of SNAPSHOT_FILES) {
    const from = path.join(dir, fileName);
    if (!existsSync(from)) continue;
    await fsp.copyFile(from, path.join(packageDir(), fileName));
  }
  const info = await currentVersionInfo();
  const hash = await hashSnapshotFiles();
  index.entries.unshift({
    id: `rollback-${Date.now()}`,
    version: info.version,
    display: info.display,
    hash,
    dir: '',
    kind: 'rollback',
    note: `已回滚到 ${entry.id}`,
    at: new Date().toISOString()
  });
  await writeVersionIndex(root, index);
  return { restored: entry, backup: safety.entry, current: { version: info.version, hash } };
}

function normalizeProject(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const root = typeof raw.root === 'string' ? raw.root.trim() : '';
  if (!root) return null;
  const modules = Array.isArray(raw.modules) ? raw.modules.map(normalizeModule).filter(Boolean) : [];
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId('p'),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : path.basename(root) || '未命名项目',
    root,
    color: typeof raw.color === 'string' ? raw.color : '',
    workspaceId: typeof raw.workspaceId === 'string' ? raw.workspaceId : null,
    leadSessionId: typeof raw.leadSessionId === 'string' ? raw.leadSessionId : null,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    lastRel: typeof raw.lastRel === 'string' ? raw.lastRel : '',
    modules,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString()
  };
}

function normalizeModule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const moduleName = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!moduleName) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId('m'),
    name: moduleName,
    role: typeof raw.role === 'string' ? raw.role : '',
    deliverables: typeof raw.deliverables === 'string' ? raw.deliverables : '',
    instructions: typeof raw.instructions === 'string' ? raw.instructions : '',
    enabled: raw.enabled !== false
  };
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function findProject(state, id) {
  return state.projects.find((item) => item.id === id) || null;
}

/* -------------------------------------------------------------- 路径 */

function resolveInside(project, rel) {
  const rootAbs = path.resolve(project.root);
  const clean = typeof rel === 'string' ? rel.replace(/^[\\/]+/, '') : '';
  const abs = path.resolve(rootAbs, clean || '.');
  const relCheck = path.relative(rootAbs, abs);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    const error = new Error('超出项目根目录');
    error.status = 403;
    error.code = 'OUT_OF_ROOT';
    throw error;
  }
  return abs;
}

function relOf(project, abs) {
  const rootAbs = path.resolve(project.root);
  const rel = path.relative(rootAbs, abs);
  return rel === '' ? '' : rel.split(path.sep).join('/');
}

function kindOf(abs) {
  const ext = path.extname(abs).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (OFFICE_EXT.has(ext)) return 'office';
  if (TEXT_EXT.has(ext)) return 'text';
  return 'unknown';
}

function bucketOf(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (['.docx', '.doc', '.md', '.txt', '.rtf'].includes(ext)) return 'doc';
  if (['.pptx', '.ppt', '.key'].includes(ext)) return 'ppt';
  if (['.xlsx', '.xls', '.csv', '.xlsm'].includes(ext)) return 'xls';
  if (ext === '.pdf') return 'pdf';
  return 'other';
}


/* 用系统默认浏览器打开链接（版本页「逛仓库」等用；不经过 shell 二次解析，避免 & 被吃掉） */
function openUrlInBrowser(url) {
  return new Promise((resolve, reject) => {
    let target = String(url || '').trim();
    if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
    let child = null;
    try {
      if (process.platform === 'win32') {
        child = spawn('explorer.exe', [target], { detached: true, stdio: 'ignore', windowsHide: true });
      } else if (process.platform === 'darwin') {
        child = spawn('open', [target], { detached: true, stdio: 'ignore' });
      } else {
        child = spawn('xdg-open', [target], { detached: true, stdio: 'ignore' });
      }
    } catch (error) {
      reject(error);
      return;
    }
    child.on('error', reject);
    child.unref();
    resolve(target);
  });
}

/* -------------------------------------------------------------- 读文件 */

function decodeText(buffer) {
  try {
    const strict = new TextDecoder('utf-8', { fatal: true });
    return strict.decode(buffer);
  } catch {
    /* 落到下面 */
  }
  try {
    const gbk = new TextDecoder('gb18030');
    return gbk.decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

async function fileInfo(project, rel) {
  const abs = resolveInside(project, rel);
  const stat = await fsp.stat(abs);
  if (stat.isDirectory()) {
    const error = new Error('这是一个文件夹');
    error.status = 400;
    error.code = 'IS_DIR';
    throw error;
  }
  const ext = path.extname(abs).toLowerCase();
  let kind = kindOf(abs);
  let buffer = null;
  if (kind === 'unknown' && stat.size <= TEXT_LIMIT) {
    buffer = await fsp.readFile(abs);
    kind = buffer.includes(0) ? 'binary' : 'text';
  }
  if (kind === 'text' && !buffer) {
    buffer = stat.size > TEXT_LIMIT
      ? await readHead(abs, TEXT_LIMIT)
      : await fsp.readFile(abs);
  }
  const info = {
    rel: relOf(project, abs),
    name: path.basename(abs),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    kind,
    mime: MIME[ext] || 'application/octet-stream',
    editable: false,
    truncated: false,
    text: null
  };
  if (kind === 'text' && buffer) {
    info.text = decodeText(buffer);
    info.editable = stat.size <= TEXT_LIMIT;
    info.truncated = stat.size > TEXT_LIMIT;
  }
  return info;
}

async function readHead(abs, limit) {
  const handle = await fsp.open(abs, 'r');
  try {
    const buf = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buf, 0, limit, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function listTree(project, rel) {
  const abs = resolveInside(project, rel);
  const stat = await fsp.stat(abs);
  if (!stat.isDirectory()) {
    const error = new Error('不是一个文件夹');
    error.status = 400;
    error.code = 'NOT_DIR';
    throw error;
  }
  const dirents = await fsp.readdir(abs, { withFileTypes: true });
  const entries = [];
  for (const dirent of dirents) {
    if (entries.length >= TREE_LIMIT) break;
    const childAbs = path.join(abs, dirent.name);
    if (dirent.isDirectory() && SKIP_DIRS.has(dirent.name)) continue;
    if (dirent.name === '.DS_Store' || dirent.name === 'Thumbs.db') continue;
    let childStat = null;
    try {
      childStat = await fsp.lstat(childAbs);
    } catch {
      continue;
    }
    if (childStat.isSymbolicLink()) continue;
    const isDir = dirent.isDirectory();
    entries.push({
      name: dirent.name,
      rel: relOf(project, childAbs),
      dir: isDir,
      size: isDir ? 0 : childStat.size,
      mtimeMs: childStat.mtimeMs,
      kind: isDir ? 'dir' : kindOf(childAbs)
    });
  }
  entries.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true });
  });
  const parentRel = relOf(project, path.dirname(abs));
  return {
    rel: relOf(project, abs),
    name: path.basename(abs) || path.basename(path.resolve(project.root)),
    parent: relOf(project, abs) === '' ? null : parentRel,
    dir: true,
    entries
  };
}

/* -------------------------------------------------------------- 统计 */

const statCache = new Map();

async function projectStats(project) {
  const hit = statCache.get(project.root);
  if (hit && Date.now() - hit.at < STATS_TTL) return hit.value;
  const value = { exists: false, files: 0, doc: 0, ppt: 0, xls: 0, pdf: 0, other: 0, latest: null };
  let rootStat = null;
  try {
    rootStat = await fsp.stat(project.root);
  } catch {
    rootStat = null;
  }
  if (rootStat && rootStat.isDirectory()) {
    value.exists = true;
    value.latest = rootStat.mtimeMs;
    const walk = async (dir, depth) => {
      if (depth > 3 || value.files > 20000) return;
      let dirents = [];
      try {
        dirents = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const dirent of dirents) {
        if (value.files > 20000) return;
        if (dirent.isDirectory()) {
          if (SKIP_DIRS.has(dirent.name) || dirent.name.startsWith('.')) continue;
          await walk(path.join(dir, dirent.name), depth + 1);
        } else if (dirent.isFile()) {
          value.files += 1;
          value[bucketOf(dirent.name)] += 1;
        }
      }
    };
    await walk(project.root, 0);
  }
  statCache.set(project.root, { at: Date.now(), value });
  return value;
}

function invalidateStats(rootDir) {
  statCache.delete(rootDir);
}

/* -------------------------------------------------------------- 协作档案 */

function slugify(text) {
  const base = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'module';
}

function moduleBrief(project, module) {
  const lines = [];
  lines.push(`# 子智能体模块：${module.name}`);
  lines.push('');
  lines.push(`- 所属项目：${project.name}`);
  lines.push(`- 项目根目录：${project.root}`);
  lines.push(`- 模块编号：${module.id}`);
  lines.push('');
  lines.push('## 职责');
  lines.push(module.role || '（未填写）');
  lines.push('');
  lines.push('## 交付物');
  lines.push(module.deliverables || '（未填写）');
  lines.push('');
  lines.push('## 补充要求');
  lines.push(module.instructions || '（无）');
  lines.push('');
  lines.push('## 工作方式');
  lines.push(`1. 只处理「${module.name}」范围内的内容，跨模块的问题回报主智能体。`);
  lines.push('2. 产出文件写回项目根目录下与模块对应的目录；文件名带日期与版本。');
  lines.push('3. 完成后用三行以内汇报：做了什么、产出的文件路径、需要谁配合。');
  lines.push('');
  lines.push('<!-- 由「大肥鱼」生成，可手工修改，重新生成会覆盖。 -->');
  lines.push('');
  return lines.join('\n');
}

function archiveDoc(project, stats) {
  const active = project.modules.filter((item) => item.enabled !== false);
  const lines = [];
  lines.push(`# ${project.name} · 项目档案`);
  lines.push('');
  lines.push('> 本文档由 DeepSeek Harness 的「大肥鱼」生成，供主智能体了解项目全貌并分派子智能体。');
  lines.push('');
  lines.push('## 基本信息');
  lines.push('');
  lines.push(`- 项目名称：${project.name}`);
  lines.push(`- 本地根目录：${project.root}`);
  lines.push(`- 文档规模：文档 ${stats.doc} · 幻灯片 ${stats.ppt} · 表格 ${stats.xls} · PDF ${stats.pdf} · 其他 ${stats.other}`);
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push('');
  if (project.notes && project.notes.trim()) {
    lines.push('## 项目说明');
    lines.push('');
    lines.push(project.notes.trim());
    lines.push('');
  }
  lines.push('## 子智能体名册');
  lines.push('');
  if (active.length === 0) {
    lines.push('（尚未配置子智能体模块）');
  } else {
    lines.push('| 模块 | 职责 | 交付物 | 简报文件 |');
    lines.push('| --- | --- | --- | --- |');
    for (const module of active) {
      lines.push(
        `| ${escapeCell(module.name)} | ${escapeCell(module.role || '—')} | ${escapeCell(module.deliverables || '—')} | _pm/模块/${slugify(module.name)}.md |`
      );
    }
  }
  lines.push('');
  lines.push('## 主智能体的工作约定');
  lines.push('');
  lines.push('1. 先读本文档与 `_pm/任务看板.md`，再读要派单的模块简报。');
  lines.push('2. 按模块派发子智能体：一个模块一个子智能体，派单时把该模块的简报路径与交付要求一起给出。');
  lines.push('3. 子智能体的产出只写自己模块目录；跨模块改动由主智能体决策后统一执行。');
  lines.push('4. 所有面向公司的文档：技术方案用 Markdown，正式提交件转 PDF；汇报用 PPT；数据用 Excel 并保留原始表。');
  lines.push('5. 每轮结束把「已完成 / 进行中 / 待确认」更新到 `_pm/任务看板.md`。');
  lines.push('');
  lines.push('## 目录约定');
  lines.push('');
  lines.push('- `_pm/` 大肥鱼的协作文件（可提交到版本库或忽略）。');
  lines.push('- 其余目录沿用项目自身结构，不要为了派单而移动既有文件。');
  lines.push('');
  return lines.join('\n');
}

function escapeCell(text) {
  return String(text || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function taskBoard(project) {
  const lines = [];
  lines.push(`# ${project.name} · 任务看板`);
  lines.push('');
  lines.push('> 主智能体每轮结束更新本表。子智能体只读。');
  lines.push('');
  lines.push('## 进行中');
  lines.push('');
  lines.push('| 模块 | 任务 | 责任人 | 状态 | 产出 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const module of project.modules.filter((item) => item.enabled !== false)) {
    lines.push(`| ${escapeCell(module.name)} | （待派发） | 子智能体 | 未开始 | — |`);
  }
  lines.push('');
  lines.push('## 已完成');
  lines.push('');
  lines.push('| 模块 | 任务 | 产出 | 完成时间 |');
  lines.push('| --- | --- | --- | --- |');
  lines.push('');
  lines.push('## 待确认');
  lines.push('');
  lines.push('- ');
  lines.push('');
  return lines.join('\n');
}

async function writeBrief(project) {
  const stats = await projectStats(project);
  const dir = path.join(path.resolve(project.root), '_pm');
  const modulesDir = path.join(dir, '模块');
  await fsp.mkdir(modulesDir, { recursive: true });
  const written = [];
  const push = async (abs, text) => {
    await fsp.writeFile(abs, text, 'utf8');
    written.push(relOf(project, abs));
  };
  await push(path.join(dir, '项目档案.md'), archiveDoc(project, stats));
  await push(path.join(dir, '任务看板.md'), taskBoard(project));
  for (const module of project.modules) {
    await push(path.join(modulesDir, `${slugify(module.name)}.md`), moduleBrief(project, module));
  }
  return { dir, files: written };
}

/* -------------------------------------------------------------- 打开文件 */

function openWithSystem(abs) {
  return new Promise((resolve, reject) => {
    let child = null;
    try {
      if (process.platform === 'win32') {
        child = spawn('cmd.exe', ['/c', 'start', '', abs], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
      } else if (process.platform === 'darwin') {
        child = spawn('open', [abs], { detached: true, stdio: 'ignore' });
      } else {
        child = spawn('xdg-open', [abs], { detached: true, stdio: 'ignore' });
      }
    } catch (error) {
      reject(error);
      return;
    }
    child.on('error', reject);
    child.unref();
    resolve(true);
  });
}


function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        resolve({ tooLarge: true });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8') }));
    req.on('error', () => resolve({ text: '' }));
  });
}

function isTrustedLoopback(req) {
  const host = String(req.headers.host || '').toLowerCase();
  const hostName = host.replace(/:\d+$/, '');
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostName)) return false;
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = String(req.headers.origin || '');
  if (origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
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

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

/* ------------------------------------------------- 内嵌预览（Office → PNG） */

/** 找到 DSH 自带的 libreoffice-kit 入口（在 app.asar.unpacked 里，可被真实 fs 读到） */
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

let kitPromise = null;
let converterPromise = null;
const previewFlight = new Map();

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
    kitPromise.then(null, () => {
      kitPromise = null;
    });
  }
  return kitPromise;
}

function getConverter() {
  if (!converterPromise) {
    converterPromise = (async () => {
      const kit = await loadKit();
      return kit.createConverter({ timeoutMs: PREVIEW_TIMEOUT });
    })();
    converterPromise.then(null, () => {
      converterPromise = null;
    });
  }
  return converterPromise;
}

function previewBase(root) {
  return path.join(root, 'preview');
}

/**
 * 首选 DSH 自带的 officeKit 服务：自带排队、并发与结果缓存，并随 DSH 一起升级。
 * 服务不可用（老版本、被禁用）时返回 null，调用方退回直接加载 libreoffice-kit。
 */
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
  return crypto
    .createHash('sha1')
    .update(`${abs}|${stat.size}|${Math.round(stat.mtimeMs)}|${dpi}|v2`)
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

/** 渲染（或复用缓存）某个 office 文档的分页预览 */
async function renderPreview(ctx, root, project, rel, refresh) {
  if (!rel) throw fail(400, 'BAD_REQUEST', '要带 path');
  const abs = resolveInside(project, rel);
  const ext = path.extname(abs).toLowerCase();
  if (!PREVIEW_EXT.has(ext)) throw fail(415, 'NOT_PREVIEWABLE', '这种文件不支持内联预览');
  let stat = null;
  try {
    stat = await fsp.stat(abs);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isFile()) throw fail(404, 'NO_FILE', '文件不存在');

  const dpi = previewDpiFor(ext);
  const key = previewKey(abs, stat, dpi);
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
    if (refresh) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }

    let manifest = null;
    let serviceError = null;
    try {
      const viaService = await renderWithOfficeKit(ctx, abs, ext, stat, dir, dpi);
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
          dpi,
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

/** 清掉过期预览缓存（尽力而为，不阻塞启动） */
async function prunePreviews(root) {
  const base = previewBase(root);
  let entries = [];
  try {
    entries = await fsp.readdir(base, { withFileTypes: true });
  } catch {
    return;
  }
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(base, entry.name);
    try {
      const stat = await fsp.stat(dir);
      if (now - stat.mtimeMs > PREVIEW_MAX_AGE) await fsp.rm(dir, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  }
}

/* -------------------------------------------- 面板内对话（sessionController） */

const OVERVIEW_ID = 'overview';

function sessionControllerOf(ctx) {
  let service = null;
  try {
    service = ctx.get('sessionController');
  } catch {
    service = null;
  }
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
    const role = String(message.role || message.author?.role || message.source || '').toLowerCase();
    const normalized = role === 'user' || role === 'human' ? 'user'
      : role === 'assistant' || role === 'agent' ? 'assistant'
        : '';
    if (!normalized) continue;
    const text = textFromContent(message.content ?? message.parts ?? message.text);
    if (!text) continue;
    if (normalized === 'user' && /^(<system-reminder|Time sampled|The user changed the)/i.test(text.trim())) continue;
    const time = Number(message.time ?? message.createdAt ?? message.timestamp ?? 0) || 0;
    items.push({ role: normalized, text: text.slice(0, 20000), time });
  }
  return items;
}

async function readMessages(ctx, sessionId, limit) {
  const sessionsService = (() => {
    try {
      return ctx.get('sessions');
    } catch {
      return null;
    }
  })();
  let raw = null;
  try {
    const session = sessionsService?.get?.(sessionId);
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
      raw = (page?.records || []).map((record) => {
        const event = record?.event || {};
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
  if (!controller) return { running: false, active: false, queued: 0, pendingInput: [] };
  try {
    const state = await controller.state({ sessionId }, new AbortController().signal);
    return {
      running: Boolean(state?.running),
      active: Boolean(state?.active),
      queued: Array.isArray(state?.queue) ? state.queue.length : 0,
      pendingInput: Array.isArray(state?.pendingInput) ? state.pendingInput : []
    };
  } catch {
    return { running: false, active: false, queued: 0, pendingInput: [] };
  }
}

async function sendChat(ctx, sessionId, text) {
  const controller = requireController(ctx);
  const requestId = `pmw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await controller.prompt({
    requestId,
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text }],
    clientTimeZone: 'Asia/Shanghai'
  }, new AbortController().signal);
  return { accepted: true, requestId };
}

/* --------------------------------- 输入框增强（模型 / 权限 / @ 文件 / 斜杠） */

const PERMISSION_PRESETS = [
  { id: 'read-only', name: '只读', hint: '只能看，不能改文件' },
  { id: 'workspace-write', name: '标准模式', hint: '能改项目文件，其它操作先问你' },
  { id: 'danger-full-access', name: '完全权限', hint: '不再逐条征求批准' }
];

function serviceOf(ctx, name) {
  try {
    const service = ctx.get(name);
    return service && typeof service === 'object' ? service : null;
  } catch {
    return null;
  }
}

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
    if (event && event.type === 'permission/preset' && event.data && event.data.preset) {
      return String(event.data.preset);
    }
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
  const groups = (catalog && Array.isArray(catalog.groups)) ? catalog.groups : [];
  for (const group of groups) {
    const models = Array.isArray(group.models) ? group.models : [];
    for (const model of models) {
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
  const models = flattenCatalog(catalog);
  const stored = sessionId && state.settings && state.settings.models ? state.settings.models[sessionId] : null;
  const selection = stored || modelSelectionOf(ctx, sessionId) || (catalog && catalog.default) || null;
  return {
    sessionId: sessionId || '',
    models,
    defaultSelection: (catalog && catalog.default) || null,
    selection: selection || null,
    permission: {
      preset: permissionPresetOf(ctx, sessionId),
      presets: PERMISSION_PRESETS
    },
    commands: await commandListOf(ctx, sessionId)
  };
}

async function mentionCandidates(project, query) {
  const files = await walkFiles(project, { maxDepth: 6, limit: 3000 });
  const keyword = String(query || '').toLowerCase();
  const scored = [];
  for (const file of files) {
    const lower = file.rel.toLowerCase();
    if (keyword && !lower.includes(keyword)) continue;
    const nameHit = file.name.toLowerCase().includes(keyword);
    scored.push({ path: file.rel, score: keyword ? (nameHit ? 0 : 1) : 0, size: file.size });
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
  const result = executed && executed.result ? executed.result : {};
  const type = String(result.kind || result.type || '');
  const text = String(result.text || result.message || '');
  return { commandId: executed ? executed.commandId : '', kind: type, text: text.slice(0, 4000) };
}

function chatSessionId(state, params, payload) {
  const target = String(
    (payload && payload.target) || (params && params.get('target')) || ''
  );
  if (target === OVERVIEW_ID) {
    const id = state.settings?.overviewSessionId;
    if (!id) throw fail(409, 'NO_SESSION', '总览还没有绑定会话，先点「新建会话」');
    return id;
  }
  const projectId = String((payload && payload.projectId) || (params && params.get('projectId')) || '');
  const project = findProject(state, projectId);
  if (!project) throw fail(404, 'NO_PROJECT', '找不到这个项目');
  if (!project.leadSessionId) throw fail(409, 'NO_SESSION', '这个项目还没有绑定主智能体会话');
  return project.leadSessionId;
}

/* 读会话时用：没绑定会话返回 null，而不是报错（前端显示空态提示） */
function optionalChatSessionId(state, params) {
  try {
    return chatSessionId(state, params, null);
  } catch (error) {
    if (error && (error.code === 'NO_SESSION' || error.status === 409)) return null;
    throw error;
  }
}

/* ---------------------------------------------------- 总览 / 检索 / 汇报 */

const NOTE_EXT = new Set(['.md', '.markdown', '.txt', '.json', '.csv', '.yml', '.yaml', '.log', '.tsv']);

async function walkFiles(project, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 4;
  const limit = Number.isFinite(options.limit) ? options.limit : 4000;
  const sinceMs = Number(options.sinceMs) || 0;
  const out = [];
  const walk = async (rel, depth) => {
    if (out.length >= limit || depth > maxDepth) return;
    let dirents = [];
    try {
      dirents = await fsp.readdir(path.join(project.root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (out.length >= limit) return;
      if (SKIP_DIRS.has(dirent.name) || dirent.name === '.DS_Store' || dirent.name === 'Thumbs.db') continue;
      const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        await walk(childRel, depth + 1);
        continue;
      }
      if (!dirent.isFile()) continue;
      const abs = path.join(project.root, childRel);
      let stat = null;
      try {
        stat = await fsp.stat(abs);
      } catch {
        continue;
      }
      if (stat.mtimeMs < sinceMs) continue;
      out.push({
        rel: childRel,
        name: dirent.name,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        kind: kindOf(abs),
        bucket: bucketOf(dirent.name)
      });
    }
  };
  await walk('', 0);
  return out;
}

async function readBoard(project) {
  const file = path.join(project.root, '_pm', '任务看板.md');
  let text = '';
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch {
    return null;
  }
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*[-*]\s*\[([ xX])\]\s*(.+)$/.exec(line);
    if (!match) continue;
    items.push({ done: match[1].toLowerCase() === 'x', text: match[2].trim() });
    if (items.length >= 200) break;
  }
  if (!items.length) return { open: 0, done: 0, items: [], exists: true };
  const done = items.filter((item) => item.done).length;
  return { open: items.length - done, done, total: items.length, items, exists: true };
}

const RANGE_DAYS = { week: 7, month: 30 };

async function overviewValue(state) {
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 3600 * 1000;
  const projects = [];
  const totals = { projects: 0, files: 0, doc: 0, ppt: 0, xls: 0, pdf: 0, other: 0, weekChanged: 0, open: 0, done: 0 };
  for (const project of state.projects) {
    const stats = await projectStats(project);
    const files = await walkFiles(project, { sinceMs: weekAgo, limit: 600, maxDepth: 4 });
    const board = await readBoard(project);
    const recent = files
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 6)
      .map((file) => ({ rel: file.rel, name: file.name, mtimeMs: file.mtimeMs, bucket: file.bucket }));
    projects.push({
      id: project.id,
      name: project.name,
      root: project.root,
      stats,
      weekChanged: files.length,
      recent,
      board: board ? { open: board.open, done: board.done, total: board.total ?? board.open + board.done } : null,
      modules: project.modules.length,
      leadSessionId: project.leadSessionId
    });
    totals.projects += 1;
    totals.files += stats.files || 0;
    totals.doc += stats.doc || 0;
    totals.ppt += stats.ppt || 0;
    totals.xls += stats.xls || 0;
    totals.pdf += stats.pdf || 0;
    totals.other += stats.other || 0;
    totals.weekChanged += files.length;
    totals.open += board?.open || 0;
    totals.done += board?.done || 0;
  }
  projects.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
  return { projects, totals, generatedAt: now, overviewSessionId: state.settings?.overviewSessionId || null };
}

async function searchAll(state, query, projectIds) {
  const needle = String(query || '').trim();
  if (needle.length < 1) throw fail(400, 'BAD_REQUEST', '要给个关键词');
  const lowered = needle.toLowerCase();
  const wanted = Array.isArray(projectIds) && projectIds.length
    ? state.projects.filter((project) => projectIds.includes(project.id))
    : state.projects;
  const hits = [];
  for (const project of wanted) {
    const files = await walkFiles(project, { limit: 3000, maxDepth: 4 });
    for (const file of files) {
      if (file.name.toLowerCase().includes(lowered)) {
        hits.push({
          projectId: project.id,
          projectName: project.name,
          rel: file.rel,
          name: file.name,
          kind: 'name',
          line: 0,
          snippet: ''
        });
        if (hits.length >= 120) return hits;
        continue;
      }
      if (!NOTE_EXT.has(path.extname(file.name).toLowerCase())) continue;
      if (file.size > 512 * 1024) continue;
      let text = '';
      try {
        text = decodeText(await fsp.readFile(path.join(project.root, file.rel)));
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].toLowerCase().includes(lowered)) continue;
        hits.push({
          projectId: project.id,
          projectName: project.name,
          rel: file.rel,
          name: file.name,
          kind: 'content',
          line: index + 1,
          snippet: lines[index].trim().slice(0, 220)
        });
        if (hits.length >= 120) return hits;
      }
    }
  }
  return hits;
}

function formatDate(ms) {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function stampName() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

async function reportValue(state, range, projectIds) {
  const days = RANGE_DAYS[range] || RANGE_DAYS.week;
  const since = Date.now() - days * 24 * 3600 * 1000;
  const label = range === 'month' ? '月报' : '周报';
  const wanted = Array.isArray(projectIds) && projectIds.length
    ? state.projects.filter((project) => projectIds.includes(project.id))
    : state.projects;
  const lines = [];
  lines.push(`# ${label} 路 ${formatDate(Date.now())}`);
  lines.push('');
  lines.push(`统计区间：${formatDate(since)} → ${formatDate(Date.now())}；覆盖项目 ${wanted.length} 个。`);
  lines.push('');
  for (const project of wanted) {
    const files = (await walkFiles(project, { sinceMs: since, limit: 800, maxDepth: 4 }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    const board = await readBoard(project);
    lines.push(`## ${project.name}`);
    lines.push('');
    lines.push(`- 目录：\`${project.root}\``);
    if (files.length) {
      const byBucket = {};
      for (const file of files) byBucket[file.bucket] = (byBucket[file.bucket] || 0) + 1;
      const summary = Object.entries(byBucket).map(([key, value]) => `${bucketLabel(key)} ${value}`).join('、');
      lines.push(`- 本期改动：${files.length} 个文件（${summary}）`);
      for (const file of files.slice(0, 12)) {
        lines.push(`  - ${formatDate(file.mtimeMs)} ${file.rel}`);
      }
      if (files.length > 12) lines.push(`  - …另有 ${files.length - 12} 个`);
    } else {
      lines.push('- 本期改动：无');
    }
    if (board) {
      lines.push(`- 看板：未完成 ${board.open} 项，已完成 ${board.done} 项`);
      for (const item of board.items.filter((entry) => !entry.done).slice(0, 8)) {
        lines.push(`  - [ ] ${item.text}`);
      }
    }
    if (project.modules.length) {
      lines.push(`- 模块：${project.modules.map((module) => module.name).join('、')}`);
    }
    if (project.notes) lines.push(`- 备注：${project.notes.replace(/\s+/g, ' ').slice(0, 160)}`);
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('以上为自动汇总的事实清单，可直接交给主智能体润色成正式周报。');
  return { range, label, markdown: lines.join('\n'), since, projects: wanted.length };
}

function bucketLabel(key) {
  if (key === 'doc') return '文档';
  if (key === 'ppt') return 'PPT';
  if (key === 'xls') return '表格';
  if (key === 'pdf') return 'PDF';
  return '其它';
}

/* -------------------------------------------------------------- 路由 */

async function handleGet(ctx, req, res, route, params, root) {
  const state = await loadState(root);

  if (route === '/state') {
    const projects = [];
    for (const project of state.projects) {
      projects.push({ ...project, stats: await projectStats(project) });
    }
    sendJson(res, 200, {
      ok: true,
      value: {
        projects,
        presets: MODULE_PRESETS,
        settings: state.settings,
      }
    });
    return;
  }

  if (route === '/version') {
    const info = await currentVersionInfo();
    const index = await readVersionIndex(root);
    const hash = await hashSnapshotFiles();
    const currentName = await readCurrentPackageName();
    const entries = [];
    for (const entry of index.entries) {
      const snapshotName = entry.dir
        ? await readSnapshotName(path.join(versionRoot(root), entry.dir))
        : '';
      entries.push({
        ...entry,
        restorable: Boolean(entry.dir) && (!snapshotName || !currentName || snapshotName === currentName)
      });
    }
    const repositoryUrl = String(state.settings?.repositoryUrl || '').trim();
    const commits = await commitLog(await readPackageVersion(), 20, repositoryUrl);
    sendJson(res, 200, {
      ok: true,
      value: {
        ...info,
        dataDir: root,
        hash,
        repositoryUrl,
        history: entries,
        commits
      }
    });
    return;
  }

  if (route === '/overview') {
    const value = await overviewValue(state);
    sendJson(res, 200, { ok: true, value });
    return;
  }

  if (route === '/search') {
    const query = params.get('q') || '';
    const ids = (params.get('projects') || '').split(',').map((item) => item.trim()).filter(Boolean);
    const hits = await searchAll(state, query, ids);
    sendJson(res, 200, { ok: true, value: { hits, query } });
    return;
  }

  if (route === '/report') {
    const range = params.get('range') === 'month' ? 'month' : 'week';
    const ids = (params.get('projects') || '').split(',').map((item) => item.trim()).filter(Boolean);
    const value = await reportValue(state, range, ids);
    sendJson(res, 200, { ok: true, value });
    return;
  }

  if (route === '/composer') {
    const sessionId = optionalChatSessionId(state, params) || '';
    const value = await composerValue(ctx, state, sessionId);
    sendJson(res, 200, { ok: true, value: { ...value, bound: Boolean(sessionId) } });
    return;
  }

  if (route === '/mentions') {
    const project = findProject(state, String(params.get('projectId') || ''));
    if (!project) throw fail(404, 'NO_PROJECT', '找不到这个项目');
    const items = await mentionCandidates(project, String(params.get('q') || ''));
    sendJson(res, 200, { ok: true, value: { items } });
    return;
  }

  if (route === '/chat/messages') {
    const sessionId = optionalChatSessionId(state, params);
    const limit = Math.min(200, Math.max(4, Number(params.get('limit')) || 40));
    const items = sessionId ? await readMessages(ctx, sessionId, limit) : [];
    const status = sessionId ? await chatState(ctx, sessionId) : { running: false, active: false, queued: 0 };
    sendJson(res, 200, { ok: true, value: { sessionId, items, status } });
    return;
  }

  if (route === '/chat/state') {
    const sessionId = optionalChatSessionId(state, params);
    const status = sessionId ? await chatState(ctx, sessionId) : { running: false, active: false, queued: 0 };
    sendJson(res, 200, { ok: true, value: { sessionId, status } });
    return;
  }

  if (route === '/presets') {
    sendJson(res, 200, { ok: true, value: { presets: MODULE_PRESETS } });
    return;
  }

  const needProject = () => {
    const project = findProject(state, params.get('projectId') || '');
    if (!project) throw fail(404, 'NO_PROJECT', '找不到这个项目');
    return project;
  };

  if (route === '/tree') {
    const project = needProject();
    const value = await listTree(project, params.get('path') || '');
    sendJson(res, 200, { ok: true, value });
    return;
  }

  if (route === '/file') {
    const project = needProject();
    const value = await fileInfo(project, params.get('path') || '');
    sendJson(res, 200, { ok: true, value });
    return;
  }

  if (route === '/raw') {
    const project = needProject();
    const abs = resolveInside(project, params.get('path') || '');
    const buffer = await fsp.readFile(abs);
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': String(buffer.length),
      'cache-control': 'no-store'
    });
    res.end(buffer);
    return;
  }

  if (route === '/preview/tile') {
    const project = needProject();
    const rel = params.get('path') || '';
    const tile = String(params.get('tile') || '');
    if (!/^[A-Za-z0-9._-]+\.png$/.test(tile) || tile.includes('..')) {
      throw fail(400, 'BAD_TILE', '非法的预览图片名');
    }
    const abs = resolveInside(project, rel);
    let stat = null;
    try {
      stat = await fsp.stat(abs);
    } catch {
      stat = null;
    }
    if (!stat) throw fail(404, 'NO_FILE', '文件不存在');
    const dir = path.join(previewBase(root), previewKey(abs, stat, previewDpiFor(path.extname(abs).toLowerCase())));
    const file = path.join(dir, tile);
    let buffer = null;
    try {
      buffer = await fsp.readFile(file);
    } catch {
      buffer = null;
    }
    if (!buffer) throw fail(404, 'NO_TILE', '预览已失效，请重新生成');
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': String(buffer.length),
      'cache-control': 'private, max-age=600'
    });
    res.end(buffer);
    return;
  }

  sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `没有这个端点：${route}` } });
}

async function handlePost(ctx, req, res, route, root) {
  const body = await readBody(req);
  if (body.tooLarge) throw fail(413, 'TOO_LARGE', '请求体太大');
  let payload = {};
  if (body.text) {
    try {
      payload = JSON.parse(body.text);
    } catch {
      throw fail(400, 'BAD_JSON', 'body 不是合法 JSON');
    }
  }
  const state = await loadState(root);

  if (route === '/project/create') {
    const projectRoot = String(payload.root || '').trim();
    if (!projectRoot) throw fail(400, 'BAD_REQUEST', '要带 root（项目目录）');
    const absRoot = path.resolve(projectRoot);
    let stat = null;
    try {
      stat = await fsp.stat(absRoot);
    } catch {
      stat = null;
    }
    if (!stat || !stat.isDirectory()) throw fail(400, 'NO_DIR', `目录不存在：${absRoot}`);
    const exists = state.projects.find((item) => path.resolve(item.root).toLowerCase() === absRoot.toLowerCase());
    if (exists) throw fail(409, 'DUPLICATE', `这个目录已经在项目里了：${exists.name}`);
    const now = new Date().toISOString();
    const project = normalizeProject({
      id: newId('p'),
      name: String(payload.name || '').trim() || path.basename(absRoot) || '未命名项目',
      root: absRoot,
      color: String(payload.color || ''),
      modules: Array.isArray(payload.modules) ? payload.modules : [],
      createdAt: now,
      updatedAt: now
    });
    state.projects.unshift(project);
    await saveState(root, state);
    invalidateStats(absRoot);
    sendJson(res, 200, { ok: true, value: { project, stats: await projectStats(project) } });
    return;
  }

  if (route === '/project/update') {
    const project = findProject(state, String(payload.id || ''));
    if (!project) throw fail(404, 'NO_PROJECT', '找不到这个项目');
    const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch : {};
    if (typeof patch.name === 'string' && patch.name.trim()) project.name = patch.name.trim();
    if (typeof patch.color === 'string') project.color = patch.color;
    if (typeof patch.notes === 'string') project.notes = patch.notes;
    if (typeof patch.lastRel === 'string') project.lastRel = patch.lastRel;
    if (typeof patch.workspaceId === 'string' || patch.workspaceId === null) project.workspaceId = patch.workspaceId;
    if (typeof patch.leadSessionId === 'string' || patch.leadSessionId === null) project.leadSessionId = patch.leadSessionId;
    if (Array.isArray(patch.modules)) project.modules = patch.modules.map(normalizeModule).filter(Boolean);
    if (typeof patch.root === 'string' && patch.root.trim() && !payload.id) project.root = patch.root;
    project.updatedAt = new Date().toISOString();
    await saveState(root, state);
    sendJson(res, 200, { ok: true, value: { project, stats: await projectStats(project) } });
    return;
  }

  if (route === '/project/delete') {
    const id = String(payload.id || '');
    const index = state.projects.findIndex((item) => item.id === id);
    if (index < 0) throw fail(404, 'NO_PROJECT', '找不到这个项目');
    const [removed] = state.projects.splice(index, 1);
    await saveState(root, state);
    if (removed) statCache.delete(removed.root);
    sendJson(res, 200, { ok: true, value: { projects: state.projects } });
    return;
  }

  if (route === '/version/repository') {
    const raw = String(payload.url || '').trim();
    if (!raw) {
      state.settings.repositoryUrl = '';
      await saveState(root, state);
      sendJson(res, 200, { ok: true, value: { repositoryUrl: '' } });
      return;
    }
    if (!/^https?:\/\//i.test(raw) || !githubSlug(raw)) {
      throw fail(400, 'BAD_URL', '要填 GitHub 仓库地址，例如 https://github.com/你的账号/dafeiyu');
    }
    state.settings.repositoryUrl = raw;
    await saveState(root, state);
    sendJson(res, 200, { ok: true, value: { repositoryUrl: raw } });
    return;
  }

  if (route === '/version/snapshot') {
    const result = await snapshotVersion(root, {
      kind: 'manual',
      note: payload.note,
      force: true
    });
    sendJson(res, 200, {
      ok: true,
      value: { entry: result.entry, history: result.index.entries }
    });
    return;
  }

  if (route === '/version/rollback') {
    const result = await restoreVersion(root, String(payload.id || ''));
    sendJson(res, 200, { ok: true, value: result });
    return;
  }

  if (route === '/file/save') {
    const project = findProject(state, String(payload.projectId || ''));
    if (!project) throw fail(404, 'NO_PROJECT', '找不到这个项目');
    const rel = String(payload.path || '');
    if (!rel) throw fail(400, 'BAD_REQUEST', '要带 path');
    const abs = resolveInside(project, rel);
    let stat = null;
    try {
      stat = await fsp.stat(abs);
    } catch {
      stat = null;
    }
    const text = typeof payload.text === 'string' ? payload.text : '';
    if (Buffer.byteLength(text, 'utf8') > TEXT_LIMIT) throw fail(413, 'TOO_LARGE', '文件太大，请用外部程序编辑');
    if (payload.baseMtimeMs && stat && Math.abs(stat.mtimeMs - Number(payload.baseMtimeMs)) > 1) {
      throw fail(409, 'CONFLICT', '文件已被其它程序修改，先刷新再保存');
    }
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.pmw.tmp`;
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, abs);
    const after = await fsp.stat(abs);
    invalidateStats(project.root);
    sendJson(res, 200, { ok: true, value: { mtimeMs: after.mtimeMs, size: after.size } });
    return;
  }

  if (route === '/file/mkdir') {
    const project = findProject(state, String(payload.projectId || ''));
    if (!project) throw fail(404, 'NO_PROJECT', '找不到这个项目');
    const dirRel = String(payload.path || '');
    const dirName = String(payload.name || '').trim();
    if (!dirName) throw fail(400, 'BAD_REQUEST', '要带 name');
    const parentAbs = resolveInside(project, dirRel);
    const abs = path.join(parentAbs, dirName);
    await fsp.mkdir(abs, { recursive: true });
    invalidateStats(project.root);
    sendJson(res, 200, { ok: true, value: { rel: relOf(project, abs) } });
    return;
  }

  if (route === '/brief') {
    const project = findProject(state, String(payload.projectId || ''));
    if (!project) throw fail(404, 'NO_PROJECT', '找不到这个项目');
    const value = await writeBrief(project);
    invalidateStats(project.root);
    sendJson(res, 200, { ok: true, value });
    return;
  }

  if (route === '/openlink') {
    const raw = String(payload.url || '').trim();
    if (!raw) throw fail(400, 'BAD_REQUEST', '要带 url');
    if (!/^(https?:\/\/|\/\/)/i.test(raw) && !/^[\w.-]+\.[a-z]{2,}/i.test(raw)) {
      throw fail(400, 'BAD_URL', `不像是一个网址：${raw}`);
    }
    const opened = await openUrlInBrowser(raw);
    sendJson(res, 200, { ok: true, value: { opened } });
    return;
  }

  if (route === '/open') {
    const project = findProject(state, String(payload.projectId || ''));
    if (!project) throw fail(404, 'NO_PROJECT', '找不到这个项目');
    const abs = resolveInside(project, String(payload.path || ''));
    let stat = null;
    try {
      stat = await fsp.stat(abs);
    } catch {
      stat = null;
    }
    if (!stat) throw fail(404, 'NO_FILE', '文件不存在');
    await openWithSystem(abs);
    sendJson(res, 200, { ok: true, value: { opened: abs } });
    return;
  }

  if (route === '/preview') {
    const project = findProject(state, String(payload.projectId || ''));
    if (!project) throw fail(404, 'NO_PROJECT', '找不到这个项目');
    const value = await renderPreview(ctx, root, project, String(payload.path || ''), Boolean(payload.refresh));
    sendJson(res, 200, { ok: true, value });
    return;
  }

  if (route === '/chat/new') {
    const controller = requireController(ctx);
    const target = String(payload.target || '');
    const project = target === OVERVIEW_ID
      ? null
      : findProject(state, String(payload.projectId || ''));
    if (target !== OVERVIEW_ID && !project) throw fail(404, 'NO_PROJECT', '找不到这个项目');
    const request = project
      ? (project.workspaceId ? { workspaceId: project.workspaceId } : { cwd: project.root })
      : { cwd: root };
    const created = await controller.create(request);
    const sessionId = String(created?.sessionId || '');
    if (!sessionId) throw fail(502, 'CREATE_FAILED', '新建会话失败');
    if (project) {
      project.leadSessionId = sessionId;
      project.updatedAt = new Date().toISOString();
    } else {
      state.settings.overviewSessionId = sessionId;
    }
    await saveState(root, state);
    sendJson(res, 200, { ok: true, value: { sessionId } });
    return;
  }

  if (route === '/chat/send') {
    const text = String(payload.text || '').trim();
    if (!text) throw fail(400, 'BAD_REQUEST', '消息不能为空');
    if (Buffer.byteLength(text, 'utf8') > 64 * 1024) throw fail(413, 'TOO_LARGE', '这条消息太长了');
    const sessionId = chatSessionId(state, null, payload);
    const value = await sendChat(ctx, sessionId, text);
    sendJson(res, 200, { ok: true, value: { ...value, sessionId } });
    return;
  }

  if (route === '/composer/model') {
    const sessionId = chatSessionId(state, null, payload);
    const controller = requireController(ctx);
    const pick = String(payload.model || '');
    if (!pick) throw fail(400, 'BAD_REQUEST', '要指定模型');
    const models = flattenCatalog(await modelCatalogOf(ctx));
    const wanted = models.find((item) => item.model === pick
      && (!payload.provider || item.provider === String(payload.provider))) || null;
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
    const saved = result && result.selected ? result.selected : selection;
    if (!state.settings.models) state.settings.models = {};
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
    const sessionId = chatSessionId(state, null, payload);
    const preset = String(payload.preset || '');
    if (!PERMISSION_PRESETS.some((item) => item.id === preset)) {
      throw fail(400, 'BAD_PRESET', '不认识的权限模式');
    }
    const run = await runCommand(ctx, sessionId, `/permission ${preset}`);
    sendJson(res, 200, { ok: true, value: { preset, ...run } });
    return;
  }

  if (route === '/command') {
    const line = String(payload.line || '').trim();
    if (!line.startsWith('/')) throw fail(400, 'BAD_COMMAND', '命令要以 / 开头');
    const sessionId = chatSessionId(state, null, payload);
    const run = await runCommand(ctx, sessionId, line);
    sendJson(res, 200, { ok: true, value: { sessionId, ...run } });
    return;
  }

  if (route === '/settings/update') {
    const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch : {};
    if ('overviewSessionId' in patch) {
      state.settings.overviewSessionId = typeof patch.overviewSessionId === 'string' && patch.overviewSessionId
        ? patch.overviewSessionId
        : null;
    }
    await saveState(root, state);
    sendJson(res, 200, { ok: true, value: { settings: state.settings } });
    return;
  }

  if (route === '/report/save') {
    const text = typeof payload.text === 'string' ? payload.text : '';
    if (!text.trim()) throw fail(400, 'BAD_REQUEST', '报告内容为空');
    if (Buffer.byteLength(text, 'utf8') > TEXT_LIMIT) throw fail(413, 'TOO_LARGE', '报告太长了');
    const projectId = String(payload.projectId || '');
    const label = payload.range === 'month' ? '月报' : '周报';
    const base = projectId
      ? findProject(state, projectId)?.root
      : path.join(root, 'reports');
    if (!base) throw fail(404, 'NO_PROJECT', '找不到这个项目');
    const dir = projectId ? path.join(base, '_pm') : base;
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${label}-${stampName()}.md`);
    await fsp.writeFile(file, text, 'utf8');
    invalidateStats(base);
    sendJson(res, 200, { ok: true, value: { file, rel: projectId ? `_pm/${path.basename(file)}` : path.basename(file) } });
    return;
  }

  if (route === '/probe') {
    const abs = path.resolve(String(payload.path || '').trim() || '.');
    let stat = null;
    try {
      stat = await fsp.stat(abs);
    } catch {
      stat = null;
    }
    if (!stat || !stat.isDirectory()) {
      sendJson(res, 200, { ok: true, value: { path: abs, exists: false, isDir: false, entries: 0 } });
      return;
    }
    let entries = 0;
    try {
      entries = (await fsp.readdir(abs)).length;
    } catch {
      entries = -1;
    }
    sendJson(res, 200, {
      ok: true,
      value: { path: abs, exists: true, isDir: true, entries, name: path.basename(abs) }
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `没有这个端点：${route}` } });
}

async function handleApi(ctx, req, res, root) {
  const url = String(req.url || '');
  const route = url.split('?')[0].slice(API_BASE.length) || '/';
  const method = String(req.method || 'GET').toUpperCase();
  const queryIndex = url.indexOf('?');
  const params = new URLSearchParams(queryIndex >= 0 ? url.slice(queryIndex + 1) : '');
  try {
    if (method === 'GET') {
      await handleGet(ctx, req, res, route, params, root);
      return;
    }
    if (method === 'POST') {
      await handlePost(ctx, req, res, route, root);
      return;
    }
    sendJson(res, 405, { ok: false, error: { code: 'BAD_METHOD', message: `不支持 ${method}` } });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) {
      try {
        ctx?.logger?.('dafeiyu')?.warn?.(`[dafeiyu] ${error?.stack || error}`);
      } catch {
        /* 忽略 */
      }
    }
    sendJson(res, status, {
      ok: false,
      error: { code: String(error?.code || 'INTERNAL'), message: String(error?.message || error) }
    });
  }
}

/* -------------------------------------------------------------- 入口 */

export function apply(ctx) {
  const log = (ctx && typeof ctx.logger === 'function' ? ctx.logger(name) : null) || console;
  const root = dataRoot();

  let connection = null;
  try {
    connection = ctx?.connection || null;
  } catch {
    connection = null;
  }

  const handler = async (req, res) => {
    try {
      let rejection = null;
      try {
        if (connection && typeof connection.requestRejection === 'function') {
          rejection = await connection.requestRejection(req);
        }
      } catch {
        rejection = null;
      }
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
      await handleApi(ctx, req, res, root);
    } catch (error) {
      log.warn?.(`[dafeiyu] ${error?.stack || error}`);
      try {
        sendJson(res, 500, { ok: false, error: { code: 'INTERNAL', message: String(error?.message || error) } });
      } catch {
        /* 头已发出 */
      }
    }
  };

  const disposeRoute = normalizeDispose(ctx.webServer.register({ kind: 'prefix', path: API_BASE, handler }));
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => disposeRoute(), 'dafeiyu：注销大肥鱼 API 路由');
    ctx.effect(() => () => {
      const pending = converterPromise;
      converterPromise = null;
      kitPromise = null;
      if (pending) {
        pending
          .then((converter) => converter?.dispose?.())
          .catch(() => {
            /* 引擎没起来就别管了 */
          });
      }
    }, 'dafeiyu：释放文档渲染引擎');
  }

  /* 启动顺序：先搬旧数据，再读台账，最后给当前版本留快照 */
  (async () => {
    try {
      const legacy = await migrateLegacyData(root);
      if (legacy) log.info?.(`[dafeiyu] 已把旧数据目录 ${legacy} 复制到 ${root}`);
    } catch (error) {
      log.warn?.(`[dafeiyu] 旧数据迁移失败：${error?.message || error}`);
    }
    try {
      await loadState(root);
    } catch (error) {
      log.warn?.(`[dafeiyu] 读取台账失败：${error?.message || error}`);
    }
    try {
      const result = await snapshotVersion(root, { kind: 'startup' });
      if (result.created) log.info?.(`[dafeiyu] 已记录版本快照 ${result.entry.id}`);
    } catch (error) {
      log.warn?.(`[dafeiyu] 版本快照失败：${error?.message || error}`);
    }
  })();
  prunePreviews(root).catch(() => {});
  log.info?.(`[dafeiyu] 大肥鱼 API 挂在 ${API_BASE}，数据目录 ${root}`);
}
