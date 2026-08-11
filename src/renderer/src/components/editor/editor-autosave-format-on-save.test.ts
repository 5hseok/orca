import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'
import type { AppState } from '@/store'
import { attachEditorAutosaveController } from './editor-autosave-controller'
import {
  ORCA_EDITOR_FILE_SAVED_EVENT,
  requestEditorFileSave,
  type EditorFileSavedDetail
} from './editor-autosave'
import { createEditorStore, stubEditorWindow } from './editor-autosave-controller-test-fixture'
import { __clearSelfWriteRegistryForTests, hasRecentSelfWrite } from './editor-self-write-registry'

const UNFORMATTED = 'const a=1'
const FORMATTED = 'const a = 1\n'

let store: StoreApi<AppState>
let detach: () => void
let formatOnSave: ReturnType<typeof vi.fn>
let readFile: ReturnType<typeof vi.fn>
let writeFile: ReturnType<typeof vi.fn>

const FILE_ID = '/repo/src/a.ts'

function openEditableFile(): void {
  store.getState().openFile({
    filePath: FILE_ID,
    relativePath: 'src/a.ts',
    worktreeId: 'wt-1',
    language: 'typescript',
    mode: 'edit'
  } as never)
}

function savedContents(): string[] {
  return savedEvents
}

let savedEvents: string[] = []

beforeEach(() => {
  savedEvents = []
  formatOnSave = vi.fn().mockResolvedValue({ status: 'completed' })
  readFile = vi.fn().mockResolvedValue({ content: FORMATTED })
  writeFile = stubEditorWindow({ formatOnSave, readFile })
  store = createEditorStore()
  openEditableFile()
  detach = attachEditorAutosaveController(store)
  window.addEventListener(ORCA_EDITOR_FILE_SAVED_EVENT, ((
    event: CustomEvent<EditorFileSavedDetail>
  ) => {
    savedEvents.push(event.detail.content)
  }) as EventListener)
})

afterEach(() => {
  detach()
  __clearSelfWriteRegistryForTests()
  vi.unstubAllGlobals()
})

describe('format on save through the editor save queue', () => {
  it('adopts the formatted file into the buffer after the write', async () => {
    store.getState().setEditorDraft(FILE_ID, UNFORMATTED)
    await requestEditorFileSave({ fileId: FILE_ID })

    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: FILE_ID, content: UNFORMATTED })
    )
    expect(formatOnSave).toHaveBeenCalledWith({
      repoId: 'repo-1',
      worktreePath: '/repo',
      filePath: FILE_ID
    })
    expect(savedContents()).toEqual([FORMATTED])
    expect(store.getState().openFiles.find((file) => file.id === FILE_ID)?.isDirty).toBe(false)
  })

  it('suppresses the formatter write as an external change', async () => {
    store.getState().setEditorDraft(FILE_ID, UNFORMATTED)
    await requestEditorFileSave({ fileId: FILE_ID })

    // Why: without a re-stamp the watcher reports Orca's own formatting as a
    // changed-on-disk conflict on the very next event.
    expect(hasRecentSelfWrite(FILE_ID, undefined)).toBe(true)
  })

  it('keeps the typed buffer when the user edits while the formatter runs', async () => {
    let releaseFormat: ((value: { status: string }) => void) | undefined
    let markFormatStarted: (() => void) | undefined
    const formatStarted = new Promise<void>((resolve) => {
      markFormatStarted = resolve
    })
    formatOnSave.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseFormat = resolve as (value: { status: string }) => void
          markFormatStarted?.()
        })
    )

    store.getState().setEditorDraft(FILE_ID, UNFORMATTED)
    const save = requestEditorFileSave({ fileId: FILE_ID })
    await formatStarted

    store.getState().setEditorDraft(FILE_ID, `${UNFORMATTED}\nconst b=2`)
    releaseFormat?.({ status: 'completed' })
    await save

    // Why: the event reports what landed on disk, which is the formatted text.
    // The user's newer keystrokes stay in the draft and still win in the editor.
    expect(savedContents()).toEqual([FORMATTED])
    expect(store.getState().editorDrafts[FILE_ID]).toBe(`${UNFORMATTED}\nconst b=2`)
    expect(store.getState().openFiles.find((file) => file.id === FILE_ID)?.isDirty).toBe(true)
  })

  it('leaves the saved content alone when the formatter changes nothing', async () => {
    readFile.mockResolvedValue({ content: UNFORMATTED })
    store.getState().setEditorDraft(FILE_ID, UNFORMATTED)
    await requestEditorFileSave({ fileId: FILE_ID })

    expect(savedContents()).toEqual([UNFORMATTED])
  })

  it('still reports the save as successful when the formatter fails', async () => {
    formatOnSave.mockResolvedValue({ status: 'failed', message: 'SyntaxError' })
    store.getState().setEditorDraft(FILE_ID, UNFORMATTED)

    await expect(requestEditorFileSave({ fileId: FILE_ID })).resolves.toBeUndefined()
    expect(savedContents()).toEqual([UNFORMATTED])
    expect(readFile).not.toHaveBeenCalled()
  })
})
