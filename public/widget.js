(function () {
  const CHATBOT_URL = document.currentScript.src.replace("/widget.js", "/");

  const style = document.createElement("style");
  style.textContent = `
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
      z-index: 999999;
      font-size: 26px;
      transition: transform 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #kn-widget-btn:hover { transform: scale(1.1); }

    #kn-widget-frame {
      position: fixed;
      bottom: 90px;        /* Jarak dari tombol ☕ */
      right: 24px;
      width: 380px;
      height: 560px;       /* Tinggi tetap, tidak pakai max-height lagi */
      border: none;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      z-index: 999999;     /* Sama tinggi dengan tombol agar tidak tertimpa elemen client */
      display: none;
    }

    @media (max-width: 480px) {
      #kn-widget-frame {
        width: 100%;
        height: 100%;
        bottom: 0;
        right: 0;
        border-radius: 0;
      }
    }
  `;
  document.head.appendChild(style);

  // Membuat tombol ☕ yang muncul di pojok kanan bawah website client
  const btn = document.createElement("button");
  btn.id = "kn-widget-btn";
  btn.innerHTML = "☕";
  btn.setAttribute("aria-label", "Buka chat");
  document.body.appendChild(btn);

  // Membuat iframe yang memuat halaman chat dari server Railway
  const iframe = document.createElement("iframe");
  iframe.id = "kn-widget-frame";
  iframe.src = CHATBOT_URL;
  iframe.setAttribute("title", "Coffee Nusantara Assistant");
  // Izinkan iframe mengakses clipboard dan fitur browser lainnya jika dibutuhkan
  iframe.setAttribute("allow", "clipboard-write");
  document.body.appendChild(iframe);

  // Toggle buka/tutup widget saat tombol diklik
  let isOpen = false;
  btn.addEventListener("click", () => {
    isOpen = !isOpen;
    iframe.style.display = isOpen ? "block" : "none";
    btn.innerHTML = isOpen ? "✕" : "☕";
    btn.setAttribute("aria-label", isOpen ? "Tutup chat" : "Buka chat");
  });
})();
