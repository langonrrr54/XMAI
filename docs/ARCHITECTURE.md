# 架构说明

## 进程划分

```
┌────────────────────────── renderer (React) ──────────────────────────┐
│  LibraryPage / BookPage(6 tabs) / ChapterEditor / PublishPage / Settings │
│  zustand 全局状态：books / settings / pipeline 事件流 / toast             │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ window.api（contextBridge，类型来自 shared/api.ts）
┌───────────────────────────────▼──────────────────────────────────────┐
│                         preload（无业务逻辑）                          │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ ipcRenderer.invoke
┌───────────────────────────────▼──────────────────────────────────────┐
│ main                                                                  │
│  ipc/         路由与参数校验                                           │
│  pipeline/    书籍铸造 → 单章写作 → 批量调度                           │
│  memory/      上下文编排 / 检索 / 摘要 / 审校                          │
│  llm/         OpenAI 兼容客户端 + 提示词工厂                           │
│  cover/       SVG 排版 + 离屏栅格化 + AI 绘图                          │
│  publish/     番茄内置窗口 / 注入脚本 / 录制回放                        │
│  db/          sql.js 封装 + 仓库层 + schema                            │
│  settings.ts  安全存储加密 + 深合并                                    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                data/xiongmao.db (SQLite WASM, 防抖落盘)
                data/covers/*.png
                persist:fanqie (Cookie/登录态)
```

## 关键数据流

### 一键开书（长篇小说）

```
灵感 → conceptSystem(novel) → ConceptOption[]
     → books:create(workType='novel')
        ├─ generateBible           → bible_entries + foreshadowing
        ├─ generateVolumeOutline   → outline_nodes(volume)
        ├─ generateChapterOutlines(1..5) → outline_nodes(chapter)
        └─ generateCover(local)    → covers/<id>.png
```

零输入模式：`idea` 为空或 `auto=true` 时走 `conceptAutoPrompt`，由模型自行判断平台方向并决定题材/受众/文风，产出完整方案；UI 的「一键全自动」直接取第一个方案创建，跳过选择步骤。

### 短故事（独立链路）

```
灵感 → conceptSystem(short) → ConceptOption[]（含 structure 预览）
     → books:create(workType='short')
        ├─ generateBible(short)    → 精简人物/地点/道具（无势力版图）
        ├─ generateShortStructure  → outline_nodes(chapter, seq=1, 7 拍)
        │                             + chapters(seq=1, status=planned)
        └─ generateCover(local)

writeChapter → workType==='short' → writeShortStory
        ├─ shortStorySystem（不分章、不留连载钩子、结尾必须闭合）
        ├─ 一次生成目标字数（不足则补写一次至结局）
        ├─ chapters(seq=1) 落库，标题 = 书名
        └─ reviewAndPersist（摘要 / 事实 / 审校，与长篇共用）
```

批量调度 `run()` 对短故事强制只写 1 篇；`generateVolumeOutline` 对短故事直接拒绝。

### 单章写作

```
chapterWriter.writeChapter
  1 outline 缺失 → generateChapterOutlines
  2 buildChapterContext → 五层记忆 + 混合检索
  3 chatStream(writerSystem) → 流式正文（IPC 节流回传）
  4 cleanNovelText → 去标题/围栏/前言
  5 篇幅 < 60% → 一次续写
  6 chapters.upsert（word_count 自动统计）
  7 summarizeChapter → ChapterDigest
  8 persistDigest
       ├─ chapters.summary / key_events
       ├─ memories(facts)
       ├─ bible_entries.state 合并
       ├─ foreshadowing 登记/回收
       ├─ embeddings(summary 向量)
       └─ 每 10 章 → volume_summaries
  9 checkConsistency → issues
 10 severity=high → fixChapter → 重新摘要与索引
```

### 发布

```
publish:open → BrowserWindow(partition=persist:fanqie)
            → dom-ready 注入 FANQIE_INJECTOR
            → 挂钩 fetch/XHR 记录请求

publish:publishChapter(mode)
  api     → 按角色排序模板 → fillTemplate → 页面内 fetch 回放 → 抽取新 id
  dom     → __XM_HELPERS__.fill(title, content) → 可选点击发布
  manual  → clipboard.writeText + 打开后台
```

## 数据库表

| 表 | 用途 |
| --- | --- |
| books | 作品主表（work_type 区分 novel/short；含 concept / style_profile JSON） |
| providers | 多套供应商配置（地址 / 加密 Key / 模型分工 / 温度），激活项同步到 settings.model |
| chapters | 章节正文、细纲、摘要、关键事件 |
| bible_entries | 设定库（kind + state JSON，可锁定） |
| outline_nodes | 卷纲 / 章纲（beats JSON） |
| foreshadowing | 伏笔台账 |
| volume_summaries | 卷级滚动摘要 |
| embeddings | 章节摘要向量（BLOB float32） |
| memories | 长期事实 / 审校记录 |
| publish_jobs | 发布任务与结果 |
| captured_requests | 录制到的接口模板 |
| settings | 应用设置（apiKey 加密） |
| meta | schema 版本 |

## 错误与降级

| 环节 | 失败时 |
| --- | --- |
| 摘要 | 用正文前 300 字兜底，流程继续 |
| 卷摘要 | 跳过，下个 10 章重试 |
| 向量服务 | 回退本地哈希向量 |
| 审校 | 记录警告，不阻断 |
| AI 封面 | 回退本地 SVG 排版 |
| 接口直发 | 返回 `need_manual` 并提示改用页面/复制 |
| 数据库写盘 | 700ms 防抖 + 退出强制写入；损坏时备份并重建 |

## 开发自检

设置环境变量后可无头截图并输出渲染进程报错：

```bash
XM_SMOKE=1 XM_SMOKE_EVAL_FILE=./scenario.js npx electron .
```

- `XM_SMOKE_WAIT`：执行脚本后的等待毫秒数
- `XM_SMOKE_KEEP=1`：截图后不退出
- 截图输出：`data/smoke.png`

这也是验证「模型不可用」时全链路的推荐方式（可用本地 mock 服务替代真实模型）。
