import { readdirSync, readFileSync, lstatSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Generates application/application.json with comet-compatible content hashes.
// Hash algorithm mirrors comet@0.5.0 applicationFilesHash + hashRuntimeValue
// (domains/workflow-application/skill-adapter.ts, domains/engine/runtime-json.ts).

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgRoot = path.join(repoRoot, 'application');

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

function skillContentHash(root) {
  const files = {};
  const walk = (rel) => {
    for (const name of readdirSync(path.join(root, rel)).sort((a, b) => a.localeCompare(b, 'en'))) {
      const ref = rel ? `${rel}/${name}` : name;
      const stat = lstatSync(path.join(root, ref));
      if (stat.isSymbolicLink()) throw new Error(`symlink not allowed in skill: ${ref}`);
      if (stat.isDirectory()) walk(ref);
      else if (stat.isFile()) files[ref] = createHash('sha256').update(readFileSync(path.join(root, ref))).digest('hex');
      else throw new Error(`irregular file in skill: ${ref}`);
    }
  };
  walk('');
  return hashValue(files);
}

function runtimeVersion() {
  if (process.env.COMET_VERSION) return process.env.COMET_VERSION;
  const sibling = path.resolve(repoRoot, '../comet/package.json');
  if (existsSync(sibling)) {
    try {
      return JSON.parse(readFileSync(sibling, 'utf8')).version;
    } catch {
      throw new Error(`comet package.json 无法解析：${sibling}`);
    }
  }
  throw new Error('comet version unknown: set COMET_VERSION or keep a sibling ../comet checkout');
}

const skills = ['governance-suite', 'independent-review', 'closeout', 'builder-guidance'].map((id) => ({
  id,
  root: id,
  contentHash: skillContentHash(path.join(pkgRoot, id)),
}));
const hashOf = (id) => skills.find((s) => s.id === id).contentHash;

const activationInput = {
  type: 'object',
  required: ['activation'],
  properties: {
    activation: {
      type: 'object',
      required: ['reviewSource', 'workspaceRoot', 'artifactRefs'],
      properties: {
        reviewSource: { type: 'object' },
        workspaceRoot: { type: 'string' },
        artifactRefs: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};
const governanceOutput = {
  type: 'object',
  required: ['verdict', 'bindingHash', 'artifactHashes', 'summary'],
  properties: {
    verdict: { enum: ['pass', 'fail', 'revise-requirements'] },
    bindingHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    artifactHashes: {
      type: 'object',
      properties: {
        'product/stack-profile.yaml': { type: 'string', pattern: '^[a-f0-9]{64}$' },
      },
      additionalProperties: false,
    },
    summary: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
};

const reviewOutput = {
  type: 'object',
  required: ['verdict', 'bindingHash', 'artifactHashes', 'summary'],
  properties: {
    verdict: { enum: ['pass', 'fail', 'revise-requirements'] },
    bindingHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    artifactHashes: {
      type: 'object',
      additionalProperties: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    },
    summary: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
};

const manifest = {
  schema: 'comet.workflow.application.v1',
  id: 'keel',
  version: '1',
  base: 'native',
  runtimeVersion: runtimeVersion(),
  entrySkill: 'SKILL.md',
  module: 'application.mjs',
  skills: [
    {
      id: 'governance-suite',
      root: 'governance-suite',
      contentHash: hashOf('governance-suite'),
      adapter: {
        kind: 'check',
        inputSchema: activationInput,
        outputSchema: governanceOutput,
        scope: ['product/stack-profile.yaml'],
        requiredCapabilities: ['skill-script'],
        interaction: 'none',
        sideEffect: 'read',
        controlsApproval: false,
        completion: 'machine-check',
        failure: 'repair',
        recovery: 'manual',
        review: {
          status: 'accepted',
          reviewedBy: 'keel-source-review',
          contentHash: hashOf('governance-suite'),
          capabilities: [
            { id: 'governance-suite', file: 'SKILL.md', excerpt: '[门禁编排脚本](scripts/check.mjs)' },
          ],
          effects: [{ file: 'SKILL.md', excerpt: '禁止发布、归档或自行批准。' }],
        },
      },
    },
    {
      id: 'independent-review',
      root: 'independent-review',
      contentHash: hashOf('independent-review'),
      adapter: {
        kind: 'check',
        inputSchema: activationInput,
        outputSchema: reviewOutput,
        scope: ['product/reviews'],
        requiredCapabilities: ['skill-script'],
        interaction: 'none',
        sideEffect: 'read',
        controlsApproval: false,
        completion: 'machine-check',
        failure: 'repair',
        recovery: 'manual',
        review: {
          status: 'accepted',
          reviewedBy: 'keel-source-review',
          contentHash: hashOf('independent-review'),
          capabilities: [
            { id: 'independent-review', file: 'SKILL.md', excerpt: '[门禁编排脚本](scripts/check.mjs)' },
          ],
          effects: [{ file: 'SKILL.md', excerpt: '禁止发布、归档或自行批准。' }],
        },
      },
    },
    {
      id: 'closeout',
      root: 'closeout',
      contentHash: hashOf('closeout'),
      adapter: {
        kind: 'check',
        inputSchema: activationInput,
        outputSchema: governanceOutput,
        scope: ['product/stack-profile.yaml'],
        requiredCapabilities: ['skill-script'],
        interaction: 'none',
        sideEffect: 'read',
        controlsApproval: false,
        completion: 'machine-check',
        failure: 'repair',
        recovery: 'manual',
        review: {
          status: 'accepted',
          reviewedBy: 'keel-source-review',
          contentHash: hashOf('closeout'),
          capabilities: [
            { id: 'closeout', file: 'SKILL.md', excerpt: '[门禁编排脚本](scripts/check.mjs)' },
          ],
          effects: [{ file: 'SKILL.md', excerpt: '禁止发布、归档或自行批准。' }],
        },
      },
    },
    {
      id: 'builder-guidance',
      root: 'builder-guidance',
      contentHash: hashOf('builder-guidance'),
      adapter: {
        kind: 'guidance',
        inputSchema: {},
        outputSchema: {},
        scope: ['product/stack-profile.yaml'],
        requiredCapabilities: [],
        interaction: 'none',
        sideEffect: 'read',
        controlsApproval: false,
        completion: 'self-report',
        failure: 'stop',
        recovery: 'manual',
        review: {
          status: 'accepted',
          reviewedBy: 'keel-source-review',
          contentHash: hashOf('builder-guidance'),
          capabilities: [
            { id: 'builder-guidance', file: 'SKILL.md', excerpt: '资产前置：行为变化同步更新对应 PRD/AC/E2E' },
          ],
          effects: [{ file: 'SKILL.md', excerpt: '这是只读执行指导。' }],
        },
      },
    },
  ],
  bindings: [
    ...['candidate', 'parent'].map((scope) => ({
      workflowId: 'comet-native',
      stepId: `native.extension.${scope}.governance-suite`,
      skillId: 'governance-suite',
      capability: 'governance-suite',
      usage: 'action',
    })),
    {
      workflowId: 'comet-native',
      stepId: 'native.extension.candidate.independent-review',
      skillId: 'independent-review',
      capability: 'independent-review',
      usage: 'action',
    },
    ...['candidate', 'parent'].map((scope) => ({
      workflowId: 'comet-native',
      stepId: `native.extension.${scope}.closeout`,
      skillId: 'closeout',
      capability: 'closeout',
      usage: 'action',
    })),
    ...[
      'build.builder',
      'supervisor.parent.builder',
      'supervisor.child.builder',
      'supervisor.child.integration-repair',
    ].map((stepId) => ({
      workflowId: 'comet-native',
      stepId,
      skillId: 'builder-guidance',
      capability: 'builder-guidance',
      usage: 'guidance',
    })),
  ],
};

const file = path.join(pkgRoot, 'application.json');
writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${file}`);
for (const s of skills) console.log(`  ${s.id}: ${s.contentHash}`);
console.log(`  runtimeVersion: ${manifest.runtimeVersion}`);
