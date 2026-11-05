import spawn from 'cross-spawn';
const UNIT_MS: Record<string, number> = {
  second: 1000, sec: 1000, minute: 60_000, min: 60_000, hour: 3_600_000, hr: 3_600_000,
};

/** Đọc thời điểm reset (epoch ms) từ thông báo hết quota; không đọc được thì trả null. */
export function parseResetTime(text: string, now: number): number | null {
  const epoch = /\|\s*(\d{9,11})\b/.exec(text);
  if (epoch) return Number(epoch[1]) * 1000;

  const clock = /\b(?:resets?|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (clock) {
    const h12 = Number(clock[1]);
    const minute = clock[2] ? Number(clock[2]) : 0;
    if (h12 < 1 || h12 > 12 || minute > 59) return null;
    const pm = clock[3]!.toLowerCase() === 'pm';
    const hour = (h12 % 12) + (pm ? 12 : 0);
    const d = new Date(now);
    d.setHours(hour, minute, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1); // lần gặp giờ này tiếp theo
    return d.getTime();
  }

  const dur = /\bin\s+(\d+)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/i.exec(text);
  if (dur) {
    const unit = dur[2]!.toLowerCase().replace(/s$/, '');
    return now + Number(dur[1]) * UNIT_MS[unit]!;
  }
    // Khớp định dạng cô đọng như agy: "Resets in 43h58m9s" hoặc "in 2h30m"
  const compactDur = /\b(?:resets?\s+in\s+|in\s+)(?:(\d+)\s*h)?(?:(\d+)\s*m)?(?:(\d+)\s*s)?\b/i.exec(text);
  if (compactDur && (compactDur[1] || compactDur[2] || compactDur[3])) {
    const h = compactDur[1] ? Number(compactDur[1]) * 3_600_000 : 0;
    const m = compactDur[2] ? Number(compactDur[2]) * 60_000 : 0;
    const s = compactDur[3] ? Number(compactDur[3]) * 1000 : 0;
    return now + h + m + s;
  }
  return null;
}

/** Cắt bớt văn bản dài hơn `max`, giữ phần cuối; `mark` đặt ở đầu. */
export function truncate(text: string, max: number, mark = '…'): string {
  if (text.length <= max) return text;
  return mark + text.slice(text.length - (max - mark.length));
}

export interface ExitClassification {
  outcome: 'ok' | 'quota_exhausted' | 'error';
  resetsAt: number | null;
  error: string | null;
}

/**
 * Phân loại kết quả lượt chạy. Nguồn báo lỗi duy nhất: `errorSources` (sự kiện lỗi của CLI), stderr,
 * mã thoát. Không bao giờ đọc câu trả lời thường. `hadErrorEvent` mặc định là có nguồn lỗi không rỗng.
 */
export function classifyExit(opts: {
  errorSources: string[];
  hadErrorEvent?: boolean;
  stderr: string;
  exit: { code: number | null; timedOut: boolean };
  patterns: RegExp[];
  now?: number;
  /** Tín hiệu hết quota không nằm trong chữ (vd. rate_limit_event bị từ chối); chỉ có hiệu lực khi lượt thất bại. */
  quotaSignal?: boolean;
}): ExitClassification {
  const { exit, patterns } = opts;
  const sources = [...opts.errorSources, opts.stderr.trim()].filter(Boolean);
  const failed = (opts.hadErrorEvent ?? opts.errorSources.length > 0) || exit.code !== 0 || exit.timedOut;
  // Chỉ lượt thất bại mới bị xét mẫu quota: stderr cảnh báo của một lượt thoát êm không phải hết quota.
  const hit = failed ? sources.find((s) => patterns.some((p) => p.test(s))) : undefined;
  if (hit !== undefined) {
    return { outcome: 'quota_exhausted', resetsAt: parseResetTime(hit, opts.now ?? Date.now()), error: truncate(hit, 500) };
  }
  if (failed && opts.quotaSignal === true) {
    return { outcome: 'quota_exhausted', resetsAt: null, error: truncate(sources.join('\n') || 'Hết quota', 500) };
  }
  if (failed) {
    const message = sources.join('\n') || (exit.timedOut ? 'Hết thời gian chờ' : `Tiến trình thoát với mã ${exit.code}`);
    return { outcome: 'error', resetsAt: null, error: truncate(message, 500) };
  }
  return { outcome: 'ok', resetsAt: null, error: null };
}

/** Chạy `<bin> --version` (qua cross-spawn) để biết CLI có cài và phiên bản nào. */
export function detectBinary(bin: string): Promise<{ installed: boolean; version: string | null }> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    child.on('error', () => resolve({ installed: false, version: null }));
    child.on('close', (code) => {
      const v = /\d+\.\d+\.\d+/.exec(out)?.[0] ?? null;
      resolve({ installed: code === 0 && v !== null, version: v });
    });
  });
}
