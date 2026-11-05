import type { Task } from '@voragent/shared';

export type AgentExpression =
  | 'focus'     // Tập trung làm việc
  | 'plead'     // Chờ duyệt / năn nỉ
  | 'sleep'     // Nghỉ ngơi / rảnh
  | 'happy'     // Thành công / xong việc
  | 'sad'       // Lỗi / thất bại
  | 'surprised' // Nhận task mới
  | 'dizzy';    // Quá tải / kẹt

export type AgentAccessory = 'glasses' | 'headphones' | 'cap' | 'nightcap' | 'bow' | 'none';

export interface OfficeAgentData {
  id: string;
  name: string;
  provider: string; // 'claude' | 'codex' | 'antigravity'
  baseColor: string;
  bandColor: string;
  accessory: AgentAccessory;
  deskIndex: number;
  state: 'working' | 'waiting' | 'idle' | 'error' | 'handoff';
  expression: AgentExpression;
  currentTask?: Task;
  actionTag: string;
  isOnline: boolean;
}

export interface ProviderThemeConfig {
  base: string;
  band: string;
  accessory: AgentAccessory;
  name: string;
}

export const DEFAULT_THEME: ProviderThemeConfig = {
  base: '#8B5CF6',       // Tím ấm
  band: '#C4B5FD',       // Vằn tím nhạt
  accessory: 'none',
  name: 'Agent',
};

export const PROVIDER_THEMES: Record<string, ProviderThemeConfig> = {
  claude: {
    base: '#D97757',       // Cam đất Claude
    band: '#F5C4B3',       // Vằn kem cam
    accessory: 'glasses',  // Kính tri thức
    name: 'Claude Code',
  },
  codex: {
    base: '#10A37F',       // Xanh ngọc Codex
    band: '#8CE0C8',       // Vằn xanh nhạt
    accessory: 'headphones',// Tai nghe
    name: 'Codex',
  },
  antigravity: {
    base: '#3B82F6',       // Xanh dương Antigravity
    band: '#93C5FD',       // Vằn xanh sáng
    accessory: 'cap',       // Mũ lưỡi trai
    name: 'Antigravity',
  },
};
