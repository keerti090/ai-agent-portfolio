// import express from "express";
// import * as dotenv from "dotenv";
// import cors from "cors";
// import bodyParser from "body-parser";
// import fs from "fs";
// import path from "path";
// import pdf from "pdf-parse";
// import cheerio from "cheerio";

// import { systemPrompt } from "./SystemPrompt";
// import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
// import { FAISS } from "langchain/vectorstores/faiss";
// import { Document } from "langchain/document";
// import { SentenceTransformerEmbeddings } from "langchain/embeddings/sentence_transformer";
// import { LLM } from "langchain/llms/base";


// dotenv.config();

// const app = express();
// app.use(cors());
// app.use(express.json());

// // Debug mode middleware
// app.use((req, res, next) => {
//   console.log("➡️ Incoming request:", req.method, req.url);
//   console.log("Body:", req.body);
//   next();
// });

// app.post("/api/chat", async (req, res) => {
//   try {
//     const apiKey = process.env.VITE_OPENROUTER_API_KEY;
//     console.log("🔑 Using API key:", apiKey?.slice(0, 10) + "..."); // show partial key

//     if (!apiKey) {
//       console.error("❌ No API key found in environment variables");
//       return res.status(500).json({ error: "Server missing API key" });
//     }

//     const requestBody = JSON.stringify(req.body);
//     console.log("📤 Sending request to OpenRouter:", requestBody);

//     const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
//       method: "POST",
//       headers: {
//         Authorization: `Bearer ${apiKey}`,
//         "Content-Type": "application/json",
//       },
//       body: requestBody,
//     });

//     const responseText = await response.text();
//     console.log("📥 OpenRouter response status:", response.status);
//     console.log("📥 OpenRouter raw response:", responseText);

//     if (!response.ok) {
//       return res.status(response.status).json({ error: "Failed request to OpenRouter", details: responseText });
//     }

//     const data = JSON.parse(responseText);
//     res.json(data);
//   } catch (error) {
//     console.error("🔥 Backend error:", error);
//     res.status(500).json({ error: "Server error" });
//   }
// });

// const PORT = 3001;
// app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));

// backend/server.ts

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

    if (!vectorstore) {
      vectorstore = await buildVectorStore();
    }

    // Search relevant chunks
    const results = await vectorstore.similaritySearch(message, 5);
    const context = results.map(r => r.pageContent).join("\n");

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemprompt },
      { role: "user", content: `Answer in a friendly portfolio style. Ask if they wanna know more\n\nContext:\n${context}\n\nQuestion: ${message} Always pull project details from the case studies above if relevent` },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      messages,
    });

    res.json({
      answer: completion.choices[0].message.content,
    });
  } catch (err) {
    console.error(err);
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
