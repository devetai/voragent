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
   - Tuân thủ quy tắc tối ưu cuộn chuột (zero excessive scrolling: phân trang, sticky/float actions) và tận dụng tối đa không gian màn hình nhỏ.

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
   - Hướng dẫn chung: [README.md](README.md).
   - Kế hoạch Giai đoạn 2 (Văn phòng 3D): [docs/superpowers/plans/2026-11-05-voragent-phase2-3d-office.md](docs/superpowers/plans/2026-11-05-voragent-phase2-3d-office.md).

6. **CHIẾN LƯỢC CHẠY TEST LINH HOẠT THEO PHẠM VI:**
   - Không phải lúc nào cũng cần chạy toàn bộ bài test (`pnpm test` all tốn 1.5–2 phút vì các bài test Windows git/process).
   - Tùy thuộc vào yêu cầu, độ phức tạp và phạm vi tác động để quyết định chạy test all hay test từng phần:
     - Với thay đổi nhỏ hoặc cục bộ (UI, tài liệu, component lẻ, fix nhỏ): chỉ chạy test của package hoặc tệp liên quan trực tiếp (ví dụ: `pnpm --filter @voragent/web test` hoặc `vitest run <file>`).
     - Với thay đổi cốt lõi (core orchestrator, daemon, scheduler, handoff logic, workspace): mới cần chạy test toàn diện hoặc test liên quan trước khi merge.

7. **ĐỒNG BỘ TÀI LIỆU VÀ `README.MD` KHI CÓ THAY ĐỔI:**
   - Khi có bất kỳ thay đổi nào về tính năng mới, lệnh CLI, cấu trúc gói, UI/UX hoặc quy trình vận hành, AI agent **BẮT BUỘC** phải rà soát và cập nhật lại [`README.md`](README.md) (cùng các tài liệu liên quan) cho thích hợp, đồng bộ và chính xác.
