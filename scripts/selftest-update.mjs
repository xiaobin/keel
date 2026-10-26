import { existsSync, readFileSync, writeFileSync, mkdtempSync, realpathSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Behavioral probes for `keel update` (docs/decisions/0013): happy path plus
// the refusal/rollback branches the main selftest never touches.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keelBin = path.join(repoRoot, 'bin/keel.mjs');
const vendorAtlas = path.join(repoRoot, 'vendor/atlas');
let failures = 0;
function check(cond, label) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failures += 1;
}
function run(args, root) {
  const r = spawnSync(process.execPath, [keelBin, ...args, '--project-root', root], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function freshProject() {
  // Physical path: the CLI rejects symlinked roots (/tmp on macOS).
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'keel-update-')));
  spawnSync('git', ['init', '--quiet', root]);
  return root;
}
const versionFile = (root) => path.join(root, '.atlas/VERSION');
const setDigest = (root, d) => {
  const lines = readFileSync(versionFile(root), 'utf8').split('\n');
  lines[0] = d;
  writeFileSync(versionFile(root), lines.join('\n'));
};
const firstLine = (root) => readFileSync(versionFile(root), 'utf8').split('\n')[0].trim();
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const newDigest = spawnSync('python3', [path.join(vendorAtlas, 'scripts/pkg_digest.py'), vendorAtlas], { encoding: 'utf8' }).stdout.trim();
const OLD = '0000000000000000';

// A: not assembled -> refuse, point to onboard.
{
  const root = freshProject();
  const r = run(['update'], root);
  check(r.status !== 0 && r.out.includes('未装配'), 'A 未装配项目拒绝并引导 onboard');
}

const root = freshProject();
console.log(`试验场：${root}`);
{
  const r = run(['onboard', 'update-probe'], root);
  check(r.status === 0 && firstLine(root) === newDigest, 'onboard 装配探针项目');
}

// F: active Run -> refuse even with --force (fingerprint drift is unrecoverable).
{
  const active = path.join(root, '.comet/current-change.json');
  writeFileSync(active, '{"change":"update-probe"}\n');
  const r = run(['update', '--force'], root);
  check(r.status !== 0 && r.out.includes('进行中 Run'), 'F 有进行中 Run 时拒绝（--force 不豁免）');
  spawnSync('rm', [active]);
}

// C: already latest -> idempotent no-op.
{
  const r = run(['update'], root);
  check(r.status === 0 && r.out.includes('已是最新'), 'C 已最新幂等退出');
}

// B: stale stamp, clean payload -> full refresh, backups cleaned up.
{
  setDigest(root, OLD);
  const r = run(['update'], root);
  check(r.status === 0 && firstLine(root) === newDigest, 'B 旧版戳升级到新版');
  check(!existsSync(path.join(root, '.atlas.keel-update-tmp')) && !existsSync(path.join(root, '.atlas.keel-update-backup')), 'B 临时/备份目录已清理');
}

// D: local edits/additions -> listed and refused; --force overwrites and removes.
{
  const target = path.join(root, '.atlas/scripts/atlas_check.py');
  appendFileSync(target, '\n# local probe edit\n');
  const added = path.join(root, '.atlas/scripts/local-note.txt');
  writeFileSync(added, 'local only\n');
  const r = run(['update', '--force'], root); // stale stamp not needed: force also reconciles
  check(r.status === 0, 'D 前置：force 可执行');
  appendFileSync(target, '\n# local probe edit\n');
  writeFileSync(added, 'local only\n');
  setDigest(root, OLD);
  const refused = run(['update'], root);
  check(refused.status !== 0 && refused.out.includes('modified  scripts/atlas_check.py') && refused.out.includes('added     scripts/local-note.txt'), 'D 本地改动被列出并拒绝');
  check(readFileSync(target, 'utf8').includes('local probe edit') && existsSync(added), 'D 拒绝时本地文件原样保留');
  const forced = run(['update', '--force'], root);
  check(forced.status === 0 && sha(target) === sha(path.join(vendorAtlas, 'scripts/atlas_check.py')) && !existsSync(added), 'D --force 覆盖修改并移除新增文件');
}

// E: revalidation gate failure -> rollback to the exact previous assembly.
{
  setDigest(root, OLD);
  const profile = path.join(root, 'product/stack-profile.yaml');
  writeFileSync(profile, 'name: broken\n');
  const r = run(['update'], root);
  check(r.status !== 0 && r.out.includes('已回滚'), 'E 复验失败报错并回滚');
  check(firstLine(root) === OLD && !existsSync(path.join(root, '.atlas.keel-update-backup')), 'E 回滚保留原装配戳且备份已清理');
}

console.log(failures === 0 ? 'UPDATE SELFTEST PASS' : `UPDATE SELFTEST FAIL（${failures} 项）`);
process.exit(failures === 0 ? 0 : 1);
