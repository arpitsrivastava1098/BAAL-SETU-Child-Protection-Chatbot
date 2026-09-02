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
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================================================
   CONFIGURATION
========================================================= */

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    })
  : null;

/*
  PDFs are NOT downloaded during server startup.
  They are loaded only when required.
*/

const PDF_URLS = [
  "https://arpitsrivastava.co.in/resources/Kawach%20Madule.pdf",
  "https://arpitsrivastava.co.in/resources/Meena%20munch%20module.pdf",
  "https://arpitsrivastava.co.in/resources/CWPC%20Strengthening%20and%20Activation%20Process%20Document.pdf",
  "https://arpitsrivastava.co.in/resources/Bal%20sanrakshan%2010-03-2026%20(1).pdf",
  "https://arpitsrivastava.co.in/resources/SHG%20Module.pdf",
  "https://arpitsrivastava.co.in/resources/Yojana%20Module%2004-26.pdf",
  "https://arpitsrivastava.co.in/resources/Child-Trafficking-Resource.pdf"
];

const KNOWLEDGE_FILE = path.join(
  __dirname,
  "knowledge.txt"
);

const pdfFiles = PDF_URLS.map((url) => ({
  name: decodeURIComponent(
    url.split("/").pop()
  ),
  url,
  loaded: false,
  loading: null,
  uploadedFile: null
}));

let documents = [];
let chunks = [];
let knowledgeReady = false;

/* =========================================================
   FALLBACK RESPONSE
========================================================= */

const FALLBACK_RESPONSE = `English:
I’m sorry, I don’t have enough reliable information to answer this question. Please ask a question related to child protection. Contact 1098/112 if you need immediate help.

Hindi:
क्षमा करें, इस सवाल का विश्वसनीय जवाब मेरे पास उपलब्ध नहीं है। कृपया बाल संरक्षण से संबंधित सवाल पूछें। तत्काल सहायता के लिए 1098 या 112 पर संपर्क करें.`;

/* =========================================================
   TEXT UTILITIES
========================================================= */

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function makeChunks(
  text,
  size = 1500,
  overlap = 200
) {
  const clean = normalizeText(text);

  if (!clean) return [];

  const result = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(
      start + size,
      clean.length
    );

    if (end < clean.length) {
      const boundary = Math.max(
        clean.lastIndexOf("\n\n", end),
        clean.lastIndexOf(". ", end),
        clean.lastIndexOf(" ", end)
      );

      if (
        boundary >
        start + Math.floor(size * 0.6)
      ) {
        end = boundary + 1;
      }
    }

    const piece = clean
      .slice(start, end)
      .trim();

    if (piece) result.push(piece);

    if (end >= clean.length) break;

    start = Math.max(
      end - overlap,
      start + 1
    );
  }

  return result;
}

/* =========================================================
   LOAD LOCAL KNOWLEDGE
========================================================= */

function loadLocalKnowledge() {
  try {
    if (!fs.existsSync(KNOWLEDGE_FILE)) {
      console.log(
        "knowledge.txt not found."
      );
      return;
    }

    const text = normalizeText(
      fs.readFileSync(
        KNOWLEDGE_FILE,
        "utf8"
      )
    );

    if (!text) return;

    documents.push({
      name: "knowledge.txt",
      text
    });

    rebuildChunks();

    console.log(
      `Local knowledge loaded: ${chunks.length} chunks`
    );

  } catch (error) {
    console.error(
      "knowledge.txt error:",
      error.message
    );
  }
}

/* =========================================================
   REBUILD SEARCH INDEX
========================================================= */

function rebuildChunks() {
  chunks = [];

  for (const document of documents) {
    if (!document.text) continue;

    const documentChunks =
      makeChunks(document.text);

    for (const text of documentChunks) {
      chunks.push({
        source: document.name,
        url: document.url || null,
        text
      });
    }
  }
}

/* =========================================================
   DOWNLOAD PDF
========================================================= */

