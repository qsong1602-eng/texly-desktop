import { useState } from 'react'
import { ChevronDown, ChevronRight, File, FileImage, FileText, Folder, FolderOpen, MoreHorizontal, Plus } from 'lucide-react'
import type { FileNode, Project } from '../types'

interface Props {
  project: Project
  nodes: FileNode[]
  active?: string
  onOpen(path: string): void
  onNew(): void
  onMenu(node: FileNode, rect: DOMRect): void
}

export default function FileTree({ nodes, ...props }: Props) {
  return <aside className="file-panel">
    <div className="file-heading"><span>项目文件</span><button title="新建文件或文件夹" onClick={props.onNew}><Plus size={16} /></button></div>
    <div className="tree"><TreeNodes nodes={nodes} depth={0} {...props} /></div>
    <div className="main-document"><span>MAIN DOCUMENT</span><strong><FileText size={14} />{props.project.mainTex}</strong></div>
  </aside>
}

function TreeNodes({ nodes, depth, active, onOpen, onMenu, project, onNew }: Props & { depth: number }) {
  return <>{nodes.map(node => <TreeNode key={node.path} node={node} depth={depth} active={active} onOpen={onOpen} onMenu={onMenu} project={project} onNew={onNew} />)}</>
}

function TreeNode({ node, depth, active, onOpen, onMenu, ...rest }: Omit<Props, 'nodes'> & { node: FileNode; depth: number }) {
  const [expanded, setExpanded] = useState(true)
  const icon = node.type === 'directory' ? (expanded ? <FolderOpen size={16} /> : <Folder size={16} />) : fileIcon(node.name)
  return <div className="tree-node">
    <div className={`tree-row ${active === node.path ? 'active' : ''}`} style={{ paddingLeft: 9 + depth * 14 }} onClick={() => node.type === 'directory' ? setExpanded(!expanded) : onOpen(node.path)}>
      <span className="tree-chevron">{node.type === 'directory' ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}</span>{icon}<span title={node.path}>{node.name}</span>
      {node.path === rest.project.mainTex && <em>MAIN</em>}
      <button onClick={e => { e.stopPropagation(); onMenu(node, e.currentTarget.getBoundingClientRect()) }}><MoreHorizontal size={15} /></button>
    </div>
    {node.type === 'directory' && expanded && <TreeNodes nodes={node.children || []} depth={depth + 1} active={active} onOpen={onOpen} onMenu={onMenu} {...rest} />}
  </div>
}

function fileIcon(name: string) {
  if (/\.(png|jpe?g|svg|pdf)$/i.test(name)) return <FileImage size={16} />
  if (/\.(tex|bib|cls|sty)$/i.test(name)) return <FileText size={16} />
  return <File size={16} />
}
