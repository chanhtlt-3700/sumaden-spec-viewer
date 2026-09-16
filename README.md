# Spec Viewer — 2116-mng

Trình xem đặc tả màn hình (spec) của repo [`framgia/2116-mng`](https://github.com/framgia/2116-mng),
đọc trực tiếp từ `docs/specification`. React + TypeScript + Vite, không cần backend.

## Chạy nhanh

```bash
npm install
npm run sync     # tải spec + ảnh mockup từ GitHub (cần quyền đọc repo)
npm run dev      # mở http://localhost:5180
```

`npm run sync` lấy token theo thứ tự: biến môi trường `GITHUB_TOKEN`, sau đó `gh auth token`
(cần `gh auth login` trước). Repo là private nên bước này bắt buộc.

Build bản tĩnh để chia sẻ nội bộ:

```bash
npm run build    # ra thư mục dist/ (bao gồm cả dữ liệu spec và ảnh)
npm run preview
```

`dist/` dùng hash routing và đường dẫn tương đối nên copy vào bất kỳ thư mục nào trên web server
đều chạy được.

## Đồng bộ dữ liệu

| Lệnh | Việc làm |
|---|---|
| `npm run sync` | Tải `.md` + ảnh, parse ra JSON |
| `npm run sync -- --no-images` | Bỏ qua 26MB ảnh mockup |
| `npm run sync -- --offline` | Parse lại cache trong `data/raw` (không gọi mạng) |

Trỏ sang repo/nhánh/thư mục khác bằng env: `SPEC_REPO`, `SPEC_BRANCH`, `SPEC_PATH`.

Kết quả sinh ra:

- `data/raw/*.md` — cache markdown gốc
- `public/data/index.json` — danh sách spec (metadata nhẹ, dùng cho trang chủ + sidebar)
- `public/data/specs/<slug>.json` — nội dung đầy đủ từng spec
- `public/spec-images/**` — ảnh mockup kèm repo

Các thư mục này đều nằm trong `.gitignore`: dữ liệu spec không commit vào project viewer.

## Tính năng

**Danh sách**

- Dashboard: số màn hình, tổng item, số ảnh mockup, ngày cập nhật gần nhất
- Bảng tổng hợp sắp xếp được theo mọi cột, tìm nhanh, xuất CSV
- Sidebar lọc theo tên/ID, sắp xếp, ghim (★) spec hay dùng

**Chi tiết spec**

- Metadata (phase, version, doc no, người tạo…), link Figma và GitHub
- Ảnh mockup dạng gallery, click để phóng to (zoom, ← →, Ctrl + cuộn)
- Mọi section trong file `.md` đều được render: Overview, Notes, History, câu hỏi chưa chốt…
- **Liên kết màn hình**: các màn được nhắc tới trong spec và các spec khác trỏ ngược về màn này
- Tải lại file `.md`, copy link, ghim

**Bảng Items (kiểu Google Sheet)**

| Thao tác | Cách dùng |
|---|---|
| Ghim cột trái | Nút `0 / 1 / 2 / 3` trên thanh công cụ |
| Đổi rộng cột | Kéo mép phải header; menu cột → “Vừa nội dung” |
| Ẩn/hiện cột | Nút “Cột (n/20)”, có sẵn preset Cơ bản / Điều hướng / Dữ liệu & validate / Database |
| Ẩn cột rỗng | Trong menu “Cột” |
| Chiều cao dòng | `≡` gọn · `☰` vừa · `▤` đầy đủ |
| Sắp xếp | Click tên cột (tăng → giảm → bỏ) |
| Lọc từng cột | Nút `▾` ở header: lọc theo văn bản hoặc chọn giá trị (có đếm số dòng) |
| Tìm trong bảng | Ô “Tìm trong bảng…”, có tô vàng và đếm số ô khớp |
| Xem đủ nội dung ô | Double-click ô hoặc `Enter` → panel bên phải, có xem cả dòng |
| Xuất | CSV, copy TSV dán thẳng vào Google Sheets, Markdown, JSON — chỉ xuất phần đang hiển thị |
| Toàn màn hình | Nút “⤢ Toàn màn hình” (Esc để thoát) |

Bố cục cột, độ rộng, chiều cao dòng và số cột ghim được nhớ trong `localStorage`.

**Tìm kiếm toàn cục** — `Ctrl/Cmd + K` hoặc `/`

Tìm xuyên 63 spec và 1369 item cùng lúc: tên màn, mô tả, ghi chú chuyển màn, tên bảng/cột DB…
Không dấu vẫn ra kết quả có dấu (`nguoi gui` → `người gửi`), và tìm được cả tiếng Nhật.

**Phím tắt**

| Phím | Tác dụng |
|---|---|
| `Ctrl/Cmd + K`, `/` | Mở tìm kiếm toàn cục |
| `↑ ↓ ← →` | Di chuyển ô trong bảng |
| `Enter` | Mở panel chi tiết ô |
| `Ctrl/Cmd + C` | Copy ô đang chọn |
| `Esc` | Đóng panel / lightbox / toàn màn hình |

## Cấu trúc

```
scripts/sync-specs.mjs   tải + parse markdown -> JSON
src/lib/data.ts          nạp dữ liệu, cache, localStorage
src/lib/text.tsx         fold không dấu, highlight, render nội dung ô
src/lib/export.ts        CSV / TSV / Markdown / JSON / clipboard
src/components/SheetTable.tsx   bảng kiểu spreadsheet
src/components/CommandPalette.tsx  tìm kiếm toàn cục
src/pages/HomePage.tsx, SpecPage.tsx
```

Parser nhận diện bảng markdown (kể cả `\|` escape), ảnh, và mọi heading `##`, nên khi spec upstream
thêm section mới thì viewer tự render — không cần sửa code.
