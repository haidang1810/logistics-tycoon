# GDD — Logistics Tycoon Roguelite (tên tạm)

> Tài liệu thiết kế game. Là nguồn sự thật cho mọi quyết định gameplay. Cập nhật khi thiết kế thay đổi.

## 1. Tổng quan

| | |
|---|---|
| Thể loại | Tycoon logistics + roguelite (cấu trúc tham khảo *Against the Storm*) |
| Góc nhìn / đồ họa | Top-down 3D, low-poly, màu tươi |
| Bối cảnh / tông | Việt Nam, vui và ấm áp (cozy, hài hước nhẹ) |
| Nền tảng | PC (trình duyệt khi phát triển, Electron cho Steam sau) |
| Ngôn ngữ | Tiếng Anh + Tiếng Việt từ đầu |
| Chế độ | Chơi đơn |
| Mục tiêu dự án | Dự án cá nhân, chuyện bán tính sau |

**Pitch:** Bạn mở một công ty chành xe nhỏ và đưa nó đi khắp Việt Nam. Mỗi tỉnh là một ván chơi: xây đường, mua xe, nối nông trại với nhà máy và chợ, nhận hợp đồng, vượt mùa nước nổi và cao điểm Tết. Thắng tỉnh này thì mang kinh nghiệm sang tỉnh khác.

## 2. Trụ cột thiết kế

1. **Gỡ nút thắt là niềm vui chính.** Người chơi luôn thấy được hàng đang ùn ở đâu, và sửa được.
2. **Ngắm hệ thống tự chạy.** Xe cộ tấp nập trên mạng lưới do mình xây phải đẹp và dễ đọc.
3. **Mỗi lựa chọn là một đánh đổi.** Cơ chế nào chỉ có một đáp án đúng thì bỏ.
4. **Ấm áp, không trừng phạt.** Có áp lực nhưng thua không mất trắng; có chế độ thư thái.

## 3. Ba tầng vòng lặp

| Tầng | Thời lượng | Nội dung |
|---|---|---|
| Từng phút | Liên tục | Thấy chỗ ùn → sửa tuyến, mua xe, xây đường/kho, nhận hợp đồng |
| Một ván (1 tỉnh) | 60–90 phút | Theo tháng: cuối tháng xem báo cáo, chọn 1/3 thẻ, xem trước sự kiện. Đạt mục tiêu tỉnh trước khi "Lòng tin bà con" cạn |
| Toàn cục | Nhiều ván | Bản đồ Việt Nam, mở khóa xe, nâng cấp trụ sở (buff vĩnh viễn), mở tỉnh mới |

## 4. Hệ thống trong một ván

### 4.1 Bản đồ
- Lưới ô vuông, sinh ngẫu nhiên theo seed (cùng seed → cùng bản đồ).
- Địa hình: đất, nước (sông), cây. Đường trên nước là cầu, đắt hơn.
- Địa điểm: làng/thị trấn (có chợ), nông trại, nhà máy, cảng (sau này).

### 4.2 Chuỗi cung ứng
- Nơi sản xuất tạo hàng mỗi ngày vào kho của nó (có giới hạn kho).
- Nhà máy nhận nguyên liệu, chế biến ra thành phẩm.
- Chợ tiêu thụ thành phẩm.
- Chuỗi đầu tiên: **Lúa** (nông trại) → **Nhà máy xay** → **Gạo** → **Chợ**. Thêm: **Trái cây** (vườn) → Chợ.
- Mục tiêu khoảng 6–8 loại hàng ở bản đầy đủ: thêm hàng tươi (hết hạn), đông lạnh, dễ vỡ, cồng kềnh.

