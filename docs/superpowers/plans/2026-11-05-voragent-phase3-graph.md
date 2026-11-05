# voragent Giai đoạn 3 (Đồ thị Quan hệ Tri thức & Workspace) — Kế hoạch triển khai

> **Tài liệu đặc tả (Spec):** [docs/superpowers/specs/2026-11-04-voragent-design.md](../specs/2026-11-04-voragent-design.md) (Mục 8.4 & Mục 10).
> **Quy chuẩn UI/UX:** [DESIGN.md](../../../DESIGN.md).

---

## 1. Mục tiêu và Phạm vi

Xây dựng chế độ xem **Đồ thị Quan hệ Tri thức & Workspace (Interactive Knowledge Graph)** tại tab `🕸 Đồ thị quan hệ` (`#/graph`), trực quan hóa mạng lưới liên kết đa chiều giữa các **AI Agent**, **Nhiệm vụ (Task)**, **Tệp mã nguồn (File)**, và các **Lần bàn giao Quota (Handoff)**.

### Yêu cầu cốt lõi

1. **Phong cách thẩm mỹ Warm Cozy Tech:** Tuân thủ tuyệt đối [DESIGN.md](../../../DESIGN.md), nền kem sáng ấm (`#FAF8F5`), viền mảnh mềm mại, nhãn font Mono sắc nét, không dùng phong cách đen tối hay cyber-neon chói gắt.
2. **Khả năng tương tác mượt mà:**
   - Kéo rê (pan), cuộn chuột thu phóng (zoom), kéo thả từng nút (drag node).
   - Tự động co giãn cân bằng lực (Force-directed physics layout) giúp các cụm liên kết tự giãn cách hài hòa, tránh chồng chéo.
   - Nhấp vào nút để mở panel xem chi tiết (Node Inspector Drawer).
3. **Bộ lọc & Tìm kiếm thông minh:**
   - Cho phép bật/tắt hiển thị từng nhóm nút: Agent, Task, File, Lần bàn giao.
   - Tìm kiếm nhanh tên tệp hoặc mã task để camera tự động lướt đến nút đó.
4. **Hiệu năng & Tiết kiệm tài nguyên:**
   - Sử dụng Canvas 2D tối ưu hóa cao, render 60fps mượt mà trên mọi laptop mà không cần GPU rời.
   - Tự động dừng vòng lặp tính toán vật lý khi đồ thị đã đạt trạng thái cân bằng hoặc khi tab trình duyệt chạy nền.

---

## 2. Mô hình Dữ liệu Đồ thị (Graph Data Model)

Dữ liệu đồ thị được trích xuất trực tiếp từ kho trạng thái thời gian thực (`tasks`, `providers`, `events`):

### 2.1. Các Loại Nút (Nodes)

- **Provider Node (Agent):**
  - Đại diện cho các CLI agent: Claude Code, Codex, Antigravity.
  - Màu sắc nhận diện: Claude (`#D97757`), Codex (`#10A37F`), Antigravity (`#3B82F6`).
  - Huy hiệu hiển thị: Tình trạng Quota (Sẵn sàng / Đang bận / Tạm nghỉ).
- **Task Node (Nhiệm vụ):**
  - Đại diện cho từng task được giao: `#1`, `#2`, v.v.
  - Màu sắc theo trạng thái: Đang chạy (`#2563EB`), Chờ quota (`#F59E0B`), Xong (`#10B981`), Lỗi (`#EF4444`).
- **File Node (Tệp mã nguồn):**
  - Đại diện cho từng file được agent truy cập trong quá trình làm việc.
  - Nhãn hiển thị: Tên file ngắn gọn kèm thư mục cha (ví dụ `src/auth.ts`).
  - Kích thước nút tỷ lệ thuận với số lượt đọc/chỉnh sửa của các agent.
- **Handoff Node (Điểm chuyển giao):**
  - Đánh dấu mốc chuyển giao giữa 2 nền tảng khi cạn quota.

### 2.2. Các Loại Liên Kết (Edges)

- `assigned_to` (Nét liền có mũi tên): Nền tảng $\rightarrow$ Task đang thực thi.
- `modified` (Nét liền màu cam đậm): Task $\rightarrow$ Tệp bị sửa đổi nội dung.
- `read` (Nét đứt màu xanh nhạt): Task $\rightarrow$ Tệp được đọc tham khảo.
- `handoff_to` (Nét đứt cong màu vàng hổ phách): Agent cũ $\rightarrow$ Agent mới tiếp quản.

---

## 3. Các Bước Triển Khai Chi Tiết

### Task 1: Cấu trúc Dữ liệu & Bộ Trích Xuất Đồ thị (`graphModel.ts`)

- [x] Tạo module `packages/web/src/graph/types.ts`:
  - Định nghĩa các kiểu `GraphNode`, `GraphEdge`, `GraphData`, `GraphFilterState`.
