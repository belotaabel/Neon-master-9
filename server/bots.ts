import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import { BOT_ROSTER } from "@shared/api";
import { BOT_DEFAULT_BALANCE, BOT_TELEGRAM_ID_BASE, CARD_SELECTION_LOCKED_ERROR, DEFAULT_BOT_BATCH_MIN_SIZE, DEFAULT_BOT_PURCHASE_INTERVAL_MS, db, getBotSettings } from "./db";

const CARD_PRICE = 10;
const BOT_SELECTION_CUTOFF_MS = 45000;
const BOT_INITIAL_PURCHASE_DELAY_MIN_MS = 5000;
const BOT_INITIAL_PURCHASE_DELAY_RANGE_MS = 5001;
const BOT_CARD_SWITCH_DELAY_MIN_MS = 5000;
const BOT_CARD_SWITCH_DELAY_RANGE_MS = 10000;
const BOT_CARD_SWITCH_ELIGIBILITY_DIVISOR = 5;

type CurrentBotCard = {
  user_id: number | string;
  bot_key: string;
  card_number: number | string;
  purchased_at: string | Date;
};

function hashText(value: string) {
  let hash = 0;
  for (const character of value) hash = Math.imul(hash, 31) + character.charCodeAt(0) | 0;
  return hash >>> 0;
}

