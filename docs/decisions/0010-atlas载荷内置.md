# 0010 — Atlas 治理载荷内置（vendoring）

- 日期：2026-10-24
- 状态：已决定
- 前置：0001（治理层来源）、0007（指纹卫生）、用户指令「本项目是全新项目，不能依赖 atlas」

## 决定

keel 不再依赖 sibling `../atlas` 检出。atlas 运行时载荷按 `install.sh --no-patch --no-wiring`
的装配集内置到 `vendor/atlas/`（当前快照：atlas @ d762ea4，v0.2.0-beta.12，Apache-2.0 许可证随包；首版 d797052 / v0.2.0-beta.4）。
`keel onboard` 改为：复制 `vendor/atlas` → 项目 `.atlas/`（已装配则跳过，不覆盖本地改动），
并用载荷自带 `scripts/pkg_digest.py` 的 `stamp_file` 落 `.atlas/VERSION` 版本戳——与
install.sh 同一机制，atlas_check「装配版本」行照常对账（源包路径指向 keel 仓内 vendor 目录）。

## 边界

- 不下发：skill 瘦桩安装、.trellis 挂载、AGENTS.md 接线（keel 用 comet 工作流取代 atlas 独立模式
  入口，与 0002 §7.2 一致）。注意 `skills/` 源目录必须随 vendor 包携带——出厂测试
  （test_backfill_contract/test_install_selfcheck）按 `.atlas/VERSION` 的源包路径核对 skill 契约，
  缺失即 fail-closed（首版 vendor 漏带，closeout 全量红，已补回）。
- 治理门运行时入口不变：`<项目>/.atlas/scripts/atlas_check.py`、`validators/`——应用扩展零改动。
- `KEEL_ATLAS_ROOT` / `--atlas-root` 参数废止。
- atlas 上游演进不回溯：vendor 是快照，升级靠人工回灌并在本文追加记录。

## 验证

selftest 全链绿（onboard 复制载荷 → burn-in → 四扩展真跑 → archive/done）。

## 升级记录

- 2026-10-26：回灌上游 atlas v0.2.0-beta.12（d762ea4）。按 pkg_digest 装配集白名单整包刷新十一目录 + LICENSE + skills/ 源目录（新增 _support/layout.py、_support/manual_block.py、scripts/atlas_verify.py、scripts/write_claim.py、scripts/closeout_derive.py、validators/validate_walkthrough.py 等）；随包移除了误入库的 scripts/__pycache__/*.pyc。keel 侧零代码改动：onboard 落戳机制与 governance/closeout 的 atlas_check --fast/--json 调用面不变；无 atlas.config.yaml 时资产根默认 product/，keel 装配语义不受布局新特性影响。已由旧快照装配的项目会按装配版本门 WARN（漂移信号），onboard 不覆盖既有 .atlas/，须人工对账后重装。验证：vendor 与上游逐字节一致（diff -rq 空）、pkg_digest 可算、npm run selftest 全绿。
