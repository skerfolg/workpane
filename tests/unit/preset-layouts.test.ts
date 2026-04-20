import test from 'node:test'
import assert from 'node:assert/strict'
import type { LayoutNode, TerminalGroup } from '../../src/renderer/src/types/terminal-layout'
import {
  applyPresetLayoutToGroup,
  applyPresetLayoutToGroups,
  isGroupPresetEligible
} from '../../src/renderer/src/utils/preset-layouts'
import { getAllLeaves } from '../../src/renderer/src/utils/layout-tree'

function makeGroup(id: string, layoutTree: LayoutNode, activeTerminalId: string | null): TerminalGroup {
  return {
    id,
    name: id,
    layoutTree,
    terminalIds: getAllLeaves(layoutTree).flatMap((leaf) => leaf.terminalIds),
    activeTerminalId,
    focusedPanelId: getAllLeaves(layoutTree)[0]?.panelId ?? 'panel-fallback',
    collapsed: false
  }
}

test('isGroupPresetEligible returns false when any layout leaf contains browser ids', () => {
  const mixedGroup = makeGroup(
    'group-mixed',
    {
      type: 'leaf',
      panelId: 'panel-mixed',
      terminalIds: ['terminal-1'],
      browserIds: ['browser-1'],
      activeTerminalId: 'terminal-1'
    },
    'terminal-1'
  )

  assert.equal(isGroupPresetEligible(mixedGroup), false)
})

test('applyPresetLayoutToGroup reshapes eligible groups with the supported preset family', () => {
  const eligibleGroup = makeGroup(
    'group-eligible',
    {
      type: 'leaf',
      panelId: 'panel-root',
      terminalIds: ['terminal-1', 'terminal-2', 'terminal-3'],
      browserIds: [],
      activeTerminalId: 'terminal-2'
    },
    'terminal-2'
  )

  const updatedGroup = applyPresetLayoutToGroup(eligibleGroup, '2x2')

  assert.notDeepEqual(updatedGroup.layoutTree, eligibleGroup.layoutTree)
  assert.equal(updatedGroup.activeTerminalId, 'terminal-2')
  assert.equal(getAllLeaves(updatedGroup.layoutTree).length, 4)
  assert.deepEqual(updatedGroup.terminalIds.sort(), ['terminal-1', 'terminal-2', 'terminal-3'])
})

test('applyPresetLayoutToGroups updates only the targeted group and leaves others unchanged', () => {
  const sourceGroup = makeGroup(
    'group-1',
    {
      type: 'leaf',
      panelId: 'panel-1',
      terminalIds: ['terminal-1'],
      browserIds: [],
      activeTerminalId: 'terminal-1'
    },
    'terminal-1'
  )
  const targetGroup = makeGroup(
    'group-2',
    {
      type: 'leaf',
      panelId: 'panel-2',
      terminalIds: ['terminal-2', 'terminal-3'],
      browserIds: [],
      activeTerminalId: 'terminal-2'
    },
    'terminal-2'
  )

  const updatedGroups = applyPresetLayoutToGroups([sourceGroup, targetGroup], 'group-2', '2col')

  assert.deepEqual(updatedGroups[0], sourceGroup)
  assert.notDeepEqual(updatedGroups[1]?.layoutTree, targetGroup.layoutTree)
  assert.equal(getAllLeaves(updatedGroups[1]!.layoutTree).length, 2)
})

test('applyPresetLayoutToGroup leaves mixed-content groups unchanged', () => {
  const mixedGroup = makeGroup(
    'group-mixed',
    {
      type: 'leaf',
      panelId: 'panel-mixed',
      terminalIds: ['terminal-1'],
      browserIds: ['browser-1'],
      activeTerminalId: 'terminal-1'
    },
    'terminal-1'
  )

  const updatedGroup = applyPresetLayoutToGroup(mixedGroup, '2row')

  assert.deepEqual(updatedGroup, mixedGroup)
})
