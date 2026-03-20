const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

function parseCSVLine(line) {
  return line.split(",").map((s) => s.trim());
}

function toNumber(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const dataDir = process.env.DATA_DIR || process.cwd();

  const csvPath = path.join(dataDir, "receipts.csv");
  if (!fs.existsSync(csvPath)) {
    console.error("❌ receipts.csv not found:", csvPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, "utf8").trim();
  if (!raw) {
    console.error("❌ receipts.csv is empty");
    process.exit(1);
  }

  const lines = raw.split(/\r?\n/).filter(Boolean);
  const header = parseCSVLine(lines[0]).map((h) => h.toLowerCase());

  const idx = (name) => header.indexOf(name);

  const iDate = idx("date");
  const iVendor = idx("vendor");
  const iTotal = idx("total");
  const iTax = idx("tax");
  const iCurrency = idx("currency");

  if (iDate < 0 || iVendor < 0 || iTotal < 0) {
    console.error("❌ CSV header missing date/vendor/total. Header:", header);
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Receipts");

  ws.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Vendor", key: "vendor", width: 28 },
    { header: "Subtotal", key: "subtotal", width: 12 },
    { header: "Tax", key: "tax", width: 10 },
    { header: "Total", key: "total", width: 12 },
    { header: "Currency", key: "currency", width: 10 }
  ];

  ws.getRow(1).font = { bold: true };

  for (let k = 1; k < lines.length; k++) {
    const cols = parseCSVLine(lines[k]);

    const date = cols[iDate] || "";
    const vendor = cols[iVendor] || "";
    const total = toNumber(cols[iTotal]);
    const tax = iTax >= 0 ? toNumber(cols[iTax]) : null;
    const currency = iCurrency >= 0 ? (cols[iCurrency] || "") : "";

    const subtotal =
      total !== null
        ? (tax !== null ? Number((total - tax).toFixed(2)) : null)
        : null;

    ws.addRow({
      date,
      vendor,
      subtotal,
      tax,
      total,
      currency
    });
  }

  ["C", "D", "E"].forEach((colLetter) => {
    ws.getColumn(colLetter).numFmt = "0.00";
  });

  const outPath = path.join(dataDir, "Receipts_2026.xlsx");
  await wb.xlsx.writeFile(outPath);

  console.log("✅ XLSX created:", outPath);
}

main().catch((err) => {
  console.error("❌ Error exporting XLSX:", err);
  process.exit(1);
});