# 0009：Supervisor 多子任务全链实证

- 状态：已决定（实证记录）
- 日期：2026-10-23
- 关联：0005（单候选全链）、0006（keel 命令面）、0007（候选指纹卫生）、0002 §6.3（缺口）

## 结论

Supervisor 多子任务（multi-session，2 children）全链用 **纯 keel 命令**走通并归档：sup-change-b，archive/done sv8，含 supervisor.cleanup。parent 链位三扩展（governance-suite fast / independent-review / closeout full）全部 pass。期间发生一次候选漂移锁死事故（sup-change），根因查明，修复前置后置零漂移。

## 1. 实证现场

- 成功 run：sup-change-b（/Users/xiaobin/keel-scratch，children alpha covers A1 / beta covers A2）。
- 失败 run（证据保留）：sup-change，卡在 parent verify.verifier（候选门漂移，见 §3）。
- 链序实测：supervisor.prepare → child.prepare×2 → child.builder×2 → child.checks×2 → child.verifier×2 → child.integrate×2 → child.integration-checks×2 → child.archive×2 → supervisor.parent.builder → verify.checks → parent 扩展×3 → verify.verifier → verify.report → verify.confirm → archive.execute/finalize → supervisor.cleanup。
- 子任务按步骤类型交错推进（两 builder → 两 checks → 两 verifier），非逐 child 串行。

## 2. 新协议事实（comet 源码证据）

1. **child verifier evidence.checks 必须等于已执行 child.checks 的检查 ID 全集**（native-sdk-supervisor-child.ts:133-139：checkIds 逐一对账，缺即 OUTCOME_REJECTED「check evidence is not current」）。keel verify 已改为缺省自动从 activation.checkActionId 的 outcome 采集。
2. **child verifier 验收 ID = children.yaml covers 的 A1/A2**，不是 child:<name>。
3. **child verifier 输出为扁平形** {candidateCommit, verdict, integrationChecks, evidence:{summary, checks, acceptance}}；pass 时 integrationChecks 须非空且全 repeatable（native-sdk-supervisor-child.ts:151-161）。
4. parent scope 扩展绑定 activation.integrationCommit：裁决时 resolveGitRef(root, branch) 必须等于绑定值，否则「扩展候选提交或分支已变化」（native-application.ts:300）。

## 3. 漂移锁死事故解剖（sup-change）

parent verify 阶段三连拒，三道门层级：

1. check-input 门（native-sdk-checks.ts:758）→ 可用 refreshChecks 豁免；
2. 扩展绑定门（commit/branch 比对）→ 只能恢复 ref；
3. **候选门（native-sdk-checks.ts:1106）→ refreshChecks 不能豁免**（「不能仅刷新检查来接受代码改动」），漂移即锁死，仅剩 revise-implementation/revise-requirements。

根因：`__pycache__/*.pyc` 仍被 git 跟踪（0007 的 untrack 在主仓暂存未及时提交，worktree 分支从旧 HEAD 分出仍带跟踪 pyc）。closeout 全量在 integration worktree 跑 Python → pyc 重建 → :20 verify.checks 观测与 verifier 时刻不一致。放大器：我在扩展激活后于 integration 分支与主仓做了卫生提交（移动 HEAD/改观测）。

铁律（已沉淀进实现）：

- **扩展激活后不得在对应分支再提交任何内容**；
- 指纹卫生（untrack pyc + gitignore + start-request 提交）必须在 `keel start` 前全部落位；
- 0007 的修复有效：sup-change-b 主仓 HEAD 已带全部卫生提交，worktree 无跟踪 pyc，closeout 全量跑 Python 零漂移。

## 4. 待办与边界

- [ ] `keel start` 加净态前置检查（git status 非空则拒绝启动并提示提交）——0009 事故的根治。
- single-session 协调模式未实证（协议同路径，模式仅影响 maxParallel）。
- integration-repair 回路未触发（本次 integration-checks 一次过）。
- sup-change 锁死 run 保留在 /Users/xiaobin/keel-scratch/.comet 与 ~/.comet/workspaces 存档中作证据。
