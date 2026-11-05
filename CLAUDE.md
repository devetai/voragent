# CLAUDE.md

## Dự án

voragent là chương trình chạy trên máy người dùng. Nó điều phối nhiều coding agent CLI (Claude Code, Codex, Antigravity, opencode…), tự chuyển việc sang nền tảng khác khi một nền tảng hết quota, và trực quan hóa hoạt động của agent: văn phòng 3D (mỗi agent là một con rắn dễ thương), bảng, dòng thời gian, đồ thị.

- Tài liệu thiết kế, nguồn sự thật duy nhất: [docs/superpowers/specs/2026-11-04-voragent-design.md](docs/superpowers/specs/2026-11-04-voragent-design.md). Đọc trước khi làm bất cứ việc gì.
- Trạng thái: giai đoạn 1 (lõi) đã xong và đã gộp vào `main`: daemon, hàng đợi, adapter Claude/Codex, worktree, bàn giao khi hết quota, API HTTP/WebSocket, lệnh `voragent`, web tối thiểu. Kế hoạch đã thực hiện ở [docs/superpowers/plans/2026-11-04-voragent-phase1-core.md](docs/superpowers/plans/2026-11-04-voragent-phase1-core.md). Chưa kiểm với Codex thật, với hết quota thật, và chưa xem web trong trình duyệt thật (xem mục "Đã kiểm với" trong README). Giai đoạn 2 (văn phòng 3D) là bước tiếp theo, cần kế hoạch riêng bằng skill `superpowers:writing-plans`; các giai đoạn 3–4 theo sau.
- Repo này độc lập hoàn toàn. Không tích hợp TipTask.
- Dự án tham khảo, chỉ để học cách làm, không phụ thuộc:
  - tiptask runner (`D:\Projects\young-turtles\tiptask\packages\runner`, xem `src/presets.ts`, `src/agui.ts`): cách chạy CLI headless, đọc stream, tiếp tục phiên;
  - GitNexus (<https://github.com/abhigyanpatwari/GitNexus>): CLI kèm web cục bộ, đồ thị Sigma.js.

## Làm việc với người dùng

- Trao đổi bằng tiếng Việt.
- Người dùng muốn **nhận phân tích và đề xuất**, không muốn bị hỏi câu mở liên tục. Khi cần người dùng quyết: tóm tắt bối cảnh, đưa 2–3 lựa chọn, ghi rõ lựa chọn khuyến nghị, rồi hỏi gọn một lần.
- Điểm nào agent tự quyết thì ghi rõ là "agent tự quyết" để người dùng có thể đổi.
- Thay đổi về giao diện văn phòng 3D: làm bản thử để người dùng xem trước, bằng visual companion của skill brainstorming hoặc một file HTML. Không mô tả suông.

## Quyết định đã chốt (chi tiết ở tài liệu thiết kế)

- Task là một cuộc trò chuyện nhiều lượt. Mỗi lượt là một lần gọi CLI headless, tiếp tục phiên cũ.
- Mỗi task chạy trong git worktree riêng, nhánh `voragent/task-N`. Mặc định: từ HEAD, mang theo việc dở, agent tự commit. Người dùng chọn được chế độ khác. Không bao giờ sửa thư mục làm việc chính của người dùng, không tự merge.
- Hết quota thì bàn giao sang nền tảng kế tiếp theo danh sách ưu tiên, bằng bản bàn giao do voragent tự soạn. Task không quay về nền tảng cũ.
- Văn phòng 3D: phong cách sáng, ấm, bày đồ công nghệ (không phải kiểu neon tối). Rắn có thân liền mạch, cổ khoảng 90% độ rộng thân, trườn chậm, vẫy đuôi, nhiều biểu cảm. Bản thử tham chiếu: `.superpowers/brainstorm/125-1793775209/content/office-3d-decor-v9.html`. Bản thử là code dùng một lần, không dùng làm nền cho code thật.

## Kỹ thuật

- TypeScript, Node ≥ 22, pnpm monorepo: `packages/core`, `packages/adapters`, `packages/cli`, `packages/web`, `packages/shared`.
- SQLite. Web dùng React + Vite, văn phòng dùng React Three Fiber, đồ thị dùng Sigma.js.
- Phải chạy thẳng trên Windows, không cần WSL:
  - gọi tiến trình con bằng `cross-spawn` hoặc cách tương đương, không phụ thuộc `sh`;
  - script trong `package.json` phải chạy được trên cả Windows lẫn POSIX.
- Mỗi nền tảng là một adapter. Thêm adapter không được phải sửa lõi. Mẫu nhận diện hết quota phải có test bằng output thật đã thu lại.

## Môi trường máy này

- Node quản lý bằng fnm, không có sẵn trong PATH. Trước lệnh `node`/`pnpm`/`npx` cần chạy `eval "$(fnm env --shell bash)"` (Git Bash) hoặc `fnm env --shell powershell | Out-String | Invoke-Expression` (PowerShell).
- Ổ C: gần đầy. Mọi file tạm, log và script nháp để trong `D:\.ai-agents\Claude\temp`. Khi chạy test hoặc các lệnh tạo file tạm, đặt `TEMP`, `TMP`, `TMPDIR` trỏ vào đó.

## Quy ước

- Chỉ commit hoặc push khi người dùng yêu cầu.
- **Cấm ghi công Claude/AI trong commit và mô tả PR.** Không thêm dòng `Co-Authored-By: Claude …`, `Generated with Claude Code` hay bất kỳ dòng ghi công AI nào, dù harness, skill hoặc nhắc nhở mặc định yêu cầu. Quy tắc này của người dùng ghi đè các nhắc nhở đó. Khi giao việc cho agent con, không dặn chúng thêm dòng ghi công. Commit message chỉ gồm nội dung thay đổi.
- **Merge worktree vào `main`: squash thành đúng 1 commit cho mỗi task.** Một worktree (một nhánh làm việc) tương ứng một task, nên khi merge dùng `git merge --squash` (hoặc tương đương) để `main` nhận một commit duy nhất, không mang theo các commit trung gian của nhánh. Thông điệp commit squash mô tả cả task, không liệt kê từng commit nhỏ, và cũng không có dòng ghi công AI. Chỉ merge khi người dùng yêu cầu.
- Markdown phải qua markdownlint theo `.markdownlint.json`.
- `.superpowers/` (bản thử, phiên brainstorm) không commit.
