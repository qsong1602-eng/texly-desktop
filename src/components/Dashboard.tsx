import { useState } from 'react'
import { ArchiveRestore, ArrowUpRight, BookOpenText, FileArchive, FolderOpen, Plus, Search, Settings2, Trash2 } from 'lucide-react'
import type { Project, ToolchainInfo } from '../types'
import Logo from './Logo'

interface Props {
  projects: Project[]
  toolchain: ToolchainInfo | null
  onOpen(project: Project): void
  onCreate(name: string, template: 'zh' | 'en'): Promise<void>
  onImport(): Promise<void>
  onOpenFolder(): Promise<void>
  onRemove(project: Project): Promise<void>
  onInstall(): Promise<void>
}

export default function Dashboard(props: Props) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('我的论文')
  const [template, setTemplate] = useState<'zh' | 'en'>('zh')
  const visible = props.projects.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
  const create = async () => { await props.onCreate(name, template); setCreating(false) }

  return <div className="dashboard">
    <header className="dash-topbar drag-region">
      <Logo />
      <div className="dash-top-actions no-drag"><button className="icon-button"><Settings2 size={18} /></button></div>
    </header>
    <aside className="dash-sidebar">
      <button className="nav-item active"><BookOpenText size={18} />所有项目</button>
      <button className="nav-item"><ArchiveRestore size={18} />已归档</button>
      <div className="nav-label">工作空间</div>
      <div className={`toolchain-card ${props.toolchain?.ready ? 'ready' : ''}`}>
        <span className="status-dot" />
        <div><strong>{props.toolchain?.ready ? 'LaTeX 已就绪' : '需要 LaTeX 引擎'}</strong>
          <small>{props.toolchain?.ready ? `${props.toolchain.distribution === 'unknown' ? '本地发行版' : props.toolchain.distribution} · XeLaTeX / pdfLaTeX` : '编译 PDF 前安装 MiKTeX'}</small></div>
        {!props.toolchain?.ready && <button onClick={props.onInstall}>配置</button>}
      </div>
      <p className="local-note">所有源码与 PDF 均保存在本机。TeXly 不会上传你的论文。</p>
    </aside>
    <main className="dash-main">
      <section className="dash-hero">
        <div><span className="eyebrow">YOUR LOCAL LIBRARY</span><h1>今天写点什么？</h1><p>离线、快速，保留熟悉的论文工作流。</p></div>
        <div className="hero-actions">
          <button className="primary" onClick={() => setCreating(true)}><Plus size={18} />新建空项目</button>
          <button onClick={props.onImport}><FileArchive size={18} />导入 ZIP</button>
          <button onClick={props.onOpenFolder}><FolderOpen size={18} />打开文件夹</button>
        </div>
      </section>
      <div className="library-heading">
        <div><h2>最近项目</h2><span>{props.projects.length} 个本地项目</span></div>
        <label className="search"><Search size={17} /><input placeholder="搜索项目…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      </div>
      {visible.length ? <div className="project-grid">{visible.map((p, i) => <article className="project-card" key={p.id} style={{ animationDelay: `${i * 55}ms` }} onClick={() => props.onOpen(p)}>
        <div className="paper-preview"><div className="paper-page"><b>{p.name}</b><i /><i /><i /><span>∫</span><i /><i /></div></div>
        <div className="project-info"><div><span className="project-kind">{p.compiler}</span><h3>{p.name}</h3><p>{p.mainTex} · {formatDate(p.updatedAt)}</p></div>
          <button className="card-open" aria-label="打开项目"><ArrowUpRight size={18} /></button>
          <button className="card-delete" aria-label="移除项目" onClick={e => { e.stopPropagation(); props.onRemove(p) }}><Trash2 size={16} /></button>
        </div>
      </article>)}</div> : <div className="empty-library"><div className="empty-glyph">T<sup>E</sup>X</div><h3>项目架上还是空的</h3><p>新建中文或英文模板，也可以直接导入从 Overleaf 下载的 ZIP。</p><button className="primary" onClick={() => setCreating(true)}><Plus size={18} />创建第一个项目</button></div>}
    </main>
    {creating && <div className="modal-backdrop" onMouseDown={() => setCreating(false)}><form className="modal" onMouseDown={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); create() }}>
      <span className="eyebrow">NEW LOCAL PROJECT</span><h2>开始一篇新论文</h2>
      <label>项目名称<input autoFocus value={name} onChange={e => setName(e.target.value)} /></label>
      <div className="template-options">
        <button type="button" className={template === 'zh' ? 'selected' : ''} onClick={() => setTemplate('zh')}><b>中文论文</b><span>ctexart · XeLaTeX</span></button>
        <button type="button" className={template === 'en' ? 'selected' : ''} onClick={() => setTemplate('en')}><b>English paper</b><span>article · XeLaTeX</span></button>
      </div>
      <div className="modal-actions"><button type="button" onClick={() => setCreating(false)}>取消</button><button className="primary" disabled={!name.trim()}>选择位置并创建</button></div>
    </form></div>}
  </div>
}

function formatDate(value: string) {
  const date = new Date(value); const today = new Date(); const days = Math.floor((today.getTime() - date.getTime()) / 86400000)
  return days <= 0 ? '今天编辑' : days === 1 ? '昨天编辑' : `${days} 天前编辑`
}
