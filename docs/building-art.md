# 建筑与物流像素贴图

地下传送带新增一个 SVG 物流定义，当前目录共 87 个建筑 ID（75 张正式机壳、12 个代码外观）。`UndergroundVisual.tsx` 复用传送带金属 / 深色 / 霓虹语言，以护罩位置和粉 / 青箭头区分两端；`BuildingSprite`、`DefinitionIcon` 与地图 / 预览均接入，不加载端口建筑 PNG。配方中的物品仍用独立像素贴图，详见 [地下传送带](underground-belts.md)。

2026-10-26 增加取货终端 `warehouse_pickup` 和存入终端 `warehouse_intake` 两张正式机壳，这两张机壳继续保留，当前合计 **87 个 ID、75 张 PNG、12 个代码外观**。内置 ImageGen 以原 WH / 搬运站 / 控制台为参考生成，技术导出为 128×128 RGBA、64 逻辑格、二值透明、各 15 个不透明颜色；取货双显示窗 / 出料托盘，存入粉色货箱标志 / 四边接口，无烘焙方向文字。原图、提示词、导出脚本及哈希报告位于 `output/imagegen/p2-hatch-v1/`，其中 `process-sprites.mjs` 仅用于重新导出，需要可解析的 sharp 包，游戏运行 / 构建不依赖该包。早期测试机壳与旧带的目录项已移除，历史制作输出不参与运行资源加载。

用户确认中等细节样稿后，已完成全量生成、处理与客户端接入。当前目录 **87 个建筑 / 物流 ID 全覆盖**：75 张透明机壳 PNG，12 个定义使用代码外观。早期测试设备的 5 张机壳 PNG 和旧传送带映射已移除。

## 美术与显示

- 正式图片为 **128×128 RGBA PNG**，64 格逻辑像素以最近邻放大；保留方形正视机壳、主要金属框架、主轴 / 压头 / 机柜等功能结构，以及粉 / 青强调。透明背景、二值 alpha，每张至多 20 个不透明颜色，并保留近黑轮廓。
- 图像不烘焙阶段色、方向箭头、状态点或脚下光影，不为工作 / 停止生成重复图片。8 张获批准的 v3 图片原样复用，另外 70 张由内置 ImageGen 分五批生成，按稳定建筑 ID 裁切、限色和导出；78 张图片哈希各不相同，合计约 172 KiB。
- GUI 共用 DefinitionIcon → BuildingSprite，图片在原容器内最大 48px 显示，底部以静态椭圆光影标识阶段。所有原有图鉴、检视、配方关联 / 来源弹窗等建筑图标入口共用此映射；可拼接物流的 GUI 缩略图也由代码生成。
- 地图与放置 / 移动预览共用 BuildingVisual，维持原生 30px 单元。机壳正视图保持直立，独立代码箭头随真实 rotation 旋转。机壳采用方形阶段边框，连接物流沿自身轮廓描边；选中角标、合法 / 非法放置提示、机器状态点和原进度条保持独立。
- 地图 120% 起另由 MachineNameLayer 在机器下半部绘制三字内中文简称，12px 白字与地面色描边；此为独立屏幕文字层，不写入 PNG，物流与非机器不显示。GUI 仍保留原外部名称，完整简称与边界见 [machine-map-names.md](machine-map-names.md)。
- 阶段读取**建筑自身 tier**，不借用安装道具 tier：P1 杏黄 `#ffc879`、P2 灰绿 `#a5d4b2`、P3 薄荷绿 `#74edce`、P4 亮青 `#46eff2`、P5 淡紫 `#b69aff`、P6 粉色 `#ff72cf`。无 tier 的 WH / 旧档设施沿用目录 color，不伪造阶段；shaft 等建筑与安装物品的阶段可能不同。
- 储罐、阀、泵及有流体容量的机器采用图片外壳叠代码管口 / 液位。管道非零液量只改变内腔亮度，机壳液位条只读确认的 count / capacity；液压动力线与普通物料管道使用不同的代码配色与几何。

## 可拼接物流

| 外观类型   | 目录 ID                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------- |
| 传送带     | conveyor、hand_belt、mechanical_belt、hydraulic_belt、electric_belt、precision_belt、flexible_belt |
| 物料管道   | pipe、return_pipe                                                                                  |
| 传动轴     | shaft                                                                                              |
| 电缆       | cable                                                                                              |
| 液压动力线 | hydraulic_line                                                                                     |

routeGeometry.ts 使用 30×30 整数像素，按 N / E / S / W = 1 / 2 / 4 / 8 生成端口和开放边；共享截面生成孤立、端头、直线、拐角、T 与十字。开放端延伸到格边，相连格边截面一致，没有横挡；封闭端保留机壳且不泄漏到格边。像素按颜色合并为 SVG 路径，并缓存类型 / 端口 / 开放边组合，颜色、液量和旋转不重新生成几何。SVG 使用 crispEdges，无连接状态 PNG。

