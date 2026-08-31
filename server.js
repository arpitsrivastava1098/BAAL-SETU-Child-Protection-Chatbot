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
// PATHS
// =====================================================

const knowledgePath = path.join(__dirname, "knowledge");
const textKnowledgePath = path.join(__dirname, "knowledge.txt");

// =====================================================
// PDF KNOWLEDGE BASE
// =====================================================

let knowledge = "";
let pdfCount = 0;

async function loadKnowledgeBase() {
  let combinedKnowledge = "";

  // -----------------------------------------------
  // Existing knowledge.txt
  // -----------------------------------------------

  try {
    if (fs.existsSync(textKnowledgePath)) {
      const textKnowledge = fs.readFileSync(
        textKnowledgePath,
        "utf8"
      );

      if (textKnowledge.trim()) {
        combinedKnowledge +=
          "\n\n===== GENERAL KAWACH KNOWLEDGE =====\n\n";

        combinedKnowledge += textKnowledge;

        console.log(
          "knowledge.txt loaded successfully."
        );
      }
    }
  } catch (error) {
    console.error(
      "Error loading knowledge.txt:",
      error.message
    );
  }

  // -----------------------------------------------
  // PDF folder
  // -----------------------------------------------

  if (!fs.existsSync(knowledgePath)) {
    console.warn(
      "knowledge folder not found. Creating it..."
    );

    fs.mkdirSync(knowledgePath, {
      recursive: true
    });
  }

  let files = [];

  try {
    files = fs.readdirSync(knowledgePath);
  } catch (error) {
    console.error(
      "Could not read knowledge folder:",
      error.message
    );
  }

  const pdfFiles = files.filter(
    file =>
      path.extname(file).toLowerCase() === ".pdf"
  );

  console.log(
    `Found ${pdfFiles.length} PDF file(s).`
  );

  // -----------------------------------------------
  // Read every PDF
  // -----------------------------------------------

  for (const file of pdfFiles) {
    const filePath = path.join(
      knowledgePath,
      file
    );

    try {
      const data = fs.readFileSync(
        filePath
      );

      const pdf = await pdfParse(data);

      const pdfText =
        pdf.text?.trim() || "";

      if (!pdfText) {
        console.warn(
          `No readable text found in PDF: ${file}`
        );

        continue;
      }

      pdfCount++;

      combinedKnowledge +=
        `\n\n===== PDF SOURCE: ${file} =====\n\n`;

      combinedKnowledge += pdfText;

      console.log(
        `PDF loaded successfully: ${file} | Pages: ${pdf.numpages} | Characters: ${pdfText.length}`
      );

    } catch (error) {

      console.error(
        `Could not read PDF: ${file}`,
        error.message
      );
    }
  }

  knowledge = combinedKnowledge.trim();

  console.log(
    `Knowledge base ready. PDFs loaded: ${pdfCount}`
  );

  console.log(
    `Total knowledge characters: ${knowledge.length}`
  );
}

// =====================================================
// GEMINI
// =====================================================

if (!process.env.GEMINI_API_KEY) {
  console.warn(
    "WARNING: GEMINI_API_KEY is not configured."
  );
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// =====================================================
// KAWACH INSTRUCTIONS
// =====================================================

const instructions = `
You are KAWACH Child Protection Chatbot for children
and adolescents in India.

Your purpose is to provide child-friendly education,
child protection information, safety guidance and
directions to appropriate official help.

You are NOT a police officer, lawyer, doctor,
emergency service, or substitute for a qualified
professional.

=====================================================
MANDATORY RESPONSE FORMAT
=====================================================

Always answer in exactly this format:

English:
[Answer in simple, clear English]

Hindi:
[Same answer in simple Hindi]

Always provide both English and Hindi.

=====================================================
KNOWLEDGE BASE RULES
=====================================================

The KAWACH knowledge base below contains information
from official/project PDF documents and knowledge files.

Use this knowledge base as the primary source for
questions related to:

- Child protection
- Child rights
- Child marriage
- Child labour
- Child trafficking
- Child abuse
- Child sexual abuse
- CWPC
- Child Welfare Committee
- Government systems
- Schemes
- Meena Manch
- KAWACH
- Referral mechanisms
- Social protection
- Community awareness
- Government procedures
- Training modules
- Programme implementation

IMPORTANT:

1. Prefer information from the knowledge base.

2. Do NOT invent information that is not supported
   by the knowledge base.

3. If a specific fact cannot be verified from the
   knowledge base, clearly say:

   English:
   "I cannot verify this specific information
   from the available KAWACH resources."

   Hindi:
   "मैं उपलब्ध KAWACH संसाधनों से इस विशेष जानकारी
   की पुष्टि नहीं कर सकता/सकती हूँ।"

4. When possible, identify the PDF/source document
   from which the information comes.

5. Do not claim that a procedure, law, penalty,
   government order, phone number or authority exists
   unless it is supported by the knowledge base or is
   a clearly established emergency contact.

6. If the user asks about something unrelated to
   child protection, answer briefly if appropriate,
   but do not pretend it came from a KAWACH PDF.

=====================================================
SAFETY
=====================================================

- If the user says they are in immediate danger,
  prioritize getting to a safe place.

- Encourage contacting a trusted adult.

- Encourage contacting 112 for emergency assistance.

- Encourage contacting Child Helpline 1098.

- Keep urgent safety answers concise.

- Do not ask for unnecessary identifying information.

- Never ask for passwords, OTPs, Aadhaar numbers,
  bank details, exact home address, or other sensitive
  private information.

- Never promise secrecy.

- Do not blame, shame, threaten, or pressure a child.

For sexual abuse, trafficking, violence, child marriage,
child labour, exploitation, neglect, missing children,
online safety, or self-harm, focus on safety and
appropriate real-world support.

If self-harm or suicide is mentioned:

- Encourage immediate support from a trusted adult.
- Encourage emergency assistance when there is immediate danger.
- Do not provide methods or instructions.

For specific legal cases, explain that the answer is
general information and recommend an appropriate
authority or qualified legal professional.

Be calm, respectful, child-friendly and non-judgmental.

=====================================================
KAWACH KNOWLEDGE BASE
=====================================================

${knowledge}

=====================================================
END KNOWLEDGE BASE
=====================================================
`;

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(
  express.json({
    limit: "32kb"
  })
);

// =====================================================
// FRONTEND
// =====================================================

app.use(
  express.static(__dirname)
);

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "index.html"
    )
  );
});

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/health", (req, res) => {

  res.json({
    status: "ok",
    service:
      "KAWACH Child Protection Chatbot",
    ai: "Gemini",
    pdfKnowledgeBase:
      pdfCount > 0
        ? "loaded"
        : "no PDFs loaded",
    pdfCount: pdfCount
  });

});

