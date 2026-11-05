import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmTmp } from './helpers.js';

// Cô lập: mọi test (và tiến trình con của test) mà quên tiêm userHome/APPDATA sẽ chỉ thấy thư mục tạm này,
// không bao giờ đọc home hay %APPDATA% thật của người chạy test.
let dir = '';

export default function setup(): () => void {
  dir = mkdtempSync(join(tmpdir(), 'voragent-testenv-'));
  const home = join(dir, 'home');
  const appData = join(dir, 'appdata');
  mkdirSync(home);
  mkdirSync(appData);
  process.env.VORAGENT_USER_HOME = home;
  process.env.APPDATA = appData;
  return () => {
    rmTmp(dir);
  };
}
