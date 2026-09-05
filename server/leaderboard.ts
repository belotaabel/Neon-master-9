import type { RequestHandler } from "express";
import { db } from "./db";
import { sendTelegramMessage } from "./routes/telegram";

export const LEADERBOARD_TIME_ZONE = "Africa/Addis_Ababa";
export const LEADERBOARD_REPORT_HOUR = 18;

export type LeaderboardPeriod = "daily" | "weekly" | "monthly";

export interface LeaderboardEntry {
  userId: number;
  displayName: string;
  wins: number;
}

export interface LeaderboardResult {
  period: LeaderboardPeriod;
  periodStart: string;
  periodEnd: string;
  entries: LeaderboardEntry[];
}

interface LocalCalendarDate {
  year: number;
  month: number;
  day: number;
}

interface LocalDateParts extends LocalCalendarDate {
  weekday: number;
  hour: number;
}

interface PeriodBoundaries {
  start: Date;
  end: Date;
}

const periodNames: Record<LeaderboardPeriod, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

function getLocalDateParts(date: Date): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LEADERBOARD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    values.weekday,
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: weekday < 0 ? 0 : weekday,
    hour: Number(values.hour),
  };
}

function addLocalDays(parts: LocalCalendarDate, days: number) {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function localMidnightUtc(year: number, month: number, day: number) {
  // Addis Ababa is UTC+03:00 and has no daylight-saving transitions.
  return new Date(Date.UTC(year, month - 1, day) - 3 * 60 * 60 * 1000);
}

function localDateKey(date: Date) {
  const parts = getLocalDateParts(date);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

function ethiopianDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-ethiopic", {
    timeZone: LEADERBOARD_TIME_ZONE,
    calendar: "ethiopic",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getEthiopianDateAtLocalMidnight(parts: LocalCalendarDate) {
  return new Intl.DateTimeFormat("en-US-u-ca-ethiopic", {
    timeZone: LEADERBOARD_TIME_ZONE,
    calendar: "ethiopic",
    numberingSystem: "latn",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(localMidnightUtc(parts.year, parts.month, parts.day)).reduce<Record<string, string>>(
    (values, part) => {
      values[part.type] = part.value;
      return values;
    },
    {},
  );
}

function getEthiopianMonthStart(local: LocalDateParts) {
  let candidate = { year: local.year, month: local.month, day: local.day };
  for (let days = 0; days <= 32; days += 1) {
    const ethiopian = getEthiopianDateAtLocalMidnight(candidate);
    if (Number(ethiopian.day) === 1) return candidate;
    candidate = addLocalDays(candidate, -1);
  }
  throw new Error("Unable to determine Ethiopian month start");
}

function getEthiopianMonthEnd(start: LocalCalendarDate) {
  const first = getEthiopianDateAtLocalMidnight(start);
  let candidate = addLocalDays(start, 1);
  for (let days = 1; days <= 32; days += 1) {
    const ethiopian = getEthiopianDateAtLocalMidnight(candidate);
    if (Number(ethiopian.day) === 1 && ethiopian.month !== first.month) return candidate;
    candidate = addLocalDays(candidate, 1);
  }
  throw new Error("Unable to determine Ethiopian month end");
}

function assertValidDate(date: Date) {
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");
}

export function getPeriodBoundaries(
  period: LeaderboardPeriod,
  now = new Date(),
): PeriodBoundaries {
  assertValidDate(now);
  const local = getLocalDateParts(now);
  let startDate = { year: local.year, month: local.month, day: local.day };

  if (period === "weekly") {
    startDate = addLocalDays(local, -((local.weekday + 6) % 7));
  } else if (period === "monthly") {
    startDate = getEthiopianMonthStart(local);
  }

  const start = localMidnightUtc(
    startDate.year,
    startDate.month,
    startDate.day,
  );
  const endDate =
    period === "monthly"
      ? getEthiopianMonthEnd(startDate)
      : period === "weekly"
        ? addLocalDays(startDate, 7)
        : addLocalDays(startDate, 1);
  const end = localMidnightUtc(endDate.year, endDate.month, endDate.day);
  return { start, end };
}

export function getReportPeriods(now = new Date()): LeaderboardPeriod[] {
  assertValidDate(now);
  const local = getLocalDateParts(now);
  const periods: LeaderboardPeriod[] = ["daily"];
  if (local.weekday === 1) periods.push("weekly");
  const ethiopian = getEthiopianDateAtLocalMidnight(local);
  if (Number(ethiopian.day) === 1) periods.push("monthly");
  return periods;
}

export function getNextLeaderboardReportAt(now = new Date()): Date {
  assertValidDate(now);
  const local = getLocalDateParts(now);
  const reportDate =
    local.hour >= LEADERBOARD_REPORT_HOUR ? addLocalDays(local, 1) : local;
  const midnight = localMidnightUtc(
    reportDate.year,
    reportDate.month,
    reportDate.day,
  );
  return new Date(
    midnight.getTime() + LEADERBOARD_REPORT_HOUR * 60 * 60 * 1000,
  );
}

export function formatPeriodLabel(
  period: LeaderboardPeriod,
  periodStart: Date | string,
) {
  const start =
    typeof periodStart === "string" ? new Date(periodStart) : periodStart;
  assertValidDate(start);
  return `${periodNames[period]} · ${ethiopianDateKey(start)} ዓ.ም.`;
}

export function formatLeaderboardReport(reports: LeaderboardResult[]) {
  const nonEmptyReports = reports.filter((report) => report.entries.length > 0);
  if (!nonEmptyReports.length) return "";

  return [
    "Leaderboard report",
    ...nonEmptyReports.map((report) =>
      [
        formatPeriodLabel(report.period, report.periodStart),
        ...report.entries.map(
          (entry, index) =>
            `${index + 1}. ${entry.displayName} — ${entry.wins} win${entry.wins === 1 ? "" : "s"}`,
        ),
      ].join("\n"),
    ),
  ].join("\n\n");
}

export async function getLeaderboard(
  period: LeaderboardPeriod,
  now = new Date(),
): Promise<LeaderboardResult> {
  const boundaries = getPeriodBoundaries(period, now);
  if (!db) throw new Error("DATABASE_URL is not configured");

  const result = await db.query<{
    userId: number | string;
    displayName: string;
    wins: number | string;
  }>(
    `WITH winner_rows AS (
       SELECT w.user_id::bigint AS user_id, w.created_at AS won_at
       FROM winners w
       WHERE w.created_at >= $1::timestamptz AND w.created_at < $2::timestamptz
       UNION ALL
       SELECT CASE
                WHEN winner->>'user_id' ~ '^[0-9]+$' THEN (winner->>'user_id')::bigint
                ELSE NULL::bigint
              END AS user_id,
              a.finished_at AS won_at
       FROM bingo_round_archive a
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(a.winners) = 'array' THEN a.winners ELSE '[]'::jsonb END
       ) AS winner
       WHERE a.finished_at >= $1::timestamptz AND a.finished_at < $2::timestamptz
     )
     SELECT u.id::bigint AS "userId", u.display_name AS "displayName", COUNT(*)::int AS wins
     FROM winner_rows
     JOIN users u ON u.id = winner_rows.user_id
     WHERE u.is_bot IS NOT TRUE
     GROUP BY u.id, u.display_name
     ORDER BY wins DESC, u.id ASC
     LIMIT 3`,
    [boundaries.start.toISOString(), boundaries.end.toISOString()],
  );

  return {
    period,
    periodStart: boundaries.start.toISOString(),
    periodEnd: boundaries.end.toISOString(),
    entries: result.rows.map((row) => ({
      userId: Number(row.userId),
      displayName: row.displayName,
      wins: Number(row.wins),
    })),
  };
}

export const handleLeaderboard: RequestHandler = async (req, res) => {
  const period = String(req.query.period ?? "daily") as LeaderboardPeriod;
  if (!Object.prototype.hasOwnProperty.call(periodNames, period)) {
    res.status(400).json({ error: "period must be daily, weekly, or monthly" });
    return;
  }

  try {
    res.json(await getLeaderboard(period));
  } catch (error) {
    console.error("Leaderboard query failed", error);
    res.status(503).json({ error: "Leaderboard unavailable" });
  }
};

const reportedLocalDates = new Set<string>();

function reportChatId() {
  const configured =
    process.env.TELEGRAM_LEADERBOARD_REPORT_CHAT_ID ??
    process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!configured?.trim()) return null;
  const chatId = Number(configured);
  return Number.isSafeInteger(chatId) ? chatId : null;
}

export async function executeLeaderboardReport(now = new Date()) {
  const reportDate = localDateKey(now);
  if (reportedLocalDates.has(reportDate)) return false;

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = reportChatId();
  if (!token || chatId === null) return false;

  // Set this before any awaited work so overlapping timer callbacks cannot send twice.
  reportedLocalDates.add(reportDate);
  try {
    const reports = await Promise.all(
      getReportPeriods(now).map((period) => {
        const referenceDate = period === "weekly" || period === "monthly"
          ? new Date(now.getTime() - 24 * 60 * 60 * 1000)
          : now;
        return getLeaderboard(period, referenceDate);
      }),
    );
    const text = formatLeaderboardReport(reports);
    if (!text) return false;

    await sendTelegramMessage(token, chatId, { text });
    return true;
  } catch (error) {
    reportedLocalDates.delete(reportDate);
    throw error;
  }
}

export function startLeaderboardReportScheduler() {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const scheduleNext = () => {
    if (stopped) return;
    const delay = Math.max(
      1000,
      getNextLeaderboardReportAt(new Date()).getTime() - Date.now(),
    );
    timer = setTimeout(async () => {
      try {
        await executeLeaderboardReport(new Date());
      } catch (error) {
        console.error("Leaderboard report failed", error);
      } finally {
        scheduleNext();
      }
    }, delay);
  };

  scheduleNext();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export function resetLeaderboardReportStateForTests() {
  reportedLocalDates.clear();
}
