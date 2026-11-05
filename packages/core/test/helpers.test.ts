import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rmTmp, until } from './helpers.js';

describe('rmTmp', () => {
  it('xóa thư mục cùng nội dung', () => {
    const dir = mkdtempSync(join(tmpdir(), 'voragent-rmtmp-'));
    mkdirSync(join(dir, 'a'));
    writeFileSync(join(dir, 'a', 'f.txt'), 'x');
    rmTmp(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it('thư mục không tồn tại thì không ném lỗi', () => {
    expect(() => rmTmp(join(tmpdir(), 'voragent-rmtmp-khong-co'))).not.toThrow();
  });

  it.runIf(process.platform === 'win32')('thư mục bị khóa dai dẳng: không ném lỗi, để lại thư mục', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voragent-rmtmp-'));
    // tiến trình con đặt cwd vào thư mục: Windows không cho xóa thư mục đang là cwd.
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: dir, stdio: 'ignore' });
    try {
      await until(() => child.pid !== undefined, 'tiến trình con khởi động');
      await new Promise((r) => setTimeout(r, 500));
      expect(() => rmTmp(dir)).not.toThrow();
      expect(existsSync(dir)).toBe(true);
    } finally {
      child.kill();
      await new Promise((r) => (child.exitCode !== null ? r(null) : child.once('exit', r)));
      rmTmp(dir);
    }
  }, 30_000);
});
