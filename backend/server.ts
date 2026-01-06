import dotenv from "dotenv";
import cors from "cors";
dotenv.config();

import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";

import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { systemprompt } from "./systemprompt.js";

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const REQUIRED_ENV_VARS = ["OPENAI_API_KEY"] as const;
const missingEnv = REQUIRED_ENV_VARS.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnv.join(", ")}`);
}

const DEFAULT_LINKEDIN_URL = "https://www.linkedin.com/in/keertihegde/";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_ROOT = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const PDF_SOURCE = process.env.PDF_DIR ? path.resolve(process.env.PDF_DIR) : DATA_ROOT;
const WEBSITE_SOURCE = process.env.WEBSITE_DIR ? path.resolve(process.env.WEBSITE_DIR) : path.join(DATA_ROOT, "websites");
const REMOTE_SOURCE_ENV = process.env.HTML_SOURCES ?? process.env.WEBSITE_SOURCES ?? "";
const remoteSources = REMOTE_SOURCE_ENV.split(",")
  .map(src => src.trim())
  .filter(Boolean);

const app = express();
app.use(bodyParser.json());
app.use(cors({ origin: "*" }));

console.log("🔑 OPENAI KEY:", process.env.OPENAI_API_KEY ? "Loaded" : "❌ Missing");
console.log("📩 CONTACT EMAIL:", process.env.CONTACT_EMAIL ? "Loaded" : "Not set");

const CASE_STUDIES: Record<string, { filename: string }> = {
  search: { filename: "Search-Feature case study.pdf" },
  zentra: { filename: "Zentra Case study.pdf" },
  "optym-lms": { filename: "Optym - LMS.pdf" },
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});
let vectorstorePromise: Promise<MemoryVectorStore> | null = null;

function listFiles(targetPath: string, extension: string): string[] {
  try {
    if (!fs.existsSync(targetPath)) {
      return [];
    }

    const stats = fs.statSync(targetPath);
    const matchesExtension = (filePath: string) => filePath.toLowerCase().endsWith(extension.toLowerCase());

    if (stats.isDirectory()) {
      return fs
        .readdirSync(targetPath)
        .map(file => path.join(targetPath, file))
        .filter(filePath => {
          const fileStats = fs.statSync(filePath);
          return fileStats.isFile() && matchesExtension(filePath);
        });
    }

    if (stats.isFile() && matchesExtension(targetPath)) {
      return [targetPath];
    }

    return [];
  } catch (error) {
    console.error(`Failed to list files for ${targetPath}:`, error);
    return [];
  }
}

//
// ======================================
// 🔹 PDF LOADER
// ======================================
//
async function loadPDF(filePath: string) {
  console.log("📄 Loading PDF:", filePath);
  const loader = new PDFLoader(filePath);
  const docs = await loader.load();
  console.log(`   → Loaded ${docs.length} pages from PDF`);
  return docs;
}

//
// ======================================
// 🔹 HTML LOADER (REMOTE + LOCAL)
// ======================================
//
async function loadWebsite(src: string): Promise<Document[]> {
  console.log("🌐 Loading website / HTML:", src);

  let html = "";

  try {
    if (src.startsWith("http")) {
      const response = await fetch(src);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      html = await response.text();
    } else {
      html = fs.readFileSync(src, "utf8");
    }
  } catch (err) {
    console.error("   ⚠️ Error fetching HTML:", err);
    throw err;
  }

  const $ = cheerio.load(html);

  // Extract visible text from body
  const text = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim();

  // Extract image URLs (if helpful later)
  const images: string[] = [];
  $("img").each((_, img) => {
    const url = $(img).attr("src");
    if (url) images.push(url);
  });

  const combinedContent = `
TEXT CONTENT:
${text}

IMAGES:
${images.join("\n")}
  `.trim();

  console.log(
    "   → Extracted text length:",
    combinedContent.length,
    "chars"
  );

  return [
    new Document({
      pageContent: combinedContent,
      metadata: { source: src },
    }),
  ];
}

//
// ======================================
// 🔹 BUILD VECTOR STORE
// ======================================
//
async function buildVectorStore(): Promise<MemoryVectorStore> {
  console.log("\n==============================");
  console.log("🚧 Building vector store...");
  console.log("==============================");

  const docs: Document[] = [];

  // Load PDFs
  const pdfFiles = listFiles(PDF_SOURCE, ".pdf");
  for (const pdfFile of pdfFiles) {
    console.log(`Loading PDF source: ${pdfFile}`);
    docs.push(...(await loadPDF(pdfFile)));
  }

  // Load Websites
  const websiteDirExists = fs.existsSync(WEBSITE_SOURCE) && fs.statSync(WEBSITE_SOURCE).isDirectory();
  if (websiteDirExists) {
    const files = fs.readdirSync(WEBSITE_SOURCE).filter(f => f.toLowerCase().endsWith(".html"));
    for (const file of files) {
      const websitePath = path.join(WEBSITE_SOURCE, file);
      console.log(`Loading HTML source: ${websitePath}`);
      docs.push(...(await loadWebsite(websitePath)));
    }
  }

  // Load each remote HTML source from env
  for (const src of remoteSources) {
    try {
      const loaded = await loadWebsite(src);
      docs.push(...loaded);
      console.log("✔️ Loaded HTML source:", src);
    } catch (err) {
      console.error("⚠️ Failed loading HTML source:", src, err);
    }
  }

  console.log("📄 RAW DOC COUNT:", docs.length);
  docs.forEach((d, i) => {
    console.log(`--- DOC #${i + 1} (${d.metadata.source})`);
    console.log("PREVIEW:", d.pageContent.slice(0, 400), "...\n");
  });

  //
  // 🔸 SPLIT CHUNKS
  //
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 2000,
    chunkOverlap: 400,
  });

  const splitDocs = await splitter.splitDocuments(docs);
  console.log("✂️ TOTAL SPLIT CHUNKS:", splitDocs.length);

  //
  // 🔸 EMBEDDINGS + VECTOR STORE
  //
  const embeddings = new OpenAIEmbeddings({
    model: "text-embedding-3-small",
    apiKey: process.env.OPENAI_API_KEY,
  });

  const store = await MemoryVectorStore.fromDocuments(splitDocs, embeddings);
  console.log("🧠 Vector store created successfully!");

  return store;
}

