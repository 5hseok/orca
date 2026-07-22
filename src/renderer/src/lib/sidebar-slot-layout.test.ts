import { describe, expect, it } from 'vitest'
import { resolveSidebarSlotLayout } from './sidebar-slot-layout'

describe('resolveSidebarSlotLayout', () => {
  it('keeps the workspace list on the left by default', () => {
    expect(
      resolveSidebarSlotLayout({
        workspaceSidebarPosition: 'left',
        platform: 'darwin',
        isWebClient: false
      })
    ).toEqual({
      leftOccupant: 'workspace',
      rightOccupant: 'activity',
      windowControlsEdge: 'left',
      windowControlsOccupant: 'workspace'
    })
  })

  it('swaps both occupants when the workspace list moves right', () => {
    const layout = resolveSidebarSlotLayout({
      workspaceSidebarPosition: 'right',
      platform: 'darwin',
      isWebClient: false
    })
    expect(layout.leftOccupant).toBe('activity')
    expect(layout.rightOccupant).toBe('workspace')
  })

  it('charges the macOS traffic-light inset to whichever sidebar holds the left edge', () => {
    expect(
      resolveSidebarSlotLayout({
        workspaceSidebarPosition: 'right',
        platform: 'darwin',
        isWebClient: false
      }).windowControlsOccupant
    ).toBe('activity')
  })

  it('charges the custom-chrome inset to the right edge on Windows and Linux', () => {
    for (const platform of ['win32', 'linux'] as const) {
      expect(
        resolveSidebarSlotLayout({
          workspaceSidebarPosition: 'left',
          platform,
          isWebClient: false
        })
      ).toMatchObject({ windowControlsEdge: 'right', windowControlsOccupant: 'activity' })
      // Why: the same edge stays crowded, so swapping hands the inset to the workspace list.
      expect(
        resolveSidebarSlotLayout({
          workspaceSidebarPosition: 'right',
          platform,
          isWebClient: false
        }).windowControlsOccupant
      ).toBe('workspace')
    }
  })

  it('drops window-control insets in the web client, which draws no OS controls', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(
        resolveSidebarSlotLayout({
          workspaceSidebarPosition: 'left',
          platform,
          isWebClient: true
        })
      ).toMatchObject({ windowControlsEdge: null, windowControlsOccupant: null })
    }
  })
})
