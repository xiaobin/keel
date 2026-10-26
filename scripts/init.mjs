#!/usr/bin/env node
// keel-h init — project onboarding without a change: assemble .atlas payload,
// project config, stack-profile, and attach pre-existing atlas assets
// (atlas.config.yaml / stack-profile e2e paths). Never moves or overwrites
// existing assets; ambiguous discoveries are reported, not guessed.
// Also verifies the comet runtime and offers to install it when missing.
// Design: docs/decisions/0014.

import { existsSync, mkdirSync, writeFileSync, readFileSync, cpSync, readdirSync, realpathSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// resolveCometBin / installComet are injectable for probes (selftest-init).

export function resolveCometBin({ repoRoot, env = process.env, exists = existsSync }) {
  const fromEnv = env.COMET_BIN;
  if (fromEnv) {
    // Explicit override: missing file is a hard error (same as bin/keel.mjs).
    if (!exists(fromEnv)) throw new Error(`COMET_BIN 指向的 comet 不存在：${fromEnv}`);
    return fromEnv;
  }
  const dep = path.join(repoRoot, 'node_modules/@rpamis/comet/bin/comet.js');
  if (exists(dep)) return dep;
  const checkout = path.resolve(repoRoot, '../comet/bin/comet.js');
  if (exists(checkout)) return checkout;
  return null;
}

export function installComet({ repoRoot, runner = spawnSync }) {
  const r = runner('npm', ['install', '--no-fund', '--no-audit'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { ok: !r.error && r.status === 0, stderr: (r.stderr || '').trim(), error: r.error };
}

// python3 is a hard prerequisite (payload stamping, validators, burn-in);
// pytest only matters at the closeout factory-test gate — WARN, not a gate.
export function checkPython({ runner = spawnSync } = {}) {
  const v = runner('python3', ['--version'], { encoding: 'utf8' });
  if (v.error || v.status !== 0) return { ok: false };
  const pt = runner('python3', ['-c', 'import pytest'], { encoding: 'utf8' });
  return { ok: true, hasPytest: pt.status === 0 };
}

// Returns the resolved bin path, or null when missing and not installed.
export async function ensureComet({ repoRoot, assumeYes = false, env = process.env,
  exists = existsSync, installer = installComet, input = process.stdin, output = process.stdout,
  ask = null }) {
  const bin = resolveCometBin({ repoRoot, env, exists });
  if (bin) return bin;
  if (!assumeYes) {
    if (!input.isTTY) {
      console.error('未检测到 comet 运行时（@rpamis/comet 未随 keel-h 安装）。');
      console.error(`修复：cd ${repoRoot} && npm install；或设 COMET_BIN=<comet检出>/bin/comet.js。非交互环境可用 --yes 自动安装。`);
      return null;
    }
    const askFn = ask || ((q) => {
      const rl = readline.createInterface({ input, output });
      return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a); }));
    });
    const a = (await askFn(`未检测到 comet 运行时（@rpamis/comet）。现在安装到 ${repoRoot}？[y/N] `)).trim().toLowerCase();
    if (a !== 'y' && a !== 'yes') {
      console.error('已取消安装。手动修复：cd ' + repoRoot + ' && npm install，或设 COMET_BIN。');
      return null;
    }
  }
  console.log('安装 comet 运行时（npm install @ keel-h 包根）…');
  const r = installer({ repoRoot });
  if (!r.ok) {
    console.error(`comet 安装失败：${r.error?.message || r.stderr || 'npm install 非零退出'}`);
    console.error(`手动修复：cd ${repoRoot} && npm install；或设 COMET_BIN=<comet检出>/bin/comet.js。`);
    return null;
  }
  return resolveCometBin({ repoRoot, env, exists }); // null when install did not land it
}

const hasMd = (dir) => {
  try { return readdirSync(dir).some((f) => f.endsWith('.md')); } catch { return false; }
};
const isDir = (p) => {
  try { return readdirSync(p) !== null; } catch { return false; }
};

