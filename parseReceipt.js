import OpenAI from "openai";

console.log("🚀 Script started");

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("❌ OPENAI_API_KEY no está definida");
  process.exit(1);
}

const client = new OpenAI({ apiKey });

const ocrText = `
COUCHE-TARD
1234 Rue Sherbrooke
DATE: 02/05/2026
SUBTOTAL 9.99
TPS 0.50
TVQ 1.00
TOTAL 11.49
`;

async function run() {
  try {
    console.log("📨 Enviando a OpenAI...");
const inferredCurrency = ocrText.includes("TVQ") || ocrText.includes("TPS")
  ? "CAD"
  : ocrText.includes("$")
  ? "USD"
  : null;
    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `
You are a receipt parser. Extract structured data from raw OCR text of a purchase receipt.

Return ONLY a valid JSON object and nothing else.

Schema:
{
  "date": "YYYY-MM-DD" | null,
  "vendor": string | null,
  "total": number | null,
  "tax": number | null,
  "currency": "CAD" | "USD" | null
}
          `,
        },
        {
          role: "user",
          content: ocrText,
        },
      ],
      temperature: 0,
      max_tokens: 120
    });

    console.log("✅ Respuesta:");
    console.log(response.choices[0].message.content);
  } catch (err) {
    console.error("❌ Error en la llamada:", err);
  }
}

run();
