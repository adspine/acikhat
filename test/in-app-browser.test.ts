import { describe, expect, it } from "vitest";
// @ts-expect-error web/auth.js tarayıcı modülüdür, tip bildirimi yok
import { isInAppBrowser } from "../web/auth.js";

describe("uygulama içi tarayıcı algılama (Google girişi çalışmaz)", () => {
  it.each([
    ["Instagram iOS", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21A329 Instagram 300.0.0.0.0 (iPhone14,5; iOS 17_0; tr_TR)"],
    ["Instagram Android", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 300.0.0.0.0 Android"],
    ["Facebook iOS", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/21A329 [FBAN/FBIOS;FBAV/450.0;FBBV/1;]"],
    ["Facebook Android", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0;]"],
    ["TikTok", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 musical_ly_30.0.0 TikTok"],
  ])("%s algılanır", (_ad, ua) => expect(isInAppBrowser(ua)).toBe(true));

  it.each([
    ["Safari iOS", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"],
    ["Chrome Mac", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"],
    ["Chrome Android", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"],
    ["boş", ""],
  ])("%s normal tarayıcı sayılır", (_ad, ua) => expect(isInAppBrowser(ua)).toBe(false));
});
