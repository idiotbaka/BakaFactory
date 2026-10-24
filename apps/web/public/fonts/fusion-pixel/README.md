# Fusion Pixel Font / 缝合像素字体

本目录随游戏分发原版字体及发布包附带的许可证。字体文件未修改、未裁字、未转换格式；文件名增加发布版本以便缓存更新。

- 项目与作者：TakWolf，<https://github.com/TakWolf/fusion-pixel-font>
- 固定发布版本：2026.10.16，<https://github.com/TakWolf/fusion-pixel-font/releases/tag/2026.10.16>
- 原始下载包：fusion-pixel-font-12px-proportional-otf.woff2-v2026.10.16.zip
- 原始包内文件：fusion-pixel-12px-proportional-zh_hans.otf.woff2
- 规格：12px、比例宽度、简中字形、Regular；该语言版本也包含拉丁文字与其他已支持的字符。
- 游戏内 CSS 字体族别名：Fusion Pixel Game。页面、登录 / 注册、工厂和表单共用此文件；原 mono 令牌也使用该字体，比例模式不承诺字符等宽。
- 字体许可证：[SIL Open Font License 1.1](OFL.txt)。保留上游声明：[Ark Pixel](LICENSES/ark-pixel/OFL.txt)、[Cubic 11](LICENSES/cubic-11/OFL.txt)、[Galmuri](LICENSES/galmuri/LICENSE.txt)。以上四份文本均从该发布包原样复制。

manifest.json 记录下载来源、文件尺寸与 SHA-256；其下载包校验值与 GitHub 发布资产的 digest 一致。项目 lint 会检查本地字体和许可证文件，构建时整个目录随 public 复制，发布后同样可查看这些说明。

字体只提供一个 Regular 字重，本项目使用 400 和 normal，禁用合成粗体 / 斜体；标题通过字号、间距与颜色区分，最小字号仍为 12px。未覆盖的 Unicode 字符或系统原生控件可能使用浏览器回退字体；本项目不把单一字库描述为覆盖所有 Unicode。

在仓库根目录执行以下命令可重新获取同一发布包；解压后仅取上述字体与四份许可证，核对 manifest.json 中的 SHA-256，不从构建工具仓库误取 MIT 许可证作为字体许可证。

```bash
curl --fail --location --output fusion-pixel-font.zip https://github.com/TakWolf/fusion-pixel-font/releases/download/2026.10.16/fusion-pixel-font-12px-proportional-otf.woff2-v2026.10.16.zip
```
