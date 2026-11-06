import { promises as fsp, statSync } from 'node:fs';
import { extname, join, normalize, relative, resolve } from 'node:path';
import type { FileContent, FileNode } from '@voragent/shared';

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.worktrees',
  'dist',
  'build',
  '.cache',
  '.turbo',
  '.next',
  '.nuxt',
]);

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svgz',
  '.mp4', '.webm', '.mp3', '.wav', '.ogg',
  '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.obj', '.o',
  '.ttf', '.woff', '.woff2', '.eot',
]);

export function ensureInside(rootPath: string, targetPath: string): string {
  const normRoot = normalize(resolve(rootPath));
  const normTarget = normalize(resolve(normRoot, targetPath));
  if (!normTarget.startsWith(normRoot)) {
    throw new Error('Truy cập tệp tin bị từ chối: Nằm ngoài thư mục dự án');
  }
  return normTarget;
}

export async function browseTree(
  rootPath: string,
  subDir = '',
): Promise<{ root: string; subDir: string; nodes: FileNode[] }> {
  const targetDir = ensureInside(rootPath, subDir);
  const entries = await fsp.readdir(targetDir, { withFileTypes: true });

  const nodes: FileNode[] = [];

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = join(targetDir, entry.name);
    const relPath = relative(rootPath, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      let hasChildren = false;
      try {
        const subEntries = await fsp.readdir(fullPath);
        hasChildren = subEntries.some((e) => !IGNORED_DIRS.has(e));
      } catch {
        hasChildren = false;
      }

      nodes.push({
        name: entry.name,
        path: relPath,
        type: 'directory',
        hasChildren,
      });
    } else if (entry.isFile()) {
      let size = 0;
      let modifiedTime = 0;
      try {
        const st = await fsp.stat(fullPath);
        size = st.size;
        modifiedTime = Math.round(st.mtimeMs);
      } catch {
        // ignore
      }

      nodes.push({
        name: entry.name,
        path: relPath,
        type: 'file',
        size,
        modifiedTime,
      });
    }
  }

  // Sắp xếp: Thư mục trước, tệp sau, theo bảng chữ cái
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });

  return { root: rootPath, subDir, nodes };
}

export async function readProjectFile(
  rootPath: string,
  relPath: string,
): Promise<FileContent> {
  const fullPath = ensureInside(rootPath, relPath);
  const st = await fsp.stat(fullPath);
  if (!st.isFile()) {
    throw new Error(`Đường dẫn không phải là tệp tin: ${relPath}`);
  }

  const ext = extname(fullPath).toLowerCase();
  if (BINARY_EXTS.has(ext)) {
    return {
      path: relPath.replace(/\\/g, '/'),
      content: '',
      isBinary: true,
      size: st.size,
    };
  }

  // Kiểm tra 512 bytes đầu xem có null byte không
  const fd = await fsp.open(fullPath, 'r');
  try {
    const buf = Buffer.alloc(Math.min(512, st.size));
    if (buf.length > 0) {
      await fd.read(buf, 0, buf.length, 0);
      if (buf.includes(0)) {
        return {
          path: relPath.replace(/\\/g, '/'),
          content: '',
          isBinary: true,
          size: st.size,
        };
      }
    }
  } finally {
    await fd.close();
  }

  const content = await fsp.readFile(fullPath, 'utf8');
  return {
    path: relPath.replace(/\\/g, '/'),
    content,
    isBinary: false,
    size: st.size,
  };
}

export async function writeProjectFile(
  rootPath: string,
  relPath: string,
  content: string,
): Promise<{ ok: boolean; path: string; size: number }> {
  const fullPath = ensureInside(rootPath, relPath);
  await fsp.mkdir(resolve(fullPath, '..'), { recursive: true });
  await fsp.writeFile(fullPath, content, 'utf8');
  const st = await fsp.stat(fullPath);
  return { ok: true, path: relPath.replace(/\\/g, '/'), size: st.size };
}

export async function createProjectItem(
  rootPath: string,
  relPath: string,
  type: 'file' | 'directory',
): Promise<{ ok: boolean; path: string }> {
  const fullPath = ensureInside(rootPath, relPath);
  if (type === 'directory') {
    await fsp.mkdir(fullPath, { recursive: true });
  } else {
    await fsp.mkdir(resolve(fullPath, '..'), { recursive: true });
    await fsp.writeFile(fullPath, '', 'utf8');
  }
  return { ok: true, path: relPath.replace(/\\/g, '/') };
}

export async function renameProjectItem(
  rootPath: string,
  oldRelPath: string,
  newRelPath: string,
): Promise<{ ok: boolean; oldPath: string; newPath: string }> {
  const oldFull = ensureInside(rootPath, oldRelPath);
  const newFull = ensureInside(rootPath, newRelPath);
  await fsp.mkdir(resolve(newFull, '..'), { recursive: true });
  await fsp.rename(oldFull, newFull);
  return {
    ok: true,
    oldPath: oldRelPath.replace(/\\/g, '/'),
    newPath: newRelPath.replace(/\\/g, '/'),
  };
}

export async function deleteProjectItem(
  rootPath: string,
  relPath: string,
): Promise<{ ok: boolean; path: string }> {
  const fullPath = ensureInside(rootPath, relPath);
  await fsp.rm(fullPath, { recursive: true, force: true });
  return { ok: true, path: relPath.replace(/\\/g, '/') };
}
