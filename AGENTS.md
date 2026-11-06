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
   - **BẮT BUỘC DÙNG TIẾNG ANH CHO COMMIT MESSAGE:** Toàn bộ commit message phải viết hoàn toàn bằng tiếng Anh theo chuẩn Conventional Commits (ví dụ: `feat(...)`, `fix(...)`, `docs(...)`, `refactor(...)`). Tuyệt đối không dùng tiếng Việt trong commit message.
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

8. **CHỈ DỌN DẸP RÁC VÀ WORKTREE THUỘC SESSION CỦA CHÍNH MÌNH:**
   - Khi thực hiện dọn rác (xóa file tạm, log, worktree hoặc branch), AI agent **CHỈ ĐƯỢC PHÉP** dọn dẹp các tài nguyên/worktree do chính phiên làm việc (session/task) hiện tại của mình tạo ra.
   - **TUYỆT ĐỐI KHÔNG** đụng chạm, xóa bỏ hay can thiệp vào các worktree, branch, stash hoặc tệp tin của các session/agent khác đang cùng làm việc song song (ví dụ: các worktree khác trong `.worktrees/`).

9. **ĐỊNH TUYẾN URL QUA PATH + QUERY & BẢO TOÀN TRẠNG THÁI (URL ROUTING & RELOAD PERSISTENCE):**
   - Mọi điều hướng trong ứng dụng web **BẮT BUỘC** phải sử dụng cấu trúc Semantic Path + Query (`/`, `/board`, `/board?project=...`, `/task/<id>`, `/office`, `/graph`, `/new`), **TUYỆT ĐỐI KHÔNG** dùng URL hash (`#/...`).
   - Đảm bảo khi người dùng tải lại trang (reload / F5 / Ctrl+F5) ở bất kỳ URL nào, ứng dụng **BẮT BUỘC** phải giữ nguyên ở trang hiện tại, không được văng về trang chủ hay mất tham số ngữ cảnh.
   - Luôn tự động bảo lưu tham số xác thực `key=...` trong URL query khi điều hướng để reload trang hoặc copy URL không bao giờ bị mất phiên truy cập (401). Phía máy chủ HTTP daemon phải đảm bảo SPA fallback (`index.html`) hoạt động thông suốt cho mọi sub-path.

10. **TRIỆT TIÊU ANTI-PATTERN THANH CUỘN LỒNG NHAU (ZERO DOUBLE SCROLLBARS):**
   - Tại bất kỳ màn hình nào, trên một chiều không gian (dọc hoặc ngang), **TUYỆT ĐỐI CHỈ TỒN TẠI TỐI ĐA 1 THANH CUỘN HOẠT ĐỘNG**.
   - Nghiêm cấm để thanh cuộn của cửa sổ trình duyệt (`window` / `body`) và thanh cuộn của container con (`overflow-y: auto`) cùng xuất hiện song song (Double Scrollbar).
   - Với màn hình danh sách (ProjectList, bảng dữ liệu dài): Bắt buộc dùng cơ chế cuộn tự nhiên của trang (Unified Page Scroll) kết hợp với các thanh công cụ bám dính (`position: sticky`), tuyệt đối không bọc container danh sách vào `max-height: calc(...)` và `overflow-y: auto` gây sinh thanh cuộn kép.
   - Với màn hình dạng App Shell (Kanban Board 2D, Văn phòng 3D, Đồ thị quan hệ, TaskView split-screen): Kiểm soát chặt chẽ chiều cao tổng thể không vượt quá 100vh để không sinh thanh cuộn thừa ngoài cửa sổ.

