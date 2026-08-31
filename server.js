import express from "express";
import dotenv from "dotenv";
import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri
} from "@google/genai";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import pdfParse from "pdf-parse";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================================================
   KAWACH PDF KNOWLEDGE BASE
========================================================= */

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

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    })
  : null;

let documents = [];
let chunks = [];
let pdfCount = 0;
let pdfFiles = [];
let knowledgeBaseLoading = true;

/* =========================================================
   TEXT HELPERS
========================================================= */

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function makeChunks(text, size = 1400, overlap = 250) {
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

      if (boundary > start + Math.floor(size * 0.6)) {
        end = boundary + 1;
      }
    }

    result.push(clean.slice(start, end).trim());

    if (end >= clean.length) {
      break;
    }

    start = Math.max(end - overlap, start + 1);
  }

  return result.filter(Boolean);
}

/* =========================================================
   PDF DOWNLOAD
========================================================= */

async function downloadPdf(url, destination) {
  const response = await fetch(url, {
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  fs.writeFileSync(destination, buffer);

  return buffer;
}

/* =========================================================
   LOAD KNOWLEDGE BASE
========================================================= */

async function loadKnowledgeBase() {
  documents = [];
  chunks = [];
  pdfFiles = [];
  pdfCount = 0;

  /* -------------------------
     knowledge.txt
  ------------------------- */

  if (fs.existsSync(textKnowledgePath)) {
    try {
      const text = normalizeText(
        fs.readFileSync(textKnowledgePath, "utf8")
      );

      if (text) {
        documents.push({
          name: "knowledge.txt",
          text
        });
      }
    } catch (error) {
      console.error(
        "knowledge.txt error:",
        error.message
      );
    }
  }

  console.log(
    `Starting background loading of ${PDF_URLS.length} PDFs...`
  );

  /* -------------------------
     Load PDFs one by one
  ------------------------- */

  for (const url of PDF_URLS) {
    const name = decodeURIComponent(
      url.split("/").pop()
    );

    const localPath = path.join(
      os.tmpdir(),
      `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}-${name.replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      )}`
    );

    try {
      console.log(`Loading PDF: ${name}`);

      const buffer = await downloadPdf(
        url,
        localPath
      );

      let extractedText = "";
      let pages = 0;

      /* -------------------------
         PDF text extraction
      ------------------------- */

      try {
        const pdf = await pdfParse(buffer);

        extractedText = normalizeText(
          pdf.text
        );

        pages = pdf.numpages || 0;
      } catch (error) {
        console.warn(
          `Text parser failed: ${name}: ${error.message}`
        );
      }

      /* -------------------------
         Gemini PDF upload
      ------------------------- */

      let uploadedFile = null;

      if (ai) {
        try {
          uploadedFile = await ai.files.upload({
            file: localPath,
            config: {
              mimeType: "application/pdf",
              displayName: name
            }
          });

          console.log(
            `Gemini PDF uploaded: ${name}`
          );
        } catch (error) {
          console.error(
            `Gemini PDF upload failed: ${name}: ${error.message}`
          );
        }
      }

      documents.push({
        name,
        text: extractedText,
        url,
        pages,
        uploadedFile
      });

      pdfFiles.push({
        name,
        url,
        uploadedFile
      });

      pdfCount++;

      if (extractedText) {
        console.log(
          `PDF loaded: ${name} | pages=${pages} | chars=${extractedText.length}`
        );
      } else {
        console.log(
          `PDF loaded for Gemini PDF processing: ${name}`
        );
      }

      /* -------------------------
         Remove temporary file
      ------------------------- */

      try {
        fs.unlinkSync(localPath);
      } catch {}

    } catch (error) {
      console.error(
        `PDF failed: ${name} | ${error.message}`
      );

      try {
        fs.unlinkSync(localPath);
      } catch {}
    }
  }

  /* -------------------------
     Create searchable chunks
  ------------------------- */

  for (const doc of documents) {
    if (!doc.text) continue;

    for (const text of makeChunks(doc.text)) {
      chunks.push({
        source: doc.name,
        url: doc.url || null,
        text
      });
    }
  }

  knowledgeBaseLoading = false;

  console.log(
    `Knowledge base ready: ${pdfCount} PDFs, ${chunks.length} text chunks, ${pdfFiles.filter(
      x => x.uploadedFile
    ).length} Gemini PDF files.`
  );
}

/* =========================================================
   SEARCH
========================================================= */

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "what",
  "how",
  "why",
  "with",
  "from",
  "this",
  "that",
  "can",
  "does",
  "about",
  "according",
  "please",
  "tell",
  "give",
  "kya",
  "hai",
  "ka",
  "ki",
  "ke",
  "ko",
  "me",
  "mein",
  "se",
  "aur",
  "par",
  "ya",
  "hain",
  "kaise",
  "kiski",
  "kiske",
  "kis",
  "is",
  "of",
  "to",
  "in",
  "on"
]);

