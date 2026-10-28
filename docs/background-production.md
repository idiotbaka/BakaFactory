# 浏览器后台生产

## 行为

游戏默认在页面隐藏、切换浏览器 Tab 和最小化窗口时继续生产，不需要打开开关。所有厂区仍由同一个 Worker 按正常 2 TPS 推进，工作室、物流、能源和机器人沿用同一套逐刻规则；后台不是按名义产量补发物品。

隐藏时停止共享 RAF 绘图并清理旧物流动画，返回后显示最新确认状态，不回放后台转移。IndexedDB 仍每 10 tick 保存完整世界，隐藏瞬间另尽力保存一次；账号独占 Web Lock 始终保留，另一个同账号游戏标签页不能同时运行。界面、节能模式、存档格式、API 和数据库无需变更。

## 原因与实现

旧 `apps/web/src/game/local/runtime.ts` 的 `allowed()` 要求 `!document.hidden`，`visibilitychange` 会立即关闭 Worker 许可并显示“后台暂停”；这是普通切 Tab 后立刻停止的直接原因。另外，心跳使用主线程链式 `setTimeout`，后台节流可能使 30 秒许可无法及时续期。Chrome 的[后台计时器说明](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)解释了隐藏页面的定时器合并 / 降频。

当前实现：

- `runtime.ts` 的运行条件不再依赖可见性。正常返回前台可发起心跳，有效许可期间继续生产；断网、账号失效、存档冲突和本机保存失败仍暂停。
- `simulation.worker.ts` 初始化后独立每约 10 秒发送 `heartbeat_due`，主线程复用原 Cookie / session_id 心跳请求、8 秒超时和并发去重。即使模拟暂停或尚未建厂也继续检查连接；主线程仅在 Worker 创建前保留初始化重试定时器。
- 模拟以单调时钟的下一刻截止时间调度。短延迟允许顺序执行到期的普通 tick，例如每秒唤醒一次时执行两刻，而非每次回调只走半秒；单次最多 5 刻，超额丢弃，开发者高 TPS 仍受实际负载限制。每刻独立生成连续 revision 的增量帧，沿用原子扣收与保存。
- `runtimeTiming.ts` 集中约 10 秒心跳、最多 30 秒许可、2500ms 长间隔界限与单次 5 刻上限。许可携带绝对墙钟截止时间，Worker 同时检查单调时钟与墙钟，排队的过期许可不会变成新许可。

本轮目标是普通桌面浏览器后台挂机。页面关闭、系统休眠或浏览器真正冻结 / 丢弃时无法保证 JavaScript 继续执行；这类状态仍不结算离线收益。可观察到的 freeze / pagehide 会暂停并尽力保存，resume / pageshow 或 Worker 检测到超过 2500ms 的间隔后重新校验；旧在途心跳不能授权新生命周期。浏览器生命周期边界见 [Chrome Page Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)。

## 验证

由用户启动 `npm run dev`，准备原料充足、产物可持续进入 WH 的产线，分别保持前台、切换其他 Tab、最小化窗口运行相同时间（建议各 2 分钟，再做一次超过 6 分钟的后台运行）。比较总仓库存与任务累计制造数，后台应继续增加，返回不应显示“后台暂停”或重放历史物流。切换普通 / 节能模式后重复，生产速度保持一致。

在隐藏期间验证同账号第二个游戏 Tab 仍提示占用；断网或另一浏览器重新登录后，旧页面应暂停；恢复网络需心跳成功后继续，不补算断网时间。后台运行后返回并刷新，核对已保存物品和进度。

用户可运行定向回归：

```sh
npm run test --workspace @bakafactory/web -- src/game/local/runtime.test.ts src/game/local/worker.test.ts src/game/animationClock.test.ts src/game/logisticsVisuals.test.ts
```

回归代码覆盖隐藏时实际工作室产物、完整保存与账号锁、Worker 心跳与失效会话、后台断网、短延迟多刻 / 连续 revision、有界调度、过期许可和挂起恢复。实际执行状态见 [progress.md](progress.md)；未执行的测试不能视为通过。
