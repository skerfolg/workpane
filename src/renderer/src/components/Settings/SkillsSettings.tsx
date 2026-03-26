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
          워크스페이스를 열면 스킬을 관리할 수 있습니다.
        </p>
      )}

      {installed.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h4 style={{ marginBottom: 8 }}>설치된 스킬</h4>
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
                    <span style={{ fontSize: 12, alignSelf: 'center' }}>정말 삭제?</span>
                    <button
                      className="btn btn--danger btn--sm"
                      disabled={loading}
                      onClick={() => handleUninstall(skill.name)}
                    >
                      삭제
                    </button>
                    <button
                      className="btn btn--sm"
                      onClick={() => setPendingUninstall(null)}
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn btn--icon"
                    title="제거"
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
        <h4 style={{ marginBottom: 8 }}>사용 가능한 스킬</h4>
        {available.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>사용 가능한 스킬이 없습니다.</p>
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
                      <><CheckCircle size={12} /> 설치됨</>
                    ) : (
                      <><Download size={12} /> 설치</>
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
