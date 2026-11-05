// Tiến trình cháu giả: fake-grandchild.mjs <pidfile> <quiet|chatty>
import { writeFileSync } from 'node:fs';

const [pidfile, mode] = process.argv.slice(2);
writeFileSync(pidfile, String(process.pid));
process.stdout.on('error', () => process.exit(0));
if (mode === 'chatty') {
  let n = 0;
  const t = setInterval(() => {
    process.stdout.write(JSON.stringify({ type: 'text', text: 'late' }) + '\n');
    if (++n >= 40) clearInterval(t);
  }, 100);
} else {
  setTimeout(() => {}, 30_000);
}
