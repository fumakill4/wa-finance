# 20260902 - Daily Report (Financial Logic Audit, Internal Transfer Exclusion & Strict Recap Isolation)

**Tanggal:** 02 September 2026  
**Project:** WA Finance Gateway  
**Status:** Selesai, di-commit ke Git (`233bd43c`), di-deploy ke Server Production Mac Mini (`SERVER_ADDRESS`), dan terverifikasi 100% normal.

---

## 1. Masalah yang Dilaporkan & Diidentifikasi

Pada audit sistem keuangan WebApp & Bot WhatsApp ditemukan beberapa masalah utama:

1. **Perintah WA Pindah Saldo Terbaca Sebagai Pengeluaran biasa**:
   - Pesan `pindah saldo bca ke superbank 1.865.000` terbaca salah karena kata `"saldo"` dianggap sebagai nama dompet sumber (`fromWallet = "saldo"`). Akibatnya, transaksi tidak terbaca sebagai transfer 2 arah, melainkan sebagai pengeluaran biasa dari BCA sebesar Rp 1.865.000 tanpa ada pemasukan di Superbank.
2. **Pindah Saldo (Transfer Antar Dompet) Menggelembungkan Pemasukan & Pengeluaran**:
   - Transaksi pindah saldo sebelumnya mencatat 2 leg transaksi (`type = 'expense'` dan `type = 'income'`). Dashboard menjumlahkan seluruh `type = 'expense'` ke Total Pengeluaran (+Rp 1.865.000) dan `type = 'income'` ke Total Pemasukan (+Rp 1.865.000), padahal pindah saldo murni perputaran uang internal antar rekening.
3. **Transaksi Lama / Sampah Masih Terikut Setelah Tutup Buku**:
   - Filter `matchesFilter` di Dashboard dan perhitungan saldo dompet di `Dompet.jsx` sebelumnya tidak secara ketat menyaring transaksi berstatus `'archived'` dan transaksi sebelum `active_recap_start_date`. Selain itu, saat `Tutup Buku & Backup` dijalankan, `monthly_budget` tidak di-reset ke `0` dan query SQL archiving terhalang filter tanggal tertentu sehingga beberapa transaksi lama tertinggal.
4. **Kartu Utama Dashboard Menampilkan Angka Minus Sisa Budget Dengan Label "TOTAL SALDO"**:
   - Kartu pertama Slide 0 Dashboard menghitung rumus sisa budget (`-Rp 1.950.894`) tetapi menggunakan judul `"TOTAL SALDO"`, sehingga membingungkan pengguna yang mengira saldo fisik tabungan di bank bernilai minus.

---

## 2. Root Cause Analysis (RCA)

1. **WA Transfer Parser Regex**:
   - Parser `parseTransferTransaction` di `waService.js` mencocokkan kata setelah kata kerja transfer tanpa menyaring kata sisipan seperti `"saldo"`, `"uang"`, `"dana"`, `"rekening"`. Format angka dengan titik ribuan (`1.865.000`) juga hanya mencocokkan `1.865` karena regex lama `\d+(?:[.,]\d+)?` berhenti pada titik kedua.
2. **Transfer Inclusion in Income & Expense Metrics**:
   - `totalMonth` dan `totalIncome` di `Dashboard.jsx` secara mentah me-reduce seluruh `activePeriodExpenses` dan `activePeriodIncomes` tanpa mengecualikan kategori `'Transfer'`.
3. **Recap Archiving & Active Period Boundary**:
   - Query `UPDATE expenses` saat Tutup Buku di `index.js` menyertakan `${activeWhere}` yang membatasi baris mana saja yang di-update. Transaksi berformat tanggal non-standar (misal `Aug 27, 2026`) terlewat dari update `recap_status = 'archived'`.
   - `computedWallets` pada `Dompet.jsx` membaca array mentah `expenses` tanpa melakukan filter tanggal `active_recap_start_date`.
4. **Database Residual Duplicates**:
   - Terdapat 2 baris transaksi pengeluaran sampah (ID 157 & 158) sebesar Rp 1.865.000 di SQLite server dari uji coba pesan WA lama sebelum parser diperbaiki.

---

## 3. Langkah Perbaikan yang Diterapkan

