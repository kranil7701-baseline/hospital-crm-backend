import dns from "dns";
dns.setDefaultResultOrder("ipv4first");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import fs from "fs";
import path from "path";
import https from "https";
import http from "http";

const RENDER_EXPORT_URL = "https://hospital-crm-backend-1.onrender.com/api/export-all-uploads";
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, (res) => {
      let rawData = "";
      res.on("data", (chunk) => { rawData += chunk; });
      res.on("end", () => {
        try {
          const parsedData = JSON.parse(rawData);
          resolve(parsedData);
        } catch (e) {
          reject(new Error(`Failed to parse JSON response: ${rawData.substring(0, 200)}`));
        }
      });
    }).on("error", (err) => reject(err));
  });
}

async function run() {
  console.log(`Connecting to Render export endpoint: ${RENDER_EXPORT_URL}...`);
  try {
    const response = await fetchJson(RENDER_EXPORT_URL);
    if (!response.success || !response.files) {
      console.error("❌ Export failed on Render:", response);
      return;
    }

    const filesMap = response.files;
    const filenames = Object.keys(filesMap);
    console.log(`✅ Received ${filenames.length} files from Render.`);

    let savedCount = 0;
    for (const filename of filenames) {
      const base64Data = filesMap[filename];
      const buffer = Buffer.from(base64Data, "base64");
      const targetPath = path.join(UPLOADS_DIR, filename);
      fs.writeFileSync(targetPath, buffer);
      savedCount++;
      console.log(`  Saved [${savedCount}/${filenames.length}]: ${filename} (${buffer.length} bytes)`);
    }

    console.log(`\n🎉 Successfully downloaded and saved ${savedCount} upload files locally to ${UPLOADS_DIR}!`);
  } catch (err: any) {
    console.error("❌ Download error:", err.message);
  }
}

run();
