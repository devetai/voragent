import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { TaskView } from '../src/TaskView';
import type { Task, VEvent } from '@voragent/shared';

describe('TaskView Component Rendering & Semantic UX', () => {
  const mockTask: Task = {
    id: 'test-task-1',
    seq: 12,
    title: 'Làm lại giao diện theo dõi biến động thị trường',
    repoPath: 'd:\\Projects\\voragent',
    workspacePath: 'd:\\Projects\\voragent\\.worktrees\\task-12',
    branch: 'voragent/task-12',
    status: 'awaiting_user',
    currentProvider: 'antigravity',
    model: 'gemini-2.5-pro',
    createdAt: Date.now() - 60000,
    updatedAt: Date.now(),
    role: 'Kiến trúc & Lõi',
  };

  const mockEvents: VEvent[] = [
    {
      type: 'AGENT_OUTPUT',
      taskId: 'test-task-1',
      timestamp: Date.now() - 30000,
      data: { text: 'Chào bạn, tôi đã chuẩn bị xong kế hoạch triển khai.' },
    },
  ];

  it('hiển thị breadcrumb dự án và số thứ tự task rõ ràng', () => {
    const html = renderToString(
      React.createElement(TaskView, {
        task: mockTask,
        events: mockEvents,
        projectName: 'voragent monorepo',
        onLoaded: () => {},
        onBack: () => {},
      })
    );

    expect(html).toContain('task-breadcrumb');
    expect(html).toContain('voragent monorepo');
    expect(html).toContain('Task #<!-- -->12');
  });

  it('nút Hoàn tất sử dụng class success (màu xanh) theo chuẩn ngữ nghĩa', () => {
    const html = renderToString(
      React.createElement(TaskView, {
        task: mockTask,
        events: mockEvents,
        projectName: 'voragent',
        onLoaded: () => {},
        onBack: () => {},
      })
    );

    expect(html).toContain('class="success"');
    expect(html).toContain('Hoàn tất');
  });

  it('nút gửi phản hồi sử dụng class chat-btn-send với phím tắt Ctrl+Enter', () => {
    const html = renderToString(
      React.createElement(TaskView, {
        task: mockTask,
        events: mockEvents,
        projectName: 'voragent',
        onLoaded: () => {},
        onBack: () => {},
      })
    );

    expect(html).toContain('chat-btn-send');
    expect(html).toContain('Ctrl+↵');
  });

  it('hiển thị bubble trạng thái Agent đang xử lý khi task ở trạng thái running', () => {
    const runningTask: Task = {
      ...mockTask,
      status: 'running',
    };

    const html = renderToString(
      React.createElement(TaskView, {
        task: runningTask,
        events: mockEvents,
        projectName: 'voragent',
        onLoaded: () => {},
        onBack: () => {},
      })
    );

    expect(html).toContain('agent-thinking-bubble');
    expect(html).toContain('agent-typing-dots');
    expect(html).toContain('Đang suy nghĩ &amp; thực thi công việc…');
    expect(html).toContain('Antigravity');
  });
});