// =====================================================
// KNOWLEDGE STATUS
// =====================================================

app.get("/api/knowledge-status", (req, res) => {

  res.json({
    status: "ok",
    pdfCount: pdfCount,
    knowledgeCharacters:
      knowledge.length
  });

});

// =====================================================
// GEMINI RESPONSE
// =====================================================

async function generateGeminiResponse(message) {

  const models = [
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash"
  ];

  let lastError = null;

  for (const model of models) {

    for (
      let attempt = 1;
      attempt <= 3;
      attempt++
    ) {

      try {

        console.log(
          `Trying model: ${model} | Attempt: ${attempt}`
        );

        const response =
          await ai.models.generateContent({

            model: model,

            contents: message,

            config: {
              systemInstruction:
                instructions,

              maxOutputTokens: 1200
            }

          });

        const answer =
          response.text ||
          "No response was generated.";

        console.log(
          `Successful response from model: ${model}`
        );

        return answer;

      } catch (error) {

        lastError = error;

        const errorMessage =
          error?.message ||
          JSON.stringify(error);

        console.error(
          `Gemini error | Model: ${model} | Attempt: ${attempt}:`,
          errorMessage
        );

        if (attempt < 3) {

          const delay =
            attempt * 2000;

          console.log(
            `Retrying in ${delay}ms...`
          );

          await new Promise(
            resolve =>
              setTimeout(
                resolve,
                delay
              )
          );
        }
      }
    }
  }

  throw lastError;
}

// =====================================================
// CHAT API
// =====================================================

app.post(
  "/api/chat",
  async (req, res) => {

    try {

      const message =
        String(
          req.body?.message || ""
        ).trim();

      // -----------------------------------------------
      // VALIDATION
      // -----------------------------------------------

      if (!message) {

        return res.status(400).json({
          error:
            "Please enter a question."
        });

      }

      if (message.length > 4000) {

        return res.status(400).json({
          error:
            "Question is too long. Please keep it under 4000 characters."
        });

      }

      // -----------------------------------------------
      // API KEY CHECK
      // -----------------------------------------------

      if (!process.env.GEMINI_API_KEY) {

        console.error(
          "GEMINI_API_KEY is missing."
        );

        return res.status(503).json({
          error:
            "AI service is not configured yet."
        });

      }

      // -----------------------------------------------
      // GEMINI
      // -----------------------------------------------

      const answer =
        await generateGeminiResponse(
          message
        );

      return res.json({
        answer: answer
      });

    } catch (error) {

      console.error(
        "KAWACH GEMINI FINAL ERROR:",
        error?.message ||
        JSON.stringify(error)
      );

      return res.status(503).json({

        error:
          "KAWACH is temporarily busy. Please try again in a few seconds. If you need immediate help, contact 1098 or 112."

      });

    }

  }
);

// =====================================================
// 404 HANDLER
// =====================================================

app.use(
  (req, res) => {

    res.status(404).json({
      error:
        "Page or API endpoint not found."
    });

  }
);

// =====================================================
// START SERVER
// =====================================================

async function startServer() {

  // Load PDFs BEFORE starting server
  await loadKnowledgeBase();

  app.listen(
    port,
    "0.0.0.0",
    () => {

      console.log(
        `KAWACH running on port ${port}`
      );

      console.log(
        `Environment: ${
          process.env.NODE_ENV ||
          "production"
        }`
      );

      console.log(
        "AI Provider: Gemini"
      );

      console.log(
        `PDF Knowledge Base: ${pdfCount} PDF(s)`
      );

    }
  );
}

startServer().catch(error => {

  console.error(
    "KAWACH SERVER START ERROR:",
    error
  );

  process.exit(1);

});
