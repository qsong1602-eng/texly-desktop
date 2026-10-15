import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('texly', {
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (input: unknown) => ipcRenderer.invoke('projects:create', input),
    importZip: () => ipcRenderer.invoke('projects:import-zip'),
    openFolder: () => ipcRenderer.invoke('projects:open-folder'),
    remove: (id: string) => ipcRenderer.invoke('projects:remove', id),
    update: (id: string, patch: unknown) => ipcRenderer.invoke('projects:update', id, patch),
  },
  files: {
    tree: (projectId: string) => ipcRenderer.invoke('files:tree', projectId),
    read: (projectId: string, path: string) => ipcRenderer.invoke('files:read', projectId, path),
    write: (projectId: string, path: string, content: string) => ipcRenderer.invoke('files:write', projectId, path, content),
    create: (projectId: string, parent: string, name: string, type: string) => ipcRenderer.invoke('files:create', projectId, parent, name, type),
    remove: (projectId: string, path: string) => ipcRenderer.invoke('files:remove', projectId, path),
    reveal: (projectId: string) => ipcRenderer.invoke('files:reveal', projectId),
  },
  compile: {
    run: (projectId: string, clean = false) => ipcRenderer.invoke('compile:run', projectId, clean),
    pdf: (projectId: string) => ipcRenderer.invoke('compile:pdf', projectId),
    savePdf: (projectId: string) => ipcRenderer.invoke('compile:save-pdf', projectId),
    syncForward: (projectId: string, path: string, line: number, column: number) => ipcRenderer.invoke('sync:forward', projectId, path, line, column),
    syncReverse: (projectId: string, page: number, x: number, y: number) => ipcRenderer.invoke('sync:reverse', projectId, page, x, y),
  },
  system: {
    toolchain: () => ipcRenderer.invoke('system:toolchain'),
    installLatex: () => ipcRenderer.invoke('system:install-latex'),
  },
})
