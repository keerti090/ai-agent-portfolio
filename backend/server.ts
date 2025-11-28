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

import { systemprompt } from "./systemprompt.js";

const app = express();
app.use(bodyParser.json());
app.use(cors({ origin: "*" }));

console.log("🔑 OPENAI KEY:", process.env.OPENAI_API_KEY ? "Loaded" : "❌ Missing");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

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

  //
  // 🔸 LOAD PDFs from backend/data
  //
  const dataDir = path.join(__dirname, "../backend/data"); // <--- IMPORTANT FIX
  console.log("📁 Looking for data in:", dataDir);

  if (fs.existsSync(dataDir)) {
    // PDFs
    const pdfFiles = fs.readdirSync(dataDir).filter((f) => f.toLowerCase().endsWith(".pdf"));
    if (pdfFiles.length === 0) {
      console.log("   ⚠️ No PDF files found in data directory.");
    } else {
      console.log("   📄 Found PDF files:", pdfFiles);
      for (const file of pdfFiles) {
        const filePath = path.join(dataDir, file);
        const loaded = await loadPDF(filePath);
        docs.push(...loaded);
      }
    }
  } else {
    console.log("   ⚠️ Data directory does not exist:", dataDir);
  }

  //
  // 🔸 LOAD HTML (Webflow public URL + any local HTML files in data/)
  //
  const sources: string[] = [];

  // 1) Public Webflow URL (no path.join)
  sources.push("https://keertis-dapper-site.webflow.io/");

  // 2) Any local .html/.htm files in backend/data
  if (fs.existsSync(dataDir)) {
    const htmlFiles = fs
      .readdirSync(dataDir)
      .filter(
        (f) =>
          f.toLowerCase().endsWith(".html") ||
          f.toLowerCase().endsWith(".htm")
      );

    if (htmlFiles.length > 0) {
      console.log("   🧾 Found local HTML files:", htmlFiles);
      for (const file of htmlFiles) {
        sources.push(path.join(dataDir, file));
      }
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

//
// ======================================
// 🔹 ASK ENDPOINT
// ======================================
//
app.post("/ask", async (req, res) => {
  try {
    const { message } = req.body as { message: string };

    console.log("\n==============================");
    console.log("💬 USER QUESTION:", message);
    console.log("==============================\n");

    if (!vectorstore) {
      vectorstore = await buildVectorStore();
    }

    //
    // 🔸 SEARCH VECTOR STORE
    //
    const searchResults = await vectorstore.similaritySearch(message, 5);
    console.log("🔍 Retrieved Chunks:", searchResults.length);

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
      {
        role: "system",
        content: systemprompt, // if you want to keep using the imported system prompt
      },
      {
        role: "user",
        content: `
Use this context to answer:

${context}

Question:
${message}
        `,
      },
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

//
// ======================================
// 🔹 START SERVER
// ======================================
//
const PORT = 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
