# voragent Giai đoạn 2 (Văn phòng 3D & Agent Rắn) — Kế hoạch triển khai

> **Tài liệu đặc tả (Spec):** [docs/superpowers/specs/2026-11-04-voragent-design.md](../specs/2026-11-04-voragent-design.md) (Mục 8.1).
> **Bản thử tham chiếu:** `.superpowers/brainstorm/125-1793775209/content/office-3d-decor-v9.html`.
> **Quy chuẩn UI/UX:** [DESIGN.md](../../../DESIGN.md).

---

## 1. Mục tiêu và Phạm vi

Xây dựng không gian **Văn phòng 3D tương tác** và tạo hình **Agent Rắn Thông Minh (Smart Snake Agents)** cho voragent, phản chiếu trung thực mọi trạng thái hoạt động thời gian thực của các coding agent CLI (Claude Code, Codex, Antigravity).

### Yêu cầu cốt lõi

1. **Phong cách thẩm mỹ:** Sáng và ấm (Warm Cozy Tech Workspace) theo đúng `DESIGN.md`, không dùng phong cách neon cyberpunk tối đen.
2. **Hình tượng Agent Rắn:**
   - Thân ống liền mạch (`TubeGeometry`), thon dần về đuôi, có vằn màu nhận diện.
   - Cổ nối với đầu thon nhẹ (~90% độ rộng thân).
   - Di chuyển trườn chậm, thân đi theo đúng vệt đường đi của đầu.
   - Đuôi biết vẫy theo nhịp cảm xúc.
   - Khuôn mặt biểu cảm phong phú (mắt chớp, mí, đồng tử, miệng, giọt mồ hôi, nước mắt).
3. **Bố cục văn phòng:**
   - Khu làm việc (bàn cá nhân, hai màn hình, đèn bàn).
   - Khu nghỉ ngơi (sofa/nệm cuộn khi rảnh).
   - Góc máy chủ (tủ rack, router, đèn LED nhấp nháy, bảng quota).
   - TV treo tường hiển thị hàng đợi các task đang chờ.
4. **Phản chiếu trạng thái (State Mapping):** Đồng bộ trực tiếp từ luồng sự kiện AG-UI (`EventBus`/WebSocket).
5. **Hiệu năng:** Tối ưu tốc độ khung hình, tự động giảm tần số render khi nhàn rỗi hoặc trình duyệt chuyển nền.

---

## 2. Công nghệ và Thư viện

- **React Three Fiber (R3F):** Trình render khai báo (declarative) cho Three.js trên React 18.
- **`@react-three/drei`:** Tiện ích camera (`OrbitControls`), HTML overlays 3D (`Html`), đường cong spline, và các helper render.
- **Three.js (`three` + `@types/three`):** Engine 3D nền tảng.
- Tận dụng hệ thống sự kiện và trạng thái sẵn có trong `packages/web/src/state.ts` và `connection.ts`.

---

## 3. Các Bước Triển Khai Chi Tiết

### Task 1: Cài đặt thư viện 3D và Cấu trúc Component

- [x] Cài đặt `three`, `@types/three`, `@react-three/fiber`, `@react-three/drei` vào `packages/web`.
- [x] Tạo thư mục `packages/web/src/office/` chứa toàn bộ mã nguồn của văn phòng 3D.
- [x] Thiết lập `OfficeCanvas.tsx`:
  - Khung Canvas Three.js với góc nhìn Perspective Camera ấm cúng.
  - `OrbitControls` giới hạn góc quay để không nhìn xuyên sàn nhà.
  - Ánh sáng tự nhiên: Ambient light ấm nhẹ, Directional light mô phỏng ánh nắng qua cửa sổ kèm đổ bóng mềm (soft contact shadows).

### Task 2: Dựng Mô hình Không Gian Văn Phòng (`OfficeRoom.tsx`)

- [x] Dựng sàn nhà bằng chất liệu gỗ sáng màu (`#F3EDE2`), tường kem nhạt (`#FAF8F5`).
- [x] Bố trí 4 phân khu chính:
  - **Khu làm việc:** Các cụm bàn gỗ thông, mỗi bàn có 2 màn hình, bàn phím, đèn bàn. Màn hình máy tính có vật liệu phát sáng (emissive) đổi màu theo trạng thái agent (xanh khi chạy, vàng khi chờ duyệt, đỏ khi lỗi).
  - **Khu nghỉ ngơi:** Nệm cuộn êm ái, thảm tròn, chậu cây xanh, máy pha cà phê.
  - **Góc máy chủ & Hạ tầng:** Tủ rack máy chủ có dàn đèn LED nhấp nháy ngẫu nhiên; màn hình phụ hiển thị thanh quota các nền tảng.
  - **Khu họp & Thông tin:** Bảng TV treo tường hiển thị danh sách các task trong hàng đợi.

### Task 3: Xây dựng Mô hình Chú Rắn 3D (`SnakeMesh.tsx`)

