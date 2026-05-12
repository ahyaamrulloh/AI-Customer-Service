require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const app = express();
const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const { createAssistant } = require("./openai.service");
app.use(cors());
app.use(bodyParser.json());
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

(async () => {
  const assistant = await createAssistant(openai);

  app.get("/start", async (req, res) => {
    const thread = await openai.beta.threads.create();
    return res.json({ thread_id: thread.id });
  });

  app.post("/chat", async (req, res) => {
    const assistantId = assistant.id;
    const threadId = req.body.thread_id;
    const message = req.body.message;
    if (!threadId) {
      return res.status(400).json({ error: "Missing thread_id" });
    }
    console.log(`Received message: ${message} for thread ID: ${threadId}`);

    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    });

    // Streaming response
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = openai.beta.threads.runs.stream(threadId, {
      assistant_id: assistantId,
    });

    stream.on("textDelta", (delta) => {
      // Filter citation patterns like 【16:2†knowledge.docx】
      const clean = delta.value.replace(/【[^】]*】/g, "");
      if (clean) {
        res.write(`data: ${JSON.stringify({ text: clean })}\n\n`);
      }
    });

    stream.on("end", () => {
      res.write("data: [DONE]\n\n");
      res.end();
    });

    stream.on("error", (err) => {
      console.error("Stream error:", err);
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });

  app.listen(8080, () => {
    console.log("Server running on port 8080");
  });
})();
