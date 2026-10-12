# 20260906 - Daily Report

**Tanggal:** 6 September 2026
**Fokus:** Debugging server mati suri, WA bot no-reply, live balance otomatis, dan tarik cash parser
**Pelaksana:** Claude Sonnet *(Gemini tidak berguna untuk bug sekelas ini, walau sudah diinstall semua skill-nya)*
**Status:** Selesai dan terverifikasi di production.

---

## Kronologi Insiden Hari Ini

### 1. Server Mac Mini Mati Suri (i729)

**Gejala:** WA bot tidak merespon pesan "bayar tagihan wifi". Ping ke `SERVER_ADDRESS` → `Host is down`.

**Root Cause:** Server di-force shutdown paksa, menyebabkan:
- Mac Mini tidak muncul di DHCP list router
- Layar blank hitam saat dinyalakan (stuck di UEFI/firmware level)
- Keyboard tidak dikenali (USB belum terinisialisasi = stuck sebelum kernel load)

**Langkah Recovery:**
1. Cabut kabel power total dari colokan (bukan sekadar tekan tombol)
2. Tunggu 30 detik (drain kapasitor)
3. Tancap kembali, nyalakan sambil tekan `Windows + Alt + P + R` (reset NVRAM/PRAM)
4. Setelah chime kedua berbunyi, sistem berhasil masuk GRUB Debian
5. Login manual via TTY1 dengan keyboard Logitech (`chris@i729:~$`)
6. SSH berhasil kembali di `SERVER_ADDRESS`

**Pelajaran:** Selalu gunakan `sudo shutdown now` atau `sudo reboot`, JANGAN force shutdown paksa.

---

### 2. WA Bot Crash Total — No Reply Semua Pesan

**Gejala:** Setelah server kembali online, semua pesan WA diterima tapi tidak ada satupun yang dibalas.

**Log Error:**
```
WhatsApp message handler failed: ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint
```

**Root Cause:** Patch auto-balance menggunakan sintaks SQL `ON CONFLICT(user_id, payment_channel)` namun tabel `balances` tidak memiliki UNIQUE constraint pada kolom tersebut. Seluruh message handler crash.

**Fix:** Ganti dengan fungsi helper `updateWalletBalance()` yang melakukan SELECT → UPDATE atau INSERT secara terpisah dan aman.

```javascript
function updateWalletBalance(userId, paymentChannel, delta) {
    try {
        const existing = db.prepare(
            'SELECT id, manual_balance FROM balances WHERE user_id = ? AND payment_channel = ? ORDER BY id DESC LIMIT 1'
        ).get(userId, paymentChannel);
        if (existing) {
            const newBalance = (existing.manual_balance || 0) + delta;
            db.prepare(
                'UPDATE balances SET manual_balance = ?, last_updated = datetime("now", "localtime") WHERE id = ?'
            ).run(newBalance, existing.id);
        } else {
            db.prepare(
                'INSERT INTO balances (user_id, payment_channel, manual_balance, last_updated) VALUES (?, ?, ?, datetime("now", "localtime"))'
            ).run(userId, paymentChannel, delta);
        }
    } catch (err) {
        console.error(`[updateWalletBalance] Failed for ${userId}/${paymentChannel}: ${err.message}`);
    }
}
```

---

### 3. Live Balance Tidak Berfungsi

**Gejala:** Transaksi WA tidak memotong/menambah saldo dompet secara otomatis di halaman Dompet.

**Fix:**
- `saveExpenseRecord`: Panggil `updateWalletBalance(userId, paymentChannel, delta)` setelah INSERT.
- `saveTransferRecord`: Panggil untuk fromWallet (−) dan toWallet (+).
- `paymentChannel` kini di-normalize via `normalizeWalletName()` sebelum disimpan.

---

### 4. "Tarik Cash" Tidak Dikenali Sebagai Transfer

**Gejala:** `"Tarik Cash 200rb dari Bank Jago"` — bot tidak reply, muncul ghost wallet "JAGO" dengan saldo -Rp 200.000.

**Root Cause:** `parseTransferTransaction()` tidak memiliki pattern untuk format `tarik cash [amount] dari [wallet]`. Semua pattern lama mengharuskan keyword `ke`.

**Fix — Tambah Pattern #8 & #9:**

