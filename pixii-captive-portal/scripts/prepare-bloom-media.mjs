import { mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Supplied September 30: preserve the original; export only the approved opening preview.
const source = process.argv[2];
if (!source) throw new Error("Pass the supplied Bloom MP4 path.");
const output = fileURLToPath(new URL("../public/assets/bloom/v1/", import.meta.url));
mkdirSync(output, { recursive: true });
function exportMedia(name, args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-n", "-i", source, ...args, path.join(output, name)], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Bloom conversion failed: ${name}`);
}
if (!existsSync(path.join(output, "showcase.mp4"))) exportMedia("showcase.mp4", ["-t", "2", "-an", "-vf", "scale=1280:720", "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]);
const poster = path.join(mkdtempSync(path.join(tmpdir(), "pixii-bloom-")), "poster.png");
const still = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", "0.7", "-i", source, "-frames:v", "1", "-vf", "scale=1280:720", "-update", "1", poster], { stdio: "inherit" });
if (still.status !== 0) throw new Error("Bloom poster extraction failed");
const encoded = spawnSync("cwebp", ["-quiet", "-q", "83", "-m", "6", poster, "-o", path.join(output, "video-poster.webp")], { stdio: "inherit" });
if (encoded.status !== 0) throw new Error("Bloom poster encoding failed");
console.log("Prepared a silent two-second Bloom preview and same-origin poster.");