function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(
      /[^a-z0-9\u0900-\u097f\s]/gi,
      " "
    )
    .split(/\s+/)
    .filter(
      word =>
        word.length >= 2 &&
        !STOP_WORDS.has(word)
    );
}

/* =========================================================
   SOURCE MATCHING
========================================================= */

function sourceMatches(question, name) {
  const q = normalizeText(question).toLowerCase();
  const n = name.toLowerCase();

  if (
    /meena\s*(manch|munch)|मीना\s*मंच/i.test(q)
  ) {
    return /meena\s*munch|meena\s*manch/i.test(n);
  }

  if (/cwpc/i.test(q)) {
    return /cwpc/i.test(n);
  }

  if (
    /child\s*trafficking|trafficking|बाल\s*तस्करी|तस्करी/i.test(
      q
    )
  ) {
    return /trafficking/i.test(n);
  }

  if (/kawach|कवच/i.test(q)) {
    return /kawach/i.test(n);
  }

  if (/shg|self.?help\s*group/i.test(q)) {
    return /shg/i.test(n);
  }

  if (/yojana|योजना|scheme/i.test(q)) {
    return /yojana/i.test(n);
  }

  if (
    /bal\s*sanrakshan|बाल\s*संरक्षण/i.test(q)
  ) {
    return /bal\s*sanrakshan/i.test(n);
  }

  return false;
}

/* =========================================================
   TEXT SEARCH
========================================================= */

function searchTextChunks(question) {
  const queryTokens = [
    ...new Set(tokenize(question))
  ];

  if (!queryTokens.length) {
    return chunks.slice(0, 5);
  }

  return chunks
    .map(chunk => {
      const text = chunk.text.toLowerCase();

      let score = 0;

      for (const token of queryTokens) {
        if (text.includes(token)) {
          score += 5;
        }

        let count = 0;
        let pos = 0;

        while (
          (pos = text.indexOf(token, pos)) !== -1
        ) {
          count++;
          pos += token.length;

          if (count >= 4) break;
        }

        score += Math.min(count, 4) * 2;
      }

      return {
        ...chunk,
        score
      };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

/* =========================================================
   GEMINI PDF SELECTION
========================================================= */

function selectGeminiPdfs(question) {
  return pdfFiles
    .filter(file =>
      sourceMatches(
        question,
        file.name
      )
    )
    .slice(0, 2)
    .filter(
      file => file.uploadedFile
    );
}

/* =========================================================
   KAWACH SYSTEM INSTRUCTIONS
========================================================= */

const baseInstructions = `
You are KAWACH Child Protection Chatbot for children and adolescents in India.

MANDATORY FORMAT:

English:
[Give the answer directly. Do NOT begin with phrases such as "According to the KAWACH resources", "According to the document", "According to the PDF", or similar attribution phrases.]

Hindi:
[Give the same answer directly in simple Hindi. Do NOT begin with "KAWACH संसाधनों के अनुसार", "दस्तावेज़ के अनुसार", "PDF के अनुसार", or similar attribution phrases.]

SOURCE ACCURACY:

- The supplied KAWACH PDF(s) are the primary source.
- Read the supplied PDF itself, including scanned/image pages, before answering.
- Preserve exact terminology, acronym expansion, names, roles and titles used in the PDF.
- NEVER guess an acronym expansion.
- If the PDF does not support a specific fact, say:
"I cannot verify this specific information from the available KAWACH resources."
- If the user names a resource, especially Meena Manch, KAWACH, CWPC, SHG, Yojana, Bal Sanrakshan or Child Trafficking, answer primarily from that named PDF.
- Do not mix unrelated documents.
- Do not invent facts, laws, sections, penalties, procedures, contacts or government claims.
- Do not add a source preface unless the user asks for the source.
- Keep the answer concise and directly relevant.

SAFETY:

- Immediate danger: move to a safe place, contact a trusted adult, 112 for emergency help and 1098 Child Helpline.
- Never ask for passwords, OTPs, Aadhaar, bank details, exact home address or unnecessary identifying information.
- Never promise secrecy.
- Do not blame, shame, threaten or pressure a child.
- For sexual abuse, trafficking, violence, child marriage, child labour, exploitation, neglect, missing children, online safety or self-harm, prioritize safety and real-world support.
- If self-harm/suicide is mentioned, encourage immediate trusted-adult/emergency support and never provide methods.
- Legal answers are general information, not legal advice.
- Be calm, respectful, child-friendly and non-judgmental.
`;

/* =========================================================
   EXPRESS
========================================================= */

app.use(
  express.json({
    limit: "32kb"
  })
);

app.use(
  express.static(__dirname)
);

/* =========================================================
   HOME
========================================================= */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "index.html"
    )
  );
});

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "KAWACH Child Protection Chatbot",
    ai: "Gemini",
    knowledgeBase:
      knowledgeBaseLoading
        ? "loading"
        : "ready",
    pdfCount,
    searchableChunks:
      chunks.length,
    geminiPdfFiles:
      pdfFiles.filter(
        x => x.uploadedFile
      ).length
  });
});

