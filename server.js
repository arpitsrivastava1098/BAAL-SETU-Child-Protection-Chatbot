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

// =====================================================
// PDF KNOWLEDGE SOURCES
// =====================================================

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
let pdfCount = 0;
let knowledge = "";

// =====================================================
// LOAD PDF FROM URL
// =====================================================

async function loadPdfFromUrl(url) {
  const response = await fetch(url, {
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const pdf = await pdfParse(buffer);

  return {
    text: (pdf.text || "").trim(),
    pages: pdf.numpages || 0
  };
}

// =====================================================
// LOAD KNOWLEDGE BASE
// =====================================================

async function loadKnowledgeBase() {
  documents = [];
  pdfCount = 0;
  knowledge = "";

  // Existing knowledge.txt
  try {
    if (fs.existsSync(textKnowledgePath)) {
      const text = fs.readFileSync(textKnowledgePath, "utf8").trim();
      if (text) {
        documents.push({
          name: "knowledge.txt",
          text
        });
      }
    }
  } catch (error) {
    console.error("knowledge.txt error:", error.message);
  }

  console.log(`Loading ${PDF_URLS.length} PDF resources...`);

  for (const url of PDF_URLS) {
    const fileName = decodeURIComponent(url.split("/").pop());

    try {
      const result = await loadPdfFromUrl(url);

      if (!result.text) {
        console.warn(`No readable text: ${fileName}`);
        continue;
      }

      documents.push({
        name: fileName,
        text: result.text,
        url
      });

      pdfCount++;

      console.log(
        `PDF loaded: ${fileName} | pages=${result.pages} | characters=${result.text.length}`
      );
    } catch (error) {
      console.error(`PDF failed: ${fileName} | ${error.message}`);
    }
  }

  knowledge = documents
    .map(doc => `===== SOURCE: ${doc.name} =====\n${doc.text}`)
    .join("\n\n");

  console.log(`Knowledge base ready. PDFs loaded: ${pdfCount}`);
  console.log(`Total knowledge characters: ${knowledge.length}`);
}

// =====================================================
// RELEVANT PDF SEARCH
// =====================================================

function getRelevantKnowledge(question) {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097F\s]/gi, " ")
    .split(/\s+/)
    .filter(word => word.length >= 3);

  if (!words.length) {
    return documents
      .slice(0, 3)
      .map(doc => `SOURCE: ${doc.name}\n${doc.text.slice(0, 5000)}`)
      .join("\n\n");
  }

  const scored = documents.map(doc => {
    const text = doc.text.toLowerCase();
    let score = 0;

    for (const word of words) {
      let index = 0;
      while ((index = text.indexOf(word, index)) !== -1) {
        score++;
        index += word.length;
        if (score >= 80) break;
      }
      if (score >= 80) break;
    }

    return { ...doc, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const selected = scored
    .filter(doc => doc.score > 0)
    .slice(0, 4);

  // If no exact word match, provide a small sample from the first documents.
  const finalDocs = selected.length
    ? selected
    : scored.slice(0, 3);

  const MAX_CHARS_PER_DOC = 12000;

  return finalDocs
    .map(doc => {
      const text = doc.text.length > MAX_CHARS_PER_DOC
        ? doc.text.slice(0, MAX_CHARS_PER_DOC) + "\n[Document excerpt truncated]"
        : doc.text;

      return `SOURCE: ${doc.name}\n${text}`;
    })
    .join("\n\n--------------------------------\n\n");
}

// =====================================================
// GEMINI
// =====================================================

if (!process.env.GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is not configured.");
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// =====================================================
// KAWACH INSTRUCTIONS
// =====================================================

const baseInstructions = `
You are KAWACH Child Protection Chatbot for children and adolescents in India.

Your purpose is to provide child-friendly education, child protection information,
safety guidance and directions to appropriate official help.

You are NOT a police officer, lawyer, doctor, emergency service, or substitute for a qualified professional.

MANDATORY RESPONSE FORMAT:

English:
[Answer in simple, clear English]

Hindi:
[Same answer in simple Hindi]

Always provide both English and Hindi.

KNOWLEDGE RULES:
- Use the supplied KAWACH PDF excerpts as the primary source for factual answers.
- Do not invent facts, laws, sections, penalties, procedures, schemes, contacts or government claims.
- If the supplied resources do not support a specific fact, say that you cannot verify it from the available KAWACH resources.
- When useful, mention the source PDF name.
- Do not claim that information came from a PDF if it is not present in the supplied excerpts.
- General safety guidance may be given when necessary even if it is not in the PDFs.

SAFETY:
- If the user is in immediate danger, prioritize getting to a safe place.
- Encourage contacting a trusted adult.
- Encourage 112 for emergency assistance.
- Encourage Child Helpline 1098.
- Do not ask for passwords, OTPs, Aadhaar numbers, bank details, exact home address, or other unnecessary sensitive information.
- Never promise secrecy.
- Do not blame, shame, threaten or pressure a child.
- For sexual abuse, trafficking, violence, child marriage, child labour, exploitation, neglect, missing children, online safety or self-harm, focus on safety and appropriate real-world support.
- If self-harm or suicide is mentioned, encourage immediate support from a trusted adult and emergency assistance if there is immediate danger. Never provide methods or instructions.
- For specific legal cases, explain that the answer is general information and recommend an appropriate authority or qualified legal professional.
- Be calm, respectful, child-friendly and non-judgmental.
`;

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(express.json({ limit: "32kb" }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "KAWACH Child Protection Chatbot",
    ai: "Gemini",
    pdfKnowledgeBase: pdfCount > 0 ? "loaded" : "no PDFs loaded",
    pdfCount,
    documentCount: documents.length
  });
});

app.get("/api/knowledge-status", (req, res) => {
  res.json({
    status: "ok",
    pdfCount,
    documentCount: documents.length,
    knowledgeCharacters: knowledge.length,
    sources: documents.map(doc => doc.name)
  });
});

// =====================================================
// GEMINI RESPONSE
// =====================================================

async function generateGeminiResponse(message) {
  const relevantKnowledge = getRelevantKnowledge(message);

  const systemInstruction = `${baseInstructions}

RELEVANT KAWACH RESOURCE CONTENT FOR THIS QUESTION:

${relevantKnowledge}

END RESOURCE CONTENT.
`;

  const models = [
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash"
  ];

  let lastError = null;

  for (const model of models) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Trying model: ${model} | Attempt: ${attempt}`);

        const response = await ai.models.generateContent({
          model,
          contents: message,
          config: {
            systemInstruction,
            maxOutputTokens: 1200
          }
        });

        const answer = response.text || "No response was generated.";
        console.log(`Successful response from model: ${model}`);
        return answer;
      } catch (error) {
        lastError = error;

        console.error(
          `Gemini error | Model: ${model} | Attempt: ${attempt}:`,
          error?.message || JSON.stringify(error)
        );

        if (attempt < 3) {
          const delay = attempt * 2000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
  }

  throw lastError;
}

// =====================================================
// CHAT API
// =====================================================

app.post("/api/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();

    if (!message) {
      return res.status(400).json({
        error: "Please enter a question."
      });
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
    console.error(
      "KAWACH GEMINI FINAL ERROR:",
      error?.message || JSON.stringify(error)
    );

    return res.status(503).json({
      error: "KAWACH is temporarily busy. Please try again in a few seconds. If you need immediate help, contact 1098 or 112."
    });
  }
});

// =====================================================
// 404
// =====================================================

app.use((req, res) => {
  res.status(404).json({
    error: "Page or API endpoint not found."
  });
});

// =====================================================
// START SERVER
// =====================================================

async function startServer() {
  await loadKnowledgeBase();

  app.listen(port, "0.0.0.0", () => {
    console.log(`KAWACH running on port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || "production"}`);
    console.log("AI Provider: Gemini");
    console.log(`PDF Knowledge Base: ${pdfCount} PDF(s)`);
  });
}

startServer().catch(error => {
  console.error("KAWACH SERVER START ERROR:", error);
  process.exit(1);
});
