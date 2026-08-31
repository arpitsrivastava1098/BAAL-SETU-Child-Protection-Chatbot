import express from "express";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pdfParse from "pdf-parse";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PDF_URLS = [
  "https://arpitsrivastava.co.in/resources/Kawach%20Madule.pdf",
  "https://arpitsrivastava.co.in/resources/Meena%20munch%20module.pdf",
  "https://arpitsrivastava.co.in/resources/CWPC%20Strengthening%20and%20Activation%20Process%20Document.pdf",
  "https://arpitsrivastava.co.in/resources/Bal%20sanrakshan%2010-03-2026%20(1).pdf",
  "https://arpitsrivastava.co.in/resources/SHG%20Module.pdf",
  "https://arpitsrivastava.co.in/resources/Yojana%20Module%2004-26.pdf",
  "https://arpitsrivastava.co.in/resources/Child-Trafficking-Resource.pdf"
];

const textKnowledgePath = path.join(__dirname, "knowledge.txt");
let documents = [];
let chunks = [];
let pdfCount = 0;

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function makeChunks(text, size = 1400, overlap = 200) {
  const clean = normalizeText(text);
  const result = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);

    if (end < clean.length) {
      const boundary = Math.max(
        clean.lastIndexOf("\n\n", end),
        clean.lastIndexOf(". ", end),
        clean.lastIndexOf(" ", end)
      );
      if (boundary > start + Math.floor(size * 0.65)) end = boundary + 1;
    }

    result.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return result.filter(Boolean);
}

async function loadPdfFromUrl(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  const pdf = await pdfParse(buffer);

  return {
    text: normalizeText(pdf.text),
    pages: pdf.numpages || 0
  };
}

async function loadKnowledgeBase() {
  documents = [];
  chunks = [];
  pdfCount = 0;

  try {
    if (fs.existsSync(textKnowledgePath)) {
      const text = normalizeText(fs.readFileSync(textKnowledgePath, "utf8"));
      if (text) documents.push({ name: "knowledge.txt", text });
    }
  } catch (error) {
    console.error("knowledge.txt error:", error.message);
  }

  console.log(`Loading ${PDF_URLS.length} PDF resources...`);

  for (const url of PDF_URLS) {
    const name = decodeURIComponent(url.split("/").pop());

    try {
      const result = await loadPdfFromUrl(url);

      if (!result.text) {
        console.warn(`No readable text: ${name}`);
        continue;
      }

      documents.push({
        name,
        text: result.text,
        url,
        pages: result.pages
      });

      pdfCount++;
      console.log(`PDF loaded: ${name} | pages=${result.pages} | chars=${result.text.length}`);
    } catch (error) {
      console.error(`PDF failed: ${name} | ${error.message}`);
    }
  }

  for (const doc of documents) {
    for (const text of makeChunks(doc.text)) {
      chunks.push({
        source: doc.name,
        url: doc.url || null,
        text
      });
    }
  }

  console.log(`Knowledge base ready: ${pdfCount} PDFs, ${chunks.length} searchable chunks.`);
}

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "what", "how", "why", "with", "from",
  "this", "that", "can", "does", "about", "according", "please", "tell",
  "give", "kya", "hai", "ka", "ki", "ke", "ko", "me", "mein", "se",
  "aur", "par", "ya"
]);

function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f\s]/gi, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

