# 0014 keel-h init：项目接入（comet 运行时检测 + 应然资产挂接）

- 状态：已决定（2026-10-26）
- 关联：0006 §命令面（新增 init 动词）；0008（非需求入口 / adopt 类项目）；0010（载荷内置）；0013（载荷升级）；上游 atlas RFC-20261026-01（`_support/layout.py` 项目级资产根）

## 背景

onboard 曾一肩挑「项目接入 + 首个 change 开户」，两类问题落入同一动词的盲区：

1. **adopt 类项目已有应然资产**：如 aiky 的 `product/prd/`（7 份 PRD）、`product/e2e/`（用例+脚本）、完整 stack-profile。onboard 只对 stack-profile 做了不覆盖保护；资产在非标准根时（`docs/prd/` 等）没有挂接通道，只能重复生成或人工搬移。
2. **comet 运行时缺失的报错晚而模糊**：comet 是 keel-h 的运行时引擎（npm 依赖 `@rpamis/comet`），源码开发或依赖损坏时缺失，错误直到首次 dispatch 才暴露。

新 atlas 载荷（0010 当前快照 d762ea4）内置官方挂接机制：`_support/layout.py` 的
`atlas.config.yaml`（`layout.assets_root`，缺省 `product/`）与 stack-profile e2e 段三路径
（`cases_dir`/`index`/`scripts_dir`）。本决策直接消费这两个机制，不另造挂接格式。

## 决定

**新增 `keel-h init [--project-root <p>] [--yes]`：项目接入动词，不创建 change。**
**`keel-h onboard <change>` = init（幂等）+ 首个 change 开户，对外行为不变。**

D1 **comet 运行时检测与安装确认**。init 按与 `bin/keel.mjs cometBin()` 相同的序解析 comet
（`COMET_BIN` → 包内依赖 → 平级源码检出）。缺失时：TTY 交互询问 / `--yes` 自动确认 /
非 TTY 直接拒绝并给手动修复指引；确认后在 keel-h 包根 `npm install`（落回包内依赖位），
装后复检。`COMET_BIN` 设了但文件不存在 = 响亮报错，不回落。

D2 **python3 硬前置、pytest 预警**。init 自身依赖 python3（载荷戳记 / 校验器 / burn-in）
⇒ 缺失即拒绝。pytest 仅收口（closeout）出厂测试门需要 ⇒ init 只 WARN 并给补齐命令
（`python3 -m pip install pytest`），不代为安装——pip 装包改的是用户运行机环境，
与 npm 装自家依赖不同级。

D3 **应然资产探测五态**（挂接只认三环资产：PRD / E2E / stack-profile）：

| 态 | 条件 | 动作 |
| --- | --- | --- |
| `config` | 已有 `atlas.config.yaml` | 按其声明的资产根探测 |
| `standard` | `product/` 下已有资产 | 原位复用，只登记 |
| `alt-root` | 单一异根（`docs\|specs\|requirements\|governance` 中唯一同时含 `prd/*.md` 与 `e2e/` 者） | 写 `atlas.config.yaml` 挂接 |
| `scattered` | 多处异根 | 列候选清单与两种挂接方式，**不猜**，人工定夺 |
| `greenfield` | 无任何资产 | 默认布局 |

D4 **永不搬移、永不覆盖已有资产**。挂接只写 `atlas.config.yaml` 指针文件；
stack-profile 已存在即复用（建议人工把 `origin` 改为 `adopt`，init 不自动改）；
模板仅在 stack-profile 缺失时落到生效资产根。

D5 **门禁口径不变**：burn-in（`atlas_check --fast`）不门禁；`validate_stack_profile` 硬门
（经 layout 解析到生效资产根）。init 任何硬门失败 = 接入失败。

## 边界

- 项目自有开发规范（AGENTS.md、`docs/framework/`、`skills/` 等）不属 atlas 三环治理面，
  init 不接入、不评价。
- adopt 类项目的结构环事实刷新仍受 0008 G2 阻挡（archive 阶段无扩展 scope），本决策不解决；
  adopt 项目接入后首次事实刷新前须先落 G2 方案。
- `--yes` 只授权 comet 安装确认，不豁免任何硬门。

## 实证

- `npm run selftest:init`（scripts/selftest-init.mjs）全绿：A1-A9（comet 检测 / 安装确认，
  替身注入）+ B1-B5（greenfield / 标准位复用 / 异根挂接 / 散落拒绝 / 幂等）
  + B6/B7（python3 缺失拒绝 / pytest 缺失仅 WARN）。
- 全链 `npm run selftest` 回归通过（onboard 内部改走 init 后行为不变），终态 `archive/done`。
- 真实项目 `keel-demo` 执行 `keel-h init`：识别 `product/` 标准位 PRD 并原位复用；
  stack-profile 与 PRD 哈希不变、change 集合不变、Git 工作区无漂移。
