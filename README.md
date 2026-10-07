# View-X · X 多列工作台

**当前版本：0.3.1。** 基于 TweetDeckX 改造的 Chrome / Chromium 扩展，使用浏览器已有的 X 登录会话，将多个时间线、页面和点赞列表放到横向工作台中。

## 下载与安装

1. 从 [v0.3.1 Release](https://github.com/7ochard/view-x/releases/tag/v0.3.1) 下载 `View-X-v0.3.1.zip` 并完整解压。
2. 打开 `chrome://extensions`，启用右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择直接包含 `manifest.json` 的 `View-X-v0.3.1` 文件夹。
4. 在同一个浏览器登录 https://x.com/，点击工具栏里的 View-X 图标。

不需要 Node.js、npm 或额外 API Key。此发布提供手动安装包，尚未通过 Chrome Web Store 分发。

## 当前能力

- 默认五栏：为你推荐、正在关注、第一个 timeline、Likes、探索；timeline 和 Likes 的显示依赖 X 页面及当前登录账号。
- 添加 X 链接、调整列宽、拖拽排序、多列或单列浏览。
- 展开当前列、原位切换、按 Escape 收起。
- 隐藏列延迟创建，切换时保留已加载页面。
- 可切换纵向同步滚动；已有自定义列和主动清空的工作台保留。
- 浏览器本地保存工作台设置。

## 升级

关闭 View-X 工作台标签页，把新版解压到固定目录，在扩展管理页对原扩展点击“重新加载”，再打开工作台。尽量沿用原安装路径，避免浏览器识别为另一份扩展。

## 权限与网络

| 权限 | 用途 |
| --- | --- |
| storage | 在浏览器中保存工作台与设置 |
| cookies | 读取 X 会话相关 cookie，使嵌入页面能使用现有登录状态 |
| declarativeNetRequest / declarativeNetRequestFeedback | 调整 X 页面嵌入所需的响应头、请求头规则及诊断 |
| webRequest | 观察 X 的限流响应 |
| X / Twitter / twimg / api.x.com 主机权限 | 页面加载、媒体资源和 X 会话适配 |
| api.github.com 主机权限 | 检查本仓库的最新 Release，不执行自动安装 |

扩展运行时会访问 X、其媒体服务与 GitHub 更新接口。发布包不包含用户登录会话、cookie、浏览记录或私有凭据。

## 验证与限制

运行 `npm test` 执行工作台行为测试，无需安装依赖。发布验证范围见 `RELEASE_VALIDATION.md`。

- X 页面结构、登录行为、访问限制和限流变化可能导致部分列不可用。
- 点赞列表、个人 timeline 和登录后的内容需要在你自己的浏览器中验收。
- 此扩展沿用上游的嵌入与请求头调整方式；请了解并遵守 X 的适用条款。
- 不承诺全浏览器兼容或持续可用。

版本变化见 [CHANGELOG](CHANGELOG.md)。

## 来源与许可

基于 [ngalatis/TweetDeckX](https://github.com/ngalatis/TweetdeckX) 的既有代码，沿用现有 ISC 声明。AutoAnimate、Remix Icon 和 Emojibase 保留各自许可，见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)。
