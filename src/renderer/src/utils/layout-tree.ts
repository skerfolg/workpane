// Pure utility functions for manipulating the terminal split layout tree.
// All functions are immutable — they return new tree instances.

import type { LayoutNode, LeafNode, SplitNode, SplitDirection, PanelId, PresetLayoutType, TerminalGroup } from '../types/terminal-layout'

let panelCounter = 0

export function generatePanelId(): PanelId {
  panelCounter += 1
  return `panel-${panelCounter}`
}

export function syncPanelCounter(groups: TerminalGroup[]): void {
  let maxId = 0
  function scan(node: LayoutNode): void {
    if (node.type === 'leaf') {
      const num = parseInt(node.panelId.replace('panel-', ''), 10)
      if (!isNaN(num) && num > maxId) maxId = num
    } else {
      const splitNum = parseInt(node.splitId.replace('panel-', ''), 10)
      if (!isNaN(splitNum) && splitNum > maxId) maxId = splitNum
      scan(node.children[0])
      scan(node.children[1])
    }
  }
  for (const group of groups) scan(group.layoutTree)
  panelCounter = maxId
}

// ---- Traversal ----

export function findLeaf(tree: LayoutNode, panelId: PanelId): LeafNode | null {
  if (tree.type === 'leaf') {
    return tree.panelId === panelId ? tree : null
  }
  return findLeaf(tree.children[0], panelId) ?? findLeaf(tree.children[1], panelId)
}

export function findLeafByBrowserId(tree: LayoutNode, browserId: string): LeafNode | null {
  if (tree.type === 'leaf') {
    return tree.browserIds.includes(browserId) ? tree : null
  }
  return (
    findLeafByBrowserId(tree.children[0], browserId) ??
    findLeafByBrowserId(tree.children[1], browserId)
  )
}

export function findLeafByTerminalId(tree: LayoutNode, terminalId: string): LeafNode | null {
  if (tree.type === 'leaf') {
    return tree.terminalIds.includes(terminalId) ? tree : null
  }
  return (
    findLeafByTerminalId(tree.children[0], terminalId) ??
    findLeafByTerminalId(tree.children[1], terminalId)
  )
}

/** Collect all leaf nodes from the tree in order. */
export function getAllLeaves(tree: LayoutNode): LeafNode[] {
  if (tree.type === 'leaf') return [tree]
  return [...getAllLeaves(tree.children[0]), ...getAllLeaves(tree.children[1])]
}

export function isPresetEligibleLayout(tree: LayoutNode): boolean {
  return !getAllLeaves(tree).some((leaf) => leaf.browserIds.length > 0)
}

export function applyPresetLayoutToTree(
  tree: LayoutNode,
  layoutType: PresetLayoutType,
  preferredActiveTerminalId: string | null
): {
  layoutTree: LayoutNode
  terminalIds: string[]
  activeTerminalId: string | null
  focusedPanelId: PanelId
} | null {
  if (!isPresetEligibleLayout(tree)) {
    return null
  }

  const terminalIds = getAllLeaves(tree).flatMap((leaf) => leaf.terminalIds)
  const nextTree = createPresetLayout(layoutType, terminalIds)
  const nextLeaves = getAllLeaves(nextTree)
  const nextActiveTerminalId =
    preferredActiveTerminalId && terminalIds.includes(preferredActiveTerminalId)
      ? preferredActiveTerminalId
      : terminalIds[0] ?? null
  const focusedLeaf =
    (nextActiveTerminalId
      ? findLeafByTerminalId(nextTree, nextActiveTerminalId)
      : null) ?? nextLeaves[0] ?? null

  return {
    layoutTree: nextTree,
    terminalIds: nextLeaves.flatMap((leaf) => leaf.terminalIds),
    activeTerminalId: nextActiveTerminalId,
    focusedPanelId: focusedLeaf?.panelId ?? nextLeaves[0]?.panelId ?? generatePanelId()
  }
}

// ---- Mutations (immutable) ----

/**
 * Replaces the leaf identified by panelId with a SplitNode containing:
 *   child[0] = original leaf
 *   child[1] = new empty leaf (optionally pre-populated with newTerminalId)
 */
