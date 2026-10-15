import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import type { Compiler, FileNode, ProjectRecord, ToolchainInfo } from './types'
import { compileProject, runProcess } from './compile'

const ignored = new Set(['.git', '.texly', 'node_modules', '.idea', '.vscode'])
let projectCache: ProjectRecord[] | null = null

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1050,
    minHeight: 680,
    backgroundColor: '#f4f5f3',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#10261f', symbolColor: '#e8f2ed', height: 44 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL)
  else win.loadFile(path.join(__dirname, '../dist/index.html'))
}

function projects(): ProjectRecord[] {
  if (projectCache) return projectCache
  try { projectCache = JSON.parse(require('node:fs').readFileSync(path.join(app.getPath('userData'), 'projects.json'), 'utf8')) as ProjectRecord[] }
  catch { projectCache = [] }
  return projectCache
}
function saveProjects(items: ProjectRecord[]) {
  projectCache = items
  require('node:fs').mkdirSync(app.getPath('userData'), { recursive: true })
  require('node:fs').writeFileSync(path.join(app.getPath('userData'), 'projects.json'), JSON.stringify(items, null, 2), 'utf8')
}
function getProject(id: string) {
  const item = projects().find(p => p.id === id)
  if (!item) throw new Error('项目不存在或已从列表移除')
  return item
}
function safePath(project: ProjectRecord, relative = '') {
  const root = path.resolve(project.path)
  const target = path.resolve(root, relative)
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('不允许访问项目目录之外的文件')
  return target
}
function commandPath(command: string) {
  const result = spawnSync('where.exe', [command], { encoding: 'utf8', windowsHide: true })
  const fromPath = result.status === 0 ? result.stdout.split(/\r?\n/).find(Boolean)?.trim() : undefined
  if (fromPath) return fromPath
  const executable = command.toLowerCase().endsWith('.exe') ? command : `${command}.exe`
  const roots = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'MiKTeX', 'miktex', 'bin'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'MiKTeX', 'miktex', 'bin', 'x64'),
  ].filter((item): item is string => !!item)
  return roots.map(root => path.join(root, executable)).find(existsSync)
}

function outputPdf(project: ProjectRecord) {
  const name = `${path.basename(project.mainTex, path.extname(project.mainTex))}.pdf`
  return safePath(project, path.join('.texly/build', name))
}

function parseSyncTexBlocks(output: string) {
  const blocks: Array<Record<string, string>> = []
  let current: Record<string, string> = {}
  for (const raw of output.split(/\r?\n/)) {
    const separator = raw.indexOf(':')
    if (separator < 1) continue
    const key = raw.slice(0, separator).trim()
    const value = raw.slice(separator + 1).trim()
    if (key === 'Output' && Object.keys(current).length) {
      blocks.push(current)
      current = {}
    }
    current[key] = value
  }
  if (Object.keys(current).length) blocks.push(current)
  return blocks
}
function toolchain(): ToolchainInfo {
  const latexmk = commandPath('latexmk')
  const xelatex = commandPath('xelatex')
  const lualatex = commandPath('lualatex')
  const pdflatex = commandPath('pdflatex')
  const tlmgr = commandPath('tlmgr')
  const winget = commandPath('winget')
  const all = [latexmk, xelatex, lualatex, pdflatex].join(' ').toLowerCase()
  return { ready: !!(xelatex || lualatex || pdflatex), latexmk, xelatex, lualatex, pdflatex, tlmgr, winget,
    distribution: all.includes('miktex') ? 'miktex' : all.includes('texlive') ? 'texlive' : 'unknown' }
}

