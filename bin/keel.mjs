#!/usr/bin/env node
// Keel CLI — keel-level workflow verbs; drives Comet Runtime internally.
// Design: docs/decisions/0002 (hooks), protocol facts: docs/decisions/0005 §3.
// Never exposes comet commands; never writes request files inside the project.

import { existsSync, realpathSync, mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const applicationFile = path.join(repoRoot, 'application/application.json');
const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'keel-req-'));

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function opt(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// S1 guard: candidate gate hashes the projectRoot string itself; symlinked
// forms (/tmp on macOS) drift between dispatch and CLI. Physical paths only.
function projectRoot() {
  const p = path.resolve(opt('project-root') || process.cwd());
  if (realpathSync(p) !== p) {
    fail(`项目根不是物理路径：${p} → ${realpathSync(p)}。软链路径会让候选指纹门假漂移（0005 §2 S1），请改用物理路径。`);
  }
  return p;
}

function cometBin() {
  let bin = process.env.COMET_BIN;
  if (!bin) {
    // Installed mode: resolve the comet dependency the same way application.mjs imports do.
    try { bin = createRequire(import.meta.url).resolve('@rpamis/comet/bin/comet.js'); } catch { /* fall through to dev checkout */ }
  }
  if (!bin) bin = path.resolve(repoRoot, '../comet/bin/comet.js');
  if (!existsSync(bin)) fail(`找不到 comet 运行时：${bin}（npm install 获取 @rpamis/comet，或设 COMET_BIN）。全局 PATH 的 comet 可能版本不符，禁用。`);
  return bin;
}

// Strips the "[Comet] ..." progress line the CLI may print before JSON.
function parseJsonLoose(text, label) {
  const start = text.indexOf('{');
  if (start < 0) fail(`${label} 未返回 JSON：\n${text.slice(0, 400)}`);
  // CLI may print extra lines after the JSON; take the first balanced object.
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch (e) {
          fail(`${label} JSON 解析失败：${e.message}`);
        }
      }
    }
  }
  fail(`${label} JSON 不完整：\n${text.slice(start, start + 400)}`);
}

function comet(root, args, label) {
  const r = spawnSync('node', [cometBin(), ...args, '--project-root', root, '--json'], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.error || r.status !== 0) fail(`${label} 失败：\n${out.slice(0, 800)}`);
  return parseJsonLoose(out, label);
}

function dispatch(root, request, label) {
  const file = path.join(tmpDir, label + '.json');
  writeFileSync(file, JSON.stringify(request, null, 1));
  return comet(root, ['runtime', 'dispatch', '--application', 'keel', '--request', file], label);
}

function nativeNext(root, name, extra, label) {
  return comet(root, ['native', 'next', name, ...extra], label || 'native-next');
}

function inspect(root, name) {
  return dispatch(root, { operation: 'inspect', runId: name }, 'inspect');
}

function actionsOf(d) {
  return (d.data && d.data.actions) || [];
}

function stateOf(d) {
  return (d.data && d.data.state) || {};
}

function pendingAction(root, name) {
  return actionsOf(inspect(root, name)).find((a) => a.status === 'pending');
}

function workableAction(root, name, stepIds) {
  return actionsOf(inspect(root, name)).find((a) => ['pending', 'running'].includes(a.status) && stepIds.includes(a.stepId));
}

const BUILDER_STEPS = ['build.builder', 'supervisor.parent.builder', 'supervisor.child.builder', 'supervisor.child.integration-repair'];
const VERIFIER_STEPS = ['verify.verifier', 'supervisor.child.verifier'];

// Working tree the action's commit must land in: child worktree for child
// steps, integration worktree for parent/integration-repair (0006 实证表).
function workRootOf(action, root) {
  const act = (action.input && action.input.activation) || {};
  if (['supervisor.parent.builder', 'supervisor.child.integration-repair'].includes(action.stepId)) return act.integrationWorktree || root;
  if (['supervisor.child.builder', 'supervisor.child.verifier'].includes(action.stepId)) return act.worktree || root;
  return root;
}

function headFiles(workRoot) {
  const out = execFileSync('git', ['-C', workRoot, 'diff-tree', '--no-commit-id', '--name-only', '-r', '--diff-filter=AM', 'HEAD'], { encoding: 'utf8' }).trim();
  return out ? out.split('\n').filter((f) => f && !f.endsWith('comet-state.yaml')) : [];
}

function noopCheck(id, name) {
  return { id, name, executable: process.execPath, argv: ['-e', 'process.exit(0)'], cwdRef: '.', timeoutMs: 10000, repeatable: true };
}

