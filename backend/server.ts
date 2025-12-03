import dotenv from "dotenv";
import cors from "cors";
dotenv.config();

import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
// import * as pdf from "pdf-parse";
// import pdf from 'pdf-parse/lib/pdf-parse'
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import * as cheerio from "cheerio";
import { Document } from "langchain/document";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings } from "@langchain/openai";
import OpenAI from "openai";
import { systemprompt } from "./systemprompt.js";
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

const app = express();
app.use(bodyParser.json());
app.use(cors({ origin: "*" }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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
// 🔹 PDF loader
//
// async function loadPDF(filePath: string): Promise<Document[]> {
//   const buffer = fs.readFileSync(filePath);
//   const data = await pdf.default(buffer);
//   return [
//     new Document({
//       pageContent: data.text,
//       metadata: { source: filePath },
//     }),
//   ];
// }
async function loadPDF(filePath: string) {
  const loader = new PDFLoader(filePath);
  return await loader.load();
}
//
// 🔹 HTML loader
//
async function loadWebsite(filePath: string): Promise<Document[]> {
  const html = fs.readFileSync(filePath, "utf-8");
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();

  return [
    new Document({
      pageContent: text,
      metadata: { source: filePath },
    }),
  ];
}

//
// 🔹 Build Vector Store
//
async function buildVectorStore(): Promise<MemoryVectorStore> {
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

  // Split into chunks
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  const splitDocs = await splitter.splitDocuments(docs);

  // Use OpenAI embeddings
  const embeddings = new OpenAIEmbeddings({
    model: "text-embedding-3-small",
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  return await MemoryVectorStore.fromDocuments(splitDocs, embeddings);
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
// 🔹 Ask endpoint
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

    console.log("Raw results count:", results.length);

    const relevantDocs = results.filter(([doc, score]) => score > 0.7);
    console.log("Relevant docs count:", relevantDocs.length);

    const context = relevantDocs.map(([doc]) => doc.pageContent).join("\n");
    console.log("Context snippet:", context.slice(0, 200));

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemprompt },
      { role: "user", content: `Answer in a friendly portfolio style. Ask if they wanna know more.\n\nContext:\n${context}\n\nQuestion: ${trimmedMessage}` },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages,
    });

    res.json({
      answer: completion.choices[0].message.content,
    });
  } catch (err) {
    console.error("🔥 Error in /ask:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

//
// 🔹 Start server
//
const parsedPort = Number(process.env.PORT ?? 3000);
if (Number.isNaN(parsedPort)) {
  throw new Error("PORT must be a number");
}

app.listen(parsedPort, () => {
  console.log(`🚀 Server running on http://localhost:${parsedPort}`);
});
