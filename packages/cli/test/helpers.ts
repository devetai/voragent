import { rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';

/** Cổng ngẫu nhiên trong dải cao, đã thử bind được. Vẫn có thể trượt (TOCTOU): dùng kèm `withFreePort`. */
export async function freePort(): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const ok = await new Promise<boolean>((res) => {
      const s = createNetServer();
      s.once('error', () => res(false));
      s.listen(port, '127.0.0.1', () => s.close(() => res(true)));
    });
    if (ok) return port;
  }
  throw new Error('Không tìm được cổng trống.');
}

/** Gọi `make(port)` với cổng mới; gặp lỗi "cổng đang được dùng" thì thử lại tối đa 5 lần. */
export async function withFreePort<T>(make: (port: number) => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      return await make(await freePort());
    } catch (e) {
      if (!/đang được dùng|EADDRINUSE/.test(e instanceof Error ? e.message : String(e))) throw e;
      last = e;
    }
  }
  throw last;
}

/** Chờ điều kiện đúng; quá hạn thì ném lỗi nêu rõ điều đang chờ. */
export async function until<T>(
  fn: () => T | undefined | false | Promise<T | undefined | false>, what: string, ms = 20_000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Hết giờ chờ: ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * Xóa thư mục tạm, KHÔNG BAO GIỜ ném lỗi. Trên Windows, antivirus/indexer có thể giữ handle vài giây
 * (EBUSY/EPERM) dù test đã đạt; thư mục tạm bỏ lại là vô hại, còn test đỏ vì dọn dẹp là lỗi.
 * Tự thử lại (khoảng 5 giây) vì `maxRetries` của rmSync không thử lại khi rmdir cuối cùng báo EBUSY.
 */
export function rmTmp(dir: string): void {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
  // bỏ lại thư mục: chỉ là rác tạm
}
