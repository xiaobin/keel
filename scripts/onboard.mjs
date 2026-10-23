import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Keel onboarding (design: docs/decisions/0002 stage 0).
// Assembles the three-ring asset skeleton + brief, runs the stack-profile gate,
// and emits the Native start request. Gate failure = no onboarding.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, required = true) {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (required && (!v || v.startsWith('--'))) {
    console.error(`usage: node scripts/onboard.mjs --project-root <项目> --name <change> [--atlas-root <atlas 检出>]`);
    process.exit(2);
  }
  return v;
}

const projectRoot = path.resolve(arg('project-root'));
const name = arg('name');
if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
  console.error(`change 名非法：${name}（须 ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$）`);
  process.exit(2);
}
const atlasRoot =
  arg('atlas-root', false) ||
  process.env.KEEL_ATLAS_ROOT ||
  path.resolve(repoRoot, '../atlas');
if (!existsSync(path.join(atlasRoot, 'install.sh'))) {
  console.error(`找不到 Atlas 检出：${atlasRoot}（用 --atlas-root 或 KEEL_ATLAS_ROOT 指定）。`);
  process.exit(1);
}

// Preconditions: git worktree + comet project config (created by `comet init`).
let branch;
try {
  // symbolic-ref also resolves the unborn branch of a fresh git init.
  branch = execFileSync('git', ['-C', projectRoot, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  console.error(`${projectRoot} 不是 Git 仓库；先 git init。`);
  process.exit(1);
}
if (!existsSync(path.join(projectRoot, '.comet/config.yaml'))) {
  console.error('缺 .comet/config.yaml；先用 comet CLI 跑 comet init 完成项目配置。');
  process.exit(1);
}

// 1. Three-ring asset skeleton (never overwrite existing assets).
const profileTarget = path.join(projectRoot, 'product/stack-profile.yaml');
if (!existsSync(profileTarget)) {
  mkdirSync(path.dirname(profileTarget), { recursive: true });
  const tpl = readFileSync(path.join(repoRoot, 'assets/product/stack-profile.yaml'), 'utf8');
  writeFileSync(profileTarget, tpl.replaceAll('__PROJECT_NAME__', path.basename(projectRoot)), { flag: 'wx' });
  console.log(`已装配 ${profileTarget}（按项目实况修改 origin/apps 后再次开户亦可）`);
}

// 2. Brief skeleton (Shape input; authored further during Shape).
const changeDir = path.join(projectRoot, 'docs/comet/changes', name);
const brief = path.join(changeDir, 'brief.md');
if (!existsSync(brief)) {
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(
    brief,
    [
      '# Outcome',
      '<本 change 要交付的结果，一行>',
      '# Scope',
      '<本轮范围>',
      '# Non-goals',
      '<明确不做>',
      '# Acceptance examples',
      '- <可观察的验收示例，对应 product/prd 的 AC>',
      '# Directory structure',
      '## Created',
      '## Modified',
      '## Deleted',
      '## Not created',
      '',
    ].join('\n'),
    { flag: 'wx' },
  );
  console.log(`已写 brief 骨架 ${brief}`);
}

// 3. Assemble .atlas/ via atlas's own installer (never overwrites product/).
// Already assembled = skip (install.sh refuses to overwrite an existing .atlas,
// and re-assembling would roll back any local validator changes).
const atlasCheckPath = path.join(projectRoot, '.atlas/scripts/atlas_check.py');
if (existsSync(atlasCheckPath)) {
  console.log('.atlas 已装配，跳过 install.sh。');
} else {
  // --no-patch/--no-wiring: keel replaces the trellis/atlas-apply entry with the comet
  // workflow, so the .trellis mount and AGENTS.md wiring do not apply.
  const install = spawnSync(
    'bash',
    // --force: keel projects have no .trellis (comet replaces it); bypass the trellis-presence guard.
    [path.join(atlasRoot, 'install.sh'), '--target', projectRoot, '--no-patch', '--no-wiring', '--force'],
    { encoding: 'utf8' },
  );
  process.stdout.write(install.stdout || '');
  process.stderr.write(install.stderr || '');
  if (install.error || install.status !== 0) {
    console.error('atlas 装配失败（install.sh）；开户中止。');
    process.exit(1);
  }
}

// Untrack Python bytecode: install.sh commits __pycache__/*.pyc, which Python
// rewrites on first validator runs, drifting the candidate fingerprint gate
// between verify.checks and verifier (first change after onboard always hits).
{
  const gi = path.join(projectRoot, '.gitignore');
  const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  // .atlas/runs/ is atlas runtime state (e.g. last-check-error.log written on
  // red, deleted on green) — tracking it drifts the fingerprint mid-Run.
  const add = ['__pycache__/', '*.pyc', '.atlas/runs/', '.worktrees/'].filter((l) => !cur.split('\n').includes(l));
  if (add.length > 0) writeFileSync(gi, cur + (cur.endsWith('\n') || cur === '' ? '' : '\n') + add.join('\n') + '\n');
  const tracked = spawnSync('git', ['-C', projectRoot, 'ls-files', '*.pyc', '.atlas/runs'], { encoding: 'utf8' });
  const pyc = (tracked.stdout || '').split('\n').filter(Boolean);
  if (pyc.length > 0) {
    spawnSync('git', ['-C', projectRoot, 'rm', '--cached', '--quiet', ...pyc], { encoding: 'utf8' });
    console.log(`已从 git 索引移除 ${pyc.length} 个运行态文件（随下次提交生效，防候选指纹漂移）。`);
  }
}

// Burn-in: first validator runs auto-scaffold .trellis/spec/ (testid.md,
// .gitkeep). If that happens mid-Run it drifts the candidate fingerprint
// gate, so trigger it now and let the user commit a stable tree.
if (existsSync(atlasCheckPath)) {
  const burn = spawnSync('python3', [atlasCheckPath, '--root', projectRoot, '--fast'], { encoding: 'utf8' });
  const tail = (burn.stdout || '').split('\n').filter((l) => l.trim()).slice(-3).join('\n');
  console.log('burn-in 首跑（不门禁，greenfield 红属预期）：', tail || '(无输出)');
  console.log('提示：提交 onboarding 产物（含 .trellis/spec 脚手架）后再 start。');
}

// 4. Onboarding gate: stack-profile must be valid before any Run starts.
const gate = spawnSync(
  'python3',
  [path.join(atlasRoot, 'validators/validate_stack_profile.py'), '--root', projectRoot],
  { encoding: 'utf8' },
);
process.stdout.write(gate.stdout || '');
process.stderr.write(gate.stderr || '');
if (gate.error || gate.status !== 0) {
  console.error('开户门 validate_stack_profile 未过；门不过不开户。');
  process.exit(1);
}

// 4. Start request. initialState mirrors comet@0.5.0 createNativePortableState
// (domains/comet-native/native-portable-state.ts); revisit when comet bumps schema.
const startRequest = {
  operation: 'start',
  runId: name,
  workflow: { id: 'comet-native', version: '1' },
  input: { name, artifactRootRef: 'docs' },
  initialState: {
    schema: 'comet.native.v4',
    name,
    language: 'zh-CN',
    phase: 'shape',
    status: 'active',
    state_version: 1,
    brief: 'brief.md',
    spec_changes: [],
    workspace: { isolation: 'current', change_branch: branch, target_branch: branch, finish: null },
    loop: {
      stage: 'shape',
      goal_cycle: 1,
      iteration: 0,
      attempt: 0,
      retry_epoch: 0,
      failed_iteration_count: 0,
      no_progress_count: 0,
      execution_failure_count: 0,
      previous_unresolved_ids: [],
      next_action: null,
    },
    acceptance: [],
    builder_handoff: null,
    blockers: [],
    verification: null,
    history: [],
    history_overflow: {
      dropped_entries: 0,
      first_dropped_at: null,
      last_dropped_at: null,
      outcome_counts: { pass: 0, fail: 0, blocked: 0, 'execution-error': 0, recovery: 0 },
    },
    verification_result: 'pending',
    verification_report: null,
    archived: false,
    created_at: new Date().toISOString(),
  },
};
const requestFile = path.join(changeDir, 'start-request.json');
writeFileSync(requestFile, JSON.stringify(startRequest, null, 2) + '\n');
console.log(`开户完成。启动：
comet runtime dispatch --application-file ${path.join(repoRoot, 'application/application.json')} --project-root ${projectRoot} --request ${requestFile}`);
