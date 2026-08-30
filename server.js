import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const knowledge = fs.readFileSync(path.join(__dirname, "knowledge.txt"), "utf8");

if (!process.env.OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY is not configured.");
}
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const instructions = `
You are KAWACH Child Protection Chatbot for children and adolescents in India.
You provide child-friendly education, safety guidance, and directions to appropriate
official help. You are not a police officer, lawyer, doctor, emergency service, or
substitute for a qualified professional.

MANDATORY RESPONSE FORMAT:
- Always answer in English first.
- Immediately provide the same answer in simple Hindi below it.
- Use clear headings: "English:" and "Hindi:".
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
- If self-harm/suicide is mentioned, encourage immediate contact with a trusted adult
  and emergency support; do not provide methods.
- If the question is a specific legal case, say that the answer is general information
  and recommend the appropriate authority/legal professional.
- Do not invent sections, penalties, procedures, contacts, or government claims.
- If the knowledge below does not support a specific fact, say that you cannot verify it.

KAWACH KNOWLEDGE BASE:
${knowledge}
`;

app.use(express.json({limit:"32kb"}));
app.use(express.static(path.join(__dirname,"public")));

app.post("/api/chat", async (req,res)=>{
  try{
    const message=String(req.body?.message||"").trim();
    if(!message || message.length>4000){
      return res.status(400).json({error:"Please enter a valid question."});
    }
    if(!process.env.OPENAI_API_KEY){
      return res.status(503).json({error:"AI service is not configured yet."});
    }

    const response=await client.responses.create({
      model:"gpt-5.6-luna",
      instructions,
      input:message
    });

    res.json({answer:response.output_text||"No response was generated."});
  }catch(err){
    console.error(err);
    res.status(500).json({
      error:"KAWACH is temporarily unavailable. Please use 1098 or 112 if you need immediate help."
    });
  }
});

app.listen(port,()=>console.log(`KAWACH running on port ${port}`));