export function splitPanel(
  tree: LayoutNode,
  panelId: PanelId,
  direction: SplitDirection,
  newTerminalId?: string,
  newTerminalName?: string,
  insertBefore?: boolean
): LayoutNode {
  if (tree.type === 'leaf') {
    if (tree.panelId !== panelId) return tree
    const newLeaf: LeafNode = {
      type: 'leaf',
      panelId: generatePanelId(),
      terminalIds: newTerminalId ? [newTerminalId] : [],
      browserIds: [],
      activeTerminalId: newTerminalId ?? null
    }
    const splitNode: SplitNode = {
      type: 'split',
      splitId: generatePanelId(),
      direction,
      ratio: 0.5,
      children: insertBefore ? [newLeaf, tree] : [tree, newLeaf]
    }
    return splitNode
  }
  const [left, right] = tree.children
  return {
    ...tree,
    children: [
      splitPanel(left, panelId, direction, newTerminalId, newTerminalName, insertBefore),
      splitPanel(right, panelId, direction, newTerminalId, newTerminalName, insertBefore)
    ]
  }
}

/**
 * Wraps the entire layout tree in a new SplitNode with a new empty leaf.
 * Used for root-level (spanning) splits — e.g. dragging a terminal to the
 * outer edge of the terminal area to create a full-height column or full-width row.
 */
export function splitRoot(
  tree: LayoutNode,
  direction: SplitDirection,
  insertBefore: boolean
): LayoutNode {
  const newLeaf: LeafNode = {
    type: 'leaf',
    panelId: generatePanelId(),
    terminalIds: [],
    browserIds: [],
    activeTerminalId: null
  }
  return {
    type: 'split',
    splitId: generatePanelId(),
    direction,
    ratio: 0.5,
    children: insertBefore ? [newLeaf, tree] : [tree, newLeaf]
  }
}

/**
 * Removes a leaf node and collapses its parent split.
 * The sibling of the removed leaf takes the parent's place.
 * Returns null if the tree is a single leaf with no parent (cannot close the last panel).
 */
export function closePanel(tree: LayoutNode, panelId: PanelId): LayoutNode | null {
  if (tree.type === 'leaf') {
    // Cannot close the last panel
    return tree.panelId === panelId ? null : tree
  }
  const [left, right] = tree.children

  // Check if either direct child is the target leaf
  if (left.type === 'leaf' && left.panelId === panelId) {
    return right
  }
  if (right.type === 'leaf' && right.panelId === panelId) {
    return left
  }

  // Recurse into children
  const newLeft = closePanel(left, panelId)
  const newRight = closePanel(right, panelId)

  // If recursion eliminated a subtree, collapse this split
  if (newLeft === null) return right
  if (newRight === null) return left

  return { ...tree, children: [newLeft, newRight] }
}

/**
 * Moves a terminal from one panel to another.
 * If the source panel becomes empty after the move, the panel remains (caller decides whether to close it).
 */
export function moveTerminalToPanel(
  tree: LayoutNode,
  terminalId: string,
  fromPanelId: PanelId,
  toPanelId: PanelId
): LayoutNode {
  return mapLeaves(tree, (leaf) => {
    if (leaf.panelId === fromPanelId) {
      const nextIds = leaf.terminalIds.filter((id) => id !== terminalId)
      const nextActive =
        leaf.activeTerminalId === terminalId
          ? nextIds[nextIds.length - 1] ?? null
          : leaf.activeTerminalId
      return { ...leaf, terminalIds: nextIds, activeTerminalId: nextActive }
    }
    if (leaf.panelId === toPanelId) {
      return {
        ...leaf,
        terminalIds: [...leaf.terminalIds, terminalId],
        activeTerminalId: terminalId
      }
    }
    return leaf
  })
}

/**
 * Updates the ratio of the SplitNode identified by splitId.
 */
export function updateRatio(tree: LayoutNode, splitId: string, newRatio: number): LayoutNode {
  if (tree.type === 'leaf') return tree

  if (tree.splitId === splitId) {
    return { ...tree, ratio: clamp(newRatio, 0.05, 0.95) }
  }

  return {
    ...tree,
    children: [
      updateRatio(tree.children[0], splitId, newRatio) as LayoutNode,
      updateRatio(tree.children[1], splitId, newRatio) as LayoutNode
    ]
  }
}

// ---- Resize helper ----

/**
 * Converts a pixel drag delta from the Splitter component into a new ratio.
 * Clamps the result so neither child drops below minSize pixels.
 *
 * @param delta        Pixel delta from the drag event (positive = first child grows)
 * @param containerSize Total container size in pixels (width for vertical split, height for horizontal)
 * @param currentRatio  Current ratio of the first child (0–1)
 * @param minSize       Minimum panel size in pixels (default 200)
 */
export function pixelDeltaToRatio(
  delta: number,
  containerSize: number,
  currentRatio: number,
  minSize = 200
): number {
  if (containerSize <= 0) return currentRatio
  const currentPx = currentRatio * containerSize
  const newPx = currentPx + delta
  const minRatio = minSize / containerSize
  const maxRatio = 1 - minRatio
  return clamp(newPx / containerSize, minRatio, maxRatio)
}

