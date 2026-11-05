# Fixtures của adapter

- `fake-*.jsonl`: dựng tay cho fake adapter (Task 3).
- `claude-ok.jsonl`, `claude-tools.jsonl`: BẢN THẬT, thu bằng Claude Code 2.1.312
  (`claude -p --output-format stream-json --include-partial-messages --verbose`),
  đã làm sạch: đường dẫn máy, session id, uuid đổi thành giá trị giả; bỏ danh sách tool/skill/MCP
  dài, khối thinking và hook. Giữ đủ các khoá mà parser đọc.
- `claude-quota.jsonl`: DỰNG TAY (không gặp được thông báo hết quota thật). Lấy phần đầu của
  `claude-ok.jsonl`, dòng `result` thay bằng `is_error: true` và
  `"Claude AI usage limit reached|1762250400"`. Cần thay bằng bản thật khi gặp (CLI 2.1.312 là bản
  dùng để thu các bản thật).
- `claude-mentions-limit.jsonl`: dựng từ `claude-ok.jsonl`; câu trả lời chứa "usage limit reached"
  nhưng `is_error: false`. Dùng để chứng minh adapter không đọc chữ trong câu trả lời.
- `codex-ok.jsonl`, `codex-tools.jsonl`, `codex-quota.jsonl`, `codex-mentions-limit.jsonl`: DỰNG TAY
  cả bốn, theo định dạng JSONL mà parser Codex trong `agui.ts` của TipTask runner đọc
  (`thread.started`, `item.started`/`item.completed`, `turn.completed`, `error`). KHÔNG đối chiếu với
  Codex CLI thật (chưa cài trên máy dev, không cài global); phiên bản Codex: chưa biết. Id và đường dẫn
  là giá trị giả (`s-demo-1`, `C:\work\demo`). Cần thay bằng bản thu thật khi cài được Codex.
  `codex-mentions-limit` có câu trả lời chứa "usage limit" nhưng không có sự kiện lỗi, để chứng minh
  adapter không đọc chữ trong câu trả lời.
- `claude-quota-hit-limit.jsonl`, `claude-quota-limit-reached.jsonl`, `claude-quota-usage-limit.jsonl`: DỰNG TAY từ
  `claude-quota.jsonl`, chỉ đổi chữ của dòng `result` (`is_error: true`) sang các cách nói khác của thông báo hết quota
  ("You've hit your limit · resets 3pm", "Weekly limit reached ∙ resets Nov 9", "Your usage limit has been exceeded").
  Chưa gặp bản thật; mục đích là chứng minh các mẫu rộng hơn vẫn chỉ áp cho nguồn báo lỗi.
- `claude-quota-rejected.jsonl`: DỰNG TAY từ `claude-quota.jsonl`. Dòng `rate_limit_event` đổi `status` (cả ở `rate_limit_info`
  lẫn ở cửa sổ `five_hour`) từ `allowed` sang `rejected` với `utilization: 1`; dòng `result` là lỗi không khớp mẫu chữ nào.
  Giá trị `rejected` suy từ `overageStatus: "rejected"` có trong bản thật; chưa gặp sự kiện bị từ chối thật.
- `fake-quota-tools.jsonl`: dựng tay cho fake adapter: một dòng `tool` (Edit a.txt), một câu trả lời, rồi hết quota. Dùng để chứng minh
  danh sách việc đã làm và câu trả lời cuối của agent trước đi vào bản bàn giao.