const englishTemplate = String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb,booktabs,graphicx,hyperref}
\title{A New Paper}
\author{Your Name}
\date{\today}
\begin{document}
\maketitle
\begin{abstract}
Start your abstract here.
\end{abstract}
\section{Introduction}
Welcome to TeXly. Your work stays on this computer.
\end{document}
`
const chineseTemplate = String.raw`\documentclass[UTF8,zihao=-4]{ctexart}
\usepackage[a4paper,margin=2.5cm]{geometry}
\usepackage{amsmath,amssymb,booktabs,graphicx,hyperref}
\title{中文论文标题}
\author{作者姓名}
\date{\today}
\begin{document}
\maketitle
\begin{abstract}
请在这里撰写摘要。该模板默认使用 XeLaTeX 编译，兼容 Windows 中文字体。
\end{abstract}
\section{引言}
欢迎使用 TeXly。项目与编译均在本机完成。
\end{document}
`

async function scanTree(root: string, current = root): Promise<FileNode[]> {
  const entries = await fs.readdir(current, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (const entry of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
    if (ignored.has(entry.name)) continue
    const absolute = path.join(current, entry.name)
    const relative = path.relative(root, absolute).replaceAll('\\', '/')
    if (entry.isDirectory()) nodes.push({ name: entry.name, path: relative, type: 'directory', children: await scanTree(root, absolute) })
    else nodes.push({ name: entry.name, path: relative, type: 'file' })
  }
  return nodes
}

async function registerFolder(folder: string, name?: string) {
  const existing = projects().find(p => path.resolve(p.path).toLowerCase() === path.resolve(folder).toLowerCase())
  if (existing) return existing
  const entries = await fs.readdir(folder, { recursive: true }) as string[]
  const tex = entries.filter(f => f.toLowerCase().endsWith('.tex')).map(f => f.replaceAll('\\', '/'))
  const mainTex = tex.find(f => path.basename(f).toLowerCase() === 'main.tex') || tex[0] || 'main.tex'
  if (!tex.length) await fs.writeFile(path.join(folder, 'main.tex'), englishTemplate, 'utf8')
  const item: ProjectRecord = { id: crypto.randomUUID(), name: name || path.basename(folder), path: folder, mainTex,
    compiler: 'xelatex', updatedAt: new Date().toISOString() }
  saveProjects([item, ...projects()])
  return item
}

function setupIpc() {
  ipcMain.handle('projects:list', () => projects().filter(p => existsSync(p.path)))
  ipcMain.handle('projects:create', async (_e, input: { name?: string; template?: 'zh' | 'en' }) => {
    const selected = await dialog.showOpenDialog({ title: '选择项目保存位置', properties: ['openDirectory', 'createDirectory'] })
    if (selected.canceled) return null
    const name = (input.name || '未命名项目').replace(/[<>:"/\\|?*]/g, '').trim() || '未命名项目'
    const folder = path.join(selected.filePaths[0], name)
    if (existsSync(folder)) throw new Error(`文件夹“${name}”已经存在`)
    await fs.mkdir(folder, { recursive: false })
    await fs.writeFile(path.join(folder, 'main.tex'), input.template === 'en' ? englishTemplate : chineseTemplate, 'utf8')
    return registerFolder(folder, name)
  })
  ipcMain.handle('projects:open-folder', async () => {
    const selected = await dialog.showOpenDialog({ title: '打开 LaTeX 项目', properties: ['openDirectory'] })
    return selected.canceled ? null : registerFolder(selected.filePaths[0])
  })
  ipcMain.handle('projects:import-zip', async () => {
    const picked = await dialog.showOpenDialog({ title: '选择 Overleaf ZIP 项目', filters: [{ name: 'ZIP 项目', extensions: ['zip'] }], properties: ['openFile'] })
    if (picked.canceled) return null
    const destination = await dialog.showOpenDialog({ title: '选择导入位置', properties: ['openDirectory', 'createDirectory'] })
    if (destination.canceled) return null
    const base = path.basename(picked.filePaths[0], path.extname(picked.filePaths[0]))
    let folder = path.join(destination.filePaths[0], base)
    let suffix = 2
    while (existsSync(folder)) folder = path.join(destination.filePaths[0], `${base}-${suffix++}`)
    await fs.mkdir(folder, { recursive: true })
    const zip = new AdmZip(picked.filePaths[0])
    for (const entry of zip.getEntries()) {
      const target = path.resolve(folder, entry.entryName)
      if (target !== folder && !target.startsWith(folder + path.sep)) throw new Error('ZIP 中包含不安全的文件路径')
    }
    zip.extractAllTo(folder, true)
    return registerFolder(folder, base)
  })
  ipcMain.handle('projects:remove', (_e, id: string) => saveProjects(projects().filter(p => p.id !== id)))
  ipcMain.handle('projects:update', (_e, id: string, patch: Partial<Pick<ProjectRecord, 'name' | 'mainTex' | 'compiler'>>) => {
    const allowed: Partial<ProjectRecord> = { updatedAt: new Date().toISOString() }
    if (typeof patch.name === 'string') allowed.name = patch.name
    if (typeof patch.mainTex === 'string') allowed.mainTex = patch.mainTex
    if (['xelatex', 'lualatex', 'pdflatex'].includes(patch.compiler || '')) allowed.compiler = patch.compiler as Compiler
    const next = projects().map(p => p.id === id ? { ...p, ...allowed } : p)
    saveProjects(next)
    return next.find(p => p.id === id)
  })
  ipcMain.handle('files:tree', (_e, id: string) => { const p = getProject(id); return scanTree(p.path) })
  ipcMain.handle('files:read', (_e, id: string, relative: string) => fs.readFile(safePath(getProject(id), relative), 'utf8'))
  ipcMain.handle('files:write', async (_e, id: string, relative: string, content: string) => {
    const target = safePath(getProject(id), relative); await fs.writeFile(target, content, 'utf8'); return true
  })
  ipcMain.handle('files:create', async (_e, id: string, parent: string, name: string, type: string) => {
    if (!name || /[<>:"/\\|?*]/.test(name)) throw new Error('文件名无效')
    const target = safePath(getProject(id), path.join(parent, name))
    if (type === 'directory') await fs.mkdir(target)
    else await fs.writeFile(target, '', { flag: 'wx' })
    return true
  })
  ipcMain.handle('files:remove', async (_e, id: string, relative: string) => {
    const p = getProject(id)
    if (relative === p.mainTex) throw new Error('不能删除当前主文档，请先更改 Main TeX')
    await fs.rm(safePath(p, relative), { recursive: true }); return true
  })
  ipcMain.handle('files:reveal', (_e, id: string) => shell.showItemInFolder(getProject(id).path))
  ipcMain.handle('system:toolchain', () => toolchain())
  ipcMain.handle('system:install-latex', () => {
    const info = toolchain()
    if (!info.winget) throw new Error('未找到 winget，请从 miktex.org 手动安装 MiKTeX')
    const child = spawn(info.winget, ['install', '--id', 'MiKTeX.MiKTeX', '-e', '--interactive'], { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref(); return true
  })
  ipcMain.handle('compile:run', async (_e, id: string, clean: boolean) => {
    return compileProject(getProject(id), toolchain(), clean, commandPath)
  })
  ipcMain.handle('compile:pdf', async (_e, id: string) => {
    const p = getProject(id); const pdf = outputPdf(p)
    if (!existsSync(pdf)) return null
    return (await fs.readFile(pdf)).toString('base64')
  })
  ipcMain.handle('compile:save-pdf', async (_e, id: string) => {
    const p = getProject(id); const pdf = outputPdf(p)
    if (!existsSync(pdf)) throw new Error('还没有可下载的 PDF，请先编译项目')
    const result = await dialog.showSaveDialog({
      title: '保存编译后的 PDF',
      defaultPath: path.join(p.path, `${p.name}.pdf`),
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePath) return null
    await fs.copyFile(pdf, result.filePath)
    return result.filePath
  })
  ipcMain.handle('sync:forward', async (_e, id: string, relative: string, line: number, column: number) => {
    const p = getProject(id); const synctex = commandPath('synctex'); const pdf = outputPdf(p)
    if (!synctex || !existsSync(pdf)) return null
    const input = safePath(p, relative)
    const result = await runProcess(synctex, ['view', '-i', `${Math.max(1, Math.floor(line))}:${Math.max(1, Math.floor(column))}:${input}`, '-o', pdf], p.path)
    const block = parseSyncTexBlocks(result.log).find(item => item.Page)
    if (!block) return null
    const height = Math.max(10, Number(block.H) || 14)
    return {
      page: Math.max(1, Number(block.Page) || 1),
      x: Math.max(0, Number(block.h ?? block.x) || 0),
      y: Math.max(0, (Number(block.v ?? block.y) || 0) - height),
      width: Math.max(12, Number(block.W) || 24),
      height,
    }
  })
  ipcMain.handle('sync:reverse', async (_e, id: string, page: number, x: number, y: number) => {
    const p = getProject(id); const synctex = commandPath('synctex'); const pdf = outputPdf(p)
    if (!synctex || !existsSync(pdf)) return null
    const result = await runProcess(synctex, ['edit', '-o', `${Math.max(1, Math.floor(page))}:${Math.max(0, x)}:${Math.max(0, y)}:${pdf}`], p.path)
    const block = parseSyncTexBlocks(result.log).find(item => item.Input && item.Line)
    if (!block) return null
    const absolute = path.resolve(block.Input)
    const relative = path.relative(path.resolve(p.path), absolute)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null
    return { path: relative.replaceAll('\\', '/'), line: Math.max(1, Number(block.Line) || 1), column: Math.max(1, Number(block.Column) || 1) }
  })
}

app.whenReady().then(() => { setupIpc(); createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() }) })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
