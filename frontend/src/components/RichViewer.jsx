import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { schema } from './richSchema'
import { useThemeMode } from './useThemeMode'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'

// 只读富文本渲染（详情页）。父组件用 key={essayId} 强制按文章重挂载。
export default function RichViewer({ blocks }) {
  const mode = useThemeMode()
  const editor = useCreateBlockNote({
    schema,
    initialContent: blocks && blocks.length ? blocks : undefined,
  })
  return <BlockNoteView editor={editor} editable={false} theme={mode} className="rich-viewer" />
}
