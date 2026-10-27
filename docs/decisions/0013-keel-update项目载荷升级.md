# 0013 keel-h update：升级已装配项目的 .atlas 载荷

- 状态：已实证（`npm run selftest:update` 全绿 + demo 真实项目验证）
- 日期：2026-10-26
- 前置：0010（载荷内置与版本戳）、0006（命令面）、0009 §3（候选指纹）、0007（指纹卫生）

## 背景

vendor/atlas 升级只更新仓内载荷；已 onboard 项目的 `.atlas/` 停留在旧装配——onboard 对已装配项目跳过复制，atlas_check 装配版本门持续 WARN 漂移。用户要求参考 `comet update`，在升级时可以更新到已安装的项目上。

上游证据（comet 仓，只读）：`app/cli/index.ts:563` `update [path]` 默认连 npm 包自更新，`:583` `--project-only` 只刷新项目资产；`platform/install/application-host.ts:317` 对用户自有内容 `Refusing to overwrite user-owned`，不静默覆盖。

## 决策

新增 `keel-h update [--project-root <p>] [--force]`（bin/keel.mjs → scripts/update.mjs，无 change 名）：

1. **只做项目侧**：刷新 `.atlas/` 到本仓 vendor/atlas，重落 MANIFEST/VERSION 并复验。keel-h 工具自身升级仍走 `npm install -g @xiaobin268/keel-h` 或源码 pull，不做 npm 自更新。
2. **前置**：已装配（VERSION 在），否则引导 onboard；缺 MANIFEST.json 的旧装配无法对账，默认拒绝，`--force` 可跳过对账。
3. **有进行中 Run 拒绝**（`.comet/current-change.json` 存在，`--force` 不豁免）：更新被跟踪载荷必漂移候选指纹，无向前恢复出口（0009 §3）。
4. **幂等**：VERSION digest 与 vendor 相同且非 force → 报已最新退出 0；`--force` 可强制重装，用于修复被改坏的载荷。
5. **本地改动对账**：按 MANIFEST.files 逐文件 sha256 判定 modified/missing；非基线、非运行态的新增文件记 added。有改动先列清单，默认拒绝；`--force` 覆盖/移除。
6. **替换与回滚**：临时目录复制 → 旧目录改名备份 → 新目录就位 → `pkg_digest.stamp_file`（先 MANIFEST 后 VERSION，半态协议）→ 复验；任一失败回滚原装配，成功后删备份。
7. **复验口径与 onboard 相同**：`atlas_check --fast` burn-in 不门禁（greenfield PRD 红属预期），`validate_stack_profile` 为硬门——新载荷必须接受既有项目资产，否则升级失败回滚。
8. **不碰项目资产**：product/、docs/ 等不动；不要求工作区净态（只写 .atlas 与临时目录），完成后提示审查提交。

## 边界

- `.atlas/` 是托管载荷：其中本地修改在 `--force` 下丢失（清单先行打印）；要保留改动须先人工对账。
- PRD/E2E 应然资产漂移不是 update 职责，仍走 revise-requirements。
- `.atlas/runs/` 运行态随替换重建，不视为用户资产。

## 实证

- `npm run selftest:update`（scripts/selftest-update.mjs）：A 未装配拒绝并引导 onboard；F 进行中 Run 拒绝（--force 不豁免）；C 已最新幂等；B 旧版戳升级 + 临时/备份目录清理；D 本地 modified/added 列出并拒绝、拒绝时原样保留、--force 覆盖修改并移除新增；E 复验门失败回滚原装配戳。全绿。
- demo 真实项目（keel-demo，已归档无活跃 Run）：`keel-h update` 幂等报已最新，exit 0，工作区净。
- `npm run selftest` 全链回归（CLI 命令面改动后）。
