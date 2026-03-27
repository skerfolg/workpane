import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'
import type {
  LayoutNode,
  TerminalAction,
  SplitDirection,
  PresetLayoutType,
  TerminalGroup,
  LeafNode
} from '../types/terminal-layout'
import {
  splitPanel as splitPanelTree,
  splitRoot as splitRootTree,
  closePanel as closePanelTree,
  moveTerminalToPanel as moveTerminalTree,
  updateRatio as updateRatioTree,
  createPresetLayout,
  generatePanelId,
  getAllLeaves,
  findLeafByTerminalId,
  deserializeLayout,
  serializeLayout,
  syncPanelCounter
} from '../utils/layout-tree'

export interface TerminalTab {
  id: string
  name: string
}

// ---- State ----

interface TerminalState {
  terminals: TerminalTab[]
  groups: TerminalGroup[]
  activeGroupId: string
}

// Inner reducer operates on this sub-shape (same field names as old TerminalState)
interface GroupState {
  terminals: TerminalTab[]
  activeTerminalId: string | null
  layoutTree: LayoutNode
  focusedPanelId: string
}

// ---- Helper ----

function getActiveGroup(state: TerminalState): TerminalGroup {
  return state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0]
}

// ---- Context value ----

export interface DragSourceInfo {
  terminalId: string
  sourcePanelId: string
}

interface TerminalContextValue {
  terminals: TerminalTab[]
  activeTerminalId: string | null
  layoutTree: LayoutNode
  focusedPanelId: string
  groups: TerminalGroup[]
  activeGroupId: string
  isDraggingTab: boolean
  dragSourceInfo: DragSourceInfo | null
  setDragState: (info: DragSourceInfo | null) => void
  createTerminal: () => Promise<void>
  removeTerminal: (id: string) => void
  renameTerminal: (id: string, newName: string) => void
  setActiveTerminal: (id: string, panelId?: string) => void
  /** Alias for setActiveTerminal with panelId first — used by TerminalPanel */
  setActiveTerminalInPanel: (panelId: string, terminalId: string) => void
  reorderTerminals: (fromIdx: number, toIdx: number) => void
  splitPanel: (panelId: string, direction: SplitDirection) => Promise<void>
  /** Split a panel without creating a new terminal — used by drag-to-split */
  splitPanelEmpty: (panelId: string, direction: SplitDirection) => void
  closePanel: (panelId: string) => Promise<void>
  moveTerminalToPanel: (terminalId: string, fromPanelId: string, toPanelId: string) => void
  /** Atomically split target panel and move a terminal into the new panel */
  splitAndMoveTerminal: (terminalId: string, fromPanelId: string, targetPanelId: string, direction: SplitDirection, insertBefore: boolean) => void
  /** Atomically split at root level (spanning) and move a terminal into the new panel */
  splitRootAndMoveTerminal: (terminalId: string, fromPanelId: string, direction: SplitDirection, insertBefore: boolean) => void
  setFocusedPanel: (panelId: string) => void
  applyPresetLayout: (layoutType: PresetLayoutType) => void
  createGroup: () => Promise<void>
  deleteGroup: (groupId: string) => Promise<void>
  renameGroup: (groupId: string, name: string) => void
  switchGroup: (groupId: string) => void
  toggleGroupCollapse: (groupId: string) => void
  moveTerminalToGroup: (terminalId: string, fromGroupId: string, toGroupId: string) => void
}

// ---- SplitRatioContext — isolated to avoid re-rendering entire tree on drag ----

interface SplitRatioContextValue {
  updateSplitRatio: (splitId: string, newRatio: number) => void
}

export const SplitRatioContext = createContext<SplitRatioContextValue | null>(null)

export function useSplitRatio(): SplitRatioContextValue {
  const ctx = useContext(SplitRatioContext)
  if (!ctx) throw new Error('useSplitRatio must be used within TerminalProvider')
  return ctx
}

// ---- Exported context and hook ----

export const TerminalContext = createContext<TerminalContextValue | null>(null)

export function useTerminals(): TerminalContextValue {
  const ctx = useContext(TerminalContext)
  if (!ctx) throw new Error('useTerminals must be used within TerminalProvider')
  return ctx
}

// ---- Initial state factory ----

function makeInitialLeaf(): LayoutNode {
  return {
    type: 'leaf',
    panelId: generatePanelId(),
    terminalIds: [],
    activeTerminalId: null
  }
}

function makeInitialState(): TerminalState {
  const leaf = makeInitialLeaf()
  const panelId = (leaf as LeafNode).panelId
  const groupId = 'group-1'
  return {
    terminals: [],
    groups: [
      {
        id: groupId,
        name: 'Group 1',
        layoutTree: leaf,
        terminalIds: [],
        activeTerminalId: null,
        focusedPanelId: panelId,
        collapsed: false
      }
    ],
    activeGroupId: groupId
  }
}

// ---- Inner reducer (operates on GroupState sub-shape) ----

