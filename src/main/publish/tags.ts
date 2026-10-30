/**
 * 番茄小说「阅读标签」词表与自动选标签。
 *
 * 词表快照：2026-10-26，从番茄作家后台「阅读标签」弹窗逐项抄录。
 * 平台会调整词表；若出现未收录的新标签，normalizeTagPick 会丢弃，避免写入平台不存在的值。
 *
 * 平台硬约束：主分类必选且只能 1 个；主题 / 角色 / 情节 各最多 2 个；签约后不可修改。
 */
import type { Book, FanqieTagPick } from '@shared/types'
import { chat, extractJson } from '../llm/client'
import { loadSettings } from '../settings'

export const FANQIE_TAG_SNAPSHOT = '2026-10-26'

/** 长篇「阅读标签」词表：主分类 1 个，主题/角色/情节各最多 2 个 */
export const NOVEL_TAGS: Record<'main' | 'theme' | 'character' | 'plot', string[]> = {
  main: [
    '西方奇幻', '东方仙侠', '科幻末世', '男频衍生', '都市高武', '悬疑灵异', '悬疑脑洞', '抗战谍战',
    '历史古代', '历史脑洞', '都市种田', '都市脑洞', '都市日常', '玄幻脑洞', '战神赘婿', '动漫衍生',
    '游戏体育', '传统玄幻', '都市修真', '武侠'
  ],
  theme: [
    '衍生', '仕途', '综影视', '天灾', '第一人称', '赛博朋克', '第四天灾', '规则怪谈', '搞笑轻松',
    '古代', '悬疑', '克苏鲁', '都市异能', '末日求生', '灵气复苏', '高武世界', '异世大陆', '东方玄幻',
    '谍战', '清明', '宋朝', '断层', '武将', '国运', '综漫', '开局', '架空', '奇幻仙侠', '都市',
    '玄幻', '历史', '体育'
  ],
  character: [
    '多女主', '赘婿', '全能', '大佬', '大小姐', '特工', '游戏主播', '神探', '贵族', '皇帝',
    '单女主', '校花', '无女主', '女帝', '特种兵', '反派', '神医', '奶爸', '学霸', '天才',
    '腹黑', '扮猪吃虎'
  ],
  plot: [
    '都市江湖', '风水秘术', '斩神衍生', '十日衍生', '西游衍生', '公版衍生', '红楼衍生', '甄嬛衍生',
    '如懿衍生', '惊悚游戏', '卡牌', '山海经', '捉鬼', '剑修', '废土', '副本', '黑科技', '无脑爽',
    '魂穿', '高手下山', '黑化', '迪化', '发家致富', '无后宫', '争霸', '1v1', '升级流', '灵魂互换',
    '科举', '封神', '四合院', '电竞', '双重生', '乡村', '同人', '打脸', '破案', '囤物资', '钓鱼',
    '网游', '奥特同人', '求生', '无敌', '民国', '九叔', '穿书', '聊天群', '大秦', '龙珠', '漫威',
    '神奇宝贝', '海贼', '火影', '职场', '明朝', '家庭', '三国', '末世', '直播', '无限流', '诸天万界',
    '大唐', '宠物', '外卖', '星际', '美食', '剑道', '盗墓', '灵异', '鉴宝', '系统', '神豪', '重生',
    '穿越', '二次元', '海岛', '娱乐圈', '空间', '推理', '洪荒'
  ]
}

/**
 * 短故事「短故事分类」词表：主分类必选，合计最多 8 个。
 * 分组：情节 / 角色 / 情绪 / 背景。
 */
