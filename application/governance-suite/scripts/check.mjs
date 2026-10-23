import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Canonical-JSON SHA-256, mirrors comet@0.5.0 hashRuntimeValue (domains/engine/runtime-json.ts).
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const isIndex = (k) =>
    String(Number(k)) === k && Number.isInteger(Number(k)) && Number(k) >= 0 && Number(k) < 4294967295;
  const keys = Object.keys(value).sort((a, b) => {
    const ai = isIndex(a);
    const bi = isIndex(b);
    if (ai || bi) return ai && bi ? Number(a) - Number(b) : ai ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
const hashValue = (v) => createHash('sha256').update(canonical(v)).digest('hex');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

let activation;
try {
  activation = JSON.parse(process.argv[2]).activation;
} catch {
  // Fail-closed: unparseable input can never pass.
  process.stdout.write(
    JSON.stringify({
      verdict: 'fail',
      bindingHash: hashValue(process.argv[2] ?? null),
      artifactHashes: {},
      summary: 'Action 输入不是合法 activation JSON（fail-closed）。',
    }),
  );
  process.exit(0);
}
const bindingHash = hashValue(activation.reviewSource);
const PROFILE = 'product/stack-profile.yaml';

function out(verdict, artifactHashes, summary) {
  process.stdout.write(JSON.stringify({ verdict, bindingHash, artifactHashes, summary }));
}

const profilePath = path.join(activation.workspaceRoot, PROFILE);
const artifactHashes = existsSync(profilePath)
  ? { [PROFILE]: sha256(readFileSync(profilePath)) }
  : {};

// The orchestrator resolves validators under <root>/.atlas (atlas assembles INTO the
// governed project via install.sh); keel onboard is what runs that assembly.
const atlasCheck = path.join(activation.workspaceRoot, '.atlas/scripts/atlas_check.py');
if (!existsSync(profilePath)) {
  out('fail', artifactHashes, '未完成开户：缺 product/stack-profile.yaml（先跑 keel onboard）。');
} else if (!existsSync(atlasCheck)) {
  out('fail', artifactHashes, `atlas 未装配：缺 ${atlasCheck}（先跑 keel onboard）。`);
} else {
  const run = spawnSync(
    'python3',
    [atlasCheck, '--root', activation.workspaceRoot, '--fast', '--json'],
    { encoding: 'utf8', timeout: 10 * 60 * 1000 },
  );
  if (run.error) {
    out('fail', artifactHashes, `atlas_check 无法执行：${run.error.message}（fail-closed，不可用不豁免）。`);
  } else {
    // atlas §B110: SKIP = 未走到这一步，既非通过也非失败；列进摘要供 Verifier/收口门核对。
    let skipNote = '';
    let tail = `${run.stdout}\n${run.stderr}`.trim().slice(-400);
    try {
      const payload = JSON.parse(run.stdout);
      const skips = (payload.rows || []).filter((r) => r.status === 'SKIP').map((r) => r.name);
      if (skips.length) skipNote = ` SKIP 行（未走到，非通过）：${skips.join('、')}。`;
      tail = '';
    } catch {
      // Non-JSON output: keep the raw tail.
    }
    if (run.status === 0) {
      out('pass', artifactHashes, `atlas_check --fast 无 FAIL。${skipNote}${tail}`);
    } else {
      out('fail', artifactHashes, `atlas_check 红（exit ${run.status}）。${skipNote}应然资产缺位/漂移请走 revise-requirements。${tail}`);
    }
  }
}
