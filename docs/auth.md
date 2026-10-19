# 阶段 2：账号与基础数据同步

## 分层与存储

`httpapi/auth.go` 处理 Cookie、Origin、JSON、状态码和限流；`application/AuthService` 负责输入校验、密码认证、Session 生成与到期；`domain/User` 不依赖 HTTP；`repository/Accounts` 用参数化 SQL 访问 SQLite。

新增 `002_users_sessions.sql`，保留已应用的 `001_bootstrap.sql` 不变。新建数据库与现有阶段 1 数据库均由启动 migration 自动升级。

| 表       | 字段 / 用途                                                                           |
| -------- | ------------------------------------------------------------------------------------- |
| users    | id、username（NOCASE UNIQUE）、password_hash、display_name、created_at、last_login_at |
| sessions | token_hash（主键）、user_id（外键）、created_at、expires_at（UTC Unix 秒）            |

注册的用户与首个 Session 同事务创建；登录的 last_login_at、旧 Session 撤销和新 Session 插入也在同一事务。昵称更新限定为有效 Session 所属用户，不接受客户端传入 user_id。注册 / 登录时清理过期 Session；查询即拒绝到期 Session，不需要常驻清理调度器。

## 密码与会话

Argon2id 使用 19 MiB、2 次迭代、1 lane，16 字节随机盐与 32 字节输出，保存完整 PHC 编码。参数依据 [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)，实现使用 [Go 官方 Argon2 包](https://pkg.go.dev/golang.org/x/crypto/argon2)。校验使用常量时间比较，只解析当前受支持且有资源上界的参数，拒绝畸形 hash。不存在账号也进行同成本 dummy hash 校验，统一返回“用户名或密码不正确”。密码不会写日志、API 响应或浏览器存储。

Session 是 32 字节随机 token，浏览器通过 HttpOnly Cookie 持有，数据库只保存其 SHA-256；这里 SHA-256 用于高熵随机 token，不用于用户密码。默认 168h 绝对过期，不滑动续期。注册 / 登录生成新 token 并撤销请求 Cookie 对应的旧 token，减少 Session fixation；其他浏览器自己的 Session 不被撤销。登出删除数据库记录和 Cookie，旧 token 即使被重新发送也无效。

Cookie：Path=/、无 Domain、HttpOnly、SameSite=Lax、Max-Age、Expires；production 再加 Secure，名称使用 `__Host-bakafactory_session`。local/test 名称为 `bakafactory_session`，兼容本机 HTTP。production 账号验收需要 HTTPS 反向代理。前端不使用 localStorage / sessionStorage 保存凭据。

## 请求与基础防护

- POST 注册、登录、登出与 PATCH Profile 要求 `Origin` 精确匹配 `APP_ORIGINS`，拒绝 cross-site Fetch Metadata。生产设置为页面 HTTPS Origin，开发允许 localhost 的 Vite / Go 端口。不会使用任意 Host 或不受信的代理 header 推断来源。
- JSON body 最大 16 KiB，拒绝未知字段、多个 JSON 值和不正确的 Content-Type。响应继承统一错误、request ID 与 no-store。
- 用户名规范化后为 3～24 位 ASCII 字母、数字、下划线；SQLite 唯一约束兜底并发重复注册。昵称支持中文，1～32 字符，不接受控制字符；密码不自动 trim。
- 每个 IP（实际 RemoteAddr）15 分钟内最多 20 次注册 / 登录请求，每个规范化用户名最多 10 次。成功和失败均计数；429 附带 Retry-After。不能通过伪造 X-Forwarded-For 绕过。限流状态带锁、定时惰性清理，最多 10000 个键。
- 同时最多 2 个昂贵密码计算，超过返回 429，避免大量并发 Argon2 分配内存。

Origin + JSON + SameSite 的设计参考 [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)。未引入 OAuth、邮箱、MFA、权限后台、工厂或游戏模拟。

## 前端

AccountPanel 提供创建账号 / 登录切换、确认密码、提交中状态、服务器错误提示、玩家身份、昵称保存与登出。当前为霓虹游戏入口与 HUD：已登录时资料收进“玩家档案”，昵称仍可修改；可点击外部或 Esc 关闭，Esc 返回触发按钮。成功提示 4.5 秒后消失，错误保留至后续操作。连接状态和重连仍可使用，详细服务器信息收起到“连接详情”。视觉规范见 [visual-style.md](visual-style.md)。刷新时 GET /me 恢复服务器资料，401 回到未登录状态，网络故障提供重试，不将网络失败误认为成功登出。

API 类型来自 OpenAPI；协议修改后运行 `npm run generate:api`。注册和登录通过 Cookie 自动建立认证，业务 JSON 仅返回公开用户字段。

## 验收与限制

完整检查为 `npm run check`。自动测试验证密码随机盐、错误密码、Session 轮换 / 撤销 / 过期、浏览器隔离、Profile 权限、来源与 body 校验、重复用户名和限流。真实 HTTP 冒烟从临时空库注册、保存中文昵称、重启服务后用原 Session 读取、登出后拒绝旧 Cookie、重新登录恢复昵称。production 冒烟显式携带 Cookie 来验证 HTTP 接口与 Secure 标志；浏览器通过 production Cookie 登录仍需 HTTPS。

已知边界：限流为单进程内存状态，重启后重置；代理部署所有请求会共享代理 IP 的限制，公网发布前应按可信代理与用户规模完善限流。没有找回密码和撤销全部设备功能。多个已打开页面的资料不会自动推送，刷新或操作后再读取。SQLite 当前仍为单实例方案。