async function downloadPdf(
  url,
  destination
) {
  const response = await fetch(url, {
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(
      `PDF download failed: HTTP ${response.status}`
    );
  }

  const buffer = Buffer.from(
    await response.arrayBuffer()
  );

  fs.writeFileSync(
    destination,
    buffer
  );

  return buffer;
}

/* =========================================================
   LOAD SINGLE PDF
========================================================= */

async function ensurePdfLoaded(
  file,
  uploadToGemini = false
) {
  if (
    file.loaded &&
    (!uploadToGemini ||
      file.uploadedFile)
  ) {
    return file;
  }

  if (file.loading) {
    return file.loading;
  }

  file.loading = (async () => {
    const temporaryFile = path.join(
      os.tmpdir(),
      `baal-setu-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.pdf`
    );

    try {
      console.log(
        `Loading PDF: ${file.name}`
      );

      const buffer =
        await downloadPdf(
          file.url,
          temporaryFile
        );

      let extractedText = "";
      let pages = 0;

      /* ---------------------------------
         Extract PDF text
      --------------------------------- */

      try {
        const parsed =
          await pdfParse(buffer);

        extractedText =
          normalizeText(
            parsed.text
          );

        pages =
          parsed.numpages || 0;

      } catch (error) {
        console.warn(
          `PDF text extraction failed: ${file.name}`,
          error.message
        );
      }

      /* ---------------------------------
         Add / update document
      --------------------------------- */

      const existing =
        documents.find(
          (item) =>
            item.name === file.name
        );

      if (existing) {
        existing.text =
          extractedText ||
          existing.text;

        existing.pages =
          pages || existing.pages;

      } else {
        documents.push({
          name: file.name,
          text: extractedText,
          url: file.url,
          pages
        });
      }

      if (extractedText) {
        rebuildChunks();
      }

      file.loaded = true;

      /* ---------------------------------
         Upload PDF to Gemini only when
         required
      --------------------------------- */

      if (
        uploadToGemini &&
        ai &&
        !file.uploadedFile
      ) {
        try {
          file.uploadedFile =
            await ai.files.upload({
              file: temporaryFile,
              config: {
                mimeType:
                  "application/pdf",
                displayName:
                  file.name
              }
            });

          console.log(
            `Gemini upload complete: ${file.name}`
          );

        } catch (error) {
          console.error(
            `Gemini upload failed: ${file.name}`,
            error.message
          );
        }
      }

      return file;

    } finally {
      file.loading = null;

      try {
        if (
          fs.existsSync(
            temporaryFile
          )
        ) {
          fs.unlinkSync(
            temporaryFile
          );
        }
      } catch {}
    }
  })();

  return file.loading;
}

/* =========================================================
   STOP WORDS
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
  "on",
  "a",
  "an"
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
      (word) =>
        word.length >= 2 &&
        !STOP_WORDS.has(word)
    );
}

/* =========================================================
   RESOURCE DETECTION
========================================================= */

function sourceMatches(
  question,
  filename
) {
  const q =
    normalizeText(question)
      .toLowerCase();

  const name =
    filename.toLowerCase();

  if (
    /meena\s*(manch|munch)|मीना\s*मंच/i.test(
      q
    )
  ) {
    return /meena\s*(manch|munch)/i.test(
      name
    );
  }

  if (/cwpc/i.test(q)) {
    return /cwpc/i.test(name);
  }

  if (
    /child\s*trafficking|trafficking|बाल\s*तस्करी|तस्करी/i.test(
      q
    )
  ) {
    return /trafficking/i.test(
      name
    );
  }

  if (
    /kawach|कवच/i.test(q)
  ) {
    return /kawach/i.test(name);
  }

  if (
    /shg|self.?help\s*group/i.test(
      q
    )
  ) {
    return /shg/i.test(name);
  }

  if (
    /yojana|योजना|scheme/i.test(
      q
    )
  ) {
    return /yojana/i.test(name);
  }

  if (
    /bal\s*sanrakshan|बाल\s*संरक्षण/i.test(
      q
    )
  ) {
    return /bal\s*sanrakshan/i.test(
      name
    );
  }

  return false;
}

/* =========================================================
   SEARCH TEXT
========================================================= */

function searchTextChunks(
  question
) {
  const tokens = [
    ...new Set(
      tokenize(question)
    )
  ];

  if (!tokens.length) {
    return chunks.slice(0, 5);
  }

  return chunks
    .map((chunk) => {
      const text =
        chunk.text.toLowerCase();

      let score = 0;

      for (const token of tokens) {
        if (
          text.includes(token)
        ) {
          score += 5;
        }

        let count = 0;
        let position = 0;

        while (
          (position =
            text.indexOf(
              token,
              position
            )) !== -1
        ) {
          count++;

          position +=
            token.length;

          if (count >= 4) break;
        }

        score +=
          Math.min(count, 4) * 2;
      }

      return {
        ...chunk,
        score
      };
    })
    .filter(
      (item) => item.score > 0
    )
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .slice(0, 5);
}

/* =========================================================
   FIND RELEVANT PDFS
========================================================= */

async function getRelevantPdfs(
  question
) {
  const matched =
    pdfFiles
      .filter((file) =>
        sourceMatches(
          question,
          file.name
        )
      )
      .slice(0, 2);

  if (!matched.length) {
    return [];
  }

  /*
    Only matching PDFs are downloaded.
    This is the main speed improvement.
  */

  await Promise.all(
    matched.map((file) =>
      ensurePdfLoaded(
        file,
        Boolean(ai)
      )
    )
  );

  return matched;
}

/* =========================================================
   GEMINI SYSTEM INSTRUCTIONS
========================================================= */

const SYSTEM_INSTRUCTIONS = `
You are BAAL-SETU / KAWACH Child Protection Chatbot for children, adolescents, parents, teachers, communities and frontline workers in India.

Your answers must be safe, accurate, practical and child-friendly.

MANDATORY RESPONSE FORMAT:

English:
[Answer directly and clearly.]

Hindi:
[Give the same answer in simple Hindi.]

Do not start with:
"According to the document..."
"According to the PDF..."
"According to KAWACH resources..."
or similar source-preface language unless the user specifically asks for the source.

SOURCE ACCURACY:

- Supplied KAWACH resources are an important source of information.
- If a user names a specific module/resource, prioritize that resource.
- Do not mix unrelated resources when a specific resource is requested.
- Use the supplied resources when they contain relevant information.
- If the supplied resources do not contain the answer, you may provide a helpful general answer using reliable general knowledge.
- Never invent facts.
- Never guess acronym expansions.
- Never invent laws, sections, penalties, procedures, government orders or official contacts.
- Do not claim that information comes from KAWACH unless it is actually supported by the supplied resources.

UNKNOWN / NO RELIABLE ANSWER:

If you genuinely do not have enough reliable information to answer the user's question, respond EXACTLY in this format and do not add anything else:

English:
I’m sorry, I don’t have enough reliable information to answer this question. Please ask a question related to child protection. Contact 1098/112 if you need immediate help.

Hindi:
क्षमा करें, इस सवाल का विश्वसनीय जवाब मेरे पास उपलब्ध नहीं है। कृपया बाल संरक्षण से संबंधित सवाल पूछें। तत्काल सहायता के लिए 1098 या 112 पर संपर्क करें.

IMPORTANT:
- Never say: "I cannot verify this specific information from the available KAWACH resources."
- Never mention KAWACH resources, PDFs, documents or knowledge base when using the fallback response.
- Do not give a made-up answer just to avoid the fallback response.
- Use the fallback response only when you genuinely lack enough reliable information.

SAFETY:

- If a child is in immediate danger, advise moving to a safe place and contacting a trusted adult.
- Emergency support: 112.
- Child Helpline: 1098.
- Never ask for passwords, OTPs, Aadhaar numbers, bank details, exact home address or unnecessary identifying information.
- Never promise secrecy.
- Do not blame, shame, threaten or pressure a child.
- For sexual abuse, trafficking, violence, child marriage, child labour, exploitation, neglect, missing children, online safety or self-harm, prioritize immediate safety and real-world support.
- If self-harm or suicide is mentioned, encourage immediate trusted-adult and emergency support. Never provide methods.
- Legal information is general information, not legal advice.

STYLE:

- Be concise.
- Use simple language.
- Use bullet points when useful.
- Answer the user's actual question directly.
- Avoid unnecessary repetition.
- Do not create unsupported statistics.
- Be calm, respectful and non-judgmental.
- If the user asks a general child-protection question, answer it when reliable information is available.
- If the question is outside child protection and you do not have enough reliable information, use the exact fallback response.
`;

/* =========================================================
   EXPRESS MIDDLEWARE
========================================================= */

app.disable("x-powered-by");

app.use(
  express.json({
    limit: "32kb"
  })
);

app.use(
  express.static(
    __dirname,
    {
      etag: true,
      maxAge: "1h",
      setHeaders: (res, filePath) => {
        if (
          filePath.endsWith(
            ".html"
          )
        ) {
          res.setHeader(
            "Cache-Control",
            "no-cache"
          );
        }
      }
    }
  )
);

/* =========================================================
   HOME
========================================================= */

app.get(
  "/",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );
  }
);

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
  "/health",
  (req, res) => {
    res.status(200).json({
      status: "ok",
      service:
        "BAAL-SETU Child Protection Chatbot",
      ai:
        ai
          ? "Gemini"
          : "not-configured",
      knowledgeBase:
        knowledgeReady
          ? "ready"
          : "loading",
      localChunks:
        chunks.length,
      loadedPdfs:
        pdfFiles.filter(
          (file) =>
            file.loaded
        ).length,
      geminiPdfs:
        pdfFiles.filter(
          (file) =>
            file.uploadedFile
        ).length
    });
  }
);

