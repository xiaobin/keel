---
name: independent-review
description: 实例⑤独立审查落盘门。校验 product/reviews/<目录>/ 下 review.json + README.md（双份留痕）经 atlas validate_review_report 合规：Critical 阻断、应审/实审对账、报告不存在=未审。由 keel 应用包在候选链位机器执行。
---

# independent-review

[门禁编排脚本](scripts/check.mjs)

契约：

- 审查者把报告落在固定路径 `product/reviews/review.json`（必备键 ok/status/root/scope/unit/round/checks/other，expected/reviewed 对账，findings 带 rollback）+ `product/reviews/README.md`。每个变更覆盖，历史走 git。
- 报告须在推进检查（keel next）前落位：缺失 = 未审 fail（fail-closed）。
- atlas `validate_review_report.py --dir` exit 0 → pass（WARN 不置红但进摘要）；exit 1 → fail（Critical 阻断）。

禁止发布、归档或自行批准。
