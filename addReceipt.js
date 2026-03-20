import fs from "fs";
import path from "path";
import readline from "readline";
import crypto from "crypto";

import { ImageAnnotatorClient } from "@google-cloud/vision";
import OpenAI from "openai";

const DEFAULT_IMAGE = "receipt.jpg";
const DATA_DIR = process.env.DATA_DIR || process.cwd();
const CSV_PATH = path.join(DATA_DIR, "receipts.csv");

// ---------- helpers ----------
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

function sha1(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function ensureCsvHeader() {
  ensureDataDir();
  if (!fs.existsSync(CSV_PATH)) {
    fs.writeFileSync(CSV_PATH, "date,vendor,total,tax,currency,category,source,hash\n", "utf8");
  }
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function appendLineWithRetry(line, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      fs.appendFileSync(CSV_PATH, line, "utf8");
      return;
    } catch (e) {
      if (String(e?.code) === "EBUSY" || String(e?.code) === "EPERM") {
        const waitMs = 300 * (i + 1);
        console.log(`⚠️ CSV busy. Retrying in ${waitMs}ms...`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw e;
    }
  }
  throw new Error("Could not write receipts.csv. It may be locked or missing permissions.");
}

function normalizeMoney(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === "number") return x;
  const s = String(x).replace(",", ".").replace(/[^\d.]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------- OCR ----------
async function doOCR(imagePath) {
  const client = new ImageAnnotatorClient();
  const [result] = await client.textDetection(imagePath);
  const text = result?.textAnnotations?.[0]?.description || "";
  return text;
}

// ---------- OpenAI parse ----------
async function parseWithGPT(ocrText) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !apiKey.startsWith("sk-")) {
    throw new Error("OPENAI_API_KEY is missing or invalid.");
  }

  const openai = new OpenAI({ apiKey });

  const prompt = `
You are a receipt parser for Canada/Quebec receipts.
Return ONLY valid JSON with no extra text.

Fields:
- date: YYYY-MM-DD if possible, otherwise null
- vendor: string or null
- total: number or null
- tax: number or null (sum GST/PST/HST/QST if visible; if not, infer total-subtotal when possible; otherwise null)
- currency: "CAD" if appropriate, otherwise null

OCR:
"""${ocrText}"""
`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 200,
  });

  const raw = resp.choices?.[0]?.message?.content?.trim() || "";
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/g, "").trim();

  let data;
  try {
    data = JSON.parse(cleaned);
  } catch {
    throw new Error("GPT returned invalid JSON:\n" + raw);
  }

  return {
    date: data.date ?? null,
    vendor: data.vendor ?? null,
    total: normalizeMoney(data.total),
    tax: normalizeMoney(data.tax),
    currency: data.currency ?? null,
  };
}

// ---------- main ----------
async function main() {
  const imageArg = process.argv[2] || DEFAULT_IMAGE;
  const categoryArg = process.argv[3];

  const imagePath = path.resolve(imageArg);
  if (!fs.existsSync(imagePath)) {
    throw new Error(`File not found: ${imagePath}`);
  }

  const category = categoryArg || (await ask("Category (example: cafe, groceries, transport, other): "));
  if (!category) throw new Error("Empty category.");

  const buf = fs.readFileSync(imagePath);
  const hash = sha1(buf);

  ensureCsvHeader();

  const existing = fs.readFileSync(CSV_PATH, "utf8");
  if (existing.includes(hash)) {
    console.log("DUPLICATE_RECEIPT");
    console.log("Receipt already exists. Skipping duplicate.");
    process.exit(0);
  }

  console.log("Processing:", imagePath);

  const ocrText = await doOCR(imagePath);
  if (!ocrText.trim()) throw new Error("OCR returned no text.");

  const parsed = await parseWithGPT(ocrText);

  const line =
    [
      parsed.date,
      parsed.vendor,
      parsed.total,
      parsed.tax,
      parsed.currency,
      category,
      path.basename(imagePath),
      hash,
    ].map(csvEscape).join(",") + "\n";

  await appendLineWithRetry(line);

  console.log("RECEIPT_SAVED");
  console.log(line.trim());
}

main().catch((e) => {
  console.error("ERROR_ADD_RECEIPT");
  console.error(e.message || e);
  process.exit(1);
});