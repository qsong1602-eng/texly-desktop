import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import type { ProjectRecord, ToolchainInfo } from './types'

type ProcessResult = { code: number; log: string }
type Runner = (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<ProcessResult>
type CompileResult = ProcessResult & { success: boolean; missingToolchain?: boolean }

export function runProcess(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<ProcessResult> {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, windowsHide: true, env: { ...env, max_print_line: '2000' } })
    let log = ''
    child.stdout.on('data', data => log += data.toString())
    child.stderr.on('data', data => log += data.toString())
    child.on('error', error => resolve({ code: -1, log: `${log}\n${error.message}` }))
    child.on('close', code => resolve({ code: code ?? -1, log }))
  })
}

function texPath(value: string) { return value.replaceAll('\\', '/') }

export function compileEnvironment(project: ProjectRecord, executables: string[], inherited = process.env): NodeJS.ProcessEnv {
  const env = { ...inherited }
  const root = path.resolve(project.path)
  const directories = [...new Set([root, path.dirname(path.resolve(root, project.mainTex)), path.join(root, '.texly/build')])]
  const prepend = (name: string, values: string[]) => {
    // Windows treats names case-insensitively; duplicate Path/PATH keys can hide our additions.
    const key = Object.keys(env).find(key => key.toUpperCase() === name)
    const previous = key ? env[key] : undefined
    if (key) delete env[key]
    env[name] = [...new Set(values), previous || '', ...(name === 'PATH' ? [] : [''])].join(path.delimiter)
  }
  prepend('PATH', executables.map(executable => path.dirname(executable)))
  // BibTeX runs in the build directory. Absolute source paths keep local databases and
  // styles ahead of distribution defaults, including when latexmk changes directory.
  // A trailing empty entry preserves the distribution's built-in search paths.
  for (const name of ['BIBINPUTS', 'BSTINPUTS', 'TEXINPUTS']) prepend(name, directories.map(texPath))
  return env
}

async function readText(file: string) { return fs.readFile(file, 'utf8').catch(() => '') }

async function hasBibData(outDir: string, aux: string, visited = new Set<string>()): Promise<boolean> {
  const absolute = path.resolve(outDir, aux)
  const relative = path.relative(outDir, absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative) || visited.has(absolute)) return false
  visited.add(absolute)
  const text = await readText(absolute)
  if (/\\bibdata\s*\{/.test(text)) return true
  // A bibliography may be declared inside an included chapter's auxiliary file.
  for (const match of text.matchAll(/\\@input\s*\{([^}]+)\}/g)) {
    if (await hasBibData(outDir, match[1], visited)) return true
  }
  return false
}

function unresolvedCitations(log: string) {
  return /(?:LaTeX|Package\s+[^\s]+)\s+Warning:\s*Citation\b[\s\S]*?undefined|There were undefined citations|Please\s+(?:\(re\)run|rerun)\s+(?:Biber|BibTeX)/i.test(log)
}

function needsLatexRerun(log: string) {
  return /Rerun to get cross-references right|Label\(s\) may have changed|Please rerun LaTeX/i.test(log)
}

