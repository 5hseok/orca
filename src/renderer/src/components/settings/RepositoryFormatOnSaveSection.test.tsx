// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { Repo, RepoFormatOnSaveSettings } from '../../../../shared/types'
import { RepositoryFormatOnSaveSection } from './RepositoryFormatOnSaveSection'

let container: HTMLDivElement
let root: Root
let onUpdateFormatOnSave: Mock<(next: RepoFormatOnSaveSettings) => void>

const baseRepo: Repo = {
  id: 'repo-1',
  path: '/tmp/repo',
  displayName: 'Example Repo',
  badgeColor: '#000000',
  addedAt: 1,
  kind: 'git'
}

function render(repo: Repo = baseRepo): void {
  act(() => {
    root.render(
      React.createElement(RepositoryFormatOnSaveSection, {
        repo,
        forceVisible: true,
        onUpdateFormatOnSave
      })
    )
  })
}

function input(id: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(`#${id}`)
  if (!element) {
    throw new Error(`missing input ${id}`)
  }
  return element
}

function typeAndBlur(id: string, value: string): void {
  const element = input(id)
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => {
    // Why: React delegates blur through the bubbling focusout event.
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

beforeEach(() => {
  onUpdateFormatOnSave = vi.fn<(next: RepoFormatOnSaveSettings) => void>()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('RepositoryFormatOnSaveSection', () => {
  it('tells the user why the toggle cannot be turned on yet', () => {
    render()
    expect(container.textContent).toContain('Set a formatter command below to turn this on.')
  })

  it('commits a typed command on blur', () => {
    render()
    typeAndBlur('format-on-save-command', '  npx prettier --write ${file}  ')

    expect(onUpdateFormatOnSave).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'npx prettier --write ${file}' })
    )
  })

  it('parses the include field into globs', () => {
    render({
      ...baseRepo,
      formatOnSave: { enabled: true, command: 'prettier --write ${file}', include: [] }
    })
    typeAndBlur('format-on-save-include', '**/*.ts, **/*.md')

    expect(onUpdateFormatOnSave).toHaveBeenCalledWith(
      expect.objectContaining({ include: ['**/*.ts', '**/*.md'] })
    )
  })

  it('clearing the command also turns the feature off', () => {
    render({
      ...baseRepo,
      formatOnSave: { enabled: true, command: 'prettier --write ${file}', include: [] }
    })
    typeAndBlur('format-on-save-command', '')

    const next = onUpdateFormatOnSave.mock.calls[0][0]
    expect(next).toEqual(expect.objectContaining({ command: '', enabled: false }))
  })

  it('does not write back when the field is left unchanged', () => {
    render({
      ...baseRepo,
      formatOnSave: { enabled: true, command: 'prettier --write ${file}', include: ['**/*.ts'] }
    })
    typeAndBlur('format-on-save-command', 'prettier --write ${file}')
    typeAndBlur('format-on-save-include', '**/*.ts')

    expect(onUpdateFormatOnSave).not.toHaveBeenCalled()
  })

  it('warns that a remote project is saved unformatted', () => {
    render({ ...baseRepo, connectionId: 'ssh-target-1' })
    expect(container.textContent).toContain('This project runs on a remote host')
  })

  it('says nothing about remote hosts for a local project', () => {
    render()
    expect(container.textContent).not.toContain('This project runs on a remote host')
  })
})
