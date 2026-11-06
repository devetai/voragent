import type { Task } from '@voragent/shared';
import type { AgentSignal } from './liveSignal';

export type AgentExpression =
  | 'focus'     // Tập trung làm việc
  | 'plead'     // Chờ duyệt / năn nỉ
  | 'sleep'     // Nghỉ ngơi / rảnh
  | 'happy'     // Thành công / xong việc
  | 'sad'       // Lỗi / thất bại
  | 'surprised' // Nhận task mới
  | 'dizzy';    // Quá tải / kẹt

export type AgentAccessory = 'glasses' | 'headphones' | 'cap' | 'crown' | 'nightcap' | 'bow' | 'none';

export interface OfficeAgentData {
  id: string;
  name: string;
  provider: string; // 'manager' | 'claude' | 'codex' | 'antigravity'
  role: string;
  isManager?: boolean;
  baseColor: string;
  bandColor: string;
  accessory: AgentAccessory;
  deskIndex: number;
  state: 'working' | 'waiting' | 'idle' | 'error' | 'handoff';
  expression: AgentExpression;
  currentTask?: Task;
  actionTag: string;
  isOnline: boolean;
  /** Tín hiệu sống suy ra từ dòng sự kiện, dùng cho chip 3D và thẻ hover. */
  signal: AgentSignal;
  /** Mô hình đang dùng (nếu có) để hiển thị trong thẻ hover. */
  modelText?: string;
  /** Tình trạng hạn mức ngắn gọn, ví dụ "Quota 42%" hoặc "Nghỉ đến 14:30". */
  quotaText?: string;
  /** Phần trăm hạn mức đã dùng (0..1) để vẽ thanh thật trên màn hình phụ. */
  quotaPercent?: number;
}

export interface ProviderThemeConfig {
  base: string;
  band: string;
  accessory: AgentAccessory;
  name: string;
  defaultRole?: string;
}

export const DEFAULT_THEME: ProviderThemeConfig = {
  base: '#8B5CF6',       // Tím ấm
  band: '#C4B5FD',       // Vằn tím nhạt
  accessory: 'none',
  name: 'Agent',
  defaultRole: 'Nhân viên thực thi',
};

export const PROVIDER_THEMES: Record<string, ProviderThemeConfig> = {
  manager: {
    base: '#8B5CF6',       // Tím hoàng gia ấm
    band: '#DDD6FE',       // Vằn tím sáng
    accessory: 'crown',    // Vương miện / Mũ Trưởng phòng
    name: 'Trưởng Phòng (Lead)',
    defaultRole: 'Điều phối & Kế hoạch',
  },
  claude: {
    base: '#D97757',       // Cam đất Claude
    band: '#F5C4B3',       // Vằn kem cam
    accessory: 'glasses',  // Kính tri thức
    name: 'Claude Code',
    defaultRole: 'Kiến trúc & Logic lõi',
  },
  codex: {
    base: '#10A37F',       // Xanh ngọc Codex
    band: '#8CE0C8',       // Vằn xanh nhạt
    accessory: 'headphones',// Tai nghe
    name: 'Codex',
    defaultRole: 'Kiểm thử & Review',
  },
  antigravity: {
    base: '#3B82F6',       // Xanh dương Antigravity
    band: '#93C5FD',       // Vằn xanh sáng
    accessory: 'cap',       // Mũ lưỡi trai
    name: 'Antigravity',
    defaultRole: 'Giao diện & Tương tác',
  },
  opencode: {
    base: '#059669',       // Xanh ngọc đậm OpenCode
    band: '#6EE7B7',       // Vằn xanh ngọc nhạt
    accessory: 'bow',      // Nơ cổ công nghệ
    name: 'OpenCode',
    defaultRole: 'Đa mô hình & Thực thi',
  },
};
