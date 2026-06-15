import { forwardRef, useImperativeHandle, useEffect } from 'react'
import {
  useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems,
} from '@blocknote/react'
import { filterSuggestionItems } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import { schema, insertCallout, insertCitation, insertBlock } from './richSchema'
import { useThemeMode } from './useThemeMode'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'

/**
 * 可编辑富文本编辑器（BlockNote）。
 * props:
 *  - initialContent: 块数组（仅首次挂载生效）
 *  - onChange(blocks)
 *  - onSelectionChange({text, from, to, context} | null)   ≥4 字才上报
 * ref 暴露：getDoc / setBlocks / replaceRange / snapshot / restore / focus
 */
const RichEditor = forwardRef(function RichEditor({ initialContent, onChange, onSelectionChange }, ref) {
  const mode = useThemeMode()
  const editor = useCreateBlockNote({
    schema,
    initialContent: initialContent && initialContent.length ? initialContent : undefined,
  })

  const view = () => editor.prosemirrorView || editor._tiptapEditor?.view

  useImperativeHandle(ref, () => ({
    getDoc: () => editor.document,
    setBlocks: (blocks) => {
      const next = blocks && blocks.length ? blocks : [{ type: 'paragraph', content: [] }]
      try { editor.replaceBlocks(editor.document, next) } catch { /* ignore */ }
    },
    replaceRange: (from, to, txt) => {
      const v = view(); if (!v) return
      v.dispatch(v.state.tr.insertText(txt, from, to))
      v.focus()
    },
    snapshot: () => JSON.parse(JSON.stringify(editor.document)),
    restore: (snap) => { if (snap) try { editor.replaceBlocks(editor.document, snap) } catch { /* ignore */ } },
    focus: () => { const v = view(); if (v) v.focus() },
  }), [editor])

  // 选区上报（给写作工具）
  useEffect(() => {
    if (!onSelectionChange) return
    const handler = () => {
      const v = view(); if (!v) return
      const { from, to } = v.state.selection
      const text = v.state.doc.textBetween(from, to, '\n')
      if (text.trim().length >= 4) {
        const size = v.state.doc.content.size
        const before = v.state.doc.textBetween(Math.max(0, from - 60), from, '\n')
        const after = v.state.doc.textBetween(to, Math.min(size, to + 60), '\n')
        onSelectionChange({ text, from, to, context: [before.trim(), after.trim()].filter(Boolean).join(' … ') })
      } else {
        onSelectionChange(null)
      }
    }
    const unsub = editor.onSelectionChange(handler)
    return () => { if (typeof unsub === 'function') unsub() }
  }, [editor, onSelectionChange])

  // ── 顶栏工具：作用于当前块 / 选区 ──
  const curBlock = () => { try { return editor.getTextCursorPosition().block } catch { return null } }
  const setType = (type, props) => { const b = curBlock(); if (b) try { editor.updateBlock(b, { type, props }) } catch { /* ignore */ } }
  const toggle = (styles) => { try { editor.toggleStyles(styles) } catch { /* ignore */ } const v = view(); if (v) v.focus() }
  const insBlock = (type) => insertBlock(editor, type)

  return (
    <div className="rich-wrap">
      <div className="bn-toolbar" onMouseDown={(e) => e.preventDefault()}>
        <button className="bn-tb" title="正文" onClick={() => setType('paragraph')}>正文</button>
        <button className="bn-tb" title="一级标题" onClick={() => setType('heading', { level: 1 })}>H1</button>
        <button className="bn-tb" title="二级标题" onClick={() => setType('heading', { level: 2 })}>H2</button>
        <button className="bn-tb" title="三级标题" onClick={() => setType('heading', { level: 3 })}>H3</button>
        <span className="bn-tb-sep" />
        <button className="bn-tb bn-b" title="加粗" onClick={() => toggle({ bold: true })}>B</button>
        <button className="bn-tb bn-i" title="斜体" onClick={() => toggle({ italic: true })}>I</button>
        <button className="bn-tb bn-s" title="删除线" onClick={() => toggle({ strike: true })}>S</button>
        <button className="bn-tb bn-u" title="下划线" onClick={() => toggle({ underline: true })}>U</button>
        <span className="bn-tb-sep" />
        <button className="bn-tb" title="无序列表" onClick={() => setType('bulletListItem')}>• 列表</button>
        <button className="bn-tb" title="有序列表" onClick={() => setType('numberedListItem')}>1. 列表</button>
        <button className="bn-tb" title="引用" onClick={() => insBlock('citation')}>❝ 引用</button>
        <button className="bn-tb" title="提示框" onClick={() => insBlock('callout')}>💡 Callout</button>
      </div>

      <BlockNoteView
        editor={editor}
        editable
        theme={mode}
        slashMenu={false}
        onChange={() => onChange && onChange(editor.document)}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            filterSuggestionItems(
              [...getDefaultReactSlashMenuItems(editor), insertCallout(editor), insertCitation(editor)],
              query
            )
          }
        />
      </BlockNoteView>
    </div>
  )
})

export default RichEditor
