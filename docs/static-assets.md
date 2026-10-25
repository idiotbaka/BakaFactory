# 生产静态资源缓存

## 原因与职责

原 Go HTTP 中间件对所有响应写入 `Cache-Control: no-store`，包括生产构建的字体、PNG、JS 和 CSS。`no-store` 禁止浏览器保存响应，页面内的资源预热只能复用当前页面已完成的对象，无法解决刷新后的重复下载。响应中的 `Server: nginx` 只说明请求经过 nginx，不能据此判断缓存头由 nginx 产生。

本项目采用 **Go 定义缓存策略，nginx 透传响应头，浏览器保存公开静态文件**。现有生产入口已由 Go 的 `http.FileServer` 提供 `apps/web/dist`；在这里修复可覆盖直接访问与反向代理部署，避免每个部署环境各写一份规则。无需 Service Worker、IndexedDB 资源副本或 nginx `proxy_cache`。

nginx 直接提供静态文件也可行，适用于明确需要将静态流量从 Go 分离的部署；此时应在 nginx 复现下面的分类，并同步管理构建目录和发布版本。当前重复下载问题用浏览器缓存即可解决，无需先更换静态文件服务方式。

## 当前策略

| 响应                                                                                              | Cache-Control                         | 行为                                                                                               |
| ------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/assets/名称-八位内容哈希.扩展名` 的 200 / 206 / 304                                             | `public, max-age=31536000, immutable` | 一年内复用；构建内容变化使用新 URL                                                                 |
| `/fonts/fusion-pixel/fusion-pixel-12px-proportional-zh_hans-vYYYY.MM.DD.woff2` 的 200 / 206 / 304 | `public, max-age=31536000, immutable` | 按字体发布版本缓存一年                                                                             |
| `/` 入口、favicon、字体清单 / 许可证及其他未版本化静态文件的 200 / 206 / 304                      | `no-cache`                            | 可保存，但复用前必须向服务器校验；沿用 FileServer 的 Last-Modified / If-Modified-Since，可返回 304 |
| API、健康检查、静态文件 404 / 416 等错误及重定向                                                  | `no-store`                            | 不保存响应，错误不会被长期缓存                                                                     |

`no-cache` 允许保存并要求校验，与禁止保存的 `no-store` 不同。长期缓存只用于版本化的公开静态文件；账号、心跳、云存档的缓存策略仍由全局中间件保持 `no-store`。常规请求保留 `X-Request-ID` 与 `X-Content-Type-Options`。

Vite 目前使用默认八位内容哈希文件名，包含 PNG、剧情图片、JS / CSS 分包和 Worker；修改构建命名格式时，需同步更新 `apps/server/internal/httpapi/static.go` 的匹配规则和测试。public 文件不会自动添加内容哈希，因此不能对整个站点或所有图片扩展名统一设置一年缓存。版本化字体文件必须保持同 URL 内容不变，换字体 / 裁字时使用新版本文件名，并同步更新 HTML、CSS、预热索引和字体静态检查。

## nginx 反向代理

如果现有 nginx 已将整个站点代理给 Go，通常无需添加缓存指令。下列片段仅展示已有 HTTPS `server` 中的代理关系；保留部署已有的证书、请求体大小限制、超时和安全配置：

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

检查 `http`、`server`、实际命中的 `location` 和 include 文件：

- 删除本游戏代理路径上额外的 `add_header Cache-Control ...`、`expires ...` 或 `proxy_hide_header Cache-Control`，让 Go 的单一策略传到浏览器。`add_header` 是追加，不会自动替换上游同名头；追加一年缓存不能抵消上游 `no-store`。
- 不要为整个站点开启共享代理缓存，也不要用 `proxy_ignore_headers Cache-Control Set-Cookie` 绕过账号 / 存档边界。浏览器缓存不要求 nginx 启用 `proxy_cache`。
- 如果有专门的 `/assets/`、`/fonts/` 或扩展名正则 `location` 使用 `root` / `alias` 直接读文件，则请求没有进入 Go，本轮 Go 策略不会生效。可让这些路径也代理到 Go；若保留 nginx 直出，需由该层按上表配置成功文件缓存、错误响应及入口更新策略。

修改 nginx 后，由部署者执行 `nginx -t`，通过后按自己的服务管理方式 reload。若有其他代理 / CDN，也检查最终响应是否只有一个预期的 Cache-Control，且没有额外的 `no-store`。本仓库不保存部署专用配置。

## 构建与发布

1. 仓库根目录执行 `npm run build`，同时生成 Web 静态文件和 Go 可执行程序。
2. 发布构建后的 Go 程序与 `apps/web/dist`，按原生产方式重启 Go；直接启动程序时设置 `WEB_DIST_DIR` 指向该构建目录，`npm start` 已提供默认值。不要使用 Vite 开发服务器验收生产缓存策略。
3. 先发布新资源，再切换入口 HTML。保留旧哈希资源供尚未刷新页面的玩家读取旧分包 / 剧情图；不要覆盖同一哈希 / 版本 URL 的内容，也不要将缺失 `/assets/` 请求回退到入口 HTML。Vite 重新构建会清理输出目录，需要由发布流程另外保留 / 合并旧资源，而非依赖本机 dist 自然留存。
4. 对照下列步骤核对公网和上游的响应头。旧 `no-store` 响应没有可用缓存，因此修复后第一次访问仍需下载；之后才能复用。

HTML 使用 `no-cache`，刷新时会校验入口，新入口会引用新哈希资源，无需玩家清空浏览器缓存。已打开页面不会自动热更新。若部署工具保留了已变更 HTML 的旧修改时间，需修正文件时间，避免条件请求误判为未修改。

## 验收与回归

由用户启动生产构建并执行检查，不清除 IndexedDB、账号或工厂数据。下列 `BASE_URL` 由执行者填写实际站点，`ASSET_PATH` 从当前 Network 或构建后的 index.html 中取得真实文件名：

```bash
BASE_URL='https://your-site.example'
ASSET_PATH='/assets/replace-with-current-hashed-file.png'
curl -I "$BASE_URL$ASSET_PATH"
curl -I "$BASE_URL/fonts/fusion-pixel/fusion-pixel-12px-proportional-zh_hans-v2026.10.16.woff2"
curl -I "$BASE_URL/"
curl -i "$BASE_URL/api/v1/me"
curl -I "$BASE_URL/assets/missing-Abcd1234.png"
```

期望：真实哈希资源和字体为 200、一年 immutable；入口为 200、no-cache；账号接口为 no-store（未登录的 401 亦如此）；缺失资源为 404、no-store。`curl` 本身不会像浏览器那样复用 HTTP 磁盘缓存，重复 curl 返回 200 并不表示策略失效。若公网与 Go 上游不同，优先检查代理 / CDN 的命中路径与响应头覆盖。

浏览器 Network **取消勾选 Disable cache**，正常进入一次，再正常刷新或关闭并重开页面。字体 / PNG 应显示 memory cache / disk cache，或在浏览器要求校验时显示 304；不要用硬刷新判断正常缓存。入口仍会校验，账号 / 心跳仍请求服务端。缓存后的资源仍计入真实预热完成数，仍需完成读取 / 解码，不以“已下载”标记跳过可用性检查。浏览器可因存储压力、隐私模式或用户清理而回收缓存，不能保证永久零下载。

再次构建并发布一处实际资源修改：新入口应引用新 URL 并下载新版本，旧页面引用的旧资源仍应可读；接口和游戏存档不受影响。

已补 Go 回归用例，覆盖 GET / HEAD、图片 / JS / CSS / Worker / 字体、未版本化文件、条件 304、Range 206 / 416、404、重定向以及 API 缓存隔离。测试只使用临时目录 / 内存数据库。由用户运行：

```bash
node scripts/go.mjs test ./internal/httpapi
```

实际验证状态见 [progress.md](progress.md)。参考：[HTTP Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control)、[Vite 静态资源](https://vite.dev/guide/assets.html)、[nginx proxy 模块](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)、[nginx headers 模块](https://nginx.org/en/docs/http/ngx_http_headers_module.html)。