/* =========================================================
   KNOWLEDGE STATUS
========================================================= */

app.get(
  "/api/knowledge-status",
  (req, res) => {
    res.status(200).json({
      status: "ok",
      knowledgeBase:
        knowledgeReady
          ? "ready"
          : "loading",
      searchableChunks:
        chunks.length,
      loadedPdfs:
        pdfFiles.filter(
          (file) =>
            file.loaded
        ).length,
      geminiPdfFiles:
        pdfFiles.filter(
          (file) =>
            file.uploadedFile
        ).length,
      sources:
        documents.map(
          (doc) => doc.name
        )
    });
  }
);

/* =========================================================
   GEMINI RESPONSE
========================================================= */

async function generateResponse(
  message
) {
  if (!ai) {
    throw new Error(
      "GEMINI_API_KEY is not configured."
    );
  }

  /*
    Load ONLY relevant PDFs.
  */

  const relevantPdfs =
    await getRelevantPdfs(
      message
    );

  /*
    Search locally available text.
  */

  const matches =
    searchTextChunks(
      message
    );

  const textContext =
    matches.length
      ? matches
          .map(
            (item, index) =>
              `TEXT SOURCE ${index + 1}: ${item.source}\n${item.text}`
          )
          .join(
            "\n\n---\n\n"
          )
      : "No relevant extracted text was found.";

  const sourceInstruction =
    relevantPdfs.length
      ? `
The user has specifically asked about:
${relevantPdfs
  .map(
    (file) => file.name
  )
  .join(", ")}

Use these supplied PDF resources as the primary source when relevant.
`
      : `
Use the relevant supplied knowledge text when applicable.
If it does not contain enough information, use reliable general knowledge.
`;

  const contents = [];

  /*
    Attach only the PDFs relevant
    to the current question.
  */

  for (const file of relevantPdfs) {
    if (
      file.uploadedFile?.uri &&
      file.uploadedFile?.mimeType
    ) {
      contents.push(
        createPartFromUri(
          file.uploadedFile.uri,
          file.uploadedFile
            .mimeType
        )
      );
    }
  }

  contents.push(`
${sourceInstruction}

USER QUESTION:
${message}

RELEVANT SEARCH TEXT:
${textContext}
`);

  const response =
    await ai.models.generateContent(
      {
        /*
          Keep the lightweight model
          for faster response.
        */

        model:
          "gemini-3.5-flash-lite",

        contents:
          createUserContent(
            contents
          ),

        config: {
          systemInstruction:
            SYSTEM_INSTRUCTIONS,

          maxOutputTokens: 500,

          thinkingConfig: {
            thinkingLevel:
              "minimal"
          }
        }
      }
    );

  const answer =
    response.text?.trim();

  if (!answer) {
    return FALLBACK_RESPONSE;
  }

  /*
    Extra protection:
    If Gemini still returns the old
    KAWACH verification message,
    replace it with the new fallback.
  */

  const oldFallbackPatterns = [
    /I cannot verify this specific information from the available KAWACH resources/i,
    /I can't verify this specific information from the available KAWACH resources/i,
    /cannot verify this specific information from the available KAWACH resources/i,
    /can't verify this specific information from the available KAWACH resources/i
  ];

  const containsOldFallback =
    oldFallbackPatterns.some(
      (pattern) =>
        pattern.test(answer)
    );

  if (containsOldFallback) {
    return FALLBACK_RESPONSE;
  }

  return answer;
}

