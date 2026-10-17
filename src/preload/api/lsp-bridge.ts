import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import type { LspDiagnosticsPayload } from '../../shared/lsp-types'

export const lspApi = {
  openDocument: (args) => ipcRenderer.invoke('lsp:openDocument', args),
  changeDocument: (args) => ipcRenderer.invoke('lsp:changeDocument', args),
  closeDocument: (args) => ipcRenderer.invoke('lsp:closeDocument', args),
  request: (args) => ipcRenderer.invoke('lsp:request', args),
  onDiagnostics: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: LspDiagnosticsPayload): void =>
      callback(payload)
    ipcRenderer.on('lsp:diagnostics', listener)
    return () => ipcRenderer.removeListener('lsp:diagnostics', listener)
  }
} satisfies PreloadApi['lsp']
