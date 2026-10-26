# 物品像素贴图

P2 地下传送带另增 `d0001.png`，当前共 356 份物品资源。由内置 image_gen 参考机械 / 电动传送带图标生成，原图、实际提示与 32 格限色 / 黑边导出流程保存在 `output/imagegen/underground-v1/`。沿用 128px RGBA、二值 alpha 与最多 16 个不透明颜色；原始 352 项及旧档图标不变。物流建筑本身用 SVG，见 [地下传送带](underground-belts.md)。

现行 352 种物品与 3 种旧档兼容物品已接入正式资源，用户已确认本轮物品贴图验收完成。美术延续经用户确认的 V2 像素方向；V1 / V2 保留为过程稿，运行时仅加载 v3 资源。应用自动测试的执行状态仍以 progress.md 的实际记录为准，不将用户验收等同于自动测试通过。

## 美术与尺寸

- 正式 PNG 为 **128×128 RGBA**，保留约 32×32 的 MD / SFC 像素结构，以最近邻整数放大保存。128px 用于高 DPI 与不同 GUI 尺寸缩放，不增加高分辨率插画的细密纹理。
- 物品依靠剪影、大色块、简洁明暗区分；粉 / 青强调配合钢、铜、玻璃、布袋等材料本色。同类零件以形状、结构或醒目标志区别，名称与代号由界面提供，不写入图像。
- 主体至多 26 个逻辑像素，外加 1 个逻辑像素（128px 文件中为 4px）的近黑色轮廓，保留至少 2 个逻辑像素的透明边距。主体至多 15 色，黑边加入后不透明颜色至多 16 种；最终 alpha 仅 0 / 255。
- **阶段色不作为物品外描边，也不烘焙到 PNG。** ItemSprite 在图片下方用静态 CSS 椭圆渐变显示脚下光影：P1 `#ffc879`、P2 `#a5d4b2`、P3 `#74edce`、P4 `#46eff2`、P5 `#b69aff`、P6 `#ff72cf`。
- 脚下光影依据物品 tier。P2 提前开放的流体管道 i0170 也使用 P2 灰绿，保留目录原 color 数据；未获得物品继续按原规则灰阶显示。只改变客户端显示，不改变物品 ID、定义、配方或存档。

## 资源与接入

| 路径 / 组件                                  | 职责                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `apps/web/src/assets/items/v3/*.png`         | 按稳定物品 ID 命名的 355 份正式 PNG                                               |
| `apps/web/src/assets/items/v3/manifest.json` | 资源版本、尺寸及每个 ID 的实际阶段                                                |
| `apps/web/src/game/itemSprites.ts`           | 一次解析资源 URL 和阶段色；资源索引单独打包                                       |
| `apps/web/src/game/ItemSprite.tsx` / `.css`  | 透明像素图片、黑边素材与静态阶段脚下光影，使用 image-rendering:pixelated          |
| `apps/web/src/game/DefinitionIcon.tsx`       | 所有既有 GUI 物品图标共用入口；建筑 / 物流另走 BuildingSprite，见 building-art.md |
| `apps/web/src/game/ConveyorItemsLayer.tsx`   | 带上物品和成功输入 / 输出收据共用同份贴图                                         |
| `scripts/check-item-sprites.mjs`             | npm lint 内检查目录 / 清单全覆盖、阶段、128px RGBA PNG 尺寸与格式                 |

图鉴建造阵列“物品”Tab、检视、配方、工作室物料、仓库、任务奖励、机械手订单、来源查询均通过 DefinitionIcon 显示新贴图。GUI 在原图标容器内缩放，最大 48px；不额外挤入图像内代号，外部名称 / 代号、原工作台布局和 12px 文字下限保持。

ConveyorItemsLayer 使用 18px 视觉区域，仅更换 payload 节点内部图形，保持原位置计算、key、轨迹、吸收、最近 3 tick 收据去重和暂停规则。图片与脚下光影不参与物流结算，不创建 RAF、逐帧 Canvas 或逐帧图像解码；节点仍由原共享时钟更新 transform / opacity。未覆盖的未来定义保留 SVG 回退，当前目录已全覆盖。

