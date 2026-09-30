import { expect, test } from "@playwright/test";
import { connectedContent, documentShell, PIXII_CTA_URL } from "../../src/portal";

const base = `http://127.0.0.1:${process.env.PIXII_BROWSER_PORT || "8787"}`;
// Vendor requests are intercepted: these tests never send production events.
for (const failedCleanPage of [false,true]) {
  test(`clean final transition preserves the seven/five second flow (failure=${failedCleanPage})`, async ({page}) => {
    const external: string[] = [], telemetry: string[] = [];
    let connected = false;
    await page.route("https://**/*", route => {
      external.push(route.request().url());
      return route.fulfill({contentType:"text/html",body:"<h1>Website destination</h1>"});
    });
    await page.route("**/analytics/events", route => {
      telemetry.push(route.request().postData() || "");
      return route.fulfill({status:503,body:"unavailable"});
    });
    await page.route("**/router/fas/status/**",route=>route.fulfill({contentType:"application/json",body:JSON.stringify({status:connected?"connected":"pending",...(connected?{connectedUrl:"/connected"}:{})})}));
    await page.route(base+"/connected",route=>{
      if(failedCleanPage)return route.fulfill({status:503,body:"unavailable"});
      const config={page:"connected",context:"synthetic-telemetry-context",pixels:{},suppressed:false};
      return route.fulfill({contentType:"text/html",headers:{"X-Pixii-Clean-Final":"1"},body:documentShell("You're online | Pixii",connectedContent(PIXII_CTA_URL+"#pixii_wifi="+"a".repeat(43))+`<script>window.pixiiTracking=${JSON.stringify(config)}</script><script src="/assets/analytics-v1.js" defer></script><script src="/assets/connected-v4.js" defer></script>`,"app-theme")});
    });
    await page.goto(base+"/");
    await page.fill("#fullName","Analytics Browser TEST");
    await page.fill("#email","analytics-browser-test@example.com");
    await page.fill("#phone","4155550123");
    await page.check("#consent");
    await page.click("#connect-button");
    await expect(page.locator("#status-message")).toHaveText("Finishing connection…",{timeout:14000});
    expect(external).toEqual([]);
    connected=true;
    await expect(page.getByRole("heading",{name:"You’re online"})).toBeVisible();
    const started=Date.now();
    if(!failedCleanPage){
      await expect(page).toHaveURL(base+"/connected");
      expect(await page.evaluate(()=>"pixiiAd" in window)).toBe(false);
      expect(await page.locator("body").innerHTML()).not.toContain("/router/fas/status");
    }
    await expect(page).toHaveURL(/^https:\/\/www\.pixii\.ai\//,{timeout:7500});
    expect(Date.now()-started).toBeGreaterThan(4400);
    expect(page.url()).toContain("utm_campaign=amazon_unboxed_sf_2026");
    if(!failedCleanPage){
      expect(page.url()).toContain("#pixii_wifi=");
      expect(telemetry.some(body=>body.includes('"method":"automatic"'))).toBe(true);
    }else expect(telemetry).toEqual([]);
  });
}
