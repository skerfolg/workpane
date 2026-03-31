import { app } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import * as https from 'https'
import * as crypto from 'crypto'
import * as os from 'os'
import type {
  SkillInfo,
  RegistrySkill,
  SkillRegistry,
  InstalledSkillRecord,
  UnifiedSkill
} from '../shared/types'

export type { SkillInfo }

interface RegistryCache {
  registry: SkillRegistry
  etag: string | null
}

export class SkillsManager {
  private readonly registryUrl =
    'https://raw.githubusercontent.com/skerfolg/workpane-skills/main/registry.json'

  getResourcesPath(): string {
    return app.isPackaged
      ? process.resourcesPath
      : join(__dirname, '../../resources')
  }

  getAvailableSkills(): SkillInfo[] {
    const skillsDir = join(this.getResourcesPath(), 'skills')
    if (!fs.existsSync(skillsDir)) return []

    const skills: SkillInfo[] = []
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillJsonPath = join(skillsDir, entry.name, 'skill.json')
      if (!fs.existsSync(skillJsonPath)) continue

      try {
        const raw = fs.readFileSync(skillJsonPath, 'utf-8')
        const skill = JSON.parse(raw) as SkillInfo
        skills.push(skill)
      } catch {
        // skip malformed skill.json
      }
    }