buildingConnections.ts 读取布局：传送带 / 管道复用从原 conveyorPaths / fluidPipePath 提取的方向邻接选择，移动预览排除原实例；保留混合带级别、无入口时后方管口及出口方向。轴网 / 电缆 / 液压线只接邻格同类型导线，不通过机器桥接不同网络。端口外观不读取启停、过滤或派生供能来推断真实转移，仍由原运行层判定运输、守恒、液体和能量。

ConveyorItemsLayer、payload 身份 / 成功收据、轨迹、机器进度与共享 RAF 未改变；静态机壳 / 线路不新增 RAF、持续装饰动画或逐帧 Canvas。连接画通不代表运输成功，实际物流需用户在游戏中验收。

## 文件与批量来源

| 路径                                                            | 用途                                              |
| --------------------------------------------------------------- | ------------------------------------------------- |
| `apps/web/src/assets/buildings/v1/*.png`                        | 75 张正式 128px 图片                              |
| `apps/web/src/assets/buildings/v1/manifest.json`                | 全部 87 个稳定 ID 的 renderer / tier / color      |
| `apps/web/src/game/buildingArtwork.ts`                          | 图片 URL 与阶段色；PNG 独立缓存、不内联主包       |
| `apps/web/src/game/BuildingSprite.tsx` / `.css`                 | GUI 脚下光影、地图机壳阶段边框与液位              |
| `apps/web/src/game/BuildingVisual.tsx` / `RouteVisual.tsx`      | 地图 / 预览共用显示、代码方向与连接图层           |
| `apps/web/src/game/buildingConnections.ts` / `routeGeometry.ts` | 原邻接选择与缓存整数几何                          |
| `scripts/check-building-art.mjs`                                | 目录 / 资源与实际运行时几何静态检查，纳入 lint    |
| `output/imagegen/building-logistics-v4/`                        | 批量原图、提示词、处理脚本、来源 / 哈希报告与预览 |

v4 输出目录中：plan.json 固化分类和每件造型；batch-1-source.png 至 batch-5-source.png 为内置 ImageGen 的五张批量原图；manifest.json 记录每张图的来源和裁切坐标；validation.json 记录尺寸、色数、alpha 与 SHA-256；route-validation.json 记录实际 routeGeometry.ts 的几何检查结果。原批准样稿保留于 v3，初版 / 极简比较稿保留于 v1 / v2。

实际绘图提示词：[批次 1](../output/imagegen/building-logistics-v4/batch-1-prompt.txt)、[批次 2](../output/imagegen/building-logistics-v4/batch-2-prompt.txt)、[批次 3](../output/imagegen/building-logistics-v4/batch-3-prompt.txt)、[批次 4](../output/imagegen/building-logistics-v4/batch-4-prompt.txt)、[批次 5](../output/imagegen/building-logistics-v4/batch-5-prompt.txt)；[批准样稿提示词](../output/imagegen/building-logistics-v3/prompt.txt)。

查看 [正式资源对照](../output/imagegen/building-logistics-v4/showcase.png)、[全部 78 张机壳](../output/imagegen/building-logistics-v4/all-facades.png)，或五张带名称的 batch-N-preview.png。showcase 是生产 PNG 与实际运行时整数像素的离线合成，不是浏览器截图，不能替代游戏验收。

## 复现与验证

运行游戏只需项目原有 Node / Go 环境。Python / Pillow 与中文字体仅用于重新处理原稿和生成预览，不是 npm run dev 的依赖。处理脚本会重建正式资源；更新提示或目录时先维护 prepare.py 和 plan.json，避免手动错配编号。

在仓库根目录执行：

```bash
# 从已保存批量原图重新处理 PNG，并生成图片校验 / 来源报告
python3 output/imagegen/building-logistics-v4/process.py
# 检查当前目录 / PNG / 实际运行时连接几何，不启动游戏
node scripts/check-building-art.mjs
# 可选：重建静态几何报告和最终预览
node scripts/check-building-art.mjs --report output/imagegen/building-logistics-v4/route-validation.json
node output/imagegen/building-logistics-v4/preview-runtime.mjs
python3 output/imagegen/building-logistics-v4/preview.py
```

已执行：78 张图像的尺寸 / 二值 alpha / 黑边 / 限色 / 整数放大 / 唯一哈希检查，五批命名图及最终全量预览查看；90 ID 覆盖检查；5 类几何共 **405 个端口 / 开放边组合**的边缘像素匹配、封闭边透明与缓存复用静态检查；完整 npm run lint、npm run build（Web 与 Go 编译）。几何检查直接编译读取生产 routeGeometry.ts，而非另写一份算法替代验证。

已补 BuildingVisual、buildingConnections 测试并适配 ItemSprite 的建筑分支；**未执行应用自动 / 冒烟 / 浏览器测试，未启动服务**。由用户运行测试及 [游戏验收步骤](acceptance.md)。不清档、不迁移，npm run dev 后刷新即可加载。
