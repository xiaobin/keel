---
name: keel-governance-suite
description: 在已领取的 Native 候选治理 Action 中跑 atlas_check 门禁编排，回报原绑定的通过、失败或需求修订结论。
---

# Atlas 门禁编排

读取当前 Action 的固定输入，只在 activation.workspaceRoot 指向的真实工作区执行
[门禁编排脚本](scripts/check.mjs)。脚本调用项目内 `.atlas/scripts/atlas_check.py --fast --json`（atlas 载荷由 keel onboard 从 vendor/atlas 装配进被治理项目）
（Python 校验器外部调用，不重写；E2E 真跑门由后续 e2e-live 扩展承担）。

- atlas_check 绿 → verdict pass；红或无法执行 → verdict fail（fail-closed，不可用不豁免）。
- 应然资产（PRD/E2E）缺位或漂移导致红时，摘要必须点名，由流程决定 revise-requirements 回 Shape。
- 普通候选与 Supervisor 父级各自执行；父级通过不能替代 Child，本轮通过不能代替历史轮次。

失败回原 Builder 修复后提交新候选重新检查。禁止发布、归档或自行批准。
领取和回报使用同一 Action ID、attempt、inputHash、claimToken；中断先查询原 Action。
