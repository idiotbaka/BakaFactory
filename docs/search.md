# 名称、编号与拼音搜索

## 当前交互

建造阵列的建筑 / 物流 / 物品、工作室配方、总仓库、诊断物品和机器人列表共用名称搜索逻辑。输入框提示拼音，悬停提示全拼、首字母和部分内容；原无障碍名称及键盘输入隔离保持。

以“废铜线”为例：

| 输入                             | 匹配方式                               |
| -------------------------------- | -------------------------------------- |
| `废铜线`、`铜线`                 | 中文连续子串                           |
| `feitongxian`、`FEITONGXIAN`     | 不区分大小写的全拼                     |
| `ftx`、`ft`、`tx`                | 首字母的完整或部分内容                 |
| `feit`、`tongx`、`ongxia`        | 全拼任意位置的连续部分，允许音节未输完 |
| `fei tong xian`、`fei'tong'xian` | 忽略空格和拼音分隔撇号                 |
| `I0004`、`i0004`                 | 编号，原有内部 ID 搜索也保留           |

全角字母转半角，带调拼音按无调匹配；`ü`、带调 `ǚ`、`u:` 与 `v` 统一，例如“废铝片”可输入 `feilvpian` 或 `feilüpian`。模糊匹配指连续子串，不做编辑距离纠错或任意跳字组合；纯拼音与中文名称分别匹配，不自动拆解中文 / 拼音混合输入。清空输入或只输入空格恢复原列表，不按拼音排序。

查询保留原过滤范围：建造阵列只查当前分类 / 阶段；工作室只查当前设备的已开放配方名称 / 编号，名称中可匹配任一产物；仓库只查原可见的实库存 / 可下单物品；诊断仍排除旧档兼容物品；机器人仍遵守厂区和待处理筛选。搜索不开放设备、不改变库存和获得记录，也不自动切换工作室设备。

## 方案选择

| 方案                                 | 维护和加载代价                                           |
| ------------------------------------ | -------------------------------------------------------- |
| 人工为每件物品录入拼音               | 浏览器无需字典，但新增 / 改名易漏项，需重复维护          |
| 浏览器加载完整字典并转换             | 能处理动态中文，但所有玩家额外加载字典并在运行时转换     |
| **算法生成后随构建分发索引（当前）** | 自动处理目录名称，浏览器只加载小索引；新目录内容自动更新 |

当前对象来自固定目录，选择第三种。根项目固定开发依赖 `pinyin-pro`，利用词语上下文生成无调全拼 / 首字母，处理常见多音词如“传送带”“发条搬运车”；不以字符码位或 Intl 排序推测读音。词库不进入前端或 Worker，不为拼音修改原始玩法 JSON、运行定义、API、服务器、存档或数据库。

当前 536 个去重名称生成的 JSON 约 31.6 KiB；独立生产分包 `catalog-search` 约 28.63 kB、gzip 约 10.13 kB，后续体积以构建输出为准。该分包使用 Vite 内容哈希和 [静态缓存策略](static-assets.md)。

## 生成与新增内容

- 定义源：`apps/server/internal/catalog/definitions.json`。
- 生成器：`scripts/generate-search-index.mjs`，收集 items / buildings / recipes / robots 名称，去重、固定排序、生成全拼和首字母。
- 生成文件：`apps/web/src/game/catalogSearchIndex.json`，应随代码保存，不要手改。
- 查询实现：`apps/web/src/game/catalogSearch.ts`，模块初始化时归一化索引一次，列表筛选先归一化查询，再匹配各字段。

新增 / 改名继续使用原玩法导入流程；`npm run import:gameplay` 完成后自动更新索引。`npm run dev`、前端 workspace 的 dev / build / test 也在启动前生成，根目录 build / test 调用对应 workspace 命令。内容没有变化时不会写文件。`npm run lint` 使用 `--check` 检查与当前目录一致，漏更新会报错并提示重新生成。

开发服务运行期间执行玩法导入会改写生成文件并由 Vite 更新；直接调整运行目录时，需手动生成或重启开发入口。新物品无需逐件录入拼音。

```bash
# 本轮新增开发依赖，已有环境安装一次
npm run setup
# 单独生成
npm run generate:search
# 仅检查是否过期
node scripts/generate-search-index.mjs --check
```

读音由固定版本词库与名称上下文确定，不穷举多音组合。若行业词误读，可在生成脚本中使用上游 `customPinyin` 注册该词读音后重新生成，并补具体名称回归，不手改生成结果；API 见 [pinyin-pro 文档](https://pinyin-pro.cn/use/pinyin.html)。玩家自定义名称不在本索引中，未知名称仍可按原文 / ID 搜索；未来若需对其搜索拼音，应另行处理动态转换边界。

## 验证

已补中文 / 编号、大小写、全拼 / 首字母 / 部分拼音、空格 / 撇号、声调 / 全角 / ü、无匹配、当前名称覆盖，以及各入口的回归代码。自动测试和浏览器验收由用户执行：

```bash
npm run test --workspace @bakafactory/web -- src/game/catalogSearch.test.ts src/game/FactoryWorkspace.test.tsx src/game/IndustryViews.test.tsx src/game/DiagnosticsPanel.test.tsx src/game/RobotPanel.test.tsx
```

手动步骤见 [acceptance.md](acceptance.md)，实际验证状态见 [progress.md](progress.md)。
