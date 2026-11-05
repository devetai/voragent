# voragent: điều phối và trực quan hóa AI agent trên máy người dùng

Ngày: 2026-11-04 · Trạng thái: bản nháp chờ duyệt

## 1. Ý định và lý do

Người dùng làm việc với nhiều coding agent dạng dòng lệnh (CLI) cùng lúc: Claude Code, Codex, Antigravity, opencode và các agent khác. Mỗi nền tảng có **quota** riêng (hạn mức sử dụng theo gói, ví dụ "5 giờ" hoặc "theo tuần"). Khi một nền tảng hết quota giữa chừng, việc đang làm bị kẹt.

voragent là một chương trình chạy trên máy người dùng, làm hai việc:

1. **Điều phối:** nhận việc vào hàng đợi, giao cho agent phù hợp, và chuyển việc sang nền tảng khác khi nền tảng đang dùng hết quota. Công việc dở dang không bị mất.
2. **Trực quan hóa:** cho thấy các agent đang làm gì. Chế độ xem nổi bật nhất là một văn phòng 3D, trong đó mỗi agent là một con rắn dễ thương có biểu cảm. Ngoài ra còn có bảng, dòng thời gian và đồ thị.

Hai dự án tham khảo (chỉ để học cách làm, voragent không phụ thuộc vào chúng):

