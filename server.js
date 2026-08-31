import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();

const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===============================
// KNOWLEDGE BASE
// ===============================

const knowledgePath = path.join(__dirname, "knowledge.txt");

let knowledge = "";

try {
  knowledge = fs.readFileSync(knowledgePath, "utf8");
  console.log("Knowledge base loaded successfully.");
} catch (error) {
  console.error("knowledge.txt could not be loaded:", error.message);
  knowledge = "Knowledge base is currently unavailable.";
}

// ===============================
// OPENAI
// ===============================

if (!process.env.OPENAI_API_KEY) {
  console.warn("WARNING: OPENAI_API_KEY is not configured.");
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ===============================
// KAWACH INSTRUCTIONS
// ===============================

const instructions = `
You are KAWACH Child Protection Chatbot for children and adolescents in India.

You provide child-friendly education, safety guidance, and directions to appropriate
official help.

You are NOT a police officer, lawyer, doctor, emergency service, or substitute for
a qualified professional.

MANDATORY RESPONSE FORMAT:

- Always answer in English first.
- Immediately provide the same answer in simple Hindi below it.
- Use these headings exactly:
  English:
  Hindi:
- Keep urgent safety answers concise.

SAFETY:

- If the user says they are in immediate danger, prioritize getting to safety and
  contacting 112 and Child Helpline 1098.
- Do not ask for unnecessary identifying information.
- Never ask for passwords, OTPs, Aadhaar, bank details, exact home address, or similar
  private information.
- Never promise secrecy.
- Do not blame, shame, threaten, or pressure the child.
- Do not give instructions for concealing abuse, evading authorities, or harming anyone.
- For sexual abuse, trafficking, violence, child marriage, exploitation, or self-harm,
  focus on safety and real-world support.
- If self-harm or suicide is mentioned, encourage immediate contact with a trusted
  adult and emergency support. Do not provide methods.
- If the question is a specific legal case, explain that the answer is general
  information and recommend the appropriate authority or legal professional.
- Do not invent sections, penalties, procedures, contacts, or government claims.
- If the knowledge below does not support a specific fact, say that you cannot verify it.

KAWACH KNOWLEDGE BASE:

${knowledge}
`;

// ===============================
// MIDDLEWARE
// ===============================

app.use(express.json({
  limit: "32kb"
}));

// ===============================
// FRONTEND
// ===============================

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

// IMPORTANT:
// This fixes "Cannot GET /"

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

// ===============================
// HEALTH CHECK
// ===============================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "KAWACH Child Protection Chatbot"
  });
});

// ===============================
// CHAT API
// ===============================

app.post("/api/chat", async (req, res) => {

  try {

    const message = String(
      req.body?.message || ""
    ).trim();

    // Validate message

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

    // Check API key

    if (!process.env.OPENAI_API_KEY) {

      console.error(
        "OPENAI_API_KEY is missing."
      );

      return res.status(503).json({
        error: "AI service is not configured yet."
      });
    }

    // ===============================
    // OPENAI RESPONSE
    // ===============================

    const response = await client.responses.create({

      model: "gpt-5.6-luna",

      instructions: instructions,

      input: message

    });

    const answer =
      response.output_text ||
      "No response was generated.";

    return res.json({
      answer: answer
    });

  } catch (error) {

    console.error(
      "KAWACH API ERROR:",
      error
    );

    return res.status(500).json({

      error:
        "KAWACH is temporarily unavailable. Please use 1098 or 112 if you need immediate help."

    });

  }

});

// ===============================
// 404 HANDLER
// ===============================

app.use((req, res) => {

  res.status(404).json({
    error: "Page or API endpoint not found."
  });

});

// ===============================
// START SERVER
// ===============================

app.listen(port, "0.0.0.0", () => {

  console.log(
    `KAWACH running on port ${port}`
  );

  console.log(
    `Environment: ${process.env.NODE_ENV || "production"}`
  );

});
