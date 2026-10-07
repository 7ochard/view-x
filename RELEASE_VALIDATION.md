# View-X 0.3.1 发布验证

验证日期：2026-10-07，Windows，独立发布副本。

## 已通过

- `npm test`：7 项工作区行为测试通过。
- 本地脚本的 Node 语法检查；manifest 和 HTML 中 18 个本地资源引用存在。
- manifest、package.json、package-lock.json 的根与包版本均为 `0.3.1`。
- 独立 Chromium 测试环境实际加载 Manifest V3 扩展与 service worker。
- 默认五栏、选择列、展开、Escape 收起、添加列、刷新后本地保存，无页面脚本异常。
- 当前上传文件和 160 个历史文件对象的常见凭据与本机路径模式检查无发现；发布时仓库无 Actions 运行记录。

## 验证边界

浏览器测试使用全新的独立 profile，主动阻断 X 网络请求，仅验证扩展和工作台外壳，不代表登录后的 X 内容已通过验收。真实时间线、Likes、媒体、会话与限流处理仍需使用用户自己的 X 登录账号验证。X 页面和规则变化可能影响可用性。

安装包通过逐文件校验和 ZIP CRC 检查；包中 BUILDINFO.txt 记录对应源码提交，SHA256SUMS.txt 记录文件摘要。原工作目录和旧安装包保留。