11. **TRIỆT TIÊU QUÁ TẢI THỊ GIÁC & LẶP LẠI THÔNG TIN (PROGRESSIVE DISCLOSURE & CONTEXTUAL OVERLAYS):**
   - **TUYỆT ĐỐI KHÔNG** phơi bày toàn bộ chi tiết, form nhập liệu, danh sách trạng thái rỗng (`0 task`, `0 kế hoạch`, `Chưa cài`) hoặc lặp lại hàng loạt nút bấm giống nhau trên mọi thẻ trong danh sách.
   - **Thanh Header 1 dòng tuyệt đối:** Chỉ giữ tối đa 4 Tab chế độ xem chính. Các công cụ bổ trợ (như chi tiết Quota của từng CLI, Bàn Trưởng phòng, Shared Memory) **BẮT BUỘC** phải thu gọn thành các nút kích hoạt mở **Popover / Modal / Slide-over Overlay** khi người dùng bấm vào, tuyệt đối không trải dàn hàng ngang làm gãy dòng Header hoặc đẩy hẹp màn hình chính.
   - **Thẻ danh sách tinh gọn (Zero Redundant Badges):** Trên các thẻ dự án/task, chỉ hiển thị các tín hiệu khác 0 (ví dụ: đang chạy, chờ duyệt). Các nút hành động phụ chỉ xuất hiện khi rê chuột (`hover`) hoặc đặt bên trong Modal/View chi tiết.


12. **QUY CHUẨN HIỂN THỊ THƯƠNG HIỆU, MARKDOWN, BUTTON ICON-ONLY, CHECKBOX & KHÔNG GIAN 3D (UI PRECISION & ZERO OCCLUSION):**
   - **Khởi tạo Git 1-Click cho thư mục chưa có Git:** Khi một dự án chưa phải là Git repository (`!project.isGit`), giao diện **BẮT BUỘC** phải cung cấp nút hành động trực tiếp (`+ Khởi tạo Git` -> `POST /api/projects/git-init` tạo nhánh `main` kèm commit rỗng đầu tiên) thay vì chỉ hiện nhãn cảnh báo thụ động.
   - **Render Markdown thay vì Raw Text:** Mọi văn bản trao đổi của Agent/User (`TaskView`), báo cáo/câu hỏi của Sub-agent (`ManagerPanel`) và nội dung tri thức (`SharedMemoryPanel`) **BẮT BUỘC** phải được parse và render qua bộ hiển thị Markdown (`<MarkdownContent />`), hoặc lọc sạch cú pháp thô (`stripMarkdown`) trên các thẻ tóm tắt hẹp (như giấy nhớ Bảng Trắng 3D). Tuyệt đối không phơi bày ký hiệu `###`, `**`, ```` ``` ```` thô ra giao diện.
   - **Bảo vệ CSS cho Checkbox & Radio:** Quy tắc CSS chung cho `input` (`width: 100%; height: 38px; padding: 0 0.75rem`) **BẮT BUỘC** phải được reset tường minh trên `input[type="checkbox"]` và `input[type="radio"]` (`padding: 0 !important; width: 17px !important; height: 17px !important;`) và mọi biến màu (`--primary`) phải được định nghĩa đầy đủ trong `:root`.
   - **Sử dụng Icon/Logo thương hiệu nhà cung cấp (Provider Brand Icons):** Trên Đồ thị 2D (`GraphCanvas`, `GraphToolbar`, `NodeDetailDrawer`), Bảng Kanban, Đại sảnh Dự án, Hạn mức Quota và HUD, **BẮT BUỘC** sử dụng biểu tượng vector thương hiệu chính thức của từng nhà cung cấp (`<ProviderIcon />` / `drawProviderBrandOnCanvas`: Claude Starburst `#D97757`, OpenAI Codex Hex-Knot `#10A37F`, Google Antigravity Spark `#2563EB`, Crown `#7C3AED` cho Trưởng phòng). **TUYỆT ĐỐI KHÔNG** dùng emoji con rắn (`🐍`) làm biểu tượng đại diện cho các nhà cung cấp trên giao diện 2D/Đồ thị (hình tượng rắn chỉ dành riêng cho nhân vật 3D trong Văn phòng và Ouroboros Loader).
   - **Ưu tiên nút Icon-Only kèm Custom UI Tooltip (`<Tooltip />` / `data-tooltip` + `aria-label`):** Với các thao tác phổ quát hoặc lặp lại nhiều lần (Làm mới, Đóng `✕`, Quay lại `←`, Sao chép, Ghim `📌`, Xóa `🗑`, Phóng to/Thu nhỏ, Khớp khung nhìn, Thao tác nhanh trên thẻ), **BẮT BUỘC** ưu tiên dùng nút chỉ có Icon (`.icon-btn`, `.icon-btn-sm`) kết hợp **Custom UI Tooltip** (`<Tooltip />` / `data-tooltip` được render qua `<GlobalTooltipLayer />` hiển thị tức thì ~75ms, có mũi tên trỏ và `<kbd>` phím tắt). **TUYỆT ĐỐI KHÔNG** chỉ gán thuộc tính `title` mặc định của trình duyệt.
   - **Cô lập Z-Index & Chống che khuất trong Văn phòng 3D (Zero 3D Occlusion):**
     - Mọi thành phần `<Html>` của `@react-three/drei` trong không gian 3D **BẮT BUỘC** phải đặt `zIndexRange={[5, 0]}` và container `.office-canvas-wrapper` phải có `isolation: isolate; z-index: 1;` để các bảng 3D (TV, Bảng trắng, Nhãn tên) **KHÔNG BAO GIỜ** đè lên Popover/Dropdown của Header (`z-index: 120`) hay Modal (`z-index: 200`).
     - Các bảng thông tin treo tường 3D (Màn hình TV, Bảng Trắng) phải đặt sát tường sau (`z <= -9.8`) và tách sang hai bên (`x = -5.4` và `x = 5.4`) để không che khuất bàn và nhân vật Trưởng phòng ở trung tâm.
     - Không hiển thị nhãn `<Html>` nổi lơ lửng cho các nhân vật 3D đang nghỉ (`idle`) ở ghế chờ; chỉ hiển thị khi nhân vật đang làm việc, là Trưởng phòng, hoặc khi người dùng rê chuột (`hover`) / bấm chọn.