async function getVectorStore() {
  if (!vectorstorePromise) {
    vectorstorePromise = buildVectorStore().catch(error => {
      vectorstorePromise = null;
      throw error;
    });
  }
  return vectorstorePromise;
}

//
// ======================================
// 🔹 ASK ENDPOINT
// ======================================
//
app.post("/ask", async (req, res) => {
  try {
    const { message } = req.body;
    if (typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "Request body must include a non-empty 'message' string." });
    }

    const trimmedMessage = message.trim();
    console.log("Received message:", trimmedMessage);

    const contactEmail = (process.env.CONTACT_EMAIL ?? "").trim();
    const contactLinkedInUrl = (process.env.CONTACT_LINKEDIN_URL ?? DEFAULT_LINKEDIN_URL).trim();

    const isContactIntent = /\b(contact|email|e-mail|reach|connect|schedule|shedule|book|booking|call|meeting|chat|talk|interview)\b/i.test(
      trimmedMessage
    );

    // Hard guarantee: if they ask for contact/scheduling, return contact info immediately.
    if (isContactIntent) {
      const lines: string[] = ["## Contact Keerti"];
      if (contactEmail) {
        lines.push(`- **Email (best)**: ${contactEmail}`);
        lines.push("", "If you’d like to schedule a call, please email me with:");
        lines.push("- your name + company");
        lines.push("- what you’d like to discuss");
        lines.push("- 2–3 time windows + your timezone");
      } else {
        lines.push(`- **LinkedIn**: ${contactLinkedInUrl}`);
        lines.push("", "Email isn’t configured on this site yet — if you want email support here, set `CONTACT_EMAIL` on the server.");
      }
      return res.json({ answer: lines.join("\n") });
    }

    const vectorstore = await getVectorStore();
    console.log("Vector store ready with docs:", vectorstore.memoryVectors.length);

    // Search with scores - retrieve more chunks for better context
    const searchResults = await vectorstore.similaritySearchWithScore(trimmedMessage, 8);

    searchResults.forEach(([doc], i) => {
      console.log(`--- MATCH ${i + 1}`);
      console.log(doc.pageContent.slice(0, 300), "...\n");
    });

    const context = searchResults
      .map(([doc]) => doc.pageContent)
      .join("\n---\n");

    console.log("🧠 FINAL CONTEXT SENT TO LLM:\n", context.slice(0, 2000));

    //
    // 🔸 CREATE SYSTEM + USER MESSAGE
    //
    const contactInfoLines: string[] = [
      "CONTACT INFO (use this when the user asks to contact/schedule):",
      contactEmail ? `Email: ${contactEmail}` : "Email: (not provided)",
      `LinkedIn: ${contactLinkedInUrl}`,
    ];
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemprompt },
      { role: "system", content: contactInfoLines.join("\n") },
      { 
        role: "user", 
        content: `Use the context below to answer with SPECIFIC, CONCRETE details from Keerti's work. Extract actual project names, numbers, outcomes, and methodologies. NEVER use placeholder text or generic descriptions.

Context from case studies:
${context}

User Question: ${trimmedMessage}

Remember: Be specific, use real data from the context, and avoid vague language.` 
      },
    ];

    //
    // 🔸 CALL OPENAI
    //
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.5,
      messages,
    });

    const answer = completion.choices[0].message.content;

    res.json({ answer });
  } catch (err) {
    console.error("🔥 /ask error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.get("/healthz", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ status: "ok" });
});

// Alias for uptime monitors that expect `/health`.
app.get("/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("text/plain").send("ok");
});

// Serve case study PDFs for "preview links" in the UI.
app.get("/case-studies/:slug", (req, res) => {
  const { slug } = req.params;
  const entry = CASE_STUDIES[slug];
  if (!entry) {
    return res.status(404).json({
      error: "Unknown case study. Valid slugs: " + Object.keys(CASE_STUDIES).join(", "),
    });
  }

  const resolvedSource = fs.existsSync(PDF_SOURCE) && fs.statSync(PDF_SOURCE).isDirectory()
    ? path.join(PDF_SOURCE, entry.filename)
    : path.join(DATA_ROOT, entry.filename);

  if (!fs.existsSync(resolvedSource)) {
    return res.status(404).json({ error: `Missing PDF on server: ${entry.filename}` });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${entry.filename}"`);
  return res.sendFile(resolvedSource);
});

//
// ======================================
// 🔹 START SERVER
// ======================================
//
const parsedPort = Number(process.env.PORT ?? 3000);
if (Number.isNaN(parsedPort)) {
  throw new Error("PORT must be a number");
}

const host = (process.env.HOST ?? "0.0.0.0").trim();
app.listen(parsedPort, host, () => {
  console.log(`🚀 Server running on http://${host}:${parsedPort}`);
});
