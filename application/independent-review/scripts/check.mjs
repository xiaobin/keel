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
const REVIEWS = 'product/reviews';

function out(verdict, artifactHashes, summary) {
  process.stdout.write(JSON.stringify({ verdict, bindingHash, artifactHashes, summary }));
}

// keel convention: one fixed report per change at product/reviews/review.json (+README.md),
// overwritten each change; history lives in git. Missing report = not reviewed, never a pass.
const reviewsRoot = path.join(activation.workspaceRoot, REVIEWS);
const jsonPath = path.join(reviewsRoot, 'review.json');
if (!existsSync(jsonPath)) {
  out('fail', {}, `未找到实例⑤审查报告：${REVIEWS}/review.json 不存在（报告不存在=未审，不是通过）。`);
} else {
  const artifactHashes = {
    [`${REVIEWS}/review.json`]: sha256(readFileSync(jsonPath)),
  };
  // artifactHashes must equal hashExtensionArtifactHashes(artifactRefs) exactly (no extra keys).
  // README.md presence is still enforced by the python validator (双份留痕).
  // The validator resolves under <root>/.atlas (atlas assembles INTO the governed project).
  const validator = path.join(activation.workspaceRoot, '.atlas/scripts/validate_review_report.py');
  if (!existsSync(validator)) {
    out('fail', artifactHashes, `atlas 未装配：缺 ${validator}（先跑 keel onboard）。`);
  } else {
    const run = spawnSync('python3', [validator, '--dir', reviewsRoot], {
      encoding: 'utf8',
      timeout: 5 * 60 * 1000,
    });
    if (run.error) {
      out('fail', artifactHashes, `validate_review_report 无法执行：${run.error.message}（fail-closed，不可用不豁免）。`);
    } else {
      const tail = `${run.stdout}\n${run.stderr}`.trim().slice(-400);
      if (run.status === 0) {
        // exit 0 may still carry WARN lines (Major / M<N) — surface them in the summary.
        out('pass', artifactHashes, `实例⑤审查报告合规。${tail}`);
      } else {
        out('fail', artifactHashes, `实例⑤审查门红（exit ${run.status}：Critical 或应审/实审对账不过）。${tail}`);
      }
    }
  }
}
