# 开场前两页像素风试版

使用内置 `image_gen`，参照开场对应原图逐张重绘，再各进行一次表面清理。保留原叙事与构图，使用 SFC / 16 位像素轮廓、成块阴影和干净色面，减少锈斑与细碎噪点。第二页参考第一页初稿配色，第一页清理时参考第二页最终版的表面简洁度。

- 正式图片：`apps/web/src/assets/stories/opening-pixel-v1/`。
- 原版保留：`apps/web/src/assets/stories/opening-v1/`。
- 实际提示词、输入角色和生成顺序：`prompts.json`。
- PNG 文件头、尺寸、体积与 SHA-256 报告：`asset-validation.json`。

两张正式图均直接复制绘图输出，没有额外滤镜、重采样或裁切；第一页 1672×941，第二页 1671×941，保留生成器的原始尺寸，由播放器等比 contain 显示。两张约 4.63 MiB。第三至第五页仍引用原手绘图；不调整剧情正文、观看记录或播放器布局。

在仓库根目录执行 `node output/imagegen/opening-pixel-v1/validate-assets.mjs` 可重新生成静态资源报告。用户启动 `npm run dev` 后，从“重放剧情 → 开场：下班计划开启”查看效果；游戏内显示、窄窗口与节能模式验收见 `docs/acceptance.md`。实际检查状态见 `docs/progress.md`。
