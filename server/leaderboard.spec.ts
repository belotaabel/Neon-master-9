import { describe, expect, it } from "vitest";
import {
  formatLeaderboardReport,
  formatPeriodLabel,
  getNextLeaderboardReportAt,
  getPeriodBoundaries,
  getReportPeriods,
  type LeaderboardResult,
} from "./leaderboard";

describe("leaderboard period boundaries", () => {
  it("uses Addis Ababa local midnight for daily periods", () => {
    const boundaries = getPeriodBoundaries(
      "daily",
      new Date("2024-01-15T10:00:00.000Z"),
    );

    expect(boundaries.start.toISOString()).toBe("2024-01-14T21:00:00.000Z");
    expect(boundaries.end.toISOString()).toBe("2024-01-15T21:00:00.000Z");
  });

  it("starts weekly periods on local Monday", () => {
    const boundaries = getPeriodBoundaries(
      "weekly",
      new Date("2024-01-21T10:00:00.000Z"),
    );

    expect(boundaries.start.toISOString()).toBe("2024-01-14T21:00:00.000Z");
    expect(boundaries.end.toISOString()).toBe("2024-01-21T21:00:00.000Z");
  });

});

describe("leaderboard report scheduling and formatting", () => {
  it("includes weekly reports only on local Mondays", () => {
    expect(getReportPeriods(new Date("2024-01-15T15:00:00.000Z"))).toEqual([
      "daily",
      "weekly",
    ]);
    expect(getReportPeriods(new Date("2024-01-02T15:00:00.000Z"))).toEqual([
      "daily",
    ]);
  });

  it("schedules the next report at 18:00 Addis Ababa time", () => {
    expect(
      getNextLeaderboardReportAt(
        new Date("2024-01-15T14:59:00.000Z"),
      ).toISOString(),
    ).toBe("2024-01-15T15:00:00.000Z");
    expect(
      getNextLeaderboardReportAt(
        new Date("2024-01-15T15:01:00.000Z"),
      ).toISOString(),
    ).toBe("2024-01-16T15:00:00.000Z");
  });

  it("formats stable period labels and omits empty periods", () => {
    const reports: LeaderboardResult[] = [
      {
        period: "daily",
        periodStart: "2024-01-14T21:00:00.000Z",
        periodEnd: "2024-01-15T21:00:00.000Z",
        entries: [{ userId: 7, displayName: "Alice", wins: 2 }],
      },
      {
        period: "weekly",
        periodStart: "2024-01-14T21:00:00.000Z",
        periodEnd: "2024-01-21T21:00:00.000Z",
        entries: [],
      },
    ];

    expect(formatPeriodLabel("daily", reports[0].periodStart)).toBe(
      "Daily · 2016-05-06 ዓ.ም.",
    );
    expect(formatLeaderboardReport(reports)).toBe(
      "Leaderboard report\n\nDaily · 2016-05-06 ዓ.ም.\n1. Alice — 2 wins",
    );
    expect(formatLeaderboardReport(reports.slice(1))).toBe("");
  });
});
