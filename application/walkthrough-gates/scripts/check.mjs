import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

const root = activation.workspaceRoot;
const profilePath = path.join(root, PROFILE);
const artifactHashes = existsSync(profilePath)
  ? { [PROFILE]: sha256(readFileSync(profilePath)) }
  : {};

// Machine-judgable form of atlas's two human-side walkthrough gates
// (shared/gates.md 2.5; semantics stay human, the ledger form is gated here):
// G1 walkthrough-doc confirmation — PRD "用户旅程走查" section must carry
//    "已确认：<date>" before e2e cases are written (rings/prd §4·八, e2e §6.2).
// G2 acceptance walkthrough — after E2E green, a reviews README with the
//    手工项 line and a pass declaration (rings/e2e §5.4).
const prdPath = path.join(root, 'product/prd/prd.md');
const e2eIndexPath = path.join(root, 'product/e2e/e2e-index.md');
const reviewsDir = path.join(root, 'product/e2e/reviews');

const problems = [];
const notes = [];

if (!existsSync(e2eIndexPath)) {
  notes.push('无 product/e2e/e2e-index.md：两道走查门 NA（资产未声明，非通过非失败）');
} else {
  // G1
  const prd = existsSync(prdPath) ? readFileSync(prdPath, 'utf8') : '';
  const heading = prd.search(/^#{1,6}\s*.*用户旅程走查.*$/m);
  if (heading === -1) {
    problems.push('走查单确认门：e2e 用例已落笔，但 PRD 缺「用户旅程走查」节（rings/e2e §6.2 前置门）。');
  } else {
    const rest = prd.slice(heading);
    // Section body starts after the heading's own line; search the next heading from there.
    const bodyStart = rest.indexOf('\n');
    const body = bodyStart === -1 ? '' : rest.slice(bodyStart + 1);
    const nextHeading = body.search(/^#{1,6}\s/m);
    const section = nextHeading === -1 ? body : body.slice(0, nextHeading);
    if (!/已确认：\s*\d{4}-\d{2}-\d{2}/.test(section)) {
      problems.push('走查单确认门：「用户旅程走查」节缺「已确认：<日期>」行（确认后才允许 e2e 落笔）。');
    }
  }
  // G2
  let walkthroughReadme = null;
  if (existsSync(reviewsDir)) {
    for (const dir of readdirSync(reviewsDir)) {
      if (!dir.includes('acceptance')) continue;
      const p = path.join(reviewsDir, dir, 'README.md');
      if (existsSync(p)) walkthroughReadme = p;
    }
  }
  if (!walkthroughReadme) {
    problems.push('验收走查门：缺 product/e2e/reviews/<日期>-acceptance-<域>/README.md 留痕（只在对话里说过 = 门没跑）。');
  } else {
    const text = readFileSync(walkthroughReadme, 'utf8');
    if (!/手工项：\s*\d+\s*项/.test(text)) {
      problems.push(`验收走查门：${walkthroughReadme} 缺「手工项：N 项」评估行。`);
    }
    if (!/验收走查：\s*通过/.test(text)) {
      problems.push(`验收走查门：${walkthroughReadme} 缺「验收走查：通过」结论行（②③ 未清零不收口）。`);
    }
  }
}

if (!existsSync(profilePath)) {
  out('fail', artifactHashes, '未完成开户：缺 product/stack-profile.yaml（先跑 keel onboard）。');
} else if (problems.length) {
  out('fail', artifactHashes, problems.join(' ') + (notes.length ? ' ' + notes.join('；') : ''));
} else {
  const applied = notes.length ? notes.join('；') : '走查单确认门+验收走查门留痕齐备';
  out('pass', artifactHashes, `walkthrough-gates 无违例：${applied}。`);
}
