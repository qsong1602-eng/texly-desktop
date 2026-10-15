const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { compileProject, compileEnvironment } = require('../dist-electron/compile.js')

async function fixture(t, options = {}) {
  const parent = path.resolve('test-project')
  const root = await fs.mkdtemp(path.join(parent, options.latexmk && !options.unicode ? 'unit-ascii space-' : 'unit-文献 空格-'))
  t.after(async () => {
    assert.ok(root.startsWith(parent + path.sep))
    await fs.rm(root, { recursive: true, force: true })
  })
  const out = path.join(root, '.texly/build')
  const project = { path: root, mainTex: 'main.tex', compiler: 'xelatex' }
  const executable = name => path.join(root, 'tools with spaces', `${name}.exe`)
  const info = { distribution: 'miktex', xelatex: executable('xelatex'), ...(options.latexmk ? { latexmk: executable('latexmk') } : {}) }
  const calls = []
  let pass = 0
  const warning = "LaTeX Warning: Citation `knuth1984' on page 1 undefined on input line 3."
  const run = async (command, args, cwd, env) => {
    const name = path.basename(command, '.exe')
    calls.push({ name, args, cwd, env })
    if (name === 'perl') return { code: 0, log: `TEXLY_PERL_OS=${options.perlOS || 'MSWin32'}` }
    if (name === 'xelatex' || name === 'latexmk') {
      pass++
      const kind = options.kind || 'bibtex'
      await fs.writeFile(path.join(out, 'main.aux'), kind === 'bibtex' ? '\\bibdata{references}' : kind === 'included' ? '\\@input{chapter.aux}' : '\\relax')
      if (kind === 'included') await fs.writeFile(path.join(out, 'chapter.aux'), '\\@input{main.aux}\n\\bibdata{references}')
      if (kind === 'biber') await fs.writeFile(path.join(out, 'main.bcf'), '<bcf/>')
      const log = options.unresolved || (pass < 3 && name !== 'latexmk') ? warning : 'Output written on main.pdf.'
      await fs.writeFile(path.join(out, 'main.log'), log)
      await fs.writeFile(path.join(out, 'main.pdf'), 'fixture PDF')
      return { code: options.failPass === pass ? 9 : 0, log }
    }
    if (!options.noBbl) await fs.writeFile(path.join(out, 'main.bbl'), '\\bibitem{knuth1984}')
    return { code: options.bibCode || 0, log: options.bibCode ? "I couldn't open database file references.bib" : 'Bibliography processed.' }
  }
  const find = name => (name === options.missing || (name === 'perl' && !options.latexmk)) ? undefined : executable(name)
  return { root, out, calls, project, info, run, find, compile: clean => compileProject(project, info, !!clean, find, run) }
}

test('searches the project and nested main directory before distribution defaults, preserving environment', () => {
  const root = path.resolve('test-project/中文 project')
  const inherited = { Path: 'old-tools', BIBINPUTS: 'custom-bibs', BSTINPUTS: 'custom-styles', TEXINPUTS: 'custom-tex' }
  const env = compileEnvironment({ path: root, mainTex: 'paper/main.tex' }, [path.join(root, 'tools/xelatex.exe')], inherited)
  for (const name of ['BIBINPUTS', 'BSTINPUTS', 'TEXINPUTS']) {
    assert.equal(env[name].split(path.delimiter)[0], root.replaceAll('\\', '/'))
    assert.ok(env[name].includes('/paper'))
    assert.ok(env[name].includes(inherited[name]))
    assert.ok(env[name].endsWith(path.delimiter))
  }
  assert.equal(env.Path, undefined)
  assert.ok(env.PATH.endsWith('old-tools'))
  assert.equal(inherited.Path, 'old-tools')
})

test('BibTeX gets source search paths and is followed by two successful LaTeX passes', async t => {
  const f = await fixture(t)
  const result = await f.compile(true)
  assert.equal(result.success, true, result.log)
  assert.deepEqual(f.calls.map(c => c.name), ['xelatex', 'bibtex', 'xelatex', 'xelatex'])
  assert.equal(f.calls[1].cwd, f.out)
  assert.ok(f.calls[1].env.BIBINPUTS.includes(f.root.replaceAll('\\', '/')))
  assert.match(result.log, /BibTeX/)
})

test('Biber uses the generated control file and project source paths', async t => {
  const f = await fixture(t, { kind: 'biber' })
  assert.equal((await f.compile()).success, true)
  assert.equal(f.calls[1].name, 'biber')
  assert.equal(f.calls[1].cwd, f.root)
  assert.deepEqual(f.calls[1].args, ['--input-directory', '.texly/build', '--output-directory', '.texly/build', 'main'])
})