13. **RÀNG BUỘC NGHIÊM NGẶT CÁC LỰA CHỌN KHÔNG KHẢ DỤNG (STRICT AVAILABILITY CONSTRAINTS ON SELECTS & CONTROLS):**
   - **Tuyệt đối không cho phép chọn tài nguyên không khả dụng:** Bất kỳ nền tảng Agent CLI nào chưa được cài đặt (`!p.installed`), đang tạm nghỉ do hết hạn mức (`cooldownUntil > now`) hoặc đã cạn 100% Quota (`usedPercent >= 1`) **BẮT BUỘC** phải bị loại bỏ khỏi danh sách lựa chọn hoặc bị khóa cứng (`disabled: true`, `pointer-events: none`, `aria-disabled="true"` và chặn trong hàm `onChange`) trên **MỌI** thành phần chọn lựa (`CustomSelect`, `AgentPriorityMultiSelect`, `ManagerPanel`, `SharedMemoryPanel`, `OfficeCanvas`, `GraphCanvas`).
   - **Ràng buộc tương đương cho các tài nguyên phụ thuộc trạng thái khác:**
     - Khi dự án được chọn chưa phải là kho Git (`!project.isGit`), bộ chọn **Chế độ cách ly Git Worktree** trong `NewTaskForm` **BẮT BUỘC** phải tự động khóa (`disabled={true}`) kèm nút khởi tạo Git tại chỗ (`+ Khởi tạo Git ngay`).
     - Trong Văn phòng 3D và Đồ thị 2D, không hiển thị nhân vật 3D hoạt động hoặc nút Provider `Sẵn sàng` cho các CLI chưa được cài đặt trên máy, và không cho phép bấm bàn giao (`Handoff` / `Đổi nhân viên`) sang một Agent không khả dụng.


