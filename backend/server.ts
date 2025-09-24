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


const app = express();
app.use(bodyParser.json());
app.use(cors({ origin: "*" }));
console.log("OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "✅ found" : "❌ missing-early");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
console.log("OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "✅ found111" : "❌ missing111");
let vectorstore: MemoryVectorStore | null = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  const pdfDir = path.join(__dirname, "data/search.pdf");
  console.log("file path:", pdfDir);
  if (fs.existsSync(pdfDir)) {
    const files = fs.readdirSync(pdfDir).filter(f => f.endsWith(".pdf"));
    for (const f of files) {
      docs.push(...(await loadPDF(path.join(pdfDir, f))));
    }
  }


  // Load Websites
  const webDir = path.join(__dirname, "data/websites");
  if (fs.existsSync(webDir)) {
    const files = fs.readdirSync(webDir).filter(f => f.endsWith(".html"));
    for (const f of files) {
      docs.push(...(await loadWebsite(path.join(webDir, f))));
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

//
// 🔹 Ask endpoint
//
app.post("/ask", async (req, res) => {
  try {
    const { message } = req.body;
    console.log("Received message:", message);

    if (!vectorstore) {
      vectorstore = await buildVectorStore();
      console.log("Vector store initialized with docs:", vectorstore.memoryVectors.length);
    }

    // Search with scores
    const results = await vectorstore.similaritySearchWithScore(message, 5);

    console.log("Raw results count:", results.length);

    const relevantDocs = results.filter(([doc, score]) => score > 0.7);
    console.log("Relevant docs count:", relevantDocs.length);

    const context = relevantDocs.map(([doc]) => doc.pageContent).join("\n");
    console.log("Context snippet:", context.slice(0, 200));

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemprompt },
      { role: "user", content: `Answer in a friendly portfolio style. Ask if they wanna know more.\n\nContext:\n${context}\n\nQuestion: ${message}` },
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

//
// 🔹 Start server
//
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
