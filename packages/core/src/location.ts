import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export const BOOTSTRAP_FILE_NAME = '.voragentrc';

export function getBootstrapFilePath(home: string = homedir()): string {
  return join(home, BOOTSTRAP_FILE_NAME);
}

export function getDefaultDataDir(home: string = homedir()): string {
  return join(home, '.voragent');
}

export interface BootstrapConfig {
  dataDir?: string;
}

export function readBootstrapDataDir(home: string = homedir()): string | null {
  const file = getBootstrapFilePath(home);
  if (!existsSync(file)) return null;
  try {
    const content = readFileSync(file, 'utf8').trim();
    if (!content) return null;
    const parsed = JSON.parse(content) as BootstrapConfig;
    if (typeof parsed.dataDir === 'string' && parsed.dataDir.trim() !== '') {
      return resolve(parsed.dataDir.trim());
    }
  } catch {
    // File không đọc được hoặc JSON sai cú pháp: bỏ qua, dùng mặc định
  }
  return null;
}

export function writeBootstrapDataDir(targetDir: string, home: string = homedir()): void {
  const file = getBootstrapFilePath(home);
  const data: BootstrapConfig = {
    dataDir: resolve(targetDir),
  };
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function resolveDataDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  if (env.VORAGENT_HOME && env.VORAGENT_HOME.trim() !== '') {
    return resolve(env.VORAGENT_HOME.trim());
  }
  const fromBootstrap = readBootstrapDataDir(home);
  if (fromBootstrap && isAbsolute(fromBootstrap)) {
    return fromBootstrap;
  }
  return getDefaultDataDir(home);
}

export function getDataDirInfo(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): {
  dataDir: string;
  defaultDataDir: string;
  source: 'env' | 'bootstrap' | 'default';
  isCustom: boolean;
} {
  const defaultDir = getDefaultDataDir(home);
  if (env.VORAGENT_HOME && env.VORAGENT_HOME.trim() !== '') {
    const dir = resolve(env.VORAGENT_HOME.trim());
    return {
      dataDir: dir,
      defaultDataDir: defaultDir,
      source: 'env',
      isCustom: dir !== defaultDir,
    };
  }
  const fromBootstrap = readBootstrapDataDir(home);
  if (fromBootstrap && isAbsolute(fromBootstrap)) {
    return {
      dataDir: fromBootstrap,
      defaultDataDir: defaultDir,
      source: 'bootstrap',
      isCustom: fromBootstrap !== defaultDir,
    };
  }
  return {
    dataDir: defaultDir,
    defaultDataDir: defaultDir,
    source: 'default',
    isCustom: false,
  };
}
