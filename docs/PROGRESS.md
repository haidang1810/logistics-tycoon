# Tiến độ dự án

> Tài liệu tổng hợp: đã brainstorm gì, đã chốt gì, đã làm tới đâu, còn làm gì và theo thứ tự nào, đang có asset nào.
> Thiết kế gameplay chi tiết nằm ở [GDD.md](GDD.md), kiến trúc code ở [ARCHITECTURE.md](ARCHITECTURE.md).
> Cập nhật lần cuối: 2026-10-09.

---

## 1. Brainstorm và các quyết định đã chốt

### 1.1 Bốn hướng gameplay đã cân nhắc

| Hướng | Mô tả | Kết quả |
|---|---|---|
| A. Mini Logistics | Puzzle tối giản kiểu Mini Motorways: vẽ đường, ván 15–30 phút | ❌ Quá đơn giản so với mong muốn |
| B. Tycoon | Điều hành công ty logistics kiểu OpenTTD rút gọn: hợp đồng, đội xe, kho, tài chính | ✅ Chọn, kết hợp với D |
| C. Trung tâm phân loại | Tối ưu băng chuyền bên trong kho kiểu Shapez | ❌ Không chọn |
| D. Roguelite | Mỗi ván là một bản đồ, chọn thẻ cuối tháng, có sự kiện, mở khóa giữa các ván | ✅ Chọn, kết hợp với B |

**Đã chốt: Tycoon + Roguelite (B + D).** Cấu trúc tham khảo *Against the Storm*: mỗi tỉnh là một ván 60–90 phút, bản đồ Việt Nam là tầng tiến trình giữa các ván.

### 1.2 Công nghệ: Web hay Godot

Đã so sánh **TypeScript + Three.js + React** với **Godot (có MCP)** cho trường hợp Claude viết toàn bộ code.

**Đã chốt: TypeScript + Three.js + React.** Lý do:
- Khoảng 70% công sức của game tycoon nằm ở giao diện, giả lập và cân bằng kinh tế. HTML/CSS/React mạnh nhất cho giao diện nhiều bảng biểu.
- Claude tự kiểm tra được ngay bằng trình duyệt tích hợp. Các MCP cho Godot đều do cộng đồng viết, nhiều bản khác nhau, và cần mở sẵn editor.
- Claude thạo TypeScript nhất, và người dùng là dev web nên đọc hiểu được code.
- Lõi giả lập viết bằng JS chạy nhanh hơn GDScript.

Điểm yếu đã biết và chấp nhận:
- Đóng gói Steam qua Electron: file nặng, Steam Overlay cần mẹo.
- Gần như không thể lên console.
- Đồ họa đẹp phải tự lắp ghép thay vì có sẵn như Godot.

Phương án dự phòng nếu sau này đổi ý: Godot + C#.

### 1.3 Các quyết định khác

| Mục | Đã chốt |
|---|---|
| Bối cảnh, tông | Việt Nam, vui và ấm áp (cozy) |
| Ngôn ngữ giao diện | Tiếng Việt + tiếng Anh ngay từ đầu |
| Mục tiêu | Dự án cá nhân, chuyện bán tính sau |
| Nền tảng | PC. Chạy trên trình duyệt khi phát triển, sau này đóng gói Electron cho Steam |
| Chế độ chơi | Chỉ chơi đơn |
| Phân vai | Claude viết toàn bộ code. Người dùng làm game designer, chơi thử và quản lý dự án |
| Tông ấm áp và roguelite | Thua ván không mất trắng. Thanh áp lực là "Lòng tin bà con". Có chế độ thư thái không áp lực |

### 1.4 Phạm vi cắt giảm để làm xong được
- Bản đầu chỉ có đường bộ. Đường sông chỉ có ở tỉnh miền Tây. Không có đường sắt và hàng không.
- Đối thủ là một hệ thống áp lực thị phần, không phải AI đầy đủ.
- Bản đồ dạng lưới ô vuông, xe không có vật lý, tắc nghẽn mô phỏng bằng hàng đợi.

---

## 2. Đã làm tới đâu

### 2.1 M0: Prototype ✅ (commit `7fa8545`)
- Khung dự án: Vite, React 19, Three.js, TypeScript, Vitest.
- **Lõi giả lập** (`src/sim`): TypeScript thuần, chạy theo nhịp cố định 20 tick/giây, cùng seed thì cùng kết quả.
  - Bản đồ 48×48 sinh theo seed: sông, rừng, 3 thị trấn, 4 ruộng, 2 vườn, 2 nhà máy xay.
  - Chuỗi cung ứng: lúa → nhà máy xay → gạo → chợ, và trái cây → chợ.
  - Xây đường và cầu, phá đường được hoàn 50%.
  - Xe tìm đường bằng A*, tự tìm lại đường khi mạng lưới đường thay đổi.
  - Hợp đồng: lời mời mới mỗi 10 ngày, có hạn chót, thưởng và phạt.
  - Kinh tế: tiền tính bằng nghìn đồng, phí chạy xe mỗi ngày, doanh thu tăng theo quãng đường.
