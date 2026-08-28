require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
// randomBytes digunakan untuk membuat thread_id yang aman secara kriptografi
// jauh lebih aman dibanding Math.random() yang bisa diprediksi
const { randomBytes } = require("crypto");
const OpenAI = require("openai");
const rateLimit = require("express-rate-limit");

const app = express();

// ─────────────────────────────────────────────
// TRUST PROXY
// Wajib aktif jika server berjalan di balik proxy seperti Railway atau Nginx.
// Tanpa ini, semua request terlihat dari 1 IP yang sama sehingga
// rate limiter tidak efektif sama sekali — semua user terkena limit bersama.
// Nilai "1" = percaya 1 layer proxy di depan server ini.
// ─────────────────────────────────────────────
app.set("trust proxy", 1);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ─────────────────────────────────────────────
// LOAD SYSTEM PROMPT DARI FILE EKSTERNAL
// Prompt dipisah ke file .txt agar bisa diupdate kapan saja
// tanpa harus mengubah kode dan redeploy ulang ke Railway.
// Cukup edit file .txt → restart server → prompt langsung berubah.
// ─────────────────────────────────────────────
let SYSTEM_PROMPT;

// Cek apakah ada path custom di .env, jika tidak pakai default
const PROMPT_FILE = process.env.SYSTEM_PROMPT_FILE
  ? path.resolve(process.env.SYSTEM_PROMPT_FILE)
  : path.join(__dirname, "prompts", "assistant.txt");

try {
  // Baca file prompt sebagai string UTF-8 saat server pertama kali start
  SYSTEM_PROMPT = fs.readFileSync(PROMPT_FILE, "utf-8").trim();
  console.log(`[PROMPT] Dimuat dari: ${PROMPT_FILE}`);
} catch {
  // Jika file tidak ada, server tetap berjalan dengan prompt fallback minimal
  // agar tidak langsung crash dan memudahkan debugging
  console.warn(`[PROMPT] File tidak ditemukan: ${PROMPT_FILE} — menggunakan fallback`);
  SYSTEM_PROMPT =
    "Kamu adalah Sales Terbaik di dunia yang ramah dan membantu. Jawab pertanyaan dengan sopan dalam Bahasa Indonesia.";
}

// ─────────────────────────────────────────────
// KONFIGURASI CORS
// Whitelist domain yang boleh mengakses backend ini.
// Domain di luar daftar akan langsung ditolak dengan error.
// ─────────────────────────────────────────────

// Tambahkan origin default untuk development agar tidak error saat lokal
const DEFAULT_DEV_ORIGINS = [
  "http://localhost:8080",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
  "http://127.0.0.1:5501",
  "https://ai-customer-service-eight.vercel.app",
];

// Gabungkan origin dari .env dengan origin development default
const ALL_ORIGINS = [...DEFAULT_DEV_ORIGINS];

app.use(
  cors({
    origin: (origin, callback) => {
      // Request tanpa origin (Postman, curl) diizinkan — berguna saat testing
      if (!origin) return callback(null, true);

      if (ALL_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        // Log origin yang ditolak agar mudah debug saat client komplain "tidak bisa akses"
        console.warn(`[CORS] Ditolak: ${origin}`);
        callback(new Error(`Origin tidak diizinkan: ${origin}`));
      }
    },
  })
);

