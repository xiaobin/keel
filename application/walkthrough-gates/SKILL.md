---
name: keel-walkthrough-gates
description: keel 走查门扩展执行器。把 atlas 两道人侧走查门（走查单确认门/验收走查门）的留痕形态下沉为机器判据：e2e 用例落笔前 PRD 走查节须带「已确认：<日期>」；收口前须有 acceptance 走查 README（手工项评估行+通过结论行）。语义真伪仍归人。
---

# walkthrough-gates

挂点：candidate + parent 链位，排在 closeout 之后。

判据（atlas `shared/gates.md` 2.5 两道人侧门的机器可判形态）：

- **走查单确认门**：`product/e2e/e2e-index.md` 存在（用例已落笔）时，PRD 须含「用户旅程走查」节且节内有 `已确认：<YYYY-MM-DD>` 行。
- **验收走查门**：同上触发条件下，须有 `product/e2e/reviews/<日期>-acceptance-<域>/README.md`，含「手工项：N 项」评估行与「验收走查：通过」结论行。
- 无 e2e-index（零域项目）：两门 NA，pass 并在 summary 注明（对应 atlas SKIP 语义）。

fail-closed：缺 stack-profile（未开户）或任一判据违例 → fail，摘要给出缺的具体留痕。

[门禁编排脚本](scripts/check.mjs)：纯 node，读 activation 后按上述判据判定并产出 Outcome。

禁止发布、归档或自行批准。