function innerReducer(state: GroupState, action: TerminalAction): GroupState {
  switch (action.type) {
    case 'CREATE_TERMINAL': {
      const { id, name, panelId } = action
      const newTerminal: TerminalTab = { id, name }
      const newTree = addTerminalToPanel(state.layoutTree, panelId, id)
      return {
        ...state,
        terminals: [...state.terminals, newTerminal],
        activeTerminalId: id,
        layoutTree: newTree,
        focusedPanelId: panelId
      }
    }

    case 'REMOVE_TERMINAL': {
      const { id } = action
      const nextTerminals = state.terminals.filter((t) => t.id !== id)

      // Remove terminal from its panel in the layout tree
      let newTree = removeTerminalFromTree(state.layoutTree, id)

      // If a leaf becomes empty, close it (unless it's the last panel)
      const leaves = getAllLeaves(newTree)
      const emptyLeaves = leaves.filter((l) => l.terminalIds.length === 0)
      for (const emptyLeaf of emptyLeaves) {
        const afterClose = closePanelTree(newTree, emptyLeaf.panelId)
        if (afterClose !== null) {
          newTree = afterClose
        }
      }

      // Determine new active terminal — scoped to group terminals via layout tree
      const groupTerminalIds = getAllLeaves(newTree).flatMap((l) => l.terminalIds)
      let newActiveId = state.activeTerminalId
      if (newActiveId === id) {
        if (groupTerminalIds.length === 0) {
          newActiveId = null
        } else {
          // Pick adjacent terminal in group scope
          const oldGroupIds = getAllLeaves(state.layoutTree).flatMap((l) => l.terminalIds)
          const oldIdx = oldGroupIds.indexOf(id)
          const newIdx = Math.min(oldIdx, groupTerminalIds.length - 1)
          newActiveId = groupTerminalIds[Math.max(0, newIdx)]
        }
      }

      // Determine new focused panel
      let newFocusedPanelId = state.focusedPanelId
      const allLeaves = getAllLeaves(newTree)
      const focusedStillExists = allLeaves.some((l) => l.panelId === state.focusedPanelId)
      if (!focusedStillExists && allLeaves.length > 0) {
        newFocusedPanelId = allLeaves[0].panelId
      }

      return {
        ...state,
        terminals: nextTerminals,
        activeTerminalId: newActiveId,
        layoutTree: newTree,
        focusedPanelId: newFocusedPanelId
      }
    }

    case 'RENAME_TERMINAL': {
      return {
        ...state,
        terminals: state.terminals.map((t) =>
          t.id === action.id ? { ...t, name: action.name } : t
        )
      }
    }

    case 'SET_ACTIVE_TERMINAL': {
      const { id, panelId } = action
      const newTree = setActiveInPanel(state.layoutTree, panelId, id)
      return {
        ...state,
        activeTerminalId: id,
        layoutTree: newTree,
        focusedPanelId: panelId
      }
    }

    case 'SPLIT_PANEL': {
      const { panelId, direction, newTerminalId, newTerminalName } = action
      const newTree = splitPanelTree(state.layoutTree, panelId, direction, newTerminalId, newTerminalName)
      const newTerminals = newTerminalId && newTerminalName
        ? [...state.terminals, { id: newTerminalId, name: newTerminalName }]
        : state.terminals
      const newActiveId = newTerminalId ?? state.activeTerminalId

      const allLeaves = getAllLeaves(newTree)
      let newFocusedPanelId = state.focusedPanelId
      if (newTerminalId) {
        const newLeaf = allLeaves.find((l) => l.terminalIds.includes(newTerminalId))
        if (newLeaf) newFocusedPanelId = newLeaf.panelId
      }

      return {
        ...state,
        terminals: newTerminals,
        activeTerminalId: newActiveId,
        layoutTree: newTree,
        focusedPanelId: newFocusedPanelId
      }
    }

    case 'CLOSE_PANEL': {
      const afterClose = closePanelTree(state.layoutTree, action.panelId)
      if (afterClose === null) return state
      const allLeaves = getAllLeaves(afterClose)
      let newFocusedPanelId = state.focusedPanelId
      const focusedStillExists = allLeaves.some((l) => l.panelId === state.focusedPanelId)
      if (!focusedStillExists && allLeaves.length > 0) {
        newFocusedPanelId = allLeaves[0].panelId
      }
      return {
        ...state,
        layoutTree: afterClose,
        focusedPanelId: newFocusedPanelId
      }
    }

    case 'MOVE_TERMINAL': {
      const { terminalId, fromPanelId, toPanelId } = action
      let newTree = moveTerminalTree(state.layoutTree, terminalId, fromPanelId, toPanelId)

      const fromLeaf = getAllLeaves(newTree).find((l) => l.panelId === fromPanelId)
      if (fromLeaf && fromLeaf.terminalIds.length === 0) {
        const afterClose = closePanelTree(newTree, fromPanelId)
        if (afterClose !== null) newTree = afterClose
      }

      return {
        ...state,
        layoutTree: newTree,
        focusedPanelId: toPanelId
      }
    }

    case 'SPLIT_AND_MOVE_TERMINAL': {
      const { terminalId, fromPanelId, targetPanelId, direction, insertBefore } = action
      const splitTree = splitPanelTree(state.layoutTree, targetPanelId, direction, undefined, undefined, insertBefore)
      const originalLeafIds = new Set(getAllLeaves(state.layoutTree).map((l) => l.panelId))
      const newLeaf = getAllLeaves(splitTree).find((l) => !originalLeafIds.has(l.panelId))
      if (!newLeaf) return state
      let newTree = moveTerminalTree(splitTree, terminalId, fromPanelId, newLeaf.panelId)
      const fromLeaf = getAllLeaves(newTree).find((l) => l.panelId === fromPanelId)
      if (fromLeaf && fromLeaf.terminalIds.length === 0) {
        const afterClose = closePanelTree(newTree, fromPanelId)
        if (afterClose !== null) newTree = afterClose
      }
      return {
        ...state,
        layoutTree: newTree,
        focusedPanelId: newLeaf.panelId
      }
    }

    case 'SPLIT_ROOT_AND_MOVE_TERMINAL': {
      const { terminalId, fromPanelId, direction, insertBefore } = action
      const splitTree = splitRootTree(state.layoutTree, direction, insertBefore)
      const originalLeafIds = new Set(getAllLeaves(state.layoutTree).map((l) => l.panelId))
      const newLeaf = getAllLeaves(splitTree).find((l) => !originalLeafIds.has(l.panelId))
      if (!newLeaf) return state
      let newTree = moveTerminalTree(splitTree, terminalId, fromPanelId, newLeaf.panelId)
      const fromLeaf = getAllLeaves(newTree).find((l) => l.panelId === fromPanelId)
      if (fromLeaf && fromLeaf.terminalIds.length === 0) {
        const afterClose = closePanelTree(newTree, fromPanelId)
        if (afterClose !== null) newTree = afterClose
      }
      return {
        ...state,
        layoutTree: newTree,
        focusedPanelId: newLeaf.panelId
      }
    }

    case 'SET_FOCUSED_PANEL': {
      return { ...state, focusedPanelId: action.panelId }
    }

    case 'UPDATE_RATIO': {
      const newTree = updateRatioTree(state.layoutTree, action.splitId, action.newRatio)
      return { ...state, layoutTree: newTree }
    }

    case 'APPLY_PRESET_LAYOUT': {
      // Use only terminals from the active group's layout tree, not global state.terminals
      const terminalIds = getAllLeaves(state.layoutTree).flatMap((l) => l.terminalIds)
      const newTree = createPresetLayout(action.layoutType, terminalIds)
      const allLeaves = getAllLeaves(newTree)
      const newFocusedPanelId = allLeaves[0]?.panelId ?? state.focusedPanelId
      return {
        ...state,
        layoutTree: newTree,
        focusedPanelId: newFocusedPanelId
      }
    }

    default:
      return state
  }
}