function mixHash(value: number) {
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

export function getBotInitialPurchaseDelay(gameId: string) {
  return BOT_INITIAL_PURCHASE_DELAY_MIN_MS + hashText(`purchase:${gameId}`) % BOT_INITIAL_PURCHASE_DELAY_RANGE_MS;
}

export function getBotCountForGame(gameId: string, configuredCount: number) {
  const target = Math.min(Math.max(0, Math.floor(configuredCount)), BOT_ROSTER.length);
  if (target === 0) return 0;
  const minimum = Math.max(1, target - 3);
  const maximum = Math.min(BOT_ROSTER.length, target + 3);
  return minimum + hashText(`count:${gameId}`) % (maximum - minimum + 1);
}

export function getBotRosterForGame(gameId: string, botCount: number) {
  const target = Math.min(Math.max(0, Math.floor(botCount)), BOT_ROSTER.length);
  return BOT_ROSTER
    .map((name, index) => ({ name, index, order: mixHash(hashText(`roster:${gameId}:${index}`)) }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .slice(0, target)
    .map(({ index }) => index);
}

export function getBotCardSwitchDelay(gameId: string, botKey: string) {
  const hash = hashText(`${gameId}:${botKey}`);
  if (hash % BOT_CARD_SWITCH_ELIGIBILITY_DIVISOR !== 0) return null;
  return BOT_CARD_SWITCH_DELAY_MIN_MS + hash % BOT_CARD_SWITCH_DELAY_RANGE_MS;
}

type BotAssignment = {
  index: number;
  name: string;
  cardNumber: number;
};

type BotBalance = {
  userId: number;
  playerBalance: number;
  mainBalance: number;
};

export { BOT_ROSTER };

export function chooseBotCards(availableCards: number[]) {
  if (!availableCards.length) return [];
  return [availableCards[randomInt(availableCards.length)]];
}

export function shuffleBotCards(availableCards: number[]) {
  const shuffled = [...availableCards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function chooseBotBatchSize(batchSizeMin: number, batchSizeMax: number) {
  const minimum = Math.min(Math.max(1, Math.floor(batchSizeMin)), 25);
  const maximum = Math.max(minimum, Math.min(25, Math.floor(batchSizeMax)));
  return randomInt(minimum, maximum + 1);
}

export function planBotAssignments(gameId: string, existingBotKeys: Iterable<string>, availableCards: number[], botCount: number, batchSizeMin = DEFAULT_BOT_BATCH_MIN_SIZE, batchSizeMax = batchSizeMin): BotAssignment[] {
  const existing = new Set(existingBotKeys);
  const target = Math.min(Math.max(0, Math.floor(botCount)), BOT_ROSTER.length);
  const limit = Math.min(chooseBotBatchSize(batchSizeMin, batchSizeMax), target);
  const missingIndexes = getBotRosterForGame(gameId, target)
    .filter((index) => !existing.has(`global-bot:${index}`));

  return missingIndexes.slice(0, Math.min(availableCards.length, limit)).map((index, cardIndex) => ({
    index,
    name: BOT_ROSTER[index],
    cardNumber: availableCards[cardIndex],
  }));
}

async function botUsers(client: PoolClient, assignments: BotAssignment[]) {
  const result = await client.query<{ id: number | string; bot_key: string }>(
    `INSERT INTO users (telegram_id, username, display_name, is_bot, bot_key, updated_at)
     SELECT incoming.telegram_id, incoming.username, incoming.display_name, TRUE, incoming.bot_key, NOW()
     FROM UNNEST($1::bigint[], $2::text[], $3::text[], $4::text[])
       AS incoming(telegram_id, username, display_name, bot_key)
     ON CONFLICT (telegram_id) DO UPDATE
     SET username = EXCLUDED.username, display_name = EXCLUDED.display_name, is_bot = TRUE, bot_key = EXCLUDED.bot_key, updated_at = NOW()
     RETURNING id, bot_key`,
    [
      assignments.map(({ index }) => BOT_TELEGRAM_ID_BASE + index),
      assignments.map(({ name }) => name.toLowerCase()),
      assignments.map(({ name }) => name),
      assignments.map(({ index }) => `global-bot:${index}`),
    ],
  );
  return new Map(result.rows.map((row) => [row.bot_key, Number(row.id)]));
}

async function fundBots(client: PoolClient, userIds: number[]): Promise<BotBalance[]> {
  await client.query(
    `INSERT INTO balances (user_id, balance, player_balance, main_balance)
     SELECT ids.user_id, 0, $2::numeric, 0
     FROM UNNEST($1::bigint[]) AS ids(user_id)
     ON CONFLICT (user_id) DO NOTHING`,
    [userIds, BOT_DEFAULT_BALANCE],
  );
  const result = await client.query<{ user_id: number | string; player_balance: number | string; main_balance: number | string }>(
    "SELECT user_id, player_balance, main_balance FROM balances WHERE user_id = ANY($1::bigint[]) FOR UPDATE",
    [userIds],
  );
  const balances = result.rows.map((row) => ({
    userId: Number(row.user_id),
    playerBalance: Number(row.player_balance),
    mainBalance: Number(row.main_balance),
  }));
  const funding = balances.map((balance) => ({
    ...balance,
    amount: Math.max(0, CARD_PRICE - balance.playerBalance - balance.mainBalance),
  })).filter(({ amount }) => amount > 0);

  if (funding.length) {
    await client.query(
      `UPDATE balances b
       SET player_balance = b.player_balance + funding.amount, updated_at = NOW()
       FROM UNNEST($1::bigint[], $2::numeric[]) AS funding(user_id, amount)
       WHERE b.user_id = funding.user_id`,
      [funding.map(({ userId }) => userId), funding.map(({ amount }) => amount)],
    );
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_type, status, external_reference)
       SELECT funding.user_id, 'bot_funding', funding.amount, 'player', 'approved', 'bot-funding:' || funding.user_id
       FROM UNNEST($1::bigint[], $2::numeric[]) AS funding(user_id, amount)`,
      [funding.map(({ userId }) => userId), funding.map(({ amount }) => amount)],
    );
    for (const balance of balances) {
      const amount = funding.find((item) => item.userId === balance.userId)?.amount ?? 0;
      balance.playerBalance += amount;
    }
  }
  return balances;
}

async function chargeBotCards(client: PoolClient, gameId: string, balances: BotBalance[]) {
  const debits = balances.map(({ userId, playerBalance }) => ({
    userId,
    player: Math.min(playerBalance, CARD_PRICE),
    main: Math.max(0, CARD_PRICE - Math.min(playerBalance, CARD_PRICE)),
  }));
  await client.query(
    `UPDATE balances b
     SET player_balance = b.player_balance - debits.player,
         main_balance = b.main_balance - debits.main,
         updated_at = NOW()
     FROM UNNEST($1::bigint[], $2::numeric[], $3::numeric[]) AS debits(user_id, player, main)
     WHERE b.user_id = debits.user_id`,
    [debits.map(({ userId }) => userId), debits.map(({ player }) => player), debits.map(({ main }) => main)],
  );
  const playerDebits = debits.filter(({ player }) => player > 0);
  const mainDebits = debits.filter(({ main }) => main > 0);
  if (playerDebits.length) {
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_type, status, external_reference)
       SELECT debits.user_id, 'card_purchase', debits.amount, 'player', 'approved', 'game:' || $1 || ':bot:' || debits.user_id
       FROM UNNEST($2::bigint[], $3::numeric[]) AS debits(user_id, amount)`,
      [gameId, playerDebits.map(({ userId }) => userId), playerDebits.map(({ player }) => player)],
    );
  }
  if (mainDebits.length) {
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_type, status, external_reference)
       SELECT debits.user_id, 'card_purchase', debits.amount, 'main', 'approved', 'game:' || $1 || ':bot:' || debits.user_id
       FROM UNNEST($2::bigint[], $3::numeric[]) AS debits(user_id, amount)`,
      [gameId, mainDebits.map(({ userId }) => userId), mainDebits.map(({ main }) => main)],
    );
  }
}

async function availableCards(client: PoolClient, gameId: string) {
  const result = await client.query<{ card_number: number }>(
    `SELECT bc.card_number - 400 AS card_number
     FROM bingo_cards bc
     WHERE bc.game_type = '75'
       AND NOT EXISTS (SELECT 1 FROM game_cards gc WHERE gc.game_id = $1 AND gc.card_number = bc.card_number)
     ORDER BY bc.card_number`,
    [gameId],
  );
  return result.rows.map((row) => Number(row.card_number));
}

type BotCoordinationResult = { added: number; intervalMs: number };

async function runBotCoordinator(gameId: string): Promise<BotCoordinationResult> {
  if (!db) return { added: 0, intervalMs: DEFAULT_BOT_PURCHASE_INTERVAL_MS };
  const settings = await getBotSettings();
  if (!settings.enabled || settings.botCount === 0) return { added: 0, intervalMs: settings.purchaseIntervalMs };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(90213, hashtext($1))", [gameId]);
    const game = await client.query("SELECT status, selecting_started_at FROM games WHERE id = $1 AND game_type = '75' FOR UPDATE", [gameId]);
    const selectingStartedAt = game.rowCount ? new Date(game.rows[0].selecting_started_at).getTime() : 0;
    const selectionExpired = () => Date.now() - selectingStartedAt >= BOT_SELECTION_CUTOFF_MS;
    if (!game.rowCount || game.rows[0].status !== "selecting" || selectionExpired()) {
      await client.query("COMMIT");
      return { added: 0, intervalMs: settings.purchaseIntervalMs };
    }
    const elapsed = Date.now() - selectingStartedAt;
    const initialPurchaseDelay = getBotInitialPurchaseDelay(gameId);
    if (elapsed < initialPurchaseDelay) {
      await client.query("COMMIT");
      return { added: 0, intervalMs: Math.max(settings.purchaseIntervalMs, initialPurchaseDelay - elapsed) };
    }
    const existing = await client.query<CurrentBotCard>(
      `SELECT u.id AS user_id, u.bot_key, gc.card_number, gc.purchased_at
       FROM game_cards gc JOIN users u ON u.id = gc.user_id
       WHERE gc.game_id = $1 AND u.is_bot = TRUE`,
      [gameId],
    );
    const switched = await client.query<{ user_id: number | string }>(
      `SELECT DISTINCT user_id
       FROM audit_logs
       WHERE action = 'bot_card_switch' AND entity_type = 'game' AND entity_id = $1`,
      [gameId],
    );
    const switchedUserIds = new Set(switched.rows.map((row) => Number(row.user_id)));
    const now = Date.now();
    const switchCandidate = existing.rows
      .filter((bot) => !switchedUserIds.has(Number(bot.user_id)))
      .map((bot) => ({ ...bot, delay: getBotCardSwitchDelay(gameId, bot.bot_key) }))
      .filter((bot) => bot.delay !== null && now - new Date(bot.purchased_at).getTime() >= bot.delay)
      .sort((left, right) => new Date(left.purchased_at).getTime() - new Date(right.purchased_at).getTime())[0];

    if (switchCandidate && !selectionExpired()) {
      const oldCardNumber = Number(switchCandidate.card_number);
      const oldPublicCardNumber = oldCardNumber - 400;
      const replacementCardNumber = shuffleBotCards(
        (await availableCards(client, gameId)).filter((cardNumber) => cardNumber !== oldPublicCardNumber),
      )[0];
      if (replacementCardNumber !== undefined) {
        await client.query(
          "DELETE FROM game_cards WHERE game_id = $1 AND user_id = $2 AND card_number = $3",
          [gameId, Number(switchCandidate.user_id), oldCardNumber],
        );
        if (selectionExpired()) throw new Error(CARD_SELECTION_LOCKED_ERROR);
        await client.query(
          "INSERT INTO game_cards (game_id, user_id, card_number) VALUES ($1, $2, $3)",
          [gameId, Number(switchCandidate.user_id), replacementCardNumber + 400],
        );
        if (selectionExpired()) throw new Error(CARD_SELECTION_LOCKED_ERROR);
        await client.query(
          `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
           VALUES ($1, 'bot_card_switch', 'game', $2, jsonb_build_object('releasedCardNumber', $3::int, 'newCardNumber', $4::int))`,
          [Number(switchCandidate.user_id), gameId, oldPublicCardNumber, replacementCardNumber],
        );
        await client.query("COMMIT");
        return { added: 1, intervalMs: settings.purchaseIntervalMs };
      }
    }

    const botCountForGame = getBotCountForGame(gameId, settings.botCount);
    const assignments = planBotAssignments(gameId, existing.rows.map((row) => row.bot_key), shuffleBotCards(await availableCards(client, gameId)), botCountForGame, settings.batchSizeMin, settings.batchSizeMax);
    if (!assignments.length || selectionExpired()) {
      await client.query("COMMIT");
      return { added: 0, intervalMs: settings.purchaseIntervalMs };
    }

    const userIdsByKey = await botUsers(client, assignments);
    const userIds = assignments.map(({ index }) => {
      const userId = userIdsByKey.get(`global-bot:${index}`);
      if (!userId) throw new Error(`Bot user global-bot:${index} is unavailable`);
      return userId;
    });
    const balances = await fundBots(client, userIds);
    if (selectionExpired()) throw new Error(CARD_SELECTION_LOCKED_ERROR);

    const storedCards = assignments.map(({ cardNumber }) => cardNumber + 400);
    await client.query(
      `INSERT INTO game_cards (game_id, user_id, card_number)
       SELECT $1, cards.user_id, cards.card_number
       FROM UNNEST($2::bigint[], $3::int[]) AS cards(user_id, card_number)`,
      [gameId, userIds, storedCards],
    );
    if (selectionExpired()) throw new Error(CARD_SELECTION_LOCKED_ERROR);
    await chargeBotCards(client, gameId, balances);
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       SELECT audits.user_id, 'bot_card_purchase', 'game', $1, jsonb_build_object('cardNumber', audits.card_number, 'amount', $2::numeric)
       FROM UNNEST($3::bigint[], $4::int[]) AS audits(user_id, card_number)`,
      [gameId, CARD_PRICE, userIds, storedCards],
    );
    await client.query(
      `UPDATE games
       SET prize_pool = (SELECT COUNT(*) * 10 * 0.8 FROM game_cards WHERE game_id = $1)
       WHERE id = $1 AND status = 'selecting'`,
      [gameId],
    );
    await client.query("COMMIT");
    return { added: assignments.length, intervalMs: settings.purchaseIntervalMs };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureBotsForSelectingGame(gameId: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await runBotCoordinator(gameId);
    } catch (error) {
      if (error instanceof Error && error.message === CARD_SELECTION_LOCKED_ERROR) return { added: 0, intervalMs: DEFAULT_BOT_PURCHASE_INTERVAL_MS };
      if ((error as { code?: string }).code !== "23505" || attempt === 2) throw error;
    }
  }
  return { added: 0, intervalMs: DEFAULT_BOT_PURCHASE_INTERVAL_MS };
}
