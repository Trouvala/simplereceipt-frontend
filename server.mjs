import express from "express";
import multer from "multer";
import cookieParser from "cookie-parser";
import { nanoid } from "nanoid";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3333;
const DATA_DIR = process.env.DATA_DIR || __dirname;

const app = express();
app.use(cookieParser());

const publicDir = path.join(__dirname, "frontend", "public");
const uploadDir = path.join(DATA_DIR, "uploads");
const receiptsCsvPath = path.join(DATA_DIR, "receipts.csv");
const xlsxPath = path.join(DATA_DIR, "Receipts_2026.xlsx");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ===== FRONTEND =====
app.use(express.static(publicDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// Expose CSV so app.html can read it
app.get("/receipts.csv", (req, res) => {
  if (!fs.existsSync(receiptsCsvPath)) {
    return res.status(404).send("receipts.csv not found");
  }
  res.sendFile(receiptsCsvPath);
});

// ===== STORAGE UPLOAD =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || ".jpg") || ".jpg";
    cb(null, `${Date.now()}_${nanoid(6)}${ext}`);
  },
});

const upload = multer({ storage });

// ===== ENDPOINTS =====

// POST /upload (form-data: image + category)
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const category = (req.body.category || "other").trim();
    const imagePath = req.file?.path;

    if (!imagePath) {
      return res.status(400).json({ ok: false, error: "Missing image file." });
    }

    let sid = req.cookies.sid;
    if (!sid) {
      sid = nanoid(10);
      res.cookie("sid", sid, { httpOnly: true });
    }

    const childEnv = {
      ...process.env,
      DATA_DIR,
    };

    execFile("node", ["addReceipt.js", imagePath, category], { env: childEnv }, (err, stdout, stderr) => {
      const out = String(stdout || "").trim();
      const errText = String(stderr || "").trim();
      const combined = `${out}\n${errText}\n${err?.message || ""}`.toLowerCase();

      if (err) {
        if (
          combined.includes("ya está registrada") ||
          combined.includes("mismo hash") ||
          combined.includes("no la vuelvo a agregar") ||
          combined.includes("already registered") ||
          combined.includes("duplicate")
        ) {
          return res.json({
            ok: true,
            duplicate: true,
            receiptId: sid,
            sessionId: sid,
            image: path.basename(imagePath),
            message: "Receipt already exists. Skipped duplicate.",
            output: out || errText,
          });
        }

        return res.status(500).json({
          ok: false,
          error: "addReceipt.js failed",
          details: errText || err.message,
          output: out,
        });
      }

      res.json({
        ok: true,
        receiptId: sid,
        sessionId: sid,
        image: path.basename(imagePath),
        output: out,
      });
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: "Server error",
      details: String(e),
    });
  }
});

// GET /export -> returns XLSX
app.get("/export", async (req, res) => {
  try {
    const childEnv = {
      ...process.env,
      DATA_DIR,
    };

    execFile("node", ["exportXlsx.cjs"], { env: childEnv }, (err, stdout, stderr) => {
      if (err) {
        return res.status(500).send(String(stderr || err.message));
      }

      if (!fs.existsSync(xlsxPath)) {
        return res.status(500).send("XLSX file was not created.");
      }

      return res.download(xlsxPath);
    });
  } catch (e) {
    res.status(500).send(String(e));
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Backend ready: http://localhost:${PORT}`);
  console.log(`✅ Network ready on port ${PORT}`);
  console.log(`✅ DATA_DIR: ${DATA_DIR}`);
  console.log(`POST /upload (form-data: image + category)`);
  console.log(`GET  /export`);
});