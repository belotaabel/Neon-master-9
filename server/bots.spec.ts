import { describe, expect, it } from "vitest";
import { BOT_ROSTER, chooseBotBatchSize, chooseBotCards, ensureBotsForSelectingGame, getBotCardSwitchDelay, getBotInitialPurchaseDelay, planBotAssignments, shuffleBotCards } from "./bots";
import { DEFAULT_BOT_BATCH_MIN_SIZE, normalizeBotBatchSize } from "./db";

describe("production bot roster", () => {
  it("normalizes invalid batch sizes to the safe default", () => {
    expect(normalizeBotBatchSize(0)).toBe(DEFAULT_BOT_BATCH_MIN_SIZE);
    expect(normalizeBotBatchSize(26)).toBe(DEFAULT_BOT_BATCH_MIN_SIZE);
    expect(normalizeBotBatchSize(10)).toBe(10);
  });

  it("contains the supplied roster in order", () => {
    expect(BOT_ROSTER).toHaveLength(207);
    expect(BOT_ROSTER.slice(0, 5)).toEqual(["Abel", "Nati_21", "Yoni", "Dagi_99", "Elias_7"]);
    expect(BOT_ROSTER[BOT_ROSTER.length - 1]).toBe("Sintayehu");
    expect(new Set(BOT_ROSTER).size).toBeLessThan(BOT_ROSTER.length);
  });

  it("starts bot purchases after a stable random delay of 5 to 10 seconds", () => {
    const delays = ["game-1", "game-2", "game-3"].map(getBotInitialPurchaseDelay);

    expect(delays.every((delay) => delay >= 5000 && delay <= 10000)).toBe(true);
    expect(getBotInitialPurchaseDelay("game-1")).toBe(getBotInitialPurchaseDelay("game-1"));
  });

  it("assigns switching behavior to only some bots with a stable delay", () => {
    const delays = Array.from({ length: 100 }, (_, index) => getBotCardSwitchDelay("game-1", `global-bot:${index}`));
    const eligibleDelays = delays.filter((delay): delay is number => delay !== null);

    expect(eligibleDelays.length).toBeGreaterThan(0);
    expect(eligibleDelays.length).toBeLessThan(delays.length);
    expect(eligibleDelays.every((delay) => delay >= 5000 && delay < 15000)).toBe(true);
    expect(getBotCardSwitchDelay("game-1", "global-bot:7")).toBe(getBotCardSwitchDelay("game-1", "global-bot:7"));
  });

  it("chooses a random batch size within the configured range", () => {
    const selected = Array.from({ length: 100 }, () => chooseBotBatchSize(4, 6));
    expect(selected.every((size) => size >= 4 && size <= 6)).toBe(true);
  });

  it("shuffles available cards without dropping or duplicating cards", () => {
    const available = Array.from({ length: 20 }, (_, index) => index + 1);
    const shuffled = shuffleBotCards(available);
    expect(shuffled).not.toBe(available);
    expect([...shuffled].sort((left, right) => left - right)).toEqual(available);
  });

  it("chooses exactly one available card", () => {
    const available = Array.from({ length: 20 }, (_, index) => index + 1);
    const selected = chooseBotCards(available);
    expect(selected).toHaveLength(1);
    expect(selected.every((card) => available.includes(card))).toBe(true);
  });

  it("plans one distinct card for each missing bot in a batch", () => {
    const assignments = planBotAssignments(["global-bot:1"], [7, 12, 31], 4, 3, 3);
    expect(assignments).toEqual([
      { index: 0, name: "Abel", cardNumber: 7 },
      { index: 2, name: "Yoni", cardNumber: 12 },
      { index: 3, name: "Dagi_99", cardNumber: 31 },
    ]);
  });

  it("caps a batch at the configured target and available cards", () => {
    const assignments = planBotAssignments([], Array.from({ length: 400 }, (_, index) => index + 1), 25, 25, 25);
    expect(assignments).toHaveLength(25);
    expect(new Set(assignments.map(({ cardNumber }) => cardNumber)).size).toBe(25);
    expect(assignments[24].index).toBe(24);
  });

  it("limits assignments to the configured batch size", () => {
    const assignments = planBotAssignments([], Array.from({ length: 400 }, (_, index) => index + 1), 25, 4, 4);
    expect(assignments).toHaveLength(4);
    expect(assignments[3].index).toBe(3);
  });

  it("stops cleanly when the card catalog is exhausted", () => {
    expect(planBotAssignments([], [], 200)).toEqual([]);
    expect(planBotAssignments([], [42, 43], 200, 25, 25)).toHaveLength(2);
  });

  it("does not require a database when live bot coordination is unavailable", async () => {
    await expect(ensureBotsForSelectingGame("game-without-database")).resolves.toEqual({ added: 0, intervalMs: 10 });
  });
});