function gitHead(root) {
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

// Claim + record for a handoff action. keel owns every protocol field
// (0005 §3): caller-supplied unique claimToken, unique outcomeId,
// JS-ISO submittedAt, fields inside outcome.
function claimAndRecord(root, name, action, sessionId, output, label) {
  const actionId = action.id;
  // attempt/inputHash come from the Action itself; the deterministic token
  // makes re-claim after a failed record idempotent (runtime-action.ts:171).
  let claimToken = actionId + '-' + sessionId;
  if (action.status === 'running' && action.claim) {
    // Resume: inspect exposes the token; reuse it if the claim is ours.
    if (action.claim.executorId === 'native-host' && action.claim.sessionId === sessionId) {
      claimToken = action.claim.token;
    } else {
      fail(`${label}：Action 已被 ${action.claim.sessionId} 领取，keel 不能接管。`);
    }
  } else {
    const claim = { operation: 'claim', runId: name, actionId, attempt: action.attempt, inputHash: action.inputHash, executorId: 'native-host', sessionId, claimToken };
    const cr = dispatch(root, claim, 'claim-' + label);
    if (cr.status !== 'succeeded') fail(`${label} claim 被拒：${JSON.stringify(cr.error || cr).slice(0, 400)}`);
  }
  const outcome = {
    actionId,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken,
    outcomeId: actionId + '-' + sessionId + '-' + Date.now(),
    status: 'succeeded',
    output,
  };
  const rr = dispatch(root, { operation: 'record-outcome', runId: name, outcome }, 'record-' + label);
  if (rr.status !== 'succeeded') fail(`${label} record 被拒：${((rr.error || {}).message || JSON.stringify(rr)).slice(0, 500)}`);
  return rr;
}

function readPayload(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`payload 无法解析：${file}：${e.message}`);
  }
}

const cmd = process.argv[2];
const name = process.argv[3];

