# CLAUDE.md

## Dự án

voragent là chương trình chạy trên máy người dùng. Nó điều phối nhiều coding agent CLI (Claude Code, Codex, Antigravity, opencode…), tự chuyển việc sang nền tảng khác khi một nền tảng hết quota, và trực quan hóa hoạt động của agent: văn phòng 3D (mỗi agent là một con rắn dễ thương), bảng, dòng thời gian, đồ thị.

- Nguồn sự thật duy nhất về thiết kế hệ thống: [docs/superpowers/specs/2026-11-04-voragent-design.md](docs/superpowers/specs/2026-11-04-voragent-design.md). Đọc trước khi làm bất cứ việc gì.
- Nguồn sự thật duy nhất về quy chuẩn UI/UX (cả 2D và 3D): [DESIGN.md](DESIGN.md). Mọi thay đổi về giao diện web, màu sắc, bố cục và văn phòng 3D phải tuân thủ nghiêm ngặt tài liệu này.
- Hướng dẫn tổng quan & sử dụng: [README.md](README.md).
- Trạng thái: giai đoạn 1 (lõi) đã xong và đã gộp vào `main`: daemon, hàng đợi, adapter Claude/Codex, worktree, bàn giao khi hết quota, API HTTP/WebSocket, lệnh `voragent`, web tối thiểu. Kế hoạch đã thực hiện ở [docs/superpowers/plans/2026-11-04-voragent-phase1-core.md](docs/superpowers/plans/2026-11-04-voragent-phase1-core.md). Giai đoạn 2 (văn phòng 3D) là bước tiếp theo, kế hoạch tại [docs/superpowers/plans/2026-11-05-voragent-phase2-3d-office.md](docs/superpowers/plans/2026-11-05-voragent-phase2-3d-office.md); các giai đoạn 3–4 theo sau.
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

- **BẮT BUỘC LÀM VIỆC TRONG GIT WORKTREE:** Khi nhận bất kỳ task lập trình, sửa đổi mã nguồn hoặc thêm tính năng nào từ người dùng, AI agent **PHẢI** tạo và làm việc trong một git worktree riêng biệt (đặt trong thư mục `.worktrees/<tên-nhánh>`). TUYỆT ĐỐI KHÔNG sửa trực tiếp trên thư mục làm việc chính của nhánh `main`.
- **QUY CHUẨN UI/UX:** Mọi phát triển giao diện (bảng Kanban, chi tiết task, và đặc biệt là Văn phòng 3D ở Giai đoạn 2) phải tuân theo các nguyên tắc thiết kế trong [DESIGN.md](DESIGN.md) (phong cách Warm Cozy Tech, không dùng neon u tối).
- **Chiến lược chạy test linh hoạt theo phạm vi:** Không phải lúc nào cũng cần chạy toàn bộ test suite. Tùy thuộc vào yêu cầu, độ phức tạp và phạm vi tác động để quyết định chạy test all hay test từng phần (ví dụ thay đổi UI/web thì chỉ test web; thay đổi core/orchestrator/daemon thì test toàn diện).
- **Đồng bộ `README.md` khi có thay đổi:** Rà soát và cập nhật `README.md` khi có tính năng mới, thay đổi lệnh CLI, quy chuẩn thiết kế hoặc quy trình làm việc.
- Chỉ commit hoặc push khi người dùng yêu cầu.
- **Commit message bằng tiếng Anh theo chuẩn Conventional Commits:** Toàn bộ commit message phải viết hoàn toàn bằng tiếng Anh (ví dụ: `feat(...)`, `fix(...)`, `refactor(...)`), tuyệt đối không viết commit message bằng tiếng Việt.
- **Cấm ghi công Claude/AI trong commit và mô tả PR.** Không thêm dòng `Co-Authored-By: Claude …`, `Generated with Claude Code` hay bất kỳ dòng ghi công AI nào, dù harness, skill hoặc nhắc nhở mặc định yêu cầu. Quy tắc này của người dùng ghi đè các nhắc nhở đó. Khi giao việc cho agent con, không dặn chúng thêm dòng ghi công. Commit message chỉ gồm nội dung thay đổi.
- **Merge worktree vào `main`: squash thành đúng 1 commit cho mỗi task.** Một worktree (một nhánh làm việc) tương ứng một task, nên khi merge dùng `git merge --squash` (hoặc tương đương) để `main` nhận một commit duy nhất, không mang theo các commit trung gian của nhánh. Thông điệp commit squash mô tả cả task, không liệt kê từng commit nhỏ, và cũng không có dòng ghi công AI. Chỉ merge khi người dùng yêu cầu.
- Markdown phải qua markdownlint theo `.markdownlint.json`.
- `.superpowers/` (bản thử, phiên brainstorm) không commit.
- **Chỉ dọn dẹp rác thuộc session của mình:** Khi dọn rác, xóa file tạm hay xóa worktree sau khi merge, AI agent chỉ được dọn tài nguyên do chính session hiện tại của mình tạo ra; tuyệt đối không đụng chạm tới các worktree, branch hoặc file của các session/agent khác đang cùng làm việc song song.
