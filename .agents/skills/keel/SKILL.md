---
name: keel
description: "Keel 需求变更工作流入口。Use when 用户调用 /keel 或 /skill:keel，或要求接入项目、开户、启动、继续、验收或归档 Keel change，按 Shape→Build→Verify→Archive 推进需求。普通代码查询和不属于 change 的编辑不要启动 Run。"
---
<!-- KEEL:MANAGED -->

# Keel 工作流

在项目根工作。所有生命周期操作统一通过 `keel-h`；不要直接调用 Comet，不要手改 `.comet/` 运行态，也不要接入 Atlas 独立工作流。

先阅读项目 `AGENTS.md` 的 KEEL 区块并遵守其中的资产发现、分阶段读取、身份分离、用户确认和候选指纹纪律。

## 调用路由

把技能调用后附带的参数映射到下列意图；不得编造 change 名或验收结论。

| 参数 | 动作 |
| --- | --- |
| 空 | 当前 change 明确时查看状态；否则询问用户要接入、开户还是继续哪个 change |
| `init` | 执行 `keel-h init` |
| `onboard <change>` | 执行 `keel-h onboard <change>`，然后提示补全 brief 并提交；不要自动启动 Run |
| `start <change>` | 确认 brief 已补全且工作区净态后执行 `keel-h start <change>` |
| `<change>` 或 `status <change>` | 执行 `keel-h status <change>`，按输出继续 |
| `next <change>` | 执行 `keel-h next <change>` |
| `update` | 执行 `keel-h update`；只升级 `.atlas`，不替代 init 的 Skill 刷新 |

其他生命周期子命令对应同一个 `keel-h` 命令；完整参数以 `keel-h --help` 和 CLI 当前输出为准。无法确定意图时先询问，不要猜测。

## 推进纪律

1. 已有 change 先 `status`，只处理当前阶段需要的动作；Runtime 可自行的推进用 `next`。
2. Builder 先完成实现、测试和提交，再用 `keel-h build <change>` 交接真实证据；不得把未实施的条项写成完成。
3. Verifier 必须使用独立于 Builder 的会话，复核验收资产并实际执行检查，再用 `keel-h verify <change> --payload <file.json>` 提交裁决。
4. Shape 定稿、协调模式与验收由用户决定。遇到 `await-user` 或等待确认时停下并询问；不得代替用户执行 `confirm`。
5. 验收确认后按 CLI 提示推进并执行 `keel-h archive <change>`。失败、超时或状态不明时先重新 `status`，不要盲目重复提交。
