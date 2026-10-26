# 地下传送带物品图标

- 内置 `image_gen` 生成；参考已有机械 / 电动传送带物品贴图，只借用像素风格。
- `source.png` 为生成原图，`prompt.txt` 为实际使用的完整提示词。
- `export.mjs` 做透明边界裁切、26 格主体 / 32 格画布、限色、1 格黑边和最近邻放大，正式输出为 `apps/web/src/assets/items/v3/d0001.png`。
- `export-report.json` 记录实际导出规格。脚本需 Node 能解析 sharp（不是游戏依赖），可在配置好模块路径后运行 `node output/imagegen/underground-v1/export.mjs`。
- 地图 / 物流图鉴使用 `UndergroundVisual.tsx` 的整数 SVG，不使用这张 PNG。
