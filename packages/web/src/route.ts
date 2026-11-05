/**
 * Quản lý định tuyến URL dạng Path + Query cho voragent SPA.
 * Thay thế Hash routing cũ bằng Semantic HTML5 History API:
 *   /              hoặc /projects         -> Trang chủ danh sách dự án
 *   /board         hoặc /board?project=.. -> Bảng task Kanban (toàn bộ hoặc theo dự án)
 *   /office        hoặc /office?project=. -> Không gian Văn phòng 3D
 *   /graph         hoặc /graph?project=.. -> Đồ thị quan hệ
 *   /new           hoặc /new?project=..   -> Tạo task mới
 *   /task/<id>                            -> Chi tiết task và phiên làm việc
 *
 * Query parameters:
 *   project: Đường dẫn thư mục dự án cần lọc (ví dụ: ?project=D%3A%2FProjects%2Fvoragent)
 *   key: Token xác thực daemon (tự động bảo lưu khi chuyển trang để reload/copy link không mất phiên)
 */

import { useCallback, useEffect, useState } from 'react';

export type AppView = 'projects' | 'board' | 'office' | 'graph' | 'new' | 'task';
export type TabId = 'projects' | 'board' | 'office' | 'graph';

export interface AppRoute {
  view: AppView;
  activeTab: TabId;
  taskId: string | null;
  projectPath: string | null;
  pathname: string;
  search: string;
  key: string | null;
}

export function decodeUriSafely(val: string): string | null {
  try {
    return decodeURIComponent(val);
  } catch {
    return null;
  }
}

/** Phân tích location hiện tại thành AppRoute */
export function parseLocation(loc: { pathname: string; search: string; hash?: string }): AppRoute {
  const pathname = loc.pathname.replace(/\/+$/, '') || '/';
  const searchParams = new URLSearchParams(loc.search || '');
  const key = searchParams.get('key');
  let projectPath: string | null = null;
  const rawProject = searchParams.get('project');
  if (rawProject !== null) {
    projectPath = decodeUriSafely(rawProject);
  }

  const hash = loc.hash || '';
  let taskId: string | null = null;

  // 1. Kiểm tra hash cũ để hỗ trợ migration tự động
  if (hash.startsWith('#/task/')) {
    taskId = decodeUriSafely(hash.slice('#/task/'.length));
  } else if (hash.startsWith('#/project/')) {
    projectPath = decodeUriSafely(hash.slice('#/project/'.length));
  }

  // 2. Kiểm tra pathname theo chuẩn /task/:id hoặc /tasks/:id
  if (!taskId) {
    const taskMatch = pathname.match(/^\/(?:task|tasks)\/(.+)$/);
    if (taskMatch?.[1]) {
      taskId = decodeUriSafely(taskMatch[1]);
    }
  }

  // 3. Quyết định view
  let view: AppView = 'projects';
  if (taskId !== null) {
    view = 'task';
  } else if (pathname === '/new' || hash === '#/new') {
    view = 'new';
  } else if (pathname === '/office' || hash === '#/office') {
    view = 'office';
  } else if (pathname === '/graph' || hash === '#/graph') {
    view = 'graph';
  } else if (pathname === '/board' || hash === '#/board' || projectPath !== null) {
    view = 'board';
  } else {
    view = 'projects';
  }

  // 4. Quyết định Tab active trên Header
  let activeTab: TabId = 'projects';
  if (view === 'office') activeTab = 'office';
  else if (view === 'graph') activeTab = 'graph';
  else if (view === 'board' || projectPath !== null) activeTab = 'board';
  else activeTab = 'projects';

  return {
    view,
    activeTab,
    taskId,
    projectPath,
    pathname,
    search: loc.search || '',
    key,
  };
}

/**
 * Xây dựng URL chuẩn từ target (chuỗi hoặc object), tự động bảo lưu query key nếu có.
 */
export function buildUrl(
  target: string | { view: AppView; taskId?: string | null; projectPath?: string | null },
  currentSearch: string = (typeof window !== 'undefined' ? window.location.search : '')
): string {
  const currentParams = new URLSearchParams(currentSearch);
  const currentKey = currentParams.get('key');

  if (typeof target === 'string') {
    // Hỗ trợ target dạng legacy hash nếu có
    let normalized = target;
    if (normalized.startsWith('#/task/')) {
      normalized = `/task/${normalized.slice('#/task/'.length)}`;
    } else if (normalized.startsWith('#/project/')) {
      normalized = `/board?project=${normalized.slice('#/project/'.length)}`;
    } else if (normalized.startsWith('#/')) {
      normalized = `/${normalized.slice(2)}`;
    } else if (normalized === '#' || normalized === '') {
      normalized = '/';
    }

    const [pathPart, queryPart] = normalized.split('?');
    const params = new URLSearchParams(queryPart || '');
    if (currentKey && !params.has('key')) {
      params.set('key', currentKey);
    }
    const q = params.toString();
    return (pathPart || '/') + (q ? `?${q}` : '');
  }

  // Nếu target là object
  const params = new URLSearchParams();
  if (target.projectPath) {
    params.set('project', target.projectPath);
  }
  if (currentKey) {
    params.set('key', currentKey);
  }

  let basePath = '/';
  switch (target.view) {
    case 'projects':
      basePath = '/';
      break;
    case 'board':
      basePath = '/board';
      break;
    case 'office':
      basePath = '/office';
      break;
    case 'graph':
      basePath = '/graph';
      break;
    case 'new':
      basePath = '/new';
      break;
    case 'task':
      basePath = `/task/${encodeURIComponent(target.taskId || '')}`;
      break;
  }

  const q = params.toString();
  return basePath + (q ? `?${q}` : '');
}

/** Hook định tuyến URL SPA với HTML5 History API */
export function useAppRoute(): [
  AppRoute,
  (target: string | { view: AppView; taskId?: string | null; projectPath?: string | null }, opts?: { replace?: boolean }) => void
] {
  const [route, setRoute] = useState<AppRoute>(() =>
    parseLocation({
      pathname: typeof window !== 'undefined' ? window.location.pathname : '/',
      search: typeof window !== 'undefined' ? window.location.search : '',
      hash: typeof window !== 'undefined' ? window.location.hash : '',
    })
  );

  const sync = useCallback(() => {
    const cur = parseLocation({
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
    });
    setRoute(cur);
  }, []);

  // Lắng nghe nút Back/Forward của trình duyệt
  useEffect(() => {
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [sync]);

  // Migration hash cũ sang path + query khi khởi động (nếu có)
  useEffect(() => {
    if (window.location.hash && window.location.hash !== '#' && window.location.hash !== '#/') {
      const parsed = parseLocation({
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
      });
      const canonical = buildUrl({
        view: parsed.view,
        taskId: parsed.taskId,
        projectPath: parsed.projectPath,
      }, window.location.search);
      // Thay thế URL sạch không còn hash
      window.history.replaceState(null, '', canonical);
      sync();
    }
  }, [sync]);

  const nav = useCallback((
    target: string | { view: AppView; taskId?: string | null; projectPath?: string | null },
    opts?: { replace?: boolean }
  ) => {
    const nextUrl = buildUrl(target, window.location.search);
    if (opts?.replace) {
      window.history.replaceState(null, '', nextUrl);
    } else {
      window.history.pushState(null, '', nextUrl);
    }
    sync();
  }, [sync]);

  return [route, nav];
}