1. **Pembaruan Parser WhatsApp (`Vault/backend/waService.js`)**:
   - Menambahkan pembersihan kata pembungkus/sisipan (`saldo`, `uang`, `dana`, `rekening`, `rek`) setelah kata kerja transfer.
   - Memperbarui regex pencocokan nominal menjadi `(\d+(?:[.,]\d+)*)` agar angka dengan pemisah ribuan titik (seperti `1.865.000`) terbaca utuh sebagai `1865000`.
2. **Pengecualian Pindah Saldo dari Card Pemasukan & Pengeluaran (`Vault/frontend/src/pages/Dashboard.jsx`)**:
   - Membuat fungsi pembantu `isTransferTransaction(item)` untuk mendeteksi transaksi `category === 'Transfer'` atau merchant `Pindah Saldo` / `Transfer ke` / `Terima transfer`.
   - Mengisi `totalMonth` (Total Pengeluaran) dan `totalIncome` (Total Pemasukan) murni dari `nonTransferExpenses` dan `nonTransferIncomes`.
3. **Isolasi Periode Keras & Reset Budget saat Tutup Buku (`index.js`, `Dashboard.jsx`, `Dompet.jsx`)**:
   - **Backend (`Vault/backend/index.js`)**: Query Tutup Buku kini meng-archive seluruh transaksi non-tabungan milik user secara unconditionally: `WHERE user_id = ? AND COALESCE(recap_status, 'active') != 'archived'`.
   - **Backend (`Vault/backend/index.js`)**: `saveUserSettings` saat Tutup Buku otomatis mereset `monthly_budget: 0`.
   - **Frontend (`Vault/frontend/src/pages/Dashboard.jsx` & `Dompet.jsx`)**: Filter `matchesFilter` dan `computedWallets` menolak 100% transaksi ber-status `'archived'` dan transaksi sebelum `active_recap_start_date`.
4. **Klarifikasi Label Kartu Utama Slide 0 (`Vault/frontend/src/pages/Dashboard.jsx`)**:
   - Menyetel Slide 0 kartu utama agar **selalu murni menampilkan `TOTAL SALDO GABUNGAN`** dari penjumlahan saldo fisik seluruh dompet aktif (`totalAccumulatedBalance`).
5. **Pembersihan Database Production Server**:
   - Menghapus 2 transaksi sampah (ID 157 & 158) dari SQLite server.
   - Memperbarui status 4 transaksi lama (ID 139, 140, 141, 142) menjadi `'archived'`.
6. **Pengecualian Pindah Saldo dari Donut Chart & Trend Graph + Perbaikan Widget Saldo per Dompet (`Vault/frontend/src/pages/Dashboard.jsx`)**:
   - Pindah saldo di-exclude dari `categories` (Donut Chart *Top Expense Categories*) dan `trendData` (*Expense Trend Graph*).
   - Widget **Saldo per Dompet** diperbarui untuk menampilkan **Murni Saldo Fisik Aktif per Dompet (`walletList`)**, bukan penjumlahan pengeluaran.

---

## 4. Hasil Verifikasi Production

- 🟢 **Pemasukan Aktif**: Murni **Rp 3.140.000** (Gaji Istri Rp 2,73jt + Uang IMEI Rp 410k). Pindah saldo Rp 1.865.000 tidak lagi menggelembungkan Pemasukan.
- 🔴 **Pengeluaran Aktif**: Murni **Rp 3.119.349** (Kosan 1,1jt, Cicilan Motor 765k, Tagihan Dana 372k, Imei 280k, Belanja & Makan). Pindah saldo Rp 1.865.000 tidak lagi menggelembungkan Pengeluaran.
- 💳 **Saldo Dompet**: BCA & Superbank dihitung murni dari transaksi aktif periode berjalan tanpa ada kebocoran transaksi lama.
- 🚀 **Production Deployment**: Build terbaru (`index-DyUCDnUu.js`) telah di-commit, di-push ke GitHub (`233bd43c`), dan container Docker `wa-finance-api` di server Mac Mini (`SERVER_ADDRESS`) telah di-restart secara LIVE.

---

## 5. Changelog & Version Info

- **Latest Git Commit:** `233bd43c` (`main` branch)
- **Production Asset Bundle:** `assets/index-DyUCDnUu.js`, `assets/index-CZ_QuN1o.css`
- **Backend API Health:** `https://api-finance.i729.my.id/api/health` -> `HTTP 200 OK`
