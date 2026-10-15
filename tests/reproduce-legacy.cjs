// Reproduce the 0.2.1 fallback commands without changing the source fixture.
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

async function main() {
  const root = path.resolve('test-project/bibliography-legacy')
  const out = path.join(root, '.texly/build')
  const bin = process.env.TEXLY_TEST_TEX_BIN
  if (!bin) throw new Error('Set TEXLY_TEST_TEX_BIN to a TeX distribution bin directory.')
  await fs.mkdir(root, { recursive: true })
  await fs.cp(path.resolve('tests/fixtures/bibliography'), root, { recursive: true })
  await fs.mkdir(out, { recursive: true })
  let log = ''
  const run = (name, args, cwd = root) => {
    const result = spawnSync(path.join(bin, `${name}.exe`), args, {
      cwd, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, max_print_line: '2000' },
    })
    log += `\nCOMMAND: ${name} ${JSON.stringify(args)}\nCWD: ${cwd}\nEXIT: ${result.status}\n${result.stdout || ''}${result.stderr || ''}${result.error || ''}`
    return result.status
  }
  const args = ['-interaction=nonstopmode', '-file-line-error', `-output-directory=${out}`, 'main.tex']
  const first = run('xelatex', args)
  const bibliography = first === 0 ? run('bibtex', ['main'], out) : null
  const second = first === 0 ? run('xelatex', args) : null
  const third = first === 0 ? run('xelatex', args) : null
  await fs.writeFile(path.join(root, 'legacy-compile.log'), log)
  const finalLog = await fs.readFile(path.join(out, 'main.log'), 'utf8').catch(() => '')
  console.log(JSON.stringify({ root, first, bibliography, second, third, legacySuccess: third === 0,
    missingBib: log.includes("I couldn't open database file"), missingEntry: log.includes("I didn't find a database entry"),
    finalUndefinedCitations: /Citation.*undefined/.test(finalLog) }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
