import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyPresetLayoutToTree,
  findLeafByTerminalId,
  isPresetEligibleLayout
} from '../../src/renderer/src/utils/layout-tree'
import type { LayoutNode } from '../../src/renderer/src/types/terminal-layout'

function leaf(panelId: string, terminalIds: string[], browserIds: string[] = []): LayoutNode {
  return {
    type: 'leaf',
    panelId,
    terminalIds,
    browserIds,
    activeTerminalId: terminalIds[0] ?? null
  }
}

function normalizeLayoutTree(node: LayoutNode): unknown {
  if (node.type === 'leaf') {
    return {
      type: 'leaf',
      terminalIds: node.terminalIds,
      browserIds: node.browserIds,
      activeTerminalId: node.activeTerminalId
    }
  }

  return {
    type: 'split',
    direction: node.direction,
    ratio: node.ratio,
    children: node.children.map((child) => normalizeLayoutTree(child))
  }
}

const expectedLayouts = {
  '2col': {
    type: 'split',
    direction: 'vertical',
    ratio: 0.5,
    children: [
      { type: 'leaf', terminalIds: ['terminal-1', 'terminal-3'], browserIds: [], activeTerminalId: 'terminal-1' },
      { type: 'leaf', terminalIds: ['terminal-2'], browserIds: [], activeTerminalId: 'terminal-2' }
    ]
  },
  '2row': {
    type: 'split',
    direction: 'horizontal',
    ratio: 0.5,
    children: [
      { type: 'leaf', terminalIds: ['terminal-1', 'terminal-3'], browserIds: [], activeTerminalId: 'terminal-1' },
      { type: 'leaf', terminalIds: ['terminal-2'], browserIds: [], activeTerminalId: 'terminal-2' }
    ]
  },
  '2x2': {
    type: 'split',
    direction: 'vertical',
    ratio: 0.5,
    children: [
      {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        children: [
          { type: 'leaf', terminalIds: ['terminal-1'], browserIds: [], activeTerminalId: 'terminal-1' },
          { type: 'leaf', terminalIds: ['terminal-3'], browserIds: [], activeTerminalId: 'terminal-3' }
        ]
      },
      {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        children: [
          { type: 'leaf', terminalIds: ['terminal-2'], browserIds: [], activeTerminalId: 'terminal-2' },
          { type: 'leaf', terminalIds: [], browserIds: [], activeTerminalId: null }
        ]
      }
    ]
  }
} as const

for (const layoutType of ['2col', '2row', '2x2'] as const) {
  test(`applyPresetLayoutToTree creates the ${layoutType} layout and preserves the preferred active terminal`, () => {
    const result = applyPresetLayoutToTree(leaf('panel-1', ['terminal-1', 'terminal-2', 'terminal-3']), layoutType, 'terminal-2')

    assert.ok(result)
    assert.deepEqual(normalizeLayoutTree(result.layoutTree), expectedLayouts[layoutType])
    assert.equal(result.activeTerminalId, 'terminal-2')

    const focusedLeaf = findLeafByTerminalId(result.layoutTree, 'terminal-2')
    assert.ok(focusedLeaf)
    assert.equal(result.focusedPanelId, focusedLeaf.panelId)
  })
}

test('isPresetEligibleLayout rejects leaves that already contain browser tabs', () => {
  const mixedContentTree: LayoutNode = {
    type: 'split',
    splitId: 'panel-3',
    direction: 'vertical',
    ratio: 0.5,
    children: [leaf('panel-1', ['terminal-1']), leaf('panel-2', ['terminal-2'], ['browser-1'])]
  }

  assert.equal(isPresetEligibleLayout(mixedContentTree), false)
  assert.equal(applyPresetLayoutToTree(mixedContentTree, '2col', 'terminal-1'), null)
})
