// keel-h init 行为探针（ADR 0014）。注入替身测 comet 检测/安装确认；
// 真实 runInit 测应然资产挂接（复用/异根/散落/幂等）。全程 tmpdir，不触网络。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCometBin, ensureComet, runInit } from './init.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillSource = readFileSync(path.join(repoRoot, 'skills/keel/SKILL.md'), 'utf8');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' —— ' + detail}`);
  if (!cond) failures++;
};
const tmp = (prefix) => realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
const capture = (fn) => {
  const out = [];
  const o1 = console.log, o2 = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try { return { rc: fn(), out: out.join('\n') }; }
  finally { console.log = o1; console.error = o2; }
};

// ---- A. comet 检测与安装确认（注入替身） ----
{
  const RR = '/fake/repo';
  const DEP = `${RR}/node_modules/@rpamis/comet/bin/comet.js`;
  const CKO = '/fake/comet/bin/comet.js';
  const setExists = (set) => (p) => set.has(p);

  const s1 = new Set([DEP]);
  check('A1 依赖命中', resolveCometBin({ repoRoot: RR, env: {}, exists: setExists(s1) }) === DEP);

  const s2 = new Set([CKO]);
  check('A2 开发检出兜底', resolveCometBin({ repoRoot: RR, env: {}, exists: setExists(s2) }) === CKO);

  const s3 = new Set();
  check('A3 双缺失返回 null', resolveCometBin({ repoRoot: RR, env: {}, exists: setExists(s3) }) === null);

  let threw = false;
  try { resolveCometBin({ repoRoot: RR, env: { COMET_BIN: '/nope/comet.js' }, exists: setExists(s3) }); }
  catch { threw = true; }
  check('A4 COMET_BIN 失效响亮报错', threw);

  let calls = 0;
  const r5 = await ensureComet({ repoRoot: RR, env: {}, exists: setExists(s3),
    installer: () => { calls++; return { ok: true }; }, input: { isTTY: false } });
  check('A5 非 TTY 无 --yes 拒绝', r5 === null && calls === 0);

  const s6 = new Set();
  calls = 0;
  const r6 = await ensureComet({ repoRoot: RR, assumeYes: true, env: {}, exists: setExists(s6),
    installer: () => { calls++; s6.add(DEP); return { ok: true }; }, input: { isTTY: false } });
  check('A6 --yes 自动安装并复检命中', r6 === DEP && calls === 1);

  calls = 0;
  const r7 = await ensureComet({ repoRoot: RR, env: {}, exists: setExists(s3),
    installer: () => { calls++; return { ok: true }; }, input: { isTTY: true },
    ask: async () => 'n' });
  check('A7 交互拒绝不安装', r7 === null && calls === 0);

  const s8 = new Set();
  calls = 0;
  const r8 = await ensureComet({ repoRoot: RR, env: {}, exists: setExists(s8),
    installer: () => { calls++; s8.add(DEP); return { ok: true }; }, input: { isTTY: true },
    ask: async () => 'y' });
  check('A8 交互确认后安装', r8 === DEP && calls === 1);

  const r9 = await ensureComet({ repoRoot: RR, assumeYes: true, env: {}, exists: setExists(s3),
    installer: () => ({ ok: false, stderr: 'EACCES' }), input: { isTTY: false } });
  check('A9 安装失败报手动修复', r9 === null);
}

// ---- B. 应然资产挂接（真实 runInit，注入 comet） ----
const gitInit = (dir) => execFileSync('git', ['init', '-q'], { cwd: dir });
const put = (p, text) => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, text); };
const init = (root) => capture(() => runInit({ projectRoot: root, repoRoot, comet: 'comet-for-probe' }));

