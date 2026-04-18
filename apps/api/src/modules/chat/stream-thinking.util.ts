/**
 * 过滤模型泄漏的思考内容：XML think 标签、Markdown think 围栏、反引号 think 段、中文元话语段落。
 */

const THINK_OPEN = '\u003cthink\u003e'
const THINK_CLOSE = '\u003c/think\u003e'

/** 反引号 + think + 反引号 */
const BT_THINK_OPEN = '`think`'
const BT_THINK_CLOSE = '`/think`'
const FENCE3 = '```'

const BLOCK_PATTERNS = [
  /<think\b[^>]*>[\s\S]*?<\/think>/gi,
  /\u003cThink\b[^>]*>[\s\S]*?<\/Think>/gi,
  new RegExp(FENCE3 + '\\s*think\\s*[\\s\\S]*?' + FENCE3, 'gi'),
  /`think`[\s\S]*?`\/think`/gi,
]

function stripCompleteThinkingBlocks(s: string): string {
  let out = s
  for (const re of BLOCK_PATTERNS) {
    out = out.replace(re, '')
  }
  return out
}

/** 去掉未闭合的思考起始（流式中途）：从最早出现的未闭合标记起截断到文首之前 */
function truncateUnclosedThinking(s: string): string {
  const candidates: Array<{ open: string; close: string }> = [
    { open: FENCE3 + 'think', close: FENCE3 },
    { open: BT_THINK_OPEN, close: BT_THINK_CLOSE },
    { open: THINK_OPEN, close: THINK_CLOSE },
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

/** 一整段是否像「对提示/用户的分析」而非对用户说的话 */
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

/**
 * 从「仅含完整段落（以 \n\n 分隔）」的文本中去掉开头的元话语段，保留其后正文。
 * 最后一段若无 \n\n 结尾，应放在 streaming 的 incomplete 分支处理，勿传入本函数作为多段 block。
 */
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

/**
 * 不完整尾部是否**可能**发展为元话语（流式时先不展示）。
 * 避免用「没有」等过短词误伤正常回答（如「没有问题」）。
 */
export function mightBeMetaPrefix(s: string): boolean {
  const t = s.trimStart()
  if (t.length === 0) return true

  const stems = [
    '用户只是',
    '根据系统',
    '对于这种',
    '我需要',
    '我可以',
    '我应该',
    '让我',
    '首先，',
    '首先,',
    '作为一个',
    '作为AI',
    '我是Digital',
    '当前没有',
    '目前没有',
    '本轮',
    '资料不足',
    '没有有效的',
    '没有具体',
    '这是一个简单',
    '同时介绍我',
    '并介绍我',
  ]

  if (stems.some((p) => p.startsWith(t) && t.length < p.length)) return true
  if (stems.some((p) => t.startsWith(p)) && isProbableMetaParagraph(t)) return true
  return false
}

function afterThinkTags(raw: string): string {
  let out = stripCompleteThinkingBlocks(raw)
  out = truncateUnclosedThinking(out)
  return out
}

/** 流式：隐藏 think 标签 + 完整元段 +「可能为元话语的」未完成尾部 */
function computeVisibleStreaming(raw: string): string {
  const t = afterThinkTags(raw)
  const lastDouble = t.lastIndexOf('\n\n')
  if (lastDouble === -1) {
    return mightBeMetaPrefix(t) ? '' : t
  }
  const completePart = t.slice(0, lastDouble)
  const incompletePart = t.slice(lastDouble + 2)
  const strippedComplete = stripLeadingMetaFromCompleteBlock(completePart)
  if (mightBeMetaPrefix(incompletePart)) {
    return strippedComplete.replace(/\n+$/g, '')
  }
  if (!strippedComplete) return incompletePart
  return `${strippedComplete}\n\n${incompletePart}`
}

/** 结束：整段当作完整文本剥离元话语 */
function computeVisibleFinal(raw: string): string {
  const t = afterThinkTags(raw)
  return stripLeadingMetaFromCompleteBlock(t).trim()
}

export function visibleFromRawAssistant(raw: string, streamEnded = true): string {
  return streamEnded ? computeVisibleFinal(raw) : computeVisibleStreaming(raw)
}

/** MiniMax 流式里 delta.content 常为「累积全文」，需按前缀差分；标准 OpenAI 为增量片段。 */
export type ChatStreamContentDeltaState = { last: string; minimax: boolean }

export function extractStreamContentDelta(delta: any, st: ChatStreamContentDeltaState): string {
  const d = delta?.content
  if (typeof d !== 'string' || !d) return ''
  if (!st.minimax) return d
  if (st.last && d.startsWith(st.last)) {
    const piece = d.slice(st.last.length)
    st.last = d
    return piece
  }
  st.last = (st.last || '') + d
  return d
}

export function createAssistantVisibleStreamFilter() {
  let lastVisible = ''
  return {
    pushFromAccumulated(rawAccumulated: string): string {
      const visible = computeVisibleStreaming(rawAccumulated)
      const delta = visible.slice(lastVisible.length)
      lastVisible = visible
      return delta
    },
    finalize(rawFull: string): string {
      const out = computeVisibleFinal(rawFull)
      lastVisible = out
      return out
    },
  }
}
