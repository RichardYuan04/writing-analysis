// BlockNote 自定义 schema：在默认块基础上加 callout（提示框）和 citation（引用）
import {
  BlockNoteSchema, defaultBlockSpecs, defaultProps,
  defaultStyleSpecs, defaultInlineContentSpecs,
} from '@blocknote/core'
import { createReactBlockSpec } from '@blocknote/react'

// 在光标处插入一个块：当前是空段落则原地变身，否则插在其后
export function insertBlock(editor, type) {
  let cur
  try { cur = editor.getTextCursorPosition().block } catch { return }
  if (!cur) return
  const empty = cur.type === 'paragraph' && (!cur.content || cur.content.length === 0)
  try {
    if (empty) editor.updateBlock(cur, { type })
    else editor.insertBlocks([{ type }], cur, 'after')
  } catch { /* ignore */ }
}

// ── 自定义块：Callout 提示框 ──
const Callout = createReactBlockSpec(
  { type: 'callout', propSchema: { ...defaultProps }, content: 'inline' },
  {
    render: (props) => (
      <div className="rt-callout">
        <span className="rt-callout-ico" contentEditable={false}>💡</span>
        <div className="rt-callout-body" ref={props.contentRef} />
      </div>
    ),
  }
)

// ── 自定义块：Citation 引用 / 出处 ──
const Citation = createReactBlockSpec(
  { type: 'citation', propSchema: { ...defaultProps }, content: 'inline' },
  {
    render: (props) => (
      <blockquote className="rt-citation">
        <div className="rt-citation-body" ref={props.contentRef} />
      </blockquote>
    ),
  }
)

// 注意：BlockNote 0.51 的 createReactBlockSpec 返回的是「工厂函数」，必须调用一次才得到 spec
// 显式带上默认 styleSpecs（含 textColor/backgroundColor）与 inlineContentSpecs，确保颜色等行内样式不丢
export const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, callout: Callout(), citation: Citation() },
  styleSpecs: { ...defaultStyleSpecs },
  inlineContentSpecs: { ...defaultInlineContentSpecs },
})

// ── 斜杠菜单自定义项 ──
export const insertCallout = (editor) => ({
  title: 'Callout 提示框',
  subtext: '高亮一段提示',
  aliases: ['callout', '提示', 'tishi', 'tixingkuang'],
  group: '高级块',
  icon: <span style={{ fontSize: 16 }}>💡</span>,
  onItemClick: () => insertBlock(editor, 'callout'),
})

export const insertCitation = (editor) => ({
  title: 'Citation 引用',
  subtext: '引用 / 出处块',
  aliases: ['citation', '引用', 'yinyong', 'quote', 'chuchu'],
  group: '高级块',
  icon: <span style={{ fontSize: 16 }}>❝</span>,
  onItemClick: () => insertBlock(editor, 'citation'),
})

// ── 富文本 ↔ 纯文本 互转（纯文本用于分析/搜索/字数；分析链不变）──
function inlineToText(content) {
  if (!Array.isArray(content)) return ''
  return content
    .map((c) => (c.type === 'text' ? c.text : c.type === 'link' ? inlineToText(c.content) : ''))
    .join('')
}

export function blocksToPlainText(blocks) {
  if (!Array.isArray(blocks)) return ''
  const out = []
  const walk = (arr) =>
    arr.forEach((b) => {
      out.push(inlineToText(b.content))
      if (b.children && b.children.length) walk(b.children)
    })
  walk(blocks)
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function plainTextToBlocks(textInput) {
  const t = (textInput || '').replace(/\r\n/g, '\n')
  if (!t) return [{ type: 'paragraph', content: [] }]
  return t.split('\n').map((p) => ({
    type: 'paragraph',
    content: p ? [{ type: 'text', text: p, styles: {} }] : [],
  }))
}

// 安全解析存库的富文本 JSON；失败则回退用纯文本构块
export function parseRich(contentRich, plainFallback) {
  if (contentRich) {
    try {
      const blocks = JSON.parse(contentRich)
      if (Array.isArray(blocks) && blocks.length) return blocks
    } catch { /* 落回纯文本 */ }
  }
  return plainTextToBlocks(plainFallback || '')
}
