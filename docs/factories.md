本文件保留早期工厂模型的设计历史。当前已支持建筑编辑、生产、物流与仓库；请以 [simulation.md](simulation.md)、[architecture.md](architecture.md) 及代码为准。

# 阶段 3：工厂、实体定义与游戏工作台

下文记录阶段 3 基线。阶段 4 已沿用同一技术增加建筑编辑，见 [editor.md](editor.md)。

## 服务端数据模型

`domain/Factory` 保存 id、owner_id、name、width、height、created_at。`FactoryDetail` 在概要外附带 BuildingInstance 列表；实例保存 id、factory_id、building_type、整数 x/y、rotation（0/90/180/270）、JSON object configuration。BuildingDefinition 是共享的类型定义，Instance 是某一工厂地图上的具体对象。

当前创建规格由服务端固定为 21×21，坐标 -10～10。客户端只提交工厂名称，不能决定 owner、尺寸、布局或建筑配置。FactoryService 做名称验证并调用 Repository；HTTP Handler 从有效 Session 获取 owner，再调用服务。读取和列举均按 owner 过滤，不存在与无权限返回同一种 404。

`003_factories.sql` 新增 factories 和 building_instances。owner_id 唯一约束限制一人一座；并发创建一成功一冲突。SQLite AFTER INSERT trigger 在同一原子插入内创建中心 Bus，因此不会持久化没有 Bus 的新工厂。其位置、类型、方向和身份不能修改；禁止删除仍所属工厂的 Bus、覆盖中心、用 INSERT OR REPLACE 偷换 Bus、生成第二个 Bus。删除所属用户时外键级联清理工厂和建筑，避免孤立数据。数据库也约束格子唯一、坐标边界、整数坐标、旋转角度及配置对象。

这些不变量用数据库集成测试验证。触发器和外键行为依据 [SQLite CREATE TRIGGER](https://www.sqlite.org/lang_createtrigger.html) 与 [SQLite Foreign Keys](https://www.sqlite.org/foreignkeys.html) 的官方文档。

## Data-driven 定义

配置位于 `internal/catalog/definitions.json`，通过 go:embed 打入程序。启动时解析并校验，不依赖可写外部配置路径。前端读取 `/api/v1/definitions`，无需另写一套物品 / 建筑 / 配方常量。

| 类型 | 本阶段定义                                                                           |
| ---- | ------------------------------------------------------------------------------------ |
| 物品 | iron_ore / ORE、iron_plate / FE、gear / GEAR                                         |
| 建筑 | bus / BUS、miner / MIN、furnace / FUR、assembler / ASM、conveyor / BELT              |
| 配方 | 1 iron_ore → 1 iron_plate，2000ms，furnace；2 iron_plate → 1 gear，3000ms，assembler |

定义包含名称、描述、稳定 ID、代号、图标 ID、颜色；建筑额外记录类别与固定属性。配方数量为 int64，时长为整数毫秒。此时只是数据，不会启动生产或给予资源。catalog 验证重复 ID、Bus 存在、引用有效性、数量 / 时长正值、颜色格式等，错误配置拒绝启动。

## 前端界面

登录后切换为宽版工厂工作台，保留账号、昵称编辑、登出和服务状态。布局为工业图鉴 / 地图 / 实体详情。无工厂时提供命名与创建表单；有工厂时从服务器读取概要及实例，绘制 441 个格子，X 向右、Y 向上，突出两条零坐标轴与中心 Bus。地图区域可以滚动，Bus 可点击查看详情。

图鉴展示全部建筑和物品，选择后显示代号、说明、类别、位置规则与关联配方。只有服务器返回的建筑实例才画到地图，不将图鉴图标冒充已拥有的机器。

图标集中由 `game/DefinitionIcon.tsx` 根据 icon ID 绘制 SVG，并附代号文本；以后可在此组件统一切换图片素材。阶段 3 使用 DOM/CSS 网格预览，阶段 4 编辑器复用同一 FactoryDetail 和 Catalog 输入，不需要切换到 PixiJS。

网络加载、创建中的状态、失败重试、过期 Session 返回登录均有反馈。创建遇到 409 会重新读取服务器工厂，兼容两个页面同时创建。不会用 localStorage 保存布局或模拟库存。

## 验收

自动检查：`npm run check`。包括创建和读取、账号隔离、并发限制、Bus 防护、持久化、catalog 规则、前端表单 / 地图 / 图鉴 / 重试与旧阶段回归。真实 HTTP 冒烟会创建中文工厂，验证 Bus，重启后比较整个布局，并重新登录读取同一工厂。

用户浏览器验收：登录已有或新账号，创建中文命名的工厂；确认 21×21、-10～10 坐标和 (0,0) Bus；点击不同图鉴查看配方；刷新、登出再登录后名称与 Bus 保持；换另一账号确认无法看到原账号的工厂；窄窗口下地图应可滚动，图鉴与详情应正常显示。

## 当前边界与下一阶段

没有放置 / 删除 / 旋转接口；没有生产、库存、传送带运动或工厂资源计算。其他机器仅在图鉴定义，地图初始只有 Bus。没有重命名、删除工厂、多工厂或全局 Bus。

阶段 4 可基于 FactoryService / Repository 增加 BuildingInstance 操作，并复用边界、Bus 与占用校验；Domain 不依赖当前 DOM 预览渲染。后续配置扩展需新增兼容的 migration，不能修改已应用 SQL。
