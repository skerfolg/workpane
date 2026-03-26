#!/usr/bin/env node
import { Command } from 'commander'
import { sendRequest } from './client'

const program = new Command()

program
  .name('pm')
  .description('PromptManager CLI - control the running app')
  .version('1.0.0')

// app status
program
  .command('status')
  .description('Show app status')
  .action(async () => {
    try {
      const result = await sendRequest('app.status')
      console.log(JSON.stringify(result, null, 2))
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

// terminal commands
const terminal = program.command('terminal').description('Terminal management')

terminal
  .command('create')
  .description('Create a new terminal')
  .option('--shell <shell>', 'Shell to use (e.g. bash, powershell)')
  .option('--cwd <cwd>', 'Working directory', '.')
  .option('--id <id>', 'Terminal ID', () => `term-${Date.now()}`)
  .action(async (opts) => {
    try {
      const id = opts.id || `term-${Date.now()}`
      const result = await sendRequest('terminal.create', {
        id,
        shell: opts.shell,
        cwd: opts.cwd
      })
      console.log(JSON.stringify(result, null, 2))
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

terminal
  .command('write <id> <command>')
  .description('Write a command to a terminal')
  .action(async (id: string, command: string) => {
    try {
      const result = await sendRequest('terminal.write', { id, data: command + '\n' })
      console.log(JSON.stringify(result, null, 2))
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

terminal
  .command('list')
  .description('List active terminals')
  .action(async () => {
    try {
      const result = await sendRequest('terminal.list')
      console.log(JSON.stringify(result, null, 2))
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

// workspace commands
const workspace = program.command('workspace').description('Workspace management')

workspace
  .command('open <path>')
  .description('Open a workspace directory')
  .action(async (dirPath: string) => {
    try {
      const result = await sendRequest('workspace.open', { path: dirPath })
      console.log(JSON.stringify(result, null, 2))
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

workspace
  .command('current')
  .description('Show current workspace')
  .action(async () => {
    try {
      const result = await sendRequest('workspace.current')
      console.log(JSON.stringify(result, null, 2))
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

workspace
  .command('list')
  .description('List recent workspaces')
  .action(async () => {
    try {
      const result = await sendRequest('workspace.list')
      console.log(JSON.stringify(result, null, 2))
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

program.parse(process.argv)