PNG 通过 Vite `?no-inline` 作为独立带内容哈希的文件发布，GUI 和物流复用相同 URL / 浏览器缓存；索引位于 item-sprites 模块，不将所有图片转为主包 base64。新增 / 修改目录物品后需同步美术与清单，否则 lint 会提示覆盖缺失。

## 批量生成与复现

批次位于 `output/imagegen/item-icons-v3/`，由内置 ImageGen 批量生成，以 V2 原图作风格参考。每件物品都有独立形状提示；不是逐个调用绘图或用同一个图标换色。原图仍是生成工具的大画布，不能把提示词当作严格格位 / 尺寸保证。

实际提示词：[P1](../output/imagegen/item-icons-v3/p1-prompt.txt)、[P2](../output/imagegen/item-icons-v3/p2-prompt.txt)、[P3](../output/imagegen/item-icons-v3/p3-prompt.txt)、[P4](../output/imagegen/item-icons-v3/p4-prompt.txt)、[P5](../output/imagegen/item-icons-v3/p5-prompt.txt)、[P6](../output/imagegen/item-icons-v3/p6-prompt.txt)。

| 批次 | 现行物品数 | 生成安排                          |
| ---- | ---------- | --------------------------------- |
| P1   | 63         | 8×8，最后一格补旧档铁矿石         |
| P2   | 62         | 8×8，空格透明，含提前开放的 i0170 |
| P3   | 57         | 8×8，空格透明                     |
| P4   | 57         | 8×8，空格透明                     |
| P5   | 59         | 8×8，空格透明                     |
| P6   | 54         | 8×8，空格透明                     |

保留 16 件已认可 V2 造型作为对应物品的正式来源，再按相同流程补黑边 / 导出；旧档 iron_plate 复用基础铁板 i0045、gear 复用简易齿轮 i0049，另有独立绘制的 iron_ore。352 种现行物品没有相互重复的 PNG；仅这两组旧档同义物品共享造型。

| 批次文件           | 内容                                                    |
| ------------------ | ------------------------------------------------------- |
| `prepare.py`       | 逐物品形状设计，生成稳定顺序与提示词，不调用绘图 API    |
| `plan.json`        | 各批次格位、物品名称 / ID / 阶段与形状提示              |
| `p1-prompt.txt` 等 | 六次绘图实际使用的完整提示词                            |
| `p1-source.png` 等 | 六张 ImageGen 原图                                      |
| `process.py`       | 完整轮廓归组、行列校准、最近邻采样、限色、黑边与导出    |
| `manifest.json`    | 来源图、格位、V2 复用与旧档别名                         |
| `validation.json`  | 355 件实际尺寸、alpha、色数、边距、黑边、哈希与重复检查 |
| `P1-items.png` 等  | 六张带物品名称的全量核对图，光影仅为预览合成            |
| `showcase.png`     | 16 件代表图标与脚下光影预览                             |

如需从保存的原图重新导出，在仓库根目录运行以下命令（需 Python 和 Pillow，不是运行游戏的依赖）：

```bash
python3 output/imagegen/item-icons-v3/process.py
node scripts/check-item-sprites.mjs
```

预览需要中文字体，脚本未找到系统字体时可传 `--font path/to/font.ttf`。重建批次设计与提示词使用 `python3 output/imagegen/item-icons-v3/prepare.py`；提示词修改本身不会重新绘图，必须用新原图再导出。项目不记录本机工具绝对路径或依赖个人代理。

## 实际验证状态

- 已执行全部批次处理与图像静态校验：355 个目录 ID 全覆盖、128×128 RGBA、二值 alpha、黑边存在、至少 2 个逻辑像素透明边距、至多 16 个不透明颜色。
- 已逐张查看六张命名核对图及代表预览，校准生成图的不等边距，避免裁切串行或切断细长物品。重复检查只允许两组旧档同义物品。
- 已补 GUI 物品 / 建筑分支、阶段色（含 P2 管道例外）、未来定义回退及传送带连续节点复用的测试代码；**未执行应用自动 / 冒烟 / 浏览器测试**。
- lint、编译与最终差异检查的实际状态见 [progress.md](progress.md)。浏览器中 32～48px 清晰度、灰阶 / 阶段光影、缩放、堵塞恢复、长局性能由用户按 [acceptance.md](acceptance.md) 验收。
