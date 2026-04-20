import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  MonitoringHistoryEvent,
  MonitoringHistoryStoreStatus,
  MonitoringTimelineFilter,
  SessionMonitoringTransitionEvent
} from '../shared/types'

type SqliteModule = {
  DatabaseSync: new (path: string) => {
    exec: (sql: string) => void
    prepare: (sql: string) => {
      run: (...args: unknown[]) => void
      all: (...args: unknown[]) => Array<Record<string, unknown>>
    }
    close: () => void
  }
}

interface HistoryStoreLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

interface HistoryStoreDependencies {
  loadSqliteModule?: () => SqliteModule | null
  logger?: HistoryStoreLogger
}

interface HistoryBackend {
  append(event: MonitoringHistoryEvent): void
  listSessionEvents(terminalId: string, filter: MonitoringTimelineFilter, limit: number): MonitoringHistoryEvent[]
  listWorkspaceFeed(limit: number): MonitoringHistoryEvent[]
  status(): MonitoringHistoryStoreStatus
  close(): void
}

function normalizeHistoryEvent(event: SessionMonitoringTransitionEvent): MonitoringHistoryEvent {
  return {
    id: event.id,
    terminalId: event.terminalId,
    workspacePath: event.workspacePath,
    sequence: event.sequence,
    timestamp: event.timestamp,
    kind: event.kind,
    reason: event.reason,
    category: event.category,
    confidence: event.confidence,
    source: event.source,
    summary: event.summary,
    patternName: event.patternName,
    matchedText: event.matchedText
  }
}

function matchesTimelineFilter(
  event: MonitoringHistoryEvent,
  filter: MonitoringTimelineFilter
): boolean {
  if (filter === 'approval-only') {
    return event.category === 'approval'
  }
  if (filter === 'error-only') {
    return event.category === 'error'
  }
  return true
}

class JsonHistoryBackend implements HistoryBackend {
  private readonly storagePath: string
  private readonly statusDetail: string
  private events: MonitoringHistoryEvent[] = []

  constructor(workspacePath: string, detail = 'Using JSON fallback history backend.') {
    this.storagePath = join(workspacePath, '.workspace', 'workpane-history.json')
    this.statusDetail = detail
    if (existsSync(this.storagePath)) {
      try {
        this.events = JSON.parse(readFileSync(this.storagePath, 'utf8')) as MonitoringHistoryEvent[]
      } catch {
        this.events = []
      }
    }
  }

  append(event: MonitoringHistoryEvent): void {
    this.events.push(event)
    writeFileSync(this.storagePath, JSON.stringify(this.events), 'utf8')
  }

  listSessionEvents(terminalId: string, filter: MonitoringTimelineFilter, limit: number): MonitoringHistoryEvent[] {
    return this.events
      .filter((event) => event.terminalId === terminalId)
      .filter((event) => matchesTimelineFilter(event, filter))
      .sort((left, right) => right.timestamp - left.timestamp || right.sequence - left.sequence)
      .slice(0, limit)
  }

  listWorkspaceFeed(limit: number): MonitoringHistoryEvent[] {
    return [...this.events]
      .sort((left, right) => right.timestamp - left.timestamp || right.sequence - left.sequence)
      .slice(0, limit)
  }

  status(): MonitoringHistoryStoreStatus {
    return {
      available: true,
      backend: 'json_fallback',
      detail: this.statusDetail,
      storagePath: this.storagePath
    }
  }

  close(): void {
    // no-op
  }
}

class SqliteHistoryBackend implements HistoryBackend {
  private readonly storagePath: string
  private readonly db: InstanceType<SqliteModule['DatabaseSync']>