// B1 greenfield
{
  const p = tmp('keel-init-g-'); gitInit(p);
  const { rc, out } = init(p);
  check('B1 greenfield exit 0', rc === 0, out);
  const prof = path.join(p, 'product/stack-profile.yaml');
  check('B1 生成 stack-profile 且项目名已替换',
    existsSync(prof) && readFileSync(prof, 'utf8').includes(`product: ${path.basename(p)}`));
  check('B1 不写 atlas.config.yaml', !existsSync(path.join(p, 'atlas.config.yaml')));
  check('B1 装配 .atlas + VERSION + .comet',
    existsSync(path.join(p, '.atlas/scripts/atlas_check.py'))
    && existsSync(path.join(p, '.atlas/VERSION'))
    && existsSync(path.join(p, '.comet/config.yaml')));

  check('B1 挂载 AGENTS.md Keel 指引', (() => {
    const text = readFileSync(path.join(p, 'AGENTS.md'), 'utf8');
    return text.includes('<!-- KEEL:START -->') && text.includes('keel-h status <change>')
      && text.includes('atlas.config.yaml') && text.includes('brief.md')
      && text.includes('Shape') && text.includes('Build')
      && text.includes('Verify/Archive') && text.includes('stack-profile');
  })());

  const skillPaths = ['.agents/skills/keel/SKILL.md', '.claude/skills/keel/SKILL.md'].map((rel) => path.join(p, rel));
  check('B1 安装双宿主 Keel Skill', skillPaths.every((file) => existsSync(file) && readFileSync(file, 'utf8') === skillSource)
    && skillSource.includes('name: keel') && skillSource.includes('<!-- KEEL:MANAGED -->'));

  // B5 幂等：重跑不重复装配
  const v1 = readFileSync(path.join(p, '.atlas/VERSION'), 'utf8');
  const agents1 = readFileSync(path.join(p, 'AGENTS.md'), 'utf8');
  const skills1 = skillPaths.map((file) => readFileSync(file, 'utf8'));
  const r2 = init(p);
  const agents2 = readFileSync(path.join(p, 'AGENTS.md'), 'utf8');
  check('B5 幂等重跑', r2.rc === 0 && r2.out.includes('跳过载荷复制')
    && readFileSync(path.join(p, '.atlas/VERSION'), 'utf8') === v1
    && agents2 === agents1 && agents2.split('<!-- KEEL:START -->').length === 2
    && skillPaths.every((file, i) => readFileSync(file, 'utf8') === skills1[i]), r2.out);
}

// B2 标准位复用
{
  const p = tmp('keel-init-s-'); gitInit(p);
  put(path.join(p, 'product/prd/prd.md'), '# 既有 PRD 标记\n');
  put(path.join(p, 'product/e2e/cases/c1.md'), '# 既有用例\n');
  const profile = 'product: custom\norigin: adopt\napps:\n  - name: app\n    path: .\n    kind: backend\n    role: legacy\n';
  put(path.join(p, 'product/stack-profile.yaml'), profile);
  const agents = '# 项目规则\n\n保留我。\n';
  put(path.join(p, 'AGENTS.md'), agents);
  const { rc, out } = init(p);
  check('B2 标准位 exit 0', rc === 0, out);
  check('B2 既有 stack-profile 不动', readFileSync(path.join(p, 'product/stack-profile.yaml'), 'utf8') === profile);
  check('B2 既有 PRD 不动', readFileSync(path.join(p, 'product/prd/prd.md'), 'utf8') === '# 既有 PRD 标记\n');
  check('B2 保留既有 AGENTS.md 并追加 Keel 区块', (() => {
    const text = readFileSync(path.join(p, 'AGENTS.md'), 'utf8');
    return text.startsWith(agents) && text.includes('<!-- KEEL:START -->');
  })());
  check('B2 不写 atlas.config.yaml', !existsSync(path.join(p, 'atlas.config.yaml')));
  check('B2 报告原位复用', out.includes('原位复用'), out);
}

