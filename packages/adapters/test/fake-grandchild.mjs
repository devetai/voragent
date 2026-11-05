// Tiến trình cháu giả: fake-grandchild.mjs <pidfile> <quiet|chatty>
import { writeFileSync } from 'node:fs';

const [pidfile, mode] = process.argv.slice(2);
writeFileSync(pidfile, String(process.pid));
if (mode === 'chatty') {
  // Cháu mồ côi: BỎ QUA EPIPE/lỗi stdout và sống tới khi bị giết hoặc tự hết giờ (30 s),
  // để test xác định được "cháu còn sống" thay vì chạy đua với việc nó tự thoát.
  process.stdout.on('error', () => {});
  let n = 0;
  setInterval(() => {
    try {
      process.stdout.write(JSON.stringify({ type: 'text', text: 'late' }) + '\n', () => {});
    } catch {
      // pipe đã bị hủy
    }
    if (++n >= 300) process.exit(0);
  }, 100);
} else {
  process.stdout.on('error', () => process.exit(0));
  setTimeout(() => {}, 30_000);
}
