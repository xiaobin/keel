# vendor/atlas — Atlas 治理运行时载荷（内置副本）

来源：atlas 仓（feature-lifecycle/atlas）@ `d797052`（v0.2.0-beta.4，2026-10-23）。
许可证：Apache-2.0（见 `vendor/atlas/LICENSE`，随包分发）。

内容 = atlas `install.sh --no-patch --no-wiring` 装配进被治理项目 `.atlas/` 的载荷集：
`shared/ rings/ apply/ scripts/ templates/ adapters/ validators/ patches/ tests/ _support/ extensions/ skills/ + LICENSE`。
（`skills/` 不下发进项目 `.atlas/`，但出厂测试按 `.atlas/VERSION` 的源包路径核对 skill 契约源，故随包携带。）
已剔除 `__pycache__/`、`*.pyc`、`node_modules/`。

keel onboard 把本目录复制为项目的 `.atlas/` 并用 `scripts/pkg_digest.py` 的
`stamp_file` 落 `.atlas/VERSION` 版本戳（与 install.sh 同一机制）。

升级方式：人工从 atlas 仓回灌本目录后重新提交，并在 docs/decisions/0010 追加记录。