function searchChunks(question) {
  const queryTokens = [...new Set(tokenize(question))];

  if (!queryTokens.length) return chunks.slice(0, 3);

  return chunks
    .map(chunk => {
      const text = chunk.text.toLowerCase();
      let score = 0;

      for (const token of queryTokens) {
        let count = 0;
        let pos = 0;

        while ((pos = text.indexOf(token, pos)) !== -1) {
          count++;
          pos += token.length;
          if (count >= 4) break;
        }

        score += Math.min(count, 4);
      }

      score += queryTokens.filter(t => text.includes(t)).length * 3;

      return { ...chunk, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

if (!process.env.GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is not configured.");
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const baseInstructions = `
You are KAWACH Child Protection Chatbot for children and adolescents in India.

Always answer exactly in this format:

English:
[Simple, clear English answer]

Hindi:
[Same answer in simple Hindi]

KNOWLEDGE RULES:
- Use the supplied PDF excerpts as the primary factual source.
- Do not invent facts, laws, sections, penalties, procedures, contacts or government claims.
- If the supplied excerpts do not support a specific fact, say that you cannot verify it from the available KAWACH resources.
- Mention the source PDF name when useful.
- Keep answers concise and directly relevant to the question.

SAFETY:
- Immediate danger: move to a safe place, contact a trusted adult, 112 for emergency help and 1098 Child Helpline.
- Never ask for passwords, OTPs, Aadhaar, bank details, exact home address or unnecessary identifying information.
- Never promise secrecy. Do not blame, shame, threaten or pressure a child.
- For sexual abuse, trafficking, violence, child marriage, child labour, exploitation, neglect, missing children, online safety or self-harm, prioritize safety and real-world support.
- If self-harm/suicide is mentioned, encourage immediate trusted-adult/emergency support and never provide methods.
- Legal answers are general information, not legal advice.
- Be calm, respectful, child-friendly and non-judgmental.
`;

app.use(express.json({ limit: "32kb" }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "KAWACH Child Protection Chatbot",
    ai: "Gemini",
    pdfKnowledgeBase: pdfCount > 0 ? "loaded" : "no PDFs loaded",
    pdfCount,
    searchableChunks: chunks.length
  });
});

app.get("/api/knowledge-status", (req, res) => {
  res.json({
    status: "ok",
    pdfCount,
    searchableChunks: chunks.length,
    sources: documents.map(d => d.name)
  });
});

async function generateGeminiResponse(message) {
  const relevant = searchChunks(message);

  const context = relevant.length
    ? relevant
        .map((item, i) => `SOURCE ${i + 1}: ${item.source}\n${item.text}`)
        .join("\n\n---\n\n")
    : "No relevant PDF excerpt was found.";

  const systemInstruction = `${baseInstructions}\n\nRELEVANT RESOURCE EXCERPTS:\n${context}\n\nEND RESOURCE EXCERPTS.`;

  // Fast model first. Minimal thinking is supported by Gemini 3.5 Flash-Lite.
  const models = [
    { name: "gemini-3.5-flash-lite", thinkingLevel: "minimal" },
    { name: "gemini-3.6-flash", thinkingLevel: "minimal" }
  ];

  let lastError = null;

  for (const model of models) {
    try {
      console.log(`Trying fast model: ${model.name}`);

      const response = await ai.models.generateContent({
        model: model.name,
        contents: message,
        config: {
          systemInstruction,
          maxOutputTokens: 700,
          thinkingConfig: {
            thinkingLevel: model.thinkingLevel
          }
        }
      });

      return response.text || "No response was generated.";
    } catch (error) {
      lastError = error;
      console.error(`Gemini error | ${model.name}:`, error?.message || error);
    }
  }

  throw lastError;
}

app.post("/api/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();

    if (!message) {
      return res.status(400).json({ error: "Please enter a question." });
    }

    if (message.length > 4000) {
      return res.status(400).json({
        error: "Question is too long. Please keep it under 4000 characters."
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        error: "AI service is not configured yet."
      });
    }

    const answer = await generateGeminiResponse(message);
    return res.json({ answer });
  } catch (error) {
    console.error("KAWACH FINAL ERROR:", error?.message || error);

    return res.status(503).json({
      error: "KAWACH is temporarily busy. Please try again in a few seconds. If you need immediate help, contact 1098 or 112."
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "Page or API endpoint not found."
  });
});

async function startServer() {
  await loadKnowledgeBase();

  app.listen(port, "0.0.0.0", () => {
    console.log(`KAWACH running on port ${port}`);
    console.log(`PDF Knowledge Base: ${pdfCount} PDF(s)`);
    console.log(`Searchable chunks: ${chunks.length}`);
  });
}

startServer().catch(error => {
  console.error("KAWACH SERVER START ERROR:", error);
  process.exit(1);
});
