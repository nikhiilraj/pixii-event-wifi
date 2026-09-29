import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Source-locked: every export comes from the supplied Fly By Jing listing folders.
const source = "/Users/nikhilraj/Library/Group Containers/UBF8T346G9.OneDriveStandaloneSuite/Pixii.noindex/Pixii/listings";
const listings = path.join(source, "Listing - B08Y659BX2");
const aplus = path.join(source, "Listing - B08Y659BX2 2/A_PLUS_PREMIUM_1");
const output = fileURLToPath(new URL("../public/assets/flybyjing/v1/", import.meta.url));
mkdirSync(output, { recursive: true });
function convert(input, name, args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, ...args, path.join(output, name)], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Media conversion failed: ${name}`);
}
function image(input, name, width) {
  const result = spawnSync("cwebp", ["-quiet", "-q", "83", "-m", "6", "-resize", String(width), "0", input, "-o", path.join(output, name)], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Image conversion failed: ${name}`);
}
image(path.join(listings, "B08Y659BX2.PT01.jpg"), "listing-hero.webp", 1280);
image(path.join(listings, "B08Y659BX2.PT01.jpg"), "listing-hero-mobile.webp", 720);
image(path.join(listings, "B08Y659BX2.MAIN.jpg"), "listing-hero-product.webp", 1280);
image(path.join(listings, "B08Y659BX2.MAIN.jpg"), "listing-hero-product-mobile.webp", 720);
for (const [index, suffix] of ["MAIN", "PT01", "PT02", "PT03", "PT04", "PT05", "PT06"].entries()) {
  image(path.join(listings, `B08Y659BX2.${suffix}.jpg`), `listing-${index + 1}.webp`, 480);
}
for (let index = 1; index <= 4; index++) image(path.join(aplus, `A_PLUS_PREMIUM_${index}.jpg`), `aplus-${index}.webp`, 1464);
image(path.join(aplus, "A_PLUS_PREMIUM_PREVIEW.jpg"), "aplus-mobile.webp", 960);
const video = path.join(listings, "Listing - B08Y659BX2/FLYBYJING B08Y659BX2 1.mp4");
const poster = path.join(mkdtempSync(path.join(tmpdir(), "pixii-flybyjing-")), "poster.png");
const still = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", video, "-frames:v", "1", "-update", "1", poster], { stdio: "inherit" });
if (still.status !== 0) throw new Error("Poster extraction failed");
image(poster, "video-poster.webp", 1280);
convert(video, "showcase.mp4", ["-t", "2", "-an", "-vf", "scale=1280:720", "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]);
console.log("Prepared 17 optimized images and a silent two-second clip.");