export const SHORT_TAGS: Record<'main' | 'plot' | 'character' | 'emotion' | 'background', string[]> = {
  main: [
    '婚姻家庭', '女生生活', '男生生活', '现言甜宠', '虐心婚恋', '青春虐恋', '男生情感', '女性成长',
    '悬疑惊悚', '玄幻仙侠', '宫斗宅斗', '男频衍生', '女频衍生', '年代', '纯爱', '其他',
    '古言甜宠', '古风世情', '都市日常', '男频脑洞', '女频脑洞', '民国旧影', '古言虐恋', '历史古代'
  ],
  plot: [
    '追妻火葬场', '追夫火葬场', '真假千金', '先婚后爱', '打脸逆袭', '破镜重圆', '系统', '金手指',
    '大女主', '女性互助', '穿越', '重生', '暗恋', '婚恋', '权谋', '架空', '养崽文', '团宠',
    '无限流', '末日求生', '游戏动漫', '规则怪谈', '民间奇闻', '影视', '科幻', '推理', '直播',
    '升级流', '外卖', '鉴宝', '黑道', '都市江湖', '都市异能', '仕途'
  ],
  character: [
    '白月光', '霸总', '婆媳', '青梅竹马', '姐弟恋', '凤凰男', '校花校草', '女配', '医生', '替身',
    '病娇', '赘婿', '校霸', '影帝影后', '萌宝', '糙汉', '万人迷', '女总裁', '奶爸', '神医',
    '特种兵', '首富', '魔法', '吸血鬼', '欧美帮派', '狼人'
  ],
  emotion: [
    '先虐后甜', '甜宠', '虐文', '爽文', '救赎', '惊悚', '励志', '沙雕搞笑'
  ],
  background: [
    '家庭', '职场', '校园', '娱乐圈', '现代', '古代', '豪门世家', '西幻魔法', '西方古典', '西方现代'
  ]
}

/** 兼容旧引用：长篇词表 */
export const FANQIE_TAGS = NOVEL_TAGS

export const TAG_LIMITS = { main: 1, theme: 2, character: 2, plot: 2 } as const
export const SHORT_TAG_TOTAL = 8

export const EMPTY_TAG_PICK: FanqieTagPick = { main: '', theme: [], character: [], plot: [], emotion: [], background: [] }

/** 按作品形态取词表 */
export function tagVocabulary(mode: 'novel' | 'short'): Record<string, string[]> {
  return mode === 'short' ? (SHORT_TAGS as unknown as Record<string, string[]>) : (NOVEL_TAGS as unknown as Record<string, string[]>)
}

/**
 * 校验并裁剪。
 * 长篇：主分类 1 个，主题/角色/情节各 ≤2。
 * 短故事：主分类 1 个，情节/角色/情绪/背景 合计 ≤8（含主分类）。
 * 只保留词表内标签，越界与重复一律丢弃。
 */
export function normalizeTagPick(
  raw: Partial<FanqieTagPick> | null | undefined,
  mode: 'novel' | 'short' = 'novel'
): FanqieTagPick {
  const vocab = tagVocabulary(mode)
  const clean = (v: unknown, group: string, limit: number): string[] => {
    const allowed = vocab[group] || []
    const list = Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []
    const out: string[] = []
    for (const name of list) {
      if (!allowed.includes(name) || out.includes(name)) continue
      out.push(name)
      if (out.length >= limit) break
    }
    return out
  }

  if (mode === 'short') {
    const mainArr = clean(raw && raw.main ? [raw.main] : [], 'main', 1)
    const main = mainArr[0] || ''
    let budget = SHORT_TAG_TOTAL - (main ? 1 : 0)
    const take = (v: unknown, group: string): string[] => {
      if (budget <= 0) return []
      const got = clean(v, group, budget)
      budget -= got.length
      return got
    }
    const plot = take(raw && raw.plot, 'plot')
    const character = take(raw && raw.character, 'character')
    const emotion = take(raw && raw.emotion, 'emotion')
    const background = take(raw && raw.background, 'background')
    return { main, theme: [], character, plot, emotion, background, mode: 'short' }
  }

  const mainArr = clean(raw && raw.main ? [raw.main] : [], 'main', 1)
  return {
    main: mainArr[0] || '',
    theme: clean(raw && raw.theme, 'theme', TAG_LIMITS.theme),
    character: clean(raw && raw.character, 'character', TAG_LIMITS.character),
    plot: clean(raw && raw.plot, 'plot', TAG_LIMITS.plot),
    emotion: [],
    background: [],
    mode: 'novel'
  }
}

