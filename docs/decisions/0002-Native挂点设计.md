# 0002 — Atlas 治理层在 Comet Native 工作流中的挂点设计

- 日期：2026-10-24
- 状态：提案（待评审）
- 前置：0001（载体与技术路线）

## 0. 调研依据

| 来源 | 用途 |
| ---| ---|
| `comet/CONTEXT.md` | Run / Action / Outcome / Wait / Workflow Application 术语权威 |
| `comet/docs/architecture/native-extensions.zh.md` + `domains/comet-native/native-application.ts` | Native 扩展机制（挂点本体） |
| `comet/domains/comet-native/native-sdk-application.ts`（`defineNativeWorkflowApplication` 及 transition handler） | Native Run 生命周期全图 |
| `comet/docs/architecture/workflow-application.zh.md` | 应用包固定身份、Skill 适配、宿主授权契约 |
| `comet/docs/architecture/comet-any-sdk-requirements.zh.md`（R01–R26） | comet-any 与 SDK 的分工 |
| `comet/domains/engine/workflow-run.ts` | `RuntimeValidator` / `RuntimeValidation` 接口 |
| `atlas/DESIGN.md`、`atlas/shared/gates.md`、`atlas/validators/`、`atlas/apply/reference.md`、`atlas/skills/` | 治理能力清单与门禁分级 |

## 1. Comet Native Run 生命周期与可注入性

### 1.1 生命周期全图（从 transition handler 实读）

```text
Shape    shape.prepare → shape.confirm(Wait，用户确认)
           └ shape.revise / shape.remove / shape.disassociate / shape.revalidate（修订族）
Build    单候选：build.builder（失败 → build.resume Wait → 重派或 revise-requirements 回 Shape）
         Supervisor：supervisor.prepare → supervisor.shape.confirm(Wait)
           → 逐 Child：supervisor.child.prepare → child.builder → child.checks
             → child.verifier → child.integrate → child.integration-checks
             （失败 → integration-repair / integration-resume 循环）→ child.archive
           → supervisor.parent.builder（父候选）
Verify   verify.checks / verify.requested-checks → verify.verifier（独立 Verifier，身份分离）
           → verify.report → verify.confirm(Wait，用户接受)
           （verify.retry / verify.stop / verify.checks-stop / verify.revalidate 为修复与终止族）
Archive  （Supervisor：supervisor.parent.deliver）→ archive.prepare → archive.execute → archive.finalize
           └ `comet native archive --dry-run` 只读预检（交付候选、目标分支、快进关系、工作区）
```

### 1.2 门禁类外部校验可注入的环节

唯一公开挂点 = `createNativeWorkflowApplication(context, { extensions })` 的 `NativeApplicationExtension`：

```ts
{ id, skillId, scopes: ('candidate'|'parent'|'child'|'integration')[],
  artifactRefs: string[], validator: RuntimeValidator }
```

| scope | 链上位置（原检查之后、流程继续之前） | 治理语义 |
| ---| ---| ---|
| `child` | `supervisor.child.checks` 之后 | 单 Child 候选检查 |
| `integration` | `supervisor.child.integration-checks` 之后 | 集成候选检查 |
| `candidate` | `verify.checks` 之后（单候选） | 交付候选检查 |
| `parent` | `verify.checks` 之后（Supervisor 父候选） | 父候选/总交付检查 |

机制要点（均为 comet 已有）：

- 扩展按声明顺序串行执行，必需扩展 pass 才继续原流程；不替换 Native 的 Builder、独立 Verifier 与用户确认。
- Outcome 须含 `verdict`（`pass` / `fail` / `revise-requirements`）、`bindingHash`、`artifactHashes`、非空 `summary`，且必须经真实业务 validator 判定——`loaded: true` 或自报 pass 不算数（fail-closed）。
- `fail` → 回到对应范围的 Builder 或 `supervisor.child.integration-repair`，新候选重新检查。
- `revise-requirements` → 产生用户决定，经受保护命令（`--summary` + `--expected-state-version` + `--expected-action revise-requirements`）回 Shape；旧确认与验收失效，历史 Action 可查询但不能代替本轮。
- `activation.reviewSource` 精确绑定原检查 Action、inputHash、outcomeId、候选、shapeHash/formalHash 及（Child）contractHash/branch/worktree/baseCommit/candidateCommit；`activation.workspaceRoot` 指向本次真实工作区——外部校验器（含 E2E 真跑）在正确现场执行。
- 扩展 Action 由适配 Skill（脚本或模型）执行，结果再经 `RuntimeValidator.validate({run, action, outcome})` 机器校验，失败入 `rejectedOutcomes` 保留原 claim 与工件。

