const express = require("express");
const multer = require("multer");
const cors = require("cors");
const dotenv = require("dotenv");
const fs = require("fs");
const pdf = require("pdf-parse");
const OpenAI = require("openai");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"), false);
  },
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ HEALTH CHECK
app.get("/", (req, res) => {
  res.json({ status: "NyayaSetu Backend Running 🚀", version: "2.0" });
});

// 📂 UPLOAD + PROCESS PDF
app.post("/process", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No PDF file uploaded" });
  }

  const filePath = req.file.path;

  try {
    // 📄 Extract text from PDF
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdf(dataBuffer);
    const text = pdfData.text;

    if (!text || text.trim().length < 50) {
      fs.unlinkSync(filePath);
      return res.status(422).json({ error: "Could not extract readable text from PDF. It may be a scanned image-only document." });
    }

    // 🧠 AI PROMPT
    const prompt = `You are a legal AI assistant for Indian courts.

Analyze the following court judgment/order text and extract structured information.

Return ONLY valid JSON (no markdown, no explanation) in this exact format:
{
  "caseNumber": "",
  "judgmentDate": "",
  "presidingJudge": "",
  "court": "",
  "caseType": "",
  "parties": "",
  "summary": "",
  "riskLevel": "High|Medium|Low",
  "confidenceScore": 85,
  "actions": [
    {
      "task": "",
      "department": "",
      "departmentCode": "Revenue|Land Records|Police|Labour|Municipal|PWD|Other",
      "paragraph": "",
      "deadline": "",
      "priority": "High|Medium|Low"
    }
  ]
}

Rules:
- Extract REAL data from the document, not placeholders
- If a field is not found, use "Not specified"
- confidenceScore should be 60-95 based on text clarity
- riskLevel based on urgency and number of actions
- Extract ALL action items with responsible departments
- deadline format: DD Mon YYYY or "Not specified"

JUDGMENT TEXT:
${text.substring(0, 12000)}`;

    // 🤖 Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    });

    let aiResponse = completion.choices[0].message.content;

    // 🧹 Strip any markdown fences if present
    aiResponse = aiResponse.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    const parsed = JSON.parse(aiResponse);

    // 🧹 Clean up uploaded file
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      fileName: req.file.originalname,
      pages: pdfData.numpages,
      data: parsed,
    });

  } catch (err) {
    // Clean up file on error
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    console.error("Processing error:", err.message);

    if (err instanceof SyntaxError) {
      return res.status(500).json({ error: "AI returned malformed response. Please try again." });
    }
    if (err.status === 401) {
      return res.status(500).json({ error: "Invalid OpenAI API key. Check your .env file." });
    }
    if (err.status === 429) {
      return res.status(429).json({ error: "OpenAI rate limit hit. Please wait a moment and retry." });
    }

    res.status(500).json({ error: "Processing failed: " + err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n🚀 NyayaSetu Backend running on http://localhost:${PORT}`);
  console.log(`📋 POST http://localhost:${PORT}/process  — upload a PDF\n`);
});
