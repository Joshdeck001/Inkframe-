import { readdirSync, statSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join, relative } from "path";
import JSZip from "jszip";

/**
 * Zips the real extension/ source folder into public/downloads/ so
 * Settings → Extensions → InkframeScout can offer a one-click download
 * straight from the website, instead of asking the user to clone the
 * repo or download it from GitHub. Runs as `predev`/`prebuild` (see
 * package.json) so the zip can never go stale relative to the actual
 * extension source — it's never committed to git, always regenerated.
 * A browser can only ever download a single file, never a folder of
 * files directly; a .zip the user's OS unzips in one click/double-click
 * is the standard way around that, not a limitation specific to this app.
 */

const EXTENSION_DIR = join(__dirname, "..", "extension");
const OUTPUT_DIR = join(__dirname, "..", "public", "downloads");
const OUTPUT_FILE = join(OUTPUT_DIR, "inkframescout-extension.zip");

function addDirToZip(zip: JSZip, dir: string, baseDir: string) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      addDirToZip(zip, fullPath, baseDir);
    } else {
      // Zip entries use the path *inside* extension/ (e.g. "manifest.json",
      // "popup/popup.js") so unzipping produces exactly the folder Chrome's
      // "Load unpacked" expects, once the user opens the single top-level
      // "extension" folder the zip is built to contain.
      const zipPath = join("extension", relative(baseDir, fullPath)).split("\\").join("/");
      zip.file(zipPath, readFileSync(fullPath));
    }
  }
}

async function main() {
  const zip = new JSZip();
  addDirToZip(zip, EXTENSION_DIR, EXTENSION_DIR);
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, buffer);
  console.log(`Built ${OUTPUT_FILE} (${buffer.length} bytes)`);
}

main().catch((e) => {
  console.error("Failed to build extension zip:", e);
  process.exit(1);
});