### 1.3 挂不上的环节（缺口，见 §5 的迂回与 §6 的缺口清单）

- **Shape 阶段无扩展 scope**：`shape.prepare → shape.confirm` 之间无法插入必需校验。
- **Archive 阶段无扩展 scope**：`archive.prepare/execute/finalize` 无治理钩子（`--dry-run` 预检是只读核对，不含外部校验）。
- **扩展不能新增自定义 Wait**：人侧确认门只能复用原生 `shape.confirm` / `verify.confirm` / `supervisor.shape.confirm` 与 `revise-requirements` 通道。

## 2. 自定义应用的创建方式：SDK vs comet-any

| 路径 | 是什么 | Keel 的取舍 |
| ---| ---| ---|
| **SDK 手写固定包** | `application.json`（`comet.workflow.application.v1`：id/version/base=native/runtimeVersion/entrySkill/module/skills/bindings）+ 自包含 `.mjs` 工厂 `createApplication(context)` + 适配 Skill + 验证器；经 `comet runtime dispatch --application-file … --request …` 启动；全部文件入内容摘要，漂移即拒 | **选用**。Keel 是长期维护的产品流程，门禁逻辑需要逐行可控、可测试；参考样板 = `prepareNativeCandidateReviewProject`（候选审查应用） |
| **comet-any 生成** | 生成器产品：按用户目标产出完整 Workflow Application 包（三种起点：Native 扩展 / Classic 编排调整 / 独立 SDK 工作流） | 不用于 Keel 本体。未来若开放"用户自定义治理流程"可作为生成入口，另行决策 |

结论：Keel = **base=native 的 SDK 固定应用包**（id 不得占用 `native`/`classic-*` 内置名），Native 主流程原样保留，治理全部经 `extensions` 注入。

## 3. Atlas 治理能力下沉清单

按 `atlas/DESIGN.md`（约束层定界）与 `shared/gates.md`（门禁总账）整理。"下沉形态"列对应 §4 的挂点。

| # | 能力 | atlas 载体 | 性质 | 下沉形态 |
| ---| ---| ---| ---| ---|
| A1 | 三环资产：structure（实然事实）→ prd（应然叙事+AC）→ e2e（应然用例+testid 清单+机器索引） | `product/`、结构事实目录、`rings/*/reference.md` | living 资产 | Keel 应用包内带模板与契约；用户项目内落位，作为 Shape 输入与扩展校验对象（`artifactRefs`） |
| A2 | apply 跨环增量契约（需求流过资产、前置而非后补；入口矩阵含 all/adopt/backfill/无卡修订等） | `apply/reference.md` | 流程契约 | 需求级主路径 = Keel Native Run（本文 §4）；开户/治理/回流等非需求入口 → 后续 ADR（见 §7） |
| A3 | 9 个机器校验器：validate_structure / prd / e2e_index / testids / ac_alignment / stack_profile / e2e_mocks / design_exemptions / adr | `validators/*.py` | 机器门 | **Python 不重写**（0001）；Keel 侧 TS 薄适配器 spawn 调用，输出映射为扩展 verdict（见 §4.2） |
| A4 | atlas_check 编排（逐器一行、对齐测试、生成物最新、E2E 真跑四行门） | `scripts/atlas_check.py` | 机器门编排 | 同上，作为 candidate/parent scope 的单个扩展整体调用 |
| A5 | E2E 真跑门（真栈 pytest/playwright、依赖可导入性判据、浏览器就绪判据、失败留证 trace） | atlas_check `E2E 真跑` 行 + 生成物 | 机器门 | parent/candidate scope 扩展，经 `activation.workspaceRoot` 在真实工作区执行 |
| A6 | 独立审查（实例⑤：实现代码分审，Critical 阻断收口；review.json 契约、应审 N/实审 M 对账） | `cli_review_convert.py`、`validate_review_report.py`、`independent-review.md` | 语义门+机器形态门 | 审查执行 = 扩展 Skill（模型分审，与 Builder 身份分离）；报告形态校验 = 同扩展 validator；与 comet 独立 Verifier 并存不替代 |
| A7 | 完成门（相关用例全 green 且实例⑤无 Critical 才允许收口，否则 blocked+原因） | gates.md 2.4 | 机器门 | parent scope 扩展（archive 前最后一道，见 §4.4） |
| A8 | 用户确认门 / 走查单确认门 / 验收走查门（人侧，三值走查清零+留痕） | `global-rules.md` §7、rings 契约 | 人侧门 | 复用原生 Wait：`shape.confirm`（应然确认）、`verify.confirm`（验收走查）；确认依据由扩展输出提供 |
| A9 | 变异证明（门须咬得住注入缺陷、还原逐字节一致、报告含注入 diff） | `mutation_proof.py` + 各门右列登记 | 元门（对门的门） | 移植为 Keel 自身门禁的测试纪律：每个治理扩展出厂带变异钉（测试级，非运行期挂点） |
| A10 | impact 对账门（预测集 ⇔ 实际 diff，漏报/多报/基准漂移） | `impact_reconcile.py` | 机器门 | parent scope 扩展（收口前） |
| A11 | 退役三件套 / 回流原语 backfill | `global-rules.md` §11、`apply/reference.md` §5.2 | 流程门 | 后续 ADR（非需求入口，§7） |
| A12 | 出厂测试套件 / canonical 自洽（门总账计数对账、环引用自明） | `tests/`、`atlas_check` 对齐行 | 元门 | Keel 包自带测试套件 + 自检门（随 A4 编排调用） |