// ---- Outer reducer (group-level + delegates to inner) ----

function terminalGroupReducer(state: TerminalState, action: TerminalAction): TerminalState {
  switch (action.type) {
    case 'INIT_DEFAULT': {
      const leaf = makeInitialLeaf()
      const panelId = (leaf as LeafNode).panelId
      const groupId = state.activeGroupId || 'group-1'
      return {
        terminals: [{ id: action.id, name: 'Terminal 1' }],
        groups: [
          {
            id: groupId,
            name: 'Group 1',
            layoutTree: { ...leaf, terminalIds: [action.id], activeTerminalId: action.id } as LayoutNode,
            terminalIds: [action.id],
            activeTerminalId: action.id,
            focusedPanelId: panelId,
            collapsed: false
          }
        ],
        activeGroupId: groupId
      }
    }

    case 'RESTORE_STATE': {
      return {
        terminals: action.terminals,
        groups: action.groups,
        activeGroupId: action.activeGroupId
      }
    }

    case 'CREATE_GROUP': {
      const { groupId, name, terminalId, terminalName } = action
      const leaf = makeInitialLeaf()
      const panelId = (leaf as LeafNode).panelId
      const newTerminal: TerminalTab = { id: terminalId, name: terminalName }
      const newGroup: TerminalGroup = {
        id: groupId,
        name,
        layoutTree: { ...leaf, terminalIds: [terminalId], activeTerminalId: terminalId } as LayoutNode,
        terminalIds: [terminalId],
        activeTerminalId: terminalId,
        focusedPanelId: panelId,
        collapsed: false
      }
      return {
        terminals: [...state.terminals, newTerminal],
        groups: [...state.groups, newGroup],
        activeGroupId: groupId
      }
    }

    case 'DELETE_GROUP': {
      const { groupId } = action
      const group = state.groups.find((g) => g.id === groupId)
      if (!group) return state
      const terminalIdsToRemove = new Set(group.terminalIds)
      const nextTerminals = state.terminals.filter((t) => !terminalIdsToRemove.has(t.id))
      const nextGroups = state.groups.filter((g) => g.id !== groupId)
      let nextActiveGroupId = state.activeGroupId
      if (nextActiveGroupId === groupId && nextGroups.length > 0) {
        nextActiveGroupId = nextGroups[0].id
      }
      return {
        terminals: nextTerminals,
        groups: nextGroups,
        activeGroupId: nextActiveGroupId
      }
    }

    case 'RENAME_GROUP': {
      return {
        ...state,
        groups: state.groups.map((g) =>
          g.id === action.groupId ? { ...g, name: action.name } : g
        )
      }
    }

    case 'SWITCH_GROUP': {
      return { ...state, activeGroupId: action.groupId }
    }

    case 'TOGGLE_GROUP_COLLAPSE': {
      return {
        ...state,
        groups: state.groups.map((g) =>
          g.id === action.groupId ? { ...g, collapsed: !g.collapsed } : g
        )
      }
    }

    case 'REORDER_TERMINALS': {
      const activeGroup = getActiveGroup(state)
      const nextIds = [...activeGroup.terminalIds]
      const [moved] = nextIds.splice(action.fromIdx, 1)
      nextIds.splice(action.toIdx, 0, moved)
      return {
        ...state,
        groups: state.groups.map((g) =>
          g.id === state.activeGroupId ? { ...g, terminalIds: nextIds } : g
        )
      }
    }

    case 'MOVE_TERMINAL_TO_GROUP': {
      const { terminalId, fromGroupId, toGroupId } = action
      const fromGroup = state.groups.find((g) => g.id === fromGroupId)
      const toGroup = state.groups.find((g) => g.id === toGroupId)
      if (!fromGroup || !toGroup) return state

      // Remove terminal from source group layout
      let fromTree = removeTerminalFromTree(fromGroup.layoutTree, terminalId)
      // Close empty leaves in source
      const emptyLeaves = getAllLeaves(fromTree).filter((l) => l.terminalIds.length === 0)
      for (const emptyLeaf of emptyLeaves) {
        const afterClose = closePanelTree(fromTree, emptyLeaf.panelId)
        if (afterClose !== null) fromTree = afterClose
      }
      const fromTerminalIds = fromGroup.terminalIds.filter((id) => id !== terminalId)
      let fromActiveTerminalId = fromGroup.activeTerminalId
      if (fromActiveTerminalId === terminalId) {
        fromActiveTerminalId = fromTerminalIds[0] ?? null
      }
      let fromFocusedPanelId = fromGroup.focusedPanelId
      const fromLeaves = getAllLeaves(fromTree)
      if (!fromLeaves.some((l) => l.panelId === fromFocusedPanelId) && fromLeaves.length > 0) {
        fromFocusedPanelId = fromLeaves[0].panelId
      }

      // Add terminal to target group's focused panel
      const toFocusedLeaf = getAllLeaves(toGroup.layoutTree).find(
        (l) => l.panelId === toGroup.focusedPanelId
      ) ?? getAllLeaves(toGroup.layoutTree)[0]
      const targetPanelId = toFocusedLeaf?.panelId ?? toGroup.focusedPanelId
      const toTree = addTerminalToPanel(toGroup.layoutTree, targetPanelId, terminalId)
      const toTerminalIds = [...toGroup.terminalIds, terminalId]

      return {
        ...state,
        groups: state.groups.map((g) => {
          if (g.id === fromGroupId) {
            return {
              ...g,
              layoutTree: fromTree,
              terminalIds: fromTerminalIds,
              activeTerminalId: fromActiveTerminalId,
              focusedPanelId: fromFocusedPanelId
            }
          }
          if (g.id === toGroupId) {
            return {
              ...g,
              layoutTree: toTree,
              terminalIds: toTerminalIds,
              activeTerminalId: terminalId,
              focusedPanelId: targetPanelId
            }
          }
          return g
        })
      }
    }

    // All other actions: delegate to inner reducer on active group's sub-state
    default: {
      const activeGroup = getActiveGroup(state)
      if (!activeGroup) return state
      const groupState: GroupState = {
        terminals: state.terminals,
        layoutTree: activeGroup.layoutTree,
        activeTerminalId: activeGroup.activeTerminalId,
        focusedPanelId: activeGroup.focusedPanelId
      }
      const newGroupState = innerReducer(groupState, action)
      // If inner reducer returned the same reference, nothing changed
      if (newGroupState === groupState) return state
      return {
        ...state,
        terminals: newGroupState.terminals,
        groups: state.groups.map((g) =>
          g.id === state.activeGroupId
            ? {
                ...g,
                layoutTree: newGroupState.layoutTree,
                activeTerminalId: newGroupState.activeTerminalId,
                focusedPanelId: newGroupState.focusedPanelId,
                terminalIds: getAllLeaves(newGroupState.layoutTree).flatMap((l) => l.terminalIds)
              }
            : g
        )
      }
    }
  }
}

