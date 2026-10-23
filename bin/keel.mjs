#!/usr/bin/env node
// Keel CLI — keel-level workflow verbs; drives Comet Runtime internally.
// Design: docs/decisions/0002 (hooks), protocol facts: docs/decisions/0005 §3.
// Never exposes comet commands; never writes request files inside the project.

import { existsSync, realpathSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const bin = process.env.COMET_BIN || path.resolve(repoRoot, '../comet/bin/comet.js');
  if (!existsSync(bin)) fail(`找不到 comet 仓内构建：${bin}（设 COMET_BIN 或构建 comet）。全局 PATH 的 comet 可能版本不符，禁用。`);
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

function gitHead(root) {
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

// Claim + record for a handoff action. keel owns every protocol field
// (0005 §3): caller-supplied unique claimToken, unique outcomeId,
// JS-ISO submittedAt, fields inside outcome.
function claimAndRecord(root, name, actionId, sessionId, output, label) {
  const next = dispatch(root, { operation: 'next', runId: name }, 'next-' + label);
  const tpl = ((((next.agent || {}).continuation || {}).inputOptions || [])
    .map((o) => o.template)
    .find((t) => t && t.operation === 'claim' && t.actionId === actionId));
  if (!tpl) fail(`${label}：当前没有可领取的 ${actionId}（状态可能已推进，先 keel status 看一下）。`);
  const claimToken = actionId + '-' + sessionId + '-' + Date.now();
  const claim = { ...tpl, executorId: 'native-host', sessionId, claimToken };
  const cr = dispatch(root, claim, 'claim-' + label);
  if (cr.status !== 'succeeded') fail(`${label} claim 被拒：${JSON.stringify(cr.error || cr).slice(0, 400)}`);
  const outcome = {
    actionId,
    attempt: tpl.attempt,
    inputHash: tpl.inputHash,
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
  onboard(root) {
    const n = name || fail('usage: keel onboard <change> [--project-root <p>]');
    const r = spawnSync('node', [path.join(repoRoot, 'scripts/onboard.mjs'), '--project-root', root, '--name', n], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  },

  start(root) {
    const req = path.join(root, 'docs/comet/changes', name, 'start-request.json');
    if (!existsSync(req)) fail(`缺 ${req}；先 keel onboard。`);
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
      if (['build.builder', 'supervisor.parent.builder'].includes(pending.stepId)) {
        console.log(`${pending.id} ${pending.stepId} 等待 Builder 交接 → keel build ${name} --payload <file.json>`);
        return;
      }
      if (pending.stepId === 'verify.verifier') {
        console.log(`${pending.id} verify.verifier 等待独立验收 → keel verify ${name} --payload <file.json>`);
        return;
      }
      console.log(`推进 ${pending.id} ${pending.stepId}`);
      nativeNext(root, name, [], 'next');
    }
    fail('推进超过 10 步未完成，可能循环；keel status 检查。');
  },

  build(root) {
    const payload = readPayload(opt('payload') || fail('keel build 需要 --payload <file.json>'));
    const pending = pendingAction(root, name);
    if (!pending || !['build.builder', 'supervisor.parent.builder'].includes(pending.stepId)) {
      fail('当前没有待交接的 Builder Action；keel status 确认状态。');
    }
    // Protocol guards (0005 §3.4): evidence must be non-empty per row.
    for (const row of payload.acceptanceReview || []) {
      if (!Array.isArray(row.evidence) || row.evidence.length === 0) {
        fail(`acceptanceReview[${row.id}].evidence 为空；Builder 交接要求每条验收都有非空证据。`);
      }
    }
    const output = {
      summary: payload.summary,
      candidateCommit: gitHead(root),
      addressedAcceptanceIds: (payload.acceptanceReview || []).map((r) => r.id),
      acceptanceReview: payload.acceptanceReview,
      checks: payload.checks || [],
      knownLimits: payload.knownLimits || [],
      submittedAt: new Date().toISOString(),
      verificationChecks: payload.verificationChecks || [],
    };
    claimAndRecord(root, name, pending.id, 'builder', output, 'builder');
    console.log('Builder 交接成功。→ keel next', name);
  },

  verify(root) {
    const payload = readPayload(opt('payload') || fail('keel verify 需要 --payload <file.json>'));
    const pending = pendingAction(root, name);
    if (!pending || pending.stepId !== 'verify.verifier') fail('当前没有待验收的 Verifier Action；keel status 确认状态。');
    const next = dispatch(root, { operation: 'next', runId: name }, 'next-verifier');
    const runner = ((next.agent || {}).continuation || {}).runnerAction || {};
    if (!runner.candidateId) fail('取不到当前 candidateId；keel status 确认状态。');
    // Independent session: sessionId must differ from the builder ref and be
    // echoed as verifierExecutionRef (0005 §3.6).
    const output = {
      candidateId: runner.candidateId,
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
    claimAndRecord(root, name, pending.id, 'verifier', output, 'verifier');
    console.log('Verifier 裁决已记录：', payload.verdict, '。→ keel next', name);
  },

  // Resolve the current Wait with the user decision. Shape confirm is
  // two-step (record summary, then --confirmed); verify confirm uses the
  // continuation-issued proposal hash and guards.
  confirm(root) {
    const summary = opt('summary') || fail('keel confirm 需要 --summary <确认说明>');
    const st = nativeNext(root, name, ['--summary', summary], 'confirm-record');
    const cont = (st.agent || {}).continuation || {};
    const alts = cont.commandAlternatives || [];
    const alt = alts.find((x) => x.name === 'confirm-shape') || alts.find((x) => x.name === 'accept-result');
    if (!alt) {
      const c = alts.map((x) => x.name).join(', ') || '无';
      fail(`当前没有可确认的等待（可选：${c}）。disp=${cont.disposition} action=${cont.action}`);
    }
    const extra = ['--summary', summary];
    if (alt.name === 'confirm-shape') extra.push('--confirmed');
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
};

if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log(`keel — Keel 工作流命令（Comet Native × Atlas 治理）

  keel onboard <change>   开户：装配三环资产 + .atlas + start-request
  keel start <change>     启动 Run
  keel status <change>    查看 Run 状态与待办
  keel next <change>      推进 Runtime 可自行的部分（检查/扩展/报告）
  keel build <change> --payload <f.json>   Builder 交接（payload 只含业务字段）
  keel verify <change> --payload <f.json>  独立 Verifier 裁决
  keel confirm <change> --summary <说明>   确认当前等待（Shape/验收）
  keel archive <change>   归档

通用：--project-root <p>（默认 cwd，必须物理路径）；COMET_BIN 指定 comet 仓内构建。
build payload: {summary, acceptanceReview:[{id,status,evidence,note}], checks, knownLimits, verificationChecks}
verify payload: {verdict, summary, acceptance:[{id,result,reason}], risks}`);
  process.exit(0);
}
if (!commands[cmd]) fail(`未知命令：${cmd}（keel help）`);
if (cmd !== 'onboard' && !name) fail(`keel ${cmd} 需要 <change> 名`);
commands[cmd](projectRoot());
