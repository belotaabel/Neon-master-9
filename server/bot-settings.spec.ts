import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return {
    ...actual,
    getBotSettings: vi.fn(async () => ({ enabled: true, botCount: 75, purchaseIntervalMs: 10, batchSizeMin: 4, batchSizeMax: 6 })),
    updateBotSettings: vi.fn(async (enabled: boolean, botCount: number, purchaseIntervalMs: number, batchSizeMin: number, batchSizeMax: number) => ({ enabled, botCount, purchaseIntervalMs, batchSizeMin, batchSizeMax })),
  };
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

const responseFor = () => {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { response.statusCode = code; return response; },
    json(body: unknown) { response.body = body; return response; },
  };
  return response;
};

function adminToken() {
  const secret = "test-admin-secret";
  process.env.ADMIN_PASSWORD = secret;
  const expiresAt = String(Date.now() + 60_000);
  const nonce = "nonce";
  const signature = createHmac("sha256", secret).update(`${expiresAt}.${nonce}`).digest("hex");
  return `${expiresAt}.${nonce}.${signature}`;
}

describe("bot settings admin boundary", () => {
  it("rejects unauthenticated requests", async () => {
    const { handleAdminBotSettingsUpdate } = await import("./routes/admin");
    const response = responseFor();
    await handleAdminBotSettingsUpdate({ body: { enabled: true, botCount: 1, purchaseIntervalMs: 10, batchSizeMin: 1, batchSizeMax: 1 }, header: () => undefined } as never, response as never, () => undefined);
    expect(response.statusCode).toBe(403);
  });

  it("accepts the maximum bot count", async () => {
    const { handleAdminBotSettingsUpdate } = await import("./routes/admin");
    const token = adminToken();
    const response = responseFor();
    await handleAdminBotSettingsUpdate({ body: { enabled: true, botCount: 200, purchaseIntervalMs: 10, batchSizeMin: 1, batchSizeMax: 25 }, header: (name: string) => name === "x-admin-token" ? token : undefined } as never, response as never, () => undefined);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ enabled: true, botCount: 200, purchaseIntervalMs: 10, batchSizeMin: 1, batchSizeMax: 25 });
  });

  it("returns the saved batch setting", async () => {
    const { handleAdminBotSettings } = await import("./routes/admin");
    const token = adminToken();
    const response = responseFor();
    await handleAdminBotSettings({ header: (name: string) => name === "x-admin-token" ? token : undefined } as never, response as never, () => undefined);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ enabled: true, botCount: 75, purchaseIntervalMs: 10, batchSizeMin: 4, batchSizeMax: 6 });
  });

  it("rejects counts outside the fixed roster limit", async () => {
    const { handleAdminBotSettingsUpdate } = await import("./routes/admin");
    const token = adminToken();
    const response = responseFor();
    await handleAdminBotSettingsUpdate({ body: { enabled: true, botCount: 201, purchaseIntervalMs: 10, batchSizeMin: 1, batchSizeMax: 1 }, header: (name: string) => name === "x-admin-token" ? token : undefined } as never, response as never, () => undefined);
    expect(response.statusCode).toBe(400);
  });

  it("accepts the fastest and slowest bot purchase intervals", async () => {
    const { handleAdminBotSettingsUpdate } = await import("./routes/admin");
    const token = adminToken();
    for (const purchaseIntervalMs of [10, 1000]) {
      const response = responseFor();
      await handleAdminBotSettingsUpdate({ body: { enabled: true, botCount: 1, purchaseIntervalMs, batchSizeMin: 1, batchSizeMax: 1 }, header: (name: string) => name === "x-admin-token" ? token : undefined } as never, response as never, () => undefined);
      expect(response.statusCode).toBe(200);
    }
  });

  it("rejects bot purchase intervals outside the safe range", async () => {
    const { handleAdminBotSettingsUpdate } = await import("./routes/admin");
    const token = adminToken();
    for (const purchaseIntervalMs of [9, 1001, 10.5]) {
      const response = responseFor();
      await handleAdminBotSettingsUpdate({ body: { enabled: true, botCount: 1, purchaseIntervalMs, batchSizeMin: 1, batchSizeMax: 1 }, header: (name: string) => name === "x-admin-token" ? token : undefined } as never, response as never, () => undefined);
      expect(response.statusCode).toBe(400);
    }
  });

  it("accepts the minimum and maximum batch sizes", async () => {
    const { handleAdminBotSettingsUpdate } = await import("./routes/admin");
    const token = adminToken();
    for (const [batchSizeMin, batchSizeMax] of [[1, 1], [4, 6], [25, 25]]) {
      const response = responseFor();
      await handleAdminBotSettingsUpdate({ body: { enabled: true, botCount: 1, purchaseIntervalMs: 10, batchSizeMin, batchSizeMax }, header: (name: string) => name === "x-admin-token" ? token : undefined } as never, response as never, () => undefined);
      expect(response.statusCode).toBe(200);
    }
  });

  it("rejects bot batch sizes outside the safe range", async () => {
    const { handleAdminBotSettingsUpdate } = await import("./routes/admin");
    const token = adminToken();
    for (const [batchSizeMin, batchSizeMax] of [[0, 1], [1, 26], [6, 4], [1.5, 6]]) {
      const response = responseFor();
      await handleAdminBotSettingsUpdate({ body: { enabled: true, botCount: 1, purchaseIntervalMs: 10, batchSizeMin, batchSizeMax }, header: (name: string) => name === "x-admin-token" ? token : undefined } as never, response as never, () => undefined);
      expect(response.statusCode).toBe(400);
    }
  });

  it("rejects invalid bot wallet funding amounts", async () => {
    const { handleAdminBotFunding } = await import("./routes/admin");
    const token = adminToken();
    const response = responseFor();
    await handleAdminBotFunding({ params: { botId: "1" }, body: { amount: 0 }, header: (name: string) => name === "x-admin-token" ? token : undefined } as never, response as never, () => undefined);
    expect(response.statusCode).toBe(400);
  });

  it("rejects invalid bulk bot wallet funding amounts", async () => {
    const { handleAdminBotBulkFunding } = await import("./routes/admin");
    const token = adminToken();
    const response = responseFor();
    await handleAdminBotBulkFunding({ body: { amount: 1_000_001 }, header: (name: string) => name === "x-admin-token" ? token : undefined } as never, response as never, () => undefined);
    expect(response.statusCode).toBe(400);
  });
});