// B3 单一异根挂接
{
  const p = tmp('keel-init-a-'); gitInit(p);
  put(path.join(p, 'docs/prd/a.md'), '# 异根 PRD\n');
  put(path.join(p, 'docs/e2e/cases/c1.md'), '# 异根用例\n');
  const { rc, out } = init(p);
  check('B3 异根 exit 0', rc === 0, out);
  const cfg = path.join(p, 'atlas.config.yaml');
  check('B3 写 atlas.config.yaml 挂接 docs',
    existsSync(cfg) && readFileSync(cfg, 'utf8').includes('assets_root: docs'));
  check('B3 异根文件原位不动',
    readFileSync(path.join(p, 'docs/prd/a.md'), 'utf8') === '# 异根 PRD\n');
  check('B3 stack-profile 落到异根', existsSync(path.join(p, 'docs/stack-profile.yaml')));
  check('B3 不生成 product/ 模板', !existsSync(path.join(p, 'product/stack-profile.yaml')));
}

// B4 散落多处不猜
{
  const p = tmp('keel-init-x-'); gitInit(p);
  for (const r of ['specs', 'docs']) {
    put(path.join(p, r, 'prd/a.md'), '# x\n');
    put(path.join(p, r, 'e2e/c1.md'), '# x\n');
  }
  const { rc, out } = init(p);
  check('B4 散落 exit 0', rc === 0, out);
  check('B4 不写 atlas.config.yaml', !existsSync(path.join(p, 'atlas.config.yaml')));
  check('B4 列候选并提示人工', out.includes('不猜') && out.includes('specs') && out.includes('docs'), out);
}

// B6 python3 缺失 → 硬拒绝
{
  const p = tmp('keel-init-p-'); gitInit(p);
  const { rc, out } = capture(() => runInit({ projectRoot: p, repoRoot, comet: 'comet-for-probe',
    pythonCheck: () => ({ ok: false }) }));
  check('B6 python3 缺失拒绝', rc === 1 && out.includes('python3 不可用'), out);
}

// B7 pytest 缺失 → WARN 但放行
{
  const p = tmp('keel-init-q-'); gitInit(p);
  const { rc, out } = capture(() => runInit({ projectRoot: p, repoRoot, comet: 'comet-for-probe',
    pythonCheck: () => ({ ok: true, hasPytest: false }) }));
  check('B7 pytest 缺失仅 WARN', rc === 0 && out.includes('WARN') && out.includes('pytest'), out);
}

// B8 KEEL 标记异常 → 拒绝且不改 AGENTS.md
{
  const p = tmp('keel-init-m-'); gitInit(p);
  const broken = '# 项目规则\n\n<!-- KEEL:START -->\n缺结束标记\n';
  put(path.join(p, 'AGENTS.md'), broken);
  const { rc, out } = init(p);
  check('B8 异常标记拒绝且原文件不动', rc === 1 && out.includes('KEEL 标记')
    && readFileSync(path.join(p, 'AGENTS.md'), 'utf8') === broken, out);
}

// B9 任一宿主已有非托管同名 Skill → 两个宿主都不写，原文件保留
for (const rel of ['.agents/skills/keel/SKILL.md', '.claude/skills/keel/SKILL.md']) {
  const p = tmp('keel-init-u-'); gitInit(p);
  const target = path.join(p, rel);
  const original = '# 用户自有 Keel Skill\n';
  put(target, original);
  const other = path.join(p, rel.startsWith('.agents/') ? '.claude/skills/keel/SKILL.md' : '.agents/skills/keel/SKILL.md');
  const { rc, out } = init(p);
  check(`B9 ${rel} 非托管 Skill 拒绝覆盖`, rc === 1 && out.includes('拒绝覆盖')
    && readFileSync(target, 'utf8') === original && !existsSync(other), out);
}

if (failures > 0) { console.error(`INIT SELFTEST FAIL（${failures} 项）`); process.exit(1); }
console.log('UPDATE/INIT PROBES: INIT SELFTEST PASS');
