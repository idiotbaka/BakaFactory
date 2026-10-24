# 像素字体与工厂资源预热

## 字体

页面、登录 / 注册、玩家资料、工厂 GUI 和地图文字统一使用项目内的 **Fusion Pixel Font 12px proportional zh_hans Regular**，固定上游发布版本 2026.10.16。字体原文件 680388 字节，未经裁字或格式转换；CSS 字体族别名为 Fusion Pixel Game，--font-ui 与原 --mono 共用它。比例模式不保证数字 / 拉丁字符等宽，布局仍由原网格 / 容器决定。

来源为 [TakWolf/fusion-pixel-font](https://github.com/TakWolf/fusion-pixel-font)，具体发布、原始包 / 字体文件名、SHA-256 与使用说明保存在 `apps/web/public/fonts/fusion-pixel/README.md` 和 manifest.json。字体采用 OFL-1.1，原包的 OFL.txt、Ark Pixel / Cubic 11 / Galmuri 三份上游许可证一并保留并随构建分发。本项目未使用该仓库构建程序，不将其 MIT 许可证误作字体许可证。

style.css 声明单一 400 / normal 字体；所有语义标签、原生表单和伪元素重置为 Regular，不请求合成字重 / 斜体。当前全站均用 Regular，满足低于 18px 不粗体、任何字号不斜体的要求；标题通过字号、颜色和间距保持层次。最小字号继续为 12px，地图缩放的坐标字号补偿保持。scripts/check-ui-typography.mjs 同时检查最小字号、粗体声明须在同规则明确至少 18px、禁止斜体 / oblique，约束后续新增样式。

HTML 头部预加载同源版本化 WOFF2；字体由本项目提供，不访问运行时字体 CDN。登录前 CSS 也使用同一字体；字体下载期间 font-display:swap 保持界面可操作。游戏入口会等待真实 FontFace 加载完成，不能把回退字体当成成功。字库未覆盖的字符、系统原生弹出控件仍可能由浏览器回退；不承诺单一字体覆盖全部 Unicode。12px 为该字体原生像素尺寸，其他字号由浏览器缩放，实际高 DPI 清晰度由用户验收。

## 进入工厂流程

1. 原账号流程确认玩家后挂载 useLocalGame；未确认登录时仍保留原尺寸外框，不改变游客 / 登录 / 注册流程。
2. gameAssets.ts 从正式 itemSprites / buildingArtwork 的同一 URL 索引收集全部物品、建筑 PNG（包括旧档资源），加入字体与 favicon。按最终 URL 去重，避免构建时同内容图片合并后重复加载。代码生成的物流 SVG、图标路径和品牌字标没有额外图片文件，无需网络预热。
3. AssetPreloader 最多并发 8 项，每项最长 30 秒。图标需成功读取且完成 Image.decode（不支持该 API 时等待 onload）；字体复用已加载的实际 FontFace，或显式 FontFace.load 成功后注册进 document.fonts，才计入成功。失败字体的重试创建新实例，不复用已拒绝的加载 Promise。每个成功资源计 1 项，不按时间递增或伪造下载字节进度。
4. FactoryLoading 保留与工作台相同的 16:9 外框，显示原生 progress 进度条、完成百分比和字体 / 图标完成数。总进度除静态资源外含最后 1 项真实存档 / 在线初始化；静态资源完成后显示“正在读取存档并校验登录”，不提前显示 100%。
5. **只有资源全部就绪，才创建 / 启动 GameRuntime**，再按原顺序获取账号存档锁、读 IndexedDB、在线心跳 / 云备份校验和初始化 Worker。运行层确认 ready 后展示工厂、冲突选择或新厂命名 / 开场剧情。资源预热期间不会开始游戏 tick，也不补算这段等待时间。
6. 资源失败保持加载页和已有进度，提供“重新加载资源”；已完成的图片 / 字体引用保留，只重试未成功项。存档 / 在线初始化失败则显示原错误和“重新读取工厂”，复用已完成资源；不清理存档或绕过在线许可。

资源队列在当前页面内共享，StrictMode、重试或更换账号不重复下载已完成的同源文件；缓存只含静态公开素材，不含账号 / 存档。玩家离开或退出时未完成的静态队列可以继续，但旧组件的迟到完成不会创建运行层；已创建运行层沿用 close 串行关闭。刷新后重新验证资源，浏览器可用 HTTP 缓存加速，不以 localStorage 标记“已加载”跳过实际解码。

保留成功 Image / FontFace 引用以减少首次显示等待；浏览器在内存压力下仍可能回收内部解码 / GPU 缓存。预热不创建新 RAF、游戏状态、API 或数据库迁移，也不改变物品动画 / 生产规则。剧情大图仍由原剧情播放器管理，不作为图标预热额外下载全部章节。

## 检查与验收

`npm run lint` 包含 scripts/check-game-font.mjs：检查 WOFF2 文件头、尺寸 / SHA-256、四份原许可证哈希，以及 HTML 预加载、CSS 与入口队列指向同一字体版本。完整 lint 与前后端 build 已执行通过；构建产物中 431 个去重 PNG URL 均有对应文件，字体及全部许可证与清单哈希一致。未启动服务，未执行应用自动 / 冒烟 / 浏览器测试。

已补队列并发 / 去重 / 重试、图像解码 / 超时、字体注册失败、显示进度和工厂运行层延后启动 / 卸载取消测试。用户可运行：

```bash
npm run test --workspace @bakafactory/web -- src/game/assetPreloader.test.ts src/game/gameAssets.test.ts src/game/FactoryLoading.test.tsx src/game/local/useLocalGame.test.tsx src/game/FactoryWorkspace.test.tsx src/game/RobotInteraction.test.tsx
```

游戏中冷缓存 / 慢网、资源失败后重试、退出 / 换账号、全站字体和固定布局由用户按 [acceptance.md](acceptance.md) 验收。启动仍为 `npm run dev`，无需迁移或清档。