- [x] Xây dựng hàm trích xuất `extractGraphData(tasks, providers, events)`:
  - Duyệt qua danh sách tasks và luồng sự kiện AG-UI (`FILE_CHANGED`, `TOOL_CALL_START`, `HANDOFF`).
  - Gộp các tệp bị trùng lặp, tính toán số lượt truy cập (hit count) để xác định độ quan trọng của tệp.
  - Tạo các liên kết có trọng số và nhãn quan hệ rõ ràng.

### Task 2: Thuật toán Bố Trí Lực Co Giãn (`forceSimulation.ts`)

- [x] Cài đặt thuật toán mô phỏng lực vật lý 2D tự cân bằng:
  - Lực đẩy Coulomb giữa tất cả các cặp nút chống dính chồng chéo.
  - Lực hút Hooke dọc theo các liên kết giữ các thực thể liên quan nằm gần nhau.
  - Lực hướng tâm kéo các nút về trung tâm màn hình tránh trôi dạt vô tận.
- [x] Cơ chế làm nguội nhiệt độ (Cooling Factor):
  - Tự động giảm dần biên độ di chuyển theo thời gian và ngắt tính toán khi đạt ngưỡng ổn định, tiết kiệm 100% CPU.

### Task 3: Canvas Renderer Tương Tác 2D Warm Tech (`GraphCanvas.tsx`)

- [x] Xây dựng component vẽ đồ thị bằng HTML5 Canvas:
  - Nền màu kem ấm mịn màng với lưới chấm tọa độ mờ nhẹ (dot matrix pattern).
  - Vẽ cạnh liên kết mềm mại với mũi tên định hướng và nhãn quan hệ.
  - Vẽ nút dạng thẻ bo tròn (card node) hoặc hình tròn có viền mảnh, biểu tượng đại diện và tên nhãn font Mono.
- [x] Tương tác chuột và cảm ứng:
  - Bắt sự kiện pan (kéo chuột rê khung nhìn) và zoom (cuộn bánh xe chuột về vị trí con trỏ).
  - Kéo thả từng nút để tùy ý sắp xếp vị trí mong muốn.
  - Hiệu ứng hover: Làm sáng nút và các liên kết trực tiếp, làm mờ các thành phần không liên quan.

### Task 4: Thanh Công Cụ Điều Khiển & Bộ Lọc (`GraphToolbar.tsx`)

- [x] Thiết kế thanh công cụ nổi phía trên đồ thị theo phong cách Warm Tech:
  - Các nút thao tác nhanh: Phóng to (`+`), Thu nhỏ (`-`), Căn giữa toàn cảnh (`Fit View`), Bật/Tắt tính toán lực (`Auto Layout`).
  - Các công tắc lọc danh mục (Filter Chips):
    - Agent / Nền tảng (Hiển thị / Ẩn).
    - Task (Hiển thị / Ẩn).
    - File (Hiển thị / Ẩn).
    - Lần bàn giao (Hiển thị / Ẩn).
  - Ô tìm kiếm tệp hoặc task theo từ khóa thời gian thực.

### Task 5: Drawer Chi Tiết Node & Lịch Sử Tương Tác (`NodeDetailDrawer.tsx`)

- [x] Xây dựng panel trượt mượt mà từ cạnh phải khi nhấp chọn một nút:
  - **Khi chọn File Node:** Hiển thị đường dẫn đầy đủ, tổng số lượt chỉnh sửa, danh sách các task và các agent đã can thiệp vào tệp này.
  - **Khi chọn Task Node:** Hiển thị trạng thái, các tệp đã sửa trong task, nền tảng đang chạy và nút bấm dẫn nhanh đến màn hình chi tiết task (`#/task/:id`).
  - **Khi chọn Agent Node:** Hiển thị thông số quota, danh sách các task agent đã đảm nhận và lịch sử bàn giao.

### Task 6: Tích Hợp Router, Kiểm Thử & Tối Ưu Hóa

- [x] Kết nối tab `🕸 Đồ thị quan hệ` trong `packages/web/src/App.tsx`.
- [x] Viết unit tests kiểm thử bộ trích xuất dữ liệu và mô phỏng lực vật lý (`packages/web/test/graph.test.ts`).
- [x] Kiểm tra tính tương thích và kiểm tra build không cảnh báo lỗi (`pnpm build`, `pnpm typecheck`).

---

## 4. Tiêu Chí Hoàn Thành (Definition of Done)

1. Tab `🕸 Đồ thị quan hệ` hiển thị trực quan mạng lưới liên kết của toàn bộ hệ thống.
2. Giao diện sáng ấm, hài hòa đúng theo quy chuẩn `DESIGN.md`.
3. Tương tác mượt mà: pan, zoom, click xem chi tiết không bị giật lag.
4. Bộ lọc và tìm kiếm hoạt động chính xác với dữ liệu thực tế.
5. Vượt qua 100% bài kiểm thử tự động, build web thành công và pass `markdownlint`.
