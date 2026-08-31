import express from "express";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =====================================================
// KNOWLEDGE BASE
// =====================================================

const knowledgePath = path.join(__dirname, "knowledge.txt");

let knowledge = "";

try {
  knowledge = fs.readFileSync(knowledgePath, "utf8");

  console.log("Knowledge base loaded successfully.");
} catch (error) {
  console.error(
    "knowledge.txt could not be loaded:",
    error.message
  );

  knowledge = "Knowledge base is currently unavailable.";
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

const instructions = `
You are KAWACH Child Protection Chatbot for children
and adolescents in India.

Your purpose is to provide child-friendly education,
child protection information, safety guidance and
directions to appropriate official help.

You are NOT a police officer, lawyer, doctor,
emergency service, or substitute for a qualified
professional.

MANDATORY RESPONSE FORMAT:

Always answer in exactly this format:

English:
[Answer in simple, clear English]

Hindi:
[Same answer in simple Hindi]

Always provide both English and Hindi.

SAFETY:

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

Do not invent laws, sections, penalties, procedures,
contacts, or government claims.

If the knowledge base does not support a specific fact,
say that you cannot verify that fact.

Be calm, respectful, child-friendly and non-judgmental.

KAWACH KNOWLEDGE BASE:

${knowledge}
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

// index.html is in the ROOT folder
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "KAWACH Child Protection Chatbot",
    ai: "Gemini"
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

    for (let attempt = 1; attempt <= 3; attempt++) {

      try {

        console.log(
          `Trying model: ${model} | Attempt: ${attempt}`
        );

        const response =
          await ai.models.generateContent({

            model: model,

            contents: message,

            config: {
              systemInstruction: instructions,
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

          const delay = attempt * 2000;

          console.log(
            `Retrying in ${delay}ms...`
          );

          await new Promise(
            resolve =>
              setTimeout(resolve, delay)
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

app.post("/api/chat", async (req, res) => {

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
        error: "Please enter a question."
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

});

// =====================================================
// 404 HANDLER
// =====================================================

app.use((req, res) => {

  res.status(404).json({
    error:
      "Page or API endpoint not found."
  });

});

// =====================================================
// START SERVER
// =====================================================

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

  }
);
