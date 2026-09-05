import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTelegramMessage } from "./routes/telegram";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Telegram message delivery", () => {
  it("skips recipients who blocked the bot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error_code: 403,
      description: "Forbidden: bot was blocked by the user",
    }), { status: 403, headers: { "content-type": "application/json" } })));

    await expect(sendTelegramMessage("token", 123, { text: "Hello" })).resolves.toBeUndefined();
  });

  it("throws unexpected Telegram delivery failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error_code: 500,
      description: "Telegram is unavailable",
    }), { status: 500, headers: { "content-type": "application/json" } })));

    await expect(sendTelegramMessage("token", 123, { text: "Hello" }))
      .rejects.toThrow("Telegram sendMessage failed (500): Telegram is unavailable");
  });
});
