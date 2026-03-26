import { app } from 'electron'
import { join } from 'path'
import * as fs from 'fs'

export interface SkillInfo {
  name: string
  version: string
  description: string
  files: string[]
  docsStructure: string[]
}

export class SkillsManager {
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
}