// ---- Tree mutation helpers (local, not exported) ----

function addTerminalToPanel(tree: LayoutNode, panelId: string, terminalId: string): LayoutNode {
  if (tree.type === 'leaf') {
    if (tree.panelId !== panelId) return tree
    return {
      ...tree,
      terminalIds: [...tree.terminalIds, terminalId],
      activeTerminalId: terminalId
    }
  }
  return {
    ...tree,
    children: [
      addTerminalToPanel(tree.children[0], panelId, terminalId),
      addTerminalToPanel(tree.children[1], panelId, terminalId)
    ]
  }
}

function removeTerminalFromTree(tree: LayoutNode, terminalId: string): LayoutNode {
  if (tree.type === 'leaf') {
    if (!tree.terminalIds.includes(terminalId)) return tree
    const nextIds = tree.terminalIds.filter((id) => id !== terminalId)
    const nextActive =
      tree.activeTerminalId === terminalId
        ? nextIds[nextIds.length - 1] ?? null
        : tree.activeTerminalId
    return { ...tree, terminalIds: nextIds, activeTerminalId: nextActive }
  }
  return {
    ...tree,
    children: [
      removeTerminalFromTree(tree.children[0], terminalId),
      removeTerminalFromTree(tree.children[1], terminalId)
    ]
  }
}

