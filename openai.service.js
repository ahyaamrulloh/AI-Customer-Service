const fs = require("fs");
const createAssistant = async (openai) => {
  const assistantFilePath = "assistant.json";
  if (!fs.existsSync(assistantFilePath)) {
    const file = await openai.files.create({
      file: fs.createReadStream("knowledge.docx"),
      purpose: "assistants",
    });
    let vectorStore = await openai.beta.vectorStores.create({
      name: "Kopi Nusantara",
      file_ids: [file.id],
    });
    const assistant = await openai.beta.assistants.create({
      name: "Kopi Nusantara Assistant",
      instructions: `Kamu adalah asisten virtual Kopi Nusantara, sebuah kafe lokal di Pandeglang, Banten.
Tugasmu adalah membantu pelanggan dengan menjawab pertanyaan seputar menu, harga, jam operasional, fasilitas, cara order, promo, dan informasi lainnya tentang Kopi Nusantara.
Jawab dengan ramah, sopan, dan gunakan Bahasa Indonesia.
Semua informasi ada di dokumen yang telah disediakan. Jika pertanyaan di luar konteks Kopi Nusantara, arahkan pelanggan untuk menghubungi WhatsApp kami di 087772739046.
PENTING: Jangan pernah tampilkan citation, referensi, atau tanda kurung seperti [angka†nama_file] dalam jawabanmu. Jawab langsung tanpa menyebut sumber dokumen apapun.`,
      tools: [{ type: "file_search" }],
      tool_resources: { file_search: { vector_store_ids: [vectorStore.id] } },
      model: "gpt-4o",
    });
    fs.writeFileSync(assistantFilePath, JSON.stringify(assistant));
    return assistant;
  } else {
    const assistant = JSON.parse(fs.readFileSync(assistantFilePath));
    return assistant;
  }
};
module.exports = { createAssistant };
