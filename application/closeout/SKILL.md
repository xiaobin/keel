---
name: closeout
description: 收口门。跑 atlas_check 全量（不带 --fast：出厂测试与 E2E 真跑不跳过），FAIL⇒fail 回 Builder；SKIP 是「前置未声明」的合法未就绪态，不阻断但全量进摘要。由 keel 应用包在候选/parent 链位机器执行。
---

# closeout

[门禁编排脚本](scripts/check.mjs)

与 governance-suite 的唯一差异：governance-suite 用 `--fast`（每轮快检，跳过出厂测试与真跑），closeout 跑全量——收口语义 = 该跑的一项不省。

禁止发布、归档或自行批准。
