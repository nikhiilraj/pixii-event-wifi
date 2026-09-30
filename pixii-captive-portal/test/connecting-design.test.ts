import { describe, expect, it } from "vitest";
import { connectingContent } from "../src/connecting";

describe("approved app-theme showcase", () => {
  it("promotes the product photo while retaining the other six listings once each", () => {
    const html = connectingContent();
    const listings = html.match(/<section[^>]*data-scene="listings"[\s\S]*?<\/section>/)?.[0] ?? "";
    const sources = [...listings.matchAll(/<img[^>]* src="([^"]+)"/g)].map(match => match[1]);
    expect(sources).toEqual([
      "/assets/flybyjing/v1/listing-hero-product.webp",
      "/assets/flybyjing/v1/listing-2.webp",
      "/assets/flybyjing/v1/listing-3.webp",
      "/assets/flybyjing/v1/listing-4.webp",
      "/assets/flybyjing/v1/listing-5.webp",
      "/assets/flybyjing/v1/listing-6.webp",
      "/assets/flybyjing/v1/listing-7.webp"
    ]);
  });

  it("exposes one accessible progress bar and the complete artwork", () => {
    const html = connectingContent();
    expect(html).toContain('role="progressbar" aria-label="Connecting to Wi-Fi"');
    expect(html).toContain('aria-valuenow="0" aria-valuetext="7 seconds remaining"');
    expect(html).not.toContain("<circle");
    expect(html.match(/width="480" height="480"/g)).toHaveLength(6);
    expect(html).toContain('class="flyby-aplus-complete"');
  });
});
