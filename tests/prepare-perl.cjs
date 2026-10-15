// Optional isolated native Perl for real latexmk tests. Does not change system PATH.
const fs = require('node:fs/promises')
const path = require('node:path')
const { createWriteStream, existsSync } = require('node:fs')
const { pipeline } = require('node:stream/promises')
const AdmZip = require('adm-zip')

async function main() {
  const archive = path.resolve('.downloads/texly-install-tl.zip')
  const output = path.resolve('.downloads/texly-test-perl')
  if (!existsSync(archive)) {
    // TeX Live's network installer includes a small native Perl runtime.
    const response = await fetch('https://mirrors.ctan.org/systems/texlive/tlnet/install-tl.zip')
    if (!response.ok) throw new Error(`Download failed: ${response.status}`)
    await pipeline(response.body, createWriteStream(archive))
  }
  const zip = new AdmZip(archive)
  let count = 0
  for (const entry of zip.getEntries()) {
    const match = entry.entryName.match(/(?:^|\/)tlpkg\/tlperl\/(.+)/)
    if (!match || entry.isDirectory) continue
    const target = path.resolve(output, match[1])
    if (!target.startsWith(output + path.sep)) throw new Error('Unsafe archive path')
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, entry.getData())
    count++
  }
  console.log(`Extracted ${count} Perl runtime files to ${output}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
