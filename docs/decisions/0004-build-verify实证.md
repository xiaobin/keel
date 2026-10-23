# 0004 Build→Verify 全链实证（任务4）

状态：已接受（scratch 项目实测，comet@0.5.0 + keel 骨架）
日期：2026-10-23

## 实证链路

`build.builder(claim+record-outcome) → verify.checks → native.extension.candidate.governance-suite → verdict fail → build/repairing iteration 2`

governance-suite 扩展在设计的链位（verify.checks 之后、candidate scope）真实触发并 fail-closed 拦回 Builder。

## 硬约束（实证得出）

1. **Builder 协议**：dispatch `claim`（executorId `native-host`、sessionId、claimToken）→ `record-outcome`（outcome.output 含 summary/candidateCommit/addressedAcceptanceIds/acceptanceReview/checks/knownLimits/submittedAt/verificationChecks）。acceptanceReview 条目形如 `{id,status:'implemented-with-evidence',evidence:[...],note}`。
2. **verify.checks 执行 Builder 申报的 verificationChecks**（executable/argv/cwdRef/timeoutMs/repeatable），宿主直接跑进程。
3. **扩展 Action 用 `execute` 直跑**：`{operation:'execute',runId,actionId,executorId:'keel-governance-script'}` 会自动执行脚本、校验 Outcome 契约并入账。先 `claim` 反而报 `CAPABILITY_REQUIRED`（claim 路径要求声明 requiredCapabilities）。
4. **Outcome 契约四要素被真验**：verdict/bindingHash/artifactHashes/summary 缺一会被声明的 validator 拒绝（本次四要素齐全被接受，action status succeeded，receipt 入账）。
5. **fail 闭环**：verdict fail → phase 回 build、loop.stage repairing、iteration+1、next_action submit-builder-candidate。实测 fail Outcome：atlas_check exit 1（greenfield 无 PRD），summary 带 SKIP 行清单（9 项未走到）。

## 未验证

- pass 路径：需 scratch 具备绿色 PRD 资产（Shape 阶段 PRD authored 后），验证 verdict pass → verify.verifier。
- verify.verifier 独立会话、verify.report、verify.confirm、Archive。
- claim 路径的 requiredCapabilities 声明确切语义（本次绕过未究）。
