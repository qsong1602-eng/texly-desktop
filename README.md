# TeXly

**A local-first LaTeX editor for Windows.** TeXly brings project management, source editing, local compilation, and PDF preview together in a desktop workspace inspired by familiar online LaTeX editors.

> 中文简介：TeXly 是一款面向 Windows 的本地 LaTeX 桌面编辑器，支持项目管理、源码编辑、本机编译和 PDF 预览。当前界面为中文。

## Features

- Create projects from Chinese and English templates, open a local folder, or import an Overleaf project ZIP.
- Edit LaTeX in Monaco with syntax highlighting, multiple tabs, and automatic saving.
- Arrange the file tree, editor, and PDF preview in a resizable workspace.
- Compile locally with XeLaTeX, LuaLaTeX, or pdfLaTeX; use `latexmk` when available or TeXly's multi-pass build flow.
- Resolve bibliographies with BibTeX or Biber and navigate between source and PDF with SyncTeX.
- Read PDFs with page navigation, zoom controls, text selection, and full-screen viewing.
- Detect MiKTeX or TeX Live installations. TeXly can also start an interactive MiKTeX installation through Windows Package Manager when available.

## Requirements

- Windows
- Node.js 20 or later and npm for development
- MiKTeX or TeX Live to compile LaTeX projects

TeXly detects the installed TeX distribution and its available engines. MiKTeX may download missing TeX packages when configured to do so.

## Run from source

```powershell
npm.cmd install
npm.cmd run dev
```

Build the app:

```powershell
npm.cmd run build
```

Create a Windows installer:

```powershell
npm.cmd run dist
```

The installer is written to `release/`.

## Tests and checks

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

The real-compiler integration suite requires MiKTeX or TeX Live. Set `TEXLY_TEST_TEX_BIN` to that distribution's binary directory before running it:

```powershell
$env:TEXLY_TEST_TEX_BIN = 'C:/path/to/your/tex/bin'
npm.cmd run test:integration
```

Set `TEXLY_TEST_PERL` to a native Windows Perl executable as well to exercise the `latexmk` integration cases. Test output is created under the ignored `test-project/` directory.

## Local files and privacy

TeXly works with project folders on the current computer and compiles them with local TeX tools. It does not provide a hosted project workspace or require a TeXly account. Project build products are written to each project's `.texly/build/` directory; source files remain in place. TeXly stores its project list in its application-specific local data folder.

The repository's `.gitignore` excludes local databases and logs, generated test projects, bundled research runtimes and models, credentials, PDFs, and LaTeX build products. Review files before committing if you add personal documents or local configuration.

## Project structure

- `src/` — React user interface
- `electron/` — desktop integration and LaTeX compilation
- `tests/` — automated checks and bibliography fixtures
- `package.json` — development, build, and test scripts

## License

No license has been specified in this repository yet.

