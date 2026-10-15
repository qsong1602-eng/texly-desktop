import { useEffect, useState } from 'react'
import Dashboard from './components/Dashboard'
import EditorWorkspace from './components/EditorWorkspace'
import Toasts, { type ToastItem } from './components/Toast'
import type { Project, ToolchainInfo } from './types'

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [active, setActive] = useState<Project | null>(null)
  const [toolchain, setToolchain] = useState<ToolchainInfo | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  useEffect(() => { load(); window.texly.system.toolchain().then(setToolchain) }, [])
  async function load() { setProjects(await window.texly.projects.list()) }
  function notify(kind: 'success' | 'error', message: string) { const id = Date.now(); setToasts(v => [...v, { id, kind, message }]); setTimeout(() => setToasts(v => v.filter(t => t.id !== id)), 4200) }
  async function receive(promise: Promise<Project | null>, success: string) { try { const p = await promise; if (p) { await load(); setActive(p); notify('success', success) } } catch (e) { notify('error', errorMessage(e)) } }
  async function remove(project: Project) { if (!confirm(`从 TeXly 项目列表移除“${project.name}”？本地文件不会被删除。`)) return; await window.texly.projects.remove(project.id); await load(); notify('success', '已从列表移除，本地文件保持不变') }
  async function install() { try { await window.texly.system.installLatex(); notify('success', '已启动 MiKTeX 安装程序，安装完成后请重启 TeXly') } catch (e) { notify('error', errorMessage(e)) } }
  function updateProject(p: Project) { setActive(p); setProjects(v => v.map(item => item.id === p.id ? p : item)) }

  return <><Toasts items={toasts} close={id => setToasts(v => v.filter(t => t.id !== id))} />
    {active ? <EditorWorkspace project={active} toolchain={toolchain} onBack={() => { setActive(null); load() }} onProject={updateProject} notify={notify} /> : <Dashboard projects={projects} toolchain={toolchain} onOpen={setActive} onCreate={(name, template) => receive(window.texly.projects.create({ name, template }), '项目已创建')} onImport={() => receive(window.texly.projects.importZip(), 'ZIP 项目导入完成')} onOpenFolder={() => receive(window.texly.projects.openFolder(), '本地项目已打开')} onRemove={remove} onInstall={install} />}
  </>
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error) }