/* =========================================================
   CHAT API
========================================================= */

app.post(
  "/api/chat",
  async (req, res) => {
    try {
      const message =
        String(
          req.body?.message ||
            ""
        ).trim();

      if (!message) {
        return res
          .status(400)
          .json({
            error:
              "Please enter a question."
          });
      }

      if (
        message.length > 4000
      ) {
        return res
          .status(400)
          .json({
            error:
              "Question is too long. Please keep it under 4000 characters."
          });
      }

      if (!process.env.GEMINI_API_KEY) {
        return res
          .status(503)
          .json({
            error:
              "AI service is not configured yet."
          });
      }

      const answer =
        await generateResponse(
          message
        );

      return res.json({
        answer
      });

    } catch (error) {
      console.error(
        "BAAL-SETU ERROR:",
        error?.message ||
          error
      );

      return res
        .status(503)
        .json({
          error:
            "BAAL-SETU is temporarily busy. Please try again in a few seconds. If you need immediate help, contact 1098 or 112."
        });
    }
  }
);

/* =========================================================
   404
========================================================= */

app.use(
  (req, res) => {
    res
      .status(404)
      .json({
        error:
          "Page or API endpoint not found."
      });
  }
);

/* =========================================================
   START SERVER IMMEDIATELY
========================================================= */

const server =
  app.listen(
    PORT,
    "0.0.0.0",
    () => {
      console.log(
        `BAAL-SETU running on port ${PORT}`
      );

      console.log(
        "Server started immediately."
      );

      console.log(
        "Knowledge base will initialize in background."
      );

      /*
        IMPORTANT:
        Local knowledge loads AFTER
        the server has already started.
      */

      setImmediate(() => {
        try {
          loadLocalKnowledge();

          knowledgeReady = true;

          console.log(
            "Knowledge base ready."
          );

        } catch (error) {
          console.error(
            "Knowledge initialization error:",
            error.message
          );

          knowledgeReady = false;
        }
      });
    }
  );

/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */

function shutdown(signal) {
  console.log(
    `${signal} received. Closing server...`
  );

  server.close(() => {
    console.log(
      "Server closed."
    );

    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 10000);
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

/* =========================================================
   UNHANDLED ERRORS
========================================================= */

process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "Unhandled promise rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "Uncaught exception:",
      error
    );
  }
);
