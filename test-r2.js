import { uploadToR2 } from "./r2.js";

await uploadToR2({
  filePath: "./receipt.jpg",
  key: `test/${Date.now()}.jpg`,
  contentType: "image/jpeg",
});

console.log("✅ Subida OK a R2");
