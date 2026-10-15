export type Compiler = 'xelatex' | 'lualatex' | 'pdflatex'

export interface ProjectRecord {
  id: string
  name: string
  path: string
  mainTex: string
  compiler: Compiler
  updatedAt: string
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export interface ToolchainInfo {
  ready: boolean
  latexmk?: string
  xelatex?: string
  lualatex?: string
  pdflatex?: string
  tlmgr?: string
  winget?: string
  distribution: 'texlive' | 'miktex' | 'unknown'
}
