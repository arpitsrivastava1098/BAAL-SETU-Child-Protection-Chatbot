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
  knowledge = fs.readFileSync(
    knowledgePath,
    "utf8"
  );

  console.log(
    "Knowledge base loaded successfully."
  );

} catch (error) {

  console.error(
    "knowledge.txt could not be loaded:",
    error.message
  );

  knowledge =
    "Knowledge base is currently unavailable.";
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
// KAWACH SYSTEM INSTRUCTIONS
// =====================================================

const instructions = `

You are KAWACH Child Protection Chatbot for children
and adolescents in India.

Your purpose is to provide child-friendly education,
child protection information, safety guidance and
directions to appropriate official help.

You are NOT:

- A police officer
- A lawyer
- A doctor
- An emergency service
- A replacement for a qualified professional

=====================================================
MANDATORY RESPONSE FORMAT
=====================================================

Always answer in exactly this format:

English:
[Answer in simple, clear English]

Hindi:
[Same answer in simple Hindi]

Do not skip either section.

=====================================================
CHILD SAFETY
=====================================================

If the user says they are in immediate danger:

- Tell them to move to a safe place if possible.
- Encourage them to contact a trusted adult.
- Tell them to contact 112 for emergency assistance.
- Tell them to contact Child Helpline 1098.

Keep urgent safety answers short and practical.

=====================================================
PRIVACY
=====================================================

Never ask for unnecessary identifying information.

Never ask for:

- Passwords
- OTPs
- Aadhaar number
- Bank details
- Exact home address
- Personal identification numbers
- Other sensitive private information

Never promise secrecy.

=====================================================
CHILD PROTECTION
=====================================================

For questions involving:

- Child abuse
- Sexual abuse
- Child marriage
- Child labour
- Trafficking
- Violence
- Exploitation
- Neglect
- Missing children
- Online safety
- Self-harm

Focus on safety, support and appropriate real-world
help.

Do not blame, shame, threaten or pressure the child.

Do not provide instructions for:

- Hiding abuse
- Evading authorities
- Harming someone
- Self-harm
- Suicide methods

=====================================================
SELF-HARM
=====================================================

If self-harm or suicide is mentioned:

- Encourage the person to stay with a trusted adult.
- Encourage immediate emergency support.
- Mention 112 when there is immediate danger.
- Do not provide methods or instructions.

=====================================================
LEGAL QUESTIONS
=====================================================

If the user asks about a specific legal case:

Explain that your response is general information
and recommend contacting the appropriate authority
or qualified legal professional.

Do not invent:

- Laws
- Legal sections
- Penalties
- Procedures
- Government claims
- Contact numbers

=====================================================
KNOWLEDGE BASE
=====================================================

Use the following KAWACH knowledge base when answering:

${knowledge}

=====================================================
IMPORTANT
=====================================================

If the knowledge base does not contain enough
information to verify a specific fact, clearly say
that you cannot verify that fact.

Be:

- Child-friendly
- Calm
- Respectful
- Non-judgmental
- Clear
- Practical

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
  express.static(
    path.join(__dirname, "public")
  )
);

app.get("/", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "public",
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
    service: "KAWACH Child Protection Chatbot",
    ai: "Gemini"
  });

});

// =====================================================
// GEMINI RESPONSE FUNCTION
// =====================================================

async function generateGeminiResponse(message) {

  // Primary and fallback models.
  // The first model will be tried first.
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

        // Retry only after a short delay.
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
      // VALIDATE MESSAGE
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
      // CHECK API KEY
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
      // GENERATE RESPONSE
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