for (const [kind, missing, label] of [['bibtex', 'bibtex', 'BibTeX'], ['biber', 'biber', 'Biber']]) {
  test(`missing ${label} is an explicit failure, with no fallback to another backend`, async t => {
    const f = await fixture(t, { kind, missing })
    const result = await f.compile()
    assert.equal(result.success, false)
    assert.ok(result.log.includes(`项目需要 ${label}`))
    assert.equal(f.calls.length, 1)
  })
  test(`${label} failure cannot be overwritten by a successful LaTeX pass`, async t => {
    const f = await fixture(t, { kind, bibCode: 2 })
    const result = await f.compile()
    assert.equal(result.success, false)
    assert.equal(result.code, 2)
    assert.ok(result.log.includes(`${label} 文献处理失败`))
    assert.equal(f.calls.length, 2)
  })
}

test('an intermediate LaTeX failure is preserved', async t => {
  const f = await fixture(t, { failPass: 2 })
  const result = await f.compile()
  assert.equal(result.success, false)
  assert.equal(result.code, 9)
  assert.equal(f.calls.length, 3)
})

test('a zero exit code with unresolved citations is not success', async t => {
  const f = await fixture(t, { unresolved: true })
  const result = await f.compile()
  assert.equal(result.success, false)
  assert.match(result.log, /文献引用仍未解析/)
})

test('a stale BCF does not select Biber for the current BibTeX document', async t => {
  const f = await fixture(t)
  await fs.mkdir(f.out, { recursive: true })
  await fs.writeFile(path.join(f.out, 'main.bcf'), 'stale control file')
  assert.equal((await f.compile()).success, true)
  assert.equal(f.calls[1].name, 'bibtex')
})

test('bibliography declarations in included aux files are discovered', async t => {
  const f = await fixture(t, { kind: 'included' })
  assert.equal((await f.compile()).success, true)
  assert.equal(f.calls[1].name, 'bibtex')
})

test('clean rebuild preserves source bib and bst files', async t => {
  const f = await fixture(t)
  await fs.writeFile(path.join(f.root, 'references.bib'), 'source bibliography')
  await fs.writeFile(path.join(f.root, 'custom.bst'), 'source style')
  await fs.mkdir(f.out, { recursive: true })
  await fs.writeFile(path.join(f.out, 'obsolete.aux'), 'stale')
  assert.equal((await f.compile(true)).success, true)
  assert.equal(await fs.readFile(path.join(f.root, 'references.bib'), 'utf8'), 'source bibliography')
  assert.equal(await fs.readFile(path.join(f.root, 'custom.bst'), 'utf8'), 'source style')
  await assert.rejects(fs.access(path.join(f.out, 'obsolete.aux')))
})

test('a backend that produces no bbl is a failure', async t => {
  const f = await fixture(t, { noBbl: true })
  assert.equal((await f.compile()).success, false)
})

test('documents without a bibliography do not require bibliography tools', async t => {
  const f = await fixture(t, { kind: 'none' })
  assert.equal((await f.compile()).success, true)
  assert.deepEqual(f.calls.map(c => c.name), ['xelatex', 'xelatex', 'xelatex'])
})

test('latexmk receives the same search paths and an absolute quoted engine command', async t => {
  const f = await fixture(t, { latexmk: true })
  assert.equal((await f.compile()).success, true)
  const call = f.calls.find(call => call.name === 'latexmk')
  assert.ok(call)
  assert.ok(call.args.some(arg => arg.startsWith('-xelatex="') && arg.includes('tools with spaces/xelatex.exe" --enable-installer')))
  assert.ok(call.env.BSTINPUTS.includes(f.root.replaceAll('\\', '/')))
})

test('latexmk cannot report success when the final log contains unresolved citations', async t => {
  const f = await fixture(t, { latexmk: true, unresolved: true })
  assert.equal((await f.compile()).success, false)
})

test('Windows falls back from Git/Cygwin Perl instead of corrupting drive-letter paths', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t, { latexmk: true, perlOS: 'cygwin' })
  assert.equal((await f.compile()).success, true)
  assert.deepEqual(f.calls.map(c => c.name), ['perl', 'xelatex', 'bibtex', 'xelatex', 'xelatex'])
})

test('Windows Unicode project paths use the working direct bibliography pipeline', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t, { latexmk: true, unicode: true })
  const result = await f.compile()
  assert.equal(result.success, true)
  assert.match(result.log, /Windows 项目路径包含非 ASCII/)
  assert.deepEqual(f.calls.map(c => c.name), ['xelatex', 'bibtex', 'xelatex', 'xelatex'])
})