## 4. Keel 工作流阶段划分与各阶段治理校验

沿用 Native 四阶段（不另造阶段机），前置加"开户"环节（Run 创建前）：

| Keel 阶段 | Native 环节 | 治理校验（挂点） |
| ---| ---| ---|
| **0 开户/接入** | Run 创建前（keel entry skill） | 装配三环资产骨架与 stack-profile；`validate_stack_profile`；登记本项目门禁配置。失败不建 Run |
| **1 Shape 定稿** | `shape.prepare → shape.confirm` | 无机器挂点（缺口 G1）。迂回：① 应然资产（PRD/AC/E2E 意图）作为 Shape 输入由 entry skill 装配；② 治理规则以 `usage: guidance` Skill 绑定 Builder/Shape 指导（只注入约束，不代替检查）；③ 用户在 `shape.confirm` 确认；④ 应然资产的机器校验**后补**在 candidate/parent scope（见下），不合格经 `revise-requirements` 打回本阶段——保证"应然不合格 ⇒ 实现白做之前能拦下" |
| **2 Build 实现** | `build.builder` / `supervisor.child.*` | **child scope**：`validate_testids`（testid 应然⇔实然）、`validate_e2e_mocks`、`validate_ac_alignment`（WARN 档）。fail → child Builder 重做；**integration scope**：集成候选重跑上述 + 冲突面核对，fail → integration-repair |
| **3 Verify 验收** | `verify.checks → verify.verifier → verify.confirm` | **candidate/parent scope**：① `atlas_check` 全量编排（A3+A4+A12，含生成物最新）；② E2E 真跑（A5，workspaceRoot 内）；③ 实例⑤独立审查（A6：Skill 分审 + `validate_review_report` 形态门，Critical ⇒ fail）；comet 原生独立 Verifier 照跑（不替代）；用户在 `verify.confirm` 完成验收走查（A8） |
| **4 Archive 收口** | `archive.prepare/execute/finalize` | 无挂点（缺口 G2）。迂回：完成门（A7）与 impact 对账（A10）挂在 **parent/candidate scope**——它们在链上位于 `archive.*` 之前，全 pass 才到 `--dry-run` 预检与执行；收口留痕（审查报告、走查记录）经 `artifactRefs` 绑定入证据 |

### 4.1 扩展声明草案（映射用，非实现）