14. **CHUẨN HÓA CON TRỎ CHUỘT THEO NGỮ NGHĨA TƯƠNG TÁC (SEMANTIC CURSOR SYSTEM):**
   - Mọi phần tử trên giao diện **BẮT BUỘC** phải khai báo kiểu con trỏ chuột (`cursor`) phản ánh chính xác hành vi tương tác của phần tử đó:
     - **Phần tử bấm được (`cursor: pointer`):** Mọi nút bấm (`button:not(:disabled)`), liên kết (`a`), thẻ dự án/task (`.office-project-card`, `.projects-table-row`, `.task-card`), tab điều hướng, tùy chọn dropdown (`.custom-select-option:not(.disabled)`), checkbox/radio khả dụng, thẻ thu gọn (`summary`) và các đối tượng 3D tương tác (Nhân vật rắn, Bàn, Đèn, TV, Bảng Trắng).
     - **Bề mặt nhấn giữ để kéo / xoay / di chuyển (`cursor: grab` khi rê chuột -> `cursor: grabbing` khi nhấn giữ):** Bề mặt không gian Văn phòng 3D (`.office-canvas-wrapper canvas`), nền Đồ thị quan hệ 2D (`GraphCanvas`) và các nút đồ thị khi đang nhấn giữ kéo thả.
     - **Phần tử bị vô hiệu hóa / khóa (`cursor: not-allowed !important`):** Mọi nút, input, checkbox, radio, hoặc mục chọn trong `CustomSelect` / `AgentPriorityMultiSelect` đang ở trạng thái `:disabled` hoặc `aria-disabled="true"`.
     - **Vùng nhập liệu & văn bản mã nguồn có thể bôi đen (`cursor: text`):** Ô `input[type="text"]`, `textarea:not(:disabled)`, khối lệnh/log (`pre.msg-tool-body`) và khung `pre.diff`.
     - **Chỉ báo thông tin có giải thích Tooltip (`cursor: help`):** Các badge trạng thái tĩnh hoặc chấm cảnh báo có gắn `data-tooltip` nhưng không phải nút bấm.

15. **TRIỆT TIÊU DIALOG GỐC CỦA TRÌNH DUYỆT (ZERO NATIVE ALERT / CONFIRM / PROMPT):**
   - **TUYỆT ĐỐI CẤM** sử dụng các hộp thoại mặc định của trình duyệt (`window.alert()`, `window.confirm()`, `window.prompt()`).
   - Mọi thao tác yêu cầu xác nhận (Hủy/xóa kế hoạch Trưởng phòng, xóa task, xóa bộ nhớ chung, thoát trạng thái quan trọng) **BẮT BUỘC** phải sử dụng UI component chuyên dụng (`<ConfirmModal />` hoặc In-place Confirm Card).
   - Component modal xác nhận phải được render qua React Portal (`createPortal(..., document.body)`), có lớp nền mờ (`backdrop-filter: blur(...)`), tự động bẫy phím `Escape` để hủy và focus nút an toàn để chống bấm nhầm.

