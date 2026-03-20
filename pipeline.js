import vision from "@google-cloud/vision";
import OpenAI from "openai";

// 1) OCR
async function runOCR(imagePath) {
  const client = new vision.ImageAnnotatorClient();
  const [result] = await client.textDetection(imagePath);
  return result.textAnnotations?.[0]?.description || "";
}

// 2) GPT -> JSON
async function parseWithGPT(ocrText) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const system = `You extract structured data from receipt OCR text.
Return ONLY valid JSON. No markdown, no explanations.
Fields:
- date (ISO yyyy-mm-dd if possible)
- vendor (string)
- total (number)
- tax (number or null)
- currency (CAD/USD/EUR or null)
If unsure, put null.`;

  const user = `OCR TEXT:
${ocrText}

Return JSON with keys: date, vendor, total, tax, currency.`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0,
    max_tokens: 120,
  });

  const raw = resp.choices?.[0]?.message?.content?.trim() || "";

  // Parse robusto: si el modelo mete texto extra, rescatamos el primer {...}
  let jsonText = raw;
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) jsonText = match[0];

  const data = JSON.parse(jsonText);

  // Post-procesado mínimo: números con coma -> punto
  const toNumber = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const cleaned = v.replace(",", ".").replace(/[^\d.-]/g, "");
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  data.total = toNumber(data.total);
  data.tax = toNumber(data.tax);

  // Inferencia barata de moneda
  if (!data.currency) {
    // TPS/TVQ casi seguro Quebec/Canada
    const upper = ocrText.toUpperCase();
    if (upper.includes("TVQ") || upper.includes("TPS")) data.currency = "CAD";
  }

  return data;
}

async function main() {
  const imagePath = process.argv[2] || "C:\\Users\\Admin\\receipt-parser\\receipt.jpg";

  console.log("🚀 Pipeline start");
  const ocrText = await runOCR(imagePath);

  if (!ocrText) {
    console.log("❌ OCR vacío. Revisa la imagen.");
    process.exit(1);
  }

  console.log("✅ OCR ok (texto capturado)");

  const parsed = await parseWithGPT(ocrText);
  console.log("✅ JSON:");
  console.log(JSON.stringify(parsed, null, 2));
}

main().catch((e) => {
  console.error("Pipeline error:", e);
  process.exit(1);
});
