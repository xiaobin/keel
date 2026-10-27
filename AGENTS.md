# AGENTS.md

## 你是谁、在哪

你在 **Keel** 仓库里工作。Keel = 贯穿项目全生命周期的 Project Harness AI 编程工作流：**Comet Native 运行时 × Atlas 治理体系**。
技术路线与已拍板决策的唯一权威：`docs/decisions/0001-载体与技术路线.md`，先读它再动手。

## 上游参考实现（只读，不得修改）

- Atlas（治理层蓝本）：`/Users/xiaobin/Development/ai/agent/feature-lifecycle/atlas`
- Comet（运行时蓝本）：`/Users/xiaobin/Development/ai/agent/feature-lifecycle/comet`

## 当前任务（开工点）

**任务 1：设计 Atlas 治理层在 Comet Native 工作流中的挂点方案。**

1. 读 comet 的 Native 工作流实现（`comet/domains/`、`comet/CONTEXT.md`、docs/architecture），搞清楚：Native run 的生命周期各环节（Shape/Build/Verify/Archive）、扩展/自定义工作流应用的创建方式（SDK vs comet-any）、门禁类外部校验能在哪些环节注入。
2. 读 atlas 的 `.atlas/` 结构（三环资产、atlas_check、apply 技能），列出要下沉的治理能力清单。
3. 产出：`docs/decisions/0002-Native挂点设计.md`——Keel 的工作流阶段划分、每个阶段调用的治理校验、需要的 comet SDK 能力清单（标注 comet 已有 / 需自研）。
4. **只出设计文档，不写实现代码。**

## 工作约定

- 产出文档用中文；代码注释用英文。
- 新决策一律追加 `docs/decisions/NNNN-*.md`，不覆盖旧 ADR。
- 完成任务后汇报：产出了什么文件、发现 comet 缺什么能力、下一个建议任务。

<!-- KEEL:START -->
## Keel 工作流

本项目使用 Keel 管理需求变更；通过 `keel-h` 操作，不直接调用 Comet，也不手改 `.comet/` 运行态。

- 新变更：`keel-h onboard <change>`，补全 brief 并提交后，再 `keel-h start <change>`。
- 已有变更：先 `keel-h status <change>`，再按 CLI 提示推进；完整命令见 `keel-h --help`。
- 资产发现：先读 `atlas.config.yaml`（存在时）确定资产根，缺省为 `product/`；再读 `docs/comet/changes/<change>/brief.md`，不得凭路径猜测。
- 按阶段读取：Shape 读取既有 PRD/E2E/stack-profile；Build 按变更范围读取相关 PRD 验收条项、E2E 用例和 stack-profile；Verify/Archive 复核相同验收资产及审查、验证和走查留痕。资产只在原路径读取，不复制进本文件。
- 遵守 Shape→Build→Verify→Archive、Builder/Verifier 身份分离和用户确认；不得删除或弱化治理校验。
- 开工前保持 Git 工作区干净；Run 期间不要手改被跟踪文件，以免候选指纹漂移。
<!-- KEEL:END -->