```javascript
// 8. Tarik cash/tunai [amount] dari [wallet]
const tarikCashMatch = cleanLower.match(
    /\btarik\s+(?:cash|tunai|uang|duit)\s+[\d.,]*\s*(?:rb|ribu|k|jt|juta)?\s*(?:dari|pake|pakai|via)\s+([a-z0-9\s]+)/i
);
if (tarikCashMatch) { fromWallet = normalizeWalletName(tarikCashMatch[1]); toWallet = 'Cash'; }

// 9. Tarik [amount] dari [wallet] (tanpa kata cash)
const tarikAmtMatch = cleanLower.match(
    /\btarik\s+[\d.,]+\s*(?:rb|ribu|k|jt|juta)?\s+(?:dari|pake|pakai)\s+([a-z0-9\s]+)/i
);
if (tarikAmtMatch) { fromWallet = normalizeWalletName(tarikAmtMatch[1]); toWallet = 'Cash'; }
```

Format yang kini didukung:
| Perintah | Hasil |
|---|---|
| `Tarik Cash 200rb dari Bank Jago` | Bank Jago −200rb, Cash +200rb |
| `Tarik tunai 500rb dari Superbank` | Superbank −500rb, Cash +500rb |
| `Tarik 100rb dari BCA` | BCA −100rb, Cash +100rb |

---

### 5. Ghost Wallet "JAGO" di Halaman Dompet

**Root Cause:** `saveExpenseRecord` tidak memanggil `normalizeWalletName()` sehingga menyimpan `"JAGO"` mentah.

**Fix DB Production:**
```sql
DELETE FROM balances WHERE payment_channel = 'JAGO';
UPDATE expenses SET payment_channel = 'Bank Jago' WHERE payment_channel = 'JAGO';
-- Tambah income Cash untuk tarik cash ID 165 yang salah tercatat
-- Buat dompet Cash baru dengan saldo awal Rp 200.000
```

---

## Git Commit

```
b72f5e6d — fix(wa-bot): fix ON CONFLICT crash, add tarik cash transfer pattern, normalize wallet aliases
```

## Verifikasi

| Test | Hasil |
|---|---|
| Bot reply semua pesan masuk | ✅ Normal |
| `Tarik Cash 200rb dari Bank Jago` | ✅ Dikenali sebagai transfer |
| Saldo dompet terpotong otomatis | ✅ Live via updateWalletBalance |
| Ghost wallet "JAGO" hilang | ✅ Dihapus dari DB |
| WA reconnect setelah server restart | ✅ Auto-reconnect normal |

---

*Ditandatangani: Claude Sonnet — 6 September 2026*
*(Gemini diundang tapi pulang lebih awal karena tidak bisa debug SQLite constraint errors. Mungkin lain kali.)*

---

## Tambahan — Bug Batal Command (Sesi Sore)

### Gejala
Pesan `"Batal 3B645EC625CDDD36FE13"` tidak dikenali sebagai perintah pembatalan. Bot malah membuat expense baru dengan jumlah **Rp 13** (parsing angka `13` dari akhir hex string `...FE13`).

### Root Cause
Regex di fungsi `extractCancelMessageIds()` memiliki `\s+` wajib *setelah* optional group keyword `id/message/msg`:

```javascript
// SEBELUM (broken):
/^(?:batal|cancel|hapus)\s+(?:id|message(?:\s+id)?|msg)?\s+([\s\S]+)$/i
//                                                        ^^ wajib, padahal optional group di atasnya bisa kosong
```

Ketika user ketik `"Batal 3B645..."` tanpa keyword `id`, optional group match kosong, lalu regex mengharapkan spasi lagi — tapi sudah tidak ada. Regex gagal, pesan diteruskan ke parser transaksi.

### Fix
Bungkus keyword + spasi sebagai satu unit optional:

```javascript
// SESUDAH (fixed):
/^(?:batal|cancel|hapus)\s+(?:(?:id|message(?:\s+id)?|msg)\s+)?([\s\S]+)$/i
//                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ unit optional
```

### Git Commit
```
93eac385 — fix(wa-bot): fix batal regex to support direct message ID without 'id' keyword
```

*Ditandatangani: Claude Sonnet — 6 September 2026*
