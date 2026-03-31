import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({
  gfm: true,
  breaks: true,
})

/**
 * 将助手气泡中的 Markdown 转为安全 HTML（表格、标题、列表等）。
 */
export function assistantMarkdownToHtml(markdown: string): string {
  const md = markdown.trim()
  if (!md) return ''
  let html: string
  try {
    html = marked.parse(md, { async: false }) as string
  } catch {
    // 极端 malformed 输入避免整页渲染崩溃
    const esc = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return `<p class="text-outline-variant text-sm">（Markdown 解析失败，已按纯文本显示）</p><pre class="whitespace-pre-wrap text-sm">${esc}</pre>`
  }
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'em',
      'u',
      's',
      'h1',
      'h2',
      'h3',
      'h4',
      'ul',
      'ol',
      'li',
      'blockquote',
      'code',
      'pre',
      'a',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'hr',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
  })
}
