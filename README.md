# voragent

voragent là chương trình chạy trên máy của bạn. Nó điều phối nhiều coding agent CLI (Claude Code, Codex, ...),
tự chuyển việc sang nền tảng khác khi một nền tảng hết quota, và cho bạn theo dõi mọi việc qua một giao diện web
cục bộ. Mỗi task chạy trong một git worktree riêng (nhánh `voragent/task-N`), không bao giờ sửa thư mục làm việc
chính của bạn và không tự merge.

Thiết kế chi tiết: [docs/superpowers/specs/2026-11-04-voragent-design.md](docs/superpowers/specs/2026-11-04-voragent-design.md).

## Cài đặt và chạy

Cần Node 22.13 trở lên, pnpm và git. Chạy thẳng trên Windows, không cần WSL.

```bash
pnpm install
pnpm -r build
node packages/cli/dist/src/main.js
```

Lệnh cuối khởi động daemon ngay trong terminal, in URL đầy đủ (có khóa truy cập) và mở trình duyệt.
Muốn dùng lệnh `voragent` ở mọi nơi, chạy `pnpm link --global` trong thư mục `packages/cli`.
Giao diện web (`packages/web`, React + Vite) được build ra `packages/web/dist` và daemon tự phục vụ ở trang gốc:
bảng task theo cột, thanh quota các nền tảng, trò chuyện/dòng thời gian của từng task và form tạo task. Chưa build web
thì trang gốc chỉ báo "chưa được build", còn API và các lệnh dưới đây vẫn dùng được.

## Các lệnh

| Lệnh | Việc làm |
| --- | --- |
| `voragent [--port N] [--no-open]` | Chạy daemon trong terminal, in URL kèm khóa, mở trình duyệt (trừ khi có `--no-open`). Ctrl-C lần một dừng có trật tự và chờ các lượt đang chạy xong; Ctrl-C lần hai (hoặc SIGTERM) dừng cứng: giết các lượt đang chạy rồi thoát, chờ tối đa khoảng 5 giây. |
| `voragent start --background` | Chạy daemon nền, ghi log vào `daemon.log`, in URL rồi thoát. |
| `voragent add <repoPath> <tin nhắn...> [--mode m] [--agent id]` | Tạo task mới. `--mode` là một trong `head-dirty-commit`, `head-commit`, `dirty-nocommit`. `--agent id` chỉ cho task dùng đúng nền tảng đó. Nếu `<repoPath>` không phải repo git, lệnh in cảnh báo không cách ly ra stderr (xem mục "Chế độ workspace") nhưng vẫn tạo task và thoát mã 0. |
| `voragent status` | Bảng các nền tảng (đã cài, tạm nghỉ đến lúc nào, đã dùng bao nhiêu phần trăm) và các task chưa đóng. |
| `voragent stop [--force]` | Dừng daemon đang chạy. Mặc định chờ các lượt đang chạy xong (có thể rất lâu, tới `turnTimeoutMs`); `--force` dừng ngay các lượt đó (xem mục "Dừng daemon"). |

Khi chưa có daemon, `add`, `status` và `stop` in `Daemon chưa chạy. Chạy: voragent` rồi thoát với mã 1.

## Thư mục dữ liệu

Mặc định là `~/.voragent`; đặt biến môi trường `VORAGENT_HOME` để đổi.

```text
~/.voragent/
  config.json     cấu hình (không bắt buộc)
  voragent.db     cơ sở dữ liệu SQLite: task, lượt, run, sự kiện, trạng thái nền tảng
  daemon.json     {port, key, pid} của daemon đang chạy; các lệnh add/status/stop đọc file này
  daemon.log      log của daemon chạy nền
  worktrees/      git worktree của từng task
```

## Chế độ workspace

Với repo git, mỗi task có một worktree riêng; chế độ (`--mode` hoặc `defaultMode`) quyết định cách khởi tạo và commit:

| Chế độ | Ý nghĩa |
| --- | --- |
| `head-dirty-commit` | Từ HEAD, mang theo việc dở chưa commit (commit riêng ở đầu nhánh), agent tự commit. |
| `head-commit` | Chỉ từ HEAD, agent tự commit. |
| `dirty-nocommit` | Mang theo việc dở, không commit gì. |

**Thư mục không phải repo git thì không có cách ly.** voragent không tạo được worktree nên agent làm việc trực tiếp
trong thư mục bạn chỉ định (Claude chạy với `--permission-mode auto`): không có nhánh, không có commit, không hoàn tác được.
Giao diện web gắn nhãn "không cách ly" trên thẻ và trong chi tiết task, form tạo task có ghi chú, và `voragent add`
in cảnh báo ra stderr. Hãy đặt thư mục dưới git trước khi giao việc quan trọng.

