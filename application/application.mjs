import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createNativeWorkflowApplication } from '@rpamis/comet/applications/native';
import { hashRuntimeValue } from '@rpamis/comet/runtime';

// Keel fixed application: Native base + Atlas governance extension chain (design: docs/decisions/0002).
export function createApplication(context) {
  const inspect = (skill, action) => {
    const raw = execFileSync(
      process.execPath,
      [path.join(skill.root, 'scripts/check.mjs'), JSON.stringify(action.input)],
      { encoding: 'utf8' },
    );
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`${path.basename(skill.root)} 输出不是合法 JSON：${raw.slice(0, 200)}`);
    }
  };
  const governanceExtension = (id, scopes, artifactRefs) => ({
    id,
    skillId: id,
    scopes,
    artifactRefs,
    validator: {
      id: `atlas-${id}`,
      version: '1',
      validate: ({ action, outcome }) => {
        const actual = inspect(context.skills.get(id), action);
        return {
          accepted: hashRuntimeValue(actual) === hashRuntimeValue(outcome.output),
          reason: '回报与实际门禁编排结果不符',
        };
      },
    },
  });
  const host = context.createSkillExecutor({
    id: 'keel-governance-script',
    capabilities: ['skill-script'],
    authorize: async () => true,
    invokeSkill: async ({ skill, action }) => ({ status: 'succeeded', output: inspect(skill, action) }),
  });
  return createNativeWorkflowApplication(context, {
    executors: [host],
    extensions: [
      // Machine-check gate: rerun the skill's check script and compare canonical hashes.
      governanceExtension('governance-suite', ['candidate', 'parent'], ['product/stack-profile.yaml']),
      governanceExtension('independent-review', ['candidate'], ['product/reviews/review.json']),
    ],
  });
}
