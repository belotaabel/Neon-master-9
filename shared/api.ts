/**
 * Shared code between client and server
 * Useful to share types between client and server
 * and/or small pure JS functions that can be used on both client and server
 */

/**
 * Example response type for /api/demo
 */
export interface DemoResponse {
  message: string;
}

export type BingoGameType = "75";

export interface BotSettings {
  enabled: boolean;
  botCount: number;
  purchaseIntervalMs: number;
  batchSizeMin: number;
  batchSizeMax: number;
}

export interface AdminBotAccount {
  id: number;
  name: string;
  handle: string;
  telegram_id: string | number;
  player_balance: number | string;
  main_balance: number | string;
  balance: number | string;
  games: number;
  card_count: number;
  joined: string;
}

export const BOT_ROSTER = [
  "Abel", "Nati", "Yoni", "Dagi", "Elias", "Heni", "Maki", "Yosi", "Sami", "Kaleab",
  "Aron", "Miki", "Dani", "Beruk", "Beni", "Kirubel_Pro", "Ermias_Tech", "Biniyam_Net", "Dawit_Vibes", "Solomon_Design",
  "Tewodros_Official", "Nathan_Code", "Samuel_Live", "Surafel_Real", "Kaleb_Ops", "Abebe_Visuals", "Bruk_Web", "Ezra_Studio", "Robel_Flow", "Aman_Zone",
  "Gideon_Hub", "Nahom_Pulse", "Eyyob_Core", "Mikiyas_Lab", "Yared_Craft", "Fikru_Prime", "Haile_Base", "Getachew_Link", "Taye_Cast", "Tilahun_Sync",
  "Tadesse_Drive", "Worku_Wave", "Yared", "Kassahun", "Tewodros", "Mulugeta", "Fikru", "Getachew", "Tilahun", "Worku",
  "Henok", "Mena", "Melaku", "Binyam", "Ashenafi", "Bisrat", "Nebiyu", "Tsegaye", "Eyob", "Fitsum",
  "Yonatan", "Amsalu", "Bezawit", "Tafese", "Fisseha", "Girma", "Tadesse", "Mussie", "Kidus", "Amanuel",
  "Sintayehu", "Mulugeta", "Gashaw", "Kassa", "Belay", "Alemu", "Getu", "Luel", "Yafet", "Mebrahtu",
  "Desta", "Wondwossen", "Hailu", "Andualem", "Tewelde", "Gedion", "Kifle", "Temesgen", "Meles", "Tekle",
  "Derese", "Solomon", "Kaleb", "Zerihun", "Lemma", "Endale", "Kassaye", "Asefa", "Mengistu", "Bekele",
  "Admasu", "Workneh", "Biruk", "Sisay", "Fikre", "Seyoum", "Bedilu", "Gashu", "Assefa", "Kebede",
  "Haile", "Getahun", "Mekonnen", "Desalegn", "Genet", "Alemayehu", "Taye", "Tizazu", "Nega", "Molla",
  "Demissie", "Bogale", "Ayalew", "Tesfaye", "Aklilu", "Gideon", "Samuel", "Yohannes", "Elias", "Amanuel",
  "Dawit", "Kirubel", "Nathanael", "Robel", "Ermias", "Surafel", "Kaleb", "Sami_91", "Dani", "Miki_16",
  "Heni", "Dagi_82", "Yoni", "Nati_04", "Abel", "Biniyam_37", "Solomon_68", "Abebe", "Worku_15", "Getachew",
  "Tadesse_50", "Tilahun", "Fikru_22", "Yared", "Kassahun_89", "Mulugeta", "Tewodros_01", "Hailu", "Girma_73", "Andualem",
  "Endale_10", "Sisay", "Mengistu_64", "Bekele", "Zerihun_35", "Tesfaye", "Meles_98", "Kebede", "Desalegn_12", "Tekle",
  "Alemayehu_03", "Genet", "Asefa_47", "Molla", "Demissie_81", "Ayalew", "Aklilu_14", "Admasu", "Workneh_26", "Biruk",
  "Fikre_52", "Gashu", "Bedilu_09", "Assefa", "Mekonnen_66", "Desalegn_31", "Taye", "Tizazu_08", "Nega", "Bogale_45",
  "Amsalu", "Gashaw_84", "Belay", "Luel_07", "Desta", "Wondwossen_93", "Gedion", "Temesgen_11", "Derese", "Kassaye_62",
  "Desalegn_70", "Worku", "Getu_24", "Mebrahtu", "Kifle_05", "Mussie_38", "Sintayehu",
] as const;

export interface SimulationConfig {
  playerCount: number;
  initialBalance: number;
  selectionDelayMs: number;
  selectionSeconds: number;
  callIntervalMs: number;
  releaseProbability: number;
  remainThroughRound: boolean;
  seed: number;
}

export interface SimulationPlayerStatus {
  id: number;
  name: string;
  balance: number;
  cardCount: number;
}

export interface SimulationRunStatus {
  id: string;
  status: "running" | "stopped" | "completed";
  config: SimulationConfig;
  playerCount: number;
  cardCount: number;
  createdAt: string;
  stoppedAt: string | null;
  players: SimulationPlayerStatus[];
}

export interface SimulationAdminStatus {
  enabled: boolean;
  defaults: SimulationConfig;
  run: SimulationRunStatus | null;
}

export interface BingoWinner {
  userId: number;
  displayName: string;
  cardNumber: number;
  rows: number[];
  prizeAmount: number;
}

export type WalletBalanceType = "player" | "main";

export interface WalletProfile {
  id: number;
  telegram_id: string | number;
  username: string | null;
  display_name: string;
  phone?: string | null;
  player_balance: number | string;
  main_balance: number | string;
  balance: number | string;
  card_count: number;
}

export interface WalletTransaction {
  id: number;
  type: string;
  amount: number | string;
  balance_type: WalletBalanceType;
  status: string;
  external_reference?: string | null;
  created_at: string;
}

export interface WalletResponse {
  profile: WalletProfile;
  transactions: WalletTransaction[];
  depositReceiver: string | null;
}