## Dừng daemon

- Dừng êm (Ctrl-C lần một, `voragent stop`): ngừng nhận lượt mới và chờ các lượt đang chạy xong.
- Dừng cứng (Ctrl-C lần hai, SIGTERM, `voragent stop --force`, hoặc `POST /api/shutdown` với body `{"force": true}`):
  giết các lượt đang chạy cùng cây tiến trình con, commit phần dở (ở chế độ có commit), đánh dấu run `interrupted`, đưa
  lượt và task về hàng đợi và không khởi động lượt mới. Lần chạy daemon sau, lượt đó chạy lại với bản bàn giao (lý do "daemon bị ngắt").
- Giới hạn: nếu chính tiến trình daemon bị giết từ ngoài (`taskkill /F`, crash, mất điện) thì các tiến trình agent đang chạy có
  thể còn sống và vẫn ghi vào worktree. Khi khởi động lại, `recover()` chỉ đọc nhật ký sự kiện để xếp lại lượt, không tìm và giết
  tiến trình mồ côi. Kiểm tra và tắt thủ công các tiến trình `claude`/`codex` còn sót trước khi khởi động lại.

## Cấu hình `config.json`

Mọi trường đều không bắt buộc; thiếu thì dùng giá trị mặc định. Sai kiểu hoặc sai miền giá trị thì daemon từ chối
khởi động và nói rõ trường nào sai.

| Trường | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `priority` | `["claude", "codex"]` | Thứ tự ưu tiên các nền tảng; cũng là danh sách nền tảng daemon nạp. |
| `port` | `4717` | Cổng HTTP/WebSocket (chỉ nghe trên `127.0.0.1`). |
| `concurrency` | `{"perProvider": 2, "total": 4}` | Số lượt chạy song song tối đa cho mỗi nền tảng và cho toàn bộ. |
| `quotaThreshold` | `0.9` | Nền tảng đã dùng quá tỉ lệ này (0 đến 1) thì không nhận lượt mới. |
| `defaultCooldownMs` | `3600000` | Thời gian nghỉ khi hết quota mà CLI không báo lúc nào hồi lại (mili giây). |
| `turnTimeoutMs` | `1800000` | Quá thời gian này một lượt bị coi là lỗi (mili giây). |
| `network` | `true` | Cho phép agent dùng mạng. |
| `defaultMode` | `"head-dirty-commit"` | Chế độ workspace mặc định của task. |
| `handoffMaxChars` | `24000` | Độ dài tối đa của bản bàn giao gửi cho nền tảng kế tiếp. |

## Bàn giao khi hết quota

1. Một lượt chạy trên nền tảng A thì hết quota; voragent commit phần dở dang vào nhánh của task và cho A nghỉ.
2. Task quay lại hàng đợi, bộ lập lịch chọn nền tảng kế tiếp trong `priority` còn quota.
3. voragent tự soạn bản bàn giao: yêu cầu ban đầu, các tin nhắn, kết quả các lượt trước, tóm tắt thay đổi git trong worktree.
4. Nền tảng B mở phiên mới trong cùng worktree, nhận bản bàn giao kèm tin nhắn hiện tại và làm tiếp.
5. Task không quay về nền tảng cũ; nếu B cũng hết quota thì chuyển tiếp nữa, hoặc chờ khi không còn nền tảng nào.

## Bảo mật cục bộ

Daemon chỉ nghe trên `127.0.0.1`, từ chối yêu cầu có `Host` không phải `localhost` hay `127.0.0.1`, và mọi route
(kể cả WebSocket) cần khóa ngẫu nhiên in trong URL. Khóa chuyển qua header `x-voragent-key`, tham số `?key=` hoặc
cookie `voragent_key`. Khóa nằm trong `daemon.json`: đừng chia sẻ file này.

## Phát triển

Biến môi trường `VORAGENT_FAKE=1` (chỉ để phát triển và kiểm thử) làm daemon nạp hai adapter giả thay cho Claude Code và
Codex: `fake-a` luôn báo hết quota, `fake-b` luôn chạy ổn. Nếu `config.json` chưa đổi `priority` thì thứ tự ưu tiên là
`["fake-a", "fake-b"]`. Nhờ đó xem được cả vòng đời trên giao diện web (thẻ đi qua Chờ, Đang chạy, Chờ bạn, vạch bàn giao,
ô `fake-a` tạm nghỉ) mà không tốn quota thật:

```bash
pnpm -r build
VORAGENT_FAKE=1 VORAGENT_HOME=/duong/dan/tam node packages/cli/dist/src/main.js
```

