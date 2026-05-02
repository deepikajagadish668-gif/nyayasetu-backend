const express = require("express");
const multer = require("multer");
const cors = require("cors");
const dotenv = require("dotenv");
const fs = require("fs");
const Groq = require("groq-sdk");

dotenv.config();

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.static(__dirname));
const upload = multer({ dest: "uploads/" });
const openai = new Groq({ apiKey: process.env.OPENAI_API_KEY });

app.get("/", (req, res) => {
  res.json({ status: "NyayaSetu Backend Running 🚀" });
});

app.post("/process", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const filePath = req.file.path;
  try {
    const dataBuffer = fs.readFileSync(filePath);
    let text = "";
    try {
      const pdfParse = require("pdf-parse/lib/pdf-parse.js");
      const pdfData = await pdfParse(dataBuffer);
      text = pdfData.text;
    } catch(e) {
      text = dataBuffer.toString("latin1").replace(/[^\x20-\x7E\n]/g, " ").trim();
    }

    if (!text || text.length < 100) {
      fs.unlinkSync(filePath);
      return res.status(422).json({ error: "Could not extract text from PDF." });
    }

    const prompt = `You are a legal AI assistant for Indian courts.

Analyze the following court judgment and return ONLY valid JSON, no markdown, no explanation:
{
  "caseNumber": "",
  "judgmentDate": "",
  "presidingJudge": "",
  "court": "",
  "caseType": "",
  "parties": "",
  "riskLevel": "High|Medium|Low",
  "confidenceScore": 85,
  "summary": "2-3 sentence simple English summary of the case for a common person",
  "verdict": "The final decision/order of the court in 1-2 sentences",
  "verdictType": "Allowed|Dismissed|Partly Allowed|Remanded|Stayed",
  "keyPoints": [
    "Key point 1 in simple language",
    "Key point 2 in simple language",
    "Key point 3 in simple language",
    "Key point 4 in simple language"
  ],
  "legalTopics": ["Constitutional Law", "Criminal Law"],
  "actions": [
    {
      "task": "",
      "department": "",
      "departmentCode": "Revenue|Land Records|Police|Labour|Municipal|PWD|Law and Justice|Other",
      "paragraph": "",
      "deadline": "",
      "priority": "High|Medium|Low"
    }
  ]
}

Rules:
- summary must be in very simple English, avoid legal jargon
- verdict must be clear and direct
- keyPoints should be 3-5 bullet points a common person can understand
- legalTopics should be 2-4 tags like: Constitutional Law, Criminal Law, Property Law, Contract Law, Family Law, Labour Law, Tax Law, Environmental Law, Human Rights, etc.
- Extract ALL action items with responsible departments

JUDGMENT TEXT:
${text.substring(0, 12000)}`;

    const completion = await openai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    });

    let aiResponse = completion.choices[0].message.content;
    aiResponse = aiResponse.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    fs.unlinkSync(filePath);
    res.json({ success: true, judgmentText: text.substring(0, 12000), data: JSON.parse(aiResponse) });

  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    console.error("Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 💬 CHAT ENDPOINT
app.post("/chat", async (req, res) => {
  const { question, judgmentText, history = [] } = req.body;
  if (!question || !judgmentText) return res.status(400).json({ error: "Missing question or judgment text" });

  try {
    const messages = [
      {
        role: "system",
        content: `You are a helpful legal assistant. Answer questions ONLY based on the court judgment text provided below. 
If the answer is not in the judgment, say "I could not find that in this judgment."
Keep answers clear, simple, and concise. Avoid heavy legal jargon.

JUDGMENT TEXT:
${judgmentText}`
      },
      ...history,
      { role: "user", content: question }
    ];

    const completion = await openai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.3,
      max_tokens: 500,
    });

    res.json({ answer: completion.choices[0].message.content });

  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 5000, () => {
  console.log(`🚀 NyayaSetu Backend running on http://localhost:5000`);
  console.log(`📋 POST http://localhost:5000/process  — upload a PDF`);
});