export function fmtTime(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function fmtWords(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`
  return String(n)
}

export function cnStatus(s: string): string {
  const m: Record<string, string> = {
    planned: '待写',
    drafted: '已生成',
    reviewed: '已审校',
    published: '已发布',
    pending: '待处理',
    success: '成功',
    failed: '失败',
    need_manual: '待人工',
    running: '进行中'
  }
  return m[s] || s
}

export function cnKind(k: string): string {
  const m: Record<string, string> = {
    world: '世界观',
    power: '力量体系',
    character: '人物',
    location: '地点',
    item: '道具',
    faction: '势力',
    rule: '硬设定',
    timeline: '大事记'
  }
  return m[k] || k
}

export function cnRole(r: string): string {
  const m: Record<string, string> = {
    publish: '发布',
    create_draft: '创建草稿',
    save_content: '保存正文',
    query: '查询',
    unknown: '未标注'
  }
  return m[r] || r
}
