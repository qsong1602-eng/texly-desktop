// Run with release/win-unpacked/TeXly.exe and ELECTRON_RUN_AS_NODE=1.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

async function main() {
  const archive = path.resolve('release/win-unpacked/resources/app.asar')
  const metadata = JSON.parse(await fs.readFile(path.join(archive, 'package.json'), 'utf8'))
  assert.equal(metadata.version, '0.2.2')
  const packaged = path.join(archive, 'dist-electron/compile.js')
  assert.deepEqual(await fs.readFile(packaged), await fs.readFile('dist-electron/compile.js'))
  const { compileProject } = require(packaged)
  const bin = process.env.TEXLY_TEST_TEX_BIN
  if (!bin) throw new Error('Set TEXLY_TEST_TEX_BIN')
  const root = await fs.mkdtemp(path.resolve('test-project/bibliography-packaged-'))
  await fs.cp(path.resolve('tests/fixtures/bibliography'), root, { recursive: true })
  const exe = name => path.join(bin, `${name}.exe`)
  const result = await compileProject({ path: root, mainTex: 'main.tex', compiler: 'xelatex' },
    { distribution: 'miktex', xelatex: exe('xelatex') }, true, name => name === 'perl' ? undefined : exe(name))
  await fs.writeFile(path.join(root, 'packaged-compile.log'), result.log)
  assert.equal(result.success, true, result.log)
  assert.match(await fs.readFile(path.join(root, '.texly/build/main.bbl'), 'utf8'), /\\bibitem\{knuth1984\}/)
  assert.doesNotMatch(await fs.readFile(path.join(root, '.texly/build/main.log'), 'utf8'), /Citation.*undefined/)
  assert.ok((await fs.stat(path.join(root, '.texly/build/main.pdf'))).size > 0)
  const summary = JSON.stringify({ version: metadata.version, electron: process.versions.electron, packagedCompile: 'PASS', sourceMatches: true, root }, null, 2)
  await fs.writeFile(path.join(root, 'summary.json'), summary)
  console.log(summary)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