- **tiptask runner** (`D:\Projects\young-turtles\tiptask\packages\runner`): cách chạy CLI không cần người trông, cách đọc luồng sự kiện của từng CLI rồi đổi về chuẩn AG-UI, cách tiếp tục phiên cũ. Xem `src/presets.ts` và `src/agui.ts`.
- **GitNexus** (<https://github.com/abhigyanpatwari/GitNexus>): một lệnh khởi chạy (`npx …`), máy chủ HTTP cục bộ, giao diện web React đọc dữ liệu cục bộ, đồ thị vẽ bằng Sigma.js, tích hợp agent qua MCP và hook.

## 2. Mục tiêu, không phải mục tiêu, phản mục tiêu

### Mục tiêu

- G1. Một việc giao cho voragent **vẫn hoàn thành được khi nền tảng đang chạy hết quota**. Nền tảng khác làm tiếp trên cùng thư mục làm việc, dựa vào bản bàn giao.
- G2. Hỗ trợ nhiều nền tảng qua adapter. Bắt đầu với Claude Code và Codex, sau đó Antigravity, opencode, Gemini CLI, GitHub Copilot CLI.
- G3. Thấy được **mọi** hoạt động của agent ở một chỗ, gồm việc voragent giao và các phiên người dùng tự mở bằng tay.
- G4. Văn phòng 3D sinh động, vui mắt (mục 8), cùng bảng, dòng thời gian và đồ thị.
- G5. Chạy thẳng trên Windows (không cần WSL), macOS và Linux, chỉ bằng một lệnh.

### Không phải mục tiêu (ít nhất ở bản đầu)

- Không có máy chủ đám mây, không có tài khoản, không chia sẻ nhiều người dùng. Mọi thứ nằm trên một máy.
- Không tích hợp TipTask hay bất kỳ công cụ quản lý việc nào bên ngoài.
- Không tự gọi API mô hình. voragent chỉ chạy các CLI chính thức mà người dùng đã cài và đăng nhập.
- Không lấy được toàn bộ "suy nghĩ" của agent A khi chuyển sang agent B. Chỉ có bản bàn giao.

### Phản mục tiêu (dù chạy được, gặp các điều này vẫn coi là thất bại)

- Chuyển nền tảng làm mất hoặc ghi đè thay đổi chưa commit của người dùng.
- Agent chạy lệnh nguy hiểm trên thư mục làm việc chính của người dùng mà không qua worktree hay bước duyệt.
- Né hoặc lách giới hạn quota của nhà cung cấp, hoặc dùng thông tin đăng nhập theo cách điều khoản không cho phép. voragent chỉ **chọn nền tảng khác**, không vượt giới hạn.
- Văn phòng 3D đẹp nhưng không phản ánh đúng trạng thái thật.
- Cài đặt rườm rà, ví dụ bắt buộc WSL hay Docker.

## 3. Ràng buộc

- Máy chính của người dùng chạy Windows 11. Node.js được quản lý qua fnm. Cách gọi CLI phải chạy được với các file shim `.cmd` trên Windows.
- Agent dùng phiên đăng nhập sẵn có của người dùng. voragent không đăng nhập thay người dùng.
- Dữ liệu (lịch sử, bản ghi lần chạy) nằm trên máy. Giao diện web chỉ nghe ở `127.0.0.1` và có khóa phiên.

## 4. Kiến trúc

```text
                ┌──────────── voragent daemon (một tiến trình Node) ────────────┐
 Người dùng →   │ Hàng đợi ─→ Bộ điều phối ─→ Adapter: claude | codex | agy | …  │ → CLI thật
 (web / CLI)    │    ↑            │ chọn nền tảng theo quota và ưu tiên          │
                │    │            ↓                                               │
                │  SQLite ←── Sự kiện chung (tin nhắn, gọi tool, file, quota) ←───┤ ← stream / hook / nhật ký phiên
                └──────────────────────────────│─────────────────────────────────┘
                                                ↓ HTTP + WebSocket (localhost)
                              Web: Văn phòng 3D · Bảng · Dòng thời gian · Đồ thị
```

Các thành phần:

- **Daemon:** tiến trình nền chạy lâu. Giữ hàng đợi, bộ điều phối, các tiến trình CLI con, kho dữ liệu, HTTP API và WebSocket.
- **CLI `voragent`:** `voragent` (hoặc `npx voragent`) khởi động daemon và mở web. Thêm các lệnh con như `voragent add "<việc>"`, `voragent status`, `voragent hooks install`.
- **Adapter:** mỗi nền tảng một adapter (mục 5).
- **Web:** ứng dụng React được daemon phục vụ trực tiếp, nhận sự kiện trực tiếp qua WebSocket.

### 4.1 Mô hình dữ liệu (khái niệm)

| Thực thể | Ý nghĩa | Ví dụ |
| --- | --- | --- |
| Task (việc) | Một **cuộc trò chuyện** với agent về một yêu cầu. Gồm nhiều lượt: người dùng nhắn, agent trả lời. Agent có thể hỏi lại, người dùng trả lời trong ô chat của task | "Sửa lỗi đăng nhập trong repo X" → agent hỏi "dùng cookie hay JWT?" → "JWT" |
| Turn (lượt) | Một tin nhắn của người dùng cùng câu trả lời của agent. Mỗi lượt là một lần gọi CLI headless, tiếp tục phiên của nền tảng hiện tại | Lượt 2: `claude -p --resume <id>` với tin nhắn "JWT" |
| Run (lần chạy) | Đoạn task chạy trên một nền tảng, có thể gồm nhiều lượt. Task đổi sang nền tảng khác thì mở run mới | Run 1 trên claude (lượt 1–3, hết quota ở lượt 3), run 2 trên codex (lượt 3–5) |
| Agent | Một cấu hình chạy cụ thể: nền tảng, model, tham số, tên, màu, phụ kiện | `claude #1`, `codex` |
| Provider (nền tảng) | Claude, Codex… cùng trạng thái quota của nó | Claude: tạm nghỉ đến 15:00 |
| Session (phiên) | Phiên phía CLI, dùng để tiếp tục trong cùng một nền tảng | session id của Claude Code |
| Event (sự kiện) | Đơn vị nhỏ nhất, được tất cả các chế độ xem dùng chung | `TOOL_CALL_START Read src/auth.ts` |
| Workspace | Thư mục, thường là git worktree, nơi một task chạy | `.voragent/worktrees/task-42` |

**Dạng sự kiện chung:** dựa trên các loại sự kiện AG-UI giống tiptask runner (`RUN_STARTED`, `TEXT_MESSAGE_*`, `TOOL_CALL_*`, `RUN_FINISHED`, `RUN_ERROR`), bổ sung các sự kiện voragent cần:

- `STATE_CHANGED` (làm việc, chờ duyệt, rảnh, lỗi, xong);
- `APPROVAL_REQUESTED` / `APPROVAL_RESOLVED`;
- `QUOTA_UPDATED` / `QUOTA_EXHAUSTED` (kèm giờ được dùng lại nếu biết);
- `HANDOFF` (từ run nào sang run nào);
- `FILE_CHANGED`;
- `SUBAGENT_STARTED` / `SUBAGENT_FINISHED`;
- `USAGE` (token).

Mỗi sự kiện ghi rõ nguồn: `managed` (voragent giao) hay `observed` (phiên người dùng tự mở).

## 5. Adapter cho từng nền tảng

Mỗi adapter cung cấp:

1. **Phát hiện:** CLI đã cài chưa, phiên bản nào, đã đăng nhập chưa (nếu kiểm tra được).
2. **Tạo lệnh chạy không cần người trông:** cờ headless, cách đưa yêu cầu vào (stdin hay đối số), cách đưa system prompt, cách tiếp tục phiên. Tham khảo `PRESETS` trong tiptask runner. Ví dụ Claude: `claude -p --output-format stream-json --verbose --include-partial-messages`, có `--resume <id>` khi tiếp tục phiên.
3. **Đọc luồng output:** đổi stream của CLI sang sự kiện chung. Tham khảo `AnswerStream` trong `agui.ts` của runner.
4. **Nhận diện hết quota / bị giới hạn tốc độ:** dựa vào mã thoát, stderr và các sự kiện trong stream. Đọc giờ được dùng lại nếu CLI có báo. Mẫu nhận diện nằm trong adapter, có test bằng các mẫu output thật.
5. **Đọc lượng đã dùng (nếu có):** ví dụ thông tin `rate_limits` trong luồng JSON của Codex, hoặc số token trong file nhật ký phiên của Claude. Không có thì để trống. Hệ thống vẫn chạy được, chỉ là không đoán trước được lúc sắp hết.
6. **Cách đọc phiên tự mở:** vị trí file nhật ký phiên và định dạng của nó, nếu nền tảng có.

Thứ tự làm: Claude Code, Codex, rồi Antigravity, opencode, Gemini CLI, Copilot CLI. Thêm adapter mới không được phải sửa lõi.

Cấu hình người dùng có thể tự khai báo một adapter "lệnh tùy ý": yêu cầu đưa vào stdin, output đọc như văn bản thuần, không có quota.

## 6. Điều phối và chuyển việc khi hết quota

### 6.1 Chọn nền tảng

- Người dùng đặt **danh sách ưu tiên** chung, ví dụ `claude → codex → antigravity`. Một task có thể ghi đè danh sách này hoặc chỉ định agent cụ thể.
- Bộ điều phối bỏ qua nền tảng đang **tạm nghỉ** (đã hết quota, chưa tới giờ dùng lại), chưa cài, hoặc đã đủ số việc chạy song song.
- Nếu lượng đã dùng biết được và vượt ngưỡng (mặc định 90%), nền tảng đó không nhận **việc mới**, nhưng việc đang chạy vẫn chạy tiếp.
- Số việc chạy song song có giới hạn theo từng agent và cho toàn hệ thống (cấu hình được).

### 6.2 Workspace

- Mặc định mỗi task chạy trong **một git worktree riêng** của repo đích, trên một nhánh riêng (ví dụ `voragent/task-42`). Khi chuyển nền tảng, run mới dùng lại đúng worktree đó.
- **Điểm bắt đầu và commit (người dùng chọn).** Khi tạo task, người dùng chọn một trong ba chế độ. Chế độ mặc định có thể đổi trong cấu hình.
  - **Mặc định: từ HEAD, mang theo việc dở, agent tự commit.** Worktree tạo từ commit hiện tại của repo, rồi chép sang các thay đổi chưa commit của người dùng (kể cả file mới chưa được git theo dõi, trừ file trong `.gitignore`). Agent commit trên nhánh `voragent/task-N` sau mỗi lượt và trước mỗi lần bàn giao, nên công việc không bao giờ chỉ nằm ở dạng chưa commit. Bản bàn giao ghi các commit này cùng diff so với điểm bắt đầu.
  - **Chỉ từ HEAD, agent tự commit:** giống mặc định nhưng không mang theo việc dở.
  - **Mang theo việc dở, không commit:** agent để thay đổi ở dạng chưa commit. Bản bàn giao dựa vào `git diff`.
  - Thư mục làm việc chính của người dùng không bao giờ bị sửa, ở cả ba chế độ.
- Thư mục không phải repo git: chạy thẳng trong thư mục đó, và giao diện ghi rõ là không có cách ly.
- Task xong: worktree và nhánh được giữ lại để người dùng xem diff, merge hoặc xóa từ giao diện. voragent không tự merge vào nhánh của người dùng.

### 6.3 Bàn giao khi hết quota

1. Adapter báo `QUOTA_EXHAUSTED`. Run hiện tại kết thúc với trạng thái `quota_exhausted`, nền tảng được đánh dấu tạm nghỉ đến giờ dùng lại. Nếu không biết giờ đó, dùng một thời lượng mặc định có thể cấu hình.
2. voragent soạn **bản bàn giao** từ dữ liệu của chính nó, không cần agent cũ phối hợp:
   - yêu cầu gốc của task và toàn bộ tin nhắn người dùng đã gửi ở các lượt, kèm tóm tắt câu trả lời của agent ở từng lượt;
   - tóm tắt các bước đã làm (các lần gọi tool, file đã đọc và sửa);
   - đoạn trả lời cuối của agent cũ;
   - `git status` và `git diff` hiện tại của worktree, rút gọn nếu quá dài;
   - một câu dặn: "tiếp tục từ đây, kiểm tra lại trước khi sửa thêm".
3. Bộ điều phối chọn nền tảng kế tiếp theo mục 6.1 và mở run mới trong cùng worktree với bản bàn giao. Sự kiện `HANDOFF` được ghi lại.
4. Nếu mọi nền tảng đều tạm nghỉ, task chờ trong hàng đợi đến khi có nền tảng dùng được lại, rồi tự chạy tiếp.

Lỗi khác (lỗi mạng, CLI crash) không phải hết quota: thử lại một lần trên cùng nền tảng, sau đó coi là lỗi. Người dùng có thể bấm "chạy lại" hoặc "chuyển sang nền tảng khác".

### 6.4 Quyền và duyệt

- Việc do voragent giao chạy ở chế độ tự động **bên trong worktree**, với chế độ quyền an toàn nhất mà mỗi CLI hỗ trợ khi chạy không người trông (ví dụ Claude `--permission-mode auto`, Codex `sandbox_mode="workspace-write"`).
- Nền tảng có hook, như Claude Code: voragent cài hook `PreToolUse` để hỏi daemon trước khi agent dùng tool. Daemon áp quy tắc cho phép / chặn / hỏi người dùng. Khi cần hỏi, sự kiện `APPROVAL_REQUESTED` xuất hiện, con rắn giơ tay, người dùng bấm duyệt hoặc từ chối trên web. Quá thời gian chờ thì từ chối.

## 7. Theo dõi phiên người dùng tự mở

- **Claude Code:** `voragent hooks install` thêm hook vào cài đặt người dùng (`~/.claude/settings.json`). Hook gửi sự kiện về daemon qua HTTP cục bộ, gồm `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SubagentStop`, `SessionEnd`. Khi daemon không chạy, hook phải kết thúc ngay và không làm chậm Claude Code.
- **Các nền tảng khác:** đọc file nhật ký phiên trong thư mục của chúng (ví dụ `~/.codex/sessions`), nếu có.
- Phiên tự mở hiện trong văn phòng như agent tạm thời, có nhãn "phiên tay". voragent chỉ xem, không điều khiển các phiên này. Riêng bước duyệt quyền qua hook là ngoại lệ, và người dùng có thể tắt.
- Cài hook là bước người dùng tự chọn, có lệnh gỡ (`voragent hooks uninstall`).

## 8. Giao diện

Bốn chế độ xem đọc chung một dòng sự kiện. Chuyển chế độ bằng tab, chọn một agent ở chế độ này thì các chế độ khác cũng chọn theo.

### 8.1 Văn phòng 3D (đã chốt qua các bản thử)

Bản thử tham chiếu: `.superpowers/brainstorm/125-1793775209/content/office-3d-decor-v9.html`. Mở trực tiếp trong trình duyệt để xem. Bản thử là code dùng một lần, không dùng làm nền cho code thật.

Người dùng đã chọn:

- Không gian 3D có chiều sâu, dựng bằng thư viện 3D, xoay và phóng to được.
- **Mỗi agent là một con rắn dễ thương:**
  - Thân là **một ống liền mạch**, không ghép từ các khối rời, thon dần về đuôi, có vằn màu.
  - Độ dài vừa phải như bản thử 9. Cổ nối với đầu chỉ hơi thon, khoảng 90% độ rộng thân.
  - Trườn **chậm**, thân đi theo đúng vệt của đầu.
  - **Biết vẫy đuôi.** Kiểu vẫy đổi theo biểu cảm.
  - **Nhiều biểu cảm khuôn mặt** do các phần mắt, mí, đồng tử, lông mày, miệng, má, mồ hôi, nước mắt tạo nên, không dùng chung một khuôn mặt. Mắt có chớp.
- **Phòng rộng, phong cách sáng và ấm** (không chuyển sang phong cách tối kiểu neon).
  - Chia khu: làm việc, phòng họp, khu nghỉ, góc máy chủ.
  - **Bày đồ công nghệ:** bàn hai màn hình, bàn phím, đèn bàn, TV treo tường, đồng hồ điện tử, tủ máy chủ và router có đèn LED, máy in 3D, laptop, kính VR, loa hội nghị, drone, loa thông minh, máy chơi game, máy pha cà phê, robot hút bụi.
  - Người dùng sẽ chỉnh chi tiết trang trí sau.

Trạng thái được thể hiện thế nào (mình tự quyết, chỉnh được):

| Trạng thái thật | Vị trí | Dáng | Biểu cảm | Màn hình bàn |
| --- | --- | --- | --- | --- |
| Đang làm (gọi tool, viết) | Tại bàn | Cuộn trên nệm, đầu ngóc nhìn màn hình | Tập trung | Sáng xanh, nhấp nháy |
| Chờ duyệt / chờ trả lời | Tại bàn | Vươn cổ cao, lắc lư | Năn nỉ, có mồ hôi | Vàng nhấp nháy |
| Rảnh | Khu nghỉ | Cuộn tròn, đầu gục | Ngủ | Tắt |
| Lỗi | Tại bàn | Đầu cúi | Buồn, nước mắt | Đỏ |
| Xong việc | Tại bàn, thoáng qua | — | Vui (mắt ^ ^) | — |
| Vừa nhận việc | Tại bàn, thoáng qua | — | Ngạc nhiên | — |
| Sắp hết ngữ cảnh hoặc quota | Tại bàn | — | Quá tải (mắt X, sao quay) | — |
| Subagent | Trườn từ bàn agent cha đi rồi quay về | Trườn | Vui | — |
| Hết quota, đang bàn giao | Rời bàn sang khu nghỉ, agent kế tiếp trườn tới bàn | Trườn | — | — |

- Phía trên mỗi con rắn có nhãn tên và bong bóng trạng thái, ví dụ "📖 đọc src/auth.ts", "✋ chờ bạn duyệt: rm -rf dist".
- Bấm vào rắn để chọn nó và mở dòng thời gian của run hiện tại.
- TV treo tường hiện hàng đợi.
- Có một bảng hiện quota từng nền tảng, đặt ở góc máy chủ hoặc trên một màn hình khác.
- Mỗi agent có **màu và phụ kiện riêng** (kính, tai nghe, mũ ngủ, nơ, mũ lưỡi trai…), lưu trong cấu hình agent.
- Phiên tay xuất hiện như rắn khách và rời đi khi phiên kết thúc.
- Biểu cảm hiện đổi theo trạng thái. Cho mỗi agent một "tính cách" riêng (cùng trạng thái nhưng phản ứng khác nhau) là ý tưởng để sau.

### 8.2 Bảng

Các cột: Chờ · Đang chạy · Chờ bạn (agent hỏi lại, cần duyệt quyền, hoặc đã trả lời xong lượt và chờ tin nhắn tiếp) · Xong · Lỗi. Người dùng bấm "Xong" để đóng task. Agent không tự đóng task. Mỗi thẻ là một task, ghi agent hiện tại, số lần đã chuyển nền tảng và thời gian chạy. Có nút tạo task: chọn repo hoặc thư mục, nhập yêu cầu, tùy chọn agent hoặc danh sách ưu tiên.

### 8.3 Dòng thời gian

Đây cũng là **khung chat của task**: ô nhập ở dưới cùng để gửi lượt tiếp theo, và các câu trả lời của agent hiện trực tiếp khi agent đang viết. Dòng thời gian hiện từng sự kiện của các run trong task, theo thứ tự thời gian: tin nhắn, lần gọi tool và kết quả, file thay đổi, các lần bàn giao (đánh dấu rõ chỗ đổi nền tảng), token đã dùng. Có diff của worktree.

### 8.4 Đồ thị

Các nút là agent, task, file và nền tảng. Cạnh là các quan hệ "đã làm", "đã sửa", "bàn giao cho". Vẽ bằng Sigma.js + Graphology. Giai đoạn sau có thể nối với đồ thị mã nguồn của GitNexus (nếu repo đã được index) qua MCP server của GitNexus.

### 8.5 Thanh quota

Luôn hiển thị: mỗi nền tảng có trạng thái sẵn sàng / sắp hết / tạm nghỉ đến giờ X, và phần trăm đã dùng nếu biết.

## 9. Lựa chọn kỹ thuật (mình tự quyết, người dùng có thể đổi)

- **Ngôn ngữ:** TypeScript, Node ≥ 22.
- **Monorepo** pnpm với các gói `packages/core` (daemon, hàng đợi, bộ điều phối, kho dữ liệu), `packages/adapters`, `packages/cli`, `packages/web`, `packages/shared` (kiểu sự kiện).
- **Lưu trữ:** SQLite trong thư mục dữ liệu của người dùng, ví dụ `~/.voragent/`.
- **Chạy tiến trình con:** dùng `cross-spawn` hoặc cách tương đương, để Windows gọi được shim `.cmd` mà không cần `sh`.
- **Web:** React + Vite. Văn phòng dùng React Three Fiber (Three.js), đồ thị dùng Sigma.js. Daemon phục vụ bản build sẵn và đẩy sự kiện qua WebSocket.
- **Phân phối:** gói npm `voragent` với lệnh `voragent`.

## 10. Lộ trình

1. **Lõi chạy được:** daemon, CLI, SQLite, hàng đợi, adapter Claude Code và Codex, worktree, nhận diện hết quota và bàn giao, kèm web tối thiểu gồm bảng, dòng thời gian và thanh quota. *Xong giai đoạn này phải chứng minh được G1:* một task bị hết quota trên Claude vẫn được Codex làm xong trong cùng worktree.
1b. **Khám phá dự án** (mục 14): tự nhận ra các dự án đã mở bằng Claude Code và Antigravity, chọn dự án để giao task. Bổ sung sau giai đoạn 1, trước giai đoạn 2.
2. **Văn phòng 3D** nối với sự kiện thật, theo mục 8.1.
3. **Theo dõi phiên tay** qua hook Claude Code, đọc nhật ký phiên Codex, chuyển yêu cầu duyệt quyền lên web.
4. **Mở rộng:** đồ thị và GitNexus, thêm adapter, hiện quota chủ động, chọn agent theo loại việc.

## 11. Rủi ro

- Câu báo hết quota và định dạng stream của các CLI thay đổi theo phiên bản. Cách xử lý: mẫu nhận diện nằm trong adapter, có test bằng output thật, ghi phiên bản CLI đã kiểm.
- Bản bàn giao có thể thiếu ngữ cảnh, khiến agent B làm lại hoặc làm lệch. Cách xử lý: luôn kèm git diff, và cho người dùng xem hoặc sửa bản bàn giao trước khi chạy (tùy chọn).
- Antigravity và một số CLI khác có thể chưa ổn định ở chế độ headless. Phải kiểm tra thực tế trước khi viết adapter.
- Cảnh 3D có nhiều agent có thể nặng. Thân rắn đang dựng lại mỗi khung hình, cần tối ưu khi số agent tăng.

## 12. Các điểm mình tự quyết sau vòng đọc thử

Những điểm dưới đây do mình (người viết tài liệu) quyết. Người dùng có thể đổi.

- **Cách chứng minh G1.** Giai đoạn 1 bắt đầu bằng bước **thu output thật**: mã thoát, stderr và stream khi Claude Code hoặc Codex báo hết quota hoặc bị giới hạn tốc độ. Lấy từ lần gặp thật, từ nhật ký phiên cũ, hoặc từ issue công khai của CLI. Các mẫu thu được làm thành fixture. Test dùng một **CLI giả** phát lại fixture, nên kiểm chứng được việc bàn giao mà không phải làm cạn quota thật. Một lần kiểm thử tay với quota thật là tùy chọn.
- **Duyệt quyền ở giai đoạn 1** (khi chưa có hook):
  - Run tự động trong worktree theo chế độ an toàn của từng CLI. Tool nào CLI tự từ chối thì agent tự xử lý tiếp. Run không dừng, không coi là lỗi.
  - Ở giai đoạn này, cột "Chờ bạn" chỉ dùng cho câu hỏi của agent và cho lượt đã trả lời xong. Task đang chờ nền tảng có quota trở lại nằm ở cột "Chờ". Bước duyệt quyền thật đến giai đoạn 3.
  - Mạng được bật mặc định cho run do voragent giao, để `npm install` và các lệnh tương tự chạy được. Codex bật qua `sandbox_workspace_write.network_access=true`. Người dùng có thể tắt trong cấu hình.
- **Sau khi nền tảng cũ có quota lại.** Task **ở lại nền tảng đang làm cho đến khi xong**, không quay về nền tảng cũ. Chỉ chuyển nữa khi nền tảng hiện tại cũng hết quota. Phiên cũ vẫn được giữ để tra cứu, nhưng không tiếp tục.
- **Vòng đời daemon.**
  - `voragent` chạy daemon ở terminal hiện tại, đóng terminal là daemon dừng.
  - `voragent start --background` chạy daemon dưới nền. Tự khởi động khi đăng nhập máy là việc để sau.
  - Daemon khởi động lại (sau khi tắt, crash hay reboot): run nào đang chạy dở được coi như bị ngắt. Task đó vào lại hàng đợi và tiếp tục bằng **bản bàn giao**, giống như khi hết quota, trên cùng worktree.
- **Quy mô văn phòng 3D.** Mục tiêu là mượt (khoảng 60 khung hình/giây trên laptop thông thường) với **10 agent**. Với **30 agent** thì chạy được nhưng chấp nhận bớt hiệu ứng. Cách dựng lại thân rắn mỗi khung hình như bản thử chỉ dùng được khi đo thấy đạt mục tiêu này.

## 13. Để người xây quyết định

- Lược đồ SQLite cụ thể, thư viện SQLite, cách chia API HTTP / WebSocket.
- Cấu trúc file cấu hình (vị trí, định dạng) và giá trị mặc định (ngưỡng quota, thời gian tạm nghỉ mặc định, số việc chạy song song).
- Cách soạn bản bàn giao chi tiết (mẫu văn bản, giới hạn độ dài).
- Bố cục và thiết kế chi tiết của bảng, dòng thời gian, đồ thị.
- Cách tối ưu hiệu năng của cảnh 3D.
- Bộ test và công cụ build.

## 14. Khám phá dự án (bổ sung 2026-11-05)

Giai đoạn 1 chỉ có ô gõ đường dẫn repo khi tạo task. Thiết kế đúng là voragent **tự nhận ra các dự án người dùng đã từng mở bằng Claude Code, Antigravity (và Codex)**, hiện thành danh sách để người dùng chọn rồi làm việc tiếp, không phải gõ đường dẫn. Người dùng đã chọn phạm vi **A**: chọn dự án để giao task. Xem lịch sử các phiên cũ (phạm vi B) và nối tiếp phiên cũ trong voragent (phạm vi C) không làm ở đây; B thuộc phần theo dõi phiên tay của giai đoạn 3.

### 14.1 Nguồn dữ liệu (đã kiểm trên máy Windows 11 của người dùng, chỉ đọc)

| Nguồn | Nơi đọc | Ghi chú |
| --- | --- | --- |
| Claude Code | Khóa của mục `projects` trong `~/.claude.json` là đường dẫn thật. Thêm `~/.claude/projects/<thư-mục-mã-hóa>/*.jsonl`: mỗi dòng có `cwd`, `sessionId`, `timestamp`; thời gian sửa file mới nhất cho biết lần dùng cuối | Tên thư mục mã hóa mất thông tin (`D---ai-agents-...`), không giải mã ngược: chỉ dùng `cwd` bên trong file. `~/.claude.json` có mục trùng chỉ khác hoa thường hay dấu gạch (`d:/...` và `D:/...`) |
| Antigravity IDE | `%APPDATA%\Antigravity\User\workspaceStorage\*\workspace.json`, trường `folder` dạng `file:///d%3A/Projects/x`; lần dùng cuối là thời gian sửa thư mục con | macOS: `~/Library/Application Support/Antigravity/...`, Linux: `~/.config/Antigravity/...` (theo quy ước VS Code, chưa kiểm) |
| Antigravity CLI `agy` | `~/.gemini/antigravity-cli/conversations` | Chưa biết có ghi đường dẫn dự án không: **chưa làm** |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` | Máy người dùng chưa cài, không kiểm được: **chưa làm**, để lại chỗ cắm |

Quy tắc chung: chỉ đọc đường dẫn và thời gian. Không đọc nội dung hội thoại, không ghi vào thư mục của công cụ khác, không gửi dữ liệu ra ngoài máy.

### 14.2 Mô hình

- `DiscoveredProject { path: string; lastUsedAt: number | null; source: 'claude' | 'antigravity' | 'codex' }`: kết quả thô của một nguồn.
- `Project { id: string; path: string; name: string; lastUsedAt: number | null; sources: ProjectSource[]; isGit: boolean; branch: string | null; dirtyCount: number | null; taskCount: number }`, với `ProjectSource { source; lastUsedAt }`. `id` là mã băm ngắn của đường dẫn đã chuẩn hóa; `name` là tên thư mục cuối.
- Mỗi nguồn là một hàm `discoverXxxProjects(opts)` trả `DiscoveredProject[]`, không bao giờ ném lỗi vì thiếu file (trả mảng rỗng); thêm nguồn mới không phải sửa lõi.

### 14.3 Gộp và lọc (trong daemon)

1. Chuẩn hóa: `realpath` (lấy hoa thường đúng của hệ thống tệp), khóa so sánh viết thường trên Windows. Hai đường dẫn khác chữ hoa hoặc dấu gạch nhưng cùng thư mục là một dự án; `lastUsedAt` lấy giá trị lớn nhất, `sources` gom đủ các nguồn.
2. Bỏ: đường dẫn không còn tồn tại hoặc không phải thư mục; thư mục chính của người dùng; thư mục dữ liệu của công cụ (`~/.claude`, `~/.gemini`, `~/.codex`, `~/.antigravity`, `~/.voragent` và mọi thứ bên trong); mọi thứ nằm trong thư mục dữ liệu của voragent (worktree của task) hoặc trong thư mục tạm của hệ điều hành; gốc ổ đĩa (`C:\`, `/`) và mọi thư mục cha của thư mục chính, thư mục dữ liệu voragent hay thư mục tạm cũng bị bỏ; đường dẫn tương đối bị bỏ.
3. Làm giàu: `isGit`, nhánh hiện tại, số file đang sửa dở (`git status --porcelain`), số task của voragent trên dự án đó. Chạy song song tối đa 4, mỗi lệnh git có giới hạn 3 giây; lỗi hoặc quá giờ thì để `null`, không làm hỏng cả danh sách.
4. Sắp xếp theo `lastUsedAt` giảm dần (không có thì xuống cuối). Kết quả được nhớ 30 giây; `?refresh=1` bỏ qua bộ nhớ đệm.

### 14.4 API, CLI, giao diện

- `GET /api/projects` (cần khóa như mọi route; `?refresh=1`) trả `Project[]`. `POST /api/tasks` vẫn nhận `repoPath`; giao diện điền đường dẫn của dự án đã chọn. Đường dẫn gõ tay vẫn dùng được cho thư mục chưa từng mở bằng công cụ nào.
- CLI: `voragent projects` in bảng (tên, đường dẫn, lần dùng cuối, nguồn, nhánh, số file sửa dở, số task). `voragent add <dự-án-hoặc-đường-dẫn> <tin nhắn…>`: tham số đầu nếu là thư mục tồn tại thì dùng làm đường dẫn; nếu không thì tìm theo tên dự án (khớp chính xác không phân biệt hoa thường, rồi khớp một phần nếu chỉ có một kết quả); trùng thì báo lỗi kèm các đường dẫn ứng viên. Không dùng số thứ tự vì danh sách đổi theo thời gian.
- Giao diện: màn hình đầu là **danh sách dự án** (tên, đường dẫn, lần dùng cuối, huy hiệu công cụ, nhánh, số file sửa dở, số task, huy hiệu "không phải repo git" nếu cần). Bấm một dự án thì vào bảng task của riêng dự án đó, nút "Tạo task" đã chọn sẵn dự án. Form tạo task dùng ô chọn dự án, kèm lựa chọn "Thư mục khác…" để gõ đường dẫn.
- Ô lọc trên danh sách dự án chỉ lọc phía trình duyệt (theo tên và đường dẫn, trên danh sách đã tải), không gọi máy chủ và không lưu lại chữ đã gõ.

### 14.5 Không phải mục tiêu của phần này

Xem hay nối tiếp phiên cũ, ẩn hoặc ghim dự án, nguồn Codex và `agy`, lưu chữ đã gõ vào ô lọc. Có thể thêm sau.
