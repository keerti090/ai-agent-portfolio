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

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const REQUIRED_ENV_VARS = ["OPENAI_API_KEY"] as const;
const missingEnv = REQUIRED_ENV_VARS.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnv.join(", ")}`);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_ROOT = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const PDF_SOURCE = process.env.PDF_DIR ? path.resolve(process.env.PDF_DIR) : DATA_ROOT;
const WEBSITE_SOURCE = process.env.WEBSITE_DIR ? path.resolve(process.env.WEBSITE_DIR) : path.join(DATA_ROOT, "websites");
import { systemprompt } from "./systemprompt.js";

const app = express();
app.use(bodyParser.json());
app.use(cors({ origin: "*" }));

console.log("🔑 OPENAI KEY:", process.env.OPENAI_API_KEY ? "Loaded" : "❌ Missing");

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

// Needed for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let vectorstore: MemoryVectorStore | null = null;

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

  // Load each HTML source
  for (const src of sources) {
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
    chunkSize: 1200,
    chunkOverlap: 200,
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

    const vectorstore = await getVectorStore();
    console.log("Vector store ready with docs:", vectorstore.memoryVectors.length);

    // Search with scores
    const results = await vectorstore.similaritySearchWithScore(trimmedMessage, 5);

    searchResults.forEach((doc, i) => {
      console.log(`--- MATCH ${i + 1}`);
      console.log(doc.pageContent.slice(0, 300), "...\n");
    });

    const context = searchResults
      .map((doc) => doc.pageContent)
      .join("\n---\n");

    console.log("🧠 FINAL CONTEXT SENT TO LLM:\n", context.slice(0, 2000));

    //
    // 🔸 CREATE SYSTEM + USER MESSAGE
    //
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemprompt },
      { role: "user", content: `Answer in a friendly portfolio style. Ask if they wanna know more.\n\nContext:\n${context}\n\nQuestion: ${trimmedMessage}` },
    ];

    //
    // 🔸 CALL OPENAI
    //
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
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
  res.json({ status: "ok" });
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

app.listen(parsedPort, () => {
  console.log(`🚀 Server running on http://localhost:${parsedPort}`);
});
