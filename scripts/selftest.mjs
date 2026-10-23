#!/usr/bin/env node
// Keel self-test: full lifecycle regression gate.
// Creates a scratch project in a physical-path temp dir, drives one change
// from onboard to archive using ONLY keel commands, asserts archive/done.
// Run: node scripts/selftest.mjs   (needs comet build, ~1-2 min)

import { mkdtempSync, realpathSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keelBin = path.join(repoRoot, 'bin/keel.mjs');
const fixtures = path.join(repoRoot, 'scripts/selftest-fixtures');
const CHANGE = 'selftest-change';

// os.tmpdir() may be symlinked (/var on macOS); keel requires physical paths.
const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'keel-selftest-')));
console.log('试验场：', root);

function run(label, cmd, args, opts = {}) {
  process.stdout.write(`[${label}] `);
  try {
    const out = execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    console.log('ok');
    return out;
  } catch (e) {
    console.log('FAIL');
    console.error(((e.stdout || '') + (e.stderr || '')).slice(0, 1500));
    console.error(`自验失败于步骤 ${label}。试验场保留：${root}`);
    process.exit(1);
  }
}

const keel = (...args) => run('keel ' + args[0], 'node', [keelBin, ...args, '--project-root', root]);
const git = (...args) => run('git ' + args[0], 'git', args);

git('init');
git('-c', 'user.name=keel-selftest', '-c', 'user.email=selftest@keel.local', 'commit', '--allow-empty', '-qm', 'init');

// onboard requires .comet/config.yaml; fixture mirrors comet init output
// (schema comet.project.v1) without platform picker interactivity.
mkdirSync(path.join(root, '.comet'), { recursive: true });
writeFileSync(path.join(root, '.comet/config.yaml'), readFileSync(path.join(fixtures, 'comet-config.yaml')));

keel('onboard', CHANGE);
writeFileSync(path.join(root, 'docs/comet/changes', CHANGE, 'brief.md'), readFileSync(path.join(fixtures, 'brief.md')));
mkdirSync(path.join(root, 'product/prd'), { recursive: true });
writeFileSync(path.join(root, 'product/prd/prd.md'), readFileSync(path.join(fixtures, 'prd.md')));
git('add', '-A');
git('-c', 'user.name=keel-selftest', '-c', 'user.email=selftest@keel.local', 'commit', '-qm', 'assets');

keel('start', CHANGE);
keel('confirm', CHANGE, '--summary', '自验确认范围');

writeFileSync(path.join(root, 'docs/comet/changes', CHANGE, 'candidate.md'), '# selftest 交付\n\n自验流程记录。\n');
// independent-review gate: exactly one review dir with review.json + README.md,
// committed with the candidate so the candidate fingerprint stays stable.
const reviewDir = path.join(root, 'product/reviews');
mkdirSync(reviewDir, { recursive: true });
writeFileSync(path.join(reviewDir, 'review.json'), JSON.stringify({
  ok: true, status: 'PASS', root: '.', scope: CHANGE, unit: 'selftest',
  round: 1, expected: 1, reviewed: 1, checks: [], other: [],
}, null, 1) + '\n');
writeFileSync(path.join(reviewDir, 'README.md'), '# 实例⑤审查留痕\n\n自验审查：PASS，应审 1 / 实审 1。\n');
git('add', '-A');
git('-c', 'user.name=keel-selftest', '-c', 'user.email=selftest@keel.local', 'commit', '-qm', 'candidate');

keel('build', CHANGE, '--summary', '自验自动采集交接');
keel('next', CHANGE);

// payload must stay outside the project (candidate fingerprint pollution)
const payloadFile = path.join(os.tmpdir(), 'keel-selftest-verify-payload.json');
writeFileSync(payloadFile, JSON.stringify({
  verdict: 'pass', summary: '自验裁决：验收有证据且检查绿',
  acceptance: [
    { id: 'A1', result: 'passed', reason: 'candidate.md 在册且非空' },
    { id: 'A2', result: 'passed', reason: 'validate_prd 绿' },
  ],
  risks: [],
}, null, 1));
keel('verify', CHANGE, '--payload', payloadFile);
keel('next', CHANGE);
keel('confirm', CHANGE, '--summary', '自验接受交付');
keel('next', CHANGE);

const status = execFileSync('node', [keelBin, 'status', CHANGE, '--project-root', root], { encoding: 'utf8' });
const line = status.split('\n')[0];
console.log('终态：', line);
if (!/phase=archive status=done .*archived=true/.test(line)) {
  console.error('断言失败：未到 archive/done。试验场保留：', root);
  process.exit(1);
}
console.log('SELFTEST PASS', root);
