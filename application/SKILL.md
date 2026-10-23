---
name: keel-workflow
description: 启动或恢复 Keel 治理工作流（Comet Native 运行时 × Atlas 门禁），按固定 Application 执行开户、Shape、Build、Verify、Archive。
---

# Keel 工作流入口

## 开户（每个项目一次）

在目标项目里执行（keel 仓库根）：

```
node scripts/onboard.mjs --project-root <目标项目> --name <change 名>
```

开户装配三环资产骨架（`product/stack-profile.yaml`）、写 `docs/comet/changes/<name>/brief.md`
骨架与 `start-request.json`，并跑开户门 `validate_stack_profile`。门不过不开户。
前提：目标项目已 `git init` 且跑过 `comet init`（存在 `.comet/config.yaml`）。

## 启动 / 恢复

```
comet runtime dispatch --application-file <keel>/application/application.json \
  --project-root <目标项目> --request <目标项目>/docs/comet/changes/<name>/start-request.json
```

之后按 `comet native next` 推进；中断恢复先 `inspect`，保留原 Action 领取信息，不重发未知执行。

## 阶段与门禁（docs/decisions/0002）

- Shape：应然资产（PRD/AC/E2E 意图）随 brief/Spec 流过，`shape.confirm` 用户确认。
- Build：Builder 必读当前 skillWork 中的固定指导（builder-guidance）。
- Verify：`verify.checks` 之后跑 governance-suite 扩展（atlas_check 编排），之后 Native 独立
  Verifier 与 `verify.confirm` 用户验收照跑；扩展不替代它们。
- 扩展 fail 回 Builder 修复；revise-requirements 经受保护命令回 Shape。禁止发布、归档或自行批准。