| 扩展 id | scopes | 校验内容 | verdict 策略 |
| ---| ---| ---| ---|
| `asset-alignment` | child, integration | A3 中 testids/e2e_mocks/ac_alignment | FAIL→fail；WARN→pass+摘要注明 |
| `governance-suite` | candidate, parent | A4 atlas_check 全量 + A12 自检 | FAIL→fail |
| `e2e-live` | candidate, parent | A5 E2E 真跑 | FAIL→fail；前置未声明按 atlas SKIP 语义→pass 并注明（不假装已验） |
| `independent-review` | candidate, parent | A6 审查报告形态 + Critical 闭集 | Critical/FAIL→fail；缺审查→fail（不豁免） |
| `closeout` | parent | A7 完成门 + A10 impact 对账 | FAIL→fail；应然资产漂移→revise-requirements |
| （全族） | — | 任一扩展发现 PRD/E2E 应然缺位或过期 | `revise-requirements` 回 Shape |

### 4.2 Python 校验器适配（Keel 自研，不改 comet/atlas）

每个治理扩展的 `RuntimeValidator` 内部 spawn 对应 `validate_*.py` / `atlas_check.py`，把退出码与结构化输出映射为 `{accepted, reason}`；扩展 Skill 为确定性脚本（仿候选审查样板的 `review.mjs` 形态），Outcome 产出 `verdict/bindingHash/artifactHashes/summary`。WARN 默认不阻断（忠于 atlas 语义），严格模式（WARN⇒fail）留作 keel 门禁配置项。

## 5. 缺口迂回方案汇总

| 缺口 | 迂回 | 残留风险 |
| ---| ---| ---|
| G1 Shape 无挂点 | guidance 注入 + candidate/parent 后补校验 + `revise-requirements` 打回 | 应然不合格的 Shape 可能先被用户确认、到 Verify 才返工；成本可控（返工发生在实现前确认轮次之外时只浪费一轮 Build） |
| G2 Archive 无挂点 | 收口门禁前置到 parent scope（链上就在 archive 前） | `archive.execute` 本身的文件写入无治理钩子；由 dry-run 预检 + 原生事务验证器兜底 |
| G3 无自定义 Wait | 复用 `shape.confirm` / `verify.confirm` / `revise-requirements` 用户决定 | 走查类多步人侧门只能合并表达，粒度粗于 atlas 原生多门 |

## 6. 需要的 comet SDK 能力清单

### 6.1 comet 已有（直接复用）

1. `createNativeWorkflowApplication` + 四 scope `extensions` 挂点与串行链（`native-application.ts`）。
2. verdict 三值路由：fail→Builder/集成修复；`revise-requirements`→受保护命令回 Shape（含 state version 防护与旧确认失效）。
3. `reviewSource` 精确绑定（Action/inputHash/outcomeId/候选/shape+formal hash/Child contract+分支+worktree+双 commit）与 `activation.workspaceRoot`。
4. `RuntimeValidator` fail-closed 校验、`rejectedOutcomes` 保留现场、Outcome/Schema/业务三层验证。
5. 应用包固定身份与全量内容摘要、Skill 适配审查（`adaptApplicationSkill`）、`usage: guidance` 指导绑定、宿主授权继承（`createApplicationSkillExecutor`）。
6. 原生人侧 Wait：`shape.confirm` / `supervisor.shape.confirm` / `verify.confirm`。
7. 证据与回执存储、archive `--dry-run` 只读预检、中断恢复与 Supervisor transfer、`prepareNativeCandidateReviewProject` 参考样板。

### 6.2 需自研（Keel 侧，不要求 comet 改动）

1. Python 校验器 TS 薄适配器（spawn + 输出→verdict 映射，含 WARN 策略）。
2. keel 应用包本体：application.json、工厂模块、entry skill、三环资产模板与契约副本。
3. 治理扩展族（§4.1 五个）与其 Skill/脚本。
4. Shape 输入装配（把应然资产绑定进 brief/formal 的引导流程）。
5. 变异证明纪律：每个治理扩展的出厂变异钉测试（移植 atlas 元门做法）。
6. WARN/严格模式等门禁配置面。

### 6.3 缺口（需 comet 演进才干净；短期按 §5 迂回）

1. **`shape` 扩展 scope**（`shape.prepare` 后、`shape.confirm` 前）——应然资产前置硬门的正确位置。
2. **`archive` 扩展 scope**（`archive.prepare` 前）——收口门禁的正式位置。
3. **扩展声明自定义 Wait 的能力**——人侧多步确认门（走查单确认/验收走查分离）的正式表达。
4. （可选）扩展 Outcome 第四 verdict：`warn`——机器可区分"通过但带警告"，省去 summary 文本约定。

## 7. 任务2 实证补记（骨架验证后）

