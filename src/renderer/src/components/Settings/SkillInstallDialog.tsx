import { useState } from 'react'
import { Package } from 'lucide-react'

interface SkillInfo {
  name: string
  version: string
  description: string
  files: string[]
  docsStructure: string[]
}

interface SkillInstallDialogProps {
  workspacePath: string
  skills: SkillInfo[]
  onInstall: (selectedSkills: string[]) => void
  onSkip: () => void
}

export function SkillInstallDialog({
  workspacePath,
  skills,
  onInstall,
  onSkip
}: SkillInstallDialogProps): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(skills.map((s) => s.name))
  )
  const [installing, setInstalling] = useState(false)

  function toggleSkill(name: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  async function handleInstall(): Promise<void> {
    if (selected.size === 0) {
      onSkip()
      return
    }
    setInstalling(true)
    try {
      for (const skillName of selected) {
        await (window as any).skills.install(skillName, workspacePath)
      }
      onInstall(Array.from(selected))
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
    >
      <div
        style={{
          background: 'var(--bg-secondary, #1e1e2e)',
          border: '1px solid var(--border-color, #333)',
          borderRadius: 8,
          padding: 24,
          width: 420,
          maxWidth: '90vw'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Package size={20} />
          <h3 style={{ margin: 0 }}>Install Skills</h3>
        </div>

        <p style={{ color: 'var(--text-muted)', marginBottom: 16, fontSize: 14 }}>
          Install skills to this workspace? (<strong>{workspacePath.split(/[/\\]/).pop()}</strong>)
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {skills.map((skill) => (
            <label
              key={skill.name}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                cursor: 'pointer',
                padding: '8px 12px',
                border: '1px solid var(--border-color, #333)',
                borderRadius: 6,
                background: selected.has(skill.name)
                  ? 'var(--bg-selected, rgba(99,102,241,0.1))'
                  : 'transparent'
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(skill.name)}
                onChange={() => toggleSkill(skill.name)}
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              <div>
                <div style={{ fontWeight: 500 }}>
                  {skill.name}{' '}
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>v{skill.version}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {skill.description}
                </div>
              </div>
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onSkip} disabled={installing}>
            Skip
          </button>
          <button
            className="btn btn--primary"
            onClick={handleInstall}
            disabled={installing || selected.size === 0}
          >
            {installing ? 'Installing...' : `Install (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  )
}