    return skills
  }

  getInstalledSkills(projectPath: string): SkillInfo[] {
    const skillsDir = join(projectPath, '.claude', 'skills')
    if (!fs.existsSync(skillsDir)) return []

    const skills: SkillInfo[] = []
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillJsonPath = join(skillsDir, entry.name, 'skill.json')
      if (!fs.existsSync(skillJsonPath)) continue

      try {
        const raw = fs.readFileSync(skillJsonPath, 'utf-8')
        const skill = JSON.parse(raw) as SkillInfo
        skills.push(skill)
      } catch {
        // skip malformed skill.json
      }
    }

    return skills
  }

  installSkill(skillName: string, projectPath: string): void {
    const srcDir = join(this.getResourcesPath(), 'skills', skillName)
    if (!fs.existsSync(srcDir)) {
      throw new Error(`Skill "${skillName}" not found in resources`)
    }

    const destDir = join(projectPath, '.claude', 'skills', skillName)
    fs.mkdirSync(destDir, { recursive: true })

    // Copy all skill files
    const entries = fs.readdirSync(srcDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      fs.copyFileSync(join(srcDir, entry.name), join(destDir, entry.name))
    }

    // Create docs structure
    const skillJsonPath = join(srcDir, 'skill.json')
    if (fs.existsSync(skillJsonPath)) {
      const skill = JSON.parse(fs.readFileSync(skillJsonPath, 'utf-8')) as SkillInfo
      for (const docDir of skill.docsStructure ?? []) {
        const fullDocDir = join(projectPath, docDir)
        fs.mkdirSync(fullDocDir, { recursive: true })

        // Create INDEX.md in issues dir
        if (docDir.includes('issues')) {
          const indexPath = join(fullDocDir, 'INDEX.md')
          if (!fs.existsSync(indexPath)) {
            fs.writeFileSync(
              indexPath,
              '# Issue Index\n\n| ID | Title | Status | Priority | Category | Created |\n|----|-------|--------|----------|----------|---------|\n',
              'utf-8'
            )
          }
        }
      }
    }
  }

  uninstallSkill(skillName: string, projectPath: string): void {
    const destDir = join(projectPath, '.claude', 'skills', skillName)
    if (!fs.existsSync(destDir)) return
    fs.rmSync(destDir, { recursive: true, force: true })
  }

  // --- Registry support ---

  async fetchRegistry(): Promise<SkillRegistry> {
    const cached = this.getCachedRegistry()
    const etag = cached?.etag ?? null

    return new Promise<SkillRegistry>((resolve, reject) => {
      const headers: Record<string, string> = {
        'User-Agent': 'PromptManager/1.0',
        'Accept': 'application/json'
      }
      if (etag) {
        headers['If-None-Match'] = etag
      }

      const req = https.get(this.registryUrl, { headers }, (res) => {
        if (res.statusCode === 304 && cached) {
          // Not modified — return cached
          resolve(cached.registry)
          return
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Registry fetch failed: HTTP ${res.statusCode}`))
          return
        }

        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8')
            const registry = JSON.parse(body) as SkillRegistry
            const newEtag = (res.headers['etag'] as string | undefined) ?? null
            this.saveRegistryCache(registry, newEtag)
            resolve(registry)
          } catch (err) {
            reject(err)
          }
        })
      })

      req.on('error', reject)
      req.end()
    })
  }

  getCachedRegistry(): RegistryCache | null {
    const cachePath = join(app.getPath('userData'), 'skill-registry-cache.json')
    if (!fs.existsSync(cachePath)) return null

    try {
      const raw = fs.readFileSync(cachePath, 'utf-8')
      return JSON.parse(raw) as RegistryCache
    } catch {
      return null
    }
  }

  saveRegistryCache(registry: SkillRegistry, etag: string | null): void {
    const cachePath = join(app.getPath('userData'), 'skill-registry-cache.json')
    const cache: RegistryCache = { registry, etag }
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8')
  }

  async getRegistrySkills(): Promise<RegistrySkill[]> {
    try {
      const registry = await this.fetchRegistry()
      return registry.skills
    } catch {
      // Stale-while-revalidate: fall back to cache on network error
      const cached = this.getCachedRegistry()
      return cached?.registry.skills ?? []
    }
  }

  async getUnifiedSkills(): Promise<UnifiedSkill[]> {
    const bundled = this.getAvailableSkills().map(
      (s): UnifiedSkill => ({
        id: s.name,
        name: s.name,
        version: s.version,
        description: s.description,
        source: 'bundled',
        agents: {},
        tags: []
      })
    )

    const registrySkills = await this.getRegistrySkills()
    const registry = registrySkills.map(
      (s): UnifiedSkill => ({
        id: s.id,
        name: s.name,
        version: s.version,
        description: s.description,
        source: 'registry',
        agents: s.agents,
        tags: s.tags
      })
    )

    return [...bundled, ...registry]
  }

  async installRegistrySkill(
    skillId: string,
    agentId: string,
    projectPath: string
  ): Promise<void> {
    const skills = await this.getRegistrySkills()
    const skill = skills.find((s) => s.id === skillId)
    if (!skill) throw new Error(`Registry skill "${skillId}" not found`)

    const agentConfig = skill.agents[agentId]
    if (!agentConfig) throw new Error(`Agent "${agentId}" not configured for skill "${skillId}"`)

    const installPath = agentConfig.installPath.replace('{projectRoot}', projectPath)

    // Download to a temp dir first for atomicity
    const tmpDir = join(os.tmpdir(), `workpane-skill-${skillId}-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })

    try {
      for (const file of skill.files) {
        const tmpFile = join(tmpDir, file.name)
        await this.downloadFile(file.url, tmpFile)

        if (!this.verifyHash(tmpFile, file.sha256)) {
          throw new Error(
            `SHA-256 mismatch for file "${file.name}" in skill "${skillId}"`
          )
        }
      }

      // All files verified — move to install path atomically
      fs.mkdirSync(installPath, { recursive: true })
      for (const file of skill.files) {
        fs.copyFileSync(join(tmpDir, file.name), join(installPath, file.name))
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }

    // Update tracking record
    const records = this.getInstalledRecords(projectPath)
    const existing = records.findIndex(
      (r) => r.skillId === skillId && r.agentId === agentId
    )
    const record: InstalledSkillRecord = {
      skillId,
      version: skill.version,
      agentId,
      installedAt: new Date().toISOString(),
      installPath
    }
    const updated =
      existing >= 0
        ? records.map((r, i) => (i === existing ? record : r))
        : [...records, record]

    this.saveInstalledRecords(projectPath, updated)
  }

  async uninstallRegistrySkill(
    skillId: string,
    agentId: string,
    projectPath: string
  ): Promise<void> {
    const records = this.getInstalledRecords(projectPath)
    const record = records.find((r) => r.skillId === skillId && r.agentId === agentId)
    if (!record) return

    if (fs.existsSync(record.installPath)) {
      fs.rmSync(record.installPath, { recursive: true, force: true })
    }

    const updated = records.filter(
      (r) => !(r.skillId === skillId && r.agentId === agentId)
    )
    this.saveInstalledRecords(projectPath, updated)
  }

  getInstalledRecords(projectPath: string): InstalledSkillRecord[] {
    const trackingPath = join(projectPath, '.claude', 'installed-skills.json')
    if (!fs.existsSync(trackingPath)) return []

    try {
      const raw = fs.readFileSync(trackingPath, 'utf-8')
      return JSON.parse(raw) as InstalledSkillRecord[]
    } catch {
      return []
    }
  }

  private verifyHash(filePath: string, expectedSha256: string): boolean {
    const hash = crypto.createHash('sha256')
    const data = fs.readFileSync(filePath)
    hash.update(data)
    return hash.digest('hex') === expectedSha256
  }

  private saveInstalledRecords(
    projectPath: string,
    records: InstalledSkillRecord[]
  ): void {
    const claudeDir = join(projectPath, '.claude')
    fs.mkdirSync(claudeDir, { recursive: true })
    const trackingPath = join(claudeDir, 'installed-skills.json')
    fs.writeFileSync(trackingPath, JSON.stringify(records, null, 2), 'utf-8')
  }

  private downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(destPath)

      const handleResponse = (res: import('http').IncomingMessage): void => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location
          if (!location) {
            reject(new Error(`Redirect with no Location header for ${url}`))
            return
          }
          file.close()
          this.downloadFile(location, destPath).then(resolve).catch(reject)
          return
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode} for ${url}`))
          return
        }

        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
        file.on('error', reject)
      }

      const req = https.get(url, { headers: { 'User-Agent': 'PromptManager/1.0' } }, handleResponse)
      req.on('error', reject)
      req.end()
    })
  }
}
