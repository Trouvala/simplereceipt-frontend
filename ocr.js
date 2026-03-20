import vision from "@google-cloud/vision";

const imagePath = "C:\\Users\\Admin\\receipt-parser\\receipt.jpg";

async function run() {
  try {
    const client = new vision.ImageAnnotatorClient();
    const [result] = await client.textDetection(imagePath);
    const text = result.textAnnotations?.[0]?.description || "";

    console.log("=== OCR TEXT START ===");
    console.log(text);
    console.log("=== OCR TEXT END ===");
  } catch (err) {
    console.error("OCR error:", err);
  }
}

run();