- [x] **Tạo hình thân (Body Rig):**
  - Xây dựng spline đường cong 3D (`CatmullRomCurve3`) với 16–24 điểm kiểm soát.
  - Sử dụng `TubeGeometry` để tạo thân ống tròn liền mạch, đường kính giảm dần đều về phía đuôi.
  - Tô vằn màu (stripe material) với màu đại diện nền tảng: Claude (cam đất `#D97757`), Codex (xanh ngọc `#10A37F`), AGY (xanh dương `#4285F4`).
- [x] **Tạo hình đầu & Cổ:**
  - Đầu hình bầu dục bo tròn mềm mại, cổ nối tiếp thân với tỷ lệ khoảng 90% đường kính thân.
  - Phụ kiện tùy biến: Kính tri thức cho Claude, tai nghe chụp tai cho Codex, nơ hoặc mũ lưỡi trai.

### Task 4: Hệ thống Biểu Cảm Khuôn Mặt (`SnakeFace.tsx`)

- [x] Dựng các chi tiết mắt: tròng trắng, con ngươi (đồng tử), mí mắt trên và mí mắt dưới.
- [x] Cơ chế chớp mắt tự nhiên (Blinking Loop): Tự động chớp mắt ngẫu nhiên sau mỗi 3–6 giây.
- [x] Biểu cảm theo trạng thái:
  - **Tập trung:** Đồng tử mở to nhìn chăm chú vào màn hình.
  - **Năn nỉ / Chờ duyệt:** Vươn cao cổ, đồng tử long lanh, thêm hạt mồ hôi lăn bên má (`#60A5FA`).
  - **Ngủ (Rảnh):** Mí mắt nhắm cong hình chữ `^ ^` hoặc nhắm nghiền, có hiệu ứng chữ `Z z z` bay lên.
  - **Buồn / Lỗi:** Đầu cúi gục, miệng mếu, giọt nước mắt rơi nhẹ.

### Task 5: Hệ thống Chuyển Động (`SnakeAnimation.ts`)

- [x] **Chuyển động trườn (Slithering Motion):**
  - Cập nhật vị trí đầu rắn theo đường spline di chuyển từ khu nghỉ tới bàn làm việc (và ngược lại).
  - Các đoạn thân phía sau uốn lượn nhịp nhàng theo sóng sin bám theo đúng vệt di chuyển của đầu.
- [x] **Chuyển động vẫy đuôi (Tail Wagging):**
  - Các điểm kiểm soát ở 20% đoạn đuôi cuối dao động ngang với tần số và biên độ thay đổi: vẫy nhanh vui vẻ khi task hoàn thành, vẫy chậm khi đang làm việc.
- [x] **Hoạt cảnh chuyển giao Quota (Handoff Flow):**
  - Khi bắt được sự kiện `HANDOFF`: Rắn A (hết quota) buồn bã trườn rời bàn đi về khu nghỉ ngơi; đồng thời Rắn B (nền tảng kế tiếp) trườn tới thế chỗ, ngẩng đầu nhìn màn hình và tiếp tục làm việc.

### Task 6: HUD & Tương Tác Đồng Bộ 2D/3D (`OfficeOverlay.tsx`)

- [x] Tích hợp component `Html` từ `@react-three/drei` để render bóng thoại thông tin nổi trên đầu từng agent:
  - Tên agent (`Claude #1`) kèm cờ trạng thái mini.
  - Bong bóng thoại khi agent gọi tool (`📖 Đang đọc src/auth.ts`, `✏️ Đang sửa config.ts`).
- [x] Tương tác click chọn:
  - Nhấp chuột vào chú rắn: Camera lướt mượt mà (smooth lerp) lại gần bàn làm việc của chú rắn đó; mở panel chi tiết task tương ứng.

### Task 7: Tối ưu Hóa Hiệu Năng & Kiểm Thử

- [x] Giảm độ phân giải bóng đổ và giới hạn polygon ở mức tối ưu cho GPU tích hợp trên laptop.
- [x] Kiểm tra tính năng tiết kiệm pin: Tự động pause animation loop khi tab trình duyệt không active (`document.hidden`).
- [x] Viết unit tests cho các hàm tính toán spline và state mapper.
- [x] Tích hợp tab `🏢 Văn phòng 3D` vào thanh chuyển đổi chế độ xem trong `packages/web/src/App.tsx`.

---

## 4. Tiêu Chí Hoàn Thành (Definition of Done)

1. Văn phòng 3D hiển thị sắc nét, phong cách ấm cúng đúng theo `DESIGN.md`.
2. Chú rắn có thân liền mạch, trườn mượt mà, vẫy đuôi, chớp mắt và phản ánh đúng 5 trạng thái (Đang làm, Chờ duyệt, Rảnh, Lỗi, Bàn giao).
3. Đổi nền tảng do hết quota hiển thị rõ chuyển động bàn giao giữa hai chú rắn.
4. Tương tác nhấp chuột đồng bộ hoàn toàn với bảng task và timeline 2D.
5. Chạy mượt mà trên trình duyệt mà không gây quá tải CPU/GPU.