function setActiveInPanel(tree: LayoutNode, panelId: string, terminalId: string): LayoutNode {
  if (tree.type === 'leaf') {
    if (tree.panelId !== panelId) return tree
    return { ...tree, activeTerminalId: terminalId }
  }
  return {
    ...tree,
    children: [
      setActiveInPanel(tree.children[0], panelId, terminalId),
      setActiveInPanel(tree.children[1], panelId, terminalId)
    ]
  }
}

// ---- Provider ----

export function TerminalProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const counterRef = useRef(0)
  const groupCounterRef = useRef(0)
  const [state, dispatch] = useReducer(terminalGroupReducer, undefined, makeInitialState)
  // stateRef always points to the latest state, for use inside callbacks without stale closure issues
  const stateRef = useRef(state)
  stateRef.current = state

  // Global drag state for tab drag-and-drop overlays
  const [dragSourceInfo, setDragSourceInfo] = useState<DragSourceInfo | null>(null)
  const setDragState = useCallback((info: DragSourceInfo | null) => {
    setDragSourceInfo(info)
  }, [])

  // Workspace-scoped terminal state cache: maps workspace path → saved TerminalState
  const workspaceStatesRef = useRef<Map<string, TerminalState>>(new Map())
  // Track the currently active workspace path
  const currentWorkspaceRef = useRef<string | null>(null)

  const generateId = useCallback((): string => {
    counterRef.current += 1
    return `terminal-${counterRef.current}`
  }, [])

  const generateGroupId = useCallback((): string => {
    groupCounterRef.current += 1
    return `group-${groupCounterRef.current}`
  }, [])

  // Initialize terminals when workspace becomes available
  const initTerminals = useCallback(
    async (workspaceCwd: string): Promise<void> => {
      // Same workspace — no-op
      if (currentWorkspaceRef.current === workspaceCwd) return

      // Save current workspace state before switching (if not first load)
      if (currentWorkspaceRef.current !== null) {
        const cur = stateRef.current
        workspaceStatesRef.current.set(currentWorkspaceRef.current, {
          terminals: cur.terminals,
          groups: cur.groups,
          activeGroupId: cur.activeGroupId
        })
      }

      currentWorkspaceRef.current = workspaceCwd

      // Fast path: restore from in-memory cache (no IPC, no PTY creation)
      if (workspaceStatesRef.current.has(workspaceCwd)) {
        const cached = workspaceStatesRef.current.get(workspaceCwd)!
        dispatch({
          type: 'RESTORE_STATE',
          version: 2,
          terminals: cached.terminals,
          groups: cached.groups,
          activeGroupId: cached.activeGroupId
        })
        return
      }

      const wsApi = (window as any).workspace
      const termApi = (window as any).terminal
      let restored = false
      const restoreStart = performance.now()

      if (wsApi) {
        try {
          const ipcStart = performance.now()
          const savedState = await wsApi.getState()
          console.log(`[PERF][Renderer] IPC getState RTT: ${(performance.now() - ipcStart).toFixed(1)}ms`)
          if (
            savedState?.terminals &&
            Array.isArray(savedState.terminals) &&
            savedState.terminals.length > 0
          ) {
            const restoredTerminals: TerminalTab[] = savedState.terminals

            // Update terminal counter to avoid ID collisions
            restoredTerminals.forEach((t: TerminalTab) => {
              const num = parseInt(t.id.replace('terminal-', ''), 10)
              if (!isNaN(num) && num > counterRef.current) {
                counterRef.current = num
              }
            })

            const terminalIdSet = new Set(restoredTerminals.map((t) => t.id))

            let groups: TerminalGroup[]
            let activeGroupId: string

            if (savedState.version === 2 && Array.isArray(savedState.groups)) {
              // V2: restore groups directly
              groups = savedState.groups.map((g: any) => {
                let layoutTree: LayoutNode
                try {
                  layoutTree = deserializeLayout(g.layoutTree)
                  layoutTree = pruneOrphanedTerminals(layoutTree, terminalIdSet)
                } catch {
                  layoutTree = makeSingleLeafWithTerminals(g.terminalIds?.filter((id: string) => terminalIdSet.has(id)) ?? [])
                }
                const validTerminalIds = (g.terminalIds ?? []).filter((id: string) => terminalIdSet.has(id))
                const allLeaves = getAllLeaves(layoutTree)
                const focusedPanelId =
                  (g.focusedPanelId && allLeaves.some((l) => l.panelId === g.focusedPanelId)
                    ? g.focusedPanelId
                    : allLeaves[0]?.panelId) ?? generatePanelId()
                return {
                  id: g.id,
                  name: g.name,
                  layoutTree,
                  terminalIds: validTerminalIds,
                  activeTerminalId: g.activeTerminalId && terminalIdSet.has(g.activeTerminalId)
                    ? g.activeTerminalId
                    : validTerminalIds[0] ?? null,
                  focusedPanelId,
                  collapsed: g.collapsed ?? false
                } satisfies TerminalGroup
              })
              activeGroupId = savedState.activeGroupId
              // Validate activeGroupId
              if (!groups.some((g) => g.id === activeGroupId) && groups.length > 0) {
                activeGroupId = groups[0].id
              }
            } else {
              // V1 (legacy): migrate to single default group
              let layoutTree: LayoutNode
              if (savedState.layoutTree) {
                try {
                  layoutTree = deserializeLayout(savedState.layoutTree)
                  layoutTree = pruneOrphanedTerminals(layoutTree, terminalIdSet)
                } catch {
                  layoutTree = makeSingleLeafWithTerminals(restoredTerminals.map((t) => t.id))
                }
              } else {
                layoutTree = makeSingleLeafWithTerminals(restoredTerminals.map((t) => t.id))
              }

              const allLeaves = getAllLeaves(layoutTree)
              const focusedPanelId =
                (savedState.focusedPanelId &&
                  allLeaves.some((l) => l.panelId === savedState.focusedPanelId)
                  ? savedState.focusedPanelId
                  : allLeaves[0]?.panelId) ?? generatePanelId()

              const defaultGroup: TerminalGroup = {
                id: 'group-1',
                name: 'Group 1',
                layoutTree,
                terminalIds: restoredTerminals.map((t) => t.id),
                activeTerminalId: savedState.activeTerminalId ?? restoredTerminals[0].id,
                focusedPanelId,
                collapsed: false
              }
              groups = [defaultGroup]
              activeGroupId = 'group-1'
            }

            // Sync panel counter across all groups
            syncPanelCounter(groups)

            // Sync group counter
            for (const g of groups) {
              const num = parseInt(g.id.replace('group-', ''), 10)
              if (!isNaN(num) && num > groupCounterRef.current) {
                groupCounterRef.current = num
              }
            }

            // Create PTY processes for restored terminals in parallel
            if (termApi) {
              const ptyStart = performance.now()
              await Promise.all(
                restoredTerminals.map((t) => termApi.create(t.id, undefined, workspaceCwd))
              )
              console.log(`[PERF][Renderer] IPC PTY restore (${restoredTerminals.length} terminals) RTT: ${(performance.now() - ptyStart).toFixed(1)}ms`)
            }

            dispatch({
              type: 'RESTORE_STATE',
              version: 2,
              terminals: restoredTerminals,
              groups,
              activeGroupId
            })
            restored = true
            console.log(`[PERF][Renderer] TerminalContext state restore total: ${(performance.now() - restoreStart).toFixed(1)}ms`)
          }
        } catch {
          // ignore restore errors
        }
      }

      if (!restored) {
        const id = generateId()
        if (termApi) termApi.create(id, undefined, workspaceCwd)
        dispatch({ type: 'INIT_DEFAULT', id })
      }
    },
    [generateId]
  )

  // Listen for workspace changes and initialize terminals with correct CWD
  useEffect(() => {
    const wsApi = (window as any).workspace
    if (!wsApi) return

    wsApi
      .getCurrent()
      .then((current: { path: string; name: string } | null) => {
        if (current?.path) initTerminals(current.path)
      })
      .catch(() => {
        /* ignore */
      })

    const unsub = wsApi.onChanged((info: { path: string; name: string } | null) => {
      if (info?.path) initTerminals(info.path)
    })

    return () => {
      if (unsub) unsub()
    }
  }, [initTerminals])

  // Save state on relevant state changes (debounced to avoid write storms during init)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (state.terminals.length === 0) return
    const api = (window as any).workspace
    if (!api) return
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      try {
        api.saveState({
          version: 2,
          terminals: state.terminals,
          groups: state.groups.map((g) => ({
            ...g,
            layoutTree: serializeLayout(g.layoutTree)
          })),
          activeGroupId: state.activeGroupId
        })
      } catch {
        // ignore save errors
      }
    }, 500)
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [state.terminals, state.groups, state.activeGroupId])

  // Save on beforeunload
  useEffect(() => {
    const handleUnload = (): void => {
      const api = (window as any).workspace
      if (api) {
        try {
          api.saveState({
            version: 2,
            terminals: state.terminals,
            groups: state.groups.map((g) => ({
              ...g,
              layoutTree: serializeLayout(g.layoutTree)
            })),
            activeGroupId: state.activeGroupId
          })
        } catch {
          // ignore
        }
      }
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [state.terminals, state.groups, state.activeGroupId])

  // ---- Action creators (stable references via useCallback) ----

  const createTerminal = useCallback(async (): Promise<void> => {
    const id = generateId()
    const name = `Terminal ${counterRef.current}`
    let cwd: string | undefined
    try {
      const wsApi = (window as any).workspace
      if (wsApi) {
        const current = await wsApi.getCurrent()
        if (current?.path) cwd = current.path
      }
    } catch {
      // ignore
    }
    const api = (window as any).terminal
    if (api) api.create(id, undefined, cwd)

    const activeGroup = getActiveGroup(stateRef.current)
    dispatch({ type: 'CREATE_TERMINAL', id, name, panelId: activeGroup.focusedPanelId })
  }, [generateId])

  const removeTerminal = useCallback((id: string): void => {
    const api = (window as any).terminal
    if (api) api.kill(id)
    dispatch({ type: 'REMOVE_TERMINAL', id })

    // Check if active group is now empty after dispatch — React will batch,
    // so we check stateRef after a microtask
    queueMicrotask(() => {
      const current = stateRef.current
      const activeGroup = getActiveGroup(current)
      if (activeGroup && activeGroup.terminalIds.length === 0) {
        // If it's the last group, don't delete (INIT_DEFAULT will handle)
        if (current.groups.length > 1) {
          dispatch({ type: 'DELETE_GROUP', groupId: activeGroup.id })
        }
      }
    })
  }, [])

  const renameTerminal = useCallback((id: string, name: string): void => {
    dispatch({ type: 'RENAME_TERMINAL', id, name })
  }, [])

  const setActiveTerminal = useCallback((id: string, panelId?: string): void => {
    const activeGroup = getActiveGroup(stateRef.current)
    const resolvedPanelId =
      panelId ??
      findLeafByTerminalId(activeGroup.layoutTree, id)?.panelId ??
      activeGroup.focusedPanelId
    dispatch({ type: 'SET_ACTIVE_TERMINAL', id, panelId: resolvedPanelId })
  }, [])

  const setActiveTerminalInPanel = useCallback((panelId: string, terminalId: string): void => {
    dispatch({ type: 'SET_ACTIVE_TERMINAL', id: terminalId, panelId })
  }, [])

  const reorderTerminals = useCallback((fromIdx: number, toIdx: number): void => {
    dispatch({ type: 'REORDER_TERMINALS', fromIdx, toIdx })
  }, [])

  const splitPanel = useCallback(
    async (panelId: string, direction: SplitDirection): Promise<void> => {
      const id = generateId()
      const name = `Terminal ${counterRef.current}`
      let cwd: string | undefined
      try {
        const wsApi = (window as any).workspace
        if (wsApi) {
          const current = await wsApi.getCurrent()
          if (current?.path) cwd = current.path
        }
      } catch {
        // ignore
      }
      const termApi = (window as any).terminal
      if (termApi) termApi.create(id, undefined, cwd)
      dispatch({ type: 'SPLIT_PANEL', panelId, direction, newTerminalId: id, newTerminalName: name })
    },
    [generateId]
  )

  const splitPanelEmpty = useCallback(
    (panelId: string, direction: SplitDirection): void => {
      dispatch({ type: 'SPLIT_PANEL', panelId, direction })
    },
    []
  )

  const closePanel = useCallback(
    async (panelId: string): Promise<void> => {
      const current = stateRef.current
      const activeGroup = getActiveGroup(current)
      // Edge case: closing the last panel — kill active group's terminals and create a fresh default
      if (activeGroup.layoutTree.type === 'leaf' && activeGroup.layoutTree.panelId === panelId) {
        const termApi = (window as any).terminal
        // Only kill terminals belonging to the active group
        const groupTerminals = current.terminals.filter((t) =>
          activeGroup.terminalIds.includes(t.id)
        )
        for (const t of groupTerminals) {
          if (termApi) termApi.kill(t.id)
        }
        const id = generateId()
        let cwd: string | undefined
        try {
          const wsApi = (window as any).workspace
          if (wsApi) {
            const ws = await wsApi.getCurrent()
            if (ws?.path) cwd = ws.path
          }
        } catch {
          // ignore
        }
        if (termApi) termApi.create(id, undefined, cwd)
        dispatch({ type: 'INIT_DEFAULT', id })
        return
      }
      dispatch({ type: 'CLOSE_PANEL', panelId })
    },
    [generateId]
  )

  const moveTerminalToPanel = useCallback(
    (terminalId: string, fromPanelId: string, toPanelId: string): void => {
      dispatch({ type: 'MOVE_TERMINAL', terminalId, fromPanelId, toPanelId })
    },
    []
  )

  const splitAndMoveTerminal = useCallback(
    (terminalId: string, fromPanelId: string, targetPanelId: string, direction: SplitDirection, insertBefore: boolean): void => {
      dispatch({ type: 'SPLIT_AND_MOVE_TERMINAL', terminalId, fromPanelId, targetPanelId, direction, insertBefore })
    },
    []
  )

  const splitRootAndMoveTerminal = useCallback(
    (terminalId: string, fromPanelId: string, direction: SplitDirection, insertBefore: boolean): void => {
      dispatch({ type: 'SPLIT_ROOT_AND_MOVE_TERMINAL', terminalId, fromPanelId, direction, insertBefore })
    },
    []
  )

  const setFocusedPanel = useCallback((panelId: string): void => {
    dispatch({ type: 'SET_FOCUSED_PANEL', panelId })
  }, [])

  const applyPresetLayout = useCallback((layoutType: PresetLayoutType): void => {
    dispatch({ type: 'APPLY_PRESET_LAYOUT', layoutType })
  }, [])

  const updateSplitRatio = useCallback((splitId: string, newRatio: number): void => {
    dispatch({ type: 'UPDATE_RATIO', splitId, newRatio })
  }, [])

  // ---- Group action creators ----

  const createGroup = useCallback(async (): Promise<void> => {
    const groupId = generateGroupId()
    const terminalId = generateId()
    const terminalName = `Terminal ${counterRef.current}`
    const groupName = `Group ${groupCounterRef.current}`

    let cwd: string | undefined
    try {
      const wsApi = (window as any).workspace
      if (wsApi) {
        const current = await wsApi.getCurrent()
        if (current?.path) cwd = current.path
      }
    } catch {
      // ignore
    }
    const termApi = (window as any).terminal
    if (termApi) termApi.create(terminalId, undefined, cwd)

    dispatch({ type: 'CREATE_GROUP', groupId, name: groupName, terminalId, terminalName })
  }, [generateGroupId, generateId])

  const deleteGroup = useCallback(async (groupId: string): Promise<void> => {
    const current = stateRef.current
    const group = current.groups.find((g) => g.id === groupId)
    if (!group) return

    // Kill all PTYs in the group
    const termApi = (window as any).terminal
    if (termApi) {
      for (const tId of group.terminalIds) {
        termApi.kill(tId)
      }
    }

    // If this is the last group, create a fresh default first
    if (current.groups.length <= 1) {
      const id = generateId()
      let cwd: string | undefined
      try {
        const wsApi = (window as any).workspace
        if (wsApi) {
          const ws = await wsApi.getCurrent()
          if (ws?.path) cwd = ws.path
        }
      } catch {
        // ignore
      }
      if (termApi) termApi.create(id, undefined, cwd)
      dispatch({ type: 'INIT_DEFAULT', id })
      return
    }

    dispatch({ type: 'DELETE_GROUP', groupId })
  }, [generateId])

  const renameGroup = useCallback((groupId: string, name: string): void => {
    dispatch({ type: 'RENAME_GROUP', groupId, name })
  }, [])

  const switchGroup = useCallback((groupId: string): void => {
    dispatch({ type: 'SWITCH_GROUP', groupId })
  }, [])

  const toggleGroupCollapse = useCallback((groupId: string): void => {
    dispatch({ type: 'TOGGLE_GROUP_COLLAPSE', groupId })
  }, [])

  const moveTerminalToGroup = useCallback(
    (terminalId: string, fromGroupId: string, toGroupId: string): void => {
      dispatch({ type: 'MOVE_TERMINAL_TO_GROUP', terminalId, fromGroupId, toGroupId })

      // Check if source group is now empty after dispatch
      queueMicrotask(() => {
        const current = stateRef.current
        const fromGroup = current.groups.find((g) => g.id === fromGroupId)
        if (fromGroup && fromGroup.terminalIds.length === 0 && current.groups.length > 1) {
          dispatch({ type: 'DELETE_GROUP', groupId: fromGroupId })
        }
      })
    },
    []
  )

  // Compute context value from active group for backward compatibility
  const activeGroup = getActiveGroup(state)

  const contextValue: TerminalContextValue = {
    terminals: state.terminals,
    activeTerminalId: activeGroup?.activeTerminalId ?? null,
    layoutTree: activeGroup?.layoutTree ?? makeInitialLeaf(),
    focusedPanelId: activeGroup?.focusedPanelId ?? 'panel-1',
    groups: state.groups,
    activeGroupId: state.activeGroupId,
    isDraggingTab: dragSourceInfo !== null,
    dragSourceInfo,
    setDragState,
    createTerminal,
    removeTerminal,
    renameTerminal,
    setActiveTerminal,
    setActiveTerminalInPanel,
    reorderTerminals,
    splitPanel,
    splitPanelEmpty,
    closePanel,
    moveTerminalToPanel,
    splitAndMoveTerminal,
    splitRootAndMoveTerminal,
    setFocusedPanel,
    applyPresetLayout,
    createGroup,
    deleteGroup,
    renameGroup,
    switchGroup,
    toggleGroupCollapse,
    moveTerminalToGroup
  }

  const splitRatioValue: SplitRatioContextValue = { updateSplitRatio }

  return (
    <SplitRatioContext.Provider value={splitRatioValue}>
      <TerminalContext.Provider value={contextValue}>{children}</TerminalContext.Provider>
    </SplitRatioContext.Provider>
  )
}

// ---- Migration / validation helpers ----

function makeSingleLeafWithTerminals(terminalIds: string[]): LayoutNode {
  return {
    type: 'leaf',
    panelId: generatePanelId(),
    terminalIds,
    activeTerminalId: terminalIds[terminalIds.length - 1] ?? null
  }
}

function pruneOrphanedTerminals(tree: LayoutNode, validIds: Set<string>): LayoutNode {
  if (tree.type === 'leaf') {
    const filteredIds = tree.terminalIds.filter((id) => validIds.has(id))
    const activeId =
      tree.activeTerminalId && validIds.has(tree.activeTerminalId)
        ? tree.activeTerminalId
        : filteredIds[filteredIds.length - 1] ?? null
    return { ...tree, terminalIds: filteredIds, activeTerminalId: activeId }
  }
  return {
    ...tree,
    children: [
      pruneOrphanedTerminals(tree.children[0], validIds),
      pruneOrphanedTerminals(tree.children[1], validIds)
    ]
  }
}