// ---- Preset layouts ----

/**
 * Creates a common preset layout tree.
 * - '2col': vertical split, two leaves side-by-side
 * - '2row': horizontal split, two leaves stacked
 * - '2x2': vertical split at root, each child horizontally split (4 leaves)
 *
 * Distributes terminalIds round-robin across leaves.
 */
export function createPresetLayout(type: PresetLayoutType, terminalIds: string[]): LayoutNode {
  if (type === '2col') {
    const [leafA, leafB] = makeTwoLeaves(terminalIds)
    return { type: 'split', splitId: generatePanelId(), direction: 'vertical', ratio: 0.5, children: [leafA, leafB] }
  }

  if (type === '2row') {
    const [leafA, leafB] = makeTwoLeaves(terminalIds)
    return { type: 'split', splitId: generatePanelId(), direction: 'horizontal', ratio: 0.5, children: [leafA, leafB] }
  }

  // '2x2' — 4 leaves
  const leaves = makeFourLeaves(terminalIds)
  const topLeft = leaves[0]
  const topRight = leaves[1]
  const bottomLeft = leaves[2]
  const bottomRight = leaves[3]
  const leftSplit: SplitNode = {
    type: 'split',
    splitId: generatePanelId(),
    direction: 'horizontal',
    ratio: 0.5,
    children: [topLeft, bottomLeft]
  }
  const rightSplit: SplitNode = {
    type: 'split',
    splitId: generatePanelId(),
    direction: 'horizontal',
    ratio: 0.5,
    children: [topRight, bottomRight]
  }
  return { type: 'split', splitId: generatePanelId(), direction: 'vertical', ratio: 0.5, children: [leftSplit, rightSplit] }
}

// ---- Serialization ----

export function serializeLayout(tree: LayoutNode): object {
  // LayoutNode is already a plain JSON-safe object
  return JSON.parse(JSON.stringify(tree))
}

export function deserializeLayout(json: unknown): LayoutNode {
  return validateNode(json)
}

// ---- Internal helpers ----

function mapLeaves(tree: LayoutNode, fn: (leaf: LeafNode) => LeafNode): LayoutNode {
  if (tree.type === 'leaf') return fn(tree)
  return {
    ...tree,
    children: [mapLeaves(tree.children[0], fn), mapLeaves(tree.children[1], fn)]
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function makeLeaf(ids: string[]): LeafNode {
  return {
    type: 'leaf',
    panelId: generatePanelId(),
    terminalIds: [...ids],
    browserIds: [],
    activeTerminalId: ids[0] ?? null
  }
}

function makeTwoLeaves(terminalIds: string[]): [LeafNode, LeafNode] {
  const a: string[] = []
  const b: string[] = []
  terminalIds.forEach((id, i) => (i % 2 === 0 ? a : b).push(id))
  return [makeLeaf(a), makeLeaf(b)]
}

function makeFourLeaves(terminalIds: string[]): [LeafNode, LeafNode, LeafNode, LeafNode] {
  const buckets: [string[], string[], string[], string[]] = [[], [], [], []]
  terminalIds.forEach((id, i) => buckets[i % 4].push(id))
  return [makeLeaf(buckets[0]), makeLeaf(buckets[1]), makeLeaf(buckets[2]), makeLeaf(buckets[3])]
}

function validateNode(json: unknown): LayoutNode {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Invalid layout node: not an object')
  }
  const node = json as Record<string, unknown>
  if (node.type === 'leaf') {
    return {
      type: 'leaf',
      panelId: String(node.panelId ?? generatePanelId()),
      terminalIds: Array.isArray(node.terminalIds) ? (node.terminalIds as string[]) : [],
      browserIds: Array.isArray(node.browserIds) ? (node.browserIds as string[]) : [],
      activeTerminalId: typeof node.activeTerminalId === 'string' ? node.activeTerminalId : null
    }
  }
  if (node.type === 'split') {
    const children = node.children as unknown[]
    if (!Array.isArray(children) || children.length !== 2) {
      throw new Error('Invalid split node: children must be an array of length 2')
    }
    return {
      type: 'split',
      splitId: typeof node.splitId === 'string' ? node.splitId : generatePanelId(),
      direction: (node.direction as SplitDirection) ?? 'vertical',
      ratio: typeof node.ratio === 'number' ? clamp(node.ratio, 0.05, 0.95) : 0.5,
      children: [validateNode(children[0]), validateNode(children[1])]
    }
  }
  throw new Error(`Invalid layout node type: ${node.type}`)
}
