import { test, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';
import type { VEvent } from '@voragent/shared';
import { EventBus as Bus } from '../src/bus.js';

const base = { title: 't', repoPath: '/r', mode: 'head-commit' as const, priority: null, message: 'hi' };

test('createTask: seq từ 1, queued, lượt 0', () => {
  const s = openStore(':memory:');
  const a = s.createTask(base);
  const b = s.createTask(base);
  expect(a.task.seq).toBe(1);
  expect(b.task.seq).toBe(2);
  expect(a.task.status).toBe('queued');
  expect(a.turn.index).toBe(0);
  expect(a.turn.status).toBe('queued');
  expect(s.listTasks().map((t) => t.id)).toEqual([b.task.id, a.task.id]);
  s.close();
});

test('addTurn tăng index; queuedTurns theo thứ tự tạo', () => {
  const s = openStore(':memory:');
  const { task, turn } = s.createTask(base);
  const t2 = s.addTurn(task.id, 'tiếp');
  expect(t2.index).toBe(1);
  expect(s.turnsOf(task.id).map((t) => t.index)).toEqual([0, 1]);
  s.updateTurn(turn.id, { status: 'done', answer: 'ok' });
  expect(s.queuedTurns().map((t) => t.id)).toEqual([t2.id]);
  expect(s.turnsOf(task.id)[0]).toMatchObject({ status: 'done', answer: 'ok' });
  s.close();
});

test('appendEvent id tăng dần, eventsOf(afterId), data khứ hồi JSON', () => {
  const s = openStore(':memory:');
  const { task } = s.createTask(base);
  const e1 = s.appendEvent({ taskId: task.id, runId: null, source: 'managed', type: 'TASK_CREATED', data: { a: [1, 2] } });
  const e2 = s.appendEvent({ taskId: task.id, runId: null, source: 'managed', type: 'STATE_CHANGED', data: {}, ts: 5 });
  expect(e2.id).toBeGreaterThan(e1.id);
  expect(e2.ts).toBe(5);
  expect(s.eventsOf(task.id, e1.id).map((e) => e.id)).toEqual([e2.id]);
  expect(s.eventsOf(task.id)[0]?.data).toEqual({ a: [1, 2] });
  s.close();
});

test('priority lưu là mảng', () => {
  const s = openStore(':memory:');
  const { task } = s.createTask({ ...base, priority: ['codex', 'claude'] });
  expect(s.getTask(task.id)?.priority).toEqual(['codex', 'claude']);
  const u = s.updateTask(task.id, { priority: null, status: 'running', currentProvider: 'codex' });
  expect(u).toMatchObject({ priority: null, status: 'running', currentProvider: 'codex' });
  expect(s.getTask('nope')).toBeNull();
  s.close();
});

test('run và provider', () => {
  const s = openStore(':memory:');
  const { task } = s.createTask(base);
  const r = s.createRun({ taskId: task.id, provider: 'claude', handoff: null });
  expect(r.status).toBe('running');
  expect(s.runningRuns().map((x) => x.id)).toEqual([r.id]);
  s.updateRun(r.id, { status: 'completed', endedAt: 9, sessionId: 'x' });
  expect(s.runningRuns()).toEqual([]);
  expect(s.runsOf(task.id)[0]).toMatchObject({ sessionId: 'x', endedAt: 9 });
  const p = { id: 'claude', cooldownUntil: null, usedPercent: 40, installed: true, version: '1', updatedAt: 1 };
  s.upsertProvider(p);
  s.upsertProvider({ ...p, usedPercent: 50 });
  expect(s.getProvider('claude')?.usedPercent).toBe(50);
  expect(s.getProvider('claude')?.installed).toBe(true);
  expect(s.listProviders()).toHaveLength(1);
  s.close();
});

test('mở lại file DB vẫn đọc được task', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vor-'));
  const file = join(dir, 'db.sqlite');
  try {
    const s1 = openStore(file);
    const { task } = s1.createTask(base);
    s1.close();
    const s2 = openStore(file);
    expect(s2.getTask(task.id)?.title).toBe('t');
    expect(s2.createTask(base).task.seq).toBe(2);
    s2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('EventBus publish/subscribe/unsubscribe', () => {
  const bus = new Bus();
  const got: number[] = [];
  const off = bus.subscribe((e: VEvent) => got.push(e.id));
  const ev = { id: 1, taskId: 't', runId: null, ts: 0, source: 'managed', type: 'USAGE', data: {} } as const;
  bus.publish(ev);
  off();
  bus.publish({ ...ev, id: 2 });
  expect(got).toEqual([1]);
});
