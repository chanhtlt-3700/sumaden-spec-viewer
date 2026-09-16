# Spec Viewer — 2116-mng

Trình xem đặc tả màn hình (spec) của repo [`framgia/2116-mng`](https://github.com/framgia/2116-mng),
đọc trực tiếp từ `docs/specification`. React + TypeScript + Vite, không cần backend.

Dữ liệu chạy hai tầng: một **snapshot tĩnh** (nhanh, dùng được offline) và một **lớp real-time**
tự phát hiện commit mới trên GitHub rồi vá lại đúng những spec vừa đổi — không cần reload trang.

## Chạy nhanh

```bash
npm install
npm run dev      # mở http://localhost:5180
```

Lần đầu chưa có dữ liệu, app **tự tải spec về** rồi vào thẳng — không phải chạy lệnh nào trước.
Chỉ cần đã `gh auth login` (repo là private). Muốn tải sẵn từ dòng lệnh thì vẫn có
`npm run sync`, nó lấy token theo thứ tự `GITHUB_TOKEN` rồi `gh auth token`.

Build bản tĩnh để chia sẻ nội bộ:

```bash
npm run build    # ra thư mục dist/ (bao gồm cả dữ liệu spec và ảnh)
npm run preview
```

`dist/` dùng hash routing và đường dẫn tương đối nên copy vào bất kỳ thư mục nào trên web server
đều chạy được.

## Lần chạy đầu

Không có `public/data` thì app không báo lỗi mà tự lo liệu:

| Tình huống | App làm gì |
|---|---|
| Đang chạy `npm run dev` | Nhờ dev server chạy `npm run sync` (kèm ảnh) rồi tự reload — không hỏi gì |
| Mở bản `dist/` tĩnh | Xin GitHub token một lần, rồi **tự dựng snapshot ngay trong trình duyệt** |

Bản dựng trong trình duyệt dùng chung parser với script sync, được lưu vào **IndexedDB** nên lần mở
sau không tải lại (đo thực tế: 67 request GitHub lần đầu, 1 request ở lần reload). Ảnh mockup không
có sẵn trên máy thì tải thẳng blob từ GitHub, nên bản tĩnh vẫn xem được đầy đủ.

## Đồng bộ dữ liệu

| Lệnh | Việc làm |
|---|---|
| `npm run sync` | Tải `.md` + ảnh, parse ra JSON |
| `npm run sync -- --no-images` | Bỏ qua 26MB ảnh mockup |
| `npm run sync -- --offline` | Parse lại cache trong `data/raw` (không gọi mạng) |
| `npm run sync -- --clean` | Xoá sạch `data/raw`, `public/data`, `public/spec-images` rồi tải lại từ đầu |

Trỏ sang repo/nhánh/thư mục khác bằng env: `SPEC_REPO`, `SPEC_BRANCH`, `SPEC_PATH`.

Kết quả sinh ra:

- `data/raw/*.md` — cache markdown gốc
- `public/data/index.json` — danh sách spec (metadata nhẹ, dùng cho trang chủ + sidebar)
- `public/data/specs/<slug>.json` — nội dung đầy đủ từng spec
- `public/spec-images/**` — ảnh mockup kèm repo

Các thư mục này đều nằm trong `.gitignore`: dữ liệu spec không commit vào project viewer.

### Dọn cache

- Mỗi lần sync, ảnh nào không còn trên repo sẽ **bị gỡ khỏi máy** (kèm thư mục rỗng), file `.md`
  không còn upstream cũng bị xoá khỏi `data/raw`. Không còn rác tích tụ qua các lần đồng bộ.
- `--clean` xoá sạch rồi dựng lại từ đầu, dùng khi nghi ngờ snapshot hỏng.
- Phía trình duyệt, bố cục bảng đã lưu (độ rộng cột, cột ẩn, chiều cao dòng) cũng là một dạng cache:
  app tự xoá các mục thuộc spec đã biến mất, tự dọn sạch khi bản mới đổi cách tính mặc định, và có
  nút **“Xoá cache bố cục”** trong panel trạng thái. Theme và danh sách ghim (★) không bị đụng tới.

## Real-time

Snapshot được dựng kèm SHA của commit cuối chạm vào `docs/specification`. Khi app đang mở, nó poll
GitHub theo chu kỳ (mặc định 1 phút, chỉnh trong panel trạng thái ở góc phải thanh trên), và:

1. So SHA hiện tại với SHA của snapshot — giống nhau thì dừng, không tốn gì thêm.
2. Khác thì gọi `compare` để biết **chính xác file nào đổi**, chỉ tải lại từng file `.md` đó.
3. Parse lại bằng đúng parser đã dựng snapshot (`shared/spec-parser.mjs`), vá vào store trong bộ nhớ.
4. Sidebar, trang chủ và trang chi tiết đang mở cập nhật tại chỗ; hiện banner liệt kê spec vừa đổi.

Cũng xử lý file mới thêm, file bị xoá, file đổi tên (giữ nguyên slug khi chỉ sửa nội dung, để link
đang mở không chết), và tự quét lại toàn bộ thư mục nếu lịch sử bị force-push.

Ngoài chu kỳ, nó còn kiểm tra khi tab được focus lại — mở máy buổi sáng là thấy ngay bản mới nhất.

### Quyền truy cập

| Tình huống | Kênh | Cần gì |
|---|---|---|
| `npm run dev` | Dev server ký hộ bằng `gh auth` | Không cần gì thêm |
| `dist/` deploy tĩnh | Gọi thẳng api.github.com | Dán GitHub token (scope `repo: read`) vào panel |

Token chỉ nằm trong `localStorage` của trình duyệt đó và chỉ gửi tới `api.github.com`. Dev proxy
(`scripts/gh-proxy-plugin.mjs`) chỉ forward các path thuộc đúng repo đã cấu hình, không phải relay mở.

### Ảnh mockup

Real-time chỉ vá nội dung `.md`. Ảnh nào **mới thêm** thì trang tự tải blob từ GitHub khi file local
không có. Ảnh nào bị **sửa đè** thì bản local vẫn cũ — banner sẽ báo số ảnh đã đổi, bấm
**“Đồng bộ toàn bộ + ảnh”** trong panel để dev server chạy lại `npm run sync` rồi reload.

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
| Chiều cao dòng | `A` tự động · `≡` gọn · `☰` vừa · `▤` đầy đủ |
| Sắp xếp | Click tên cột (tăng → giảm → bỏ) |
| Lọc từng cột | Nút `▾` ở header: lọc theo văn bản hoặc chọn giá trị (có đếm số dòng) |
| Tìm trong bảng | Ô “Tìm trong bảng…”, có tô vàng và đếm số ô khớp |
| Xem đủ nội dung ô | Double-click ô hoặc `Enter` → panel bên phải, có xem cả dòng |
| Xuất | CSV, copy TSV dán thẳng vào Google Sheets, Markdown, JSON — chỉ xuất phần đang hiển thị |
| Toàn màn hình | Nút “⤢ Toàn màn hình” (Esc để thoát) |

Mặc định là **`A` (tự động)**: bảng nào có cột prose — `Description`, `Transition Note`,
`Validation Note`… — thì dòng chạy hết chiều cao, không cắt chữ; bảng chỉ toàn giá trị ngắn thì rút
gọn cho đỡ dài. Ba mức còn lại vẫn ép thủ công được khi cần liếc nhanh. Cột prose cũng được cho rộng
hơn (tối đa 560px) để dòng đầy đủ không bị kéo cao quá mức.

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

Ngoài ra panel trạng thái có nút **“Kiểm tra ngay”** nếu không muốn đợi hết chu kỳ.

## Cấu trúc

```
shared/spec-parser.mjs   parser markdown dùng chung cho Node và browser
shared/gh-node.mjs       token + fetch GitHub phía Node
scripts/sync-specs.mjs   tải + parse -> JSON snapshot
scripts/gh-proxy-plugin.mjs   dev proxy /__gh/* (ký bằng gh auth) + /__gh/resync
src/lib/data.ts          store có subscribe, cache, localStorage
src/lib/storage.ts       dọn cache localStorage (version, orphan, xoá thủ công)
src/lib/github.ts        GitHub client phía browser (proxy hoặc token)
src/lib/live.ts          watcher: poll -> diff -> parse lại -> vá store
src/lib/text.tsx         fold không dấu, highlight, render nội dung ô
src/lib/export.ts        CSV / TSV / Markdown / JSON / clipboard
src/components/SheetTable.tsx      bảng kiểu spreadsheet
src/components/CommandPalette.tsx  tìm kiếm toàn cục
src/components/LiveStatus.tsx      panel trạng thái real-time
src/pages/HomePage.tsx, SpecPage.tsx
```

Parser nhận diện bảng markdown (kể cả `\|` escape), ảnh, và mọi heading `##`, nên khi spec upstream
thêm section mới thì viewer tự render — không cần sửa code. Vì snapshot và real-time dùng **chung một
parser**, nội dung vá lúc chạy luôn khớp với nội dung dựng sẵn.
