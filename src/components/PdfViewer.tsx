import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { Download, Expand, Focus, LoaderCircle, Maximize2, Minimize2, Minus, Plus, RotateCw } from 'lucide-react'
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PdfLocation } from '../types'

GlobalWorkerOptions.workerSrc = pdfWorker

export interface PdfPoint { page: number; x: number; y: number }
export type PdfSyncTarget = PdfLocation & { requestId: number }

interface Props {
  data: string | null
  compiling: boolean
  syncTarget: PdfSyncTarget | null
  selectedPoint: PdfPoint | null
  onCompile(): void
  onDownload(): void
  onPointChange(point: PdfPoint): void
}

export default function PdfViewer({ data, compiling, syncTarget, selectedPoint, onCompile, onDownload, onPointChange }: Props) {
  const panelRef = useRef<HTMLElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef(new Map<number, HTMLDivElement>())
  const [documentProxy, setDocumentProxy] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    let disposed = false
    if (!data) { setDocumentProxy(null); setPageCount(0); return }
    setLoading(true); setLoadError('')
    const task = getDocument({ data: decodeBase64(data), useSystemFonts: true })
    task.promise.then(pdf => {
      if (disposed) { pdf.destroy(); return }
      setDocumentProxy(previous => { previous?.destroy(); return pdf })
      setPageCount(pdf.numPages); setLoading(false)
    }).catch(error => { if (!disposed) { setLoadError(error instanceof Error ? error.message : String(error)); setLoading(false) } })
    return () => { disposed = true; task.destroy() }
  }, [data])

  useEffect(() => {
    if (!fullscreen) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [fullscreen])

  useEffect(() => {
    if (!syncTarget || !documentProxy) return
    const frame = requestAnimationFrame(() => pageRefs.current.get(syncTarget.page)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    return () => cancelAnimationFrame(frame)
  }, [syncTarget, documentProxy, zoom])

  async function fitWidth() {
    if (!documentProxy || !scrollerRef.current) return
    const page = await documentProxy.getPage(1)
    const natural = page.getViewport({ scale: 1 })
    const available = Math.max(240, scrollerRef.current.clientWidth - 48)
    setZoom(clamp(available / natural.width, .35, 2.5))
  }

  return <section ref={panelRef} className={`pdf-panel ${fullscreen ? 'pdf-fullscreen' : ''}`}>
    <div className="pdf-toolbar">
      <div className="pdf-toolbar-group">
        <button title="缩小" aria-label="缩小 PDF" onClick={() => setZoom(value => clamp(value - .15, .35, 3))} disabled={!data}><Minus size={15} /></button>
        <button className="zoom-value" title="适合宽度" onClick={fitWidth} disabled={!data}><Focus size={13} />{Math.round(zoom * 100)}%</button>
        <button title="放大" aria-label="放大 PDF" onClick={() => setZoom(value => clamp(value + .15, .35, 3))} disabled={!data}><Plus size={15} /></button>
      </div>
      <span className="pdf-page-count">{pageCount ? `${pageCount} 页` : 'PDF 预览'}</span>
      <div className="pdf-toolbar-group">
        <button title="重新编译" onClick={onCompile}><RotateCw className={compiling ? 'spinning' : ''} size={15} /></button>
        <button title="下载 PDF" onClick={onDownload} disabled={!data}><Download size={15} /></button>
        <button title={fullscreen ? '退出全屏' : '全屏预览'} onClick={() => setFullscreen(value => !value)} disabled={!data}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
      </div>
    </div>
    <div ref={scrollerRef} className="pdf-canvas">
      {documentProxy && <div className="pdf-pages">{Array.from({ length: pageCount }, (_, index) => {
        const page = index + 1
        return <PdfPage key={page} pdf={documentProxy} pageNumber={page} zoom={zoom} syncTarget={syncTarget?.page === page ? syncTarget : null} selectedPoint={selectedPoint?.page === page ? selectedPoint : null} onPointChange={onPointChange} register={node => { if (node) pageRefs.current.set(page, node); else pageRefs.current.delete(page) }} />
      })}</div>}
      {(loading || compiling) && <div className="pdf-busy"><LoaderCircle className="spinning" size={22} /><span>{compiling ? '正在排版…' : '正在载入 PDF…'}</span></div>}
      {!documentProxy && !loading && <div className="no-pdf"><div className="page-outline"><span>T<sup>E</sup>X</span></div><h3>{loadError ? 'PDF 无法打开' : '还没有 PDF'}</h3><p>{loadError || '点击“编译”生成第一份预览'}</p>{!loadError && <button className="primary" onClick={onCompile}>立即编译</button>}</div>}
    </div>
  </section>
}

function PdfPage({ pdf, pageNumber, zoom, syncTarget, selectedPoint, onPointChange, register }: {
  pdf: PDFDocumentProxy
  pageNumber: number
  zoom: number
  syncTarget: PdfSyncTarget | null
  selectedPoint: PdfPoint | null
  onPointChange(point: PdfPoint): void
  register(node: HTMLDivElement | null): void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 595, height: 842 })

  useEffect(() => {
    let disposed = false
    let renderTask: ReturnType<PDFPageProxy['render']> | undefined
    let textLayer: TextLayer | undefined
    ;(async () => {
      const page = await pdf.getPage(pageNumber)
      if (disposed || !canvasRef.current || !textRef.current) return
      const viewport = page.getViewport({ scale: zoom })
      setSize({ width: viewport.width, height: viewport.height })
      const canvas = canvasRef.current
      const context = canvas.getContext('2d')
      if (!context) return
      const outputScale = Math.max(1, window.devicePixelRatio || 1)
      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      renderTask = page.render({ canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] })
      await renderTask.promise
      if (disposed) return
      textRef.current.replaceChildren()
      textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: textRef.current, viewport })
      await textLayer.render()
    })().catch(error => { if (!disposed && error?.name !== 'RenderingCancelledException') console.error(error) })
    return () => { disposed = true; renderTask?.cancel(); textLayer?.cancel() }
  }, [pdf, pageNumber, zoom])

  function choosePoint(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    onPointChange({ page: pageNumber, x: clamp((event.clientX - rect.left) / zoom, 0, rect.width / zoom), y: clamp((event.clientY - rect.top) / zoom, 0, rect.height / zoom) })
  }

  return <div ref={register} className="pdf-page-shell" data-page={pageNumber} style={{ width: size.width, height: size.height, '--scale-factor': zoom } as CSSProperties} onMouseUp={choosePoint}>
    <canvas ref={canvasRef} />
    <div ref={textRef} className="textLayer" />
    {syncTarget && <div className="pdf-forward-highlight" style={{ left: syncTarget.x * zoom, top: syncTarget.y * zoom, width: Math.min(syncTarget.width * zoom, size.width - syncTarget.x * zoom), height: Math.max(8, syncTarget.height * zoom) }} />}
    {selectedPoint && <span className="pdf-sync-marker" style={{ left: selectedPoint.x * zoom, top: selectedPoint.y * zoom }}><Expand size={11} /></span>}
    <span className="pdf-page-number">{pageNumber}</span>
  </div>
}

function decodeBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)) }