/* =========================================================
   KNOWLEDGE STATUS
========================================================= */

app.get(
  "/api/knowledge-status",
  (req, res) => {
    res.status(200).json({
      status: "ok",
      knowledgeBase:
        knowledgeBaseLoading
          ? "loading"
          : "ready",
      pdfCount,
      searchableChunks:
        chunks.length,
      geminiPdfFiles:
        pdfFiles.filter(
          x => x.uploadedFile
        ).length,
      sources:
        documents.map(
          doc => doc.name
        )
    });
  }
);

/* =========================================================
   GEMINI RESPONSE
========================================================= */

async function generateGeminiResponse(
  message
) {
  if (!ai) {
    throw new Error(
      "Gemini API is not configured."
    );
  }

  const selectedPdfs =
    selectGeminiPdfs(message);

  const textMatches =
    searchTextChunks(message);

  const textContext =
    textMatches.length
      ? textMatches
          .map(
            (item, index) =>
              `TEXT SOURCE ${index + 1}: ${item.source}\n${item.text}`
          )
          .join(
            "\n\n---\n\n"
          )
      : "No searchable text excerpt found.";

  const sourceHint =
    selectedPdfs.length
      ? `The user is asking about: ${selectedPdfs
          .map(
            file => file.name
          )
          .join(
            ", "
          )}. Use these PDF files as the primary source.`
      : "Use the relevant supplied text excerpts and any supplied PDF file when applicable.";

  const contents = [];

  for (const file of selectedPdfs) {
    contents.push(
      createPartFromUri(
        file.uploadedFile.uri,
        file.uploadedFile.mimeType
      )
    );
  }

  contents.push(
    `${sourceHint}

Question: ${message}

Relevant extracted text (may be incomplete for scanned PDFs):

${textContext}`
  );

  const response =
    await ai.models.generateContent({
      model:
        "gemini-3.5-flash-lite",

      contents:
        createUserContent(
          contents
        ),

      config: {
        systemInstruction:
          baseInstructions,

        maxOutputTokens: 700,

        thinkingConfig: {
          thinkingLevel:
            "minimal"
        }
      }
    });

  return (
    response.text ||
    "No response was generated."
  );
}

/* =========================================================
   CHAT API
========================================================= */

app.post(
  "/api/chat",
  async (req, res) => {
    try {
      const message = String(
        req.body?.message || ""
      ).trim();

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

      if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({
          error:
            "AI service is not configured yet."
        });
      }

      const answer =
        await generateGeminiResponse(
          message
        );

      return res.json({
        answer
      });

    } catch (error) {
      console.error(
        "KAWACH FINAL ERROR:",
        error?.message ||
          error
      );

      return res.status(503).json({
        error:
          "KAWACH is temporarily busy. Please try again in a few seconds. If you need immediate help, contact 1098 or 112."
      });
    }
  }
);

/* =========================================================
   404
========================================================= */

app.use(
  (req, res) => {
    res.status(404).json({
      error:
        "Page or API endpoint not found."
    });
  }
);

/* =========================================================
   START SERVER FIRST
   THEN LOAD PDFS IN BACKGROUND
========================================================= */

function startServer() {
  if (!process.env.GEMINI_API_KEY) {
    console.warn(
      "WARNING: GEMINI_API_KEY is not configured."
    );
  }

  /* ---------------------------------
     IMPORTANT:
     Start Render server immediately.
  --------------------------------- */

  app.listen(
    port,
    "0.0.0.0",
    () => {
      console.log(
        `KAWACH running on port ${port}`
      );

      console.log(
        "KAWACH server started immediately."
      );

      console.log(
        "PDF knowledge base will load in background."
      );

      /* ---------------------------------
         Background PDF loading
      --------------------------------- */

      loadKnowledgeBase()
        .then(() => {
          console.log(
            "KAWACH knowledge base loaded successfully."
          );
        })
        .catch(error => {
          console.error(
            "Background knowledge base error:",
            error
          );

          knowledgeBaseLoading =
            false;
        });
    }
  );
}

/* =========================================================
   START
========================================================= */

startServer();
