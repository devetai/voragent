/** Đổi URI `file:` sang đường dẫn cục bộ; URI khác hoặc chuỗi rác trả null. */
export function fileUriToPath(uri: string, platform: NodeJS.Platform = process.platform): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== 'file:') return null;
  let p: string;
  try {
    p = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (!p) return null;
  let host = url.hostname;
  try {
    host = decodeURIComponent(host);
  } catch {
    return null;
  }
  if (host && host.toLowerCase() !== 'localhost') {
    return platform === 'win32' ? '\\\\' + host + p.replace(/\//g, '\\') : null;
  }
  if (platform === 'win32') {
    return p.replace(/^\/(?=[a-zA-Z]:)/, '').replace(/\//g, '\\');
  }
  return p;
}