16. **SỬ DỤNG TOOLTIP CÓ CHỌN LỌC & TRIỆT TIÊU RÁC THỊ GIÁC (INTENTIONAL TOOLTIPS & ZERO TOOLTIP OVERUSE):**
   - **Nguyên tắc vàng:** **CHỈ GẮN TOOLTIP CHO NHỮNG PHẦN TỬ MÀ KHI NHÌN VÀO NGƯỜI DÙNG CHƯA THỂ HIỂU RÕ Ý NGHĨA HOẶC CÓ PHÍM TẮT ẨN QUAN TRỌNG.** Tuyệt đối không lạm dụng tooltip lên mọi nút bấm làm phát sinh hàng loạt bóng mờ nhảy múa liên tục khi rê chuột dọc giao diện, gây rối mắt và ức chế trải nghiệm.
   - **CHỈ ĐƯỢC PHÉP gắn Tooltip trong 3 trường hợp thực sự cần thiết:**
     1. **Biểu tượng trừu tượng hoặc có phím tắt ẩn quan trọng:** Các nút công cụ không có chữ mà icon chưa đủ trực quan hoặc có phím tắt hữu ích không hiển thị trên giao diện (ví dụ: `Ẩn/Hiện thanh bên (Ctrl+B)`, `Bật/Tắt Terminal (Ctrl+`)`, `Toàn màn hình (F11)`).
     2. **Văn bản bị cắt ngắn (Truncated text):** Tên đường dẫn dài, tiêu đề bị `text-overflow: ellipsis` cần rê chuột để xem toàn bộ nội dung.
     3. **Chỉ báo trạng thái trừu tượng:** Chấm offline, commit ahead/behind (ví dụ: `↑2` kèm tooltip `2 commit chưa push`), thanh dung lượng/quota phức tạp.
   - **TUYỆT ĐỐI CẤM gắn Tooltip cho:**
     1. **Các biểu tượng phổ quát ai nhìn vào cũng tự hiểu ý nghĩa (Universal Self-Explanatory Icons):**
        - Nút đóng `✕` trên tab trình duyệt/editor/terminal, modal close `✕`.
        - Nút thêm mới `+` trên dải tab.
        - Các nút xác nhận `✓` và hủy `✕` cạnh ô nhập liệu inline.
        - Nút quay lại `←` (đặc biệt khi ngữ cảnh đã rõ ràng hoặc đã có nhãn chữ).
        - Nút xóa từ khóa `✕` trong ô tìm kiếm.
     2. **Các biểu tượng thao tác vi mô hàng loạt trên danh sách/cây thư mục/danh sách file (Hover Micro-Actions in Lists/Trees):**
        - Tuyệt đối KHÔNG gắn tooltip cho các nút thao tác nhanh xuất hiện khi hover trên từng dòng của Tree/List (ví dụ: nút tạo file, tạo folder, đổi tên, xóa trong file tree; nút stage `+`, bỏ stage `-`, discard `✕` trong Git diff list). Rê chuột dọc danh sách không bao giờ được phép kích hoạt một rừng bóng tooltip che khuất nội dung. Sử dụng thuộc tính trợ năng `aria-label` thay thế.
     3. **Các phần tử ĐÃ CÓ NHÃN CHỮ RÕ RÀNG (Self-explanatory text labels):**
        - Tab điều hướng Header khi đang hiện chữ (`Dự án`, `Văn phòng 3D`, `Bảng Kanban`, `Đồ thị`).
        - Nút hành động chính khi đang có chữ (ví dụ: nút `Task mới`, `Kanban`, `Commit`, `Lưu`, `Hủy`, `Đăng nhập`).
        - Checkbox, Radio, Dropdown chọn dự án/worktree đã có chữ và mũi tên dropdown.
     4. **Logo thương hiệu chính (`voragent`).**
     5. **Tooltip lặp lại y hệt hoặc diễn giải thừa thãi nhãn chữ đang nhìn thấy.**

17. **RÀ SOÁT TÁC ĐỘNG TOÀN DIỆN & KHÔNG BỎ SÓT KHI THÊM/SỬA TÍNH NĂNG (EXHAUSTIVE IMPACT AUDIT & ZERO OMISSION):**
   - Khi thêm mới, mở rộng hoặc sửa đổi bất kỳ thực thể cốt lõi nào trong hệ thống (như thêm Agent CLI mới [ví dụ: `opencode`], mô hình mới, trạng thái task mới, kiểu nguồn dự án, hoặc chế độ xem mới), AI agent **BẮT BUỘC** phải rà soát toàn bộ các tầng trong monorepo và cập nhật đồng bộ, tuyệt đối không làm chắp vá cục bộ:
     1. **Tầng Bộ điều hợp & CLI (`packages/adapters`, `packages/cli`):** Đăng ký Adapter trong `FACTORIES`, hàm `detect()`, parser stream/quota, danh sách nhãn nguồn `SOURCE_LABEL`, câu lệnh cài đặt tự động (`npm install -g`).
     2. **Tầng Lõi Daemon & Cấu hình (`packages/core`):** `DEFAULT_CONFIG.priority`, danh sách hỗ trợ đầy đủ `knownProviders` trong `daemon.ts` (không để phụ thuộc vào cấu hình đã lưu cũ), tự động nâng cấp file cấu hình cũ (`loadConfig` auto-migration), ánh xạ gói npm `PROVIDER_NPM_PACKAGES`, danh mục bỏ qua `HOME_DOT_DIRS`, phân rã nhiệm vụ Trưởng phòng `buildDefaultSubtasks`.
     3. **Tầng Giao diện Web 2D (`packages/web`):**
        - Bảng Kanban & Thẻ task: CSS class cho badge agent (`.card-agent-badge.<provider>`), hàm phân loại `AGENT_CLASS`.
        - Thanh Quota & Popover: Metadata cài đặt (`getProviderGuide`), số lượng hiển thị, chấm trạng thái màu sắc.
        - Đồ thị quan hệ 2D: Tên và màu sắc thương hiệu trong `graphModel.ts`, biểu tượng canvas trong `ProviderIcon.tsx`.
        - Phân công việc & Sub-agent: `ManagerPanel`, `SharedMemoryPanel`, `NewTaskForm`, `AgentPriorityMultiSelect`.
        - Bộ phân tích văn bản: Bộ nhận diện lệnh terminal `COMMAND_PREFIXES` trong `MarkdownContent.tsx`.
     4. **Tầng Văn phòng 3D (`packages/web/src/office`):** Bàn làm việc, vị trí nệm nghỉ, cốc nước/vật phẩm, bảng màu chủ đề `PROVIDER_THEMES`, và phụ kiện đặc trưng (`Accessory`) trên nhân vật rắn 3D trong `SnakeMesh.tsx`.
     5. **Tài liệu & Kiểm thử:** Cập nhật `README.md`, `CLAUDE.md`, bộ test case tương ứng để bảo đảm không phát sinh hồi quy (regression).


18. **TRIỆT TIÊU BÓNG & FOCUS-RING LỆCH KHỎI PHẦN TỬ WRAPPER (ZERO MISALIGNED SHADOWS & FOCUS-RINGS):**
   - **Nguyên nhân cốt lõi:** Trong `styles.css`, các thẻ form nguyên bản (`input`, `select`, `button`) đã được định nghĩa chiều cao chuẩn toàn cục (`height: 38px; line-height: 36px;`) và vòng sáng tiêu điểm (`box-shadow: 0 0 0 3px rgba(217, 119, 87, 0.18)` trên `:focus`). Khi bọc chúng vào các container tùy biến hẹp hơn (như `.wrapper`, `.nav-select`, `.search-box`, thanh breadcrumb 28–32px), phần tử con bên trong bị tràn hoặc lệch tâm, khiến bóng `box-shadow` khi focus xuất hiện lơ lửng, trồi lên/xuống lệch hẳn so với khung viền của container cha gây mất thẩm mỹ nghiêm trọng.
   - **Quy tắc bắt buộc phải tuân thủ:**
     1. **Triệt tiêu toàn bộ Focus-Ring & Chiều cao thừa của phần tử con:** Mọi `<input>`, `<select>`, `<button>` nằm trong container tùy biến **BẮT BUỘC** phải được reset tường minh: `box-shadow: none !important; outline: none !important; height: 100% !important; min-height: 0 !important; line-height: normal !important; border: none !important; background: transparent !important; margin: 0 !important;`.
     2. **Hiệu ứng Focus-Ring chuyển lên Container cha qua `:focus-within`:** Vòng sáng focus (`box-shadow: 0 0 0 2.5px rgba(217, 119, 87, 0.2)`) và đổi màu viền (`border-color`) **BẮT BUỘC** phải được gắn trên container cha (`.wrapper:focus-within`), tuyệt đối không để phần tử con tự sinh shadow riêng lẻ.
     3. **Ưu tiên Custom Component thay vì Native Select:** Luôn ưu tiên dùng `<CustomSelect />` hoặc các popover menu tùy chỉnh thay vì thẻ `<select>` thô của HTML (vốn có mũi tên và hành vi render focus-ring không nhất quán giữa các trình duyệt hệ thống).
