import type { EventType, ProviderId } from '@voragent/shared';

export interface TurnInput {
  prompt: string;
  systemPrompt: string;
  sessionId: string | null;
  cwd: string;
  network: boolean;
}
export interface Invocation {
  bin: string;
  args: string[];
  stdin: string;
  env?: Record<string, string>;
}
export interface ParsedEvent {
  type: EventType;
  data: Record<string, unknown>;
}
export interface TurnResult {
  outcome: 'ok' | 'quota_exhausted' | 'error';
  text: string; // câu trả lời cuối của agent
  sessionId: string | null;
  resetsAt: number | null; // epoch ms, chỉ có khi outcome là 'quota_exhausted'
  error: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  quota: { usedPercent: number; resetsAt: number | null } | null; // khi CLI có báo; usedPercent là tỉ lệ 0..1
  /** Chỉ do runTurn đặt: lượt bị dừng bằng AbortSignal (khác hết giờ). */
  aborted?: boolean;
}
export interface StreamParser {
  push(line: string): ParsedEvent[];
  finish(exit: { code: number | null; stderr: string; timedOut: boolean }): TurnResult;
}
export interface Adapter {
  id: ProviderId;
  detect(): Promise<{ installed: boolean; version: string | null }>;
  invocation(input: TurnInput): Invocation;
  createParser(): StreamParser;
}
