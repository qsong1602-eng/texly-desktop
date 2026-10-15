const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { existsSync } = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { spawnSync } = require('node:child_process')
const { compileProject } = require('../dist-electron/compile.js')

async function main() {
  const bin = process.env.TEXLY_TEST_TEX_BIN
  if (!bin) throw new Error('Set TEXLY_TEST_TEX_BIN to your MiKTeX or TeX Live bin directory.')
  const exe = name => {
    const file = path.join(bin, process.platform === 'win32' ? `${name}.exe` : name)
    return existsSync(file) ? file : undefined
  }
  const distribution = bin.toLowerCase().includes('miktex') ? 'miktex' : 'texlive'
  const parent = path.resolve('test-project')
  const root = await fs.mkdtemp(path.join(parent, 'bibliography-验收 空格-'))
  const bib = await fs.readFile('tests/fixtures/bibliography/references.bib', 'utf8')
  const original = await fs.readFile('tests/fixtures/bibliography/main.tex', 'utf8')
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const summary = []
  console.log(`Evidence directory: ${root}`)

  async function pdfText(file) {
    const loading = pdfjs.getDocument({
      data: new Uint8Array(await fs.readFile(file)), useSystemFonts: true,
      standardFontDataUrl: pathToFileURL(path.resolve('node_modules/pdfjs-dist/standard_fonts') + path.sep).href,
    })
    const doc = await loading.promise
    let text = ''
    for (let page = 1; page <= doc.numPages; page++) {
      text += (await (await doc.getPage(page)).getTextContent()).items.map(item => item.str || '').join(' ')
    }
    await loading.destroy()
    return text
  }

  async function createCase(name, source = original, files = { 'references.bib': bib }, mainTex = 'main.tex', caseRoot = root) {
    const folder = path.join(caseRoot, name)
    for (const [relative, content] of Object.entries({ [mainTex]: source, ...files })) {
      await fs.mkdir(path.dirname(path.join(folder, relative)), { recursive: true })
      await fs.writeFile(path.join(folder, relative), content)
    }
    return { id: name, name, path: folder, mainTex, compiler: 'xelatex' }
  }

  async function check(project, label, { clean = true, success = true, latexmk = false, expectedError, expectedDriver } = {}) {
    const info = { distribution, [project.compiler]: exe(project.compiler), ...(latexmk ? { latexmk: exe('latexmk') } : {}) }
    const find = name => name === 'perl' ? (latexmk ? process.env.TEXLY_TEST_PERL : undefined) : exe(name)
    const result = await compileProject(project, info, clean, find)
    await fs.writeFile(path.join(project.path, `${label}.log`), result.log)
    summary.push({ case: project.name, label, success: result.success, code: result.code })
    await fs.writeFile(path.join(root, 'summary.json'), JSON.stringify(summary, null, 2))
    assert.equal(result.success, success, `${project.name}/${label}:\n${result.log.slice(-7000)}`)
    if (expectedError) assert.match(result.log, expectedError)
    if (expectedDriver === 'latexmk') assert.match(result.log, /\[latexmk\]/)
    if (expectedDriver === 'internal') assert.match(result.log, /\[LaTeX 1\]/)
    if (success) {
      const output = path.join(project.path, '.texly/build', path.basename(project.mainTex, '.tex') + '.pdf')
      const text = await pdfText(output)
      await fs.writeFile(path.join(project.path, `${label}-pdf.txt`), text)
      assert.match(text, /Citation regression:\s*\[1\]/, text)
      assert.match(text, /The TeXbook/, text)
      assert.doesNotMatch(text, /\[\?\]/)
    }
    console.log(`PASS ${project.name}/${label}${success ? ' (PDF citation and bibliography verified)' : ' (failure reported)'}`)
  }

  const basic = await createCase('bibtex-root')
  await check(basic, 'clean')
  await check(basic, 'incremental', { clean: false })
  await fs.writeFile(path.join(basic.path, 'references.bib'), bib.replace('The TeXbook', 'The TeXbook Updated'))
  await check(basic, 'edited-bib', { clean: false })
  assert.match(await fs.readFile(path.join(basic.path, 'edited-bib-pdf.txt'), 'utf8'), /Updated/)
  await check(basic, 'clean-again')

  const located = spawnSync(exe('kpsewhich'), ['plain.bst'], { encoding: 'utf8', windowsHide: true })
  assert.equal(located.status, 0, located.stderr)
  const style = await fs.readFile(located.stdout.trim(), 'utf8')
  const nested = await createCase('nested-bib-and-style', original.replace('{references}', '{bib/references}').replace('{plain}', '{styles/custom}'), { 'bib/references.bib': bib, 'styles/custom.bst': style }, 'manuscript/main.tex')
  await check(nested, 'clean')

  const included = await createCase('included-bibliography', '\\documentclass{article}\n\\begin{document}\n\\include{chapter}\n\\end{document}\n', {
    'references.bib': bib,
    'chapter.tex': 'Citation regression: \\cite{knuth1984}.\n\\bibliographystyle{plain}\n\\bibliography{references}\n',
  })
  await check(included, 'clean')

  const natbib = await createCase('natbib', original.replace('\\begin{document}', '\\usepackage[numbers]{natbib}\n\\begin{document}').replace('\\cite{', '\\citep{').replace('{plain}', '{plainnat}'))
  await check(natbib, 'clean')

  for (const backend of ['biber', 'bibtex']) {
    const source = `\\documentclass{article}\n\\usepackage[backend=${backend},style=numeric]{biblatex}\n\\addbibresource{bib/references.bib}\n\\begin{document}\nCitation regression: \\cite{knuth1984}.\n\\printbibliography\n\\end{document}\n`
    const project = await createCase(`biblatex-${backend}`, source, { 'bib/references.bib': bib })
    await check(project, 'clean')
    await check(project, 'incremental', { clean: false })
  }

  for (const compiler of ['pdflatex', 'lualatex']) {
    assert.ok(exe(compiler), `${compiler} is required for this integration suite`)
    await check({ ...basic, compiler }, compiler)
  }
  const missingFile = await createCase('missing-bib', original.replace('{references}', '{texly-missing-regression-database}'))
  await check(missingFile, 'failure', { success: false, expectedError: /BibTeX 文献处理失败/ })
  const missingKey = await createCase('missing-key', original.replace('{knuth1984}', '{texly-missing-key}'))
  await check(missingKey, 'failure', { success: false, expectedError: /文献引用仍未解析/ })

  if (process.env.TEXLY_TEST_PERL && exe('latexmk')) {
    await check(basic, 'latexmk-unicode-fallback', { latexmk: true, expectedDriver: 'internal' })
    const asciiRoot = await fs.mkdtemp(path.join(parent, 'bibliography-latexmk space-'))
    const latexmkBasic = await createCase('latexmk-bibtex', original, { 'references.bib': bib }, 'main.tex', asciiRoot)
    await check(latexmkBasic, 'clean', { latexmk: true, expectedDriver: 'latexmk' })
    await check(latexmkBasic, 'incremental', { latexmk: true, clean: false, expectedDriver: 'latexmk' })
    const latexmkMissing = await createCase('latexmk-missing-key', original.replace('{knuth1984}', '{texly-missing-key}'), { 'references.bib': bib }, 'main.tex', asciiRoot)
    await check(latexmkMissing, 'failure', { latexmk: true, success: false, expectedDriver: 'latexmk' })
    const biberSource = await fs.readFile(path.join(root, 'biblatex-biber/main.tex'), 'utf8')
    const biberProject = await createCase('latexmk-biber', biberSource, { 'bib/references.bib': bib }, 'main.tex', asciiRoot)
    await check(biberProject, 'clean', { latexmk: true, expectedDriver: 'latexmk' })
  } else {
    console.log('SKIP real latexmk: set TEXLY_TEST_PERL to a Perl executable; unit coverage still runs.')
  }
  console.log(`Integration checks passed: ${summary.length}. Logs and PDFs retained in ${root}`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
