import { rmSync } from 'node:fs';

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
