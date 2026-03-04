import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import * as crypto from 'crypto'

export interface ManagedProcess {
  id: number
  process: ChildProcess
  sessionId: string
  cwd: string
}

const processes = new Map<number, ManagedProcess>()

export function launchClaude(id: number, cwd: string): ManagedProcess {
  const sessionId = crypto.randomUUID()

  const proc = spawn('claude', ['--session-id', sessionId], {
    cwd,
    stdio: 'pipe',
    shell: true,
    env: { ...process.env },
  })

  proc.on('error', (err) => {
    console.error(`[Pixel Agents] Process ${id} error:`, err)
  })

  proc.on('exit', (code) => {
    console.log(`[Pixel Agents] Process ${id} exited with code ${code}`)
    processes.delete(id)
  })

  const managed: ManagedProcess = { id, process: proc, sessionId, cwd }
  processes.set(id, managed)
  return managed
}

export function killProcess(id: number): void {
  const managed = processes.get(id)
  if (managed) {
    managed.process.kill('SIGTERM')
    processes.delete(id)
  }
}

export function getProcess(id: number): ManagedProcess | undefined {
  return processes.get(id)
}

export function getAllProcesses(): Map<number, ManagedProcess> {
  return processes
}

export function killAllProcesses(): void {
  for (const [id, managed] of processes) {
    managed.process.kill('SIGTERM')
    processes.delete(id)
  }
}