- **Giao diện:** thanh trên cùng (tiền, ngày, tốc độ, nút đổi ngôn ngữ), thanh công cụ (phím 1–4), bảng hợp đồng, đội xe, tin tức, thẻ thông tin, gợi ý thao tác, thông báo lỗi.
- **Điều khiển:** kéo chuột trái để làm hoặc phá đường theo hình chữ L, bấm 2 điểm để mở tuyến xe. Camera: chuột phải để di chuyển, chuột giữa để xoay, lăn chuột để phóng to, hoặc WASD. Space để tạm dừng.
- 7 test giả lập.

### 2.2 Nâng cấp đồ họa lần 1 ✅ (commit `b7570a9`)
- Ghép bộ KayKit City Builder Bits: đường tự chọn mảnh thẳng, cua, ngã ba, ngã tư, vạch qua đường. Thêm nhà phố, xe con, đèn đường.
- Hậu kỳ: đổ bóng góc khuất (GTAO), làm mờ kiểu mô hình thu nhỏ (tilt-shift), viền tối nhẹ, ánh sáng ấm.
- Thêm màn hình chờ tải model.
- Thêm công cụ chụp màn hình khi phát triển: `game.debugShot('ten')` lưu ảnh vào `.shots/`.

### 2.3 Nâng cấp đồ họa lần 2 ✅ (commit `fa04e70`)
- Forest Pack: cây, bụi, đá, cỏ, chỉnh cỡ theo kích thước thật của từng model.
- Medieval Pack:
  - Cối xay gió, hoặc cối xay nước nếu gần sông.
  - Chợ quê.
  - Ruộng lúa vàng, chòi tranh, xe cút kít.
  - Nhà làng mái ngói ở vùng ven thị trấn.
  - Lá súng và cây thủy sinh trên sông.
- ResourceBits: đống hàng ở kho cao thấp theo lượng tồn, hàng hiện trên nóc xe theo loại đang chở.
- Thêm trang xem trước model: `debug-models.html`.

### 2.4 Hạn chế hiện tại
- Chưa có người chơi thử nào. **Chưa biết gameplay có vui không.** Đây là câu hỏi quan trọng nhất của M0.
- Số liệu kinh tế mới là ước đoán.
- Chưa có tắc đường, chưa lưu được game, chưa có thanh "Lòng tin bà con".
- Xe chở hàng tạm dùng xe con, vì bản KayKit miễn phí không có xe tải.
- Chưa đo hiệu năng trên máy yếu. Hiệu ứng đổ bóng góc khuất và làm mờ khá nặng.
- Đồi núi (Medieval Pack) đã chép vào dự án nhưng chưa dùng, vì nền lục giác màu cỏ vàng lệch tông.

---

## 3. Việc tiếp theo, theo thứ tự ưu tiên

### Bước 0: Chơi thử M0 (người dùng làm, ưu tiên cao nhất)
Chơi 10–15 phút rồi trả lời:
1. Làm đường và mở tuyến xe có vui không? Thao tác chỗ nào khó chịu?
2. Tiền dư quá hay thiếu quá? Đến phút thứ mấy thì hết việc để làm?
3. Đồ họa và giao diện đã đúng tông ấm áp chưa?

Kết quả chơi thử quyết định M1 làm gì trước. **Không nên làm M1 khi chưa có phản hồi này.**

### Bước 1: Hoàn thiện nhỏ trước M1
- [ ] Tùy chọn chất lượng đồ họa (bật/tắt đổ bóng góc khuất và làm mờ) nếu máy bị giật.
- [ ] Lưu và tải game: lưu `WorldState` vào localStorage.
- [ ] Cân bằng lại kinh tế theo phản hồi chơi thử.
- [ ] Credits ghi công Kay Lousberg (KayKit).

### Bước 2: M1, lõi tycoon
- [ ] **Tắc nghẽn:** nhiều xe trên một ô đường thì chậm lại, để "mua thêm xe" không giải quyết được mọi thứ.
- [ ] Kho trung chuyển: gom hàng về kho trung tâm rồi chia đi.
- [ ] Nhiều loại xe: xe máy, xe tải nhỏ, xe tải lớn, khác nhau về tốc độ, sức chứa và chi phí.
- [ ] Thêm loại hàng: gỗ, ván, xăng dầu, vải, gạch (đã có model trong ResourceBits).
- [ ] Hàng tươi bị hỏng theo thời gian.
- [ ] Báo cáo tài chính theo tháng, biểu đồ.
- [ ] Giao diện quản lý tuyến: sửa tuyến, đổi xe, xem lợi nhuận từng tuyến.

