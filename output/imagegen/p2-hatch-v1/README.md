# 舱门过于拥挤：美术来源

七件画稿均由内置 `image_gen` 生成，没有使用 CLI / API。`prompts.json` 保存每件实际提示词及仓库相对参考路径。五张漫画最终原图直接存入 `apps/web/src/assets/stories/p2-hatch-v1/`，标题与批准台词由播放器渲染，不烘焙在图内。

`warehouse_pickup-source.png` 与 `warehouse_intake-source.png` 为终端原图。`process-sprites.mjs` 将原图按最近邻采样为 64 逻辑格、二值透明并限制调色板至 16 色，再按整数倍放大为 128×128 RGBA，写入正式建筑目录和资源清单；`sprite-validation.json` 记录最终尺寸、颜色数、字节和 SHA-256。此脚本使用 sharp，仅供维护资源，可通过 Node 模块搜索路径提供该包，不为游戏添加依赖。

```bash
node output/imagegen/p2-hatch-v1/process-sprites.mjs
node scripts/check-building-art.mjs
```

漫画角色沿用奶白方头、青色屏幕眼睛、粉球天线、黄机身、青绿围巾、金属夹爪与红工作靴。终端沿用既有蓝灰金属、黑边、青 / 粉点缀的简洁像素外观；机壳不旋转，方向在游戏代码层表示。