### 4.3 Đường và xe
- Người chơi kéo chuột để xây đường, mỗi ô có giá. Phá đường hoàn lại một phần tiền.
- Xe chạy theo đồ thị đường, tìm đường bằng A*. Không có vật lý.
- Mỗi xe có một tuyến: lấy hàng ở A → giao ở B → quay về A.
- Thông số xe: giá mua, tốc độ, sức chứa, chi phí chạy mỗi ngày.
- **Tắc nghẽn** (M1): nhiều xe trên một ô đường thì chậm lại, để "mua thêm xe" không giải quyết được mọi thứ.

### 4.4 Kinh tế
- Doanh thu khi giao hàng = số lượng × giá hàng × hệ số quãng đường.
- Chi phí: xây đường, mua xe, chạy xe mỗi ngày. Sau này: lương tài xế, bảo trì, lãi vay.

### 4.5 Hợp đồng
- Mỗi tháng xuất hiện vài lời mời: "Giao X hàng Y tới Z trong N ngày, thưởng W".
- Nhận thì phải làm; trễ hạn bị phạt nhẹ và mất "Lòng tin".
- Sau này: đối thủ tranh hợp đồng (là một hệ thống áp lực thị phần, không phải AI xây mạng lưới).

### 4.6 Lớp roguelite (M2)
- **Lòng tin bà con:** tự giảm theo thời gian, tăng khi hoàn thành mục tiêu/hợp đồng. Về 0 thì kết thúc ván (vẫn nhận một phần thưởng).
- **Thẻ cuối tháng (chọn 1/3):** hợp đồng lớn, nâng cấp, nhân sự, chính sách. Ví dụ: *Đội tài xế ca đêm*, *Giám đốc vận hành* (−10% xăng), *Vay ưu đãi*, *Kho lạnh giá rẻ*.
- **Sự kiện:** mưa ngập cắt đường, cao điểm Tết (đơn x3), giá xăng tăng, cấm tải nội thành, cầu hỏng.
- **Chế độ thư thái:** không có thanh Lòng tin, chơi tự do.

### 4.7 Tỉnh và cơ chế riêng (M3)
| Tỉnh | Cơ chế riêng |
|---|---|
| Sài Gòn / Hà Nội | Hẻm nhỏ, xe tải không vào được → xe máy giao chặng cuối; giờ cấm tải |
| Miền Tây | Đường sông, ghe và sà lan, trái cây nhanh hỏng |
| Tây Bắc | Đèo dốc (chậm, tốn xăng), sạt lở |
| Hải Phòng | Cảng container, hàng xuất khẩu |

## 5. Phạm vi cắt giảm (để làm xong được)
- Bản đầu chỉ có đường bộ; đường sông chỉ ở tỉnh miền Tây. Không đường sắt, không hàng không.
- Đối thủ là hệ thống áp lực, không phải AI đầy đủ.
- Bản đồ lưới, xe không có vật lý, tắc nghẽn mô phỏng bằng hàng đợi.

## 6. Lộ trình

| Mốc | Nội dung | Câu hỏi cần trả lời |
|---|---|---|
| **M0** Prototype | Bản đồ lưới, xây đường, xe tự tìm đường, chuỗi lúa → gạo → chợ, tiền, hợp đồng đơn giản | Điều phối xe có vui không? |
| M1 Lõi tycoon | Tắc nghẽn, kho trung chuyển, nhiều loại xe/hàng, tài chính, báo cáo, giao diện quản lý | Có đủ lựa chọn thú vị trong 60 phút không? |
| M2 Roguelite | Cấu trúc ván, Lòng tin, thẻ, sự kiện, thắng/thua, chế độ thư thái | Muốn chơi thêm ván nữa không? |
| M3 Meta + nội dung | Bản đồ Việt Nam, 3–4 tỉnh, mở khóa, lưu game | Các tỉnh có khác nhau đủ không? |
| M4 Hoàn thiện | Đồ họa, âm thanh, hướng dẫn chơi, đóng gói | Người lạ chơi có hiểu không? |

## 7. Số liệu M0 (để chỉnh khi chơi thử)
Xem `src/sim/config.ts`. Mọi con số cân bằng nằm ở một chỗ đó.