以下结论来自 scratch 项目实测（开户 → atlas_check），修正/落定上文草案：

1. **§7 Q2 已决：沿用 atlas 路径约定**。资产落 `product/**`，所有校验器带 `--root` 指向用户项目，Python 零改动。keel 不 shipped 假 `prd.md`：greenfield 无 PRD 时 `validate_prd` FAIL（实测），PRD 在 Shape 阶段 authored；Shape 完成前 governance-suite 红属预期行为。
2. **装配模型实证**：`atlas_check.py` 的校验器解析在 `<root>/.atlas/validators/` 下——atlas 是经 `install.sh` **装进**被治理项目的，不是外部引用。开户必须跑 `install.sh`；keel 用 `--no-patch --no-wiring --force`（.trellis 挂载与 AGENTS.md 接线属 atlas 独立模式入口，由 comet 工作流取代；无 .trellis 项目需 `--force` 过守卫）。
3. **SKIP 三态策略**（atlas_check 文档头 §B110）：SKIP=「未走到这一步」，非通过非失败；`failed` 仅计 FAIL 行，exit 0 可带 SKIP。定案：governance-suite（每轮 candidate/parent）exit 0 → pass，但 SKIP 行**全量进 summary** 供 Native Verifier 与 `verify.confirm` 核对；未来 closeout 扩展（A12）须把 SKIP 视为阻断（收口语义 = 用例全 green）。
4. **stack-profile 模板必含 `product` 键**（`validate_stack_profile.py`「product 非空」门）；onboard 以项目目录名落真实值，不留占位符。
5. **骨架与 §4.1 草案的差异**：governance-suite 实装 scopes=candidate+parent（child/integration 待 Supervisor 多仓场景再议）；e2e-live / independent-review / closeout 未实现，骨架只含 governance-suite（check）+ builder-guidance（guidance）。

## 8. 未决问题（后续 ADR）

1. 非需求入口（开户 all/adopt 之外的治理补账、backfill、退役、事实刷新）在 Keel 的载体：独立 Standalone 应用 vs Native 修订通道。
2. 三环资产在用户项目的最终落位：沿用 atlas 路径约定（`product/` 等，Python 校验器零改动）还是 keel 自有目录（需验证校验器路径可配置性）。倾向前者，实现期验证后定。
3. 实例⑤审查与 comet 独立 Verifier 的职责切分细则（两者都查候选时的分工与去重）。
4. E2E 评审台（atlas 控制台/台账）是否随 Keel 下沉，或首版只保机器门。

## 9. 任务9 实证补记：independent-review 扩展落地（2026-10-23）

§5 扩展声明草案中的 `independent-review` 已实现并接入候选链位，自验全链
（onboard→…→archive/done）通过。实现期发现三条 comet 扩展协议硬约束，设计文档据此修订：

1. **`artifactRefs` 必须非空且每项是真实文件**（native-application.ts:197-201 校验，空数组
   直接拒「Native 扩展身份、范围或工件无效」；目录路径在执行时报「Native extension artifact
   must be a real file」）。动态工件（审查报告）不能用目录引用兜——keel 契约因此定为
   **固定单文件 `product/reviews/review.json` + `README.md`**，每个变更覆盖，历史走 git。
2. **Outcome `artifactHashes` 必须与运行时按 `artifactRefs` 现算的哈希精确相等**
   （native-application.ts:301-303，`hashRuntimeValue` 比对，多一个键即「扩展工件变化或缺少
   真实摘要」OUTCOME_REJECTED）。审查脚本只报 `review.json` 一个键；README 的在册约束
   仍由 atlas validate_review_report（双份留痕判据）强制执行，不进哈希表。
3. **同 scope 多扩展按声明顺序串链**：候选链位实测 `verify.checks → governance-suite
   （:6）→ independent-review（:7）→ verify.verifier（:8）`，扩展数组顺序即执行顺序。

审查报告落盘门语义沿用 atlas：报告不存在=未审（fail-closed），Critical/应审实审对账不过
⇒ fail verdict 回 Builder；WARN（Major 或 M<N）不置红但全行进 summary 供 Verifier 核对。
§8 未决问题 3（实例⑤与 Verifier 分工）维持现状：实例⑤管审查报告形态与对账（机器判），
Verifier 管验收语义裁决，两者不重叠。