Trên PowerShell: `$env:VORAGENT_FAKE = "1"` rồi chạy lệnh `node` như trên.

## Đã kiểm với

- voragent: commit `20429be` (nhánh `feat/phase1-core`), kiểm ngày 2026-11-04.
- Hệ điều hành: Windows 11 Pro (10.0.26100), Git Bash. Node v22.14.0.
- Claude Code: 2.1.312.
- Codex: chưa kiểm — chưa cài trên máy kiểm thử.

Cách kiểm: một repo thử dùng một lần (một commit, một file đã sửa chưa commit, một file chưa theo dõi), `VORAGENT_HOME` trỏ vào
thư mục tạm, cổng ngẫu nhiên, cấu hình mặc định, một task hai lượt trên Claude thật. `pnpm -r build`, `pnpm -r typecheck` và
toàn bộ test (189) đều qua trước khi chạy.

Đã kiểm:

- ✔ `voragent status`: claude "có" cài, codex "không" (`GET /api/providers` cho claude `version` là `2.1.312`).
- ✔ Worktree `$VORAGENT_HOME/worktrees/task-1` được tạo; Claude chạy trong đó (các lệnh Bash của Claude đều `cd` vào đường dẫn này).
- ✔ Thư mục gốc của repo thử không đổi: `git status --short`, nội dung file sửa dở, file chưa theo dõi và HEAD giống hệt trước và sau cả hai lượt.
- ✔ Nhánh `voragent/task-1` có `voragent: mang theo thay đổi chưa commit`, `voragent: lượt 0 (claude)`, `voragent: lượt 1 (claude)`; file sửa dở và file chưa theo dõi có mặt trong worktree.
- ✔ Dòng sự kiện có `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_RESULT`, `TEXT_MESSAGE_CONTENT`, `USAGE`, `QUOTA_UPDATED`.
- ✔ `QUOTA_UPDATED.usedPercent` thật là `0.62` (lượt 0) rồi `0.63` (lượt 1), đúng dạng phân số 0..1 mà bộ lập lịch cần; `resetsAt` là mili giây (`1793810400000`); `GET /api/providers` hiện `usedPercent` của claude.
- ✔ Lượt thứ hai (`POST /api/tasks/<id>/messages`) tiếp tục cùng phiên: `RUN_STARTED` của lượt 1 mang đúng `sessionId` của lượt 0, dòng thời gian có hai lượt `done`, Claude nhớ dòng đã thêm.
- ✔ Dòng "xin chào" được thêm ở lượt 0 và xóa ở lượt 1 trong worktree.

Chưa kiểm:

- Codex (chưa cài, không cài global), kể cả cấu hình `priority` đặt codex lên đầu.
- Hết quota thật và bàn giao sang nền tảng khác với CLI thật (không gặp hết quota; `claude-quota.jsonl` và các fixture hết quota khác của Claude, kể cả các cách nói rộng hơn và `rate_limit_event` bị từ chối, vẫn là bản dựng tay).
- Dừng cứng, `voragent stop --force`, cảnh báo không cách ly: chỉ kiểm bằng test tự động với CLI giả, chưa chạy lại với Claude thật sau commit `20429be`.
- Giao diện web trong trình duyệt thật (chỉ kiểm qua REST API, không có trình duyệt).
- POSIX (Linux, macOS).
- Cờ `--resume` được suy ra từ `sessionId` không đổi và việc Claude nhớ ngữ cảnh, không đọc trực tiếp tham số dòng lệnh (sự kiện không ghi lại).
- `FILE_CHANGED` với Claude thật (xem điểm lạ bên dưới).

Điểm lạ ghi nhận (không sửa trong lần kiểm này):

- `voragent status` có cột "Đã cài" nhưng không in phiên bản (phiên bản chỉ có ở `GET /api/providers`).
- Claude dùng công cụ Bash (`echo >>`, `sed -i`) thay vì Edit/Write nên không có sự kiện `FILE_CHANGED` trong lần chạy này.
- Hai lượt dùng chung một bản ghi run (`runs` có một dòng, `endedAt` cập nhật theo lượt cuối); `RUN_STARTED` của lượt 0 có `sessionId: null` vì phiên chỉ biết sau khi CLI trả về.
- Tin nhắn lượt 1 lưu thành "Gi? x�a d�ng..." vì lệnh `curl` trên Windows gửi byte không phải UTF-8 (lỗi của lệnh kiểm, chưa kết luận là lỗi của voragent); Claude vẫn hiểu. Tiếng Việt qua API với UTF-8 chuẩn chưa được kiểm lại.
