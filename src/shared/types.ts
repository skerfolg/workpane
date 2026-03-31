// Shared type definitions — single source of truth for main + renderer

export interface DocEntry {
  filePath: string
  date: string
  hash: string
  topic: string
  docType: string // design, plan, report, result, issue, sprint, etc.
  title: string
  folder: string // designs, plans, reports, results, issues, etc.
  source: 'standard' | 'project' // standard = docs/, project = elsewhere
}

export interface DocGroup {
  hash: string
  topic: string // human-readable topic summary
  date: string // latest date among documents
  documents: DocEntry[]
  docTypes: string[] // unique sorted doc types
  source: 'standard' | 'project'
}

// Widened to string to support custom kanban columns
export type IssueStatus = string

export const DEFAULT_STATUSES = ['open', 'in-progress', 'resolved'] as const

export interface Issue {
  hash: string
  title: string
  status: string
  priority: string
  category: string
  type: string
  filePath: string
  date: string
  source?: 'standard' | 'project'
  parentHash?: string
  seq?: number
  children?: Issue[]
}

export interface CreateIssueData {
  title: string
  status?: string
  priority?: string
  category?: string
  type?: string
}

export interface UpdateIssueData {
  status?: string
  priority?: string
  category?: string
  title?: string
  content?: string
}

// Kanban issue (separate entity from file-based docs)
export interface KanbanIssue {
  id: string
  hash: string           // 7-char hex hash for artifact auto-linking
  title: string
  description: string
  status: string
  createdAt: string
  updatedAt: string
  linkedDocuments: string[]
  promptId?: string
}

// Prompt
export interface Prompt {
  id: string
  issueId: string
  content: string
  template: string
  createdAt: string
}

// Prompt template
export interface PromptTemplate {
  id: string
  name: string
  template: string
  isDefault: boolean
}

// Column definition
export interface ColumnDef {
  id: string
  label: string
}

// Kanban store (full structure persisted to kanban.json)
export interface KanbanStore {
  issues: KanbanIssue[]
  columns: ColumnDef[]
  promptTemplates: PromptTemplate[]
}

// Skills — bundled skill info (from resources/skills/*/skill.json)
export interface SkillInfo {
  name: string
  version: string
  description: string
  files: string[]
  docsStructure: string[]
}

// Registry skill file with required SHA-256 checksum
export interface RegistrySkillFile {
  name: string
  url: string
  sha256: string
}

// Per-agent install configuration (e.g. Claude Code, Cursor, Windsurf)
export interface AgentInstallConfig {
  installPath: string // e.g. "{projectRoot}/.claude/skills/{skillId}"
}

// A skill entry in the remote registry
export interface RegistrySkill {
  id: string
  name: string
  version: string
  description: string
  author: string
  tags: string[]
  files: RegistrySkillFile[]
  agents: Record<string, AgentInstallConfig>
}

// Top-level registry manifest
export interface SkillRegistry {
  version: string
  lastUpdated: string
  skills: RegistrySkill[]
}

// Record stored in .claude/installed-skills.json per installed registry skill
export interface InstalledSkillRecord {
  skillId: string
  version: string
  agentId: string
  installedAt: string
  installPath: string
}

// Unified view merging bundled + registry skills for the UI
export interface UnifiedSkill {
  id: string
  name: string
  version: string
  description: string
  source: 'bundled' | 'registry'
  agents: Record<string, AgentInstallConfig>
  tags: string[]
}
