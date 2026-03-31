/**
 * 展示层清理：与后端 stream-thinking 行为对齐，兼容已写入数据库的脏数据。
 */

function isProbableMetaParagraph(para: string): boolean {
  const t = para.trim()
  if (t.length < 12) return false
  const patterns = [
    /^用户(只是)?说/,
    /^用户只是/,
    /^根据系统提示/,
    /^根据本轮/,
    /^根据[^。\n]{0,30}提示/,
    /^对于这种(简单)?的?问候/,
    /^对于这种/,
    /^我需要(友好|先|根据)/,
    /^我可以(友好|先|根据)/,
    /^我应该(友好|先|根据)/,
    /^让我(先|来|尝试)/,
    /^首先[，,]我(需要|要|来)/,
    /^作为(一个)?(AI|数字)/,
    /^我是Digital\s*Curator/,
    /^当前没有有效的/,
    /^目前没有有效的/,
    /^没有有效的参考资料/,
    /^本轮附带/,
    /^资料不足[,，]/,
    /^没有具体的问题/,
    /^没有具体问题/,
    /^这是一个简单/,
    /^这是(一个)?简单/,
    /^同时介绍我的身份/,
    /^并介绍我的身份/,
  ]
  return patterns.some((re) => re.test(t))
}

function stripLeadingMetaFromCompleteBlock(block: string): string {
  let i = 0
  const len = block.length
  while (i < len) {
    const d = block.indexOf('\n\n', i)
    const pe = d === -1 ? len : d
    const para = block.slice(i, pe)
    if (d === -1) {
      return isProbableMetaParagraph(para) ? '' : block.slice(i).trimStart()
    }
    if (!isProbableMetaParagraph(para)) {
      return block.slice(i).trimStart()
    }
    i = d
    while (i < len && block[i] === '\n') i++
  }
  return ''
}

function truncateUnclosedThinkMarkers(s: string): string {
  const candidates: Array<{ open: string; close: string }> = [
    { open: '```think', close: '```' },
    { open: '`think`', close: '`/think`' },
    { open: '\u003cthink\u003e', close: '\u003c/think\u003e' },
  ]
  let cutEnd = s.length
  for (const { open, close } of candidates) {
    const i = s.indexOf(open)
    if (i === -1) continue
    const after = s.slice(i + open.length)
    if (!after.includes(close)) {
      cutEnd = Math.min(cutEnd, i)
    }
  }
  return cutEnd < s.length ? s.slice(0, cutEnd) : s
}

export function stripAssistantLeakForDisplay(text: string): string {
  let s = text
  s = s.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
  s = s.replace(/```\s*think\s*[\s\S]*?```/gi, '')
  s = s.replace(/`think`[\s\S]*?`\/think`/gi, '')
  s = truncateUnclosedThinkMarkers(s)
  s = stripLeadingMetaFromCompleteBlock(s)
  return s.trimStart()
}
