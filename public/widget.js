(function () {
  // Ambil base URL dari lokasi script ini diload
  const CHATBOT_URL = document.currentScript.src.replace("/widget.js", "/");

  const style = document.createElement("style");
  style.textContent = `
    /* Tombol ☕ floating di pojok kanan bawah */
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
      z-index: 2147483647;
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

    /* Iframe chat — popup kecil di atas tombol, tidak ganggu layout client */
    #kn-widget-frame {
      position: fixed;
      bottom: 90px;
      right: 24px;
      width: 370px;
      height: 540px;
      border: none;
      border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.25);
      z-index: 2147483646;
      display: none;
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.25s ease, transform 0.25s ease;
      background: white;
    }

    /* Kelas active untuk animasi muncul */
    #kn-widget-frame.kn-open {
      display: block;
      opacity: 1;
      transform: translateY(0);
    }

    /* ─── MOBILE ─── */
    @media (max-width: 480px) {
      #kn-widget-frame {
        /* Di mobile: popup kecil di atas tombol, bukan fullscreen */
        width: calc(100vw - 32px);  /* Lebar penuh dikurangi margin kiri-kanan */
        height: 65vh;               /* 65% tinggi layar agar tidak nutup navbar HP */
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

  // Membuat tombol ☕ floating
  const btn = document.createElement("button");
  btn.id = "kn-widget-btn";
  btn.innerHTML = "☕";
  btn.setAttribute("aria-label", "Buka chat Coffee Nusantara");
  document.body.appendChild(btn);

  // Membuat iframe yang memuat halaman chat
  // Iframe di-render di dalam DOM tapi display:none sampai dibuka
  const iframe = document.createElement("iframe");
  iframe.id = "kn-widget-frame";
  iframe.setAttribute("title", "Coffee Nusantara CS");
  iframe.setAttribute("allow", "clipboard-write");
  // src belum diset agar tidak load sebelum dibuka (hemat bandwidth)
  document.body.appendChild(iframe);

  let isOpen = false;
  let isLoaded = false; // Flag agar src iframe hanya diset sekali saat pertama dibuka

  btn.addEventListener("click", () => {
    isOpen = !isOpen;

    if (isOpen) {
      // Set src hanya saat pertama dibuka (lazy load)
      if (!isLoaded) {
        iframe.src = CHATBOT_URL;
        isLoaded = true;
      }

      // Tampilkan dengan animasi: set display dulu baru tambah class kn-open
      iframe.style.display = "block";
      // Timeout kecil agar transisi CSS bisa berjalan
      setTimeout(() => iframe.classList.add("kn-open"), 10);
      btn.innerHTML = "✕";
      btn.setAttribute("aria-label", "Tutup chat");
    } else {
      // Sembunyikan dengan animasi: hapus class dulu, baru sembunyikan setelah transisi selesai
      iframe.classList.remove("kn-open");
      setTimeout(() => {
        iframe.style.display = "none";
      }, 250);
      btn.innerHTML = "☕";
      btn.setAttribute("aria-label", "Buka chat Coffee Nusantara");
    }
  });
})();
