import { useState, useEffect } from 'react'
import { Package, Trash2, Download, CheckCircle } from 'lucide-react'

interface SkillInfo {
  name: string
  version: string
  description: string
  files: string[]
  docsStructure: string[]
}

interface SkillsSettingsProps {
  workspacePath: string | null
}

export function SkillsSettings({ workspacePath }: SkillsSettingsProps): JSX.Element {
  const [available, setAvailable] = useState<SkillInfo[]>([])
  const [installed, setInstalled] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [pendingUninstall, setPendingUninstall] = useState<string | null>(null)

  useEffect(() => {
    loadSkills()
  }, [workspacePath])

  async function loadSkills(): Promise<void> {
    setLoading(true)
    try {
      const avail = await (window as any).skills.getAvailable()
      setAvailable(avail ?? [])
      if (workspacePath) {
        const inst = await (window as any).skills.getInstalled(workspacePath)
        setInstalled(inst ?? [])
      } else {
        setInstalled([])
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleInstall(skillName: string): Promise<void> {
    if (!workspacePath) return
    setLoading(true)
    try {
      await (window as any).skills.install(skillName, workspacePath)
      await loadSkills()
    } finally {
      setLoading(false)
    }
  }

  async function handleUninstall(skillName: string): Promise<void> {
    if (!workspacePath) return
    setLoading(true)
    setPendingUninstall(null)
    try {
      await (window as any).skills.uninstall(skillName, workspacePath)
      await loadSkills()
    } finally {
      setLoading(false)
    }
  }

  const installedNames = new Set(installed.map((s) => s.name))

  return (
    <div className="skills-settings">
      <h3 style={{ marginBottom: 16 }}>Skills</h3>

      {!workspacePath && (
        <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
          Open a workspace to manage skills.
        </p>
      )}

      {installed.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h4 style={{ marginBottom: 8 }}>Installed Skills</h4>
          <div className="skill-list">
            {installed.map((skill) => (
              <div key={skill.name} className="skill-item skill-item--installed">
                <CheckCircle size={16} style={{ color: 'var(--color-success, #4caf50)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{skill.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    v{skill.version} — {skill.description}
                  </div>
                </div>
                {pendingUninstall === skill.name ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <span style={{ fontSize: 12, alignSelf: 'center' }}>Confirm delete?</span>
                    <button
                      className="btn btn--danger btn--sm"
                      disabled={loading}
                      onClick={() => handleUninstall(skill.name)}
                    >
                      Delete
                    </button>
                    <button
                      className="btn btn--sm"
                      onClick={() => setPendingUninstall(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn btn--icon"
                    title="Remove"
                    disabled={loading || !workspacePath}
                    onClick={() => setPendingUninstall(skill.name)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h4 style={{ marginBottom: 8 }}>Available Skills</h4>
        {available.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No available skills.</p>
        ) : (
          <div className="skill-list">
            {available.map((skill) => {
              const isInstalled = installedNames.has(skill.name)
              return (
                <div key={skill.name} className="skill-item">
                  <Package size={16} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{skill.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      v{skill.version} — {skill.description}
                    </div>
                  </div>
                  <button
                    className="btn btn--sm"
                    disabled={loading || isInstalled || !workspacePath}
                    onClick={() => handleInstall(skill.name)}
                  >
                    {isInstalled ? (
                      <><CheckCircle size={12} /> Installed</>
                    ) : (
                      <><Download size={12} /> Install</>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