### Bước 3: M2, lớp roguelite
- [ ] Thanh "Lòng tin bà con" và điều kiện thắng/thua của một ván.
- [ ] Thẻ cuối tháng, chọn 1 trong 3: hợp đồng lớn, nâng cấp, nhân sự, chính sách.
- [ ] Sự kiện: mưa ngập cắt đường, cao điểm Tết, giá xăng tăng, cấm tải, cầu hỏng.
- [ ] Chế độ thư thái (không có thanh áp lực).

### Bước 4: M3, tầng tiến trình và nội dung
- [ ] Bản đồ Việt Nam, chọn tỉnh.
- [ ] 3–4 tỉnh, mỗi tỉnh có cơ chế riêng: Sài Gòn/Hà Nội (hẻm, xe máy), miền Tây (đường sông), Tây Bắc (đèo), Hải Phòng (cảng).
- [ ] Mở khóa xe, nâng cấp trụ sở giữa các ván.

### Bước 5: M4, hoàn thiện
- [ ] Asset đậm chất Việt Nam: xe tải, xe máy, nhà ống, ghe, sà lan.
- [ ] Âm thanh và nhạc.
- [ ] Hướng dẫn chơi.
- [ ] Chuyển lõi giả lập vào Web Worker nếu bị chậm.
- [ ] Đóng gói Electron, đưa lên Steam.

---

## 4. Asset

Tất cả đều của **Kay Lousberg (KayKit)**, giấy phép **CC0**: dùng tự do kể cả thương mại, không bắt buộc ghi công nhưng nên ghi. Chỉ chép những model thực sự dùng vào `public/models/`. Các file zip gốc nằm ở thư mục gốc dự án và không được đưa lên git.

| Gói | Thư mục | Đang dùng | Còn trong gói, chưa dùng |
|---|---|---|---|
| **City Builder Bits** | `public/models/kaykit/` | Đường (thẳng, vạch qua đường, cua, ngã ba, ngã tư), nền vỉa hè, 8 tòa nhà phố, 4 xe con (sedan, hatchback, station wagon, taxi), ghế, đèn đường | Đã nạp nhưng chưa đặt lên bản đồ: thùng rác lớn, trụ cứu hỏa. Còn trong thư mục: xe cảnh sát, đèn giao thông, bồn nước, thùng giấy, bụi cây, nhà không có nền |
| **Forest Nature Pack** | `public/models/forest/` | 10 cây, 5 bụi, 3 đá, 2 cỏ | Còn khoảng 80 model: cây khô, nhiều đá, bụi và cỏ khác. Muốn dùng thì chép thêm từ zip |
| **Medieval Hexagon Pack** | `public/models/medieval/` | Cối xay gió, cối xay nước, 4 nhà làng, chợ, ruộng lúa, hàng rào gỗ, lá súng, cây thủy sinh, bao tải, thùng gỗ, thùng tô nô, xe cút kít | Đã chép nhưng chưa dùng: đồi, núi, mây, giếng, pallet, nền đất. Trong zip còn: ô đất/sông/đường lục giác, lâu đài, tháp, quân sự |
| **Resource Bits** | `public/models/resources/` | Bao gạo (`Textiles_B`) | Đã chép nhưng chưa dùng: pallet gỗ, pallet phủ bạt, vải, thùng xăng, chồng gỗ khúc. Trong zip còn: ván gỗ, gạch đá, thỏi kim loại, quặng, bánh răng, can xăng |
| **Block Bits** | (không dùng) | Không dùng | Khối lập phương kiểu Minecraft, lệch phong cách |

**Asset còn thiếu cho chất Việt Nam:** xe tải, xe máy, xe ba gác, nhà ống, ghe, sà lan, nón lá, cây dừa, cây chuối. Có thể mua bản KayKit trả phí, tìm gói CC0 khác, hoặc tự dựng bằng code.

Các model tự dựng bằng code: chòi tranh, mặt đất, nước, đế mô hình bản đồ, trụ cầu, trái cây trên cây vườn.

---

## 5. Cách làm việc

- Chạy game: `npm run dev` rồi mở http://localhost:5173. Lệnh `npm` cần Node.js; Node được cài qua nvm-windows ở `C:\nvm4w\nodejs`.
- Chạy test: `npm test`. Kiểm tra kiểu: `npx tsc -p tsconfig.json --noEmit`.
- Debug trong trình duyệt:
  - `window.game` là game đang chạy, ví dụ `game.sim.world.money = 1e9`.
  - `?seed=123` trên địa chỉ để đổi bản đồ.
- Mọi con số cân bằng nằm trong `src/sim/config.ts`.
- Mọi chữ hiển thị đi qua `t()`, có khóa ở cả `src/i18n/vi.ts` và `src/i18n/en.ts`.
- Repo: https://github.com/haidang1810/logistics-tycoon (nhánh `master`).
