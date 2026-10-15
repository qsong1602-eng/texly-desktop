import { AlertCircle, CheckCircle2, X } from 'lucide-react'

export interface ToastItem { id: number; kind: 'success' | 'error'; message: string }
export default function Toasts({ items, close }: { items: ToastItem[]; close(id: number): void }) {
  return <div className="toast-stack">{items.map(t => <div className={`toast ${t.kind}`} key={t.id}>{t.kind === 'success' ? <CheckCircle2 /> : <AlertCircle />}<span>{t.message}</span><button onClick={() => close(t.id)}><X size={15} /></button></div>)}</div>
}
