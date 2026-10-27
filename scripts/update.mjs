import { existsSync, readFileSync, readdirSync, cpSync, renameSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// keel update: refresh an installed project's assembled .atlas/ payload to this
// repo's vendor/atlas (design: docs/decisions/0013). Project-side only (like
// `comet update --project-only`); the keel npm package itself is still upgraded
// via `npm install -g @xiaobin268/keel-h`. Never touches product/ or change assets.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const i = process.argv.indexOf('--project-root');
const projectRoot = path.resolve(i >= 0 ? process.argv[i + 1] : process.cwd());
const force = process.argv.includes('--force');

const vendorAtlas = path.join(repoRoot, 'vendor/atlas');
if (!existsSync(path.join(vendorAtlas, 'scripts/atlas_check.py'))) {
  fail(`keel 内置 atlas 载荷缺失：${vendorAtlas}（仓库不完整）。`);
}
const atlasDir = path.join(projectRoot, '.atlas');
const versionFile = path.join(atlasDir, 'VERSION');
const manifestFile = path.join(atlasDir, 'MANIFEST.json');
if (!existsSync(versionFile)) {
  fail(`${projectRoot} 未装配 .atlas（缺 VERSION）；先 keel-h init。`);
}
// Updating tracked payload mid-Run drifts the candidate fingerprint with no
// forward recovery (0009 §3) — refuse even with --force.
const activeRun = path.join(projectRoot, '.comet/current-change.json');
if (existsSync(activeRun)) {
  fail(`有进行中 Run（${activeRun}）。升级会漂移候选指纹并锁死 Run（0009 §3）；请先归档该 change 后再 update。`);
}

function python(args, label) {
  const r = spawnSync('python3', args, { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    throw new Error(`${label}：${(r.stderr || '').trim() || r.error?.message || `exit ${r.status}`}`);
  }
  return r.stdout;
}

let newDigest;
try {
  newDigest = python([path.join(vendorAtlas, 'scripts/pkg_digest.py'), vendorAtlas], '内置载荷摘要计算失败').trim();
} catch (error) {
  fail(error.message);
}
const oldDigest = readFileSync(versionFile, 'utf8').split('\n')[0].trim();
if (oldDigest === newDigest && !force) {
  console.log(`.atlas 已是最新（${newDigest}），无需更新。--force 可强制重装以修复本地改动。`);
  process.exit(0);
}

// Reconcile local edits against the assembly baseline (MANIFEST.json) before
// overwriting anything; user-modified payload is never overwritten silently
// (same posture as comet's "refusing to overwrite user-owned" install).
let baseline = { files: {} };
if (!existsSync(manifestFile)) {
  if (!force) {
    fail('旧装配缺 MANIFEST.json，无法对账本地改动；人工对账后重装，或确认无本地改动后用 --force。');
  }
  console.log('WARN：缺 MANIFEST.json，--force 跳过本地改动对账。');
} else {
  baseline = JSON.parse(readFileSync(manifestFile, 'utf8'));
}
const files = baseline.files || {};
const changes = [];
for (const [rel, sha] of Object.entries(files)) {
  const p = path.join(atlasDir, rel);
  if (!existsSync(p)) {
    changes.push(`missing   ${rel}`);
    continue;
  }
  if (createHash('sha256').update(readFileSync(p)).digest('hex') !== sha) changes.push(`modified  ${rel}`);
}
// Anything inside .atlas that is neither baseline nor runtime state is a local
// addition and would be lost by the wholesale refresh.
const skipDirs = new Set(['__pycache__', 'runs', '.pytest_cache', '.venv', 'node_modules', '.git']);
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(p);
    } else if (!e.name.endsWith('.pyc') && e.name !== '.DS_Store') {
      const rel = path.relative(atlasDir, p).split(path.sep).join('/');
      if (rel !== 'VERSION' && rel !== 'MANIFEST.json' && !(rel in files)) changes.push(`added     ${rel}`);
    }
  }
}
walk(atlasDir);
if (changes.length > 0) {
  console.log('本地改动对账（相对装配基线 MANIFEST.json）：\n' + changes.join('\n'));
  if (!force) {
    fail('检测到 .atlas 本地改动，默认不覆盖。请先人工对账保留改动；确认可丢弃后用 keel update --force。');
  }
  console.log('--force：以上本地改动将被覆盖/移除。');
}

const tmp = path.join(projectRoot, '.atlas.keel-update-tmp');
const backup = path.join(projectRoot, '.atlas.keel-update-backup');
try {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(backup, { recursive: true, force: true });
  cpSync(vendorAtlas, tmp, { recursive: true });
  renameSync(atlasDir, backup);
} catch (error) {
  fail(`准备替换失败（原 .atlas 未动）：${error.message}`);
}
try {
  renameSync(tmp, atlasDir);
  // Same stamp as onboard: MANIFEST.json first, then VERSION (half-state protocol).
  python([
    '-c',
    'import sys; from pathlib import Path; sys.path.insert(0, sys.argv[1]); from pkg_digest import stamp_file; print(stamp_file(Path(sys.argv[2]), Path(sys.argv[3])))',
    path.join(vendorAtlas, 'scripts'),
    vendorAtlas,
    versionFile,
  ], 'atlas 载荷版本戳落盘失败');
  // Burn-in is non-gating (greenfield red is expected, same as onboard); the
  // stack-profile gate IS gating — new payload must accept existing project assets.
  const burn = spawnSync('python3', [path.join(atlasDir, 'scripts/atlas_check.py'), '--root', projectRoot, '--fast'], { encoding: 'utf8' });
  const tail = (burn.stdout || '').split('\n').filter((l) => l.trim()).slice(-3).join('\n');
  console.log('burn-in 复跑（不门禁，greenfield 红属预期）：', tail || '(无输出)');
  const gate = spawnSync('python3', [path.join(atlasDir, 'validators/validate_stack_profile.py'), '--root', projectRoot], { encoding: 'utf8' });
  process.stdout.write(gate.stdout || '');
  process.stderr.write(gate.stderr || '');
  if (gate.error || gate.status !== 0) {
    throw new Error('复验门 validate_stack_profile 未过（新载荷与既有项目资产不兼容）。');
  }
} catch (error) {
  rmSync(atlasDir, { recursive: true, force: true });
  renameSync(backup, atlasDir);
  fail(`update 失败，已回滚到原装配（${oldDigest}）：${error.message}`);
}
rmSync(backup, { recursive: true, force: true });
console.log(`已更新 .atlas：${oldDigest} → ${newDigest}，复验通过。请审查 git diff 并提交 .atlas 变更。`);
