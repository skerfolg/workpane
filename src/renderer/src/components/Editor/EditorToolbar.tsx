import React from 'react'
import './EditorToolbar.css'

interface EditorToolbarProps {
  mode: 'wysiwyg' | 'source'
  onModeToggle: () => void
  onHideToolbar: () => void
  onBold?: () => void
  onItalic?: () => void
  onStrikethrough?: () => void
  onCode?: () => void
  onLink?: () => void
  onImage?: () => void
  onList?: () => void
  onCodeBlock?: () => void
}

function EditorToolbar({
  mode,
  onModeToggle,
  onHideToolbar,
  onBold,
  onItalic,
  onStrikethrough,
  onCode,
  onLink,
  onImage,
  onList,
  onCodeBlock
}: EditorToolbarProps): React.JSX.Element {
  return (
    <div className="editor-toolbar">
      <div className="editor-toolbar__actions">
        <button
          className="editor-toolbar__btn"
          title="Bold (Ctrl+B)"
          onClick={onBold}
          disabled={mode === 'source'}
        >
          <strong>B</strong>
        </button>
        <button
          className="editor-toolbar__btn editor-toolbar__btn--italic"
          title="Italic (Ctrl+I)"
          onClick={onItalic}
          disabled={mode === 'source'}
        >
          <em>I</em>
        </button>
        <button
          className="editor-toolbar__btn editor-toolbar__btn--strike"
          title="Strikethrough"
          onClick={onStrikethrough}
          disabled={mode === 'source'}
        >
          <s>S</s>
        </button>
        <button
          className="editor-toolbar__btn"
          title="Inline Code"
          onClick={onCode}
          disabled={mode === 'source'}
        >
          {'</>'}
        </button>
        <div className="editor-toolbar__separator" />
        <button
          className="editor-toolbar__btn"
          title="Link"
          onClick={onLink}
          disabled={mode === 'source'}
        >
          &#128279;
        </button>
        <button
          className="editor-toolbar__btn"
          title="Image"
          onClick={onImage}
          disabled={mode === 'source'}
        >
          &#128444;
        </button>
        <div className="editor-toolbar__separator" />
        <button
          className="editor-toolbar__btn"
          title="Bullet List"
          onClick={onList}
          disabled={mode === 'source'}
        >
          &#8226;&#8212;
        </button>
        <button
          className="editor-toolbar__btn"
          title="Code Block"
          onClick={onCodeBlock}
          disabled={mode === 'source'}
        >
          &#128196;
        </button>
      </div>
      <div className="editor-toolbar__right">
        <button
          className={`editor-toolbar__mode-toggle ${mode === 'source' ? 'active' : ''}`}
          title="Toggle WYSIWYG / Source"
          onClick={onModeToggle}
        >
          {mode === 'wysiwyg' ? 'Source' : 'WYSIWYG'}
        </button>
        <button
          className="editor-toolbar__btn editor-toolbar__btn--hide"
          title="Hide Toolbar"
          onClick={onHideToolbar}
        >
          &#9776;
        </button>
      </div>
    </div>
  )
}

export default EditorToolbar