function detectAssets(projectRoot, runPy) {
  // atlas.config.yaml already declares the assets root: trust it, no guessing.
  const cfg = path.join(projectRoot, 'atlas.config.yaml');
  if (existsSync(cfg)) return { mode: 'config', assetsRoot: runPy(['--root', projectRoot, '--print', 'assets_root']) };

  const standardPrd = hasMd(path.join(projectRoot, 'product/prd'));
  const standardE2e = isDir(path.join(projectRoot, 'product/e2e'));
  if (standardPrd || standardE2e) return { mode: 'standard', prd: standardPrd, e2e: standardE2e };

  // Single alternate root: exactly one candidate holding both prd/ and e2e/.
  const hits = [];
  for (const cand of ['docs', 'specs', 'requirements', 'governance']) {
    const base = path.join(projectRoot, cand);
    if (isDir(base) && hasMd(path.join(base, 'prd')) && isDir(path.join(base, 'e2e'))) hits.push(cand);
  }
  if (hits.length === 1) return { mode: 'alt-root', assetsRoot: hits[0] };
  if (hits.length > 1) return { mode: 'scattered', candidates: hits };
  return { mode: 'greenfield' };
}

export function runInit({ projectRoot, repoRoot, comet = null, pythonCheck = checkPython }) {
  try {
    execFileSync('git', ['-C', projectRoot, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' });
  } catch {
    console.error(`${projectRoot} 不是 Git 仓库；先 git init。`);
    return 1;
  }

  const vendorAtlas = path.join(repoRoot, 'vendor/atlas');
  if (!existsSync(path.join(vendorAtlas, 'scripts/atlas_check.py'))) {
    console.error(`keel 内置 atlas 载荷缺失：${vendorAtlas}（仓库不完整）。`);
    return 1;
  }

  // 0. Comet runtime (design 0014 §D1). Detect → offer → install on confirm.
  const cometBin = comet; // injected for probes; real path resolved by caller (bin/keel.mjs)
  console.log(`comet 运行时：${cometBin}`);

  // python3: hard prerequisite (stamping/validators/burn-in below). pytest: closeout-only — WARN.
  const py = pythonCheck();
  if (!py.ok) {
    console.error('python3 不可用——atlas 载荷（戳记/校验器/出厂测试）全部依赖 python3；请先安装 python3 再重跑 init。');
    return 1;
  }
  if (!py.hasPytest) {
    console.log('WARN：当前 PATH 的 python3 缺 pytest——init 不受影响，但收口（closeout）出厂测试门会红；补齐：python3 -m pip install pytest');
  }

  // 1. Comet project config (only when missing).
  if (!existsSync(path.join(projectRoot, '.comet/config.yaml'))) {
    const tpl = readFileSync(path.join(repoRoot, 'assets/comet/config.yaml'), 'utf8');
    mkdirSync(path.join(projectRoot, '.comet'), { recursive: true });
    writeFileSync(path.join(projectRoot, '.comet/config.yaml'), tpl);
    console.log('已生成 .comet/config.yaml（Native 默认配置，可手改）');
  }

  // 2. Asset attach (0014 §D2-D4): detect → attach by config, never move files.
  const layoutPy = path.join(vendorAtlas, '_support/layout.py');
  const runPy = (args) => {
    const r = spawnSync('python3', [layoutPy, ...args], { encoding: 'utf8' });
    if (r.error || r.status !== 0) throw new Error(`layout.py 失败：${(r.stderr || '').trim() || r.error?.message}`);
    return r.stdout.trim();
  };
  const det = detectAssets(projectRoot, runPy);
  let assetsRoot = 'product';
  if (det.mode === 'config') {
    assetsRoot = det.assetsRoot;
    console.log(`布局配置已存在：atlas.config.yaml → assets_root=${assetsRoot}，按其探测。`);
  } else if (det.mode === 'standard') {
    const parts = [det.prd && 'PRD', det.e2e && 'E2E'].filter(Boolean).join('、');
    console.log(`检测到既有应然资产（product/ 标准位：${parts}）——原位复用，不生成模板、不搬移。`);
  } else if (det.mode === 'alt-root') {
    assetsRoot = det.assetsRoot;
    runPy(['--root', projectRoot, '--write', '--assets-root', det.assetsRoot]);
    console.log(`检测到既有应然资产在 ${det.assetsRoot}/（prd/ + e2e/ 成对）——已写 atlas.config.yaml 挂接该根；文件原位不动。`);
  } else if (det.mode === 'scattered') {
    console.log(`检测到多处置候选根（${det.candidates.join('、')}）——不猜。请人工择一：写 atlas.config.yaml 的 layout.assets_root，或把资产并入 product/ 后重跑 init。`);
  }

  // 3. stack-profile skeleton (never overwrite; adopt projects keep their own).
  const profileTarget = path.join(projectRoot, assetsRoot, 'stack-profile.yaml');
  if (existsSync(profileTarget)) {
    console.log(`已存在 ${assetsRoot}/stack-profile.yaml，复用（存量项目请确认 origin: adopt）。`);
  } else {
    mkdirSync(path.dirname(profileTarget), { recursive: true });
    const tpl = readFileSync(path.join(repoRoot, 'assets/product/stack-profile.yaml'), 'utf8');
    writeFileSync(profileTarget, tpl.replaceAll('__PROJECT_NAME__', path.basename(projectRoot)), { flag: 'wx' });
    console.log(`已生成 ${profileTarget}（按项目实况修改 origin/apps 后再 start）`);
  }

  // 4. Assemble .atlas/ by copying the vendored payload (never overwrites assets).
  //    Already assembled = skip (re-assembling would roll back local validator changes).
  const atlasCheckPath = path.join(projectRoot, '.atlas/scripts/atlas_check.py');
  if (existsSync(atlasCheckPath)) {
    console.log('.atlas 已装配，跳过载荷复制（升级走 keel-h update）。');
  } else {
    const dest = path.join(projectRoot, '.atlas');
    cpSync(vendorAtlas, dest, { recursive: true });
    const stamp = spawnSync(
      'python3',
      [
        '-c',
        'import sys; from pathlib import Path; sys.path.insert(0, sys.argv[1]); from pkg_digest import stamp_file; print(stamp_file(Path(sys.argv[2]), Path(sys.argv[3])))',
        path.join(vendorAtlas, 'scripts'),
        vendorAtlas,
        path.join(dest, 'VERSION'),
      ],
      { encoding: 'utf8' },
    );
    if (stamp.error || stamp.status !== 0) {
      console.error('atlas 载荷版本戳落盘失败：', (stamp.stderr || '').trim() || stamp.error?.message);
      return 1;
    }
    console.log('已装配 .atlas/（keel 内置载荷，VERSION 戳已落盘）。');
  }

  // 5. Candidate-fingerprint hygiene: ignore runtime state; untrack bytecode.
  {
    const gi = path.join(projectRoot, '.gitignore');
    const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
    const add = ['__pycache__/', '*.pyc', '.atlas/runs/', '.worktrees/'].filter((l) => !cur.split('\n').includes(l));
    if (add.length > 0) writeFileSync(gi, cur + (cur.endsWith('\n') || cur === '' ? '' : '\n') + add.join('\n') + '\n');
    const tracked = spawnSync('git', ['-C', projectRoot, 'ls-files', '*.pyc', '.atlas/runs'], { encoding: 'utf8' });
    const pyc = (tracked.stdout || '').split('\n').filter(Boolean);
    if (pyc.length > 0) {
      spawnSync('git', ['-C', projectRoot, 'rm', '--cached', '--quiet', ...pyc], { encoding: 'utf8' });
      console.log(`已从 git 索引移除 ${pyc.length} 个运行态文件（随下次提交生效，防候选指纹漂移）。`);
    }
  }

  // 6. Burn-in (non-gating): first validator runs auto-scaffold .trellis/spec/;
  //    mid-Run scaffolding would drift the candidate fingerprint gate.
  if (existsSync(atlasCheckPath)) {
    const burn = spawnSync('python3', [atlasCheckPath, '--root', projectRoot, '--fast'], { encoding: 'utf8' });
    const tail = (burn.stdout || '').split('\n').filter((l) => l.trim()).slice(-3).join('\n');
    console.log('burn-in 首跑（不门禁，greenfield 红属预期）：', tail || '(无输出)');
  }

  // 7. Onboarding gate (hard): stack-profile must validate before any Run starts.
  //    Run from the assembled project copy (also proves the payload works).
  const gate = spawnSync(
    'python3',
    [path.join(projectRoot, '.atlas/validators/validate_stack_profile.py'), '--root', projectRoot],
    { encoding: 'utf8' },
  );
  process.stdout.write(gate.stdout || '');
  process.stderr.write(gate.stderr || '');
  if (gate.error || gate.status !== 0) {
    console.error('开户门 validate_stack_profile 未过；门不过不接入。');
    return 1;
  }
  return 0;
}

async function mainCli() {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
  const projectRoot = path.resolve(opt('project-root') || process.cwd());
  if (realpathSync(projectRoot) !== projectRoot) {
    console.error(`项目根不是物理路径：${projectRoot}（软链会让候选指纹门假漂移，0005 §2 S1）`);
    process.exit(1);
  }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const assumeYes = args.includes('--yes');
  const comet = await ensureComet({ repoRoot, assumeYes });
  if (!comet) process.exit(1);
  process.exit(runInit({ projectRoot, repoRoot, comet }));
}

// Standalone CLI: `node scripts/init.mjs --project-root <p> [--yes]`
const isCli = process.argv[1] && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isCli) await mainCli();
