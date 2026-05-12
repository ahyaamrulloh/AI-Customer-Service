require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const OpenAI = require("openai");
const rateLimit = require("express-rate-limit"); // Untuk membatasi jumlah request per IP

const app = express();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ─────────────────────────────────────────────
// KONFIGURASI CORS
// Hanya domain yang ada di whitelist yang boleh akses backend ini
// Tambahkan domain Coffee Nusantara di sini saat sudah deal
// ─────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "https://coffeenusantara.com", // Website utama client
  "https://www.coffeenusantara.com", // Versi www
  "http://localhost:8080", // Untuk development lokal kamu
  "http://localhost:3000", // Kalau client pakai port lain saat dev
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Izinkan request tanpa origin (misalnya dari Postman atau curl saat testing)
      if (!origin) return callback(null, true);

      if (ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true); // Origin diizinkan
      } else {
        callback(new Error(`Origin ${origin} tidak diizinkan`)); // Tolak origin lain
      }
    },
  }),
);

// ─────────────────────────────────────────────
// RATE LIMITER untuk /start
// Membatasi satu IP hanya bisa membuat 10 sesi baru per jam
// Mencegah abuse membuat sesi terus-menerus
// ─────────────────────────────────────────────
const startLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // Window waktu: 1 jam
  max: 10, // Maksimal 10 request per IP per jam
  message: { error: "Terlalu banyak sesi dibuat. Coba lagi dalam 1 jam." },
  standardHeaders: true, // Kirim info rate limit di header response
  legacyHeaders: false,
});

