import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  browseTree,
  createProjectItem,
  deleteProjectItem,
  getGitDiff,
  getGitStatus,
  readProjectFile,
  renameProjectItem,
  runGit,
  writeProjectFile,
} from '../src/ide/index.js';

describe('IDE backend services', () => {
  it('performs file operations safely within project root', async () => {
    const root = await fsp.mkdtemp(join(tmpdir(), 'voragent-ide-fs-'));

    try {
      // 1. Create file and folder
      await createProjectItem(root, 'src', 'directory');
      await createProjectItem(root, 'src/main.ts', 'file');
      await writeProjectFile(root, 'src/main.ts', 'console.log("hello");');

      // 2. Read file
      const fileData = await readProjectFile(root, 'src/main.ts');
      expect(fileData.content).toBe('console.log("hello");');
      expect(fileData.isBinary).toBe(false);

      // 3. Browse tree
      const tree = await browseTree(root);
      expect(tree.nodes.length).toBe(1);
      expect(tree.nodes[0]?.name).toBe('src');
      expect(tree.nodes[0]?.type).toBe('directory');

      const subTree = await browseTree(root, 'src');
      expect(subTree.nodes.length).toBe(1);
      expect(subTree.nodes[0]?.name).toBe('main.ts');
      expect(subTree.nodes[0]?.type).toBe('file');

      // 4. Rename
      await renameProjectItem(root, 'src/main.ts', 'src/index.ts');
      const renamed = await readProjectFile(root, 'src/index.ts');
      expect(renamed.content).toBe('console.log("hello");');

      // 5. Delete
      await deleteProjectItem(root, 'src/index.ts');
      await expect(readProjectFile(root, 'src/index.ts')).rejects.toThrow();
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('retrieves git status and diff for git repo', async () => {
    const root = await fsp.mkdtemp(join(tmpdir(), 'voragent-ide-git-'));

    try {
      // Init repo
      await runGit(root, ['init', '-b', 'main']);
      await runGit(root, ['config', 'user.email', 'test@voragent.local']);
      await runGit(root, ['config', 'user.name', 'Voragent Tester']);

      // Status of empty repo
      const emptyStatus = await getGitStatus(root);
      expect(emptyStatus.isGit).toBe(true);
      expect(emptyStatus.clean).toBe(true);

      // Add a file
      await fsp.writeFile(join(root, 'readme.md'), '# Voragent\n');
      const dirtyStatus = await getGitStatus(root);
      expect(dirtyStatus.clean).toBe(false);
      expect(dirtyStatus.files.some((f) => f.path === 'readme.md')).toBe(true);

      // Check diff
      const diff = await getGitDiff(root, 'readme.md');
      expect(diff.diff).toContain('# Voragent');
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
