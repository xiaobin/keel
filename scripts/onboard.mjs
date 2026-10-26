import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureComet, runInit } from './init.mjs';

// Keel onboarding (design: docs/decisions/0002 stage 0; 0014: init extraction).
// = project attach (init: comet check, asset attach, .atlas assembly, gate)
// + first-change creation (brief + start request). Gate failure = no onboarding.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, required = true) {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (required && (!v || v.startsWith('--'))) {
    console.error(`usage: node scripts/onboard.mjs --project-root <项目> --name <change> [--yes]`);
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
const assumeYes = process.argv.includes('--yes');

// Project attach (0014): comet runtime, .comet config, asset attach,
// .atlas assembly, fingerprint hygiene, burn-in, stack-profile gate.
const comet = await ensureComet({ repoRoot, assumeYes });
if (!comet) process.exit(1);
const rc = runInit({ projectRoot, repoRoot, comet });
if (rc !== 0) process.exit(rc);

const branch = execFileSync('git', ['-C', projectRoot, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();

// Brief skeleton (Shape input; authored further during Shape).
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

// Start request. initialState mirrors comet@0.5.0 createNativePortableState
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
