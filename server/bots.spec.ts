import { describe, expect, it } from "vitest";
import { BOT_ROSTER, chooseBotBatchSize, chooseBotCards, ensureBotsForSelectingGame, getBotCardSwitchDelay, getBotCountForGame, getBotInitialPurchaseDelay, getBotRosterForGame, planBotAssignments, shuffleBotCards } from "./bots";
import { DEFAULT_BOT_BATCH_MIN_SIZE, normalizeBotBatchSize } from "./db";

describe("production bot roster", () => {
  it("normalizes invalid batch sizes to the safe default", () => {
    expect(normalizeBotBatchSize(0)).toBe(DEFAULT_BOT_BATCH_MIN_SIZE);
    expect(normalizeBotBatchSize(26)).toBe(DEFAULT_BOT_BATCH_MIN_SIZE);
    expect(normalizeBotBatchSize(10)).toBe(10);
  });

  it("contains the supplied roster in order", () => {
    expect(BOT_ROSTER).toHaveLength(207);
    expect(BOT_ROSTER.slice(0, 5)).toEqual(["Abel", "Nati", "Yoni", "Dagi", "Elias"]);
    expect(BOT_ROSTER[BOT_ROSTER.length - 1]).toBe("Sintayehu");
    expect(new Set(BOT_ROSTER).size).toBeLessThan(BOT_ROSTER.length);
  });

  it("starts bot purchases after a stable random delay of 5 to 10 seconds", () => {
    const delays = ["game-1", "game-2", "game-3"].map(getBotInitialPurchaseDelay);

    expect(delays.every((delay) => delay >= 5000 && delay <= 10000)).toBe(true);
    expect(getBotInitialPurchaseDelay("game-1")).toBe(getBotInitialPurchaseDelay("game-1"));
  });

  it("selects a different stable bot roster for different games", () => {
    const firstRoster = getBotRosterForGame("game-1", 10);
    const secondRoster = getBotRosterForGame("game-2", 10);

    expect(firstRoster).toHaveLength(10);
    expect(new Set(firstRoster).size).toBe(10);
    expect(firstRoster).toEqual(getBotRosterForGame("game-1", 10));
    expect(secondRoster).not.toEqual(firstRoster);
  });

  it("selects a stable random bot count within three of the configured target", () => {
    const counts = Array.from({ length: 100 }, (_, index) => getBotCountForGame(`game-${index}`, 10));

    expect(counts.every((count) => count >= 7 && count <= 13)).toBe(true);
    expect(new Set(counts).size).toBeGreaterThan(1);
    expect(getBotCountForGame("game-1", 10)).toBe(getBotCountForGame("game-1", 10));
    expect(getBotCountForGame("game-1", 0)).toBe(0);
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
    const assignments = planBotAssignments("game-assignments", ["global-bot:1"], [7, 12, 31], 4, 3, 3);
    const expectedIndexes = getBotRosterForGame("game-assignments", 4).filter((index) => index !== 1);
    expect(assignments.map(({ index, cardNumber }) => [index, cardNumber])).toEqual(expectedIndexes.slice(0, 3).map((index, cardIndex) => [index, [7, 12, 31][cardIndex]]));
  });

  it("caps a batch at the configured target and available cards", () => {
    const assignments = planBotAssignments("game-cap", [], Array.from({ length: 400 }, (_, index) => index + 1), 25, 25, 25);
    expect(assignments).toHaveLength(25);
    expect(new Set(assignments.map(({ cardNumber }) => cardNumber)).size).toBe(25);
    expect(assignments[24].index).toBe(getBotRosterForGame("game-cap", 25)[24]);
  });

  it("limits assignments to the configured batch size", () => {
    const assignments = planBotAssignments("game-batch", [], Array.from({ length: 400 }, (_, index) => index + 1), 25, 4, 4);
    expect(assignments).toHaveLength(4);
    expect(assignments[3].index).toBe(getBotRosterForGame("game-batch", 25)[3]);
  });

  it("stops cleanly when the card catalog is exhausted", () => {
    expect(planBotAssignments("game-empty", [], [], 200)).toEqual([]);
    expect(planBotAssignments("game-exhausted", [], [42, 43], 200, 25, 25)).toHaveLength(2);
  });

  it("does not require a database when live bot coordination is unavailable", async () => {
    await expect(ensureBotsForSelectingGame("game-without-database")).resolves.toEqual({ added: 0, intervalMs: 10 });
  });
});