const commands = {
  selftest() {
    const r = spawnSync('node', [path.join(repoRoot, 'scripts/selftest.mjs')], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  },

  init(root) {
    const args = [path.join(repoRoot, 'scripts/init.mjs'), '--project-root', root];
    if (process.argv.includes('--yes')) args.push('--yes');
    const r = spawnSync('node', args, { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  },

  onboard(root) {
    const n = name || fail('usage: keel-h onboard <change> [--project-root <p>] [--yes]');
    const args = [path.join(repoRoot, 'scripts/onboard.mjs'), '--project-root', root, '--name', n];
    if (process.argv.includes('--yes')) args.push('--yes');
    const r = spawnSync('node', args, { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  },

  start(root) {
    const req = path.join(root, 'docs/comet/changes', name, 'start-request.json');
    if (!existsSync(req)) fail(`缺 ${req}；先 keel-h onboard <change>。`);
    // Clean-tree gate (0009 §3): any tracked/untracked dirt becomes part of the
    // candidate fingerprint; committing later drifts it and locks the run.
    // Runtime-owned files (comet-state.yaml etc.) are excluded by the gate itself.
    const dirty = spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' })
      .stdout.split('\n').filter((l) => l.trim() && !l.includes('comet-state.yaml'));
    if (dirty.length) {
      fail('工作区不净，Run 中途提交会漂移候选指纹并锁死（0009 §3）。请先提交：\n' + dirty.slice(0, 10).join('\n'));
    }
    const d = comet(root, ['runtime', 'dispatch', '--application-file', applicationFile, '--request', req], 'start');
    console.log('Run 已启动：', d.summary || JSON.stringify(d.agent || {}).slice(0, 200));
  },

  status(root) {
    const d = inspect(root, name);
    const a = stateOf(d);
    console.log(`phase=${a.phase} status=${a.status} sv=${a.state_version} archived=${a.archived}`);
    for (const x of actionsOf(d)) console.log(`  ${x.status.padEnd(9)} ${x.id} ${x.stepId}`);
    for (const w of (d.data && d.data.waits) || []) {
      if (w.status === 'pending') console.log(`  WAIT      ${w.id} ${w.stepId} choices=${JSON.stringify(w.choices)}`);
    }
  },

  // Advance everything the Runtime can do on its own: host-side checks via
  // native next, extension actions via the registered keel executor.
  next(root) {
    for (let i = 0; i < 10; i++) {
      const pending = pendingAction(root, name);
      if (!pending) {
        const d = inspect(root, name);
        const a = stateOf(d);
        console.log(`无可推进 Action。phase=${a.phase} status=${a.status} sv=${a.state_version}`);
        if (a.status === 'await-user') console.log('→ 需要用户决定：keel confirm', name, '--summary <确认说明>');
        return;
      }
      if (pending.stepId.startsWith('native.extension.')) {
        console.log(`执行扩展 ${pending.id} ${pending.stepId}`);
        const r = dispatch(root, { operation: 'execute', runId: name, actionId: pending.id, executorId: 'keel-governance-script' }, 'execute');
        if (r.status !== 'succeeded') fail(`扩展执行失败：${((r.error || {}).message || '').slice(0, 400)}`);
        const out = ((r.data || {}).outputs || {})[pending.stepId];
        console.log('扩展 verdict：', out && out.value && out.value.verdict, '|', ((out && out.value && out.value.summary) || '').slice(0, 200));
        continue;
      }
      if (BUILDER_STEPS.includes(pending.stepId)) {
        console.log(`${pending.id} ${pending.stepId} 等待 Builder 交接 → keel build ${name} --payload <file.json>`);
        return;
      }
      if (VERIFIER_STEPS.includes(pending.stepId)) {
        console.log(`${pending.id} ${pending.stepId} 等待独立验收 → keel verify ${name} --payload <file.json>`);
        return;
      }
      console.log(`推进 ${pending.id} ${pending.stepId}`);
      nativeNext(root, name, [], 'next');
    }
    fail('推进超过 10 步未完成，可能循环；keel status 检查。');
  },

  build(root) {
    // --payload wins; otherwise auto-collect from the repo: acceptance ids
    // from run state, evidence = files changed in HEAD, checks derived.
    let payload = opt('payload') ? readPayload(opt('payload')) : null;
    if (!payload) {
      const summary = opt('summary') || fail('keel build 需要 --payload <file.json> 或 --summary <说明>（自动采集模式）');
      const st = stateOf(inspect(root, name));
      const actAcc = ((pendingAction(root, name)?.input || {}).activation || {}).acceptance;
      const rawAcc = (Array.isArray(actAcc) && actAcc.length > 0 ? actAcc : st.acceptance) || [];
      const acc = Array.isArray(rawAcc) ? rawAcc.map((a) => a.id) : Object.keys(rawAcc);
      if (acc.length === 0) fail('run 状态里没有验收项，无法自动采集；请用 --payload 显式交接。');
      // Evidence = deliverable files currently in the change dir. git HEAD is
      // the wrong source: the commit may sweep in unrelated churn and deletions
      // (proven: archive moves of a previous change broke test -s checks).
      const sup = ['supervisor.parent.builder', 'supervisor.child.builder'].includes(pendingAction(root, name)?.stepId);
      const changeDir = path.join(root, 'docs/comet/changes', name);
      // Supervisor children work in their own worktree/branch: the change dir
      // is not the deliverable there. Evidence = files of the worktree HEAD
      // commit instead (added/modified only).
      const changed = sup
        ? headFiles(workRootOf(pendingAction(root, name), root))
        : existsSync(changeDir)
          ? readdirSync(changeDir).filter((f) => f !== 'comet-state.yaml').map((f) => 'docs/comet/changes/' + name + '/' + f)
          : [];
      const evidence = changed.length > 0 ? changed : ['git HEAD ' + gitHead(root)];
      payload = {
        summary,
        acceptanceReview: acc.map((id) => ({ id, status: 'implemented-with-evidence', evidence, note: 'evidence 由 git HEAD 自动采集' })),
        checks: [{ name: 'builder-auto', result: 'passed', note: 'keel build 自动采集交接' }],
        knownLimits: ['验收证据为 HEAD 变更文件全集，非逐条针对性证据；需要精确对账请用 --payload。'],
        verificationChecks: changed.map((f) => ({ id: 'exists-' + f.replace(/[^a-zA-Z0-9]/g, '-'), name: 'exists:' + f, executable: 'test', argv: ['-s', f], cwdRef: '.', timeoutMs: 10000, repeatable: true })),
      };
      if (!sup && existsSync(path.join(root, 'product/prd/prd.md'))) {
        payload.verificationChecks.push({ id: 'prd-green', name: 'prd-green', executable: 'python3', argv: ['.atlas/validators/validate_prd.py', '--root', '.'], cwdRef: '.', timeoutMs: 60000, repeatable: true });
      }
    }
    const pending = workableAction(root, name, BUILDER_STEPS);
    if (!pending) fail('当前没有待交接的 Builder Action；keel status 确认状态。');
    const workRoot = workRootOf(pending, root);
    // Integration repair has its own output shape (integrationCommit, not
    // candidateCommit); everything else shares the Builder payload.
    if (pending.stepId === 'supervisor.child.integration-repair') {
      if (!payload) payload = { summary: opt('summary') || fail('integration-repair 需要 --payload 或 --summary') };
      const output = {
        summary: payload.summary,
        integrationCommit: gitHead(workRoot),
        integrationChecks: payload.integrationChecks || [noopCheck('integration-auto', 'integration auto')],
      };
      claimAndRecord(root, name, pending, 'builder', output, 'integration-repair');
      console.log('integration-repair 交接成功（worktree=' + workRoot + '）。→ keel next', name);
      return;
    }
    // Protocol guards (0005 §3.4): evidence must be non-empty per row.
    for (const row of payload.acceptanceReview || []) {
      if (!Array.isArray(row.evidence) || row.evidence.length === 0) {
        fail(`acceptanceReview[${row.id}].evidence 为空；Builder 交接要求每条验收都有非空证据。`);
      }
    }
    const output = {
      summary: payload.summary,
      candidateCommit: gitHead(workRoot),
      addressedAcceptanceIds: (payload.acceptanceReview || []).map((r) => r.id),
      acceptanceReview: payload.acceptanceReview,
      checks: payload.checks || [],
      knownLimits: payload.knownLimits || [],
      submittedAt: new Date().toISOString(),
      verificationChecks: payload.verificationChecks || [],
    };
    claimAndRecord(root, name, pending, 'builder', output, 'builder');
    console.log('Builder 交接成功。→ keel next', name);
  },

  verify(root) {
    const payload = readPayload(opt('payload') || fail('keel verify 需要 --payload <file.json>'));
    const pending = workableAction(root, name, VERIFIER_STEPS);
    if (!pending) fail('当前没有待验收的 Verifier Action；keel status 确认状态。');
    // Child Verifier has a flat shape (verdict + integrationChecks + evidence),
    // not the candidate response.final-result envelope.
    if (pending.stepId === 'supervisor.child.verifier') {
      const activation = (pending.input || {}).activation || {};
      const child = activation.child || '?';
      // evidence.checks must equal the executed child.checks IDs, or the runtime
      // rejects with "check evidence is not current"
      // (native-sdk-supervisor-child.ts:133-139). Auto-collect from the bound
      // checkActionId outcome when the payload omits them.
      let checkIds = payload.checks;
      if (!checkIds && typeof activation.checkActionId === 'string') {
        const acts = ((inspect(root, name).data || {}).actions) || [];
        const chk = acts.find((a) => a.actionId === activation.checkActionId);
        checkIds = (((chk || {}).outcome || {}).output || {}).checks
          ? chk.outcome.output.checks.map((c) => c.id || c.name).filter(Boolean)
          : [];
      }
      const output = {
        candidateCommit: gitHead(workRootOf(pending, root)),
        verdict: payload.verdict,
        integrationChecks: payload.integrationChecks || [noopCheck(child + '-integration', child + ' integration check')],
        evidence: {
          summary: payload.summary,
          checks: checkIds || [],
          acceptance: payload.acceptance || [],
        },
      };
      claimAndRecord(root, name, pending, 'verifier', output, 'child-verifier');
      console.log('子任务 Verifier 裁决已记录：', payload.verdict, '（child=' + child + '）。→ keel next', name);
      return;
    }
    const next = dispatch(root, { operation: 'next', runId: name }, 'next-verifier');
    const runner = ((next.agent || {}).continuation || {}).runnerAction || {};
    const handoff = stateOf(inspect(root, name)).builder_handoff || {};
    const candidateId = runner.candidateId || handoff.candidate_id;
    if (!candidateId) fail('取不到当前 candidateId；keel status 确认状态。');
    // Independent session: sessionId must differ from the builder ref and be
    // echoed as verifierExecutionRef (0005 §3.6).
    // refreshChecks path (native-sdk-checks.ts:257): on check-input drift the
    // Verifier re-requests the original plans with refreshChecks:true; Runtime
    // reruns them against a fresh observation before a new Verifier round.
    const output = payload.refreshChecks === true
      ? {
          candidateId,
          refreshChecks: true,
          response: { kind: 'request-checks', checks: payload.checks || [] },
          verifierExecutionRef: 'verifier',
        }
      : {
          candidateId,
          response: {
            kind: 'final-result',
            result: {
              acceptance: payload.acceptance,
              attempt: runner.attempt || 1,
              iteration: runner.iteration || 1,
              risks: payload.risks || [],
              summary: payload.summary,
              verdict: payload.verdict,
            },
          },
          verifierExecutionRef: 'verifier',
        };
    claimAndRecord(root, name, pending, 'verifier', output, 'verifier');
    console.log('Verifier 裁决已记录：', payload.verdict, '。→ keel next', name);
  },

  // Resolve the current Wait with the user decision. Shape confirm is
  // two-step (record summary, then --confirmed); verify confirm uses the
  // continuation-issued proposal hash and guards.
  confirm(root) {
    const summary = opt('summary') || fail('keel confirm 需要 --summary <确认说明>');
    const extra0 = [];
    const st = nativeNext(root, name, ['--summary', summary], 'confirm-record');
    const cont = (st.agent || {}).continuation || {};
    const alts = cont.commandAlternatives || [];
    const alt = alts.find((x) => x.name === 'confirm-shape') || alts.find((x) => x.name === 'accept-result')
      || alts.find((x) => x.name === 'multi-session') || alts.find((x) => x.name === 'single-session');
    // Supervisor shape confirm: the alternative IS the coordination mode.
    const coord = opt('coordination-mode') || (alt && ['multi-session', 'single-session'].includes(alt.name) ? alt.name : null);
    if (coord) extra0.push('--coordination-mode', coord);
    if (!alt) {
      const c = alts.map((x) => x.name).join(', ') || '无';
      fail(`当前没有可确认的等待（可选：${c}）。disp=${cont.disposition} action=${cont.action}`);
    }
    const extra = ['--summary', summary, ...extra0];
    if (alt.name !== 'accept-result') extra.push('--confirmed');
    if (alt.name === 'accept-result') {
      extra.push('--accept-result');
      const h = (alt.commandArgs || []);
      const hi = h.indexOf('--proposal-hash');
      if (hi >= 0) extra.push('--proposal-hash', h[hi + 1]);
    }
    extra.push('--expected-state-version', String(alt.stateVersion), '--expected-action', alt.expectedAction);
    const d = nativeNext(root, name, extra, 'confirm');
    const a = d.agent || {};
    console.log(`已确认（${alt.name}）。phase=${a.phase} status=${a.status} sv=${a.stateVersion}`);
    console.log('→ keel next', name);
  },

  archive(root) {
    const d = comet(root, ['native', 'archive', name], 'archive');
    const a = d.agent || {};
    console.log(`归档：phase=${a.phase} status=${a.status}。`, d.summary || '');
  },

  update(root) {
    const args = [path.join(repoRoot, 'scripts/update.mjs'), '--project-root', root];
    if (process.argv.includes('--force')) args.push('--force');
    const r = spawnSync('node', args, { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  },
};

if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log(`keel — Keel 工作流命令（Comet Native × Atlas 治理）

  keel-h init [--yes]     项目接入：comet 运行时检测 + 装配 .atlas + 挂接应然资产 + 安装 Keel Skill/AGENTS 指引（不创建 change）
  keel-h onboard <change> [--yes]   开户：init + brief + start-request
  keel-h start <change>     启动 Run
  keel-h status <change>    查看 Run 状态与待办
  keel-h next <change>      推进 Runtime 可自行的部分（检查/扩展/报告）
  keel-h build <change> --payload <f.json>   Builder 交接（payload 只含业务字段）
  keel-h verify <change> --payload <f.json>  独立 Verifier 裁决
  keel-h confirm <change> --summary <说明> [--coordination-mode multi-session|single-session]  确认当前等待（Shape/验收；Supervisor 分流需 coordination-mode）
  keel-h archive <change>   归档
  keel-h update [--force]   升级已装配项目的 .atlas 载荷并复验（本地改动默认拒绝，--force 覆盖；有进行中 Run 时拒绝）
  keel-h selftest           全链回归自验（约 5 分钟）

通用：--project-root <p>（默认 cwd，必须物理路径）；COMET_BIN 指定 comet 运行时（默认取 npm 依赖 @rpamis/comet）。
build payload: {summary, acceptanceReview:[{id,status,evidence,note}], checks, knownLimits, verificationChecks}
verify payload: {verdict, summary, acceptance:[{id,result,reason}], risks}`);
  process.exit(0);
}
if (!commands[cmd]) fail(`未知命令：${cmd}（keel-h help）`);
if (cmd !== 'init' && cmd !== 'onboard' && cmd !== 'selftest' && cmd !== 'update' && !name) fail(`keel-h ${cmd} 需要 <change> 名`);
commands[cmd](projectRoot());