export async function compileProject(
  project: ProjectRecord,
  info: ToolchainInfo,
  clean: boolean,
  findCommand: (name: string) => string | undefined,
  run: Runner = runProcess,
): Promise<CompileResult> {
  const root = path.resolve(project.path)
  const main = path.resolve(root, project.mainTex)
  const relative = path.relative(root, main)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('主文档必须位于项目目录内')
  const engine = info[project.compiler]
  if (!engine) return { success: false, code: -1, missingToolchain: true, log: `未检测到 ${project.compiler}。请先安装 MiKTeX 或 TeX Live，并重启 TeXly。` }
  const outDir = path.join(root, '.texly/build')
  if (clean) await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })
  const base = path.basename(main, path.extname(main))
  const pdf = path.join(outDir, `${base}.pdf`)
  const logFile = path.join(outDir, `${base}.log`)
  const bcf = path.join(outDir, `${base}.bcf`)
  const perl = findCommand('perl')
  const bibtex = findCommand('bibtex')
  const biber = findCommand('biber')
  const env = compileEnvironment(project, [engine, info.latexmk, perl, bibtex, biber].filter((item): item is string => !!item))
  let log = `TeXly：编译器 ${project.compiler}\n项目目录：${root}\n输出目录：${outDir}\n`
  const runStep = async (label: string, command: string, args: string[], cwd = root) => {
    log += `\n[${label}]\n工作目录：${cwd}\n命令：${JSON.stringify([command, ...args])}\n`
    const result = await run(command, args, cwd, env)
    log += `${result.log}\n退出码：${result.code}\n`
    return result
  }
  const fail = (message: string, code = -1): CompileResult => ({ success: false, code, log: `${log}\nTeXly：${message}\n` })
  const finish = async (last: ProcessResult): Promise<CompileResult> => {
    if (last.code !== 0) return fail('LaTeX 编译失败，请查看上方错误。', last.code)
    if (!existsSync(pdf)) return fail('编译未生成 PDF，请查看上方日志。')
    // Earlier passes normally contain undefined citations. Only inspect the final LaTeX log.
    const finalLog = await readText(logFile) || last.log
    if (unresolvedCitations(finalLog)) return fail('文献引用仍未解析，PDF 中可能显示“？”；请检查引用键、.bib 文件路径及上方 BibTeX/Biber 日志。')
    if (needsLatexRerun(finalLog)) return fail('交叉引用尚未稳定，请检查上方日志并重新编译。')
    return { success: true, code: 0, log }
  }

  let useLatexmk = !!(info.latexmk && perl)
  if (useLatexmk && process.platform === 'win32' && /[^\x00-\x7f]/.test(root + project.mainTex)) {
    // Even native Perl can fail its file-existence checks on Unicode paths returned
    // by kpsewhich. The direct engines and project-relative Biber calls handle them.
    useLatexmk = false
    log += '\nTeXly：Windows 项目路径包含非 ASCII 字符，使用内置流程以避免 latexmk 文献路径识别错误。\n'
  }
  if (useLatexmk && process.platform === 'win32') {
    const runtime = await runStep('Perl 检查', perl!, ['-e', 'print "TEXLY_PERL_OS=$^O\\n"'])
    useLatexmk = runtime.code === 0 && runtime.log.includes('TEXLY_PERL_OS=MSWin32')
    if (!useLatexmk) log += '\nTeXly：Perl 不可用或不是原生 Windows Perl，使用内置流程以避免文献路径转换错误。\n'
  }
  if (useLatexmk) {
    const mode = project.compiler === 'xelatex' ? '-xelatex' : project.compiler === 'lualatex' ? '-lualatex' : '-pdf'
    const engineCommand = `-${project.compiler}="${texPath(engine)}"${info.distribution === 'miktex' ? ' --enable-installer' : ''} %O %S`
    const result = await runStep('latexmk', info.latexmk!, [mode, engineCommand, '-interaction=nonstopmode', '-file-line-error', '-synctex=1', '-outdir=.texly/build', project.mainTex])
    return finish(result)
  }

  log += '\nTeXly：使用内置多轮编译流程。\n'
  // A previous Biber build must not select Biber after switching to a BibTeX document.
  // LaTeX regenerates the control file on this pass when Biber is actually required.
  await fs.rm(bcf, { force: true })
  const engineArgs = [
    ...(info.distribution === 'miktex' ? ['--enable-installer'] : []),
    '-interaction=nonstopmode', '-file-line-error', '-synctex=1', `-output-directory=${outDir}`, project.mainTex,
  ]
  const first = await runStep('LaTeX 1', engine, engineArgs)
  if (first.code !== 0) return fail('第一轮 LaTeX 编译失败。', first.code)

  const backend = existsSync(bcf) ? 'Biber' : await hasBibData(outDir, `${base}.aux`) ? 'BibTeX' : undefined
  if (backend) {
    const executable = backend === 'Biber' ? biber : bibtex
    if (!executable) return fail(`项目需要 ${backend}，但未找到该程序。请通过 MiKTeX Console 或 TeX Live 安装 ${backend} 后重新编译。`)
    // Perl-based Windows tools can corrupt non-ASCII absolute command-line paths.
    // Keep directory arguments relative to the project's cwd, including Chinese roots.
    const args = backend === 'Biber' ? ['--input-directory', '.texly/build', '--output-directory', '.texly/build', base] : [base]
    const result = await runStep(backend, executable, args, backend === 'Biber' ? root : outDir)
    if (result.code !== 0) return fail(`${backend} 文献处理失败，请检查上方错误中的 .bib/.bst 文件路径、引用键或工具安装情况。`, result.code)
    if (!existsSync(path.join(outDir, `${base}.bbl`))) return fail(`${backend} 未生成参考文献文件 ${base}.bbl。`)
  }

  let last = first
  for (let pass = 2; pass <= 5; pass++) {
    last = await runStep(`LaTeX ${pass}`, engine, engineArgs)
    if (last.code !== 0) return fail(`第 ${pass} 轮 LaTeX 编译失败。`, last.code)
    if (pass >= 3 && !needsLatexRerun(await readText(logFile) || last.log)) break
  }
  return finish(last)
}