/** 本地兜底：模型不可用时按书名/简介/标签关键词粗略匹配 */
export function guessTagPickLocal(
  book: Pick<Book, 'title' | 'synopsis' | 'genre' | 'tags'>,
  mode: 'novel' | 'short' = 'novel'
): FanqieTagPick {
  const vocab = tagVocabulary(mode)
  const text = [book.title, book.synopsis, book.genre, (book.tags || []).join(' ')].join(' ')
  const hit = (group: string): string[] => (vocab[group] || []).filter((x) => x && text.includes(x))

  let main = hit('main')[0] || ''
  if (!main) {
    if (mode === 'short') {
      if (/婚|嫁|娶|妻|夫|离婚|婚姻/.test(text)) main = '婚姻家庭'
      else if (/悬疑|惊悚|鬼|凶|案|尸/.test(text)) main = '悬疑惊悚'
      else if (/爱|恋|甜|宠/.test(text)) main = '现言甜宠'
      else if (/古|宫|侯|妃|王朝/.test(text)) main = '古风世情'
      else main = '都市日常'
    } else if (/悬疑|惊悚|鬼|凶|案|尸/.test(text)) main = '悬疑灵异'
    else if (/修仙|仙侠|剑|宗门|元婴/.test(text)) main = '东方仙侠'
    else if (/末世|丧尸|废土|灾变/.test(text)) main = '科幻末世'
    else if (/历史|王朝|大明|大唐|三国/.test(text)) main = '历史古代'
    else if (/仙|神|魔|妖|灵气/.test(text)) main = '传统玄幻'
    else main = '都市日常'
  }

  if (mode === 'short') {
    return normalizeTagPick(
      { main, plot: hit('plot'), character: hit('character'), emotion: hit('emotion'), background: hit('background') },
      'short'
    )
  }
  return normalizeTagPick({ main, theme: hit('theme'), character: hit('character'), plot: hit('plot') }, 'novel')
}

/** 让模型按番茄词表选标签；结果一定通过 normalizeTagPick 校验 */
export async function suggestFanqieTags(book: Book): Promise<FanqieTagPick> {
  const settings = loadSettings().model
  const mode: 'novel' | 'short' = book.workType === 'short' ? 'short' : 'novel'
  const vocab = tagVocabulary(mode)
  const concept = book.concept
  const materials = [
    `【书名】${book.title}`,
    `【类型】${book.genre || '未填'}`,
    `【简介】${book.synopsis || '无'}`,
    `【现有标签】${(book.tags || []).join('、') || '无'}`,
    concept ? `【主角】${concept.protagonist}｜【金手指】${concept.goldenFinger}｜【开篇钩子】${concept.hook}` : '',
    `【作品形态】${mode === 'short' ? '短故事' : '长篇小说'}`
  ]
    .filter(Boolean)
    .join('\n')

  const groups = mode === 'short' ? ['main', 'plot', 'character', 'emotion', 'background'] : ['main', 'theme', 'character', 'plot']
  const labels: Record<string, string> = {
    main: '主分类',
    theme: '主题',
    character: '角色',
    plot: '情节',
    emotion: '情绪',
    background: '背景'
  }

  const rules =
    mode === 'short'
      ? ['主分类必选且只能 1 个；其余分组合计最多 8 个（含主分类），每组可以少选或不选。']
      : ['主分类必选且只能 1 个；主题、角色、情节各最多 2 个，可以少选或不选。']

  const system = [
    mode === 'short'
      ? '你在番茄小说作家后台给短故事选「短故事分类」，必须严格从给定词表中选，不能自造。'
      : '你在番茄小说作家后台给作品选「阅读标签」，必须严格从给定词表中选，不能自造。',
    ...rules,
    '判断依据：书名、简介、现有标签、主角与金手指，优先选最贴合作品实际内容的。',
    '不要为了凑数而选；没有贴切的就留空数组。',
    '只输出 JSON，不要解释。',
    ...groups.map((g) => `【${labels[g]}候选】${(vocab[g] || []).join('、')}`),
    'JSON 结构：' + JSON.stringify(Object.fromEntries(groups.map((g) => [g, g === 'main' ? '' : []])))
  ].join('\n')

  try {
    const res = await chat(
      settings,
      [
        { role: 'system', content: system },
        { role: 'user', content: materials }
      ],
      { purpose: 'planner', temperature: 0.2, maxTokens: 700, json: true, timeoutMs: 60000, retries: 2 }
    )
    const raw = extractJson<Partial<FanqieTagPick>>(res.content)
    const pick = normalizeTagPick(raw, mode)
    if (!pick.main) pick.main = guessTagPickLocal(book, mode).main
    return pick
  } catch (err) {
    console.warn('[tags] AI 选标签失败，使用本地兜底', err)
    return guessTagPickLocal(book, mode)
  }
}
