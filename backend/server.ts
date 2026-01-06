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
import nodemailer from "nodemailer";

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
const DEFAULT_CONTACT_EMAIL = "keerti.hegdev@gmail.com";

type ContactSessionState =
  | { mode: "awaiting_message"; createdAt: number };

const contactSessions = new Map<string, ContactSessionState>();

function getSessionKey(req: express.Request): string {
  const body = req.body as unknown;
  const sessionId =
    typeof body === "object" && body !== null && "sessionId" in body
      ? (body as { sessionId?: unknown }).sessionId
      : undefined;

  if (typeof sessionId === "string" && sessionId.trim()) {
    return sessionId.trim();
  }
  // Fallback if the UI didn't send a session id.
  return `ip:${req.ip}`;
}

function pruneOldContactSessions(now = Date.now()) {
  // Keep contact "awaiting message" sessions short-lived.
  const ttlMs = 30 * 60 * 1000;
  for (const [key, state] of contactSessions.entries()) {
    if (now - state.createdAt > ttlMs) {
      contactSessions.delete(key);
    }
  }
}

function getMailer() {
  const host = (process.env.SMTP_HOST ?? "").trim();
  const port = Number(process.env.SMTP_PORT ?? "587");
  const secure = String(process.env.SMTP_SECURE ?? "false").toLowerCase() === "true";
  const user = (process.env.SMTP_USER ?? "").trim();
  const pass = (process.env.SMTP_PASS ?? "").trim();

  if (!host || !user || !pass || Number.isNaN(port)) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

type QueryLogMode = "off" | "immediate" | "daily";

type QueryLogEntry = {
  timestamp: string; // ISO string
  message: string;
  sessionId?: string;
  sessionKey: string;
  ip?: string;
  userAgent?: string;
  referer?: string;
};

type QueryLogState = {
  lastEmailedByte?: number;
  lastDailySentYmd?: string; // YYYY-MM-DD (server local time)
};

function isTruthyEnv(value: string | undefined, defaultValue = false): boolean {
  if (value == null) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return defaultValue;
}

function getQueryLogMode(): QueryLogMode {
  const raw = (process.env.QUERY_LOG_EMAIL_MODE ?? "off").trim().toLowerCase();
  if (raw === "immediate" || raw === "daily" || raw === "off") return raw;
  return "off";
}

function getQueryLogDir(dataRoot: string): string {
  const override = (process.env.QUERY_LOG_DIR ?? "").trim();
  return override ? path.resolve(override) : path.join(dataRoot, "query-logs");
}

function ensureDirExists(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getQueryLogPath(queryLogDir: string): string {
  return path.join(queryLogDir, "queries.ndjson");
}

function getQueryLogStatePath(queryLogDir: string): string {
  return path.join(queryLogDir, "state.json");
}

function readQueryLogState(queryLogDir: string): QueryLogState {
  const statePath = getQueryLogStatePath(queryLogDir);
  try {
    if (!fs.existsSync(statePath)) return {};
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const candidate = parsed as QueryLogState;
    return {
      lastEmailedByte: typeof candidate.lastEmailedByte === "number" ? candidate.lastEmailedByte : undefined,
      lastDailySentYmd: typeof candidate.lastDailySentYmd === "string" ? candidate.lastDailySentYmd : undefined,
    };
  } catch (error) {
    console.error("⚠️ Failed reading query log state:", error);
    return {};
  }
}

function writeQueryLogState(queryLogDir: string, state: QueryLogState) {
  const statePath = getQueryLogStatePath(queryLogDir);
  const tmpPath = `${statePath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmpPath, statePath);
  } catch (error) {
    console.error("⚠️ Failed writing query log state:", error);
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // ignore
    }
  }
}

function maybeAppendQueryLog(
  entry: QueryLogEntry,
  queryLogDir: string,
) {
  const enabled = isTruthyEnv(process.env.QUERY_LOG_ENABLED, false);
  if (!enabled) return;

  try {
    ensureDirExists(queryLogDir);
    const logPath = getQueryLogPath(queryLogDir);
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    console.error("⚠️ Failed appending query log:", error);
  }
}

function requireAdminToken(req: express.Request): boolean {
  const token = (process.env.QUERY_LOG_ADMIN_TOKEN ?? "").trim();
  if (!token) return false;
  const header = (req.headers.authorization ?? "").trim();
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice("bearer ".length).trim() === token;
  }
  // Allow query param for quick manual use.
  if (typeof req.query.token === "string" && req.query.token.trim()) {
    return req.query.token.trim() === token;
  }
  return false;
}

function getYmdLocal(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function readFileRangeBytes(
  filePath: string,
  start: number,
  endExclusive: number,
): Promise<Buffer> {
  const length = Math.max(0, endExclusive - start);
  if (length === 0) return Buffer.from([]);
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer;
  } finally {
    await handle.close();
  }
}

async function sendQueryLogEmail(opts: {
  reason: "immediate" | "daily" | "manual";
  queryLogDir: string;
  sessionKeyForSubject?: string;
}) {
  const mailer = getMailer();
  if (!mailer) {
    throw new Error("SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing).");
  }

  const to = (process.env.QUERY_LOG_EMAIL_TO ?? "").trim();
  if (!to) {
    throw new Error("QUERY_LOG_EMAIL_TO is missing.");
  }

  const from = (process.env.QUERY_LOG_EMAIL_FROM ?? process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "").trim();
  if (!from) {
    throw new Error("QUERY_LOG_EMAIL_FROM (or SMTP_FROM/SMTP_USER) is missing.");
  }

  ensureDirExists(opts.queryLogDir);
  const logPath = getQueryLogPath(opts.queryLogDir);
  if (!fs.existsSync(logPath)) {
    // Nothing to send.
    return { sent: false, bytes: 0, truncated: false };
  }

  const mode = getQueryLogMode();
  const maxBytes = Number(process.env.QUERY_LOG_EMAIL_MAX_BYTES ?? "1048576");
  const safeMaxBytes = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 1048576;

  const stat = fs.statSync(logPath);
  const state = readQueryLogState(opts.queryLogDir);
  const defaultStart = 0;
  const startOffset =
    mode === "immediate"
      ? Math.max(0, stat.size - safeMaxBytes)
      : typeof state.lastEmailedByte === "number"
        ? Math.min(Math.max(0, state.lastEmailedByte), stat.size)
        : defaultStart;

  let start = startOffset;
  const end = stat.size;
  let truncated = false;

  if (end - start > safeMaxBytes) {
    start = Math.max(0, end - safeMaxBytes);
    truncated = true;
  }

  const bytes = await readFileRangeBytes(logPath, start, end);
  if (bytes.length === 0) {
    return { sent: false, bytes: 0, truncated: false };
  }

  const subjectBase = (process.env.QUERY_LOG_EMAIL_SUBJECT ?? "Kairo — user query log").trim() || "Kairo — user query log";
  const subjectSuffix = opts.sessionKeyForSubject ? ` (${opts.sessionKeyForSubject})` : "";
  const subject = `${subjectBase} — ${getYmdLocal()} [${opts.reason}]${subjectSuffix}`;

  const lineCount = bytes.toString("utf8").split("\n").filter(Boolean).length;
  const bodyLines: string[] = [
    `Reason: ${opts.reason}`,
    `Date: ${getYmdLocal()}`,
    `Entries in attachment (approx): ${lineCount}`,
    `Bytes attached: ${bytes.length}`,
  ];
  if (truncated) {
    bodyLines.push("");
    bodyLines.push(`NOTE: Attachment was truncated to last ${safeMaxBytes} bytes.`);
  }

  await mailer.sendMail({
    from,
    to,
    subject,
    text: bodyLines.join("\n"),
    attachments: [
      {
        filename: `queries-${getYmdLocal()}.ndjson`,
        content: bytes,
        contentType: "application/x-ndjson",
      },
    ],
  });

  // Mark as emailed up to current EOF (best-effort).
  writeQueryLogState(opts.queryLogDir, {
    ...state,
    lastEmailedByte: end,
    lastDailySentYmd: opts.reason === "daily" ? getYmdLocal() : state.lastDailySentYmd,
  });

  return { sent: true, bytes: bytes.length, truncated };
}

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
console.log("🧾 QUERY LOGGING:", isTruthyEnv(process.env.QUERY_LOG_ENABLED, false) ? "Enabled" : "Disabled");

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

    pruneOldContactSessions();
    const sessionKey = getSessionKey(req);
    const bodySessionId =
      typeof req.body === "object" && req.body !== null && "sessionId" in (req.body as Record<string, unknown>)
        ? (req.body as { sessionId?: unknown }).sessionId
        : undefined;
    const sessionId = typeof bodySessionId === "string" && bodySessionId.trim() ? bodySessionId.trim() : undefined;

    const queryLogDir = getQueryLogDir(DATA_ROOT);
    maybeAppendQueryLog(
      {
        timestamp: new Date().toISOString(),
        message: trimmedMessage,
        sessionId,
        sessionKey,
        ip: req.ip,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
        referer: typeof req.headers.referer === "string" ? req.headers.referer : undefined,
      },
      queryLogDir,
    );

    // Optional: email each query right away (useful for quick training loops).
    if (getQueryLogMode() === "immediate" && isTruthyEnv(process.env.QUERY_LOG_ENABLED, false)) {
      const fireAndForget = isTruthyEnv(process.env.QUERY_LOG_EMAIL_FIRE_AND_FORGET, true);
      const send = async () => {
        try {
          await sendQueryLogEmail({ reason: "immediate", queryLogDir, sessionKeyForSubject: sessionKey });
        } catch (error) {
          console.error("⚠️ Failed emailing query log (immediate):", error);
        }
      };
      if (fireAndForget) {
        void send();
      } else {
        await send();
      }
    }

    const contactEmail = (process.env.CONTACT_EMAIL ?? DEFAULT_CONTACT_EMAIL).trim();
    const contactLinkedInUrl = (process.env.CONTACT_LINKEDIN_URL ?? DEFAULT_LINKEDIN_URL).trim();

    const isContactIntent = /\b(contact|email|e-mail|reach|connect|schedule|shedule|book|booking|call|meeting|chat|talk|interview)\b/i.test(
      trimmedMessage
    );

    const activeContactState = contactSessions.get(sessionKey);

    // If we're collecting a message to email, treat the user's next message as the email body.
    if (activeContactState?.mode === "awaiting_message") {
      const isCancel = /\b(cancel|never mind|nevermind|stop)\b/i.test(trimmedMessage);
      if (isCancel) {
        contactSessions.delete(sessionKey);
        return res.json({
          answer: "No problem — I won’t send anything. If you want, you can ask again anytime to contact Keerti.",
        });
      }

      const maxLen = 4000;
      const body = trimmedMessage.slice(0, maxLen);
      const subject = "Portfolio message via Kairo";

      const mailer = getMailer();
      if (!mailer) {
        contactSessions.delete(sessionKey);
        const mailto = `mailto:${encodeURIComponent(contactEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        return res.json({
          answer:
            `I’m not configured to send email directly from this server yet.\n\n` +
            `Please copy/paste this message into an email to **${contactEmail}**:\n\n` +
            `${body}\n\n` +
            `Or use this link: ${mailto}`,
        });
      }

      const from = (process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "").trim();
      if (!from) {
        contactSessions.delete(sessionKey);
        return res.status(500).json({
          error: "SMTP is configured but SMTP_FROM (or SMTP_USER) is missing.",
        });
      }

      await mailer.sendMail({
        from,
        to: contactEmail,
        subject,
        text: body,
      });

      contactSessions.delete(sessionKey);
      return res.json({
        answer: `Sent — I just emailed your message to **${contactEmail}**.`,
      });
    }

    // Start contact flow: ask what they want to write, then email it on the next message.
    if (isContactIntent) {
      contactSessions.set(sessionKey, { mode: "awaiting_message", createdAt: Date.now() });
      return res.json({
        answer:
          `## Contact Keerti\n` +
          `- **Email**: ${contactEmail}\n\n` +
          `What would you like to write?\n` +
          `Reply with the message you want to send, and I’ll forward it to Keerti.`,
      });
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
      `Email: ${contactEmail}`,
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

app.get("/admin/query-logs/status", (req, res) => {
  if (!requireAdminToken(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const queryLogDir = getQueryLogDir(DATA_ROOT);
  const logPath = getQueryLogPath(queryLogDir);
  const exists = fs.existsSync(logPath);
  const stat = exists ? fs.statSync(logPath) : null;
  const state = readQueryLogState(queryLogDir);

  return res.json({
    enabled: isTruthyEnv(process.env.QUERY_LOG_ENABLED, false),
    emailMode: getQueryLogMode(),
    logPath,
    exists,
    sizeBytes: stat?.size ?? 0,
    state,
  });
});

app.get("/admin/query-logs/download", (req, res) => {
  if (!requireAdminToken(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const queryLogDir = getQueryLogDir(DATA_ROOT);
  const logPath = getQueryLogPath(queryLogDir);
  if (!fs.existsSync(logPath)) {
    return res.status(404).json({ error: "No query log file yet." });
  }

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Content-Disposition", `attachment; filename="queries.ndjson"`);
  return res.sendFile(logPath);
});

app.post("/admin/query-logs/send", async (req, res) => {
  if (!requireAdminToken(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const queryLogDir = getQueryLogDir(DATA_ROOT);
  try {
    const result = await sendQueryLogEmail({ reason: "manual", queryLogDir });
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error("🔥 /admin/query-logs/send error:", error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Failed to send email." });
  }
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

// Optional daily digest (server-local time).
if (getQueryLogMode() === "daily" && isTruthyEnv(process.env.QUERY_LOG_ENABLED, false)) {
  const queryLogDir = getQueryLogDir(DATA_ROOT);
  const hour = Number(process.env.QUERY_LOG_EMAIL_HOUR ?? "9");
  const minute = Number(process.env.QUERY_LOG_EMAIL_MINUTE ?? "0");
  const safeHour = Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 9;
  const safeMinute = Number.isFinite(minute) ? Math.min(59, Math.max(0, minute)) : 0;

  console.log(`📬 Query log digest enabled: daily at ${String(safeHour).padStart(2, "0")}:${String(safeMinute).padStart(2, "0")}`);

  setInterval(() => {
    const now = new Date();
    if (now.getHours() !== safeHour || now.getMinutes() !== safeMinute) return;

    const state = readQueryLogState(queryLogDir);
    const today = getYmdLocal(now);
    if (state.lastDailySentYmd === today) return;

    void (async () => {
      try {
        await sendQueryLogEmail({ reason: "daily", queryLogDir });
      } catch (error) {
        console.error("⚠️ Failed emailing query log (daily):", error);
      }
    })();
  }, 60_000).unref();
}
