# 长篇记忆引擎

目标：在 1000+ 章、200 万字规模下，让第 1200 章仍然记得第 37 章埋下的伏笔、第 400 章改过的称谓、第 800 章人物断掉的手臂。

> 短故事使用同一套记忆表，但只有一篇：仍会写摘要、抽取事实与伏笔以保证篇内自洽，不产生分卷与长程检索压力。相关流程见 `chapterWriter.writeShortStory`。

## 1. 问题拆解

| 问题 | 单纯"把前文塞进 prompt"的后果 | 本方案 |
| --- | --- | --- |
| 上下文窗口有限 | 早期剧情被挤出 | 分层摘要逐级压缩 |
| 细节太多 | 噪声稀释关键设定 | 相关度检索 + 硬设定常驻 |
| 状态会变 | 前后矛盾 | 实体状态机（state 合并） |
| 伏笔会丢 | 挖坑不填 | 伏笔台账独立存储 |
| 文风漂移 | 越写越像 AI | 文风卡 + 反 AI 腔清单 |

## 2. 五层上下文

编排器位于 `src/main/memory/context.ts`，输入是当前章的细纲与节拍，输出是按预算裁剪过的若干文本块。

```
预算 = settings.writing.contextBudget * 0.85

L0 核心设定（locked / rule / power / world）       ≤ 18%   永不裁剪
L1 人物与势力状态卡（相关人物优先 + 高重要度）      ≤ 14%
L2 分卷摘要（全书压缩史）                          ≤ 12%
L3 最近 8 章滚动摘要（近 3 章更详细）               ≤ 15%
L4 长程检索结果（久远但相关）                       ≤ 13%
L6 未回收伏笔                                      ≤ 4%    永不裁剪
L5 上一章结尾原文（约 900 字）                      ≈ 1400 tokens
```

预算不足时从尾部按 L5→L4→L3→L2→L1 依次丢弃，L0 与伏笔块受保护。

## 3. 检索：BM25 + 向量 + 新近度

`src/main/memory/retriever.ts`

```
score = 0.50 * 归一化BM25 + 0.35 * 余弦相似度 + 0.15 * 新近度
```

- **BM25**：中文单字 + 二元组 + 三元组分词，覆盖人名、地名、功法名（`vector.ts`）。
- **向量**：优先调用配置的 Embedding 模型；未配置或失败时使用**本地 512 维哈希向量**（子词哈希 + 带符号随机投影 + L2 归一化），零成本、离线可用。
- **查询构造**：当前章标题 + 细纲 + 节拍 + 上一章摘要 + 未回收伏笔名。
- **去重**：已被"最近章节"覆盖的命中不会重复注入。

## 4. 写后固化（每章自动）

`src/main/memory/memoryService.ts`

1. `summarizeChapter` → JSON：
   ```json
   {
     "summary": "200~350字",
     "keyEvents": ["人物+结果", "..."],
     "stateUpdates": [{"kind":"character","name":"...","content":"...","state":{"等级":"..."}}],
     "facts": ["不可违背的新事实"],
     "foreshadowPlanted": ["..."],
     "foreshadowResolved": ["..."],
     "nextHook": "..."
   }
   ```
2. 写入章节摘要与关键事件；
3. `stateUpdates` 与设定库中同名实体合并（浅合并 `state`，更新 `lastChapterNo`）；
4. `facts` 写入长期记忆表；
5. 伏笔自动登记 / 标记回收；
6. 写入向量索引；
7. 每 10 章滚动合并本卷摘要。

任一步骤失败都会降级（截断摘要 / 跳过索引），不阻断写作。

## 5. 一致性审校

`checkConsistency` 在写完后把 **事实清单**（锁定设定 + 相关人物状态 + 近 5 章摘要 + 待回收伏笔）与正文一起交给审校模型，输出：

```json
{"issues":[{"type":"setting|timeline|character|power|logic|repetition|style",
            "severity":"low|medium|high","description":"","evidence":"","suggestion":""}],
 "score": 0-100}
```

仅报告确定问题；`high` 级别触发自动修稿，修稿后重新摘要与索引。

## 6. 规模表现

| 规模 | 章节摘要 | 向量（512d float32） | 检索耗时 |
| --- | --- | --- | --- |
| 300 章 | ~90 KB | ~0.6 MB | < 20 ms |
| 1000 章 | ~300 KB | ~2 MB | < 50 ms |
| 3000 章 | ~900 KB | ~6 MB | < 150 ms |

摘要按章增量追加，不需要重算历史。切换 Embedding 模型后，可在「记忆 → 重建索引」一次性重建。

## 7. 可调参数

- `settings.writing.contextBudget`：总预算。
- `retrieve(topK=8)`：注入的长程记忆条数。
- 近章窗口：`context.ts` 中 `chapterNo - 8`。
- 卷摘要触发频率：`memoryService.ts` 中 `chapterNo % 10`。
- 篇幅不足补写阈值：`chapterWriter.ts` 中 `content.length < target * 0.6`。

## 8. 已知边界

- 本地哈希向量是**词形近似**，不是语义模型；配置 Embedding 后语义召回明显更好。
- 伏笔"计划回收章号"默认 +60 章，可在伏笔台账手动改。
- 多人称/多时间线作品，建议在设定库用 `timeline` 类型显式记录关键时间锚点。