  constructor(workspacePath: string, sqlite: SqliteModule) {
    this.storagePath = join(workspacePath, '.workspace', 'workpane-history.sqlite')
    this.db = new sqlite.DatabaseSync(this.storagePath)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS monitoring_history (
        id TEXT PRIMARY KEY,
        terminal_id TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        kind TEXT NOT NULL,
        reason TEXT,
        category TEXT,
        confidence TEXT,
        source TEXT,
        summary TEXT,
        pattern_name TEXT,
        matched_text TEXT
      );
      CREATE INDEX IF NOT EXISTS monitoring_history_terminal_idx
        ON monitoring_history (terminal_id, timestamp DESC, sequence DESC);
      CREATE INDEX IF NOT EXISTS monitoring_history_workspace_idx
        ON monitoring_history (timestamp DESC, sequence DESC);
    `)
  }

  append(event: MonitoringHistoryEvent): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO monitoring_history (
        id, terminal_id, workspace_path, sequence, timestamp, kind,
        reason, category, confidence, source, summary, pattern_name, matched_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.terminalId,
      event.workspacePath,
      event.sequence,
      event.timestamp,
      event.kind,
      event.reason ?? null,
      event.category ?? null,
      event.confidence ?? null,
      event.source ?? null,
      event.summary ?? null,
      event.patternName ?? null,
      event.matchedText ?? null
    )
  }

  listSessionEvents(terminalId: string, filter: MonitoringTimelineFilter, limit: number): MonitoringHistoryEvent[] {
    let filterClause = ''
    if (filter === 'approval-only') {
      filterClause = ` AND category = 'approval'`
    } else if (filter === 'error-only') {
      filterClause = ` AND category = 'error'`
    }

    return this.db.prepare(`
      SELECT
        id,
        terminal_id AS terminalId,
        workspace_path AS workspacePath,
        sequence,
        timestamp,
        kind,
        reason,
        category,
        confidence,
        source,
        summary,
        pattern_name AS patternName,
        matched_text AS matchedText
      FROM monitoring_history
      WHERE terminal_id = ?${filterClause}
      ORDER BY timestamp DESC, sequence DESC
      LIMIT ?
    `).all(terminalId, limit) as unknown as MonitoringHistoryEvent[]
  }

  listWorkspaceFeed(limit: number): MonitoringHistoryEvent[] {
    return this.db.prepare(`
      SELECT
        id,
        terminal_id AS terminalId,
        workspace_path AS workspacePath,
        sequence,
        timestamp,
        kind,
        reason,
        category,
        confidence,
        source,
        summary,
        pattern_name AS patternName,
        matched_text AS matchedText
      FROM monitoring_history
      ORDER BY timestamp DESC, sequence DESC
      LIMIT ?
    `).all(limit) as unknown as MonitoringHistoryEvent[]
  }

  status(): MonitoringHistoryStoreStatus {
    return {
      available: true,
      backend: 'sqlite',
      detail: 'Using node:sqlite history backend.',
      storagePath: this.storagePath
    }
  }

  close(): void {
    this.db.close()
  }
}

function loadSqliteModule(): SqliteModule | null {
  try {
    return require('node:sqlite') as SqliteModule
  } catch {
    return null
  }
}

export class HistoryStore {
  private readonly loadSqliteModuleImpl: () => SqliteModule | null
  private readonly logger: HistoryStoreLogger
  private backend: HistoryBackend | null = null
  private currentWorkspacePath: string | null = null

  constructor(deps: HistoryStoreDependencies = {}) {
    this.loadSqliteModuleImpl = deps.loadSqliteModule ?? loadSqliteModule
    this.logger = deps.logger ?? console
  }

  openWorkspace(workspacePath: string): void {
    this.closeWorkspace()
    const workspaceDir = join(workspacePath, '.workspace')
    if (!existsSync(workspaceDir)) {
      mkdirSync(workspaceDir, { recursive: true })
    }

    this.currentWorkspacePath = workspacePath
    const forcedBackend = process.env.WORKPANE_HISTORY_BACKEND

    if (forcedBackend === 'json_fallback') {
      this.logger.warn('[Main] HistoryStore using forced JSON fallback backend via WORKPANE_HISTORY_BACKEND.')
      this.backend = new JsonHistoryBackend(
        workspacePath,
        'Using JSON fallback history backend (forced by WORKPANE_HISTORY_BACKEND).'
      )
      return
    }

    let sqlite: SqliteModule | null = null
    try {
      sqlite = this.loadSqliteModuleImpl()
    } catch (error) {
      this.logger.warn('[Main] HistoryStore sqlite module load failed, falling back to JSON:', error)
    }

    if (sqlite) {
      try {
        this.backend = new SqliteHistoryBackend(workspacePath, sqlite)
        this.logger.info('[Main] HistoryStore using sqlite backend.')
        return
      } catch (error) {
        this.logger.error('[Main] HistoryStore sqlite init failed, falling back to JSON:', error)
        this.backend = new JsonHistoryBackend(
          workspacePath,
          'Using JSON fallback history backend because node:sqlite initialization failed.'
        )
        return
      }
    }

    this.logger.warn('[Main] HistoryStore node:sqlite unavailable, falling back to JSON.')
    this.backend = new JsonHistoryBackend(
      workspacePath,
      'Using JSON fallback history backend because node:sqlite is unavailable.'
    )
  }

  closeWorkspace(): void {
    if (this.backend) {
      this.logger.info('[Main] HistoryStore closing workspace backend.')
    }
    this.backend?.close()
    this.backend = null
    this.currentWorkspacePath = null
  }

  getStatus(): MonitoringHistoryStoreStatus {
    if (!this.backend) {
      return {
        available: false,
        backend: 'memory',
        detail: 'No workspace-local history store is open.',
        storagePath: this.currentWorkspacePath
          ? join(this.currentWorkspacePath, '.workspace')
          : null
      }
    }
    return this.backend.status()
  }

  appendMonitoringTransition(event: SessionMonitoringTransitionEvent): void {
    if (!this.backend) {
      return
    }
    try {
      this.backend.append(normalizeHistoryEvent(event))
    } catch (error) {
      this.logger.error('[Main] HistoryStore append failed:', error)
    }
  }

  listSessionEvents(
    terminalId: string,
    filter: MonitoringTimelineFilter = 'all',
    limit = 200
  ): MonitoringHistoryEvent[] {
    if (!this.backend) {
      return []
    }
    try {
      return this.backend.listSessionEvents(terminalId, filter, limit)
    } catch (error) {
      this.logger.error('[Main] HistoryStore listSessionEvents failed:', error)
      return []
    }
  }

  listWorkspaceFeed(limit = 100): MonitoringHistoryEvent[] {
    if (!this.backend) {
      return []
    }
    try {
      return this.backend.listWorkspaceFeed(limit)
    } catch (error) {
      this.logger.error('[Main] HistoryStore listWorkspaceFeed failed:', error)
      return []
    }
  }
}
