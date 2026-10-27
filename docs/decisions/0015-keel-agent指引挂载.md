# 0015 — Keel agent 指引挂载

- 日期：2026-10-27
- 状态：已决定
- 前置：0002（Native 挂点）、0010（Atlas 载荷内置）、0014（init 项目接入）
- 依据：用户反馈「agent.md里没有挂载keel」

## 决定

`keel-h init` 成功完成接入门后，在项目根 `AGENTS.md` 维护 Keel 自有的
`<!-- KEEL:START -->` / `<!-- KEEL:END -->` 指引区块；`onboard` 复用 init，因此行为一致。
区块说明 keel-h 命令入口、Native 生命周期、身份分离、用户确认与候选指纹纪律，
并要求从 `atlas.config.yaml` 与 change brief 发现应然资产，按生命周期阶段读取；
资产正文不复制进区块。本仓库根 `AGENTS.md` 同步挂载同一区块。

本决策仅取代 0010「不下发 AGENTS.md 接线」中针对 **Keel 自有指引** 的部分；
仍不安装 Atlas 独立模式的 ATLAS 指针或 Trellis 接线。0014 的「不接入、不评价」
继续适用于三环资产治理：Keel 指引区块不是治理资产，也不评价区块外的项目规范。

挂载规则：

- 无 KEEL 标记时追加区块；文件不存在则创建，区块外原内容逐字保留。
- 已有一对完整标记时替换区块；重跑幂等，不产生重复区块。
- 标记缺失、重复或顺序错误时接入失败，不改 `AGENTS.md`，提示人工修复。
- `keel-h update` 的 `.atlas/` 载荷升级边界不变。

## 验证

- `npm run selftest:init`：新建挂载、既有内容保留、幂等、异常标记拒绝。
- `npm run selftest`：onboard → archive 全链回归。