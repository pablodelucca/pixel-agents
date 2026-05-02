// server/__tests__/headlessSpawner.test.ts
import { describe, expect, it, vi } from 'vitest';

// Mock child_process antes de importar
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';

import { HeadlessSpawner } from '../src/orchestrator/headlessSpawner.js';
import type { Role } from '../src/orchestrator/types.js';

const fakeRole: Role = {
  id: 'tester',
  label: 'Tester',
  systemPrompt: 'Be a tester',
  palette: 1,
  hueShift: 30,
};

describe('HeadlessSpawner', () => {
  it('spawns claude -p with correct flags', () => {
    const mockChild = { on: vi.fn(), kill: vi.fn(), pid: 1234 };
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockChild);

    const spawner = new HeadlessSpawner();
    const result = spawner.spawn({
      role: fakeRole,
      task: 'Write a test',
      cwd: '/tmp',
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(cmd).toBe('claude');
    expect(args).toContain('-p');
    expect(args).toContain('Write a test');
    expect(args).toContain('--session-id');
    expect(args).toContain('--append-system-prompt');
    expect(args).toContain('Be a tester');
    expect(opts.cwd).toBe('/tmp');
    expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.roleId).toBe('tester');
  });

  it('generates a unique sessionId per spawn', () => {
    const mockChild = { on: vi.fn(), kill: vi.fn(), pid: 1234 };
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockChild);
    const spawner = new HeadlessSpawner();
    const a = spawner.spawn({ role: fakeRole, task: 't', cwd: '/tmp' });
    const b = spawner.spawn({ role: fakeRole, task: 't', cwd: '/tmp' });
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it('passes --allowed-tools when role.allowedTools is set', () => {
    const mockChild = { on: vi.fn(), kill: vi.fn(), pid: 1234 };
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockChild);
    const spawner = new HeadlessSpawner();
    spawner.spawn({
      role: { ...fakeRole, allowedTools: ['Read', 'Write'] },
      task: 't',
      cwd: '/tmp',
    });
    const [, args] = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0];
    expect(args).toContain('--allowed-tools');
    expect(args).toContain('Read,Write');
  });
});
