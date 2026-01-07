import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import type express from "express";

export type QueryLogMode = "off" | "immediate" | "daily";

export type QueryLogEntry = {
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

export class QueryLogger {
  private readonly dataRoot: string;

  constructor(dataRoot: string) {
    this.dataRoot = dataRoot;
  }

  enabled(): boolean {
    return this.isTruthyEnv(process.env.QUERY_LOG_ENABLED, false);
  }

  emailMode(): QueryLogMode {
    const raw = (process.env.QUERY_LOG_EMAIL_MODE ?? "off").trim().toLowerCase();
    if (raw === "immediate" || raw === "daily" || raw === "off") return raw;
    return "off";
  }

  logDir(): string {
    const override = (process.env.QUERY_LOG_DIR ?? "").trim();
    return override ? path.resolve(override) : path.join(this.dataRoot, "query-logs");
  }

  logPath(): string {
    return path.join(this.logDir(), "queries.ndjson");
  }

  statePath(): string {
    return path.join(this.logDir(), "state.json");
  }

  logFromRequest(req: express.Request, message: string, sessionKey: string) {
    const bodySessionId =
      typeof req.body === "object" && req.body !== null && "sessionId" in (req.body as Record<string, unknown>)
        ? (req.body as { sessionId?: unknown }).sessionId
        : undefined;
    const sessionId = typeof bodySessionId === "string" && bodySessionId.trim() ? bodySessionId.trim() : undefined;

    this.append({
      timestamp: new Date().toISOString(),
      message,
      sessionId,
      sessionKey,
      ip: req.ip,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      referer: typeof req.headers.referer === "string" ? req.headers.referer : undefined,
    });
  }

  append(entry: QueryLogEntry) {
    if (!this.enabled()) return;
    try {
      this.ensureDirExists(this.logDir());
      fs.appendFileSync(this.logPath(), `${JSON.stringify(entry)}\n`, "utf8");
    } catch (error) {
      console.error("⚠️ Failed appending query log:", error);
    }
  }

  isAuthorized(req: express.Request): boolean {
    const token = (process.env.QUERY_LOG_ADMIN_TOKEN ?? "").trim();
    if (!token) return false;
    const header = (req.headers.authorization ?? "").trim();
    if (header.toLowerCase().startsWith("bearer ")) {
      return header.slice("bearer ".length).trim() === token;
    }
    if (typeof req.query.token === "string" && req.query.token.trim()) {
      return req.query.token.trim() === token;
    }
    return false;
  }

  getStatus() {
    const logPath = this.logPath();
    const exists = fs.existsSync(logPath);
    const stat = exists ? fs.statSync(logPath) : null;
    const state = this.readState();

    return {
      enabled: this.enabled(),
      emailMode: this.emailMode(),
      logPath,
      exists,
      sizeBytes: stat?.size ?? 0,
      state,
    };
  }

  maybeEmailImmediate(sessionKeyForSubject?: string) {
    if (!this.enabled()) return;
    if (this.emailMode() !== "immediate") return;

    const fireAndForget = this.isTruthyEnv(process.env.QUERY_LOG_EMAIL_FIRE_AND_FORGET, true);
    const send = async () => {
      try {
        await this.sendEmail({ reason: "immediate", sessionKeyForSubject });
      } catch (error) {
        console.error("⚠️ Failed emailing query log (immediate):", error);
      }
    };

    if (fireAndForget) {
      void send();
    } else {
      return send();
    }
  }

  async sendManualEmail() {
    return this.sendEmail({ reason: "manual" });
  }

  startDailyDigestScheduler() {
    if (!this.enabled()) return;
    if (this.emailMode() !== "daily") return;

    const hour = Number(process.env.QUERY_LOG_EMAIL_HOUR ?? "9");
    const minute = Number(process.env.QUERY_LOG_EMAIL_MINUTE ?? "0");
    const safeHour = Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 9;
    const safeMinute = Number.isFinite(minute) ? Math.min(59, Math.max(0, minute)) : 0;

    console.log(
      `📬 Query log digest enabled: daily at ${String(safeHour).padStart(2, "0")}:${String(safeMinute).padStart(2, "0")}`
    );

    setInterval(() => {
      const now = new Date();
      if (now.getHours() !== safeHour || now.getMinutes() !== safeMinute) return;

      const state = this.readState();
      const today = this.getYmdLocal(now);
      if (state.lastDailySentYmd === today) return;

      void (async () => {
        try {
          await this.sendEmail({ reason: "daily" });
        } catch (error) {
          console.error("⚠️ Failed emailing query log (daily):", error);
        }
      })();
    }, 60_000).unref();
  }

  private getMailer() {
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

  private ensureDirExists(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  private readState(): QueryLogState {
    try {
      const statePath = this.statePath();
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

  private writeState(state: QueryLogState) {
    const statePath = this.statePath();
    const tmpPath = `${statePath}.tmp`;
    try {
      this.ensureDirExists(this.logDir());
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

  private getYmdLocal(date = new Date()): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  private isTruthyEnv(value: string | undefined, defaultValue = false): boolean {
    if (value == null) return defaultValue;
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
    return defaultValue;
  }

  private async readFileRangeBytes(filePath: string, start: number, endExclusive: number): Promise<Buffer> {
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

  private async sendEmail(opts: { reason: "immediate" | "daily" | "manual"; sessionKeyForSubject?: string }) {
    const mailer = this.getMailer();
    if (!mailer) {
      throw new Error("SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing).");
    }

    const to = (process.env.QUERY_LOG_EMAIL_TO ?? process.env.CONTACT_EMAIL ?? "").trim();
    if (!to) {
      throw new Error("QUERY_LOG_EMAIL_TO (or CONTACT_EMAIL fallback) is missing.");
    }

    const from = (process.env.QUERY_LOG_EMAIL_FROM ?? process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "").trim();
    if (!from) {
      throw new Error("QUERY_LOG_EMAIL_FROM (or SMTP_FROM/SMTP_USER) is missing.");
    }

    this.ensureDirExists(this.logDir());
    const logPath = this.logPath();
    if (!fs.existsSync(logPath)) {
      return { sent: false, bytes: 0, truncated: false };
    }

    const maxBytes = Number(process.env.QUERY_LOG_EMAIL_MAX_BYTES ?? "1048576");
    const safeMaxBytes = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 1048576;

    const stat = fs.statSync(logPath);
    const state = this.readState();
    const defaultStart = 0;
    const startOffset =
      this.emailMode() === "immediate"
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

    const bytes = await this.readFileRangeBytes(logPath, start, end);
    if (bytes.length === 0) {
      return { sent: false, bytes: 0, truncated: false };
    }

    const subjectBase = (process.env.QUERY_LOG_EMAIL_SUBJECT ?? "Kairo — user query log").trim() || "Kairo — user query log";
    const subjectSuffix = opts.sessionKeyForSubject ? ` (${opts.sessionKeyForSubject})` : "";
    const subject = `${subjectBase} — ${this.getYmdLocal()} [${opts.reason}]${subjectSuffix}`;

    const lineCount = bytes.toString("utf8").split("\n").filter(Boolean).length;
    const bodyLines: string[] = [
      `Reason: ${opts.reason}`,
      `Date: ${this.getYmdLocal()}`,
      `Entries in attachment (approx): ${lineCount}`,
      `Bytes attached: ${bytes.length}`,
    ];
    if (truncated) {
      bodyLines.push("", `NOTE: Attachment was truncated to last ${safeMaxBytes} bytes.`);
    }

    await mailer.sendMail({
      from,
      to,
      subject,
      text: bodyLines.join("\n"),
      attachments: [
        {
          filename: `queries-${this.getYmdLocal()}.ndjson`,
          content: bytes,
          contentType: "application/x-ndjson",
        },
      ],
    });

    this.writeState({
      ...state,
      lastEmailedByte: end,
      lastDailySentYmd: opts.reason === "daily" ? this.getYmdLocal() : state.lastDailySentYmd,
    });

    return { sent: true, bytes: bytes.length, truncated };
  }
}

