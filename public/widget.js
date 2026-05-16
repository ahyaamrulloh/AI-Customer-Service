(function () {
  // Ambil base URL backend dari lokasi script ini diload.
  // Jika script dipasang di: https://backend.railway.app/widget.js
  // Maka CHATBOT_URL = "https://backend.railway.app/"
  const CHATBOT_URL = document.currentScript.src.replace("/widget.js", "/");

  // ── Inject CSS ke halaman client ──────────────────────────
  // CSS dimasukkan ke <head> halaman client agar widget tidak
  // mengubah atau bertabrakan dengan CSS milik client
  const style = document.createElement("style");
  style.textContent = `
    /* Tombol chat floating di pojok kanan bawah */
    #kn-widget-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #4A2C2A;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
      z-index: 2147483647; /* z-index tertinggi agar selalu di atas semua elemen client */
      font-size: 24px;
      transition: transform 0.2s, background 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
    }

    #kn-widget-btn:hover {
      transform: scale(1.1);
      background: #7B4F3A;
    }

    /* Iframe chat — popup kecil di atas tombol.
       Sengaja pakai iframe agar CSS widget tidak bocor ke halaman client. */
    #kn-widget-frame {
      position: fixed;
      bottom: 90px;
      right: 24px;
      width: 370px;
      height: 500px;
      border: none;
      border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.25);
      z-index: 2147483646; /* Satu level di bawah tombol agar tombol tetap klikable */
      display: none;   /* Default tersembunyi — ditampilkan saat tombol diklik */
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.25s ease, transform 0.25s ease; /* Animasi muncul/hilang */
      background: white;
    }

    /* Kelas .kn-open ditambahkan via JS saat chat dibuka */
    #kn-widget-frame.kn-open {
      display: block;
      opacity: 1;
      transform: translateY(0);
    }

    /* ── Responsif Mobile ── */
    @media (max-width: 480px) {
      #kn-widget-frame {
        width: calc(100vw - 32px); /* Lebar hampir penuh layar dengan margin kiri-kanan 16px */
        height: 500px;             /* Tinggi fixed — JANGAN pakai vh karena berubah saat keyboard muncul */
        bottom: 90px;
        right: 16px;
        left: 16px;
        border-radius: 16px;
      }

      #kn-widget-btn {
        bottom: 16px;
        right: 16px;
      }
    }
  `;
  document.head.appendChild(style);

  // ── Buat tombol floating ──────────────────────────────────
  const btn = document.createElement("button");
  btn.id = "kn-widget-btn";
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="white">
    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
  </svg>`;
  btn.setAttribute("aria-label", "Buka chat");
  document.body.appendChild(btn);

  // ── Buat iframe chat ──────────────────────────────────────
  // src sengaja TIDAK diset di sini agar iframe tidak langsung load saat halaman dibuka.
  // Ini disebut "lazy load" — hemat bandwidth & request jika user tidak membuka chat.
  const iframe = document.createElement("iframe");
  iframe.id = "kn-widget-frame";
  iframe.setAttribute("title", "AI Chat Assistant");
  iframe.setAttribute("allow", "clipboard-write"); // Izinkan copy teks dari dalam iframe
  document.body.appendChild(iframe);

  let isOpen   = false; // State apakah chat sedang terbuka
  let isLoaded = false; // Flag agar src iframe hanya diset SATU KALI saat pertama dibuka

  // ── Toggle buka/tutup chat ────────────────────────────────
  btn.addEventListener("click", () => {
    isOpen = !isOpen;

    if (isOpen) {
      // Lazy load: set src hanya saat pertama kali dibuka
      // Setelah ini, meski chat ditutup & dibuka lagi, iframe tidak reload
      if (!isLoaded) {
        iframe.src = CHATBOT_URL;
        isLoaded = true;
      }

      // Tampilkan dengan animasi CSS: set display dulu, baru tambah class .kn-open
      // setTimeout kecil diperlukan agar browser sempat render display:block sebelum transisi CSS aktif
      iframe.style.display = "block";
      setTimeout(() => iframe.classList.add("kn-open"), 10);

      // Ganti ikon tombol menjadi X (tutup)
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>`;
      btn.setAttribute("aria-label", "Tutup chat");

    } else {
      // Sembunyikan dengan animasi: hapus class .kn-open dulu,
      // baru set display:none setelah transisi CSS selesai (250ms)
      iframe.classList.remove("kn-open");
      setTimeout(() => { iframe.style.display = "none"; }, 250);

      // Kembalikan ikon tombol ke chat bubble
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="white">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      </svg>`;
      btn.setAttribute("aria-label", "Buka chat");
    }
  });
})();
