import { promises as fs } from 'fs'
import { join, dirname } from 'path'

import type { IssueStatus } from '../shared/types'

export function generateHash(): string {
  const chars = '0123456789abcdef'
  let hash = ''
  for (let i = 0; i < 8; i++) {
    hash += chars[Math.floor(Math.random() * 16)]
  }
  return hash
}

function toDateString(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function topicFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '') || 'issue'
}

export interface CreateIssueOptions {
  title: string
  status?: string
  priority?: string
  category?: string
  type?: string
  parentHash?: string
  docsPath: string
}

export async function createIssue(opts: CreateIssueOptions): Promise<string> {
  const {
    title,
    status = 'open',
    priority = 'medium',
    category = 'feature',
    type = 'feat',
    docsPath
  } = opts

  const hash = generateHash()
  const date = toDateString()
  const topic = topicFromTitle(title)
  const filename = `${date}-${hash}-${topic}-${type}.md`
  const issuesDir = join(docsPath, 'issues')

  await fs.mkdir(issuesDir, { recursive: true })

  const content = `---
status: ${status}
priority: ${priority}
category: ${category}
title: ${title}
---

# ${title}

## Description

Write issue content here.
`

  const filePath = join(issuesDir, filename)
  await fs.writeFile(filePath, content, 'utf-8')
  await updateIndexMd(issuesDir)
  return filePath
}

export interface UpdateIssueOptions {
  status?: string
  priority?: string
  category?: string
  title?: string
  content?: string
}

export async function updateIssue(filePath: string, updates: UpdateIssueOptions, docsRoot?: string): Promise<void> {
  const raw = await fs.readFile(filePath, 'utf-8')

  const hasFrontmatter = raw.startsWith('---')
  let frontmatterEnd = -1
  if (hasFrontmatter) {
    frontmatterEnd = raw.indexOf('\n---', 3)
  }

  let newContent: string

  if (hasFrontmatter && frontmatterEnd !== -1) {
    // Targeted line replacement: preserve complex YAML by only replacing known keys
    const frontmatterBlock = raw.slice(0, frontmatterEnd + 4) // includes opening and closing ---
    const body = raw.slice(frontmatterEnd + 4)

    let updatedBlock = frontmatterBlock
    const managedKeys: Record<string, string | undefined> = {
      status: updates.status,
      priority: updates.priority,
      category: updates.category,
      title: updates.title
    }

    for (const [key, value] of Object.entries(managedKeys)) {
      if (value === undefined) continue
      const lineRegex = new RegExp(`^(${key}:\\s*)(.*)$`, 'm')
      if (lineRegex.test(updatedBlock)) {
        updatedBlock = updatedBlock.replace(lineRegex, `${key}: ${value}`)
      } else {
        // Key doesn't exist — insert before closing ---
        updatedBlock = updatedBlock.replace(/\n---\s*$/, `\n${key}: ${value}\n---`)
      }
    }

    const newBody = updates.content !== undefined ? updates.content : body
    newContent = updatedBlock + newBody
  } else {
    // No frontmatter — prepend minimal block
    const status = updates.status ?? 'open'
    const priority = updates.priority ?? 'medium'
    const parts = [`status: ${status}`, `priority: ${priority}`]
    if (updates.category) parts.push(`category: ${updates.category}`)
    if (updates.title) parts.push(`title: ${updates.title}`)
    const newBody = updates.content !== undefined ? updates.content : raw
    newContent = `---\n${parts.join('\n')}\n---\n${newBody}`
  }

  await fs.writeFile(filePath, newContent, 'utf-8')

  // INDEX.md guard: only update for files within docs/ tree
  const issuesDir = dirname(filePath)
  const normalizedPath = filePath.replace(/\\/g, '/')
  if (!docsRoot || normalizedPath.includes('/docs/')) {
    await updateIndexMd(issuesDir)
  }
}

export async function deleteIssue(filePath: string): Promise<void> {
  await fs.unlink(filePath)
  const issuesDir = dirname(filePath)
  const normalizedPath = filePath.replace(/\\/g, '/')
  if (normalizedPath.includes('/docs/')) {
    await updateIndexMd(issuesDir)
  }
}

export async function updateIssueStatus(filePath: string, newStatus: string): Promise<void> {
  await updateIssue(filePath, { status: newStatus })
}

async function updateIndexMd(issuesDir: string): Promise<void> {
  let entries: string[]
  try {
    entries = await fs.readdir(issuesDir)
  } catch {
    return
  }

  const mdFiles = entries.filter((e) => e.endsWith('.md') && e !== 'INDEX.md')

  interface Row {
    hash: string
    title: string
    status: string
    priority: string
    category: string
    date: string
    filePath: string
  }

  const rows: Row[] = []

  for (const file of mdFiles) {
    const fp = join(issuesDir, file)
    try {
      const raw = await fs.readFile(fp, 'utf-8')
      const meta: Record<string, string> = {}

      if (raw.startsWith('---')) {
        const end = raw.indexOf('\n---', 3)
        if (end !== -1) {
          const block = raw.slice(3, end).trim()
          for (const line of block.split('\n')) {
            const colon = line.indexOf(':')
            if (colon === -1) continue
            meta[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim()
          }
        }
      }

      // Extract hash from filename
      const m = /^(\d{4}-\d{2}-\d{2})-([a-f0-9]{7,8})/.exec(file)
      if (!m) continue

      // Extract title from H1 or meta
      let title = meta['title'] || ''
      if (!title) {
        for (const line of raw.split('\n')) {
          if (line.trim().startsWith('# ')) {
            title = line.trim().slice(2).trim()
            break
          }
        }
      }
      title = title || file

      rows.push({
        hash: m[2],
        title,
        status: meta['status'] || 'open',
        priority: meta['priority'] || 'medium',
        category: meta['category'] || 'feature',
        date: m[1],
        filePath: file
      })
    } catch {
      // skip unreadable files
    }
  }

  rows.sort((a, b) => b.date.localeCompare(a.date))

  const header = `# Issue Index

| Hash | Title | Status | Priority | Category | Date |
|------|-------|--------|----------|----------|------|
`
  const tableRows = rows
    .map((r) => `| ${r.hash} | ${r.title} | ${r.status} | ${r.priority} | ${r.category} | ${r.date} |`)
    .join('\n')

  const content = header + tableRows + '\n'
  await fs.writeFile(join(issuesDir, 'INDEX.md'), content, 'utf-8')
}