// ─────────────────────────────────────────────
// RATE LIMITER — /start (pembuatan sesi baru)
// 1 IP hanya boleh membuat 10 sesi baru per jam.
// Efektif karena trust proxy sudah diaktifkan di atas.
// ─────────────────────────────────────────────
const startLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // Window: 1 jam
  max: 10,
  message: { error: "Terlalu banyak sesi dibuat. Coba lagi dalam 1 jam." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─────────────────────────────────────────────
// RATE LIMITER — /chat (pengiriman pesan)
// 1 IP hanya boleh mengirim 30 pesan per menit.
// Mencegah spam yang bisa membengkakkan tagihan OpenAI secara masif.
// ─────────────────────────────────────────────
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // Window: 1 menit
  max: 30,
  message: { error: "Terlalu banyak pesan. Tunggu sebentar sebelum mengirim lagi." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(bodyParser.json());

// Sajikan file statis dari folder /public (index.html, widget.js, dll)
app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────────
// KONSTANTA KONFIGURASI
// Dikumpulkan di satu tempat agar mudah diubah tanpa mencari-cari di kode
// ─────────────────────────────────────────────
const MAX_HISTORY = 10;          // Maks 10 pesan terakhir per sesi (5 pasang tanya-jawab)
const SESSION_TTL = 30 * 60 * 1000; // Sesi expired setelah 30 menit tidak aktif
const MAX_SESSIONS = 500;        // Batas total sesi aktif di memory secara bersamaan
const MAX_MSG_LEN = 500;         // Batas panjang pesan user dalam karakter
const STREAM_TIMEOUT = 30_000;   // Timeout 30 detik untuk stream OpenAI

// ─────────────────────────────────────────────
// STORE MEMORY SESI
// Object biasa di memory — cukup untuk skala kecil-menengah.
// Jika butuh multi-instance atau persistent, ganti dengan Redis.
// ─────────────────────────────────────────────
const conversations = {};    // { threadId: [{ role, content }, ...] }
const sessionTimestamps = {}; // { threadId: Date.now() }

// ─────────────────────────────────────────────
// CLEANUP SESI EXPIRED
// Berjalan setiap 10 menit untuk menghapus sesi yang tidak aktif lebih dari SESSION_TTL.
// Tanpa ini, object conversations akan terus membesar dan akhirnya crash (OOM).
// ─────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;

  for (const id in sessionTimestamps) {
    if (now - sessionTimestamps[id] > SESSION_TTL) {
      delete conversations[id];     // Hapus riwayat percakapan dari memory
      delete sessionTimestamps[id]; // Hapus catatan waktu aktivitas sesi
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(
      `[CLEANUP] ${cleaned} sesi dihapus | Aktif: ${Object.keys(conversations).length}`
    );
  }
}, 10 * 60 * 1000); // Interval: setiap 10 menit

// ─────────────────────────────────────────────
// ROUTE: GET /health
// Endpoint monitoring — Railway, UptimeRobot, atau tools lain ping ke sini
// untuk memastikan server masih hidup. Juga berguna untuk melihat beban server.
// ─────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    activeSessions: Object.keys(conversations).length, // Berapa sesi aktif saat ini
    uptime: Math.floor(process.uptime()) + "s",         // Berapa lama server sudah berjalan
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────
// ROUTE: GET /start
// Membuat sesi baru dan mengembalikan thread_id yang aman secara kriptografi.
// Rate limiter dipasang untuk mencegah pembuatan sesi berlebihan.
// ─────────────────────────────────────────────
app.get("/start", startLimiter, (req, res) => {
  // Tolak sesi baru jika sudah mencapai kapasitas maksimum
  // Mencegah server OOM (Out of Memory) saat traffic sangat tinggi
  if (Object.keys(conversations).length >= MAX_SESSIONS) {
    console.warn("[START] Batas sesi tercapai:", MAX_SESSIONS);
    return res.status(503).json({ error: "Server sedang sibuk. Coba lagi dalam beberapa menit." });
  }

  // 32 byte random → encode hex = 64 karakter unik yang tidak bisa ditebak atau di-brute force
  // Jauh lebih aman dari: `thread_${Date.now()}_${Math.random()}`
  const threadId = randomBytes(32).toString("hex");

  conversations[threadId] = [];         // Inisialisasi array riwayat kosong untuk sesi ini
  sessionTimestamps[threadId] = Date.now(); // Catat kapan sesi ini dibuat

  console.log(
    `[START] Sesi baru: ${threadId.slice(0, 8)}... | Total aktif: ${Object.keys(conversations).length}`
  );
  return res.json({ thread_id: threadId });
});

// ─────────────────────────────────────────────
// ROUTE: POST /chat
// Menerima pesan user → validasi → kirim ke OpenAI → streaming response ke frontend.
// ─────────────────────────────────────────────
app.post("/chat", chatLimiter, async (req, res) => {
  const { thread_id: threadId, message } = req.body;

  // ── Validasi thread_id ──────────────────────
  if (!threadId || typeof threadId !== "string") {
    return res.status(400).json({ error: "thread_id tidak valid." });
  }

  // Pastikan format thread_id adalah hex 64 karakter (hasil randomBytes(32).toString("hex"))
  // Ini mencegah injeksi karakter aneh atau manipulasi parameter dari luar
  if (!/^[a-f0-9]{64}$/.test(threadId)) {
    return res.status(400).json({ error: "Format thread_id tidak dikenali." });
  }

  if (!conversations[threadId]) {
    return res.status(400).json({
      error: "Sesi tidak ditemukan atau sudah expired. Silakan refresh halaman.",
    });
  }

  // ── Validasi pesan user ─────────────────────
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Pesan tidak boleh kosong." });
  }

  // Potong pesan jika melebihi batas → hapus whitespace → cek tidak kosong
  // Langkah ini mencegah prompt injection panjang dan menghemat biaya token OpenAI
  const trimmed = message.trim().slice(0, MAX_MSG_LEN);

  if (trimmed.length === 0) {
    return res.status(400).json({ error: "Pesan tidak boleh hanya berisi spasi." });
  }

  // Perbarui timestamp aktivitas agar sesi ini tidak dihapus oleh cleanup
  sessionTimestamps[threadId] = Date.now();

  console.log(
    `[CHAT] ${threadId.slice(0, 8)}... | "${trimmed.slice(0, 60)}${trimmed.length > 60 ? "…" : ""}"`
  );

  // Tambahkan pesan user yang sudah divalidasi ke riwayat sesi
  conversations[threadId].push({ role: "user", content: trimmed });

  // Pangkas riwayat agar tidak melebihi MAX_HISTORY
  // Mencegah context window membengkak dan menghemat biaya token per request
  if (conversations[threadId].length > MAX_HISTORY) {
    conversations[threadId] = conversations[threadId].slice(-MAX_HISTORY);
  }

  // Set header SSE (Server-Sent Events) untuk streaming response ke frontend
  // Content-Type: text/event-stream memberitahu browser ini adalah stream, bukan response biasa
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // ── Timeout Guard ────────────────────────────
  // Jika OpenAI tidak merespons dalam STREAM_TIMEOUT milidetik,
  // tutup koneksi secara paksa agar resource server tidak terbuang percuma (hanging connection).
  let streamDone = false;
  const timeoutId = setTimeout(() => {
    if (!streamDone) {
      console.warn(`[TIMEOUT] ${threadId.slice(0, 8)}...`);
      res.write(
        `data: ${JSON.stringify({ text: "\n\n_Waktu habis. Silakan kirim ulang pesan._" })}\n\n`
      );
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }, STREAM_TIMEOUT);

  try {
    // Panggil OpenAI Responses API dengan mode streaming
    const stream = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini", // Model bisa diatur via .env
      instructions: SYSTEM_PROMPT,
      input: conversations[threadId], // Kirim seluruh riwayat (yang sudah dipangkas) sebagai konteks
      stream: true,
    });

    let fullResponse = ""; // Akumulasi seluruh teks response untuk disimpan ke riwayat

    for await (const event of stream) {
      // Hanya proses event yang mengandung delta teks — abaikan event metadata lainnya
      if (event.type === "response.output_text.delta" && event.delta) {
        // Hapus pola citation OpenAI seperti 【16:2†source】 yang tidak perlu ditampilkan ke user
        const chunk = event.delta.replace(/【[^】]*】/g, "");
        if (chunk) {
          fullResponse += chunk;
          // Kirim potongan teks ke frontend dalam format SSE: "data: {...}\n\n"
          res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        }
      }
    }

    // Stream selesai dengan normal — batalkan timeout guard
    streamDone = true;
    clearTimeout(timeoutId);

    // Simpan response lengkap AI ke riwayat sesi agar bisa jadi konteks di pesan berikutnya
    conversations[threadId].push({ role: "assistant", content: fullResponse });

    // Pangkas lagi riwayat setelah response AI ditambahkan
    if (conversations[threadId].length > MAX_HISTORY) {
      conversations[threadId] = conversations[threadId].slice(-MAX_HISTORY);
    }

    // Kirim sinyal [DONE] ke frontend sebagai tanda stream selesai
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    // Pastikan timeout selalu dibatalkan meski ada error, agar tidak double-end response
    streamDone = true;
    clearTimeout(timeoutId);

    // Log detail error HANYA di server — JANGAN kirim info teknis ke client
    // err bisa mengandung detail sensitif seperti API key, endpoint internal, dsb.
    console.error(
      `[ERROR] OpenAI ${threadId.slice(0, 8)}...:`,
      err?.status,
      err?.message
    );

    // Kirim pesan error yang ramah tanpa detail teknis
    res.write(
      `data: ${JSON.stringify({ text: "Maaf, terjadi gangguan sementara. Silakan coba beberapa saat lagi." })}\n\n`
    );
    res.write("data: [DONE]\n\n");
    res.end();
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`\n[SERVER] Berjalan di port ${PORT}`);
  console.log(`[SERVER] Model    : ${process.env.OPENAI_MODEL || "gpt-4.1-mini"}`);
  console.log(`[SERVER] Maks sesi: ${MAX_SESSIONS}`);
  console.log(`[SERVER] Maks msg : ${MAX_MSG_LEN} karakter`);
  console.log(`[SERVER] Timeout  : ${STREAM_TIMEOUT / 1000} detik\n`);
});
