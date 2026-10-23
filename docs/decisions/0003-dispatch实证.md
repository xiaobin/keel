# 0003 dispatch 最小链路实证（任务3）

状态：已接受（scratch 项目实测，comet@0.5.0 + keel 骨架）
日期：2026-10-23

## 实证链路与结论

`onboard → runtime dispatch(start) → shape.prepare → shape.confirm(Wait) → --confirmed → Build`
全程跑通，零手工编辑 `comet-state.yaml`。以下为实证得出的硬约束，后续任务必须遵守：

1. **清单审查证据是精确匹配**。`adapter.review.excerpt` 必须是 skill 文件的逐字节子串（换行敏感）：`执行 [门禁编排脚本]` 曾因中间换行被拒（INVALID_WORKFLOW）。`build-application.mjs` 的 excerpt 改动后必须重跑 dispatch 验证。
2. **包内 import 必须可解析**。`application.mjs` 的 `@rpamis/comet/*` 由 Node 从包根解析；keel 以 `"@rpamis/comet": "file:../comet"` 声明依赖（npm install 建符号链接）。上游 comet 未发布 npm 前保持 file: 引用。
3. **`.comet/config.yaml` 必须含 `native` 段**（`native-config.ts readProjectConfig`：`!config?.native → null`）。空 `{}` 不够；开户前必须真跑 `comet init`——`comet init --yes --workflow native --language zh --root docs` 可全非交互。onboard 的前置检查顺序（config 存在）正确，但提示语应指向这条命令。
4. **shape.prepare 文档门 fail-closed**：占位符小节按代码点名（brief-section-placeholder ×N、spec-exemption-missing），状态保留可修复重推。spec 豁免写法 = 非标题行 `No product behavior change: <具体原因>`（`native-portable-requirements.ts hasExplicitSpecExemption`）。
5. **shape.confirm 双守卫**：`--confirmed --summary <text> --expected-state-version <n> --expected-action confirm-shape`；守卫值从 inspect 的 waits/proposalHash 与 state.state_version 取。
6. **dispatch 支持 id 引用**：confirm 后 NEXT 提示为 `comet runtime dispatch --application keel --request ...`（不必每次 `--application-file` 全路径）。

## 本轮未验证（后续任务）

- Build → Verify 全链：builder-handoff JSON 桥、governance-suite 扩展在 `verify.checks` 后的实发与 Outcome 校验、Native 独立 Verifier、`verify.confirm`。
- Supervisor 多子任务（children）与 candidate/parent 之外的 scope。
- Archive 与可恢复归档门禁。
- keel onboard 与 comet init 的真实先后序（本轮 onboard 先于 init 跑，未反向验证覆盖冲突）。
