export type Compiler = 'xelatex' | 'lualatex' | 'pdflatex'

export interface Project {
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
  distribution: 'texlive' | 'miktex' | 'unknown'
  latexmk?: string
  xelatex?: string
  lualatex?: string
  pdflatex?: string
  tlmgr?: string
  winget?: string
}

export interface CompileResult {
  success: boolean
  missingToolchain?: boolean
  code?: number
  log: string
}

export interface PdfLocation {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export interface SourceLocation {
  path: string
  line: number
  column: number
}

export interface TexlyApi {
  projects: {
    list(): Promise<Project[]>
    create(input: { name: string; template: 'zh' | 'en' }): Promise<Project | null>
    importZip(): Promise<Project | null>
    openFolder(): Promise<Project | null>
    remove(id: string): Promise<void>
    update(id: string, patch: Partial<Pick<Project, 'name' | 'mainTex' | 'compiler'>>): Promise<Project>
  }
  files: {
    tree(projectId: string): Promise<FileNode[]>
    read(projectId: string, path: string): Promise<string>
    write(projectId: string, path: string, content: string): Promise<boolean>
    create(projectId: string, parent: string, name: string, type: 'file' | 'directory'): Promise<boolean>
    remove(projectId: string, path: string): Promise<boolean>
    reveal(projectId: string): Promise<void>
  }
  compile: {
    run(projectId: string, clean?: boolean): Promise<CompileResult>
    pdf(projectId: string): Promise<string | null>
    savePdf(projectId: string): Promise<string | null>
    syncForward(projectId: string, path: string, line: number, column: number): Promise<PdfLocation | null>
    syncReverse(projectId: string, page: number, x: number, y: number): Promise<SourceLocation | null>
  }
  system: {
    toolchain(): Promise<ToolchainInfo>
    installLatex(): Promise<boolean>
  }
}

declare global { interface Window { texly: TexlyApi } }
