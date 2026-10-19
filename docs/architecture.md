# 当前架构

本文件描述当前已实现的结构，取代旧 README.md 的阶段路线。开发入口见 [index.md](index.md)，游戏规则见 [simulation.md](simulation.md)。

## 组件和调用链

- apps/web：React / TypeScript / Vite；DOM/CSS 网格、SVG 建筑、视图变换、编辑器与生产面板。
- apps/server/internal/httpapi：Cookie 认证、Origin、严格输入与 owner 隔离；返回已提交工厂快照。
- application：账号与建筑用例；RunSimulation 使用 1000ms 单次计时器驱动所有工厂，每次处理结束后再等待下一秒，避免卡顿后排队追刻。
- domain：工厂 / 定义、库存、整数 tick 模拟与物流规划；不读时钟、不访问数据库。
- repository：SQLite 事务、工厂读写、模拟状态与玩家仓库原子保存。
- database：纯 Go SQLite，单连接、外键、WAL、busy_timeout、嵌入式迁移与 checksum。

`HTTP → application → repository → SQLite → 已提交快照`。

`1000ms timer → repository.AdvanceAll → 读取布局与状态 → domain.Step → 原子保存状态 / 仓库 / revision`。

## Tick 生命周期

每个工厂单独事务推进一刻。先运行生产与带上进度，再规划物流；解决目标容量、白名单、来源数量与带上占用依赖，然后统一扣除来源、接收目标。按稳定 ID 排序并随 tick 轮换竞争优先级。已满的传送带可在同一 tick 让旧物品离开、新物品进入；同一物品不能跨过多格。

每次 tick 或布局编辑增加 factory revision。实例移动保留状态；删除将物品回收至玩家仓库，与删除 SQL 在同一事务。HTTP 读取也使用事务，返回布局、库存、仓库和 tick 的一致快照。单 SQLite 连接串行化模拟与编辑，避免用旧状态覆盖删除或复制物品。

某工厂状态非法时记录错误并暂停该工厂的本次 tick，不清空状态；继续处理其他工厂。服务退出会取消并等待模拟协程后关闭数据库。当前目标为本机 / 单实例小型工厂，不是分布式模拟器。

## 持久化

| 表                                       | 用途                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| users / sessions                         | 账号与 Cookie Session                                                         |
| factories                                | 布局边界、owner、名称、单调 revision                                          |
| building_instances                       | 建筑 ID、类型、位置、旋转、独立 configuration                                 |
| factory_simulations                      | 每座工厂的 tick、各实例的输入 / 产物、秒进度、秒冷却和带上物品 ID / 类型 JSON |
| player_warehouses                        | 按玩家 owner_id 保存各物品累计数量                                            |
| schema_migrations / application_metadata | 迁移历史、checksum、初始化元数据                                              |

新增 005_one_second_ticks.sql 将已有 10 TPS 存档换算为整秒；保留前 4 个迁移的原始内容与 checksum。库存和仓库数量不变，未完成工作保守取整，冷却向上取整；为已有带上物品补充稳定 ID。既有布局及 configuration 原样保留；模拟状态按实例 ID 惰性初始化。仓库独立于机器状态保存，不能由客户端覆盖。所有测试数据库使用内存或临时目录。

每刻保存后才提交；正常重启保留至最后成功提交的 tick。浏览器关闭不影响服务器生产；停服期间不推进时间，重启不按现实经过时长追赶。运行期间卡顿时不会跳过计算而直接增加产量。

## 前端同步和显示

同源 `/api/v1/factories/{id}` 读取完整快照，前台每次响应后间隔 1000ms，后台标签页为 3000ms；单次请求最多 8 秒，无重叠轮询，卸载取消。失败显示重试提示，401 返回登录。仅接受 revision 不低于当前的响应，避免较早 GET 覆盖新建造或较新生产状态。

UI 不推进 tick 或修改物品数。显示服务器库存、生产 / 阻塞状态与总仓库；共享 RAF 独立绘制机器进度和带上物品。生产进度最多预演下一刻；传送带物品按稳定 id 保持跨格轨迹，阻塞后停住，不在未确认时跳到另一条带。每帧直接更新少量 transform / progress，不触发整张 React 棋盘重绘。无活跃动画时停止 RAF，后台标签页暂停，回到前台立即请求快照。详见 [animation.md](animation.md)。相邻同向带面连接仍按布局计算。OUT / IN 图标和其他非传送带图标一样可以旋转，方向规则以箭头为准。

模拟 JSON 还保存最近 3 tick 的成功端口 / 入库转移记录，用于补画机器输出、经过端口和进入机器 / Bus 的动画，不参与库存计算。客户端 LogisticsVisualStore 将在带物品与已离带的短时图标按 payload_id 合并，保留同一个 React 节点及绘制位置；入料结束只清理图标。只播放新 tick 后尚未消费的事件（最多覆盖 2 tick），首次加载 / 后台恢复不补播历史；编辑使相关路线失效。共享帧时钟与原轮询频率均不变，未引入新存储表、网络请求或渲染引擎。

视觉层使用赛博朋克＋蒸汽波 HUD：App / GameArt 为入口与静态矢量场景，FactoryWorkspace 管理建造快捷键、资源 HUD、沉浸和节能偏好，HudPopover 用原生 details 实现键盘 / 外部关闭。实体皮肤与颜色只在客户端 entityTheme / SVG 定义，不改服务器 catalog 和存档。地图 / 类型查询缓存，静态图标、带面、进度条和物品图层 memo 化；共享 RAF 将持续 DOM 绘制限制为普通约 60、节能约 15 帧。只把节能偏好保存到本地浏览器，1 TPS、库存、物流和网络读取不变。布局与性能边界见 [visual-style.md](visual-style.md)。

文字全局最小 12px，style.css 提供继承下限，Web lint 调用 check-ui-typography.mjs 检查 CSS 和 TSX 字面量字号。保留的地图坐标对小于 100% 的缩放进行字号补偿，低倍率隐藏非主要坐标及实体代号；移动物品以矢量图形展示。game-shell 定义 --workspace-width:max(90vw,1200px)，factory-workspace 宽度继承、高度显式为宽度的 9/16；三行 Grid 为 100px HUD、minmax(0,1fr) 主区和 52px 底栏，间距 12px。主区用 minmax(0,18fr/58fr/24fr) 固定三栏，图鉴与右侧检视使用 size containment 和内部滚动，中央地图吸收固定工具栏以外的剩余高度。错误提示浮层不参与尺寸计算；窄屏保持三栏、页面横向滚动。16:9 指整个工作台，内部地图适配中央区域。ConveyorVisual 移除 BELT 文本节点，带面、连接、箭头和物品轨迹不变。模型仍是 21×21 / 30px 单元，无存档或坐标协议变化。

## API 和安全

继续使用现有 API，无客户端库存写入接口。FactoryDetail 新增 simulation，Factory 新增 revision；建筑定义增加库存容量和输入白名单，配方时长更新。协议见 openapi.yaml，生成文件为 apps/web/src/api/schema.d.ts。

所有工厂详情、定义和编辑接口需登录；owner 校验覆盖库存与仓库。写入继续校验 Origin、严格 JSON、整数坐标 / 角度、占用和固定 Bus。客户端不能提交 simulation、warehouse、revision 或 configuration。账号继续使用 Argon2id 与 HttpOnly Cookie。

开发时 Vite 代理 API 到 Go；生产由 Go 托管构建后的 Web。当前无 WebSocket、离线结算、跨进程锁 / 多实例 tick 主节点，也无实时推送协议。多开标签页通过轮询读取相同服务器状态。
