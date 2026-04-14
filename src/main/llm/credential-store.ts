import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type { LlmProviderId, LlmStorageStatus } from '../../shared/types'

type CredentialRecord = Partial<Record<LlmProviderId, string>>

export class LlmCredentialStore {
  private getFilePath(): string {
    return path.join(app.getPath('userData'), 'llm-credentials.json')
  }

  private async readAll(): Promise<CredentialRecord> {
    try {
      const raw = await fs.readFile(this.getFilePath(), 'utf-8')
      return JSON.parse(raw) as CredentialRecord
    } catch {
      return {}
    }
  }

  private async writeAll(records: CredentialRecord): Promise<void> {
    await fs.writeFile(this.getFilePath(), JSON.stringify(records, null, 2), 'utf-8')
  }

  getStorageStatus(): LlmStorageStatus {
    const available = safeStorage.isEncryptionAvailable()
    const backend = process.platform === 'linux'
      ? safeStorage.getSelectedStorageBackend()
      : process.platform === 'win32'
        ? 'dpapi'
        : process.platform === 'darwin'
          ? 'keychain'
      : 'not_supported'
    const degraded = backend === 'basic_text'

    if (!available) {
      return {
        available: false,
        backend,
        degraded,
        detail: 'Encryption is unavailable. API keys cannot be persisted securely yet.'
      }
    }

    if (degraded) {
      return {
        available: true,
        backend,
        degraded: true,
        detail: 'Encryption is available through the basic_text backend. Persisted keys are protected more weakly than OS secret-store backends.'
      }
    }

    return {
      available: true,
      backend,
      degraded: false,
      detail: 'Secure credential storage is available.'
    }
  }

  async hasCredential(providerId: LlmProviderId): Promise<boolean> {
    const records = await this.readAll()
    return Boolean(records[providerId])
  }

  async setCredential(providerId: LlmProviderId, secret: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this system.')
    }

    const records = await this.readAll()
    records[providerId] = safeStorage.encryptString(secret).toString('base64')
    await this.writeAll(records)
  }

  async getCredential(providerId: LlmProviderId): Promise<string | null> {
    const records = await this.readAll()
    const encoded = records[providerId]
    if (!encoded) return null
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  }

  async clearCredential(providerId: LlmProviderId): Promise<void> {
    const records = await this.readAll()
    delete records[providerId]
    await this.writeAll(records)
  }
}
