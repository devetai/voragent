import { test, expect } from 'vitest';
import type { ProviderState } from '@voragent/shared';
import { DEFAULT_CONFIG } from '../src/config.js';
import { pickProvider } from '../src/scheduler.js';

const config = { ...DEFAULT_CONFIG, dataDir: 'x' };
const now = 1_000_000;

function ps(id: string, o: Partial<ProviderState> = {}): ProviderState {
  return { id, cooldownUntil: null, usedPercent: null, installed: true, version: '1', updatedAt: 0, ...o };
}

function pick(
  o: {
    priority?: string[]; current?: string | null; isNewTask?: boolean;
    providers?: ProviderState[]; running?: Record<string, number>; totalRunning?: number; now?: number;
  } = {},
) {
  const provs = o.providers ?? [ps('claude'), ps('codex')];
  return pickProvider({
    priority: o.priority ?? ['claude', 'codex'],
    current: o.current ?? null,
    isNewTask: o.isNewTask ?? true,
    providers: new Map(provs.map((p) => [p.id, p])),
    running: new Map(Object.entries(o.running ?? {})),
    totalRunning: o.totalRunning ?? 0,
    config,
    now: o.now ?? now,
  });
}

test('first priority provider wins', () => {
  expect(pick()).toEqual({ provider: 'claude' });
});

test('usable current wins over earlier priority', () => {
  expect(pick({ priority: ['codex', 'claude'], current: 'claude', isNewTask: false })).toEqual({ provider: 'claude' });
});

test('cooldown excludes, then includes once now passes; now === cooldownUntil is usable', () => {
  const providers = [ps('claude', { cooldownUntil: now + 1000 }), ps('codex')];
  expect(pick({ providers })).toEqual({ provider: 'codex' });
  expect(pick({ providers, now: now + 999 })).toEqual({ provider: 'codex' });
  expect(pick({ providers, now: now + 1000 })).toEqual({ provider: 'claude' });
  expect(pick({ providers, now: now + 1001 })).toEqual({ provider: 'claude' });
});

test('current in cooldown falls through to priority', () => {
  const providers = [ps('claude', { cooldownUntil: now + 1 }), ps('codex')];
  expect(pick({ providers, current: 'claude', isNewTask: false })).toEqual({ provider: 'codex' });
});

test('new task skips usedPercent over threshold; existing task keeps current', () => {
  const providers = [ps('claude', { usedPercent: 0.95 }), ps('codex')];
  expect(pick({ providers })).toEqual({ provider: 'codex' });
  expect(pick({ providers, current: 'claude', isNewTask: false })).toEqual({ provider: 'claude' });
});

test('usedPercent === threshold is skipped for new task; just below is not', () => {
  expect(pick({ providers: [ps('claude', { usedPercent: 0.9 }), ps('codex')] })).toEqual({ provider: 'codex' });
  expect(pick({ providers: [ps('claude', { usedPercent: 0.89 }), ps('codex')] })).toEqual({ provider: 'claude' });
});

test('new task with all providers over threshold waits for quota', () => {
  const providers = [ps('claude', { usedPercent: 0.95 }), ps('codex', { usedPercent: 0.99 })];
  expect(pick({ providers })).toEqual({ wait: 'quota' });
});

test('both cooling down gives wait quota', () => {
  const providers = [ps('claude', { cooldownUntil: now + 5 }), ps('codex', { cooldownUntil: now + 5 })];
  expect(pick({ providers })).toEqual({ wait: 'quota' });
});

test('totalRunning at limit gives wait capacity, even with a usable current', () => {
  expect(pick({ totalRunning: 4 })).toEqual({ wait: 'capacity' });
  expect(pick({ totalRunning: 4, current: 'claude', isNewTask: false })).toEqual({ wait: 'capacity' });
  expect(pick({ totalRunning: 3 })).toEqual({ provider: 'claude' });
});

test('installed:false is never chosen', () => {
  const providers = [ps('claude', { installed: false }), ps('codex')];
  expect(pick({ providers })).toEqual({ provider: 'codex' });
  expect(pick({ providers, current: 'claude', isNewTask: false })).toEqual({ provider: 'codex' });
  expect(pick({ providers: [ps('claude', { installed: false }), ps('codex', { installed: false })] })).toEqual({ wait: 'quota' });
});

test('provider missing from the map is treated as not installed', () => {
  expect(pick({ providers: [ps('codex')] })).toEqual({ provider: 'codex' });
  expect(pick({ providers: [ps('codex')], current: 'claude', isNewTask: false })).toEqual({ provider: 'codex' });
  expect(pick({ providers: [] })).toEqual({ wait: 'quota' });
});

test('empty priority and no current gives wait quota', () => {
  expect(pick({ priority: [] })).toEqual({ wait: 'quota' });
});

test('per-provider full moves on to the next provider', () => {
  expect(pick({ running: { claude: 2 } })).toEqual({ provider: 'codex' });
});

test('all usable providers full gives wait capacity', () => {
  expect(pick({ running: { claude: 2, codex: 2 }, totalRunning: 3 })).toEqual({ wait: 'capacity' });
});

test('full provider plus cooling-down other gives wait capacity', () => {
  const providers = [ps('claude'), ps('codex', { cooldownUntil: now + 9 })];
  expect(pick({ providers, running: { claude: 2 } })).toEqual({ wait: 'capacity' });
});

test('full provider that is cooling down or uninstalled is not a capacity wait', () => {
  const providers = [ps('claude', { cooldownUntil: now + 9 }), ps('codex', { installed: false })];
  expect(pick({ providers, running: { claude: 2, codex: 2 } })).toEqual({ wait: 'quota' });
});

test('inputs are not mutated', () => {
  const providers = new Map([['claude', ps('claude')], ['codex', ps('codex')]]);
  const running = new Map([['claude', 1]]);
  const priority = ['claude', 'codex'];
  const snap = JSON.stringify([[...providers], [...running], priority, config]);
  pickProvider({ priority, current: null, isNewTask: true, providers, running, totalRunning: 1, config, now });
  expect(JSON.stringify([[...providers], [...running], priority, config])).toBe(snap);
});
