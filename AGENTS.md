# AGENTS.md

@CLAUDE.md

## CÁC QUY TẮC BẮT BUỘC CHO MỌI AI AGENT (NON-NEGOTIABLE RULES)

Mọi AI Agent (Antigravity, Claude Code, Codex, opencode...) khi làm việc trong repository này đều phải tuân thủ nghiêm ngặt các quy tắc sau:

1. **BẮT BUỘC LÀM VIỆC TRONG GIT WORKTREE:**
   - Khi nhận bất kỳ task lập trình, sửa lỗi hoặc thêm tính năng nào từ người dùng, AI agent **BẮT BUỘC** phải tạo và làm việc trong một git worktree riêng biệt (đặt tại thư mục `.worktrees/<tên-nhánh>`).
   - **TUYỆT ĐỐI KHÔNG** sửa đổi mã nguồn trực tiếp trên thư mục làm việc chính của nhánh `main`.

2. **TUÂN THỦ QUY CHUẨN THIẾT KẾ UI/UX TẠI `DESIGN.md`:**
   - Đọc và tuân thủ tuyệt đối [DESIGN.md](DESIGN.md) trước khi sửa hoặc xây dựng bất kỳ thành phần giao diện nào (cả bảng Kanban 2D lẫn Văn phòng 3D).
   - Phong cách chủ đạo: **Warm Cozy Tech** (sáng ấm, viền mảnh, thân thiện với lập trình viên), tuyệt đối không dùng phong cách u tối hay cyber-neon.

3. **QUY ƯỚC COMMIT VÀ BẢN QUYỀN:**
   - Chỉ commit hoặc push khi người dùng yêu cầu.
   - **CẤM** ghi bất kỳ dòng ghi công AI nào (ví dụ `Co-Authored-By: Claude...`, `Generated with...`) trong commit message hoặc PR description.
   - Merge worktree vào `main`: luôn squash thành đúng 1 commit duy nhất cho mỗi task (`git merge --squash`).

4. **GIAO TIẾP VỚI NGƯỜI DÙNG:**
   - Trao đổi hoàn toàn bằng tiếng Việt.
   - Luôn đưa ra phân tích kèm 2–3 lựa chọn cụ thể (ghi rõ phương án khuyến nghị), không đặt câu hỏi mở liên tục.

5. **TÀI LIỆU NGUỒN SỰ THẬT:**
   - Đặc tả hệ thống voragent: [docs/superpowers/specs/2026-11-04-voragent-design.md](docs/superpowers/specs/2026-11-04-voragent-design.md).
   - Quy chuẩn UI/UX: [DESIGN.md](DESIGN.md).
   - Hướng dẫn kỹ thuật và môi trường: [CLAUDE.md](CLAUDE.md).
   - Kế hoạch Giai đoạn 2 (Văn phòng 3D): [docs/superpowers/plans/2026-11-05-voragent-phase2-3d-office.md](docs/superpowers/plans/2026-11-05-voragent-phase2-3d-office.md).
