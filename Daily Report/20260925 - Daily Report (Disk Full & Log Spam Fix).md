# 20260925 - Daily Report

**Tanggal:** 25 September 2026
**Fokus:** WA bot tidak reply — server disk penuh akibat log spam jcl-kiki-wa-bot
**Pelaksana:** Claude Sonnet
**Status:** Selesai dan terverifikasi di production.

---

## Kronologi Insiden

1. User lapor WA bot tidak reply dan transaksi tidak tercatat
2. SSH ke `SERVER_ADDRESS` → `No route to host` → server freeze/kernel panic
3. User hard reset Mac Mini
4. Setelah reboot, SSH OK tapi `wa-finance-api` tidak ada di `docker ps`
5. Coba start container → **Error: no space left on device**
6. Investigasi disk → `/dev/nvme0n1p2` (456GB) **100% penuh**

---

## Root Cause: jcl-kiki-wa-bot Log 415GB

### Investigasi
```
du -h --max-depth=2 /var/lib/docker/containers | sort -rh | head -5
415G  /var/lib/docker/containers/cd0f018b578f...   ← jcl-kiki-wa-bot
```

### Penyebab
Fungsi `backupSession()` di `sessionStore.js` mencoba upload file sesi WA ke Google Cloud Storage (GCS). Namun billing GCS project sudah **disabled** sehingga setiap upload menghasilkan error 403:

```
GaxiosError: The billing account for the owning project is disabled in state absent
```

**Bug kode:** `console.error('Gagal upload ${file}:', error)` → mem-log **full GaxiosError object** (bukan hanya `error.message`). Satu error = ~3-4KB JSON dump penuh termasuk request headers, response body, stack trace, dll.

**Frekuensi:** Setiap WA pre-key rotation & backup session attempt → berlangsung 24/7.

**Kalkulasi:**
- 4 minggu = ~40.000 menit
- ~1 backup attempt per menit (konservatif)
- Setiap session folder punya ~100+ pre-key files
- 100 files × 3-4KB error × 40.000 = **~12-16GB/hari**
- Hasil: **415GB dalam 4 minggu** ✓

---

## Fix yang Dilakukan

### 1. Tambah `gcsDisabled` guard flag di sessionStore.js
```javascript
let gcsDisabled = false;

async function backupSession(sessionPath) {
    if (gcsDisabled) return; // billing disabled, skip silently
    // ...
    } catch (error) {
        const code = error?.response?.data?.error?.code || error?.code;
        if (code === 403 || msg.includes('billing') || msg.includes('accountDisabled')) {
            if (!gcsDisabled) {
                console.error('[sessionStore] GCS billing disabled — backup dinonaktifkan.');
                gcsDisabled = true; // ← set sekali, stop retry selamanya
            }
            break;
        }
        // Error lain: log message saja, BUKAN full error object
        console.error(`[sessionStore] Gagal upload ${file}: ${msg}`);
    }
}
```

**Efek:** Error GCS billing hanya dilog **1 kali** saat pertama kali terjadi, lalu semua backup attempt berikutnya langsung di-skip tanpa log apapun.

### 2. Truncate log yang sudah 415GB
```bash
sudo truncate -s 0 /var/lib/docker/containers/cd0f018b.../...-json.log
```
Disk freed: **456GB → 30GB terpakai (7%)**

### 3. Pasang Docker log rotation global
`/etc/docker/daemon.json`:
```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "3"
  }
}
```
**Efek:** Semua container baru max 150MB log total. Tidak ada container yang bisa spam disk lagi.

### 4. Rebuild & restart jcl-kiki-wa-bot
```bash
cd /data/appdata/jcl-kiki && docker compose build jcl-kiki-wa-bot && docker compose up -d
```

---

## Status Akhir

| Item | Status |
|---|---|
| Disk usage | ✅ 30GB/456GB (7%) |
| wa-finance-api | ✅ Running & WA connected |
| jcl-kiki-wa-bot | ✅ Patched & restarted |
| Docker log rotation | ✅ Max 50MB × 3 per container |
| Log spam GCS | ✅ Fixed — log 1x saja lalu silent |

---

## Rekomendasi Jangka Panjang

- **Aktifkan GCS billing** di project `laundry-stock-app` jika backup cloud masih dibutuhkan, ATAU
- **Nonaktifkan fitur GCS backup** di jcl-kiki dan gunakan lokal persist saja (sudah berjalan dengan baik)
- **Pasang Uptime Kuma alert** untuk disk usage > 80% supaya bisa deteksi lebih awal sebelum full

---

*Ditandatangani: Claude Sonnet — 25 September 2026*

---

## Update Sesi Siang — Disable GCS Backup Permanen

Setelah investigasi lebih lanjut, diputuskan untuk **fully disable** fitur backup GCS karena:
- Billing GCS menggunakan free tier yang sudah disabled
- Sesi WA sudah tersimpan aman di lokal via Docker volume bind mount (`/data/appdata/jcl-kiki/runtime/sessions`)
- Backup cloud tidak diperlukan selama server lokal berjalan dengan baik

### Perubahan

**1. `sessionStore.js` — Tambah env var `DISABLE_GCS_BACKUP`**
```javascript
const GCS_DISABLED = process.env.DISABLE_GCS_BACKUP === 'true';
if (GCS_DISABLED) {
    console.log('[sessionStore] GCS backup dinonaktifkan — sesi disimpan lokal saja.');
}
async function backupSession(sessionPath) {
    if (GCS_DISABLED) return; // skip sepenuhnya, tanpa error, tanpa retry
    // ...
}
```

**2. `/data/appdata/jcl-kiki/docker-compose.yml`**
```yaml
environment:
  DISABLE_GCS_BACKUP: "true"   # ← ditambahkan
```

### Hasil Setelah Rebuild

```
[sessionStore] GCS backup dinonaktifkan via DISABLE_GCS_BACKUP=true — sesi disimpan lokal saja.
[sessionStore] Menggunakan sesi lokal persisten (1351 file).
WhatsApp connection opened successfully!
```

✅ Tidak ada lagi error GCS, tidak ada log spam, WA tetap connected via sesi lokal.

*Ditandatangani: Claude Sonnet — 25 September 2026*
