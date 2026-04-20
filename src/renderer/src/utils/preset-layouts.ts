import type { PresetLayoutType, TerminalGroup } from '../types/terminal-layout'
import { applyPresetLayoutToTree, isPresetEligibleLayout } from './layout-tree'

export function isGroupPresetEligible(group: Pick<TerminalGroup, 'layoutTree'>): boolean {
  return isPresetEligibleLayout(group.layoutTree)
}

export function applyPresetLayoutToGroup(
  group: TerminalGroup,
  layoutType: PresetLayoutType
): TerminalGroup {
  const nextPresetState = applyPresetLayoutToTree(group.layoutTree, layoutType, group.activeTerminalId)
  if (!nextPresetState) {
    return group
  }

  return {
    ...group,
    layoutTree: nextPresetState.layoutTree,
    terminalIds: nextPresetState.terminalIds,
    activeTerminalId: nextPresetState.activeTerminalId,
    focusedPanelId: nextPresetState.focusedPanelId
  }
}

export function applyPresetLayoutToGroups(
  groups: TerminalGroup[],
  groupId: string,
  layoutType: PresetLayoutType
): TerminalGroup[] {
  return groups.map((group) =>
    group.id === groupId ? applyPresetLayoutToGroup(group, layoutType) : group
  )
}
