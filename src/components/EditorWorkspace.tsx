import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { type Monaco } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { ArrowLeft, ArrowRight, Check, ChevronDown, CircleAlert, FilePlus2, FolderPlus, FolderSearch, Menu, PanelBottomClose, PanelBottomOpen, PanelLeftClose, PanelLeftOpen, Play, RefreshCw, Settings, Trash2, X } from 'lucide-react'
import type { FileNode, Project, SourceLocation, ToolchainInfo } from '../types'
import Logo from './Logo'
import FileTree from './FileTree'
import PdfViewer, { type PdfPoint, type PdfSyncTarget } from './PdfViewer'

interface Props {
  project: Project
  toolchain: ToolchainInfo | null
  onBack(): void
  onProject(next: Project): void
  notify(kind: 'success' | 'error', message: string): void
}

type OpenFile = { path: string; content: string; saved: string }

export default function EditorWorkspace({ project, toolchain, onBack, onProject, notify }: Props) {
  const [tree, setTree] = useState<FileNode[]>([])
  const [tabs, setTabs] = useState<OpenFile[]>([])
  const [active, setActive] = useState<string>()
  const [pdf, setPdf] = useState<string | null>(null)
  const [compiling, setCompiling] = useState(false)
  const [log, setLog] = useState('')
  const [compileFailed, setCompileFailed] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [compileMenu, setCompileMenu] = useState(false)
  const [settings, setSettings] = useState(false)
  const [createDialog, setCreateDialog] = useState(false)
  const [context, setContext] = useState<{ node: FileNode; x: number; y: number } | null>(null)
  const [fileWidth, setFileWidth] = useState(224)
  const [editorRatio, setEditorRatio] = useState(52)
  const [filesVisible, setFilesVisible] = useState(() => localStorage.getItem('texly:file-panel') !== 'hidden')
  const [pdfPoint, setPdfPoint] = useState<PdfPoint | null>(null)
  const [pdfSyncTarget, setPdfSyncTarget] = useState<PdfSyncTarget | null>(null)
  const [syncing, setSyncing] = useState(false)
  const saveTimer = useRef<number>()
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const current = tabs.find(t => t.path === active)

  const refreshTree = useCallback(async () => setTree(await window.texly.files.tree(project.id)), [project.id])
  useEffect(() => { refreshTree(); openFile(project.mainTex); loadPdf() }, [project.id])
  useEffect(() => { const handler = (e: KeyboardEvent) => { if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveNow() } }; addEventListener('keydown', handler); return () => removeEventListener('keydown', handler) }, [current])
  useEffect(() => () => window.clearTimeout(saveTimer.current), [])

  async function openFile(path: string) {
    if (!isText(path)) return notify('error', '该文件不能在文本编辑器中打开')
    setActive(path)
    if (!tabs.some(t => t.path === path)) {
      try { const content = await window.texly.files.read(project.id, path); setTabs(prev => [...prev, { path, content, saved: content }]) }
      catch (err) { notify('error', message(err)) }
    }
  }
  function closeTab(path: string) {
    const index = tabs.findIndex(t => t.path === path); const next = tabs.filter(t => t.path !== path); setTabs(next)
    if (active === path) setActive(next[Math.max(0, index - 1)]?.path)
  }
  async function saveNow() {
    if (!current || current.content === current.saved) return
    await window.texly.files.write(project.id, current.path, current.content)
    setTabs(prev => prev.map(t => t.path === current.path ? { ...t, saved: t.content } : t))
  }
  function changeContent(value = '') {
    if (!active) return
    setTabs(prev => prev.map(t => t.path === active ? { ...t, content: value } : t))
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(async () => {
      await window.texly.files.write(project.id, active, value)
      setTabs(prev => prev.map(t => t.path === active ? { ...t, saved: value } : t))
    }, 700)
  }
  function toggleFiles() {
    setFilesVisible(value => {
      const next = !value
      localStorage.setItem('texly:file-panel', next ? 'visible' : 'hidden')
      return next
    })
  }
  async function compile(clean = false) {
    setCompileMenu(false); await saveNow(); setCompiling(true); setLogOpen(false)
    try {
      const result = await window.texly.compile.run(project.id, clean); setLog(result.log); setCompileFailed(!result.success)
      if (result.success) { await loadPdf(); notify('success', clean ? '已清理并重新编译' : 'PDF 编译完成') }
      else { setLogOpen(true); notify('error', result.missingToolchain ? '请先配置 LaTeX 编译环境' : '编译失败，请查看日志') }
    } catch (err) { setLog(message(err)); setCompileFailed(true); setLogOpen(true); notify('error', '编译进程未能启动') }
    finally { setCompiling(false) }
  }
  async function loadPdf() { setPdf(await window.texly.compile.pdf(project.id)) }
  async function downloadPdf() {
    try {
      const saved = await window.texly.compile.savePdf(project.id)
      if (saved) notify('success', `PDF 已保存到 ${saved}`)
    } catch (err) { notify('error', message(err)) }
  }
  async function syncSourceToPdf() {
    if (!active || !/\.tex$/i.test(active)) return notify('error', '请先在 TeX 编辑器中选择位置')
    const position = editorRef.current?.getPosition()
    if (!position) return notify('error', '编辑器中没有可同步的位置')
    setSyncing(true)
    try {
      await saveNow()
      const target = await window.texly.compile.syncForward(project.id, active, position.lineNumber, position.column)
      if (!target) return notify('error', '找不到 SyncTeX 映射，请先重新编译项目')
      setPdfSyncTarget({ ...target, requestId: Date.now() })
    } catch (err) { notify('error', message(err)) }
    finally { setSyncing(false) }
  }
  async function syncPdfToSource() {
    if (!pdfPoint) return notify('error', '请先在 PDF 中点击或选择一段文字')
    setSyncing(true)
    try {
      const target = await window.texly.compile.syncReverse(project.id, pdfPoint.page, pdfPoint.x, pdfPoint.y)
      if (!target) return notify('error', '该 PDF 位置没有对应的源码，请重新编译后再试')
      await openFile(target.path)
      focusSource(target)
    } catch (err) { notify('error', message(err)) }
    finally { setSyncing(false) }
  }
  function focusSource(target: SourceLocation, attempt = 0) {
    window.setTimeout(() => {
      const editor = editorRef.current
      const modelPath = decodeURIComponent(editor?.getModel()?.uri.path || '').replaceAll('\\', '/')
      if ((!modelPath.endsWith(target.path) || !editor) && attempt < 8) return focusSource(target, attempt + 1)
      if (!editor) return
      const column = Math.max(1, target.column)
      editor.setPosition({ lineNumber: target.line, column })
      editor.setSelection({ startLineNumber: target.line, startColumn: column, endLineNumber: target.line, endColumn: column })
      editor.revealLineInCenter(target.line)
      editor.focus()
    }, attempt ? 35 : 70)
  }
  async function updateProject(patch: Partial<Pick<Project, 'mainTex' | 'compiler'>>) {
    try { onProject(await window.texly.projects.update(project.id, patch)) }
    catch (err) { notify('error', message(err)) }
  }
  async function removeNode(node: FileNode) {
    if (!confirm(`确定删除“${node.name}”吗？此操作不可撤销。`)) return
    try { await window.texly.files.remove(project.id, node.path); closeTab(node.path); await refreshTree(); notify('success', '文件已删除') }
    catch (err) { notify('error', message(err)) }
    setContext(null)
  }
  function configureMonaco(monaco: Monaco) {
    if (!monaco.languages.getLanguages().some(item => item.id === 'latex')) {
      monaco.languages.register({ id: 'latex', extensions: ['.tex', '.sty', '.cls'], aliases: ['LaTeX', 'TeX'] })
      monaco.languages.setLanguageConfiguration('latex', {
        comments: { lineComment: '%' }, brackets: [['{', '}'], ['[', ']'], ['(', ')']],
        autoClosingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }, { open: '$', close: '$' }],
        surroundingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '$', close: '$' }],
      })
      monaco.languages.setMonarchTokensProvider('latex', { tokenizer: { root: [
        [/%.*$/, 'comment'], [/\\(?:begin|end)(?=\{)/, 'keyword.control'], [/\\(?:documentclass|usepackage|RequirePackage|input|include|includegraphics|bibliography|bibliographystyle|label|ref|eqref|cite|citep|citet)(?=\b|\[|\{)/, 'keyword'],
        [/\\[a-zA-Z@]+\*?/, 'tag'], [/\\./, 'tag'], [/\$\$?/, { token: 'delimiter', next: '@math' }], [/&|~/, 'delimiter'], [/[{}\[\]()]/, '@brackets'], [/\d+(?:\.\d+)?/, 'number'],
      ], math: [[/%.*$/, 'comment'], [/\$\$?/, { token: 'delimiter', next: '@pop' }], [/\\[a-zA-Z]+/, 'tag'], [/[{}\[\]()_^]/, 'delimiter'], [/\d+(?:\.\d+)?/, 'number']] } })
      const commands = ['documentclass','usepackage','begin','end','section','subsection','paragraph','textbf','textit','emph','label','ref','eqref','cite','citep','citet','includegraphics','input','include','bibliography','maketitle','author','title','date','item']
      monaco.languages.registerCompletionItemProvider('latex', { triggerCharacters: ['\\'], provideCompletionItems: (_model, position) => ({ suggestions: commands.map(command => ({ label: `\\${command}`, kind: monaco.languages.CompletionItemKind.Function, insertText: `\\${command}{\${1:text}}`, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: Math.max(1, position.column - 1), endColumn: position.column } })) }) })
    }
    monaco.editor.defineTheme('texly-paper', { base: 'vs', inherit: true, rules: [
      { token: 'keyword', foreground: '176A4B', fontStyle: 'bold' }, { token: 'tag', foreground: '176A4B' },
      { token: 'string', foreground: '9B5B27' }, { token: 'comment', foreground: '8A918D', fontStyle: 'italic' },
      { token: 'number', foreground: '7655A8' }, { token: 'delimiter', foreground: '5C6762' },
    ], colors: { 'editor.background': '#FCFCFA', 'editor.foreground': '#28312D', 'editorLineNumber.foreground': '#B5BAB6', 'editorLineNumber.activeForeground': '#65706B', 'editor.selectionBackground': '#CFE8DD', 'editor.lineHighlightBackground': '#F4F6F3', 'editorCursor.foreground': '#147849', 'editorIndentGuide.background1': '#E7EAE7' } })
  }

  return <div className="workspace" onClick={() => context && setContext(null)}>
    <header className="editor-topbar drag-region">
      <button className="back-button no-drag" onClick={onBack}><ArrowLeft size={18} /></button><Logo compact />
      <div className="project-title no-drag"><span>{project.name}</span><small>{current && current.content !== current.saved ? '正在保存…' : <><Check size={12} />已保存到本机</>}</small></div>
      <div className="topbar-spacer" /><div className="topbar-tools no-drag">
        <button className="ghost-tool" onClick={() => window.texly.files.reveal(project.id)}><FolderSearch size={16} />在资源管理器中打开</button>
        <div className="compile-group"><button className="compile-button" onClick={() => compile(false)} disabled={compiling}>{compiling ? <RefreshCw className="spinning" size={17} /> : <Play size={17} fill="currentColor" />}{compiling ? '编译中' : '编译'}</button><button className="compile-caret" onClick={() => setCompileMenu(!compileMenu)}><ChevronDown size={16} /></button>
          {compileMenu && <div className="dropdown compile-dropdown"><button onClick={() => compile(false)}><RefreshCw size={16} /><span><b>重新编译</b><small>保留辅助文件，速度更快</small></span></button><button onClick={() => compile(true)}><Trash2 size={16} /><span><b>清理并重新编译</b><small>删除缓存后完整构建</small></span></button></div>}
        </div>
        <button className="icon-button top-settings" onClick={() => setSettings(true)}><Settings size={18} /></button>
      </div>
    </header>
    <main className={`editor-body ${filesVisible ? '' : 'files-hidden'}`} style={{ '--file-width': filesVisible ? `${fileWidth}px` : '0px', '--file-divider': filesVisible ? '4px' : '0px', '--editor-ratio': `${editorRatio}%` } as React.CSSProperties}>
      {filesVisible && <FileTree project={project} nodes={tree} active={active} onOpen={openFile} onNew={() => setCreateDialog(true)} onMenu={(node, rect) => setContext({ node, x: rect.left, y: rect.bottom })} />}
      {filesVisible && <div className="vertical-resizer file-resizer" onMouseDown={e => startHorizontalDrag(e, x => setFileWidth(Math.min(360, Math.max(170, x))))} />}
      <section className="edit-panel">
        <div className="tabs"><button className={`file-panel-toggle ${filesVisible ? 'active' : ''}`} title={filesVisible ? '隐藏侧边栏' : '显示侧边栏'} aria-pressed={filesVisible} onClick={toggleFiles}>{filesVisible ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}</button>{tabs.map(tab => <button key={tab.path} className={active === tab.path ? 'active' : ''} onClick={() => setActive(tab.path)}><span>{tab.path.split('/').pop()}</span>{tab.content !== tab.saved && <i /> }<X size={13} onClick={e => { e.stopPropagation(); closeTab(tab.path) }} /></button>)}</div>
        <div className="editor-wrap">{current ? <Editor path={current.path} language={language(current.path)} theme="texly-paper" beforeMount={configureMonaco} onMount={editor => editorRef.current = editor} defaultValue={current.content} onChange={changeContent} saveViewState options={{ fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace", fontSize: 14, lineHeight: 22, minimap: { enabled: false }, wordWrap: 'on', padding: { top: 18 }, scrollBeyondLastLine: false, automaticLayout: true, bracketPairColorization: { enabled: true }, renderWhitespace: 'selection', tabSize: 2, unicodeHighlight: { ambiguousCharacters: false }, acceptSuggestionOnEnter: 'smart' }} /> : <div className="editor-empty"><Menu size={24} /><p>从左侧选择一个文件开始编辑</p></div>}</div>
      </section>
      <div className="sync-rail" title="拖动以调整编辑器与 PDF 宽度" onMouseDown={e => { const body = e.currentTarget.parentElement!; const rect = body.getBoundingClientRect(); const offset = filesVisible ? fileWidth : 0; startHorizontalDrag(e, x => setEditorRatio(Math.min(75, Math.max(27, (x - rect.left - offset) / (rect.width - offset) * 100)))) }}>
        <button title="从源码跳到 PDF" aria-label="从源码跳到 PDF" disabled={syncing || !active || !/\.tex$/i.test(active) || !pdf} onMouseDown={e => e.stopPropagation()} onClick={syncSourceToPdf}><ArrowRight size={15} /></button>
        <span className="sync-grip" />
        <button title="从 PDF 跳到源码" aria-label="从 PDF 跳到源码" disabled={syncing || !pdfPoint} onMouseDown={e => e.stopPropagation()} onClick={syncPdfToSource}><ArrowLeft size={15} /></button>
      </div>
      <PdfViewer data={pdf} compiling={compiling} syncTarget={pdfSyncTarget} selectedPoint={pdfPoint} onPointChange={setPdfPoint} onCompile={() => compile(false)} onDownload={downloadPdf} />
      <button className={`log-toggle ${logOpen ? 'open' : ''}`} onClick={() => setLogOpen(!logOpen)}>{logOpen ? <PanelBottomClose size={15} /> : <PanelBottomOpen size={15} />}日志{compileFailed && <CircleAlert size={14} />}</button>
      {logOpen && <section className="log-drawer"><header><span>编译日志</span><button onClick={() => setLogOpen(false)}><X size={15} /></button></header><pre>{log || '暂无编译日志。'}</pre></section>}
    </main>
    {context && <div className="dropdown context-menu" style={{ left: context.x, top: context.y }} onClick={e => e.stopPropagation()}>{context.node.type === 'file' && /\.tex$/i.test(context.node.name) && <button onClick={() => { updateProject({ mainTex: context.node.path }); setContext(null) }}><Check size={15} />设为 Main TeX</button>}<button className="danger" onClick={() => removeNode(context.node)}><Trash2 size={15} />删除</button></div>}
    {settings && <div className="drawer-backdrop" onMouseDown={() => setSettings(false)}><aside className="settings-drawer" onMouseDown={e => e.stopPropagation()}><header><div><span className="eyebrow">PROJECT SETTINGS</span><h2>项目设置</h2></div><button onClick={() => setSettings(false)}><X /></button></header>
      <section><h3>编译器</h3><p>中文模板推荐 XeLaTeX；现代 OpenType 字体可选 LuaLaTeX。</p><div className="segmented">{(['xelatex', 'lualatex', 'pdflatex'] as const).map(c => <button className={project.compiler === c ? 'active' : ''} onClick={() => updateProject({ compiler: c })} key={c}>{c}</button>)}</div></section>
      <section><h3>Main TeX 文档</h3><p>编译时首先交给 LaTeX 引擎的根文档。</p><select value={project.mainTex} onChange={e => updateProject({ mainTex: e.target.value })}>{flattenTex(tree).map(f => <option key={f.path}>{f.path}</option>)}</select></section>
      <section><h3>LaTeX 环境</h3><div className="environment-row"><span className={`status-dot ${toolchain?.ready ? 'ready' : ''}`} /><div><b>{toolchain?.ready ? '编译环境已就绪' : '未找到编译环境'}</b><small>{toolchain?.latexmk || '安装 MiKTeX 或 TeX Live 后重启应用'}</small></div></div></section>
    </aside></div>}
    {createDialog && <CreateEntry close={() => setCreateDialog(false)} create={async (name, type) => { try { await window.texly.files.create(project.id, '', name, type); await refreshTree(); setCreateDialog(false); if (type === 'file') openFile(name) } catch (err) { notify('error', message(err)) } }} />}
  </div>
}

function CreateEntry({ close, create }: { close(): void; create(name: string, type: 'file' | 'directory'): void }) {
  const [name, setName] = useState('chapter.tex'); const [type, setType] = useState<'file' | 'directory'>('file')
  return <div className="modal-backdrop" onMouseDown={close}><form className="modal modal-small" onMouseDown={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); create(name, type) }}><h2>新建{type === 'file' ? '文件' : '文件夹'}</h2><div className="segmented"><button type="button" className={type === 'file' ? 'active' : ''} onClick={() => setType('file')}><FilePlus2 size={15} />文件</button><button type="button" className={type === 'directory' ? 'active' : ''} onClick={() => setType('directory')}><FolderPlus size={15} />文件夹</button></div><label>名称<input autoFocus value={name} onChange={e => setName(e.target.value)} /></label><div className="modal-actions"><button type="button" onClick={close}>取消</button><button className="primary">创建</button></div></form></div>
}
function isText(path: string) { return /\.(tex|bib|cls|sty|bst|txt|md|json|yaml|yml|csv|latexmkrc)$/i.test(path) || path.endsWith('latexmkrc') }
function language(path: string) { return /\.(tex|sty|cls|bst)$/i.test(path) ? 'latex' : /\.bib$/i.test(path) ? 'bibtex' : /\.json$/i.test(path) ? 'json' : 'plaintext' }
function flattenTex(nodes: FileNode[]): FileNode[] { return nodes.flatMap(n => n.type === 'directory' ? flattenTex(n.children || []) : /\.tex$/i.test(n.name) ? [n] : []) }
function message(err: unknown) { return err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(err) }
function startHorizontalDrag(e: React.MouseEvent, move: (clientX: number) => void) { e.preventDefault(); const onMove = (event: MouseEvent) => move(event.clientX); const up = () => { removeEventListener('mousemove', onMove); removeEventListener('mouseup', up) }; addEventListener('mousemove', onMove); addEventListener('mouseup', up) }
