---
name: keel-builder-guidance
description: Keel 的 Builder 开始实现或修复时读取，约束当前工作区与三环资产同步纪律。
---

# Builder 指导

范围：当前 Builder 的实际工作区与 `product/` 三环资产。

- 实现以已确认 Shape（brief/Spec/AC）为准；需要改需求时请求重新确认 Shape，不擅自扩scope。
- 资产前置：行为变化同步更新对应 PRD/AC/E2E 意图与 testid，不留到收口补账。
- 每个 AC 的可观察断言都能在 E2E 找到归宿；testid 应然⇔实然一致。

这是只读执行指导。加载指导不能代替对实际候选的门禁检查。
禁止接管审批、发布或归档。
