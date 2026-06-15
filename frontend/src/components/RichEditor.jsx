import { forwardRef, useImperativeHandle, useEffect, useState } from 'react'
import {
  useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems,
} from '@blocknote/react'
import { filterSuggestionItems } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import { schema, insertCallout, insertCitation, insertBlock } from './richSchema'
import { useThemeMode } from './useThemeMode'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'

// BlockNote 命名色（值由 BlockNote 内部样式决定；这里只给色板预览色）
const COLORS = [
  ['default', '默认', 'currentColor'],
  ['gray', '灰', '#9b9a97'], ['brown', '棕', '#a3704f'], ['red', '红', '#e03e3e'],
  ['orange', '橙', '#d9730d'], ['yellow', '黄', '#cfa70a'], ['green', '绿', '#4a9e8f'],
  ['blue', '蓝', '#3a8fc0'], ['purple', '紫', '#8a63c9'], ['pink', '粉', '#cc4d8f'],
]

// 顶栏下拉容器
function Drop({ id, label, menu, setMenu, width, children }) {
  const open = menu === id
  return (
    <span className="rt-drop">
      <button className="rt-tb" onClick={(e) => { e.stopPropagation(); setMenu(open ? null : id) }}>
        {label} <span className="rt-caret">▾</span>
      </button>
      {open && (
        <span className="rt-drop-menu" style={{ minWidth: width }} onClick={(e) => e.stopPropagation()}>
          {children}
        </span>
      )}
    </span>
  )
}

const RichEditor = forwardRef(function RichEditor({ initialContent, onChange, onSelectionChange }, ref) {
  const mode = useThemeMode()
  const [menu, setMenu] = useState(null)
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

  // 点击空白关闭下拉
  useEffect(() => {
    if (!menu) return
    const h = () => setMenu(null)
    document.addEventListener('click', h)
    return () => document.removeEventListener('click', h)
  }, [menu])

  const focusBack = () => { const v = view(); if (v) v.focus() }
  const curBlock = () => { try { return editor.getTextCursorPosition().block } catch { return null } }
  const setType = (type, props) => { const b = curBlock(); if (b) try { editor.updateBlock(b, { type, props }) } catch { /* ignore */ } focusBack() }
  const toggle = (styles) => { try { editor.toggleStyles(styles) } catch { /* ignore */ } focusBack() }
  const addStyle = (styles) => { try { editor.addStyles(styles) } catch { /* ignore */ } focusBack() }
  const removeStyle = (keys) => { try { editor.removeStyles(keys) } catch { /* ignore */ } focusBack() }
  const insBlock = (type) => { insertBlock(editor, type); focusBack() }
  const act = (fn) => { fn(); setMenu(null) }

  return (
    <div className="rich-wrap">
      <div className="rt-toolbar" onMouseDown={(e) => e.preventDefault()}>
        <Drop id="block" label="段落" menu={menu} setMenu={setMenu} width={120}>
          <button className="rt-mi" onClick={() => act(() => setType('paragraph'))}>正文</button>
          <button className="rt-mi" onClick={() => act(() => setType('heading', { level: 1 }))}>H1 一级标题</button>
          <button className="rt-mi" onClick={() => act(() => setType('heading', { level: 2 }))}>H2 二级标题</button>
          <button className="rt-mi" onClick={() => act(() => setType('heading', { level: 3 }))}>H3 三级标题</button>
        </Drop>

        <Drop id="list" label="列表" menu={menu} setMenu={setMenu} width={120}>
          <button className="rt-mi" onClick={() => act(() => setType('bulletListItem'))}>• 无序列表</button>
          <button className="rt-mi" onClick={() => act(() => setType('numberedListItem'))}>1. 有序列表</button>
          <button className="rt-mi" onClick={() => act(() => setType('checkListItem'))}>☑ 待办列表</button>
        </Drop>

        <span className="rt-tb-sep" />
        <button className="rt-tb rt-b" title="加粗" onClick={() => toggle({ bold: true })}>B</button>
        <button className="rt-tb rt-i" title="斜体" onClick={() => toggle({ italic: true })}>I</button>
        <button className="rt-tb rt-u" title="下划线" onClick={() => toggle({ underline: true })}>U</button>
        <button className="rt-tb rt-s" title="删除线" onClick={() => toggle({ strike: true })}>S</button>

        <span className="rt-tb-sep" />
        <Drop id="tcolor" label={<span><b style={{ fontFamily: 'var(--font-display)' }}>A</b> 文字色</span>} menu={menu} setMenu={setMenu} width={150}>
          <div className="rt-swatches">
            {COLORS.map(([key, name, css]) => (
              <button key={key} className="rt-swatch" title={name}
                onClick={() => act(() => (key === 'default' ? removeStyle({ textColor: '' }) : addStyle({ textColor: key })))}>
                <i style={{ color: css === 'currentColor' ? 'var(--text-primary)' : css }}>A</i>
              </button>
            ))}
          </div>
        </Drop>
        <Drop id="bcolor" label={<span><span className="rt-bgchip" /> 背景色</span>} menu={menu} setMenu={setMenu} width={150}>
          <div className="rt-swatches">
            {COLORS.map(([key, name, css]) => (
              <button key={key} className="rt-swatch" title={name}
                onClick={() => act(() => (key === 'default' ? removeStyle({ backgroundColor: '' }) : addStyle({ backgroundColor: key })))}>
                <i className="rt-swatch-bg" style={{ background: css === 'currentColor' ? 'transparent' : css, borderColor: css === 'currentColor' ? 'var(--border)' : css }} />
              </button>
            ))}
          </div>
        </Drop>

        <span className="rt-tb-sep" />
        <button className="rt-tb" title="引用" onClick={() => insBlock('citation')}>❝ 引用</button>
        <button className="rt-tb" title="提示框" onClick={() => insBlock('callout')}>💡 Callout</button>
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
