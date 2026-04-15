import { test, expect } from '@playwright/test'
import { closeApp, launchApp, openRecentWorkspace } from './helpers/electron'

function getAgentsExplorerNode(page: Parameters<typeof openRecentWorkspace>[0]) {
  return page.locator('.file-explorer__node', {
    has: page.locator('.file-explorer__name', { hasText: 'AGENTS.md' })
  }).first()
}

test.describe('Explorer File Open', () => {
  test('opens a markdown file from the explorer and renders it in the viewer', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)
      await expect(page.locator('.terminal-area')).toBeVisible()
      await expect(page.locator('.markdown-area')).toHaveCount(0)

      const explorerNode = getAgentsExplorerNode(page)
      await expect(explorerNode).toBeVisible()
      await explorerNode.click()

      await expect(page.locator('.markdown-area')).toBeVisible()
      await expect(page.locator('.markdown-area [role="tab"][aria-selected="true"]')).toContainText('AGENTS.md')
      await expect(page.locator('.markdown-area')).toContainText('WorkPane (PromptManager)')
      await expect(page.locator('.status-bar__filename')).toContainText('AGENTS.md')
    } finally {
      await closeApp(app)
    }
  })

  test('keeps only the file actions in the explorer context menu', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      const explorerNode = getAgentsExplorerNode(page)
      await expect(explorerNode).toBeVisible()
      await explorerNode.click({ button: 'right' })

      const contextMenu = page.locator('.file-explorer__context-menu')
      await expect(contextMenu).toBeVisible()
      await expect(contextMenu.locator('.file-explorer__context-item')).toHaveCount(4)
      await expect(contextMenu).toContainText('New File')
      await expect(contextMenu).toContainText('New Folder')
      await expect(contextMenu).toContainText('Rename')
      await expect(contextMenu).toContainText('Delete')
    } finally {
      await closeApp(app)
    }
  })
})