// ─────────────────────────────────────────────
// RATE LIMITER untuk /chat
// Membatasi satu IP hanya bisa kirim 30 pesan per menit
// Mencegah spam yang bisa membengkakkan tagihan OpenAI
// ─────────────────────────────────────────────
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // Window waktu: 1 menit
  max: 30, // Maksimal 30 pesan per IP per menit
  message: {
    error: "Terlalu banyak pesan. Tunggu sebentar sebelum mengirim lagi.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────────
// KONFIGURASI MEMORY
// ─────────────────────────────────────────────
const conversations = {}; // Menyimpan riwayat percakapan per sesi { threadId: [...messages] }
const MAX_HISTORY = 10; // Maksimal 10 pesan terakhir yang disimpan per sesi (5 bolak-balik)

// Membersihkan sesi yang sudah tidak aktif lebih dari 30 menit
// Mencegah memory server penuh jika banyak user membuka chat lalu pergi
const SESSION_TTL = 30 * 60 * 1000; // 30 menit dalam milidetik
const sessionTimestamps = {}; // Menyimpan waktu terakhir aktivitas tiap sesi

// Jalankan pembersihan sesi expired setiap 10 menit
setInterval(
  () => {
    const now = Date.now();
    let cleaned = 0;
    for (const threadId in sessionTimestamps) {
      if (now - sessionTimestamps[threadId] > SESSION_TTL) {
        delete conversations[threadId]; // Hapus riwayat percakapan
        delete sessionTimestamps[threadId]; // Hapus timestamp sesi
        cleaned++;
      }
    }
    if (cleaned > 0) console.log(`Cleaned ${cleaned} expired session(s)`);
  },
  10 * 60 * 1000,
); // Interval 10 menit

const SYSTEM_PROMPT = `Kamu adalah Customer Support Coffee Nusantara, produsen kopi bubuk asli Indonesia yang berdiri sejak 1970, berlokasi di Medan, Sumatera Utara.

Tugasmu adalah membantu pelanggan dengan ramah, sopan, dan menggunakan Bahasa Indonesia.
Jangan pernah tampilkan citation atau referensi dokumen dalam jawabanmu.

=== DATA LENGKAP COFFEE NUSANTARA ===

PROFIL PERUSAHAAN:
- Nama: Coffee Nusantara
- Berdiri: 1970, dirintis oleh seorang kakek pecinta kopi, kini dikelola keluarga
- Bahan baku utama: Biji kopi Sidikalang, Sumatera Utara
- Sertifikasi: HALAL

LOKASI & KONTAK:
- Alamat: Jl. Brigjen Zein Hamid KM 7.2, Jl. Ladang No.1, Kel. Titi Kuning, Kec. Medan Johor, Kota Medan, Sumatera Utara 20146
- Telepon: +62 813-9678-6403
- WhatsApp: +62 811-6333-128
- Email: coffeenusantara@gmail.com
- Website: https://coffeenusantara.com
- Instagram: @coffeenusantara70
- Tokopedia: tokopedia.com/kopinusantara70
- Shopee: shopee.co.id/kopi_jembatan

JAM OPERASIONAL:
- Senin - Minggu: 08.00 - 17.00 WIB
- Hari libur nasional: konfirmasi dulu via WhatsApp

PRODUK (semua sudah HALAL):
1. Robusta Blend Special — kopi robusta pilihan, rasa kuat dan aroma khas. Tersedia kemasan reguler dan ons/sachet
2. Arabica — kopi arabika murni, rasa lembut dan segar. Tersedia kemasan 500 gram
3. Arabica Robusta Blend — perpaduan arabika dan robusta, rasa seimbang. Tersedia kemasan reguler, 500 gram, dan ons
4. Robusta Blend Hijau — robusta kemasan hijau, cocok penggemar kopi hitam. Tersedia reguler dan ons
5. Robusta Blend Kuning — robusta kemasan kuning, aroma harum. Tersedia reguler dan ons
6. Kopi Gula 2in1 — kopi instan + gula, praktis, format sachet

CARA PEMBELIAN:
- Online: Tokopedia (tokopedia.com/kopinusantara70) atau Shopee (shopee.co.id/kopi_jembatan)
- WhatsApp: +62 811-6333-128 (sebutkan produk, jumlah, alamat)
- Langsung: datang ke alamat di atas, jam operasional Senin-Minggu 08.00-17.00 WIB

PENGIRIMAN:
- Tersedia ke seluruh Indonesia via marketplace
- Estimasi 1-7 hari kerja tergantung lokasi
- Pembelian grosir/reseller: hubungi WhatsApp

CARA MENYEDUH:
1. Tuang bubuk kopi secukupnya ke gelas
2. Tambah gula sesuai selera
3. Seduh dengan air panas (90-95 derajat Celcius)
4. Aduk sampai larut dan merata
5. Siap dinikmati

TESTIMONI PELANGGAN:
- Merry: "Produk bagus sesuai gambar, fast respon, fast delivery, service bagus" ★★★★★
- Inal: "Sudah langganan, toko amanah, sering beli di sini" ★★★★★
- Agatha: "Pengiriman cepat, pengemasan rapi, kopi mantap" ★★★★★
- Verra: "Pembelian kedua kali, suami suka kopinya" ★★★★★

Jika pertanyaan di luar konteks Coffee Nusantara, arahkan ke:
WhatsApp +62 811-6333-128 atau email coffeenusantara@gmail.com`;

// ─────────────────────────────────────────────
// ROUTE: GET /start
// Membuat sesi percakapan baru dan mengembalikan thread_id unik
// Rate limiter dipasang di sini agar pembuatan sesi tidak bisa dispam
// ─────────────────────────────────────────────
app.get("/start", startLimiter, (req, res) => {
  const threadId = `thread_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  conversations[threadId] = []; // Inisialisasi riwayat kosong
  sessionTimestamps[threadId] = Date.now(); // Catat waktu sesi dibuat
  return res.json({ thread_id: threadId });
});

// ─────────────────────────────────────────────
// ROUTE: POST /chat
// Menerima pesan user, memanggil OpenAI, dan streaming response ke frontend
// Rate limiter dipasang di sini agar pesan tidak bisa dispam
// ─────────────────────────────────────────────
app.post("/chat", chatLimiter, async (req, res) => {
  const threadId = req.body.thread_id;
  const message = req.body.message;

  if (!threadId) {
    return res.status(400).json({ error: "Missing thread_id" });
  }

  if (!conversations[threadId]) {
    return res
      .status(400)
      .json({
        error: "Sesi tidak ditemukan atau sudah expired. Refresh halaman.",
      });
  }

  // Update timestamp aktivitas sesi agar tidak dihapus oleh cleanup
  sessionTimestamps[threadId] = Date.now();

  console.log(`Received message: "${message}" for thread: ${threadId}`);

  // Tambahkan pesan user ke riwayat sesi
  conversations[threadId].push({ role: "user", content: message });

  // Batasi riwayat hanya simpan MAX_HISTORY pesan terakhir
  // Ini mencegah context window membengkak dan menghemat biaya token
  if (conversations[threadId].length > MAX_HISTORY) {
    conversations[threadId] = conversations[threadId].slice(-MAX_HISTORY);
  }

  // Set header SSE untuk streaming response ke frontend
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const stream = await openai.responses.create({
      model: "gpt-4.1-mini",
      instructions: SYSTEM_PROMPT,
      input: conversations[threadId], // Kirim riwayat yang sudah dibatasi
      stream: true,
    });

    let fullResponse = "";

    for await (const event of stream) {
      if (event.type === "response.output_text.delta" && event.delta) {
        const clean = event.delta.replace(/【[^】]*】/g, "");
        if (clean) {
          fullResponse += clean;
          res.write(`data: ${JSON.stringify({ text: clean })}\n\n`);
        }
      }
    }

    // Simpan response AI ke riwayat, lalu batasi lagi jika perlu
    conversations[threadId].push({ role: "assistant", content: fullResponse });
    if (conversations[threadId].length > MAX_HISTORY) {
      conversations[threadId] = conversations[threadId].slice(-MAX_HISTORY);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("Error calling Responses API:", err);
    res.write("data: [DONE]\n\n");
    res.end();
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
