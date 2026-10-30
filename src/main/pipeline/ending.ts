/**
 * 完结判断：在达到目标章数后，根据剧情完成度决定是否收尾，
 * 而不是机械地按数字停止。
 */
import type { EndingJudgement } from '@shared/types'
import { chat, extractJson } from '../llm/client'
import * as P from '../llm/prompts'
import { loadSettings } from '../settings'
import { bookRepo, chapterRepo, foreshadowRepo } from '../db/repo'
import { volumeOfChapter } from './bookForge'

export async function judgeEnding(bookId: string): Promise<EndingJudgement> {
  const book = bookRepo.get(bookId)
  if (!book) throw new Error('书籍不存在')
  const all = chapterRepo.list(bookId).filter((c) => c.summary.trim())
  const recent = all
    .slice(-12)
    .map((c) => `第${c.chapterNo}章 ${c.title}：${c.summary}`)
    .join('\n')
  const open = foreshadowRepo.open(bookId).map((f) => f.name)
  const lastNo = all.at(-1)?.chapterNo || 1
  const { node } = volumeOfChapter(bookId, lastNo)

  const res = await chat(
    loadSettings().model,
    [
      { role: 'system', content: P.endingJudgeSystem() },
      {
        role: 'user',
        content: P.endingJudgeUserPrompt({
          title: book.title,
          writtenChapters: chapterRepo.count(bookId),
          targetChapters: book.targetChapters,
          recent,
          openForeshadowing: open,
          volumeGoal: node?.goal || ''
        })
      }
    ],
    { purpose: 'judge', temperature: 0.2, maxTokens: 1200, json: true }
  )
  const data = extractJson<Partial<EndingJudgement>>(res.content)
  return {
    complete: data.complete === true,
    reason: data.reason || '',
    missing: Array.isArray(data.missing) ? data.missing.slice(0, 8).map(String) : [],
    suggestChapters: Number(data.suggestChapters) || 0
  }
}
