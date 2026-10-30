# 番茄小说发布适配

目标：不离开软件，把章节发到番茄小说作家后台。

后台地址：<https://fanqienovel.com/main/writer/>

## 1. 三种模式

| 模式 | 原理 | 稳定性 | 适用 |
| --- | --- | --- | --- |
| **接口直发** | 在已登录页面上下文 `fetch` 回放录制到的真实接口 | 依赖平台接口，可重录 | 批量、无人值守 |
| **页面自动化** | 注入脚本定位标题框/正文编辑器并写入，可选点发布 | 依赖页面结构 | 接口变动时的替代 |
| **复制人工** | 复制正文 + 打开后台 | 最稳 | 首次、风控期 |

## 2. 登录态

- 使用独立分区 `persist:fanqie`，Cookie 落在 Electron userData 下。
- 主窗口关闭软件后登录态仍保留。
- 内置窗口使用桌面 Chrome UA，避免被识别为内嵌浏览器。

入口：`src/main/publish/fanqie.ts`

## 3. 请求录制

页面加载后注入 `src/main/publish/injector.ts`：

- 挂钩 `window.fetch` 与 `XMLHttpRequest`，记录 `fanqienovel.com` 上的非 GET 请求；
- 同时保存请求头、请求体、响应状态与响应体（截断至 400KB）；
- 缓冲区最多 150 条，通过 `executeJavaScript` 读回主进程。

UI：发布中心 → 「抓取接口」 → 每行选择用途（创建草稿 / 保存正文 / 发布）→ 「存为模板」。

## 4. 回放直发

模板按 `create_draft → save_content → publish` 顺序回放。

**参数注入策略**（`fillTemplate`）：

- 请求体是 JSON：递归遍历，按 key 模糊匹配替换
  - `title|chapter_name|name` → 章节标题
  - `content|text|body|paragraph` → 正文
  - `chapter_no|chapter_index|section_no` → 章号
  - `word_count` → 字数
- 请求体是表单：解析 `URLSearchParams` 后按同名规则替换
- 其余情况：替换 `{{title}} / {{content}} / {{chapterNo}} / {{chapterId}}` 占位符

**响应关联**：每次回放后从响应 JSON 递归提取 `article_id / chapter_id / item_id / draft_id / id`，写入 `chapterId` 变量，供后续模板的 `{{chapterId}}` 使用。

若模板结构与实际不符，在「编辑请求体」里直接改成带占位符的版本即可。

## 5. 页面自动化

注入的 `__XM_HELPERS__` 提供：

- `probe()`：探测标题框/编辑器是否存在
- `fill(title, content)`：
  - 标题：`input[placeholder*="标题"]`、`input[name*="title"]` 等，使用原生 setter + `input/change` 事件兼容 React 受控组件
  - 正文：优先 `.ProseMirror`、`[contenteditable="true"]`、`.ql-editor`、`textarea`，用 `execCommand('insertText')` 写入富文本编辑器
- `click(['发布','提交'])`：按文字匹配可见按钮

## 6. 风控与节奏

- `settings.fanqie.publishDelayMs` 默认 1500ms，多接口回放之间自动等待。
- 建议每批发布 ≤ 5 章，间隔数分钟；不要在短时间内高频切换作品。
- 发布前确保正文非空、字数达标（平台有最低字数要求）。

## 7. 故障排查

| 现象 | 处理 |
| --- | --- |
| 显示未登录 | 重新打开内置后台扫码登录；确认系统时间正确 |
| 抓不到接口 | 确认是在内置窗口（不是系统浏览器）操作；操作后点「抓取接口」 |
| 回放 401/403 | 登录态过期，重新登录 |
| 回放成功但后台无章节 | 请求体字段没替换对：编辑模板，改用占位符版本 |
| 找不到编辑器 | 先在内置后台进入「新建章节」页，再点「填入页面」 |
| 自动点发布无效 | 关闭自动发布，人工点；或把按钮文字加入 `click` 数组 |

## 8. 合规边界

仅操作**你本人已登录的账号**。软件不存储平台密码，不绕过任何访问控制，只复用你已获得的登录态与页面自身接口。请遵守平台关于 AI 生成内容的标注与发布规则。
