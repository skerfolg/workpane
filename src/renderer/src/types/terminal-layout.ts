// Terminal split layout types — binary tree model (tmux-style)

export type SplitDirection = 'horizontal' | 'vertical'

export type PanelId = string

export type PresetLayoutType = '2col' | '2row' | '2x2'

export interface SplitNode {
  type: 'split'
  splitId: string
  direction: SplitDirection
  /** Ratio of the first child (0–1). Second child gets 1 - ratio. */
  ratio: number
  children: [LayoutNode, LayoutNode]
}

export interface LeafNode {
  type: 'leaf'
  panelId: PanelId
  terminalIds: string[]
  activeTerminalId: string | null
}

export type LayoutNode = SplitNode | LeafNode

// ---- Terminal Group ----

export interface TerminalGroup {
  id: string
  name: string
  layoutTree: LayoutNode
  terminalIds: string[]
  activeTerminalId: string | null
  focusedPanelId: string
  collapsed: boolean
}

// ---- Reducer actions for TerminalContext ----

export type TerminalAction =
  // Per-group actions (handled by inner reducer)
  | { type: 'CREATE_TERMINAL'; id: string; name: string; panelId: string }
  | { type: 'REMOVE_TERMINAL'; id: string }
  | { type: 'RENAME_TERMINAL'; id: string; name: string }
  | { type: 'SET_ACTIVE_TERMINAL'; id: string; panelId: string }
  | { type: 'SPLIT_PANEL'; panelId: string; direction: SplitDirection; newTerminalId?: string; newTerminalName?: string }
  | { type: 'CLOSE_PANEL'; panelId: string }
  | { type: 'MOVE_TERMINAL'; terminalId: string; fromPanelId: string; toPanelId: string }
  | { type: 'SPLIT_AND_MOVE_TERMINAL'; terminalId: string; fromPanelId: string; targetPanelId: string; direction: SplitDirection; insertBefore: boolean }
  | { type: 'SPLIT_ROOT_AND_MOVE_TERMINAL'; terminalId: string; fromPanelId: string; direction: SplitDirection; insertBefore: boolean }
  | { type: 'SET_FOCUSED_PANEL'; panelId: string }
  | { type: 'UPDATE_RATIO'; splitId: string; newRatio: number }
  | { type: 'APPLY_PRESET_LAYOUT'; layoutType: PresetLayoutType }
  // Group-level actions (handled by outer reducer)
  | { type: 'CREATE_GROUP'; groupId: string; name: string; terminalId: string; terminalName: string }
  | { type: 'DELETE_GROUP'; groupId: string }
  | { type: 'RENAME_GROUP'; groupId: string; name: string }
  | { type: 'SWITCH_GROUP'; groupId: string }
  | { type: 'TOGGLE_GROUP_COLLAPSE'; groupId: string }
  | { type: 'REORDER_TERMINALS'; fromIdx: number; toIdx: number }
  | { type: 'MOVE_TERMINAL_TO_GROUP'; terminalId: string; fromGroupId: string; toGroupId: string }
  | { type: 'RESTORE_STATE'; version: 2; terminals: Array<{ id: string; name: string }>; groups: TerminalGroup[]; activeGroupId: string }
  | { type: 'INIT_DEFAULT'; id: string }
