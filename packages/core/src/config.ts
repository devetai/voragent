import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config, WorkspaceMode } from '@voragent/shared';

export const DEFAULT_CONFIG: Omit<Config, 'dataDir'> = {
  port: 4717,
  priority: ['claude', 'codex'],
  concurrency: { perProvider: 2, total: 4 },
  quotaThreshold: 0.9,
  defaultCooldownMs: 3_600_000,
  turnTimeoutMs: 1_800_000,
  network: true,
  defaultMode: 'head-dirty-commit',
  handoffMaxChars: 24_000,
};

const MODES: WorkspaceMode[] = ['head-dirty-commit', 'head-commit', 'dirty-nocommit'];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(file: string, key: string, expected: string): never {
  throw new Error(`Cấu hình sai trong ${file}: "${key}" phải là ${expected}.`);
}

function num(file: string, key: string, v: unknown, opts: { fraction?: boolean } = {}): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(file, key, 'một số');
  if (opts.fraction ? v < 0 || v > 1 : v <= 0) {
    fail(file, key, opts.fraction ? 'một số từ 0 đến 1' : 'một số lớn hơn 0');
  }
  return v;
}

export function loadConfig(dataDir: string): Config {
  const file = join(dataDir, 'config.json');
  const base: Config = {
    ...DEFAULT_CONFIG,
    priority: [...DEFAULT_CONFIG.priority],
    concurrency: { ...DEFAULT_CONFIG.concurrency },
    dataDir,
  };

  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return base;
    throw new Error(`Không đọc được ${file}: ${(e as Error).message}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`Tệp ${file} không phải JSON hợp lệ: ${(e as Error).message}`);
  }
  if (!isObject(raw)) fail(file, '(gốc)', 'một đối tượng JSON');

  if (raw.port !== undefined) base.port = num(file, 'port', raw.port);
  if (raw.priority !== undefined) {
    if (!Array.isArray(raw.priority) || !raw.priority.every((p) => typeof p === 'string')) {
      fail(file, 'priority', 'một danh sách chuỗi');
    }
    base.priority = [...(raw.priority as string[])];
  }
  if (raw.concurrency !== undefined) {
    if (!isObject(raw.concurrency)) fail(file, 'concurrency', 'một đối tượng');
    const c = raw.concurrency;
    if (c.perProvider !== undefined) base.concurrency.perProvider = num(file, 'concurrency.perProvider', c.perProvider);
    if (c.total !== undefined) base.concurrency.total = num(file, 'concurrency.total', c.total);
  }
  if (raw.quotaThreshold !== undefined) {
    base.quotaThreshold = num(file, 'quotaThreshold', raw.quotaThreshold, { fraction: true });
  }
  if (raw.defaultCooldownMs !== undefined) base.defaultCooldownMs = num(file, 'defaultCooldownMs', raw.defaultCooldownMs);
  if (raw.turnTimeoutMs !== undefined) base.turnTimeoutMs = num(file, 'turnTimeoutMs', raw.turnTimeoutMs);
  if (raw.network !== undefined) {
    if (typeof raw.network !== 'boolean') fail(file, 'network', 'true hoặc false');
    base.network = raw.network;
  }
  if (raw.defaultMode !== undefined) {
    if (!MODES.includes(raw.defaultMode as WorkspaceMode)) {
      fail(file, 'defaultMode', `một trong: ${MODES.join(', ')}`);
    }
    base.defaultMode = raw.defaultMode as WorkspaceMode;
  }
  if (raw.handoffMaxChars !== undefined) base.handoffMaxChars = num(file, 'handoffMaxChars', raw.handoffMaxChars);
  return base;
}
