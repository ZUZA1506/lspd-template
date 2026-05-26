const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const path = require("path");
const express = require("express");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = path.resolve(__dirname, "..");
loadLocalEnv();
const STORAGE_DIR = process.env.DATA_DIR ?path.resolve(process.env.DATA_DIR) : path.join(ROOT, "storage");
const DB_FILE = path.join(STORAGE_DIR, "dienstblatt.json");
const BACKUP_DIR = path.join(STORAGE_DIR, "backups");
const PUBLIC_DIR = path.join(ROOT, "public");
const DEFAULT_PASSWORD = "ZUZA";
const INFORMATION_EDIT_LOCK_TTL_MS = 2 * 60 * 1000;
const MAX_INFORMATION_CHANGE_TEXT = 200_000;
const MAX_INFORMATION_CHANGES = 120;
const MAX_LOG_ENTRIES = 1500;
const EVIDENCE_PREVIEW_TTL_MS = 1000 * 60 * 60 * 12;
const TWITCH_FETCH_TIMEOUT_MS = 10000;
const CUSTOM_ANIMATION_MAX_BYTES = 18 * 1024 * 1024;
const evidencePreviewCache = new Map();
const informationEditLocks = new Map();
const activeWebClients = new Map();
const jumpscareEvents = new Map();
const runtimeSessionSecret = crypto.randomBytes(32).toString("hex");
let clientRefreshRevision = "";
let informationEditLocksRevision = "";
let twitchAccessToken = "";
let twitchAccessTokenExpiresAt = 0;
let twitchPollInFlight = false;
const DISCORD_SYNC_PANEL_FOOTER = "LSPD Bot by Daniel";
const LEGACY_DISCORD_SYNC_PANEL_FOOTERS = ["LSPD_SYNC_PANEL", DISCORD_SYNC_PANEL_FOOTER];
const DISCORD_UNSYNCED_ROLE_ID = process.env.DISCORD_UNSYNCED_ROLE_ID || "";
const recentDiscordAccountNotices = new Map();
const googleDocsCache = new Map();
const GOOGLE_DOCS_RECHECK_MS = 60 * 60 * 1000;
let discordClient = null;
let discordBotStarting = false;
let discordFullSyncStatus = {
  running: false,
  startedAt: "",
  finishedAt: "",
  synced: 0,
  failed: 0,
  skipped: 0,
  failedAccounts: [],
  error: ""
};

function loadLocalEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}
let discordRequestQueue = Promise.resolve();
const discordUserSyncQueues = new Map();
let discordFullSyncRunning = false;

loadEnvFile(path.join(ROOT, ".env"));

const DEFAULT_PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "http://localhost:3000/";
const DISCORD_CALLBACK_PATH = "/api/discord/callback";
const LEGACY_PUBLIC_BASE_URLS = [
  "https://fib.vdm67.de/",
  "https://lspd.vdm67.de/"
];
const PUBLIC_BASE_URL = normalizePublicUrl(process.env.PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL);
const pendingDiscordOAuthTickets = new Map();

const roles = ["User", "Frakverwaltung", "Supervisor", "Direktion", "Template", "IT", "IT-Leitung"];
const rolePower = { User: 1, Frakverwaltung: 1, Supervisor: 2, Direktion: 3, Template: 1, IT: 4, "IT-Leitung": 5 };
const ranks = Array.from({ length: 13 }, (_, index) => ({
  value: index,
  label: `Rang ${index}`
}));

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  fs.readFileSync(filePath, "utf8").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

function updateEnvFile(updates = {}) {
  const filePath = path.join(ROOT, ".env");
  const existing = fs.existsSync(filePath) ?fs.readFileSync(filePath, "utf8").split(/\r?\n/) : [];
  const keys = new Set(Object.keys(updates));
  const written = new Set();
  const lines = existing.map((line) => {
    const trimmed = line.trim();
    const separator = trimmed.indexOf("=");
    if (!trimmed || trimmed.startsWith("#") || separator === -1) return line;
    const key = trimmed.slice(0, separator).trim();
    if (!keys.has(key)) return line;
    written.add(key);
    return `${key}=${String(updates[key] ?? "")}`;
  });
  Object.entries(updates).forEach(([key, value]) => {
    if (!written.has(key)) lines.push(`${key}=${String(value ?? "")}`);
    process.env[key] = String(value ?? "");
  });
  fs.writeFileSync(filePath, lines.join("\n").replace(/\n*$/, "\n"));
}

function normalizeTwitchLivecheckConfig(value = {}) {
  return {
    clientId: String(value?.clientId || ""),
    clientSecret: String(value?.clientSecret || "")
  };
}

function normalizeTrainingModuleSettings(value = {}) {
  const labels = value?.labels && typeof value.labels === "object" ?value.labels : {};
  const details = value?.details && typeof value.details === "object" ?value.details : {};
  const categories = value?.categories && typeof value.categories === "object" ?value.categories : {};
  const requirements = value?.requirements && typeof value.requirements === "object" ?value.requirements : {};
  const order = Array.isArray(value?.order) ?value.order.map(String).filter((training) => trainingNames.includes(training)) : [];
  const deleted = Array.isArray(value?.deleted) ?value.deleted.map(String).filter((training) => trainingNames.includes(training)) : [];
  return {
    labels: Object.fromEntries(trainingNames
      .filter((training) => Object.prototype.hasOwnProperty.call(labels, training))
      .map((training) => [training, String(labels[training] || "").trim()])
      .filter(([, label]) => label)),
    details: Object.fromEntries(trainingNames
      .filter((training) => Object.prototype.hasOwnProperty.call(details, training))
      .map((training) => [training, String(details[training] || "").trim()])
      .filter(([, detail]) => detail)),
    categories: Object.fromEntries(trainingNames
      .filter((training) => Object.prototype.hasOwnProperty.call(categories, training))
      .map((training) => [training, String(categories[training] || "").trim()])
      .filter(([, category]) => category)),
    requirements: Object.fromEntries(trainingNames
      .filter((training) => Object.prototype.hasOwnProperty.call(requirements, training))
      .map((training) => [training, String(requirements[training] || "").trim()])
      .filter(([, requirement]) => requirement)),
    order: Array.from(new Set(order)),
    deleted: Array.from(new Set(deleted)),
    hidden: Array.isArray(value?.hidden) ?value.hidden.map(String).filter((training) => trainingNames.includes(training)) : []
  };
}

function defaultOnboardingTutorial() {
  const steps = [
    ["welcome", "Herzlich willkommen im LSPD", "Dein Dienstblatt-Account ist jetzt aktiviert. Hier siehst du deine Dienstnummer und bekommst eine kurze Einweisung, bevor du ins Dienstblatt gehst.", ""],
    ["dienstblatt", "Dienstblatt", "Hier trägst du dich in den Dienst ein und aus. Du siehst aktuelle Dienstzeiten, Status und die wichtigsten Tagesfunktionen.", "Dienstblatt"],
    ["beschlagnahmungen", "Beschlagnahmungen", "Hier werden beschlagnahmte Gegenstände und Fahrzeuge dokumentiert, damit Vorgänge sauber nachvollziehbar bleiben.", "Beschlagnahmung"],
    ["informationen", "Informationen", "Hier findest du Vorschriften, Rechte, Weiterleitungen und wichtige Dokumente. Kacheln anklicken, Dokument lesen und bei Bedarf suchen.", "Informationen"],
    ["abteilungen", "Abteilungen", "Hier siehst du alle Abteilungen, deren Mitglieder, Hinweise und je nach Berechtigung interne Informationen.", "Abteilungen"],
    ["mitglieder", "Mitglieder", "Hier findest du aktive Mitglieder, Ränge, Ausbildungen und wichtige Übersichten zu Personen im LSPD.", "Mitglieder"],
    ["fluktuation", "Mitgliederfluktation", "Hier werden Einstellungen, Kündigungen und Wiedereinstellungen dokumentiert.", "Mitgliederfluktation"],
    ["befoerderungen", "Beförderungen", "Hier siehst du Beförderungen und relevante Rangänderungen übersichtlich nach Tagen sortiert.", "Beförderungen"],
    ["changelog", "Changelog", "Hier stehen neue Änderungen am Dienstblatt. Ungelesene Einträge werden in der Navigation markiert.", "Changelog"],
    ["postfach", "Postfach", "Hier laufen interne Chats, Hinweise und persönliche Nachrichten zusammen. Ungelesene Nachrichten werden rot markiert.", "Postfach"],
    ["profil", "Profil", "Hier verwaltest du dein Profil, Passwort, Discord-Verknüpfung, Twitch-Verknüpfung und persönliche Daten.", "Profil"],
    ["kalender", "Kalender", "Hier findest du Termine, geplante Events und wichtige Zeitpunkte.", "Kalender"],
    ["swat", "SWAT", "Hier siehst du SWAT-Teamübersichten, Status und je nach Teamzugehörigkeit interne SWAT-Notizen oder Ausrufe.", "SWAT"]
  ];
  return steps.map(([id, title, text, page]) => ({ id, title, text, page, imageUrl: "", imageUrls: [] }));
}

function normalizeOnboardingTutorial(value = []) {
  const defaults = defaultOnboardingTutorial();
  if (!defaults.some((step) => step.id === "discord")) {
    defaults.push({ id: "discord", title: "Discord verbinden", text: "Discord ist Pflicht fuer den Dienstblatt-Account.", page: "Profil", imageUrl: "", imageUrls: [] });
  }
  const incoming = Array.isArray(value) ?value : [];
  const byId = new Map(incoming.map((step) => [String(step?.id || ""), step]));
  return defaults.map((fallback) => {
    const item = byId.get(fallback.id) || {};
    const rawImages = Array.isArray(item.imageUrls) ?item.imageUrls : [item.imageUrl].filter(Boolean);
    const imageUrls = Array.from(new Set(rawImages.map((url) => String(url || "").trim()).filter((url) => {
      const allowedImage = /^https?:\/\//i.test(url) || /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(url);
      return allowedImage && url.length <= 2_500_000;
    }))).slice(0, 8);
    return {
      id: fallback.id,
      title: String(item.title || fallback.title).trim().slice(0, 80) || fallback.title,
      text: String(item.text || fallback.text).trim().slice(0, 1200) || fallback.text,
      page: fallback.page,
      imageUrl: imageUrls[0] || "",
      imageUrls
    };
  });
}

function publicSecretConfig(settings = {}) {
  const twitchLivecheck = normalizeTwitchLivecheckConfig(settings.twitchLivecheck);
  const discordSync = normalizeDiscordSync(settings.discordSync);
  const twitchClientId = process.env.TWITCH_CLIENT_ID || twitchLivecheck.clientId || "";
  const twitchClientSecret = process.env.TWITCH_CLIENT_SECRET || twitchLivecheck.clientSecret || "";
  return {
    discordApplicationId: process.env.DISCORD_APPLICATION_ID || discordSync.applicationId || "",
    discordClientSecretSet: Boolean(process.env.DISCORD_CLIENT_SECRET || discordSync.clientSecret),
    discordPublicKey: process.env.DISCORD_PUBLIC_KEY || discordSync.publicKey || "",
    discordBotTokenSet: Boolean(process.env.DISCORD_BOT_TOKEN || discordSync.botToken),
    discordServerId: process.env.DISCORD_SERVER_ID || discordSync.serverId || "",
    discordSyncChannelId: process.env.DISCORD_SYNC_CHANNEL_ID || discordSync.syncChannelId || "",
    discordItChannelId: process.env.DISCORD_IT_CHANNEL_ID || discordSync.itChannelId || "",
    discordUnsyncedRoleId: process.env.DISCORD_UNSYNCED_ROLE_ID || discordSync.unsyncedRoleId || "",
    discordInviteUrl: process.env.DISCORD_INVITE_URL || discordSync.inviteUrl || "",
    discordOauthRedirectUrl: process.env.DISCORD_OAUTH_REDIRECT_URL || discordSync.oauthRedirectUrl || "",
    publicBaseUrl: process.env.PUBLIC_BASE_URL || settings.publicBaseUrl || "",
    twitchClientId,
    twitchClientSecretSet: Boolean(twitchClientSecret)
  };
}

function normalizePublicUrl(value, fallback = DEFAULT_PUBLIC_BASE_URL) {
  const raw = String(value || "").trim();
  if (!raw && fallback === "") return "";
  const candidate = LEGACY_PUBLIC_BASE_URLS.some((legacyUrl) => raw.replace(/\/+$/, "/").toLowerCase() === legacyUrl.toLowerCase())
    ?DEFAULT_PUBLIC_BASE_URL
    : raw;
  try {
    const url = new URL(candidate || fallback);
    url.hash = "";
    url.search = "";
    url.pathname = "/";
    return url.toString();
  } catch {
    return fallback;
  }
}

function discordCallbackUrl(baseUrl = PUBLIC_BASE_URL) {
  const url = new URL(normalizePublicUrl(baseUrl, PUBLIC_BASE_URL));
  url.pathname = DISCORD_CALLBACK_PATH;
  return url.toString();
}

function normalizeDiscordRedirectUrl(value, fallbackBaseUrl = PUBLIC_BASE_URL) {
  const raw = String(value || "").trim();
  if (!raw) return discordCallbackUrl(fallbackBaseUrl);
  try {
    const url = new URL(raw);
    const isLegacyRoot = LEGACY_PUBLIC_BASE_URLS.some((legacyUrl) => raw.replace(/\/+$/, "/").toLowerCase() === legacyUrl.toLowerCase());
    if (isLegacyRoot) return discordCallbackUrl(DEFAULT_PUBLIC_BASE_URL);
    url.hash = "";
    url.search = "";
    if (url.pathname === "/" || url.pathname === "") url.pathname = DISCORD_CALLBACK_PATH;
    return url.toString();
  } catch {
    return discordCallbackUrl(fallbackBaseUrl);
  }
}

function publicUrlFromRequest(req) {
  const origin = String(req.headers.origin || "").trim();
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const publicUrl = normalizePublicUrl(originUrl.toString(), "");
      if (publicUrl === PUBLIC_BASE_URL) return publicUrl;
    } catch {}
  }
  return PUBLIC_BASE_URL;
}

function defaultRanks() {
  return ranks.map((rank) => ({ ...rank }));
}

function defaultUprankRules() {
  return ranks.slice(1).map((rank) => ({
    targetRank: rank.value,
    minDays: rank.value === 1 ?7 : 14,
    trainings: rank.value === 1 ?["EST"] : [],
    specialOnly: rank.value >= 7
  }));
}

function defaultDepartments() {
  return [
    makeDepartment("direktion", "Direktion", "LSPD Direktion und administrative Leitung", "Offen"),
    makeDepartment("human-resources", "Personalabteilung", "Personalverwaltung, Bewerbungen und EST Pruefungen", "Offen"),
    makeDepartment("training-recruitment", "Police Academy", "Ausbildung, Recruiting und Lernkontrollen", "Offen"),
    makeDepartment("department-corruptions", "Department of Corruptions", "Interne Ermittlungen und Korruptionsdelikte", "Offen"),
    makeDepartment("swat", "SWAT", "Taktische Einsaetze und Zugriffslagen", "Offen"),
    makeDepartment("sherrif", "Sherrif", "Sherrif Abteilungsblatt und Verwaltung", "Offen")
  ];
}

function makeDepartment(id, name, description, applicationStatus) {
  return {
    id,
    name,
    description,
    applicationStatus,
    requirements: "Voraussetzungen werden später ergänzt.",
    rightsText: "",
    links: [],
    permits: [],
    factions: [],
    docs: [],
    positions: [...departmentPositions],
    leaderPositions: ["Direktion", "Leitung", "Stv. Leitung"],
    positionColors: { Direktion: "green", Leitung: "red", "Stv. Leitung": "orange", Mitglied: "blue", "Anwärter": "green" },
    members: [],
    notes: [],
    memberNotes: []
  };
}

function defaultPermissions() {
  return {
    pages: {},
    actions: {
      editDefcon: { roles: ["Supervisor", "Direktion", "IT", "IT-Leitung"], ranks: [], users: [] },
      manageNotes: { roles: ["Supervisor", "Direktion", "IT", "IT-Leitung"], ranks: [], users: [] },
      stopSingleDuty: { all: true, roles: [], ranks: [], users: [] },
      stopAllDuty: { roles: ["Direktion", "IT", "IT-Leitung"], ranks: [], users: [] },
      manageInformation: { roles: ["Direktion", "IT", "IT-Leitung"], ranks: [], users: [] },
      manageDutyHours: { roles: ["Direktion", "IT", "IT-Leitung"], ranks: [], users: [] },
      manageDepartments: { roles: ["Direktion", "IT", "IT-Leitung"], ranks: [], users: [] },
      manageMembers: { roles: ["Direktion", "IT", "IT-Leitung"], ranks: [], users: [] },
      personnelFiles: { roles: ["Direktion", "IT", "IT-Leitung"], ranks: [], users: [], departments: ["human-resources"], positions: [] },
      viewLogs: { roles: ["Direktion", "IT", "IT-Leitung"], ranks: [], users: [] }
    }
  };
}

function normalizePermissionRule(rule = {}) {
  return {
    all: Boolean(rule.all),
    roles: Array.isArray(rule.roles) ?rule.roles.filter((role) => roles.includes(role)) : [],
    ranks: Array.isArray(rule.ranks) ?rule.ranks.map(Number).filter((rank) => Number.isInteger(rank)) : [],
    users: Array.isArray(rule.users) ?rule.users.map(String).filter(Boolean) : [],
    departments: Array.isArray(rule.departments) ?rule.departments.map(String).filter(Boolean) : [],
    positions: Array.isArray(rule.positions) ?rule.positions.map(String).filter(Boolean) : []
  };
}

function normalizePermissions(value = {}) {
  const defaults = defaultPermissions();
  const pages = value.pages && typeof value.pages === "object" ?value.pages : {};
  const actions = value.actions && typeof value.actions === "object" ?value.actions : {};
  return {
    pages: Object.fromEntries(Object.entries(pages).map(([key, rule]) => [key, normalizePermissionRule(rule)])),
    actions: {
      ...Object.fromEntries(Object.entries(defaults.actions).map(([key, rule]) => [key, normalizePermissionRule(actions[key] || rule)])),
      ...Object.fromEntries(Object.entries(actions).filter(([key]) => !defaults.actions[key]).map(([key, rule]) => [key, normalizePermissionRule(rule)]))
    }
  };
}


function ensureDepartmentPermissionDefaults(settings) {
  settings.permissions = normalizePermissions(settings.permissions || {});
  settings.permissions.pages = settings.permissions.pages || {};
  settings.permissions.actions = settings.permissions.actions || {};
  (settings.departments || []).filter((department) => department.id !== "direktion").forEach((department) => {
    const id = department.id;
    const leaderPositions = ["Direktion", "Leitung", "Stv. Leitung"].map((position) => `${id}:${position}`);
    if (!settings.permissions.pages[`dept:${id}`]) settings.permissions.pages[`dept:${id}`] = normalizePermissionRule({ roles: ["Direktion", "IT"], departments: [id] });
    if (!settings.permissions.actions[`departmentManage:${id}`]) settings.permissions.actions[`departmentManage:${id}`] = normalizePermissionRule({ roles: ["Direktion", "IT"] });
    if (!settings.permissions.actions[`departmentMembers:${id}`]) settings.permissions.actions[`departmentMembers:${id}`] = normalizePermissionRule({ positions: leaderPositions });
    if (!settings.permissions.actions[`departmentNotes:${id}`]) settings.permissions.actions[`departmentNotes:${id}`] = normalizePermissionRule({ positions: [...leaderPositions, `${id}:Mitglied`] });
    if (id === "human-resources" && !settings.permissions.actions.personnelFiles) settings.permissions.actions.personnelFiles = normalizePermissionRule({ roles: ["Direktion", "IT", "IT-Leitung"], departments: [id] });
    if (!settings.permissions.actions[`departmentInfo:${id}`]) settings.permissions.actions[`departmentInfo:${id}`] = normalizePermissionRule({ positions: leaderPositions });
    if (!settings.permissions.actions[`departmentLeadership:${id}`]) settings.permissions.actions[`departmentLeadership:${id}`] = normalizePermissionRule({ positions: leaderPositions });
    if (id === "training-recruitment") {
      if (!settings.permissions.actions[`departmentModuleGrant:${id}`]) settings.permissions.actions[`departmentModuleGrant:${id}`] = normalizePermissionRule({ positions: leaderPositions });
      if (!settings.permissions.actions[`departmentModuleRevoke:${id}`]) settings.permissions.actions[`departmentModuleRevoke:${id}`] = normalizePermissionRule({ positions: leaderPositions });
      if (!settings.permissions.actions[`departmentTrainingChecks:${id}`]) settings.permissions.actions[`departmentTrainingChecks:${id}`] = normalizePermissionRule({ roles: ["Direktion", "IT", "IT-Leitung"] });
    }
  });
}

const departmentPositions = ["Direktion", "Leitung", "Stv. Leitung", "Mitglied", "Anwärter"];
const DETECTIVE_DUTY_ERROR = "Nur Mitglieder vom Detective Bureau dürfen sich einstempeln.";
const positionPower = { "Direktion": 5, "Leitung": 4, "Stv. Leitung": 3, "Mitglied": 2, "Anwärter": 1 };
const trainingNames = ["EST", "Wissen", "Fahren", "Schießen", "Verhalten", "Undercover", "Wanted", "EL", "Officer Prüfung", "Prak. VHF", "Prak. EL I", "Führung", "Prak. EL II", "Air Support", "Riot", "Coquette"];
const swatTeams = ["A", "B", "C"];
const retiredDepartmentIds = new Set(["metro-taskforce"]);
const retiredDepartmentNamePattern = /metro[-\s]*taskforce/i;

function nowIso() {
  return new Date().toISOString();
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isRetiredDepartmentValue(value) {
  const text = String(value || "").trim();
  return [...retiredDepartmentIds].some((id) => text.toLowerCase().includes(id)) || retiredDepartmentNamePattern.test(text);
}

function isRetiredDepartmentObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && (isRetiredDepartmentValue(value.id) || isRetiredDepartmentValue(value.name) || isRetiredDepartmentValue(value.key) || isRetiredDepartmentValue(value.target));
}

function stripRetiredDepartmentReferences(value) {
  let changed = false;
  const walk = (item) => {
    if (Array.isArray(item)) {
      const next = [];
      item.forEach((entry) => {
        if (isRetiredDepartmentValue(entry) || isRetiredDepartmentObject(entry)) {
          changed = true;
          return;
        }
        next.push(walk(entry));
      });
      if (next.length !== item.length) changed = true;
      return next;
    }
    if (item && typeof item === "object") {
      Object.keys(item).forEach((key) => {
        if (isRetiredDepartmentValue(key) || isRetiredDepartmentValue(item[key]) || isRetiredDepartmentObject(item[key])) {
          delete item[key];
          changed = true;
          return;
        }
        item[key] = walk(item[key]);
      });
    }
    return item;
  };
  walk(value);
  return changed;
}

function actorName(actor) {
  return actor ?`${actor.firstName} ${actor.lastName}`.trim() : "System";
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function ensureStorage() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) return;

  const adminId = makeId("user");
  const createdAt = nowIso();
  const seed = {
    users: [
      {
        id: adminId,
        firstName: "Daniel",
        lastName: "Hebel-Jameson",
        phone: "0000",
        dn: "1",
        rank: 12,
        role: "IT-Leitung",
        baseRole: "Direktion",
        departments: [],
        trainings: Object.fromEntries(trainingNames.map((training) => [training, true])),
        joinedAt: todayIso(),
        lastPromotionAt: todayIso(),
        passwordHash: hashPassword(DEFAULT_PASSWORD),
        mustChangePassword: false,
        avatarUrl: "",
        locked: false,
        createdAt,
        updatedAt: createdAt
      }
    ],
    sessions: [],
    settings: {
      defcon: "DEFCON 3",
      defconUpdatedBy: "System",
      defconUpdatedAt: createdAt,
      ranks: defaultRanks(),
      navLabels: {},
      customPages: [],
      pageOrder: [],
      departments: defaultDepartments(),
      siteModeLabel: "Showcase Template",
      publicBaseUrl: "",
      informationText: "Hier können später zentrale Informationen für alle Officer gepflegt werden.",
      applicationStatus: "Offen",
      calendarEvents: [],
      seizures: [],
      changelog: [],
      backups: [],
      mailboxThreads: [],
      fluctuation: [],
      dnBlacklist: [],
      uprankRules: defaultUprankRules(),
      uprankAdjustments: [],
      sanctionCatalog: defaultSanctionCatalog(),
      permissions: defaultPermissions(),
      devMode: false,
      maintenanceMode: false,
      gibsonColaButtonEnabled: true,
      gibsonColaParty: {},
      customAnimation: normalizeCustomAnimation({}),
      hideDefconCard: false,
      hideInformationLinksCard: true,
      defaultPassword: DEFAULT_PASSWORD,
      discordSync: defaultDiscordSync(),
      restartTimes: [],
      restartLastRun: {}
    },
    notes: [],
    duty: [],
    dutyHistory: [],
    logs: [],
    disciplinary: []
  };

  fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2));
}

function readDb() {
  ensureStorage();
  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  if (!db.users.some((user) => user.role === "IT-Leitung")) {
    const firstItUser = db.users.find((user) => user.role === "IT");
    if (firstItUser) firstItUser.role = "IT-Leitung";
  }
  db.users.forEach((user) => {
    if (!user.baseRole) user.baseRole = ["Template", "IT", "IT-Leitung"].includes(user.role) ?"Direktion" : user.role || "User";
    user.discordId = typeof user.discordId === "string" ?user.discordId : "";
    user.activatedAt = String(user.activatedAt || "");
    user.notificationBaselineAt = String(user.notificationBaselineAt || user.activatedAt || "");
    user.changelogReadIds = Array.isArray(user.changelogReadIds) ?[...new Set(user.changelogReadIds.map(String).filter(Boolean))] : [];
    user.tutorialSkipped = Boolean(user.tutorialSkipped);
    if (typeof user.tutorialCompleted !== "boolean") user.tutorialCompleted = !user.mustChangePassword;
    user.twitchLogin = normalizeTwitchLogin(user.twitchLogin || "");
    user.twitchLive = normalizeTwitchLive(user.twitchLive);
    user.teamler = Boolean(user.teamler);
    user.trainingMeta = user.trainingMeta && typeof user.trainingMeta === "object" ?user.trainingMeta : {};
    if (user.trainings?.Schiessen && !user.trainings["Schießen"]) {
      user.trainings["Schießen"] = true;
      delete user.trainings.Schiessen;
    }
    user.trainings = { ...Object.fromEntries(trainingNames.map((training) => [training, false])), ...(user.trainings || {}) };
  });
  db.settings = db.settings || {};
  db.settings.siteModeLabel = String(db.settings.siteModeLabel || "Showcase Template").trim();
  db.settings.publicBaseUrl = String(db.settings.publicBaseUrl || "").trim();
  db.settings.ranks = Array.isArray(db.settings.ranks) && db.settings.ranks.length ?db.settings.ranks : defaultRanks();
  db.settings.navLabels = db.settings.navLabels || {};
  db.settings.customPages = Array.isArray(db.settings.customPages) ?db.settings.customPages : [];
  db.settings.pageOrder = Array.isArray(db.settings.pageOrder) ?db.settings.pageOrder : [];
  db.settings.departments = normalizeDepartments(db.settings.departments);
  db.settings.informationText = db.settings.informationText || "Hier können später zentrale Informationen für alle Officer gepflegt werden.";
  db.settings.applicationStatus = db.settings.applicationStatus || "Offen";
  if (typeof db.settings.defconText !== "string") db.settings.defconText = "Automatisch / Manuell aktualisierbar";
  db.settings.calendarEvents = normalizeCalendarEvents(db.settings.calendarEvents);
  db.settings.seizures = Array.isArray(db.settings.seizures) ?db.settings.seizures : [];
  db.settings.changelog = normalizeChangelog(db.settings.changelog);
  db.settings.backups = normalizeBackups(db.settings.backups);
  db.settings.mailboxThreads = normalizeMailboxThreads(db.settings.mailboxThreads);
  db.settings.dnBlacklist = normalizeDnBlacklist(db.settings.dnBlacklist);
  db.settings.uprankRules = normalizeUprankRules(db.settings.uprankRules);
  db.settings.uprankAdjustments = Array.isArray(db.settings.uprankAdjustments) ?db.settings.uprankAdjustments : [];
  db.settings.sanctionCatalog = normalizeSanctionCatalog(db.settings.sanctionCatalog);
  db.settings.permissions = normalizePermissions(db.settings.permissions);
  ensureDepartmentPermissionDefaults(db.settings);
  db.settings.devMode = Boolean(db.settings.devMode);
  db.settings.maintenanceMode = Boolean(db.settings.maintenanceMode);
  db.settings.gibsonColaButtonEnabled = db.settings.gibsonColaButtonEnabled !== false;
  db.settings.gibsonColaParty = db.settings.gibsonColaParty && typeof db.settings.gibsonColaParty === "object" ?db.settings.gibsonColaParty : {};
  db.settings.customAnimation = normalizeCustomAnimation(db.settings.customAnimation);
  db.settings.hideDefconCard = Boolean(db.settings.hideDefconCard);
  db.settings.hideInformationLinksCard = db.settings.hideInformationLinksCard !== false;
  db.settings.defaultPassword = String(db.settings.defaultPassword || DEFAULT_PASSWORD);
  db.settings.discordSync = normalizeDiscordSync(db.settings.discordSync);
  db.settings.twitchLivecheck = normalizeTwitchLivecheckConfig(db.settings.twitchLivecheck);
  db.settings.trainingModules = normalizeTrainingModuleSettings(db.settings.trainingModules);
  db.settings.onboardingTutorial = normalizeOnboardingTutorial(db.settings.onboardingTutorial);
  db.settings.restartTimes = Array.isArray(db.settings.restartTimes) ?db.settings.restartTimes : [];
  db.settings.restartLastRun = db.settings.restartLastRun && typeof db.settings.restartLastRun === "object" ?db.settings.restartLastRun : {};
  db.settings.informationRightsBriefText = String(db.settings.informationRightsBriefText || "Sie haben das Recht zu schweigen.\nSie haben ab 25 Hafteinheiten das Recht auf einen staatlich geprüften Anwalt.\nSie haben das Recht auf Selbstvertretung und Akteneinsicht.\nTeilen Sie mit, ob Sie Ihre Rechte verstanden haben.");
  db.settings.informationRightsText = String(db.settings.informationRightsText || "");
  db.settings.informationLinks = Array.isArray(db.settings.informationLinks) ?db.settings.informationLinks : [];
  db.settings.informationDocs = Array.isArray(db.settings.informationDocs) ?db.settings.informationDocs : [];
  db.settings.informationDocChanges = normalizeInformationDocChanges(db.settings.informationDocChanges);
  db.settings.informationPermits = Array.isArray(db.settings.informationPermits) ?db.settings.informationPermits : [];
  db.settings.informationFactions = Array.isArray(db.settings.informationFactions) ?db.settings.informationFactions : [];
  db.settings.fluctuation = Array.isArray(db.settings.fluctuation) ?db.settings.fluctuation : [];
  db.absences = normalizeAbsences(db.absences);
  db.dutyHistory = Array.isArray(db.dutyHistory) ?db.dutyHistory : [];
  db.logs = normalizeLogs(db.logs);
  db.disciplinary = Array.isArray(db.disciplinary) ?db.disciplinary : [];
  const existingUserIds = new Set(db.users.map((user) => user.id));
  db.disciplinary = db.disciplinary.filter((entry) => existingUserIds.has(entry.userId));
  db.users.forEach((user) => {
    if (!user.accountStatus) {
      const latestStatusEntry = db.disciplinary.find((entry) => entry.userId === user.id && ["Suspendierung", "Sperre", "Entsperrt", "Entlassen"].includes(entry.type));
      user.accountStatus = user.terminated ?"Entlassen" : latestStatusEntry?.type === "Suspendierung" ?"Suspendiert" : user.locked ?"Gesperrt" : "Aktiv";
    }
  });
  return db;
}

function normalizeDepartments(existingDepartments) {
  const defaults = defaultDepartments();
  const existing = (Array.isArray(existingDepartments) ?existingDepartments : [])
    .filter((department) => !isRetiredDepartmentObject(department))
    .map((department) => {
    const haystack = `${department?.id || ""} ${department?.name || ""}`.toLowerCase();
    if (/(human|humane|ressource|resource|hr)/i.test(haystack)) return { ...department, id: "human-resources", name: "Personalabteilung" };
    if (department?.id === "training-recruitment" || /training\s*\/\s*recruitment|^training$/i.test(String(department?.name || ""))) return { ...department, id: "training-recruitment", name: "Police Academy" };
    if (/^sherrif$|^sheriff$/i.test(String(department?.name || "")) || ["sherrif", "sheriff"].includes(String(department?.id || "").toLowerCase())) return { ...department, id: "sherrif", name: "Sherrif" };
    return department;
  });
  const normalizedDefaults = defaults.map((department) => {
    const stored = existing.find((item) => item.id === department.id || item.name === department.name);
    return {
      ...department,
      ...(stored || {}),
      rightsText: String(stored?.rightsText || department.rightsText || ""),
      links: Array.isArray(stored?.links) ?stored.links : department.links,
      permits: Array.isArray(stored?.permits) ?stored.permits : department.permits,
      factions: Array.isArray(stored?.factions) ?stored.factions : department.factions,
      docs: Array.isArray(stored?.docs) ?stored.docs : [],
      positions: normalizeDepartmentPositions(stored?.positions || department.positions),
      leaderPositions: normalizeDepartmentLeaderPositions(stored?.leaderPositions, stored?.positions || department.positions),
      positionColors: normalizeDepartmentPositionColors(stored?.positionColors, stored?.positions || department.positions),
      members: normalizeDepartmentMembers(Array.isArray(stored?.members) ?stored.members : department.members, department.id),
      notes: Array.isArray(stored?.notes) ?stored.notes : department.notes,
      memberNotes: Array.isArray(stored?.memberNotes) ?stored.memberNotes : department.memberNotes,
      swatStatus: department.id === "swat" ?normalizeSwatStatus(stored?.swatStatus) : {}
    };
  });
  const defaultIds = new Set(defaults.map((department) => department.id));
  const custom = existing
    .filter((department) => department?.id && !defaultIds.has(department.id) && !isRetiredDepartmentObject(department))
    .map((department) => ({
      ...makeDepartment(department.id, department.name || "Neue Abteilung", department.description || "Leeres Abteilungsblatt", department.applicationStatus || "Offen"),
      ...department,
      rightsText: String(department.rightsText || ""),
      links: Array.isArray(department.links) ?department.links : [],
      permits: Array.isArray(department.permits) ?department.permits : [],
      factions: Array.isArray(department.factions) ?department.factions : [],
      docs: Array.isArray(department.docs) ?department.docs : [],
      positions: normalizeDepartmentPositions(department.positions || departmentPositions),
      leaderPositions: normalizeDepartmentLeaderPositions(department.leaderPositions, department.positions || departmentPositions),
      positionColors: normalizeDepartmentPositionColors(department.positionColors, department.positions || departmentPositions),
      members: normalizeDepartmentMembers(Array.isArray(department.members) ?department.members : [], department.id),
      notes: Array.isArray(department.notes) ?department.notes : [],
      memberNotes: Array.isArray(department.memberNotes) ?department.memberNotes : [],
      swatStatus: department.id === "swat" ?normalizeSwatStatus(department.swatStatus) : {}
    }));
  return [...normalizedDefaults, ...custom];
}

function normalizeDepartmentMembers(members = [], departmentId = "") {
  return (Array.isArray(members) ?members : []).map((member) => ({
    ...member,
    swatTeam: departmentId === "swat" ?normalizeSwatTeam(member.swatTeam) : "",
    swatTeamLeader: departmentId === "swat" ?Boolean(member.swatTeamLeader) : false
  }));
}

function normalizeDepartmentPositions(value) {
  const incoming = Array.isArray(value) ?value.map((item) => String(item || "").trim()).filter(Boolean) : [];
  return incoming.length ?[...new Set(incoming)] : [...departmentPositions];
}

function normalizeDepartmentLeaderPositions(value, positionsValue = departmentPositions) {
  const positions = normalizeDepartmentPositions(positionsValue);
  const fallback = positions.filter((position) => ["Direktion", "Leitung", "Stv. Leitung"].includes(position));
  const incoming = Array.isArray(value) ?value.map((item) => String(item || "").trim()).filter((item) => positions.includes(item)) : fallback;
  return [...new Set(incoming.length ?incoming : fallback)];
}

function defaultPositionColor(position) {
  if (position === "Direktion" || position === "Anwärter") return "green";
  if (position === "Leitung") return "red";
  if (position === "Stv. Leitung") return "orange";
  if (position === "Mitglied") return "blue";
  return "blue";
}

function normalizeDepartmentPositionColors(value, positionsValue = departmentPositions) {
  const positions = normalizeDepartmentPositions(positionsValue);
  const source = value && typeof value === "object" ?value : {};
  return Object.fromEntries(positions.map((position) => {
    const color = String(source[position] || defaultPositionColor(position)).trim();
    return [position, ["green", "red", "orange", "blue"].includes(color) ?color : defaultPositionColor(position)];
  }));
}

function defaultDiscordSync() {
  const envConfigured = Boolean(process.env.DISCORD_APPLICATION_ID && process.env.DISCORD_SERVER_ID && process.env.DISCORD_BOT_TOKEN);
  return {
    enabled: envConfigured,
    applicationId: process.env.DISCORD_APPLICATION_ID || "",
    clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
    publicKey: process.env.DISCORD_PUBLIC_KEY || "",
    oauthRedirectUrl: process.env.DISCORD_OAUTH_REDIRECT_URL || discordCallbackUrl(),
    serverId: process.env.DISCORD_SERVER_ID || "",
    syncChannelId: process.env.DISCORD_SYNC_CHANNEL_ID || "",
    itChannelId: process.env.DISCORD_IT_CHANNEL_ID || "",
    inviteUrl: process.env.DISCORD_INVITE_URL || "",
    botToken: process.env.DISCORD_BOT_TOKEN || "",
    unsyncedRoleId: process.env.DISCORD_UNSYNCED_ROLE_ID || "",
    rankRoles: {},
    departmentRoles: {},
    importedRoles: []
  };
}

function normalizeDiscordRoleMap(value) {
  const source = value && typeof value === "object" ?value : {};
  return Object.fromEntries(Object.entries(source)
    .map(([key, roleIds]) => {
      const ids = Array.isArray(roleIds) ?roleIds : String(roleIds || "").split(",");
      return [String(key || "").trim(), [...new Set(ids.map((roleId) => String(roleId || "").trim()).filter(Boolean))]];
    })
    .filter(([key, roleIds]) => key && roleIds.length));
}

function normalizeDiscordImportedRoles(value) {
  const roles = Array.isArray(value) ?value : [];
  return roles
    .map((role) => ({
      id: String(role.id || "").trim(),
      name: String(role.name || "").trim(),
      color: Number(role.color || 0),
      position: Number(role.position || 0),
      managed: Boolean(role.managed)
    }))
    .filter((role) => role.id && role.name)
    .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name));
}

function normalizeDiscordSync(value) {
  const source = value && typeof value === "object" ?value : {};
  const envConfigured = Boolean(process.env.DISCORD_APPLICATION_ID && process.env.DISCORD_SERVER_ID && process.env.DISCORD_BOT_TOKEN);
  const rawOauthUrl = String(process.env.DISCORD_OAUTH_REDIRECT_URL || source.oauthRedirectUrl || "").trim();
  const oauthRedirectUrl = normalizeDiscordRedirectUrl(rawOauthUrl, PUBLIC_BASE_URL);
  return {
    enabled: Object.prototype.hasOwnProperty.call(source, "enabled") ?Boolean(source.enabled) : envConfigured,
    applicationId: String(source.applicationId || process.env.DISCORD_APPLICATION_ID || "").trim(),
    clientSecret: String(source.clientSecret || process.env.DISCORD_CLIENT_SECRET || "").trim(),
    publicKey: String(source.publicKey || process.env.DISCORD_PUBLIC_KEY || "").trim(),
    oauthRedirectUrl,
    serverId: String(source.serverId || process.env.DISCORD_SERVER_ID || "").trim(),
    syncChannelId: String(source.syncChannelId || process.env.DISCORD_SYNC_CHANNEL_ID || "").trim(),
    itChannelId: String(source.itChannelId || process.env.DISCORD_IT_CHANNEL_ID || "").trim(),
    inviteUrl: String(source.inviteUrl || process.env.DISCORD_INVITE_URL || "").trim(),
    botToken: String(source.botToken || process.env.DISCORD_BOT_TOKEN || "").trim(),
    unsyncedRoleId: String(source.unsyncedRoleId || process.env.DISCORD_UNSYNCED_ROLE_ID || "").trim(),
    rankRoles: normalizeDiscordRoleMap(source.rankRoles),
    roleRoles: normalizeDiscordRoleMap(source.roleRoles),
    departmentRoles: normalizeDiscordRoleMap(source.departmentRoles),
    importedRoles: normalizeDiscordImportedRoles(source.importedRoles)
  };
}

function publicDiscordSync(value) {
  const sync = normalizeDiscordSync(value);
  return {
    ...sync,
    clientSecret: "",
    clientSecretSet: Boolean(sync.clientSecret),
    botToken: "",
    botTokenSet: Boolean(sync.botToken)
  };
}

function normalizeCustomAnimation(value) {
  const source = value && typeof value === "object" ?value : {};
  const items = Array.isArray(source.items) ?source.items : [];
  return {
    title: String(source.title || "Dienstblatt Animation").trim(),
    durationMs: Math.min(10000, Math.max(1000, Number(source.durationMs || 6000))),
    assetDataUrl: String(source.assetDataUrl || "").trim(),
    assetUrl: String(source.assetUrl || "").trim(),
    mimeType: String(source.mimeType || "").trim(),
    fileName: String(source.fileName || "").trim(),
    items: items.map((item) => ({
      id: String(item.id || makeId("anim")),
      title: String(item.title || "Animation").trim().slice(0, 80) || "Animation",
      durationMs: Math.min(10000, Math.max(1000, Number(item.durationMs || 6000))),
      assetDataUrl: String(item.assetDataUrl || "").trim(),
      assetUrl: String(item.assetUrl || "").trim(),
      mimeType: String(item.mimeType || "").trim(),
      fileName: String(item.fileName || "").trim(),
      createdAt: String(item.createdAt || nowIso())
    })).filter((item) => item.assetDataUrl || item.assetUrl).slice(0, 20),
    event: source.event && typeof source.event === "object" ?source.event : {}
  };
}

function publicCustomAnimation(value) {
  const animation = normalizeCustomAnimation(value);
  return {
    title: animation.title,
    durationMs: animation.durationMs,
    fileName: animation.fileName,
    mimeType: animation.mimeType,
    assetUrl: animation.assetUrl,
    assetType: animation.assetDataUrl ? "upload" : animation.assetUrl ? "url" : "",
    hasAsset: Boolean(animation.assetDataUrl || animation.assetUrl),
    items: animation.items.map((item) => ({
      id: item.id,
      title: item.title,
      durationMs: item.durationMs,
      fileName: item.fileName,
      mimeType: item.mimeType,
      assetUrl: item.assetUrl,
      assetType: item.assetDataUrl ? "upload" : item.assetUrl ? "url" : "",
      createdAt: item.createdAt
    })),
    event: animation.event?.id ?{
      id: animation.event.id,
      triggeredAt: animation.event.triggeredAt,
    triggeredByName: animation.event.triggeredByName,
    title: animation.event.title || animation.title,
    durationMs: animation.event.durationMs || animation.durationMs,
    assetType: animation.assetDataUrl ? "upload" : animation.assetUrl ? "url" : ""
  } : {}
  };
}

function normalizeSwatTeam(value, fallback = "") {
  const team = String(value || "").trim().toUpperCase().replace(/^TEAM\s+/, "");
  return swatTeams.includes(team) ?team : fallback;
}

function isSwatDepartment(department) {
  return String(department?.id || "").toLowerCase() === "swat";
}

function swatMembershipFor(department, userId) {
  if (!isSwatDepartment(department)) return null;
  return (department.members || []).find((member) => member.userId === userId) || null;
}

function isSwatTeamLeaderMember(member) {
  return Boolean(member?.swatTeamLeader || member?.position === "Abteilungsleiter");
}

function canViewSwatTeamContent(user, department, team, db = null) {
  if (!isSwatDepartment(department)) return true;
  const resolvedTeam = normalizeSwatTeam(team);
  if (user?.role === "Template") return true;
  if ((rolePower[user.role] || 0) >= rolePower.Direktion) return true;
  if (db && hasPermission(user, db, "actions", `departmentMembers:${department.id}`, "IT")) return true;
  const membership = swatMembershipFor(department, user.id);
  if (!resolvedTeam || team === "all") return Boolean(normalizeSwatTeam(membership?.swatTeam));
  return normalizeSwatTeam(membership?.swatTeam) === resolvedTeam;
}

function normalizeSwatStatus(value) {
  const source = value && typeof value === "object" ?value : {};
  return Object.fromEntries(swatTeams.map((team) => {
    const item = source[team] && typeof source[team] === "object" ?source[team] : {};
    return [team, {
      active: Boolean(item.active),
      calledAt: String(item.calledAt || ""),
      calledById: String(item.calledById || ""),
      calledByName: String(item.calledByName || "")
    }];
  }));
}

function publicDiscordFullSyncStatus() {
  return {
    ...discordFullSyncStatus,
    failedAccounts: (discordFullSyncStatus.failedAccounts || []).slice(0, 50)
  };
}

function departmentPositionsFor(department) {
  if (isSwatDepartment(department)) return ["Abteilungsleiter", "Mitglied"];
  return normalizeDepartmentPositions(department?.positions || departmentPositions);
}

function departmentLeaderPositionsFor(department) {
  if (isSwatDepartment(department)) return ["Abteilungsleiter"];
  return normalizeDepartmentLeaderPositions(department?.leaderPositions, department?.positions || departmentPositions);
}

function isDepartmentLeaderPosition(department, position) {
  return departmentLeaderPositionsFor(department).includes(position);
}

function positionPowerFor(department, position) {
  const positions = departmentPositionsFor(department);
  const index = positions.indexOf(position);
  if (index === -1) return 0;
  return positions.length - index;
}

function normalizeUprankRules(existingRules) {
  const existing = Array.isArray(existingRules) ?existingRules : [];
  const defaults = defaultUprankRules();
  return defaults.map((rule) => {
    const stored = existing.find((item) => Number(item.targetRank) === Number(rule.targetRank));
    const trainings = Array.isArray(stored?.trainings) ?stored.trainings.filter((training) => trainingNames.includes(training)) : rule.trainings;
    return {
      targetRank: rule.targetRank,
      minDays: Math.max(0, Number.parseInt(stored?.minDays ?? rule.minDays, 10) || 0),
      trainings,
      specialOnly: Boolean(stored?.specialOnly ?? rule.specialOnly)
    };
  });
}

function writeDb(db) {
  db.logs = normalizeLogs(db.logs);
  db.settings = db.settings || {};
  db.settings.calendarEvents = normalizeCalendarEvents(db.settings.calendarEvents);
  db.settings.informationDocChanges = normalizeInformationDocChanges(db.settings.informationDocChanges);
  persistStoredBackupPayloads(db);
  fs.writeFileSync(DB_FILE, JSON.stringify(db));
}

function defaultSanctionCatalog() {
  const entry = (category, code, title, fineText = "", action = "") => {
    const warning = /verwarnung/i.test(action);
    const fineAmount = Number(String(fineText).replace(/\./g, "").match(/\d+/)?.[0] || 0);
    return {
      id: makeId("sanction_template"),
      category,
      code,
      title,
      details: `${code} - ${title}${fineText ?`\nStrafrahmen: ${fineText}` : ""}${action ?`\nMaßnahme: ${action}` : ""}`,
      fineText,
      action,
      sanctionType: warning ?"Strike" : fineAmount ?"Geldstrafe" : "Custom",
      amount: fineAmount,
      strikeCount: warning ?1 : 0,
      uprankBlockDays: 0
    };
  };
  return [
    entry("§1 Allgemeiner Polizeidienst", "§1 Abs. 1", "Nicht Nachkommen des Polizeidienstes", "$1.000 - $3.000"),
    entry("§1 Allgemeiner Polizeidienst", "§1 Abs. 2", "Nicht erreichbar im Dienst (Handy / Funk / Persönlich)", "$250 - $1.000"),
    entry("§1 Allgemeiner Polizeidienst", "§1 Abs. 3", "Nicht Vorzeigen des Dienstausweises / der Dienstnummer auf Nachfrage", "$1.000 - $5.000", "Verwarnung"),
    entry("§1 Allgemeiner Polizeidienst", "§1 Abs. 4", "Unpassendes Verhalten", "$1.000 - $5.000", "Verwarnung"),
    entry("§1 Allgemeiner Polizeidienst", "§1 Abs. 5", "Respektloses Verhalten im Dienst", "$1.000 - $3.000", "Verwarnung"),
    entry("§1 Allgemeiner Polizeidienst", "§1 Abs. 6", "Fahrlässiges Verhalten", "$1.000 - $3.000", "Verwarnung"),
    entry("§1 Allgemeiner Polizeidienst", "§1 Abs. 7", "Fehlverhalten im Einsatz", "$1.000 - $5.000", "Verwarnung"),
    entry("§1 Allgemeiner Polizeidienst", "§1 Abs. 8", "Fehlende Funkdisziplin", "$500 - $2.000", "Verwarnung"),
    entry("§1 Allgemeiner Polizeidienst", "§1 Abs. 9", "Nicht einhalten der Dienstvorschriften/Anweisungen", "$3.000 - Kündigung", "Verwarnung"),
    entry("§1 Allgemeiner Polizeidienst", "§1 Abs. 10", "Nicht Einhalten der Suspendierung", "", "Kündigung"),
    entry("§1 Allgemeiner Polizeidienst", "§1 Abs. 11", "Falsches ausfüllen eines Formulares/Akte", "$5.000 - $10.000"),
    entry("§1 Allgemeiner Polizeidienst", "§1 Abs. 12", "Auslösen des Panicbuttons ohne Grund", "$5.000"),
    entry("§1 Allgemeiner Polizeidienst", "§1 Abs. 13", "Auslösen des Panicbuttons ohne Grund + Medics nicht bescheidgegeben", "$8.000"),
    entry("§1 Allgemeiner Polizeidienst", "§1 Abs. 14", "Bodycam nicht eingeschaltet", "$3.000"),
    entry("§1 Allgemeiner Polizeidienst", "§1 Abs. 15", "Flugzeugträger anfliegen ohne Berechtigung", "$10.000"),
    entry("§2 Kleider- und Ausrüstungsordnung / Equipment", "§2 Abs. 1", "Nicht Einhalten der Kleiderordnung", "$1.000 - $3.000"),
    entry("§2 Kleider- und Ausrüstungsordnung / Equipment", "§2 Abs. 2", "Tragen der Dienstkleidung eines höheren Ranges", "$1.000 - $4.000", "Verwarnung"),
    entry("§2 Kleider- und Ausrüstungsordnung / Equipment", "§2 Abs. 3", "Tragen der Dienstkleidung eines niedrigeren Ranges", "$1.000 - $3.000", "Verwarnung"),
    entry("§2 Kleider- und Ausrüstungsordnung / Equipment", "§2 Abs. 4", "Mitführen von Dienstwaffen außerhalb des Dienstes", "$5.000", "Verwarnung"),
    entry("§2 Kleider- und Ausrüstungsordnung / Equipment", "§2 Abs. 5", "Mitführen von Privatausrüstung innerhalb des Dienstes"),
    entry("§2 Kleider- und Ausrüstungsordnung / Equipment", "§2 Abs. 6", "Unvollständige Dienstausrüstung", "$1.000 - $5.000", "Verwarnung"),
    entry("§2 Kleider- und Ausrüstungsordnung / Equipment", "§2 Abs. 7", "Führen von Ausrüstung ohne Freigabe", "$5.000 - $30.000", "Verwarnung"),
    entry("§2 Kleider- und Ausrüstungsordnung / Equipment", "§2 Abs. 8", "Unberechtigter Gebrauch von letalen Waffen", "$1.000 - $5.000", "Verwarnung"),
    entry("§2 Kleider- und Ausrüstungsordnung / Equipment", "§2 Abs. 9", "Unberechtigter Gebrauch von non-letalen Waffen", "$1.000 - $4.000", "Verwarnung"),
    entry("§3 Geheimhaltung", "§3 Abs. 1", "Herausgabe von internen Informationen", "5.000€ - 10.000€", "Strafverfolgung"),
    entry("§3 Geheimhaltung", "§3 Abs. 2", "Herausgabe von sensiblen internen Informationen", "10.000€ - 20.000€", "Strafverfolgung"),
    entry("§4 Befehlskette sowie allgemeines Auftreten", "§4 Abs. 1", "Anstiftung zum Fehlverhalten im Dienst", "$1.000 - $5.000", "Verwarnung"),
    entry("§4 Befehlskette sowie allgemeines Auftreten", "§4 Abs. 2", "Respektloses Verhalten gegenüber anderen Institutionen", "$1.000 - $5.000", "Verwarnung"),
    entry("§4 Befehlskette sowie allgemeines Auftreten", "§4 Abs. 3", "Respektloses Verhalten gegenüber Vorgesetzten", "$2.000 - $5.000", "Verwarnung"),
    entry("§4 Befehlskette sowie allgemeines Auftreten", "§4 Abs. 4", "Respektloses Verhalten gegenüber Außenstehenden", "$1.000 - $5.000", "Verwarnung"),
    entry("§4 Befehlskette sowie allgemeines Auftreten", "§4 Abs. 5", "Respektloses Verhalten gegenüber Kollegen", "$1.000 - $5.000", "Verwarnung"),
    entry("§4 Befehlskette sowie allgemeines Auftreten", "§4 Abs. 6", "Befehlsverweigerung", "$2.000 - $10.000", "Kündigung"),
    entry("§5 Fahrzeuge / Flugzeuge", "§5 Abs. 1", "Führen eines Fahr-/Flugzeuges ohne Freigabe/Schulung", "$2.000 - $10.000", "Verwarnung"),
    entry("§5 Fahrzeuge / Flugzeuge", "§5 Abs. 2", "Führen von Privatfahr-/flugzeugen im Dienst", "$3.000", "Verwarnung"),
    entry("§5 Fahrzeuge / Flugzeuge", "§5 Abs. 3", "Unberechtigte Nutzung von Sondersignalen", "$1.000 - $5.000"),
    entry("§5 Fahrzeuge / Flugzeuge", "§5 Abs. 4", "Fehlende Ausrüstung im Fahrzeug", "$1.000 - $5.000"),
    entry("§5 Fahrzeuge / Flugzeuge", "§5 Abs. 5", "Nicht einhalten der STVO", "$1.000 - $5.000"),
    entry("§5 Fahrzeuge / Flugzeuge", "§5 Abs. 6", "Ungerechtfertigtes / übermäßiges absichtliches Pitten", "$1.500", "Verwarnung"),
    entry("§5 Fahrzeuge / Flugzeuge", "§5 Abs. 7", "Fahrzeug nicht abgeschlossen", "$250", "Verwarnung"),
    entry("§6 SWAT", "§6 Abs. 1", "Mitglied zurückgelassen", "", "Verwarnung"),
    entry("§6 SWAT", "§6 Abs. 2", "Befehlsverweigerung", "", "Verwarnung"),
    entry("§6 SWAT", "§6 Abs. 3", "Offenlegung vertraulicher Daten", "", "Strafverfolgung"),
    entry("§6 SWAT", "§6 Abs. 4", "Nicht Einhalten der Kleiderordnung", "", "Verwarnung"),
    entry("§6 SWAT", "§6 Abs. 5", "Nicht Einhalten der Ausrüstungsordnung", "", "Verwarnung"),
    entry("§6 SWAT", "§6 Abs. 6", "Mutwillige Präsentation von Ausrüstung", "", "Verwarnung"),
    entry("§6 SWAT", "§6 Abs. 7", "Kommunikation mit Außenstehenden ohne Grund", "", "Verwarnung"),
    entry("§6 SWAT", "§6 Abs. 8", "Verspätet nach Ausrufung des SWATs erschienen")
  ];
}

function normalizeSanctionCatalog(value) {
  const oldDefaultTitles = new Set(["Respektloses Verhalten", "Dienstpflicht verletzt", "Unangemessene Fahrweise"]);
  const isOldDefault = Array.isArray(value) && value.length <= 3 && value.every((item) => oldDefaultTitles.has(String(item?.title || "")));
  const source = Array.isArray(value) && value.length && !isOldDefault ?value : defaultSanctionCatalog();
  return source.map((item) => {
    const fineText = String(item.fineText || "").trim();
    const action = String(item.action || "").trim();
    const warning = /verwarnung/i.test(action);
    const parsedFineAmount = Number(fineText.replace(/\./g, "").match(/\d+/)?.[0] || 0);
    return {
      id: String(item.id || makeId("sanction_template")),
      category: String(item.category || "Allgemein").trim(),
      code: String(item.code || "").trim(),
      title: String(item.title || "Sanktion").trim(),
      details: String(item.details || item.reason || "").trim(),
      fineText,
      action,
      sanctionType: warning ?"Strike" : ["Geldstrafe", "Strike", "Custom"].includes(item.sanctionType) ?item.sanctionType : "Geldstrafe",
      amount: Math.max(0, Number(item.amount || item.base || parsedFineAmount || 0)),
      strikeCount: warning ?1 : Math.max(0, Math.min(3, Number(item.strikeCount || 0))),
      uprankBlockDays: Math.max(0, Number(item.uprankBlockDays || 0))
    };
  }).filter((item) => item.title);
}

function truncateText(value, maxLength = MAX_INFORMATION_CHANGE_TEXT) {
  const text = String(value || "");
  return text.length > maxLength ?`${text.slice(0, maxLength)}\n[... gekürzt: ${text.length - maxLength} Zeichen ...]` : text;
}

function normalizeInformationDocChanges(value) {
  return (Array.isArray(value) ?value : [])
    .slice(0, MAX_INFORMATION_CHANGES)
    .map((item) => ({
      id: String(item.id || makeId("docchange")),
      docId: String(item.docId || ""),
      title: String(item.title || "").trim(),
      before: truncateText(item.before || ""),
      after: truncateText(item.after || ""),
      action: String(item.action || "geändert"),
      createdAt: String(item.createdAt || new Date().toISOString()),
      author: String(item.author || ""),
      acknowledgedBy: Array.isArray(item.acknowledgedBy) ?item.acknowledgedBy.map(String) : [],
      deletedBy: Array.isArray(item.deletedBy) ?item.deletedBy.map(String) : [],
      highlightClearedAt: String(item.highlightClearedAt || ""),
      highlightClearedBy: String(item.highlightClearedBy || "")
    }));
}

function sanitizeLogDetails(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === "string") {
    if (/^data:image\//i.test(value)) return `[Bilddaten entfernt, ${value.length} Zeichen]`;
    return value.length > 800 ?`${value.slice(0, 800)} [... gekürzt]` : value;
  }
  if (typeof value !== "object") return value;
  if (depth >= 3) return "[Objekt gekürzt]";
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => sanitizeLogDetails(item, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => {
    if (["informationDocs", "informationDocChanges", "backups", "mailboxThreads"].includes(key)) return [key, `[${Array.isArray(item) ?item.length : 0} Einträge]`];
    if (["body", "before", "after", "data", "dataUrl", "avatarUrl"].includes(key)) return [key, sanitizeLogDetails(item, depth + 1)];
    return [key, sanitizeLogDetails(item, depth + 1)];
  }));
}

function normalizeLogs(value) {
  return (Array.isArray(value) ?value : []).slice(0, MAX_LOG_ENTRIES).map((log) => ({
    ...log,
    details: sanitizeLogDetails(log.details || {})
  }));
}

function normalizeBackups(value) {
  return Array.isArray(value) ?value.map((backup) => ({
    id: String(backup.id || makeId("backup")),
    type: backup.type === "Manuell" ?"Manuell" : "Automatisch",
    createdAt: String(backup.createdAt || nowIso()),
    createdBy: String(backup.createdBy || ""),
    createdByName: String(backup.createdByName || "System").trim() || "System",
    changesSinceLast: Math.max(0, Number.parseInt(backup.changesSinceLast, 10) || 0),
    sizeBytes: Math.max(0, Number.parseInt(backup.sizeBytes, 10) || 0),
    dataFile: String(backup.dataFile || "").trim(),
    data: backup.data && typeof backup.data === "object" ?backup.data : null
  })).filter((backup) => backup.data || backup.dataFile) : [];
}

function publicBackup(backup) {
  const { data, dataFile, ...safeBackup } = backup;
  return safeBackup;
}

function backupDataFile(backup) {
  const id = String(backup?.id || makeId("backup")).replace(/[^a-z0-9_-]/gi, "");
  return path.join(BACKUP_DIR, `${id}.json`);
}

function backupDataFileFromRecord(backup) {
  if (!backup?.dataFile) return backupDataFile(backup);
  const file = path.resolve(STORAGE_DIR, backup.dataFile);
  const backupRoot = path.resolve(BACKUP_DIR);
  if (file !== backupRoot && !file.startsWith(`${backupRoot}${path.sep}`)) throw new Error("Backup-Pfad ungültig.");
  return file;
}

function readBackupPayload(backup) {
  if (backup?.data && typeof backup.data === "object") return backup.data;
  const file = backupDataFileFromRecord(backup);
  if (!fs.existsSync(file)) throw new Error("Backup-Datei nicht gefunden.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function persistStoredBackupPayloads(db) {
  const backups = normalizeBackups(db.settings?.backups);
  if (!backups.length) {
    db.settings.backups = [];
    return;
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  db.settings.backups = backups.map((backup) => {
    if (!backup.data || typeof backup.data !== "object") return backup;
    const file = backupDataFile(backup);
    fs.writeFileSync(file, JSON.stringify(backup.data));
    const { data, ...metadata } = backup;
    return { ...metadata, dataFile: path.relative(STORAGE_DIR, file) };
  });
}

function backupSnapshot(db) {
  const snapshot = JSON.parse(JSON.stringify(db));
  snapshot.sessions = [];
  snapshot.settings = snapshot.settings || {};
  snapshot.settings.backups = normalizeBackups(db.settings?.backups).map(publicBackup);
  return snapshot;
}

function backupFilename(backup) {
  const stamp = String(backup.createdAt || nowIso()).replace(/[:.]/g, "-");
  return `lspd-dienstblatt-backup-${stamp}.json`;
}

function backupChangeCountSince(db, previousBackup, createdAt = nowIso()) {
  const logs = Array.isArray(db.logs) ?db.logs : [];
  const since = previousBackup?.createdAt || "";
  return logs.filter((log) => {
    const logTime = String(log.createdAt || "");
    return logTime && (!since || logTime > since) && logTime <= createdAt;
  }).length;
}

function createStoredBackup(db, actor = null, type = "Automatisch") {
  db.settings = db.settings || {};
  db.settings.backups = normalizeBackups(db.settings.backups);
  const createdAt = nowIso();
  const previousBackup = db.settings.backups
    .filter((backup) => backup.createdAt < createdAt)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const data = backupSnapshot(db);
  const backup = {
    id: makeId("backup"),
    type: type === "Manuell" ?"Manuell" : "Automatisch",
    createdAt,
    createdBy: actor?.id || "",
    createdByName: actorName(actor),
    changesSinceLast: backupChangeCountSince(db, previousBackup, createdAt),
    sizeBytes: Buffer.byteLength(JSON.stringify(data), "utf8"),
    data
  };
  db.settings.backups = normalizeBackups([backup, ...db.settings.backups])
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return backup;
}

function buildImportedDb(imported) {
  if (!imported || typeof imported !== "object") return { error: "Keine gültige JSON-Datei empfangen." };
  if (!Array.isArray(imported.users) || !imported.settings || typeof imported.settings !== "object") {
    return { error: "Die Datei ist keine gültige Dienstblatt-Datensicherung." };
  }
  if (!imported.users.length) return { error: "Die Datensicherung enthält keine Benutzer." };
  return {
    db: {
      ...imported,
      users: imported.users,
      sessions: [],
      settings: imported.settings,
      notes: Array.isArray(imported.notes) ?imported.notes : [],
      duty: Array.isArray(imported.duty) ?imported.duty : [],
      dutyHistory: Array.isArray(imported.dutyHistory) ?imported.dutyHistory : [],
      logs: Array.isArray(imported.logs) ?imported.logs : [],
      disciplinary: Array.isArray(imported.disciplinary) ?imported.disciplinary : []
    }
  };
}

function normalizeMailboxThreads(value) {
  return Array.isArray(value) ?value.map((thread) => ({
    id: String(thread.id || makeId("mail")),
    title: String(thread.title || "").trim() || "Neue Nachricht",
    participantIds: [...new Set(Array.isArray(thread.participantIds) ?thread.participantIds.map(String).filter(Boolean) : [])],
    leaderIds: [...new Set(Array.isArray(thread.leaderIds) ?thread.leaderIds.map(String).filter(Boolean) : [thread.createdBy].filter(Boolean).map(String))],
    createdBy: String(thread.createdBy || ""),
    createdAt: String(thread.createdAt || nowIso()),
    updatedAt: String(thread.updatedAt || thread.createdAt || nowIso()),
    readBy: thread.readBy && typeof thread.readBy === "object" ?thread.readBy : {},
    archivedBy: thread.archivedBy && typeof thread.archivedBy === "object" ?thread.archivedBy : {},
    deletedBy: thread.deletedBy && typeof thread.deletedBy === "object" ?thread.deletedBy : {},
    removedBy: thread.removedBy && typeof thread.removedBy === "object" ?thread.removedBy : {},
    messages: Array.isArray(thread.messages) ?thread.messages.map((message) => ({
      id: String(message.id || makeId("msg")),
      senderId: String(message.senderId || ""),
      body: String(message.body || "").trim(),
      createdAt: String(message.createdAt || nowIso()),
      attachments: normalizeMailboxAttachments(message.attachments)
    })).filter((message) => message.body || message.attachments.length) : []
  })).filter((thread) => thread.participantIds.length && thread.messages.length) : [];
}

function normalizeMailboxAttachments(value) {
  return Array.isArray(value) ?value.map((attachment) => ({
    id: String(attachment.id || makeId("att")),
    type: String(attachment.type || "image"),
    name: String(attachment.name || "Bild").slice(0, 120),
    dataUrl: String(attachment.dataUrl || "")
  })).filter((attachment) => attachment.type === "image" && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(attachment.dataUrl) && attachment.dataUrl.length <= 4_000_000) : [];
}

function normalizeCalendarEvents(value) {
  return Array.isArray(value) ?value.map((event) => {
    const recurrence = String(event.recurrence || event.repeat || "none").toLowerCase() === "weekly" ? "weekly" : "none";
    return {
      id: String(event.id || makeId("calendar")),
      title: String(event.title || "").trim(),
      description: String(event.description || "").trim(),
      startDate: String(event.startDate || "").trim(),
      startTime: String(event.startTime || "").trim(),
      endDate: String(event.endDate || event.startDate || "").trim(),
      endTime: String(event.endTime || "").trim(),
      type: String(event.type || "Allgemein").trim(),
      color: String(event.color || "Blau").trim(),
      location: String(event.location || "").trim(),
      reminder: String(event.reminder || "30 Minuten").trim(),
      allDay: Boolean(event.allDay),
      recurrence,
      cancelledDates: Array.isArray(event.cancelledDates) ?[...new Set(event.cancelledDates.map((date) => String(date || "").trim()).filter(Boolean))] : [],
      authorName: String(event.authorName || "").trim(),
      createdAt: String(event.createdAt || nowIso()),
      updatedAt: String(event.updatedAt || "")
    };
  }).filter((event) => event.title && event.startDate) : [];
}

function normalizeChangelog(value) {
  const normalizeType = (type) => {
    if (["Verbesserung / Anpassung", "Erweiterung"].includes(type)) return "Verbesserung / Anpassung";
    if (["Bug Fixes", "Fehler behoben"].includes(type)) return "Bug Fixes";
    return "Verbesserung / Anpassung";
  };
  return Array.isArray(value) ?value.map((entry) => ({
    id: String(entry.id || makeId("changelog")),
    version: String(entry.version || "0.0.1").trim() || "0.0.1",
    type: normalizeType(entry.type),
    title: String(entry.title || "").trim(),
    body: String(entry.body || "").trim(),
    authorId: String(entry.authorId || ""),
    authorName: String(entry.authorName || "").trim(),
    authorRole: String(entry.authorRole || "").trim(),
    createdAt: String(entry.createdAt || nowIso()),
    updatedAt: String(entry.updatedAt || ""),
    updatedBy: String(entry.updatedBy || "").trim()
  })).filter((entry) => entry.body) : [];
}

function nextChangelogVersion(entries = []) {
  const maxPatch = entries.reduce((max, entry) => {
    const match = String(entry.version || "").match(/^0\.0\.(\d+)$/);
    return match ?Math.max(max, Number(match[1])) : max;
  }, 0);
  return `0.0.${maxPatch + 1}`;
}

function changelogTitle(date = new Date()) {
  const day = date.toLocaleDateString("de-DE");
  return `Changelog ${day}`;
}

function normalizeAbsences(value) {
  return Array.isArray(value) ?value.map((absence) => ({
    id: String(absence.id || makeId("absence")),
    userId: String(absence.userId || ""),
    startDate: String(absence.startDate || "").slice(0, 10),
    endDate: String(absence.endDate || "").slice(0, 10),
    reason: String(absence.reason || "").trim(),
    createdAt: String(absence.createdAt || nowIso()),
    createdBy: String(absence.createdBy || absence.userId || ""),
    endedAt: String(absence.endedAt || ""),
    endedBy: String(absence.endedBy || ""),
    endReason: String(absence.endReason || "").trim()
  })).filter((absence) => absence.userId && absence.startDate && absence.endDate && absence.reason) : [];
}

function isAbsenceActive(absence, date = todayIso()) {
  return absence && !absence.endedAt && absence.startDate <= date && absence.endDate >= date;
}

function activeAbsenceForUser(db, userId) {
  return (db.absences || []).find((absence) => absence.userId === userId && isAbsenceActive(absence));
}

function publicAbsence(db, absence) {
  const user = db.users.find((item) => item.id === absence.userId);
  const endedBy = absence.endedBy ?db.users.find((item) => item.id === absence.endedBy) : null;
  return {
    ...absence,
    active: isAbsenceActive(absence),
    user: publicUser(user),
    endedByUser: publicUser(endedBy)
  };
}

function publicDisciplinaryEntry(entry, viewer) {
  if (!entry?.internal || viewer?.role === "Direktion") return entry;
  return { ...entry, reason: "Direktionsinterner Grund", internalHidden: true };
}

function dbLiveRevision() {
  try {
    ensureStorage();
    const stats = fs.statSync(DB_FILE);
    return `${Math.trunc(stats.mtimeMs)}:${stats.size}`;
  } catch {
    return "0:0";
  }
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safeUser } = user;
  return {
    ...safeUser,
    avatarUrl: user.avatarUrl || "",
    fullName: `${user.firstName} ${user.lastName}`.trim()
  };
}

function notificationBaselineAt(user) {
  return String(user?.notificationBaselineAt || user?.activatedAt || "");
}

function isAfterNotificationBaseline(value, user) {
  const baseline = Date.parse(notificationBaselineAt(user));
  if (!Number.isFinite(baseline)) return true;
  const time = Date.parse(value || "");
  return Number.isFinite(time) && time >= baseline;
}

function effectiveMailboxReadAt(lastReadAt, user) {
  const baseline = Date.parse(notificationBaselineAt(user));
  const readAt = Date.parse(lastReadAt || "");
  const times = [baseline, readAt].filter(Number.isFinite);
  return times.length ?new Date(Math.max(...times)).toISOString() : "";
}

function normalizeTwitchLogin(value = "") {
  const raw = String(value || "").trim();
  const fromUrl = raw.match(/(?:https?:\/\/)?(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]{3,25})/i)?.[1] || raw;
  return fromUrl.replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 25);
}

function normalizeTwitchLive(value = {}) {
  return {
    live: Boolean(value?.live),
    title: String(value?.title || ""),
    url: String(value?.url || ""),
    checkedAt: String(value?.checkedAt || ""),
    matched: Boolean(value?.matched)
  };
}

function twitchTitleMatchesDienstblatt(title = "") {
  return /\bfirma\s*(?:rp|roleplay)?\b/i.test(String(title || ""));
}

function liveRevision() {
  return `${dbLiveRevision()}:${clientRefreshRevision}:${informationEditLocksRevision}`;
}

function clientAssetVersion() {
  return encodeURIComponent((clientRefreshRevision || dbLiveRevision() || "initial").replace(/[^a-zA-Z0-9._-]/g, "-"));
}

function sendIndexHtml(res) {
  const version = clientAssetVersion();
  const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8")
    .replace(/\/styles\.css\?v=[^"]+/g, `/styles.css?v=${version}`)
    .replace(/\/app\.js\?v=[^"]+/g, `/app.js?v=${version}`);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.send(html);
}

function activeInformationEditLocks(locks = Array.from(informationEditLocks.values())) {
  const now = Date.now();
  return (Array.isArray(locks) ?locks : [])
    .map((lock) => ({
      key: String(lock.key || ""),
      label: String(lock.label || ""),
      userId: String(lock.userId || ""),
      userName: String(lock.userName || ""),
      updatedAt: String(lock.updatedAt || "")
    }))
    .filter((lock) => lock.key && lock.userId && lock.updatedAt && now - new Date(lock.updatedAt).getTime() < INFORMATION_EDIT_LOCK_TTL_MS);
}

function publicInformationEditLocks() {
  const locks = activeInformationEditLocks();
  informationEditLocks.clear();
  locks.forEach((lock) => informationEditLocks.set(lock.key, lock));
  return locks;
}

function publicSettings(settings) {
  const { defaultPassword, discordSync, twitchLivecheck, mailboxThreads, backups, customAnimation, informationEditLocks: _storedInformationEditLocks, ...safeSettings } = settings || {};
  return {
    ...safeSettings,
    customAnimation: publicCustomAnimation(customAnimation),
    informationEditLocks: publicInformationEditLocks(),
    backups: normalizeBackups(backups).map(publicBackup),
    discordSync: publicDiscordSync(discordSync)
  };
}

function publicMailboxThread(db, thread, currentUser) {
  const participantIds = (thread.participantIds || []).filter((userId) =>
    db.users.some((user) => user.id === userId && !user.terminated)
  );
  const activeParticipantIds = participantIds.filter((userId) => !thread.removedBy?.[userId]);
  const leaderIds = (thread.leaderIds || []).filter((userId) => activeParticipantIds.includes(userId));
  if (!leaderIds.length && activeParticipantIds.includes(thread.createdBy)) leaderIds.push(thread.createdBy);
  const removedAt = thread.removedBy?.[currentUser.id] || "";
  const deleted = Boolean(thread.deletedBy?.[currentUser.id]);
  const lastReadAt = effectiveMailboxReadAt(thread.readBy?.[currentUser.id] || "", currentUser);
  const visibleMessages = (thread.messages || []).filter((message) => !removedAt || new Date(message.createdAt) <= new Date(removedAt));
  const unreadCount = deleted || removedAt ?0 : visibleMessages.filter((message) =>
    message.senderId !== currentUser.id && (!lastReadAt || new Date(message.createdAt) > new Date(lastReadAt))
  ).length;
  return {
    id: thread.id,
    title: thread.title,
    participantIds,
    participants: participantIds.map((userId) => publicUser(db.users.find((user) => user.id === userId))).filter(Boolean),
    activeParticipantIds,
    activeParticipants: activeParticipantIds.map((userId) => publicUser(db.users.find((user) => user.id === userId))).filter(Boolean),
    leaderIds,
    leaders: leaderIds.map((userId) => publicUser(db.users.find((user) => user.id === userId))).filter(Boolean),
    isLeader: leaderIds.includes(currentUser.id),
    archived: Boolean(thread.archivedBy?.[currentUser.id]),
    deleted,
    removed: Boolean(removedAt),
    removedAt,
    canWrite: activeParticipantIds.includes(currentUser.id) && !deleted,
    createdBy: thread.createdBy,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    unreadCount,
    messages: visibleMessages.map((message) => ({
      ...message,
      sender: publicUser(db.users.find((user) => user.id === message.senderId))
    }))
  };
}

function publicMailboxThreads(db, currentUser) {
  return (db.settings.mailboxThreads || [])
    .filter((thread) => (thread.participantIds || []).includes(currentUser.id))
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .map((thread) => publicMailboxThread(db, thread, currentUser));
}

function publicAdminMailboxThread(db, thread) {
  const participantIds = (thread.participantIds || []).filter((userId) =>
    db.users.some((user) => user.id === userId && !user.terminated)
  );
  const activeParticipantIds = participantIds.filter((userId) => !thread.removedBy?.[userId]);
  const leaderIds = (thread.leaderIds || []).filter((userId) => activeParticipantIds.includes(userId));
  return {
    id: thread.id,
    title: thread.title,
    participantIds,
    participants: participantIds.map((userId) => publicUser(db.users.find((user) => user.id === userId))).filter(Boolean),
    activeParticipantIds,
    activeParticipants: activeParticipantIds.map((userId) => publicUser(db.users.find((user) => user.id === userId))).filter(Boolean),
    leaderIds,
    leaders: leaderIds.map((userId) => publicUser(db.users.find((user) => user.id === userId))).filter(Boolean),
    createdBy: thread.createdBy,
    createdByUser: publicUser(db.users.find((user) => user.id === thread.createdBy)),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    deletedBy: thread.deletedBy || {},
    archivedBy: thread.archivedBy || {},
    removedBy: thread.removedBy || {},
    unreadCount: 0,
    canWrite: false,
    adminView: true,
    messages: (thread.messages || []).map((message) => ({
      ...message,
      sender: publicUser(db.users.find((user) => user.id === message.senderId))
    }))
  };
}

function twitchCredentials(settings = {}) {
  const twitchLivecheck = normalizeTwitchLivecheckConfig(settings?.twitchLivecheck);
  return {
    clientId: String(process.env.TWITCH_CLIENT_ID || twitchLivecheck.clientId || "").trim(),
    clientSecret: String(process.env.TWITCH_CLIENT_SECRET || twitchLivecheck.clientSecret || "").trim()
  };
}

function twitchConfigured(settings = {}) {
  const { clientId, clientSecret } = twitchCredentials(settings);
  return Boolean(clientId && clientSecret);
}

async function twitchToken(settings = {}) {
  const { clientId, clientSecret } = twitchCredentials(settings);
  if (!clientId || !clientSecret) return "";
  if (twitchAccessToken && Date.now() < twitchAccessTokenExpiresAt - 60000) return twitchAccessToken;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TWITCH_FETCH_TIMEOUT_MS);
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials"
  });
  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));
  if (!response.ok) throw new Error(`Twitch Token fehlgeschlagen (${response.status})`);
  const data = await response.json();
  twitchAccessToken = String(data.access_token || "");
  twitchAccessTokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
  return twitchAccessToken;
}

async function fetchTwitchStreams(logins = [], settings = {}) {
  const cleanLogins = [...new Set(logins.map(normalizeTwitchLogin).filter(Boolean))].slice(0, 100);
  const { clientId } = twitchCredentials(settings);
  const token = await twitchToken(settings);
  if (!clientId || !token || !cleanLogins.length) return new Map();
  const url = new URL("https://api.twitch.tv/helix/streams");
  cleanLogins.forEach((login) => url.searchParams.append("user_login", login));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TWITCH_FETCH_TIMEOUT_MS);
  const response = await fetch(url, {
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${token}`
    },
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));
  if (!response.ok) throw new Error(`Twitch Streamcheck fehlgeschlagen (${response.status})`);
  const data = await response.json();
  const streams = new Map();
  (Array.isArray(data.data) ?data.data : []).forEach((stream) => {
    const login = normalizeTwitchLogin(stream.user_login || stream.user_name || "");
    if (!login) return;
    const title = String(stream.title || "");
    streams.set(login, {
      live: true,
      title,
      url: `https://www.twitch.tv/${login}`,
      checkedAt: nowIso(),
      matched: twitchTitleMatchesDienstblatt(title)
    });
  });
  return streams;
}

async function refreshTwitchLiveStatus(db, onlyUserId = "") {
  const users = db.users.filter((user) => !user.terminated && user.twitchLogin && (!onlyUserId || user.id === onlyUserId));
  if (!users.length || !twitchConfigured(db.settings)) return false;
  const streams = await fetchTwitchStreams(users.map((user) => user.twitchLogin), db.settings);
  let changed = false;
  users.forEach((user) => {
    const login = normalizeTwitchLogin(user.twitchLogin);
    const next = normalizeTwitchLive(streams.get(login) || {
      live: false,
      title: "",
      url: login ?`https://www.twitch.tv/${login}` : "",
      checkedAt: nowIso(),
      matched: false
    });
    const before = normalizeTwitchLive(user.twitchLive);
    const relevantChanged = before.live !== next.live || before.matched !== next.matched || before.title !== next.title || before.url !== next.url;
    if (!relevantChanged) return;
    user.twitchLive = next;
    user.updatedAt = nowIso();
    changed = true;
  });
  return changed;
}

async function checkSingleTwitchUser(db, user) {
  const login = normalizeTwitchLogin(user?.twitchLogin || "");
  if (!login) throw new Error("Kein Twitch Account verknüpft.");
  if (!twitchConfigured(db.settings)) throw new Error("Twitch Livecheck ist noch nicht vollständig eingerichtet.");
  const streams = await fetchTwitchStreams([login], db.settings);
  const next = normalizeTwitchLive(streams.get(login) || {
    live: false,
    title: "",
    url: `https://www.twitch.tv/${login}`,
    checkedAt: nowIso(),
    matched: false
  });
  const before = normalizeTwitchLive(user.twitchLive);
  const changed = before.live !== next.live || before.matched !== next.matched || before.title !== next.title || before.url !== next.url || before.checkedAt !== next.checkedAt;
  user.twitchLive = next;
  user.updatedAt = nowIso();
  return {
    changed,
    login,
    twitchLive: next,
    message: next.live
      ? next.matched
        ? `Live erkannt: ${next.title || login}`
        : `Live erkannt, aber Titel passt nicht: ${next.title || "Ohne Titel"}`
      : "Twitch meldet den Kanal aktuell nicht als live."
  };
}

async function runTwitchLivePoll() {
  if (twitchPollInFlight) return;
  twitchPollInFlight = true;
  try {
    const db = readDb();
    if (await refreshTwitchLiveStatus(db)) writeDb(db);
  } catch (error) {
    console.warn("Twitch Livecheck fehlgeschlagen:", error.message);
  } finally {
    twitchPollInFlight = false;
  }
}

async function updateUserTwitch(db, actor, user, twitchLogin) {
  const login = normalizeTwitchLogin(twitchLogin || "");
  if (twitchLogin && !login) throw new Error("Bitte gib einen gültigen Twitch Namen oder Twitch Link ein.");
  const before = user.twitchLogin || "";
  user.twitchLogin = login;
  user.twitchLive = normalizeTwitchLive(login ?{ url: `https://www.twitch.tv/${login}` } : {});
  user.updatedAt = nowIso();
  logAction(db, actor, login ?"Twitch verknüpft" : "Twitch getrennt", actorName(user), { before, after: login });
  try {
    if (login) await refreshTwitchLiveStatus(db, user.id);
  } catch (error) {
    console.warn("Twitch Sofortcheck fehlgeschlagen:", error.message);
  }
  return publicUser(user);
}

function discordRoleIdsForUser(db, user) {
  const sync = normalizeDiscordSync(db.settings?.discordSync);
  const roleIds = new Set();
  if (user.terminated) return roleIds;
  const baseRole = user.baseRole || (["Template", "IT", "IT-Leitung"].includes(user.role) ?"Direktion" : user.role || "User");
  (sync.roleRoles?.[baseRole] || []).forEach((roleId) => roleIds.add(roleId));
  if (!isFrakverwaltungUser(user)) {
    (sync.rankRoles[String(user.rank)] || []).forEach((roleId) => roleIds.add(roleId));
  }
  (db.settings?.departments || []).forEach((department) => {
    const membership = department.members?.find((member) => member.userId === user.id);
    if (!membership) return;
    const leaderKey = `${department.id}:${membership.position}`;
    const memberKey = `${department.id}:__member`;
    const key = isDepartmentLeaderPosition(department, membership.position) ?leaderKey : memberKey;
    (sync.departmentRoles[key] || []).forEach((roleId) => roleIds.add(roleId));
    if (isSwatDepartment(department)) {
      const team = normalizeSwatTeam(membership.swatTeam);
      (sync.departmentRoles[`swat:${membership.position}`] || []).forEach((roleId) => roleIds.add(roleId));
      if (team) (sync.departmentRoles[`swat:team:${team}`] || []).forEach((roleId) => roleIds.add(roleId));
      if (team && isSwatTeamLeaderMember(membership)) (sync.departmentRoles[`swat:teamLeader:${team}`] || []).forEach((roleId) => roleIds.add(roleId));
    }
  });
  return roleIds;
}

function allConfiguredDiscordRoleIds(sync) {
  return new Set([
    ...Object.values(sync.rankRoles || {}).flat(),
    ...Object.values(sync.roleRoles || {}).flat(),
    ...Object.values(sync.departmentRoles || {}).flat()
  ].filter(Boolean));
}

function allKnownDiscordRoleIds(sync) {
  return new Set([
    ...allConfiguredDiscordRoleIds(sync),
    ...(sync.importedRoles || []).map((role) => role.id)
  ].filter(Boolean));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function discordRoleLabel(sync, roleId) {
  const id = String(roleId || "").trim();
  if (!id) return "Unbekannte Rolle";
  const importedRole = (sync.importedRoles || []).find((role) => role.id === id);
  return importedRole?.name ?`${importedRole.name} (${id})` : `Rolle ${id}`;
}

function discordRoleActionLabel(method) {
  return method === "DELETE" ?"entfernen" : "hinzuf\u00fcgen";
}

function discordFailureActionLabel(item) {
  if (item.action) return item.action;
  if (item.roleId) return "";
  const message = String(item.reason?.message || item.reason || "");
  if (/Discord API GET .*\/members\//.test(message)) return "Discord Mitglied/Rollen lesen";
  if (/Discord API PATCH .*\/members\//.test(message)) return "Nickname setzen";
  return "Discord API Aktion";
}

function truncateDiscordDetails(value, maxLength = 3400) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 24).trim()} ... weitere Details gekuerzt.`;
}

function isDiscordMemberMissingFailure(item) {
  const message = String(item.reason?.message || item.reason || "");
  return item.action === "Discord Mitglied/Rollen lesen" && /HTTP 404/.test(message);
}

function isKurtTrovatoSeeker(user) {
  return actorName(user).toLowerCase() === "kurt trovato-seeker";
}

function shouldSuppressDiscordSyncFailure(user, failures) {
  return isKurtTrovatoSeeker(user)
    && failures.length > 0
    && failures.every((item) => /HTTP 403/.test(String(item.reason?.message || item.reason || "")));
}

function discordFailureSummary(failed, sync = null) {
  if (!failed.length) return "";
  const messages = failed.map((item) => String(item.reason?.message || item.reason || ""));
  const parts = [];
  const forbidden = messages.filter((message) => /HTTP 403/.test(message)).length;
  const limited = messages.filter((message) => /HTTP 429/.test(message)).length;
  const missingMember = failed.filter(isDiscordMemberMissingFailure).length;
  const missing = messages.filter((message) => /HTTP 404/.test(message)).length - missingMember;
  const other = messages.length - forbidden - limited - missing - missingMember;
  if (missingMember) return "Person ist nicht auf dem Discord.";
  if (forbidden) parts.push(`Bot-Rechte oder Rollenh\u00f6he fehlen bei ${forbidden} Aktion${forbidden === 1 ?"" : "en"}.`);
  if (limited) parts.push(`Discord Rate Limit bei ${limited} Aktion${limited === 1 ?"" : "en"}.`);
  if (missing) parts.push(`${missing} Rolle wurde auf Discord nicht gefunden.`);
  const failedRoles = [...new Map(failed
    .filter((item) => item.roleId)
    .map((item) => {
      const roleLabel = sync ?discordRoleLabel(sync, item.roleId) : String(item.roleId);
      return [`${item.method || ""}:${item.roleId}`, `${roleLabel} ${discordRoleActionLabel(item.method)}`];
    })).values()];
  if (failedRoles.length) parts.push(`Nicht synchronisierte Rollen: ${failedRoles.join(", ")}.`);
  const failedActions = [...new Set(failed.map(discordFailureActionLabel).filter(Boolean))];
  if (failedActions.length) parts.push(`Fehlgeschlagene Aktion${failedActions.length === 1 ?"" : "en"}: ${failedActions.join(", ")}.`);
  if (other > 0) parts.push(`${other} weitere Discord-Aktion${other === 1 ?"" : "en"} fehlgeschlagen.`);
  return parts.join(" ");
}

function discordRetryDelay(response, body, attempt) {
  let retryAfter = Number(response.headers["retry-after"] || 0);
  try {
    const parsed = body ?JSON.parse(body) : {};
    retryAfter = Number(parsed.retry_after || retryAfter || 1);
  } catch {
  }
  return Math.min(60000, Math.max(750, (retryAfter * 1000) + 350 + (attempt * 250)));
}

function rawDiscordApiRequest(method, sync, pathName, body = null, attempt = 0) {
  return new Promise((resolve, reject) => {
    const payload = body ?JSON.stringify(body) : "";
    const request = https.request({
      hostname: "discord.com",
      path: `/api/v10${pathName}`,
      method,
      headers: {
        Authorization: `Bot ${sync.botToken}`,
        "User-Agent": "LSPD-Dienstblatt Discord Sync",
        ...(payload ?{ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {})
      }
    }, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          if (!body) return resolve({});
          try {
            return resolve(JSON.parse(body));
          } catch {
            return resolve({ raw: body });
          }
        }
        if (response.statusCode === 429 && attempt < 25) {
          const delay = discordRetryDelay(response, body, attempt);
          return setTimeout(() => {
            rawDiscordApiRequest(method, sync, pathName, payload ?JSON.parse(payload) : null, attempt + 1).then(resolve).catch(reject);
          }, delay);
        }
        reject(new Error(`Discord API ${method} ${pathName}: HTTP ${response.statusCode}`));
      });
    });
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function discordApiRequest(method, sync, pathName, body = null) {
  const run = () => rawDiscordApiRequest(method, sync, pathName, body);
  const queued = discordRequestQueue.then(run, run);
  discordRequestQueue = queued.catch(() => {}).then(() => sleep(220));
  return queued;
}

function requestDiscordRole(method, sync, userId, roleId) {
  return discordApiRequest(method, sync, `/guilds/${encodeURIComponent(sync.serverId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`);
}

function discordUnsyncedRoleId(sync = null) {
  return String(sync?.unsyncedRoleId || DISCORD_UNSYNCED_ROLE_ID || "").trim();
}

async function assignDiscordUnsyncedRole(sync, discordId, reason = "Discord Sync fehlt") {
  const roleId = discordUnsyncedRoleId(sync);
  if (!sync?.enabled || !sync.serverId || !sync.botToken || !discordId || !roleId) return false;
  await requestDiscordRole("PUT", sync, discordId, roleId);
  console.log(`Discord Rolle 'DC Sync fehlt' an ${discordId} vergeben (${reason}).`);
  return true;
}

function requestDiscordNickname(sync, userId, name) {
  const nick = String(name || "").trim().slice(0, 32);
  if (!nick) return Promise.resolve({});
  return discordApiRequest("PATCH", sync, `/guilds/${encodeURIComponent(sync.serverId)}/members/${encodeURIComponent(userId)}`, { nick });
}

function clearDiscordNickname(sync, userId) {
  return discordApiRequest("PATCH", sync, `/guilds/${encodeURIComponent(sync.serverId)}/members/${encodeURIComponent(userId)}`, { nick: null });
}

async function fetchDiscordMemberRoleIds(sync, userId) {
  const member = await discordApiRequest("GET", sync, `/guilds/${encodeURIComponent(sync.serverId)}/members/${encodeURIComponent(userId)}`);
  return new Set((Array.isArray(member.roles) ?member.roles : []).map(String));
}

function discordBearerRequest(accessToken, pathName) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: "discord.com",
      path: `/api/v10${pathName}`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "LSPD-Dienstblatt Discord OAuth"
      }
    }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          try {
            return resolve(body ?JSON.parse(body) : {});
          } catch {
            return resolve({});
          }
        }
        reject(new Error(`Discord OAuth HTTP ${response.statusCode}`));
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function discordTokenRequest(sync, code, redirectUri) {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams({
      client_id: sync.applicationId,
      client_secret: sync.clientSecret,
      grant_type: "authorization_code",
      code: String(code || ""),
      redirect_uri: redirectUri
    }).toString();
    const request = https.request({
      hostname: "discord.com",
      path: "/api/v10/oauth2/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(payload),
        "User-Agent": "LSPD-Dienstblatt Discord OAuth"
      }
    }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        let data = {};
        try {
          data = body ?JSON.parse(body) : {};
        } catch {
          data = {};
        }
        if (response.statusCode >= 200 && response.statusCode < 300 && data.access_token) return resolve(data);
        if (data.error === "invalid_client") {
          return reject(new Error("Discord Client-ID oder Client Secret ist ungueltig. Bitte im IT-Reiter die Discord Application ID und das Client Secret neu speichern."));
        }
        reject(new Error(data.error_description || data.error || `Discord OAuth HTTP ${response.statusCode}`));
      });
    });
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

async function discordUserFromAccessToken(accessToken) {
  const token = String(accessToken || "").trim();
  if (!token) throw new Error("Discord Token fehlt.");
  const user = await discordBearerRequest(token, "/users/@me");
  if (!user?.id) throw new Error("Discord Benutzer konnte nicht gelesen werden.");
  return {
    id: String(user.id),
    username: String(user.username || ""),
    globalName: String(user.global_name || user.username || ""),
    avatar: String(user.avatar || "")
  };
}

function makeDiscordOAuthTicket(tokenResponse) {
  const ticket = crypto.randomUUID();
  pendingDiscordOAuthTickets.set(ticket, {
    accessToken: String(tokenResponse.access_token || ""),
    expiresAt: Date.now() + 1000 * 60 * 5
  });
  return ticket;
}

function consumeDiscordOAuthTicket(ticket) {
  const key = String(ticket || "").trim();
  const entry = pendingDiscordOAuthTickets.get(key);
  pendingDiscordOAuthTickets.delete(key);
  if (!entry || entry.expiresAt < Date.now() || !entry.accessToken) throw new Error("Discord Callback ist abgelaufen. Bitte erneut versuchen.");
  return entry.accessToken;
}

function cleanupDiscordOAuthTickets() {
  const now = Date.now();
  pendingDiscordOAuthTickets.forEach((entry, ticket) => {
    if (entry.expiresAt < now) pendingDiscordOAuthTickets.delete(ticket);
  });
}

function createSession(db, user) {
  const token = createSessionToken(db, user);
  db.sessions.push({ token, userId: user.id, createdAt: nowIso() });
  return token;
}

function sessionSecret(db = null) {
  return process.env.SESSION_SECRET || process.env.DISCORD_BOT_TOKEN || db?.settings?.discordSync?.botToken || runtimeSessionSecret;
}

function createSessionToken(db, user) {
  const issuedAt = Date.now().toString(36);
  const nonce = crypto.randomBytes(12).toString("hex");
  const payload = `${user.id}.${issuedAt}.${nonce}`;
  const signature = crypto.createHmac("sha256", sessionSecret(db)).update(`${payload}.${user.passwordHash || ""}.${user.updatedAt || ""}`).digest("hex");
  return `v2.${payload}.${signature}`;
}

function userFromSessionToken(db, token) {
  const session = db.sessions.find((item) => item.token === token);
  if (session) return { session, user: db.users.find((item) => item.id === session.userId) };
  const parts = String(token || "").split(".");
  if (parts.length !== 5 || parts[0] !== "v2") return { session: null, user: null };
  const [, userId, issuedAt, nonce, signature] = parts;
  if (!userId || !issuedAt || !nonce || !signature) return { session: null, user: null };
  const user = db.users.find((item) => item.id === userId);
  if (!user) return { session: null, user: null };
  const payload = `${userId}.${issuedAt}.${nonce}`;
  const expected = crypto.createHmac("sha256", sessionSecret(db)).update(`${payload}.${user.passwordHash || ""}.${user.updatedAt || ""}`).digest("hex");
  const valid = signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  return valid ?{ session: { token, userId, createdAt: new Date(parseInt(issuedAt, 36) || Date.now()).toISOString() }, user } : { session: null, user: null };
}

async function finishDiscordLogin(db, accessToken) {
  const discordUser = await discordUserFromAccessToken(accessToken);
  const user = db.users.find((item) => !item.locked && !item.terminated && item.discordId === discordUser.id);
  if (!user) {
    const error = new Error("Discord Account ist noch nicht mit einem Dienstblatt-Account verknüpft.");
    error.statusCode = 404;
    error.discordUser = discordUser;
    throw error;
  }
  const token = createSession(db, user);
  logAction(db, user, "Discord Login", actorName(user), { discordId: discordUser.id, discordName: discordUser.globalName || discordUser.username });
  writeDb(db);
  return { token, user: publicUser(user), discordUser };
}

async function finishDiscordLink(db, user, accessToken) {
  const discordUser = await discordUserFromAccessToken(accessToken);
  const otherUser = db.users.find((item) => item.id !== user.id && item.discordId === discordUser.id && !item.terminated);
  if (otherUser) {
    const error = new Error("Dieser Discord Account ist bereits mit einem anderen Dienstblatt-Account verknüpft.");
    error.statusCode = 400;
    throw error;
  }
  const before = user.discordId || "";
  user.discordId = discordUser.id;
  user.discordName = discordUser.globalName || discordUser.username;
  user.updatedAt = nowIso();
  logAction(db, user, "Discord synchronisiert", actorName(user), { before, after: user.discordId, discordName: user.discordName, description: `${actorName(user)} hat den eigenen Discord Account synchronisiert.` });
  writeDb(db);
  await sendDiscordItLog(db, {
    title: "Discord synchronisiert",
    color: 0x22c55e,
    description: `**${actorName(user)}** hat den eigenen Discord Account synchronisiert.`,
    fields: [
      { name: "Dienstblatt Account", value: actorName(user), inline: true },
      { name: "Discord", value: `${discordUser.globalName || discordUser.username} (${discordUser.id})`, inline: true }
    ]
  });
  syncDiscordRolesForUser(db, user, "Discord verknüpft").then(() => {
    announceDiscordLink(db, user).catch((error) => console.warn("Discord Link Meldung fehlgeschlagen:", error.message));
  });
  return { user: publicUser(user), discordUser };
}

async function notifyDiscordItChannel(db, user, ok, reason, details = "") {
  if (ok) return;
  if (!discordClient) return;
  const sync = normalizeDiscordSync(db.settings?.discordSync);
  if (!sync.enabled || !sync.itChannelId) return;
  const channel = await discordClient.channels.fetch(sync.itChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const status = ok ?"erfolgreich" : "fehlgeschlagen";
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(ok ?0x22c55e : 0xef4444)
        .setTitle(`Discord Sync ${status}`)
        .setDescription(`Person: **${actorName(user)}**\nGrund: ${reason}${details ?`\nDetails: ${details}` : ""}`)
        .setTimestamp()
        .setFooter({ text: DISCORD_SYNC_PANEL_FOOTER })
    ]
  }).catch((error) => console.warn("Discord IT Meldung fehlgeschlagen:", error.message));
}

async function notifyDiscordAccountLinked(db, user, details = "") {
  if (!discordClient) return;
  const sync = normalizeDiscordSync(db.settings?.discordSync);
  if (!sync.enabled || !sync.itChannelId) return;
  const noticeKey = `${user.id}:${user.discordId || ""}`;
  const lastNotice = recentDiscordAccountNotices.get(noticeKey) || 0;
  if (Date.now() - lastNotice < 20000) return;
  recentDiscordAccountNotices.set(noticeKey, Date.now());
  const channel = await discordClient.channels.fetch(sync.itChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const warning = details ?`\nHinweis: Der Website-Account wurde erfolgreich synchronisiert. ${details}` : "";
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(details ?0xf59e0b : 0x22c55e)
        .setTitle("Discord Account synchronisiert")
        .setDescription(`Person: **${actorName(user)}**\nStatus: Website-Verkn\u00fcpfung erfolgreich${warning}`)
        .setTimestamp()
        .setFooter({ text: DISCORD_SYNC_PANEL_FOOTER })
    ]
  }).catch((error) => console.warn("Discord Account Sync Meldung fehlgeschlagen:", error.message));
}

async function sendDiscordItLog(db, { title, color = 0x2877ff, description = "", fields = [] }) {
  if (!discordClient) return;
  const sync = normalizeDiscordSync(db.settings?.discordSync);
  if (!sync.enabled || !sync.itChannelId) return;
  const channel = await discordClient.channels.fetch(sync.itChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description || "-")
    .setTimestamp()
    .setFooter({ text: DISCORD_SYNC_PANEL_FOOTER });
  fields.forEach((field) => embed.addFields(field));
  await channel.send({ embeds: [embed] }).catch((error) => console.warn("Discord IT Log fehlgeschlagen:", error.message));
}

async function notifyDiscordSyncRemoved(db, user, actor, options = {}) {
  if (!discordClient) return;
  const sync = normalizeDiscordSync(db.settings?.discordSync);
  if (!sync.enabled || !sync.itChannelId) return;
  const channel = await discordClient.channels.fetch(sync.itChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const warning = options.discordCleanupFailed
    ?`\nHinweis: Die Website-Verkn\u00fcpfung wurde entfernt. Discord-Rollen/Nickname konnten vom Bot nicht vollst\u00e4ndig ge\u00e4ndert werden. Bitte Bot-Rollenh\u00f6he und Rechte pr\u00fcfen.${options.details ?` ${options.details}` : ""}`
    : "";
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(options.discordCleanupFailed ?0xf59e0b : 0x22c55e)
        .setTitle("Discord Sync entfernt")
        .setDescription(`Person: **${actorName(user)}**\nEntfernt durch: **${actorName(actor)}**${warning}`)
        .setTimestamp()
        .setFooter({ text: DISCORD_SYNC_PANEL_FOOTER })
    ]
  }).catch((error) => console.warn("Discord Entfernen Meldung fehlgeschlagen:", error.message));
}

async function notifyDiscordUser(user, message) {
  if (!discordClient || !user?.discordId) return;
  const discordUser = await discordClient.users.fetch(user.discordId).catch(() => null);
  if (!discordUser) return;
  await discordUser.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("Discord Sync erfolgreich")
        .setDescription(message)
        .setFooter({ text: DISCORD_SYNC_PANEL_FOOTER })
        .setTimestamp()
    ]
  }).catch(() => {});
}

function publicWebsiteUrl() {
  const configured = normalizePublicUrl(db.settings?.publicBaseUrl || process.env.PUBLIC_BASE_URL || PUBLIC_BASE_URL, PUBLIC_BASE_URL);
  try {
    const url = new URL(configured || `http://localhost:${PORT}/`);
    url.hash = "";
    url.search = "";
    url.pathname = "/";
    return url.toString();
  } catch {
    return `http://localhost:${PORT}/`;
  }
}

async function notifyDiscordDbCreateWelcome(interaction, discordUser, createdUser, defaultPassword) {
  if (!discordUser || !createdUser) return;
  const loginName = actorName(createdUser);
  const websiteUrl = publicWebsiteUrl();
  const message = [
    `Willkommen ${loginName}!`,
    `Dienstblatt: ${websiteUrl}`,
    `Login Name: ${loginName}`,
    `Passwort: ${defaultPassword}`
  ].join("\n");
  const embed = new EmbedBuilder()
    .setColor(0x2877ff)
    .setTitle("Willkommen im LSPD Dienstblatt")
    .setDescription(message)
    .setTimestamp()
    .setFooter({ text: DISCORD_SYNC_PANEL_FOOTER });
  const dmOk = await discordUser.send({ embeds: [embed] }).then(() => true).catch(() => false);
  if (dmOk || !interaction?.channel?.isTextBased?.()) return;
  const notice = await interaction.channel.send({ content: `<@${discordUser.id}>`, embeds: [embed] }).catch(() => null);
  if (notice?.deletable) setTimeout(() => notice.delete().catch(() => {}), 120000);
}

async function performDiscordRolesForUser(db, user, reason = "update", options = {}) {
  if (user?.id && !options.useProvidedSnapshot) {
    const freshDb = readDb();
    const freshUser = freshDb.users.find((item) => item.id === user.id);
    if (freshUser) {
      db = freshDb;
      user = freshUser;
    }
  }
  const sync = normalizeDiscordSync(db.settings?.discordSync);
  if (!sync.enabled || !sync.serverId || !sync.botToken || !user?.discordId) {
    const result = { ok: true, details: "", failures: [], skipped: true };
    return options.returnDetails ?result : undefined;
  }
  if (user.mustChangePassword && !options.force) {
    const result = { ok: true, details: "Account wartet noch auf Passwortaenderung, Sync uebersprungen.", failures: [], skipped: true };
    return options.returnDetails ?result : undefined;
  }
  const targetRoleIds = discordRoleIdsForUser(db, user);
  const configuredRoleIds = allConfiguredDiscordRoleIds(sync);
  let currentRoleIds = new Set();
  const failures = [];
  try {
    currentRoleIds = await fetchDiscordMemberRoleIds(sync, user.discordId);
  } catch (error) {
    failures.push({ reason: error, action: "Discord Mitglied/Rollen lesen" });
  }
  if (failures.some(isDiscordMemberMissingFailure)) {
    const details = discordFailureSummary(failures, sync);
    const result = { ok: false, details, failures, skipped: false };
    if (options.notify !== false) await notifyDiscordItChannel(db, user, false, reason, details);
    return options.returnDetails ?result : false;
  }
  const jobs = [];
  targetRoleIds.forEach((roleId) => {
    if (!currentRoleIds.has(roleId)) jobs.push({ method: "PUT", roleId });
  });
  currentRoleIds.forEach((roleId) => {
    if (configuredRoleIds.has(roleId) && !targetRoleIds.has(roleId)) jobs.push({ method: "DELETE", roleId });
  });
  const unsyncedRoleId = discordUnsyncedRoleId(sync);
  if (unsyncedRoleId && currentRoleIds.has(unsyncedRoleId) && !jobs.some((job) => job.method === "DELETE" && job.roleId === unsyncedRoleId)) jobs.push({ method: "DELETE", roleId: unsyncedRoleId });
  for (const job of jobs) {
    try {
      await requestDiscordRole(job.method, sync, user.discordId, job.roleId);
      await sleep(180);
    } catch (error) {
      failures.push({ reason: error, method: job.method, roleId: job.roleId });
    }
  }
  if (!user.terminated) {
    try {
      await requestDiscordNickname(sync, user.discordId, actorName(user));
    } catch (error) {
      failures.push({ reason: error, action: "Nickname setzen" });
    }
  }
  const details = discordFailureSummary(failures, sync);
  if (failures.length) console.warn(`Discord Sync für ${actorName(user)} (${reason}) unvollständig:`, failures.map((item) => item.reason?.message || item.reason).join("; "));
  if (shouldSuppressDiscordSyncFailure(user, failures)) {
    const suppressed = { ok: true, details: "", failures, skipped: true, suppressed: true };
    return options.returnDetails ?suppressed : true;
  }
  const result = { ok: failures.length === 0, details, failures, skipped: false };
  if (reason === "Discord verknüpft") {
    await notifyDiscordAccountLinked(db, user, details);
    return options.returnDetails ?result : true;
  }
  if (options.notify !== false) await notifyDiscordItChannel(db, user, failures.length === 0, reason, details);
  return options.returnDetails ?result : failures.length === 0;
}

function syncDiscordRolesForUser(db, user, reason = "update", options = {}) {
  const userKey = user?.id || user?.discordId || "";
  if (!userKey || options.noQueue) return performDiscordRolesForUser(db, user, reason, options);
  const previous = discordUserSyncQueues.get(userKey) || Promise.resolve();
  const run = previous.catch(() => {}).then(() => performDiscordRolesForUser(db, user, reason, options));
  const queued = run.finally(() => {
    if (discordUserSyncQueues.get(userKey) === queued) discordUserSyncQueues.delete(userKey);
  });
  discordUserSyncQueues.set(userKey, queued);
  return run;
}

function syncDiscordRolesForDepartmentMembers(db, department, reason) {
  const userIds = [...new Set((department?.members || []).map((member) => member.userId).filter(Boolean))];
  userIds.forEach((userId) => {
    const user = db.users.find((item) => item.id === userId);
    if (user) syncDiscordRolesForUser(db, user, reason);
  });
}

async function runDiscordFullSyncJob(actorId) {
  discordFullSyncRunning = true;
  discordFullSyncStatus = {
    running: true,
    startedAt: nowIso(),
    finishedAt: "",
    synced: 0,
    failed: 0,
    skipped: 0,
    failedAccounts: [],
    error: ""
  };
  try {
    const initialDb = readDb();
    const actor = initialDb.users.find((user) => user.id === actorId) || { firstName: "System", lastName: "" };
    const sync = normalizeDiscordSync(initialDb.settings.discordSync);
    if (!sync.enabled || !sync.serverId || !sync.botToken) throw new Error("Discord Sync ist noch nicht vollstaendig eingerichtet.");
    const userIds = initialDb.users.filter((user) => user.discordId).map((user) => user.id);
    let failed = 0;
    let skipped = 0;
    const failedAccounts = [];
    for (const userId of userIds) {
      const latestDb = readDb();
      const user = latestDb.users.find((item) => item.id === userId);
      if (!user?.discordId) {
        skipped += 1;
        discordFullSyncStatus.skipped = skipped;
        continue;
      }
      const result = await syncDiscordRolesForUser(latestDb, user, "Manueller Gesamtsync", { notify: false, returnDetails: true, force: true });
      discordFullSyncStatus.synced += 1;
      if (result?.skipped) {
        skipped += 1;
        discordFullSyncStatus.skipped = skipped;
      }
      if (result?.ok === false) {
        failed += 1;
        const failedAccount = {
          userId: user.id,
          name: actorName(user),
          discordId: user.discordId,
          details: result.details || "Keine Detailangabe vorhanden."
        };
        failedAccounts.push(failedAccount);
        discordFullSyncStatus.failed = failed;
        discordFullSyncStatus.failedAccounts = failedAccounts.slice(0, 50);
      }
    }
    if (failed > 0) {
      const notifyDb = readDb();
      const details = [
        `${failed} von ${userIds.length} Accounts konnten nicht vollstaendig synchronisiert werden.`,
        `Betroffene Accounts:\n${failedAccounts.map((item) => `- ${item.name}: ${item.details}`).join("\n")}`
      ].join("\n");
      await notifyDiscordItChannel(notifyDb, actor, false, "Manueller Gesamtsync", truncateDiscordDetails(details));
    }
    const logDb = readDb();
    logAction(logDb, actor, "Discord Sync abgeschlossen", "IT", { users: userIds.length, failed, skipped });
    writeDb(logDb);
    discordFullSyncStatus = {
      ...discordFullSyncStatus,
      running: false,
      finishedAt: nowIso(),
      synced: userIds.length,
      failed,
      skipped,
      failedAccounts: failedAccounts.slice(0, 50),
      error: ""
    };
  } catch (error) {
    console.warn("Discord Gesamtsync fehlgeschlagen:", error.message);
    discordFullSyncStatus = {
      ...discordFullSyncStatus,
      running: false,
      finishedAt: nowIso(),
      error: error.message || "Discord Gesamtsync fehlgeschlagen."
    };
  } finally {
    discordFullSyncRunning = false;
  }
}

async function unlinkDiscordAccount(db, user, previousDiscordId, actor, reason = "Discord Verknüpfung aufgehoben") {
  const sync = normalizeDiscordSync(db.settings?.discordSync);
  if (!sync.enabled || !sync.serverId || !sync.botToken || !previousDiscordId) {
    await notifyDiscordSyncRemoved(db, user, actor, { discordCleanupFailed: false });
    return;
  }
  const configuredRoleIds = allKnownDiscordRoleIds(sync);
  const failures = [];
  let currentRoleIds = new Set();
  try {
    currentRoleIds = await fetchDiscordMemberRoleIds(sync, previousDiscordId);
  } catch (error) {
    failures.push({ reason: error, action: "Discord Mitglied/Rollen lesen" });
  }
  const rolesToRemove = [...currentRoleIds].filter((roleId) => configuredRoleIds.has(roleId));
  for (const roleId of rolesToRemove) {
    try {
      await requestDiscordRole("DELETE", sync, previousDiscordId, roleId);
      await sleep(180);
    } catch (error) {
      failures.push({ reason: error, method: "DELETE", roleId });
    }
  }
  try {
    await clearDiscordNickname(sync, previousDiscordId);
  } catch (error) {
    failures.push({ reason: error, action: "Nickname setzen" });
  }
  try {
    await assignDiscordUnsyncedRole(sync, previousDiscordId, reason);
  } catch (error) {
    failures.push({ reason: error, method: "PUT", roleId: discordUnsyncedRoleId() });
  }
  const details = discordFailureSummary(failures, sync);
  if (failures.length) console.warn(`Discord Unlink für ${actorName(user)} unvollständig:`, details);
  await notifyDiscordSyncRemoved(db, user, actor, { discordCleanupFailed: failures.length > 0, reason, details });
}

function resetUserPassword(db, user, actor) {
  const defaultPassword = String(db.settings.defaultPassword || DEFAULT_PASSWORD);
  if (!defaultPassword) throw new Error("Es ist kein gültiges Standardpasswort hinterlegt.");
  user.passwordHash = hashPassword(defaultPassword);
  user.mustChangePassword = true;
  user.tutorialCompleted = Boolean(user.tutorialSkipped);
  user.changelogReadIds = [];
  user.updatedAt = nowIso();
  logAction(db, actor, "Passwort zurückgesetzt", actorName(user), { userId: user.id });
  return publicUser(user);
}

function resetUserDiscord(db, user, actor, reason = "Discord Sync Reset") {
  const previousDiscordId = user.discordId || "";
  const previousDiscordName = user.discordName || "";
  user.discordId = "";
  user.discordName = "";
  user.updatedAt = nowIso();
  logAction(db, actor, "Discord Sync zurückgesetzt", actorName(user), { userId: user.id, previousDiscordId, previousDiscordName });
  if (previousDiscordId) {
    unlinkDiscordAccount(db, user, previousDiscordId, actor, reason).catch((error) => {
      console.warn("Discord Reset Cleanup fehlgeschlagen:", error.message);
    });
  }
  return publicUser(user);
}

function isFrakverwaltungUser(user) {
  return /frakverwaltung|frakverwalter/i.test(`${user?.role || ""} ${user?.baseRole || ""}`);
}

function userRankSortValue(user) {
  return isFrakverwaltungUser(user) ?-1 : Number(user?.rank || 0);
}

function normalizeDnBlacklist(value) {
  return [...new Set((Array.isArray(value) ?value : [])
    .map((item) => String(item || "").trim())
    .filter((item) => /^\d+$/.test(item))
    .sort((a, b) => Number(a) - Number(b)))];
}

function isDnBlacklisted(db, dn) {
  const value = String(dn || "").trim();
  return Boolean(value) && normalizeDnBlacklist(db.settings?.dnBlacklist).includes(value);
}

function nextFreeDienstnummer(db, start = 20) {
  const used = new Set([
    ...db.users.map((user) => Number.parseInt(user.dn, 10)),
    ...normalizeDnBlacklist(db.settings?.dnBlacklist).map((dn) => Number.parseInt(dn, 10))
  ].filter((dn) => Number.isInteger(dn) && dn >= start));
  let dn = start;
  while (used.has(dn)) dn += 1;
  return String(dn);
}

function createDienstblattUser(db, actor, body) {
  const normalized = normalizeUserInput(body);
  if (normalized.error) throw new Error(normalized.error);
  const roleCheck = protectItRoleChange(actor, "User", normalized.value.role);
  if (roleCheck.error) throw new Error(roleCheck.error);
  normalized.value.role = roleCheck.role;
  const dnConflict = resolveDnConflict(db, "", normalized.value.dn, Boolean(body.overwriteDn));
  if (dnConflict?.error) throw new Error(dnConflict.error);
  if (normalized.value.discordId && db.users.some((user) => !user.terminated && user.discordId === normalized.value.discordId)) {
    throw new Error("Dieser Discord Account ist bereits mit einem Dienstblatt-Account verknüpft.");
  }
  const createdAt = nowIso();
  const user = {
    id: makeId("user"),
    ...normalized.value,
    trainings: { ...Object.fromEntries(trainingNames.map((training) => [training, false])), ...normalized.value.trainings },
    lastPromotionAt: todayIso(),
    passwordHash: hashPassword(db.settings.defaultPassword || DEFAULT_PASSWORD),
    mustChangePassword: true,
    tutorialCompleted: false,
    activatedAt: "",
    notificationBaselineAt: createdAt,
    avatarUrl: "",
    locked: false,
    accountStatus: "Aktiv",
    terminated: false,
    trainingMeta: {},
    createdAt,
    updatedAt: createdAt
  };
  if (body.discordName && user.discordId) user.discordName = String(body.discordName).trim();
  updateTrainingMeta(user, {}, user.trainings, actor);
  syncDirektionMembership(db, user, { roleAssigned: user.role === "Direktion" });
  db.users.push(user);
  logFluctuation(db, user, "Eingestellt", actor);
  logAction(db, actor, "Mitglied eingestellt", actorName(user), { after: publicUser(user) });
  return publicUser(user);
}

function createFrakverwaltungUser(db, actor, body) {
  const firstName = String(body.firstName || "").trim();
  const lastName = String(body.lastName || "").trim();
  const discordId = String(body.discordId || "").trim();
  if (!firstName) throw new Error("Name ist erforderlich.");
  if (discordId && db.users.some((user) => !user.terminated && user.discordId === discordId)) {
    throw new Error("Dieser Discord Account ist bereits mit einem Dienstblatt-Account verknüpft.");
  }
  const createdAt = nowIso();
  const user = {
    id: makeId("user"),
    firstName,
    lastName,
    phone: "",
    dn: "",
    discordId,
    discordName: String(body.discordName || "").trim(),
    rank: 0,
    role: "Frakverwaltung",
    baseRole: "Frakverwaltung",
    teamler: false,
    joinedAt: todayIso(),
    departments: [],
    trainings: Object.fromEntries(trainingNames.map((training) => [training, false])),
    lastPromotionAt: todayIso(),
    passwordHash: hashPassword(db.settings.defaultPassword || DEFAULT_PASSWORD),
    mustChangePassword: true,
    tutorialCompleted: false,
    activatedAt: "",
    notificationBaselineAt: createdAt,
    avatarUrl: "",
    locked: false,
    accountStatus: "Aktiv",
    terminated: false,
    trainingMeta: {},
    createdAt,
    updatedAt: createdAt
  };
  db.users.push(user);
  logFluctuation(db, user, "Eingestellt", actor);
  logAction(db, actor, "Frakverwaltung eingestellt", actorName(user), { after: publicUser(user) });
  return publicUser(user);
}

function discordCommandDefinitions() {
  const makeUserOption = (option) => option
    .setName("account")
    .setDescription("Dienstblatt-Account suchen")
    .setRequired(true)
    .setAutocomplete(true);
  return [
    new SlashCommandBuilder()
      .setName("resetpw")
      .setDescription("Setzt das Passwort eines aktiven Dienstblatt-Accounts zurück.")
      .addStringOption(makeUserOption)
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("resetdc")
      .setDescription("Entfernt die Discord-Verknüpfung eines aktiven Dienstblatt-Accounts.")
      .addStringOption(makeUserOption)
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("dbcreate")
      .setDescription("Erstellt einen neuen Dienstblatt-Account.")
      .addUserOption((option) => option.setName("discorduser").setDescription("Discord-User für den neuen Account").setRequired(true))
      .addBooleanOption((option) => option.setName("frakverwalter").setDescription("Frakverwalter-Account erstellen").setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("abmelden")
      .setDescription("Erstellt eine Abmeldung im Dienstblatt."),
    new SlashCommandBuilder()
      .setName("abmeldungen")
      .setDescription("Zeigt deine Abmeldungen aus dem Dienstblatt an."),
    new SlashCommandBuilder()
      .setName("logoff")
      .setDescription("Trägt dich oder eine andere Person aus dem Dienst aus.")
      .addStringOption((option) => option
        .setName("account")
        .setDescription("Optional: Dienstblatt-Account austragen")
        .setRequired(false)
        .setAutocomplete(true))
  ].map((command) => command.toJSON());
}

async function registerDiscordCommands(client, sync) {
  if (!sync.serverId || !client.application?.commands) return;
  const guild = await client.guilds.fetch(sync.serverId).catch(() => null);
  if (!guild) return;
  await guild.commands.set(discordCommandDefinitions());
}

function discordCommandActor(db, discordUser, minRole = "IT") {
  return db.users.find((user) => !user.terminated && !user.locked && user.discordId === discordUser.id && (rolePower[user.role] || 0) >= rolePower[minRole]) || null;
}

function discordLinkedUser(db, discordUser) {
  return discordCommandActor(db, discordUser, "User");
}

function discordCommandUserChoices(db, commandName, focusedValue) {
  const query = String(focusedValue || "").trim().toLowerCase();
  return db.users
    .filter((user) => !user.terminated && !user.locked)
    .filter((user) => commandName !== "resetdc" || user.discordId)
    .filter((user) => commandName !== "logoff" || db.duty.some((entry) => entry.userId === user.id))
    .filter((user) => {
      if (!query) return true;
      return [actorName(user), user.dn, user.phone, user.discordName, user.discordId]
        .some((value) => String(value || "").toLowerCase().includes(query));
    })
    .sort((a, b) => actorName(a).localeCompare(actorName(b)))
    .slice(0, 25)
    .map((user) => ({
      name: `${actorName(user)} | DN ${user.dn || "-"}${user.discordId ?` | ${user.discordName || user.discordId}` : ""}`.slice(0, 100),
      value: user.id
    }));
}

function minAbsenceEndDate(startDate) {
  const minEnd = new Date(`${startDate}T00:00:00.000Z`);
  minEnd.setUTCDate(minEnd.getUTCDate() + 1);
  return minEnd.toISOString().slice(0, 10);
}

function createAbsenceForUser(db, user, actor, input) {
  const startDate = String(input.startDate || "").slice(0, 10);
  const endDate = String(input.endDate || "").slice(0, 10);
  const reason = String(input.reason || "").trim();
  const today = todayIso();
  const minStart = new Date(`${today}T00:00:00.000Z`);
  minStart.setUTCDate(minStart.getUTCDate() - 1);
  const minStartIso = minStart.toISOString().slice(0, 10);
  if (!startDate || !endDate) throw new Error("Bitte Beginn und Ende ausw\u00e4hlen.");
  if (startDate < minStartIso) throw new Error("Der Beginn darf maximal 1 Tag in der Vergangenheit liegen.");
  if (endDate < minAbsenceEndDate(startDate)) throw new Error("Abmeldungen m\u00fcssen mindestens 1 Tag laufen.");
  if (!reason) throw new Error("Bitte einen kurzen Grund angeben.");
  const absence = {
    id: makeId("absence"),
    userId: user.id,
    startDate,
    endDate,
    reason,
    createdAt: nowIso(),
    createdBy: actor.id,
    endedAt: "",
    endedBy: "",
    endReason: ""
  };
  db.absences.unshift(absence);
  logAction(db, actor, "Abmeldung erstellt", `${startDate} bis ${endDate}`, { absenceId: absence.id, userId: user.id, reason });
  return absence;
}

function endAbsenceForUser(db, absence, actor, reason = "") {
  if (!absence) throw new Error("Abmeldung nicht gefunden.");
  const isOwner = absence.userId === actor.id;
  const isManager = canManageAbsences(actor, db);
  if (!isOwner && !isManager) throw new Error("Du darfst diese Abmeldung nicht beenden.");
  if (absence.endedAt) throw new Error("Diese Abmeldung ist bereits beendet.");
  const endReason = String(reason || "").trim();
  if (isManager && !isOwner && !endReason) throw new Error("Bitte einen Grund f\u00fcr das fr\u00fchzeitige Beenden angeben.");
  absence.endedAt = nowIso();
  absence.endedBy = actor.id;
  absence.endReason = endReason || (isOwner ?"Selbst zur\u00fcckgezogen" : "Fr\u00fchzeitig beendet");
  const targetUser = db.users.find((item) => item.id === absence.userId);
  logAction(db, actor, "Abmeldung beendet", targetUser ?actorName(targetUser) : absence.userId, { absenceId: absence.id, userId: absence.userId, reason: absence.endReason });
  return absence;
}

function stopDutyForUser(db, targetUser, actor) {
  const active = db.duty.find((entry) => entry.userId === targetUser.id);
  if (!active) return false;
  const endedAt = nowIso();
  const history = db.dutyHistory.find((entry) => entry.id === active.id) || db.dutyHistory.find((entry) => entry.userId === targetUser.id && !entry.endedAt);
  if (history) history.endedAt = endedAt;
  else db.dutyHistory.push({ ...active, endedAt, manual: false });
  logAction(db, actor, "Dienst beendet", active.status, { userId: targetUser.id, before: active, endedAt, source: "Discord" });
  db.duty = db.duty.filter((entry) => entry.userId !== targetUser.id);
  return true;
}

function formatDateDe(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  if (!year || !month || !day) return String(value);
  return `${day}.${month}.${year}`;
}

async function handleDiscordCommandAutocomplete(interaction) {
  const db = readDb();
  const focused = interaction.options.getFocused();
  await interaction.respond(discordCommandUserChoices(db, interaction.commandName, focused));
}

async function handleDiscordResetCommand(interaction) {
  const db = readDb();
  const actor = discordCommandActor(db, interaction.user);
  if (!actor) {
    await interaction.reply({ content: "Du brauchst einen verknüpften Dienstblatt-Account mit IT-Rechten.", ephemeral: true });
    return;
  }
  const userId = String(interaction.options.getString("account") || "");
  const user = db.users.find((item) => item.id === userId && !item.terminated && !item.locked);
  if (!user) {
    await interaction.reply({ content: "Account nicht gefunden oder nicht aktiv.", ephemeral: true });
    return;
  }
  if (interaction.commandName === "resetdc" && !user.discordId) {
    await interaction.reply({ content: "Dieser Account hat keine Discord-Verknüpfung.", ephemeral: true });
    return;
  }
  try {
    if (interaction.commandName === "resetpw") {
      resetUserPassword(db, user, actor);
      writeDb(db);
      await interaction.reply({ content: `Passwort von ${actorName(user)} wurde auf das Standardpasswort zurückgesetzt.`, ephemeral: true });
      return;
    }
    resetUserDiscord(db, user, actor, "Discord Sync Reset per Discord Befehl");
    writeDb(db);
    await interaction.reply({ content: `Discord-Verknüpfung von ${actorName(user)} wurde entfernt.`, ephemeral: true });
  } catch (error) {
    await interaction.reply({ content: error.message || "Befehl fehlgeschlagen.", ephemeral: true });
  }
}

async function handleDiscordAbsenceCommand(interaction) {
  const db = readDb();
  const user = discordLinkedUser(db, interaction.user);
  if (!user) {
    await interaction.reply({ content: "Du brauchst einen verkn\u00fcpften Dienstblatt-Account.", ephemeral: true });
    return;
  }
  const tomorrow = new Date(`${todayIso()}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const modal = new ModalBuilder()
    .setCustomId("absence:create")
    .setTitle("Abmeldung erstellen");
  const makeInput = (id, label, value = "", style = TextInputStyle.Short) => {
    const input = new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setRequired(true)
      .setStyle(style);
    if (value) input.setValue(value);
    return new ActionRowBuilder().addComponents(input);
  };
  modal.addComponents(
    makeInput("startDate", "Beginn (YYYY-MM-DD)", todayIso()),
    makeInput("endDate", "Ende (YYYY-MM-DD)", tomorrow.toISOString().slice(0, 10)),
    makeInput("reason", "Grund", "", TextInputStyle.Paragraph)
  );
  await interaction.showModal(modal);
}

async function handleDiscordAbsenceModal(interaction) {
  const db = readDb();
  const user = discordLinkedUser(db, interaction.user);
  if (!user) {
    await interaction.reply({ content: "Du brauchst einen verkn\u00fcpften Dienstblatt-Account.", ephemeral: true });
    return;
  }
  try {
    const absence = createAbsenceForUser(db, user, user, {
      startDate: interaction.fields.getTextInputValue("startDate"),
      endDate: interaction.fields.getTextInputValue("endDate"),
      reason: interaction.fields.getTextInputValue("reason")
    });
    writeDb(db);
    const embed = new EmbedBuilder()
      .setTitle("Abmeldung erstellt")
      .setColor(0x22c55e)
      .setDescription(`${formatDateDe(absence.startDate)} bis ${formatDateDe(absence.endDate)}`)
      .addFields({ name: "Grund", value: absence.reason.slice(0, 1024) || "-", inline: false });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (error) {
    await interaction.reply({ content: error.message || "Abmeldung konnte nicht erstellt werden.", ephemeral: true });
  }
}

function discordAbsenceOverview(db, user) {
  const today = todayIso();
  const absences = (db.absences || [])
    .filter((absence) => absence.userId === user.id)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const open = absences.filter((absence) => !absence.endedAt && String(absence.endDate || "") >= today);
  const archive = absences.filter((absence) => absence.endedAt || String(absence.endDate || "") < today).slice(0, 5);
  const formatEntry = (absence, index) => {
    const status = absence.endedAt ?`beendet: ${absence.endReason || "-"}` : (isAbsenceActive(absence, today) ?"aktiv" : "geplant");
    return `**${index + 1}.** ${formatDateDe(absence.startDate)} bis ${formatDateDe(absence.endDate)} - ${status}\n${absence.reason || "-"}`;
  };
  const embed = new EmbedBuilder()
    .setTitle("Deine Abmeldungen")
    .setColor(0x3b82f6)
    .setDescription(absences.length ?`${open.length} aktive/geplante Abmeldung(en).` : "Keine Abmeldungen vorhanden.");
  embed.addFields({
    name: "Aktiv / geplant",
    value: open.length ?open.slice(0, 8).map(formatEntry).join("\n\n").slice(0, 1024) : "Keine offenen Abmeldungen.",
    inline: false
  });
  if (archive.length) {
    embed.addFields({
      name: "Archiv",
      value: archive.map(formatEntry).join("\n\n").slice(0, 1024),
      inline: false
    });
  }
  const rows = [];
  const buttons = open.slice(0, 5).map((absence) => new ButtonBuilder()
    .setCustomId(`absence:end:${absence.id}`)
    .setLabel(`Beenden ${formatDateDe(absence.startDate)}`)
    .setStyle(ButtonStyle.Danger));
  if (buttons.length) rows.push(new ActionRowBuilder().addComponents(buttons));
  return { embed, rows };
}

async function handleDiscordAbsencesCommand(interaction) {
  const db = readDb();
  const user = discordLinkedUser(db, interaction.user);
  if (!user) {
    await interaction.reply({ content: "Du brauchst einen verkn\u00fcpften Dienstblatt-Account.", ephemeral: true });
    return;
  }
  const overview = discordAbsenceOverview(db, user);
  await interaction.reply({ embeds: [overview.embed], components: overview.rows, ephemeral: true });
}

async function handleDiscordAbsenceEndButton(interaction) {
  const db = readDb();
  const user = discordLinkedUser(db, interaction.user);
  if (!user) {
    await interaction.update({ content: "Du brauchst einen verkn\u00fcpften Dienstblatt-Account.", embeds: [], components: [] });
    return;
  }
  const absenceId = String(interaction.customId || "").split(":").slice(2).join(":");
  const absence = (db.absences || []).find((item) => item.id === absenceId);
  try {
    if (!absence || absence.userId !== user.id) throw new Error("Abmeldung nicht gefunden.");
    endAbsenceForUser(db, absence, user, "Per Discord beendet");
    writeDb(db);
    const overview = discordAbsenceOverview(db, user);
    overview.embed.setTitle("Abmeldung beendet").setColor(0x22c55e);
    await interaction.update({ embeds: [overview.embed], components: overview.rows });
  } catch (error) {
    await interaction.update({ content: error.message || "Abmeldung konnte nicht beendet werden.", embeds: [], components: [] });
  }
}

async function handleDiscordLogoffCommand(interaction) {
  const db = readDb();
  const actor = discordLinkedUser(db, interaction.user);
  if (!actor) {
    await interaction.reply({ content: "Du brauchst einen verkn\u00fcpften Dienstblatt-Account.", ephemeral: true });
    return;
  }
  const targetId = String(interaction.options.getString("account") || actor.id);
  const target = db.users.find((user) => user.id === targetId && !user.terminated && !user.locked);
  if (!target) {
    await interaction.reply({ content: "Account nicht gefunden oder nicht aktiv.", ephemeral: true });
    return;
  }
  if (target.id !== actor.id && !hasPermission(actor, db, "actions", "stopSingleDuty", "User")) {
    await interaction.reply({ content: "Du darfst andere Personen nicht aus dem Dienst austragen.", ephemeral: true });
    return;
  }
  const stopped = stopDutyForUser(db, target, actor);
  if (stopped) writeDb(db);
  const embed = new EmbedBuilder()
    .setTitle(stopped ?"Dienst beendet" : "Nicht im Dienst")
    .setColor(stopped ?0x22c55e : 0xf59e0b)
    .setDescription(`${actorName(target)} ${stopped ?"wurde aus dem Dienst ausgetragen." : "war nicht im Dienst eingetragen."}`);
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleDiscordDbCreateCommand(interaction) {
  const db = readDb();
  const actor = discordCommandActor(db, interaction.user, "Direktion");
  if (!actor) {
    await interaction.reply({ content: "Du brauchst einen verknüpften Dienstblatt-Account mit Direktion- oder IT-Rechten.", ephemeral: true });
    return;
  }
  const discordUser = interaction.options.getUser("discorduser");
  const frakverwalter = Boolean(interaction.options.getBoolean("frakverwalter"));
  if (!discordUser) {
    await interaction.reply({ content: "Discord-User fehlt.", ephemeral: true });
    return;
  }
  const modal = new ModalBuilder()
    .setCustomId(`dbcreate:${frakverwalter ?"frak" : "normal"}:${discordUser.id}`)
    .setTitle(frakverwalter ?"Frakverwalter Account" : "Dienstblatt Account");
  const makeInput = (id, label, required = true, value = "") => {
    const input = new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setRequired(required)
      .setStyle(TextInputStyle.Short);
    if (value) input.setValue(value);
    return new ActionRowBuilder().addComponents(input);
  };
  modal.addComponents(
    makeInput("firstName", frakverwalter ?"Name" : "Vorname"),
    makeInput("lastName", "Nachname", !frakverwalter)
  );
  if (!frakverwalter) {
    modal.addComponents(
      makeInput("rank", "Rang"),
      makeInput("phone", "Telefonnummer"),
      makeInput("dn", "Dienstnummer", true, nextFreeDienstnummer(db))
    );
  }
  await interaction.showModal(modal);
}

async function handleDiscordDbCreateModal(interaction) {
  const [, mode, discordId] = String(interaction.customId || "").split(":");
  const db = readDb();
  const actor = discordCommandActor(db, interaction.user, "Direktion");
  if (!actor) {
    await interaction.reply({ content: "Du brauchst einen verknüpften Dienstblatt-Account mit Direktion- oder IT-Rechten.", ephemeral: true });
    return;
  }
  const discordUser = await discordClient?.users.fetch(discordId).catch(() => null);
  try {
    const firstName = interaction.fields.getTextInputValue("firstName");
    const lastName = interaction.fields.getTextInputValue("lastName");
    const user = mode === "frak"
      ?createFrakverwaltungUser(db, actor, {
        firstName,
        lastName,
        discordId,
        discordName: discordUser?.globalName || discordUser?.username || ""
      })
      : createDienstblattUser(db, actor, {
        firstName,
        lastName,
        phone: interaction.fields.getTextInputValue("phone"),
        dn: interaction.fields.getTextInputValue("dn"),
        rank: interaction.fields.getTextInputValue("rank"),
        role: "User",
        baseRole: "User",
        joinedAt: todayIso(),
        trainings: {},
        departments: [],
        discordId,
        discordName: discordUser?.globalName || discordUser?.username || ""
      });
    writeDb(db);
    await notifyDiscordDbCreateWelcome(interaction, discordUser, user, String(db.settings.defaultPassword || DEFAULT_PASSWORD));
    const accountDataFields = mode === "frak"
      ?[
        { name: "Vorname / Name", value: user.firstName || "-", inline: true },
        { name: "Nachname", value: user.lastName || "-", inline: true },
        { name: "Rolle", value: "Frakverwalter", inline: true }
      ]
      :[
        { name: "Vorname", value: user.firstName || "-", inline: true },
        { name: "Nachname", value: user.lastName || "-", inline: true },
        { name: "Dienstnummer", value: user.dn || "-", inline: true },
        { name: "Rang", value: `${user.rank ?? "-"} (${rankText(db, user.rank)})`, inline: true },
        { name: "Telefonnummer", value: user.phone || "-", inline: true },
        { name: "Rolle", value: user.baseRole || user.role || "User", inline: true }
      ];
    await sendDiscordItLog(db, {
      title: "Dienstblatt Account erstellt",
      color: 0x2877ff,
      description: `**${actorName(actor)}** hat für **${actorName(user)}** einen Account erstellt.`,
      fields: [
        { name: "Erstellt von", value: actorName(actor), inline: true },
        { name: "Account", value: actorName(user), inline: true },
        { name: "Typ", value: mode === "frak" ?"Frakverwalter" : "Dienstblatt", inline: true },
        ...accountDataFields,
        { name: "Aktiviert", value: user.mustChangePassword ?"Nein, Standardpasswort muss noch geändert werden." : "Ja", inline: false },
        { name: "Discord", value: discordUser ?`${discordUser.globalName || discordUser.username} (${discordUser.id})` : discordId, inline: false }
      ]
    });
    const confirmEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Account erstellt")
      .setDescription(mode === "frak"
        ?`Frakverwalter-Account für **${actorName(user)}** wurde erstellt und mit Discord verknüpft.`
        :`Dienstblatt-Account für **${actorName(user)}** wurde erstellt und mit Discord verknüpft.`)
      .addFields(
        { name: "Account", value: actorName(user), inline: true },
        { name: "Erstellt von", value: actorName(actor), inline: true },
        { name: "Discord", value: discordUser ?`${discordUser.globalName || discordUser.username} (${discordUser.id})` : discordId, inline: false },
        ...(mode === "frak" ?[] : [
          { name: "Dienstnummer", value: user.dn || "-", inline: true },
          { name: "Rang", value: rankText(db, user.rank), inline: true }
        ])
      )
      .setTimestamp()
      .setFooter({ text: DISCORD_SYNC_PANEL_FOOTER });
    await interaction.reply({
      embeds: [confirmEmbed],
      ephemeral: true
    });
  } catch (error) {
    await interaction.reply({ content: error.message || "Account konnte nicht erstellt werden.", ephemeral: true });
  }
}

function discordWebsiteLink(sync) {
  const configured = normalizePublicUrl(db.settings?.publicBaseUrl || process.env.PUBLIC_BASE_URL || sync.oauthRedirectUrl || PUBLIC_BASE_URL, PUBLIC_BASE_URL);
  try {
    const url = new URL(configured || `http://localhost:${PORT}/`);
    url.hash = "";
    url.search = "";
    url.pathname = "/";
    url.searchParams.set("discord", "link");
    return url.toString();
  } catch {
    return `http://localhost:${PORT}/?discord=link`;
  }
}

function discordSyncEmbed(sync, member = null, linkedUser = null) {
  const title = linkedUser ?"Discord Sync erfolgreich" : "LSPD Dienstblatt verkn\u00fcpfen";
  const websiteUrl = discordWebsiteLink(sync);
  const loginUrl = websiteUrl.replace("?discord=link", "");
  const description = linkedUser
    ?`Dein Discord wurde mit **${actorName(linkedUser)}** verbunden.\n\nDiscord synchronisiert jetzt automatisch deine Rollen und deinen Namen, sobald sich im Dienstblatt etwas \u00e4ndert.`
    : [
      "**Dienstblatt Login & Discord-Verknüpfung**",
      "",
      `**Website:** ${loginUrl}`,
      "",
      "Bitte melde dich einmal auf der Website mit deinem Dienstblatt-Account an.",
      "Beim ersten Login musst du zuerst dein Standardpasswort ändern.",
      "",
      "Danach kannst du deinen Discord verknüpfen:",
      "• über den Button unter dieser Nachricht",
      "• oder auf der Website im Reiter **Profil**",
      "",
      "Nach der Verknüpfung werden Rollen und Name automatisch mit dem Dienstblatt synchronisiert."
    ].join("\n");
  const embed = new EmbedBuilder()
    .setColor(linkedUser ?0x22c55e : 0x2877ff)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp()
    .setFooter({ text: DISCORD_SYNC_PANEL_FOOTER });
  if (member) embed.setAuthor({ name: member.user?.tag || member.user?.username || "Neuer Discord Beitritt" });
  return embed;
}

function discordSyncButton(sync) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel("Discord mit Dienstblatt verkn\u00fcpfen")
      .setURL(discordWebsiteLink(sync))
  );
}

async function sendDiscordSyncPanel(client, sync) {
  if (!sync.syncChannelId) return;
  const channel = await client.channels.fetch(sync.syncChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const payload = { embeds: [discordSyncEmbed(sync)], components: [discordSyncButton(sync)] };
  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    const existing = messages.find((message) => message.author?.id === client.user?.id && message.embeds?.some((embed) => LEGACY_DISCORD_SYNC_PANEL_FOOTERS.includes(embed.footer?.text)));
    if (existing) {
      await existing.edit(payload);
      return;
    }
  } catch (error) {
    console.warn("Discord Sync Panel konnte nicht gesucht werden:", error.message);
  }
  await channel.send(payload).catch((error) => console.warn("Discord Sync Panel konnte nicht gesendet werden:", error.message));
}

function startDiscordBot() {
  if (discordClient?.isReady?.()) return;
  if (discordClient && !discordClient.isReady?.()) {
    discordClient.destroy?.();
    discordClient = null;
  }
  if (discordBotStarting) return;
  const db = readDb();
  const sync = normalizeDiscordSync(db.settings?.discordSync);
  if (!sync.enabled || !sync.botToken || !sync.serverId) return;
  discordBotStarting = true;
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember]
  });
  let readyHandled = false;
  const handleReady = async () => {
    if (readyHandled) return;
    readyHandled = true;
    discordClient = client;
    discordBotStarting = false;
    const readyDb = readDb();
    const readySync = normalizeDiscordSync(readyDb.settings?.discordSync);
    console.log(`Discord Bot aktiv als ${client.user?.tag || "Bot"}`);
    await registerDiscordCommands(client, readySync).catch((error) => console.warn("Discord Befehle konnten nicht registriert werden:", error.message));
    await sendDiscordSyncPanel(client, readySync);
  };
  client.once(Events.ClientReady, handleReady);
  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isAutocomplete()) {
        if (["resetpw", "resetdc", "logoff"].includes(interaction.commandName)) await handleDiscordCommandAutocomplete(interaction);
        return;
      }
      if (interaction.isChatInputCommand() && ["resetpw", "resetdc"].includes(interaction.commandName)) {
        await handleDiscordResetCommand(interaction);
        return;
      }
      if (interaction.isChatInputCommand() && interaction.commandName === "abmelden") {
        await handleDiscordAbsenceCommand(interaction);
        return;
      }
      if (interaction.isChatInputCommand() && interaction.commandName === "abmeldungen") {
        await handleDiscordAbsencesCommand(interaction);
        return;
      }
      if (interaction.isChatInputCommand() && interaction.commandName === "logoff") {
        await handleDiscordLogoffCommand(interaction);
        return;
      }
      if (interaction.isChatInputCommand() && interaction.commandName === "dbcreate") {
        await handleDiscordDbCreateCommand(interaction);
        return;
      }
      if (interaction.isModalSubmit() && String(interaction.customId || "").startsWith("dbcreate:")) {
        await handleDiscordDbCreateModal(interaction);
        return;
      }
      if (interaction.isModalSubmit() && interaction.customId === "absence:create") {
        await handleDiscordAbsenceModal(interaction);
        return;
      }
      if (interaction.isButton() && String(interaction.customId || "").startsWith("absence:end:")) {
        await handleDiscordAbsenceEndButton(interaction);
      }
    } catch (error) {
      console.warn("Discord Befehl fehlgeschlagen:", error.message);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Befehl fehlgeschlagen.", ephemeral: true }).catch(() => {});
      }
    }
  });
  client.on("guildMemberAdd", async (member) => {
    const joinDb = readDb();
    const joinSync = normalizeDiscordSync(joinDb.settings?.discordSync);
    if (member.guild.id !== joinSync.serverId) return;
    const linkedUser = joinDb.users.find((user) => !user.terminated && user.discordId === member.id);
    if (linkedUser && !linkedUser.mustChangePassword) {
      syncDiscordRolesForUser(joinDb, linkedUser, "Discord Beitritt");
      return;
    }
    await assignDiscordUnsyncedRole(joinSync, member.id, linkedUser ? "Account noch nicht aktiviert" : "Neuer Discord Beitritt").catch((error) => {
      console.warn("DC Sync fehlt Rolle konnte nicht vergeben werden:", error.message);
    });
  });
  const markDiscordClientOffline = (message) => {
    if (discordClient === client) discordClient = null;
    discordBotStarting = false;
    console.warn(message);
  };
  client.on("error", (error) => console.warn("Discord Bot Fehler:", error.message));
  client.on("invalidated", () => markDiscordClientOffline("Discord Bot Session wurde invalidiert."));
  client.on("shardDisconnect", () => console.warn("Discord Bot Verbindung getrennt, Discord.js versucht automatisch neu zu verbinden."));
  client.login(sync.botToken).catch((error) => {
    discordBotStarting = false;
    discordClient = null;
    console.warn("Discord Bot konnte nicht gestartet werden:", error.message);
  });
}

async function announceDiscordLink(db, user) {
  await notifyDiscordUser(user, `Dein Account wurde mit **${actorName(user)}** im LSPD Dienstblatt verkn\u00fcpft. Rollen und Name werden automatisch synchronisiert.`);
}

function logFluctuation(db, user, type, actor) {
  db.settings.fluctuation.unshift({
    id: makeId("fluctuation"),
    type,
    userId: user.id,
    name: `${user.firstName} ${user.lastName}`.trim(),
    dn: user.dn,
    rank: user.rank,
    role: user.role,
    baseRole: user.baseRole,
    actorName: actorName(actor),
    reason: "",
    createdAt: nowIso()
  });
}

function logAction(db, actor, action, target = "", details = {}) {
  db.logs = normalizeLogs(db.logs);
  db.logs.unshift({
    id: makeId("log"),
    action,
    target,
    actorId: actor?.id || "",
    actorName: actorName(actor),
    details: sanitizeLogDetails(details),
    createdAt: nowIso()
  });
  db.logs = db.logs.slice(0, MAX_LOG_ENTRIES);
}

function logDisciplinary(db, user, type, reason, actor) {
  db.disciplinary = Array.isArray(db.disciplinary) ?db.disciplinary : [];
  db.disciplinary.unshift({
    id: makeId("disciplinary"),
    type,
    userId: user.id,
    name: `${user.firstName} ${user.lastName}`.trim(),
    dn: user.dn,
    rank: user.rank,
    actorName: actorName(actor),
    reason,
    createdAt: nowIso()
  });
}

function isActiveStrike(entry) {
  const isStrike = entry.type === "Strike" || (entry.type === "Sanktion" && entry.sanctionType === "Strike");
  if (!isStrike || entry.archivedAt || entry.strikeResolvedAt) return false;
  if (entry.expiresAt && new Date(entry.expiresAt) <= new Date()) return false;
  if (entry.workflowStatus || entry.submittedAt || entry.approvedAt || entry.announcedAt) return sanctionWorkflowStatus(entry) === "active";
  return true;
}

function activeStrikeCount(entries, userId) {
  return entries
    .filter((entry) => entry.userId === userId && isActiveStrike(entry))
    .reduce((sum, entry) => sum + Math.max(1, Number(entry.strikeCount || 1)), 0);
}

function activeNegativeEntries(entries, userId) {
  const now = new Date();
  return (entries || []).filter((entry) => {
    if (entry.userId !== userId) return false;
    if (entry.type === "Aktennotiz") return false;
    if (entry.archivedAt) return false;
    const workflow = sanctionWorkflowStatus(entry);
    if (workflow === "pending_approval") return false;
    if (workflow === "open") return true;
    if (workflow === "rejected") return false;
    if (workflow === "archive") return false;
    const hasFine = entry.sanctionType === "Geldstrafe" || entry.type === "Geldstrafe" || Number(entry.amount || 0) > 0;
    if (hasFine && !entry.paidAt) return true;
    if (entry.type === "Sanktion" || entry.type === "Strike") {
      const hasStrike = entry.type === "Strike" || entry.sanctionType === "Strike" || Number(entry.strikeCount || 0) > 0;
      if (hasStrike && !entry.strikeResolvedAt) {
        if (entry.expiresAt && new Date(entry.expiresAt) <= now) return false;
        return true;
      }
      if (entry.uprankBlockedUntil && entry.uprankBlockedUntil >= todayIso()) return true;
      if (entry.expiresAt && new Date(entry.expiresAt) <= now) return false;
    }
    return false;
  });
}

function canManagePersonnelFiles(user, db) {
  return hasPermission(user, db, "actions", "personnelFiles", "Direktion");
}

function isSanctionFileEntry(entry) {
  return Boolean(entry && (entry.type === "Sanktion" || entry.type === "Strike" || entry.type === "Geldstrafe" || entry.sanctionType === "Geldstrafe" || Number(entry.amount || 0) > 0));
}

function sanctionWorkflowStatus(entry) {
  if (!isSanctionFileEntry(entry)) return "";
  if (entry.archivedAt) return "archive";
  if (entry.rejectedAt || entry.workflowStatus === "rejected") return "rejected";
  if (entry.expiresAt && new Date(entry.expiresAt) <= new Date()) return "archive";
  const hasWorkflow = Boolean(entry.workflowStatus || entry.submittedAt || entry.approvedAt || entry.announcedAt || entry.rejectedAt);
  if (hasWorkflow) {
    if (!entry.approvedAt && entry.workflowStatus !== "open" && entry.workflowStatus !== "active") return "pending_approval";
    if (!entry.announcedAt) return "open";
    if ((entry.sanctionType === "Geldstrafe" || entry.type === "Geldstrafe" || Number(entry.amount || 0) > 0) && !entry.paidAt) return "open";
    return "active";
  }
  if ((entry.sanctionType === "Geldstrafe" || entry.type === "Geldstrafe" || Number(entry.amount || 0) > 0) && !entry.paidAt) return "open";
  if ((entry.type === "Strike" || entry.sanctionType === "Strike" || Number(entry.strikeCount || 0) > 0) && !entry.strikeResolvedAt) return "active";
  if (entry.uprankBlockedUntil && entry.uprankBlockedUntil >= todayIso()) return "active";
  return "archive";
}

function canApprovePersonnelSanctions(user, db) {
  if (!user) return false;
  if ((rolePower[user.role] || 0) >= rolePower.Direktion) return true;
  const hr = (db.settings?.departments || []).find((department) => /(human|humane|ressource|resource|hr|personalabteilung|personal)/i.test(cleanText(department.name || "")));
  return canManageDepartmentAction(user, hr, db, "departmentLeadership");
}

function canCreateCustomSanctions(user, db) {
  if (!user) return false;
  if ((rolePower[user.role] || 0) >= rolePower.IT || user.role === "Direktion") return true;
  const hr = (db.settings?.departments || []).find((department) => /(human|humane|ressource|resource|hr|personalabteilung|personal)/i.test(cleanText(department.name || "")));
  return canManageDepartmentAction(user, hr, db, "departmentLeadership");
}

function sanctionFineRangeFromText(value) {
  const text = String(value || "");
  const amounts = [...text.matchAll(/\d[\d.]*/g)]
    .map((match) => Number(String(match[0] || "").replace(/\./g, "")))
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  if (!amounts.length) return null;
  const min = Math.min(...amounts);
  const max = amounts.length > 1 ?Math.max(...amounts) : min;
  return { min, max, text };
}

function canOverrideSanctionFineRange(user, db) {
  return canCreateCustomSanctions(user, db);
}

function setAccountStatus(user, status) {
  user.accountStatus = status;
  user.locked = ["Gesperrt", "Suspendiert", "Entlassen"].includes(status);
}

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const db = readDb();
  const { session, user } = userFromSessionToken(db, token);
  if (!session) return res.status(401).json({ error: "Nicht angemeldet." });

  if (!user || user.locked || user.terminated) return res.status(401).json({ error: "Account gesperrt, entlassen oder nicht gefunden." });

  req.db = db;
  req.session = session;
  req.user = user;
  next();
}

function requireRole(minRole) {
  return (req, res, next) => {
    if ((rolePower[req.user.role] || 0) < rolePower[minRole]) {
      return res.status(403).json({ error: "Keine Berechtigung." });
    }
    next();
  };
}

function cleanupActiveWebClients() {
  const cutoff = Date.now() - 45_000;
  for (const [token, entry] of activeWebClients.entries()) {
    if (!entry?.lastSeenMs || entry.lastSeenMs < cutoff) activeWebClients.delete(token);
  }
}

function updateActiveWebClient(req, page = "") {
  if (!req?.session?.token || !req.user) return;
  activeWebClients.set(req.session.token, {
    token: req.session.token,
    userId: req.user.id,
    page: String(page || ""),
    lastSeenAt: nowIso(),
    lastSeenMs: Date.now(),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 180)
  });
}

function activeWebClientRows(db) {
  cleanupActiveWebClients();
  return [...activeWebClients.values()]
    .map((entry) => {
      const user = db.users.find((item) => item.id === entry.userId && !item.terminated);
      if (!user) return null;
      return {
        id: `${entry.userId}:${entry.token.slice(0, 8)}`,
        user: publicUser(user),
        page: entry.page,
        lastSeenAt: entry.lastSeenAt,
        secondsAgo: Math.max(0, Math.round((Date.now() - entry.lastSeenMs) / 1000)),
        browser: entry.userAgent
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.secondsAgo - b.secondsAgo || actorName(a.user).localeCompare(actorName(b.user), "de"));
}

function cleanupJumpscareEvents() {
  const cutoff = Date.now() - 60_000;
  for (const [userId, event] of jumpscareEvents.entries()) {
    if (!event?.createdMs || event.createdMs < cutoff) jumpscareEvents.delete(userId);
  }
}

function hasPermission(user, db, area, key, fallbackRole = "IT") {
  if ((rolePower[user.role] || 0) >= rolePower.IT) return true;
  if (user.role === "Direktion" && key !== "IT") return true;
  const rule = db.settings.permissions?.[area]?.[key];
  if (!rule) return (rolePower[user.role] || 0) >= (rolePower[fallbackRole] || 99);
  const departmentMatch = (rule.departments || []).some((departmentId) => {
    const department = db.settings.departments.find((item) => item.id === departmentId);
    return department?.members.some((member) => member.userId === user.id);
  });
  const positionMatch = (rule.positions || []).some((positionKey) => {
    const [departmentId, position] = String(positionKey).split(":");
    const department = db.settings.departments.find((item) => item.id === departmentId);
    return department?.members.some((member) => member.userId === user.id && member.position === position);
  });
  return rule.all || rule.users.includes(user.id) || rule.roles.includes(user.role) || rule.ranks.includes(Number(user.rank)) || departmentMatch || positionMatch;
}

function requirePermission(area, key, fallbackRole = "IT") {
  return (req, res, next) => {
    if (!hasPermission(req.user, req.db, area, key, fallbackRole)) {
      return res.status(403).json({ error: "Keine Berechtigung." });
    }
    next();
  };
}

function getDepartment(db, departmentId) {
  return db.settings.departments.find((department) => department.id === departmentId);
}

function isDetectiveDepartment(department) {
  const haystack = `${department?.id || ""} ${department?.name || ""}`.toLowerCase();
  return haystack.includes("detective");
}

function canUserStartDuty(db, user) {
  if (!user) return false;
  return (db.settings?.departments || []).some((department) =>
    isDetectiveDepartment(department)
    && (department.members || []).some((member) => member.userId === user.id)
  );
}

function syncDirektionMembership(db, user, options = {}) {
  const department = getDepartment(db, "direktion");
  if (!department || !user) return;
  const hasDirektionRole = !user.terminated && user.role === "Direktion";
  if (options.roleAssigned) user.direktionManualRemoved = false;
  if (hasDirektionRole) {
    db.settings.departments.forEach((item) => {
      if (item.id !== "direktion") item.members = item.members.filter((member) => !(member.userId === user.id && member.position === "Direktion"));
    });
    if (user.direktionManualRemoved) return;
    if (!department.members.some((member) => member.userId === user.id)) {
      department.members.push({
        userId: user.id,
        position: "Direktion",
        joinedAt: todayIso(),
        positionSince: todayIso(),
        autoRoleDirektion: true
      });
    }
    return;
  }
  const beforeLength = department.members.length;
  department.members = department.members.filter((member) => member.userId !== user.id);
  if (beforeLength !== department.members.length) user.direktionManualRemoved = false;
}

function isDepartmentManager(user, department, db = null) {
  if (!department) return false;
  if ((rolePower[user.role] || 0) >= rolePower.IT || user.role === "Direktion") return true;
  if (db && hasPermission(user, db, "actions", `departmentManage:${department.id}`, "IT")) return true;
  const membership = department.members.find((member) => member.userId === user.id);
  return isDepartmentLeaderPosition(department, membership?.position);
}

function canManageDepartmentAction(user, department, db, action) {
  if (!department) return false;
  const key = `${action}:${department.id}`;
  const rule = db?.settings?.permissions?.actions?.[key];
  const membership = department.members.find((member) => member.userId === user.id);
  if (isSwatDepartment(department) && ["departmentLeadership", "departmentMembers"].includes(action) && isSwatTeamLeaderMember(membership)) return true;
  if (rule) return hasPermission(user, db, "actions", key, "IT");
  if (action === "departmentLeadership") {
    if ((rolePower[user.role] || 0) >= rolePower.Direktion) return true;
    return isDepartmentLeaderPosition(department, membership?.position);
  }
  return isDepartmentManager(user, department, db);
}

function canManageAbsences(user, db) {
  if (!user) return false;
  if ((rolePower[user.role] || 0) >= rolePower.Direktion) return true;
  const hr = (db.settings?.departments || []).find((department) => department.id === "human-resources");
  const membership = hr?.members?.find((member) => member.userId === user.id);
  return ["Direktion", "Leitung", "Stv. Leitung"].includes(membership?.position);
}

function canAssignDepartmentPosition(user, department, position, db = null) {
  if (isSwatDepartment(department) && ["Abteilungsleiter", "Mitglied"].includes(position)) {
    if ((rolePower[user.role] || 0) >= rolePower.Direktion) return true;
    const membership = department.members.find((member) => member.userId === user.id);
    return Boolean(isSwatTeamLeaderMember(membership) && position === "Mitglied");
  }
  if (!departmentPositionsFor(department).includes(position)) return false;
  if (position === "Direktion") return user.role === "Direktion" || user.role === "IT-Leitung";
  if ((rolePower[user.role] || 0) >= rolePower.Direktion) return true;
  const membership = department.members.find((member) => member.userId === user.id);
  const actorPower = positionPowerFor(department, membership?.position);
  return actorPower > positionPowerFor(department, position);
}

function canTouchDepartmentMemberPosition(user, department, position) {
  if (!position) return false;
  if (user.role === "Direktion" || (rolePower[user.role] || 0) >= rolePower.IT) return true;
  if (isSwatDepartment(department)) {
    const membership = department.members.find((member) => member.userId === user.id);
    return Boolean(isSwatTeamLeaderMember(membership) && position === "Mitglied");
  }
  if (position === "Direktion") return false;
  const membership = department.members.find((member) => member.userId === user.id);
  return positionPowerFor(department, membership?.position) > positionPowerFor(department, position);
}

function canSeeDepartmentPage(user, department, db = null) {
  if (!department) return false;
  if (user?.role === "Template") return true;
  if (isSwatDepartment(department)) return true;
  if ((rolePower[user.role] || 0) >= rolePower.Direktion) return true;
  if (db && hasPermission(user, db, "pages", `dept:${department.id}`, "IT")) return true;
  return department.members.some((member) => member.userId === user.id);
}

function publicDepartment(department, db, currentUser) {
  const dutyIds = new Set(db.duty.map((entry) => entry.userId));
  const visibleNotes = (department.notes || []).filter((note) => canViewSwatTeamContent(currentUser, department, note.team || "all", db));
  return {
    ...department,
    canManage: isDepartmentManager(currentUser, department, db),
    canOpen: canSeeDepartmentPage(currentUser, department, db),
    notes: visibleNotes,
    swatStatus: isSwatDepartment(department) ?normalizeSwatStatus(department.swatStatus) : {},
    members: department.members
      .map((member) => {
        const user = db.users.find((item) => item.id === member.userId);
        return user && !user.terminated ?{ ...member, user: publicUser(user), isOnDuty: dutyIds.has(user.id) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (isSwatDepartment(department)) {
          const teamCompare = normalizeSwatTeam(a.swatTeam, "Z").localeCompare(normalizeSwatTeam(b.swatTeam, "Z"), "de");
          if (teamCompare) return teamCompare;
          if (isSwatTeamLeaderMember(a) !== isSwatTeamLeaderMember(b)) return isSwatTeamLeaderMember(a) ?-1 : 1;
        }
        return positionPowerFor(department, b.position) - positionPowerFor(department, a.position) || b.user.rank - a.user.rank;
      })
  };
}

function canGrantItRoles(actor) {
  return actor?.role === "IT-Leitung";
}

function protectItRoleChange(actor, existingRole, requestedRole) {
  const before = existingRole || "User";
  const next = roles.includes(requestedRole) ?requestedRole : before;
  const touchesItRole = ["Template", "IT", "IT-Leitung"].includes(before) || ["Template", "IT", "IT-Leitung"].includes(next);
  if (touchesItRole && before !== next && !canGrantItRoles(actor)) {
    return { error: "Nur die IT-Leitung darf Template-, IT- oder IT-Leitung-Rollen vergeben oder entfernen." };
  }
  return { role: next };
}

function canBypassRankHierarchy(actor) {
  return (rolePower[actor?.role] || 0) >= rolePower.IT;
}

function assertCanAffectUser(actor, target, action = "bearbeiten") {
  if (!actor || !target) return "Benutzer nicht gefunden.";
  if (canBypassRankHierarchy(actor)) return null;
  if (actor.id === target.id) return `Du kannst dich nicht selbst ${action}.`;
  if ((rolePower[actor.role] || 0) >= rolePower.Direktion && Number(actor.rank || 0) > Number(target.rank || 0)) return null;
  return "Du darfst nur Mitglieder unter deinem eigenen Rang bearbeiten.";
}

function assertCanSetUserRank(actor, rank) {
  if (canBypassRankHierarchy(actor)) return null;
  if ((rolePower[actor?.role] || 0) >= rolePower.Direktion && Number(rank || 0) < Number(actor.rank || 0)) return null;
  return "Du darfst nur Ränge unter deinem eigenen Rang vergeben.";
}

function validateDigits(value, field) {
  if (!/^\d+$/.test(String(value || ""))) {
    return `${field} darf nur Zahlen enthalten.`;
  }
  return null;
}

function normalizeUserInput(body, existingUser) {
  const firstName = String(body.firstName || "").trim();
  const lastName = String(body.lastName || "").trim();
  const phone = String(body.phone || "").trim();
  const dn = String(body.dn || "").trim();
  const discordId = Object.prototype.hasOwnProperty.call(body, "discordId")
    ?String(body.discordId || "").trim()
    : String(existingUser?.discordId || "").trim();
  const rankMatch = String(body.rank ?? "").match(/\d+/);
  const rank = rankMatch ?Number(rankMatch[0]) : NaN;
  const role = roles.includes(body.role) ?body.role : existingUser?.role || "User";
  const requestedBaseRole = String(body.baseRole || "").trim();
  const baseRole = roles.includes(requestedBaseRole) && !["Template", "IT", "IT-Leitung"].includes(requestedBaseRole)
    ?requestedBaseRole
    : existingUser?.baseRole || (["Template", "IT", "IT-Leitung"].includes(role) ?"Direktion" : role);
  const isFrakverwaltung = role === "Frakverwaltung" || baseRole === "Frakverwaltung";
  const departments = Array.isArray(body.departments) ?body.departments.map(String) : existingUser?.departments || [];
  const trainings = body.trainings && typeof body.trainings === "object" ?body.trainings : existingUser?.trainings || {};
  const teamler = Boolean(body.teamler);
  const joinedAt = String(body.joinedAt || existingUser?.joinedAt || todayIso()).slice(0, 10);

  if (isFrakverwaltung) {
    if (!firstName) return { error: "Name ist erforderlich." };
    if (discordId) {
      const discordIdError = validateDigits(discordId, "Discord User-ID");
      if (discordIdError) return { error: discordIdError };
    }
    return {
      value: {
        firstName,
        lastName,
        phone: "",
        dn: "",
        discordId,
        rank: 0,
        role: "Frakverwaltung",
        baseRole: "Frakverwaltung",
        teamler: false,
        joinedAt,
        departments: [],
        trainings: Object.fromEntries(trainingNames.map((training) => [training, false]))
      }
    };
  }

  if (!firstName || !lastName || !phone || !dn || Number.isNaN(rank)) {
    return { error: "Name, Nachname, Telefon, DN und Rang sind Pflichtfelder." };
  }

  const dnError = validateDigits(dn, "DN");
  if (dnError) return { error: dnError };
  if (discordId) {
    const discordIdError = validateDigits(discordId, "Discord User-ID");
    if (discordIdError) return { error: discordIdError };
  }
  if (rank < 0) return { error: "Rang muss mindestens 0 sein." };

  return {
    value: {
      firstName,
      lastName,
      phone,
      dn,
      discordId,
      rank,
      role,
      baseRole,
      teamler,
      joinedAt,
      departments,
      trainings
    }
  };
}

function dnConflictMessage(user) {
  const status = user.terminated ?"Entlassen" : user.accountStatus || (user.locked ?"Gesperrt" : "Aktiv");
  const dateText = user.terminated && user.termination?.terminatedAt ?`, entlassen am ${new Date(user.termination.terminatedAt).toLocaleString("de-DE")}` : "";
  return `${actorName(user)} (${status}${dateText})`;
}

function resolveDnConflict(db, currentUserId, dn, overwriteDn) {
  if (!String(dn || "").trim()) return null;
  const holder = db.users.find((item) => item.id !== currentUserId && item.dn === dn);
  const currentHolder = db.users.find((item) => item.id === currentUserId && item.dn === dn);
  if (isDnBlacklisted(db, dn) && !currentHolder) {
    return { error: `Diese Dienstnummer ist durch die Direktion gesperrt.` };
  }
  if (!holder) return null;
  if (!holder.terminated) {
    return { error: `Diese Dienstnummer ist bereits durch ${dnConflictMessage(holder)} vergeben.` };
  }
  if (!overwriteDn) {
    return { error: `Diese Dienstnummer ist bereits durch ${dnConflictMessage(holder)} vergeben. Zum Überschreiben bitte bestätigen.` };
  }
  holder.dn = "";
  holder.updatedAt = nowIso();
  return { holder };
}

function rankText(db, rank) {
  return (db.settings.ranks || []).find((item) => Number(item.value) === Number(rank))?.label || `Rang ${rank}`;
}

function userChangeSummary(db, before, after) {
  const changes = [];
  const fields = [
    ["firstName", "Vorname"],
    ["lastName", "Nachname"],
    ["phone", "Telefon"],
    ["dn", "Dienstnummer"],
    ["joinedAt", "Einstellungsdatum"],
    ["role", "Rolle"]
  ];
  fields.forEach(([key, label]) => {
    if (String(before?.[key] ?? "") !== String(after?.[key] ?? "")) changes.push(`${label}: ${before?.[key] || "-"} -> ${after?.[key] || "-"}`);
  });
  if (Number(before?.rank) !== Number(after?.rank)) changes.push(`Rang: ${rankText(db, before?.rank)} -> ${rankText(db, after?.rank)}`);
  trainingNames.forEach((training) => {
    const had = Boolean(before?.trainings?.[training]);
    const has = Boolean(after?.trainings?.[training]);
    if (had !== has) changes.push(`Ausbildung ${training} ${has ?"hinzugefügt" : "entfernt"}`);
  });
  return changes.join("; ");
}

function updateTrainingMeta(user, beforeTrainings, afterTrainings, actor) {
  user.trainingMeta = user.trainingMeta && typeof user.trainingMeta === "object" ?user.trainingMeta : {};
  trainingNames.forEach((training) => {
    const had = Boolean(beforeTrainings?.[training]);
    const has = Boolean(afterTrainings?.[training]);
    if (has && !had) {
      user.trainingMeta[training] = { completedAt: nowIso(), completedBy: actorName(actor) };
    }
    if (!has && had) delete user.trainingMeta[training];
  });
}

function daysSince(dateValue) {
  const time = new Date(dateValue || Date.now()).getTime();
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

function dateOnly(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function effectiveRankDaysForUser(db, user) {
  const start = new Date(user.lastPromotionAt || user.joinedAt || Date.now());
  const rawDays = daysSince(start);
  const pauseDays = (db.absences || [])
    .filter((absence) => absence.userId === user.id)
    .reduce((sum, absence) => {
      const absenceStart = new Date(`${absence.startDate}T00:00:00`);
      const absenceEnd = new Date(`${absence.endedAt ?dateOnly(absence.endedAt) : absence.endDate}T00:00:00`);
      const from = new Date(Math.max(start.getTime(), absenceStart.getTime()));
      const to = new Date(Math.min(Date.now(), absenceEnd.getTime()));
      if (to < from) return sum;
      const days = Math.floor((to - from) / 86400000) + 1;
      return sum + Math.max(0, days - 3);
    }, 0);
  return Math.max(0, rawDays - pauseDays);
}

function activeUprankBlockForUser(db, userId) {
  return (db.disciplinary || [])
    .filter((entry) => entry.userId === userId && entry.uprankBlockedUntil && !entry.archivedAt && entry.uprankBlockedUntil >= todayIso())
    .sort((a, b) => String(b.uprankBlockedUntil).localeCompare(String(a.uprankBlockedUntil)))[0] || null;
}

function evaluateUprank(db, user, targetRank) {
  const rule = normalizeUprankRules(db.settings.uprankRules).find((item) => Number(item.targetRank) === Number(targetRank)) || { minDays: 14, trainings: [], specialOnly: targetRank >= 7 };
  const adjustments = Array.isArray(db.settings.uprankAdjustments) ?db.settings.uprankAdjustments : [];
  const reduction = adjustments
    .filter((item) => item.userId === user.id && Number(item.targetRank) === Number(targetRank) && item.type === "Verkürzung")
    .reduce((sum, item) => sum + Number(item.days || 0), 0);
  const extension = adjustments
    .filter((item) => item.userId === user.id && Number(item.targetRank) === Number(targetRank) && item.type === "Verlängerung")
    .reduce((sum, item) => sum + Number(item.days || 0), 0);
  const effectiveDays = Math.max(0, Number(rule.minDays || 0) - reduction + extension);
  const blockEntry = activeUprankBlockForUser(db, user.id);
  const blockMissingDays = blockEntry ?Math.max(1, Math.ceil((new Date(`${blockEntry.uprankBlockedUntil}T00:00:00`) - Date.now()) / 86400000)) : 0;
  const missingDays = Math.max(0, effectiveDays - effectiveRankDaysForUser(db, user), blockMissingDays);
  const missingTrainings = (rule.trainings || []).filter((training) => !user.trainings?.[training]);
  const hasSpecial = adjustments.some((item) => item.userId === user.id && Number(item.targetRank) === Number(targetRank) && item.type === "Sonderuprank");
  return {
    rule,
    missingDays,
    missingTrainings,
    hasSpecial,
    regularReady: missingDays === 0 && missingTrainings.length === 0
  };
}

function isDirectEvidenceImageUrl(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol)
      && /^(?:i\.)?(?:imgur\.com)$|^i\.gyazo\.com$|^image\.prntscr\.com$/i.test(parsed.hostname)
      && /\.(?:png|jpe?g|webp|gif)(?:$|\?)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function extractEvidenceImageUrl(html) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']image_src["']/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1].replace(/&amp;/g, "&").trim();
  }
  return "";
}

function fetchEvidenceHtmlResponse(url, redirects = 0, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = https.get(parsed, {
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        ...extraHeaders
      }
    }, (remote) => {
      const location = remote.headers.location;
      if ([301, 302, 303, 307, 308].includes(remote.statusCode) && location && redirects < 4) {
        remote.resume();
        return resolve(fetchEvidenceHtmlResponse(new URL(location, parsed).toString(), redirects + 1, extraHeaders));
      }
      let body = "";
      remote.setEncoding("utf8");
      remote.on("data", (chunk) => { body += chunk; });
      remote.on("end", () => resolve({ body, headers: remote.headers, statusCode: remote.statusCode }));
    });
    request.on("error", reject);
  });
}

async function fetchEvidenceHtml(url, redirects = 0) {
  return (await fetchEvidenceHtmlResponse(url, redirects)).body;
}

function googleDocsDocumentUrl(value = "") {
  try {
    const url = new URL(String(value || "").trim());
    if (!/\.google\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/document\/d\/(?:e\/)?([^/]+)/i);
    if (!match?.[1]) return null;
    return { url, id: match[1], published: /\/pub\b/i.test(url.pathname) || /\/d\/e\//i.test(url.pathname) };
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value = "") {
  const named = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    auml: "ä",
    ouml: "ö",
    uuml: "ü",
    Auml: "Ä",
    Ouml: "Ö",
    Uuml: "Ü",
    szlig: "ß"
  };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (entity, code) => {
    if (code[0] === "#") {
      const numeric = code[1]?.toLowerCase() === "x" ?parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(numeric) ?String.fromCodePoint(numeric) : entity;
    }
    return Object.prototype.hasOwnProperty.call(named, code) ?named[code] : entity;
  });
}

function repairMojibake(value = "") {
  let text = String(value || "");
  const decodeOnce = (input) => {
    if (!/[\u00c2\u00c3]/.test(input)) return input;
    try {
      return decodeURIComponent(Array.from(input, (char) => {
        const code = char.charCodeAt(0);
        return code <= 255 ?`%${code.toString(16).padStart(2, "0")}` : encodeURIComponent(char);
      }).join(""));
    } catch {
      return input;
    }
  };
  for (let index = 0; index < 3; index += 1) {
    const decoded = decodeOnce(text);
    if (decoded === text) break;
    text = decoded;
  }
  return text;
}

function stripHtml(value = "") {
  return repairMojibake(decodeHtmlEntities(String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()));
}

async function fetchGoogleDocsOutline(sourceUrl) {
  const { html } = await fetchGoogleDocsCached(sourceUrl);
  if (!html) return [];
  return extractGoogleDocsOutline(html);
}

function googleDocsFetchUrl(parsed) {
  if (!parsed) return "";
  if (parsed.published) {
    const pub = new URL(parsed.url.toString());
    pub.searchParams.delete("embedded");
    return pub.toString();
  }
  return `https://docs.google.com/document/d/${encodeURIComponent(parsed.id)}/export?format=html`;
}

async function fetchGoogleDocsCached(sourceUrl, force = false) {
  const parsed = googleDocsDocumentUrl(sourceUrl);
  if (!parsed) return { html: "", body: "", outline: [] };
  const key = parsed.id;
  const cached = googleDocsCache.get(key);
  if (!force && cached && cached.recheckAfter > Date.now()) return cached;
  const headers = {};
  if (!force && cached?.etag) headers["If-None-Match"] = cached.etag;
  if (!force && cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;
  const response = await fetchEvidenceHtmlResponse(googleDocsFetchUrl(parsed), 0, headers);
  if (!force && cached && response.statusCode === 304) {
    const fresh = { ...cached, checkedAt: nowIso(), recheckAfter: Date.now() + GOOGLE_DOCS_RECHECK_MS };
    googleDocsCache.set(key, fresh);
    return fresh;
  }
  const html = response.body;
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
  const outline = extractGoogleDocsOutline(body);
  const entry = {
    html,
    body,
    outline,
    etag: response.headers.etag || "",
    lastModified: response.headers["last-modified"] || "",
    fetchedAt: nowIso(),
    checkedAt: nowIso(),
    recheckAfter: Date.now() + GOOGLE_DOCS_RECHECK_MS
  };
  googleDocsCache.set(key, entry);
  return entry;
}

function extractGoogleDocsOutline(html) {
  const outline = [];
  const seen = new Set();
  const headingPattern = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
  let match;
  while ((match = headingPattern.exec(html))) {
    const level = Number(match[1]);
    const attrs = match[2] || "";
    const text = stripHtml(match[3] || "");
    if (!text) continue;
    const id = attrs.match(/\sid=["']([^"']+)["']/i)?.[1] || attrs.match(/\sname=["']([^"']+)["']/i)?.[1] || `heading-${outline.length + 1}`;
    const key = `${level}:${id}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    outline.push({ id, text: text.slice(0, 140), level });
    if (outline.length >= 80) break;
  }
  return outline;
}

async function fetchGoogleDocsDocument(sourceUrl) {
  const parsed = googleDocsDocumentUrl(sourceUrl);
  if (!parsed) return null;
  const targetUrl = parsed.published
    ?(() => {
      const pub = new URL(parsed.url.toString());
      pub.searchParams.delete("embedded");
      return pub.toString();
    })()
    :`https://docs.google.com/document/d/${encodeURIComponent(parsed.id)}/export?format=html`;
  const html = await fetchEvidenceHtml(targetUrl);
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
  const safeHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<head\b[^>]*>/i, "<head><base target=\"_blank\"><style>html,body{overflow:hidden!important;background:#fff!important;}body{margin:0!important;padding:24px!important;box-sizing:border-box!important;}img{max-width:100%!important;height:auto!important;}</style>")
    .replace(/<body\b([^>]*)>/i, "<body$1>");
  const outline = [];
  const seen = new Set();
  const headingPattern = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
  let match;
  while ((match = headingPattern.exec(body))) {
    const level = Number(match[1]);
    const attrs = match[2] || "";
    const text = stripHtml(match[3] || "");
    if (!text) continue;
    const id = attrs.match(/\sid=["']([^"']+)["']/i)?.[1] || attrs.match(/\sname=["']([^"']+)["']/i)?.[1] || `heading-${outline.length + 1}`;
    const key = `${level}:${id}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    outline.push({ id, text: text.slice(0, 140), level });
    if (outline.length >= 80) break;
  }
  return { html: safeHtml, outline };
}

async function searchGoogleDocsDocument(sourceUrl, query) {
  const parsed = googleDocsDocumentUrl(sourceUrl);
  const term = stripHtml(query).toLowerCase();
  if (!parsed || term.length < 2) return [];
  const { body } = await fetchGoogleDocsCached(sourceUrl);
  const blockPattern = /<(h[1-6]|p|li|td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const matches = [];
  let currentHeading = { id: "", text: "Dokument" };
  let match;
  while ((match = blockPattern.exec(body))) {
    const tag = String(match[1] || "").toLowerCase();
    const attrs = match[2] || "";
    const text = stripHtml(match[3] || "");
    if (!text) continue;
    if (/^h[1-6]$/.test(tag)) {
      currentHeading = {
        id: attrs.match(/\sid=["']([^"']+)["']/i)?.[1] || attrs.match(/\sname=["']([^"']+)["']/i)?.[1] || "",
        text
      };
    }
    const lower = text.toLowerCase();
    const index = lower.indexOf(term);
    if (index === -1) continue;
    const start = Math.max(0, index - 60);
    const end = Math.min(text.length, index + term.length + 90);
    matches.push({
      headingId: currentHeading.id,
      headingText: currentHeading.text || "Dokument",
      snippet: `${start > 0 ?"..." : ""}${text.slice(start, end)}${end < text.length ?"..." : ""}`
    });
    if (matches.length >= 30) break;
  }
  return matches;
}

app.use(express.json({ limit: "50mb" }));
app.use((req, res, next) => {
  const ext = path.extname(req.path).toLowerCase();
  if (req.path.startsWith("/api/") || !ext) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});
app.use(express.static(PUBLIC_DIR, {
  index: false,
  etag: true,
  lastModified: true,
  maxAge: "1d",
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
    if (filePath.endsWith(".js")) {
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
    if (filePath.endsWith(".css")) {
      res.setHeader("Content-Type", "text/css; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
    if (filePath.includes(`${path.sep}assets${path.sep}`) || /\.(png|jpg|jpeg|webp|gif|svg|ico)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  }
}));

app.get("/api/evidence-preview", async (req, res) => {
  const url = String(req.query.url || "");
  if (!/^https:\/\/(?:www\.)?(?:prnt\.sc|gyazo\.com|imgur\.com|i\.imgur\.com)\//i.test(url)) return res.status(400).end();
  if (isDirectEvidenceImageUrl(url)) {
    res.setHeader("Cache-Control", "public, max-age=43200");
    return res.redirect(302, url);
  }
  const cached = evidencePreviewCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader("Cache-Control", "public, max-age=43200");
    return res.redirect(302, cached.imageUrl);
  }
  try {
    const body = await fetchEvidenceHtml(url);
    const imageUrl = extractEvidenceImageUrl(body);
    if (!/^https?:\/\//i.test(imageUrl) || /st\.prntscr\.com\//i.test(imageUrl)) return res.status(404).end();
    if (/gyazo\.com\//i.test(url) && !/^https:\/\/i\.gyazo\.com\//i.test(imageUrl)) return res.status(404).end();
    if (/imgur\.com\//i.test(url) && !/^https:\/\/i\.imgur\.com\//i.test(imageUrl)) return res.status(404).end();
    evidencePreviewCache.set(url, { imageUrl, expiresAt: Date.now() + EVIDENCE_PREVIEW_TTL_MS });
    res.setHeader("Cache-Control", "public, max-age=43200");
    res.redirect(302, imageUrl);
  } catch {
    res.status(404).end();
  }
});

app.get("/api/google-docs-outline", requireAuth, async (req, res) => {
  const sourceUrl = String(req.query.url || "");
  if (!googleDocsDocumentUrl(sourceUrl)) return res.status(400).json({ error: "Bitte einen Google Docs Dokument-Link eintragen." });
  try {
    const cached = await fetchGoogleDocsCached(sourceUrl, req.query.force === "1");
    res.json({
      outline: cached.outline,
      fetchedAt: cached.fetchedAt,
      checkedAt: cached.checkedAt,
      recheckAfter: cached.recheckAfter
    });
  } catch {
    res.status(400).json({ error: "Struktur konnte nicht geladen werden. Prüfe, ob das Google Docs Dokument für den Link freigegeben ist." });
  }
});

app.get("/api/google-docs-document", requireAuth, async (req, res) => {
  const sourceUrl = String(req.query.url || "");
  if (!googleDocsDocumentUrl(sourceUrl)) return res.status(400).json({ error: "Bitte einen Google Docs Dokument-Link eintragen." });
  try {
    const document = await fetchGoogleDocsDocument(sourceUrl);
    if (!document) return res.status(400).json({ error: "Google Docs Dokument konnte nicht gelesen werden." });
    res.json(document);
  } catch {
    res.status(400).json({ error: "Dokument konnte nicht geladen werden. Prüfe, ob das Google Docs Dokument für den Link freigegeben ist." });
  }
});

app.get("/api/google-docs-search", requireAuth, async (req, res) => {
  const sourceUrl = String(req.query.url || "");
  const query = String(req.query.q || "");
  if (!googleDocsDocumentUrl(sourceUrl)) return res.status(400).json({ error: "Bitte einen Google Docs Dokument-Link eintragen." });
  if (stripHtml(query).length < 2) return res.json({ matches: [] });
  try {
    const matches = await searchGoogleDocsDocument(sourceUrl, query);
    res.json({ matches });
  } catch {
    res.status(400).json({ error: "Dokument konnte nicht durchsucht werden. Prüfe, ob das Google Docs Dokument freigegeben ist." });
  }
});

app.post("/api/login", (req, res) => {
  const db = readDb();
  const name = String(req.body.name || "").trim().toLowerCase();
  const passwordHash = hashPassword(String(req.body.password || ""));
  const user = db.users.find((item) => {
    const fullName = `${item.firstName} ${item.lastName}`.trim().toLowerCase();
    return fullName === name;
  });

  if (!user) return res.status(404).json({ error: "Account wurde nicht gefunden." });
  if (user.terminated) return res.status(403).json({ error: "Dieser Account wurde entlassen/deaktiviert." });
  if (user.accountStatus === "Suspendiert") return res.status(403).json({ error: "Dieser Account ist suspendiert." });
  if (user.accountStatus === "Gesperrt" || user.locked) return res.status(403).json({ error: "Dieser Account ist gesperrt." });
  if (user.passwordHash !== passwordHash) return res.status(401).json({ error: "Das Passwort ist falsch." });

  const token = createSession(db, user);
  logAction(db, user, "Login", `${user.firstName} ${user.lastName}`.trim());
  writeDb(db);
  res.json({ token, user: publicUser(user) });
});

app.get("/api/discord/oauth-config", (req, res) => {
  const db = readDb();
  const sync = publicDiscordSync(db.settings.discordSync);
  const requestOrigin = publicUrlFromRequest(req);
  res.json({
    applicationId: sync.applicationId,
    clientSecretSet: sync.clientSecretSet,
    oauthRedirectUrl: requestOrigin ?discordCallbackUrl(requestOrigin) : sync.oauthRedirectUrl,
    enabled: Boolean(sync.applicationId)
  });
});

app.get("/api/discord/callback", async (req, res) => {
  const db = readDb();
  const sync = normalizeDiscordSync(db.settings.discordSync);
  const state = String(req.query.state || "");
  const code = String(req.query.code || "");
  const requestOrigin = publicUrlFromRequest(req);
  const baseUrl = normalizePublicUrl(requestOrigin || db.settings?.publicBaseUrl || process.env.PUBLIC_BASE_URL || PUBLIC_BASE_URL, PUBLIC_BASE_URL);
  const callbackUrl = requestOrigin ?discordCallbackUrl(requestOrigin) : sync.oauthRedirectUrl;
  const redirectUrl = new URL(baseUrl);
  try {
    cleanupDiscordOAuthTickets();
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    if (!sync.applicationId || !sync.clientSecret) throw new Error("Discord OAuth ist noch nicht vollständig eingerichtet. Client Secret fehlt.");
    if (!code) throw new Error("Discord Callback enthaelt keinen Code.");
    const tokenResponse = await discordTokenRequest(sync, code, callbackUrl);
    redirectUrl.searchParams.set("discord_oauth", "1");
    redirectUrl.searchParams.set("ticket", makeDiscordOAuthTicket(tokenResponse));
    if (state) redirectUrl.searchParams.set("state", state);
  } catch (error) {
    redirectUrl.searchParams.set("discord_error", error.message || "Discord Callback fehlgeschlagen.");
    if (state) redirectUrl.searchParams.set("state", state);
  }
  res.redirect(302, redirectUrl.toString());
});

app.post("/api/discord/callback-ticket", async (req, res) => {
  const db = readDb();
  let accessToken = "";
  try {
    accessToken = consumeDiscordOAuthTicket(req.body.ticket);
    const mode = String(req.body.mode || "login");
    const authToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const session = db.sessions.find((item) => item.token === authToken);
    const user = db.users.find((item) => item.id === session?.userId && !item.locked && !item.terminated);
    if (mode === "link" || user) {
      if (!user) return res.status(401).json({
        error: "Bitte melde dich zuerst normal an. Danach kannst du Discord im Profil verknüpfen.",
        pendingTicket: makeDiscordOAuthTicket({ access_token: accessToken })
      });
      if (user.mustChangePassword) return res.status(403).json({ error: "Bitte ändere zuerst dein Standardpasswort. Danach kannst du Discord verknüpfen." });
      return res.json(await finishDiscordLink(db, user, accessToken));
    }
    return res.json(await finishDiscordLogin(db, accessToken));
  } catch (error) {
    res.status(error.statusCode || 400).json({
      error: error.message || "Discord Login fehlgeschlagen.",
      ...(error.statusCode === 404 && accessToken ?{ pendingTicket: makeDiscordOAuthTicket({ access_token: accessToken }) } : {}),
      ...(error.discordUser ?{ discordUser: error.discordUser } : {})
    });
  }
});

app.post("/api/discord/login", async (req, res) => {
  const db = readDb();
  try {
    res.json(await finishDiscordLogin(db, req.body.accessToken));
  } catch (error) {
    res.status(error.statusCode || 400).json({
      error: error.message || "Discord Login fehlgeschlagen.",
      ...(error.discordUser ?{ discordUser: error.discordUser } : {})
    });
  }
});

app.post("/api/discord/link", requireAuth, async (req, res) => {
  if (req.user.mustChangePassword) {
    return res.status(403).json({ error: "Bitte ändere zuerst dein Standardpasswort. Danach kannst du Discord verknüpfen." });
  }
  try {
    res.json(await finishDiscordLink(req.db, req.user, req.body.accessToken));
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || "Discord Verknüpfung fehlgeschlagen." });
  }
});

app.post("/api/logout", requireAuth, (req, res) => {
  req.db.sessions = req.db.sessions.filter((item) => item.token !== req.session.token);
  logAction(req.db, req.user, "Logout", `${req.user.firstName} ${req.user.lastName}`.trim());
  writeDb(req.db);
  res.json({ ok: true });
});

app.post("/api/security/inspect-attempt", (req, res) => {
  const db = readDb();
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const session = db.sessions.find((item) => item.token === token);
  const user = db.users.find((item) => item.id === session?.userId);
  const actor = user || { firstName: "Unbekannter", lastName: "Besucher" };
  const reason = String(req.body.reason || "Untersuchen versucht").slice(0, 120);
  const page = String(req.body.page || "").slice(0, 80);
  logAction(db, actor, "Untersuchen blockiert", page || "Website", {
    reason,
    userAgent: String(req.headers["user-agent"] || "").slice(0, 180)
  });
  writeDb(db);
  res.json({ ok: true });
});

app.get("/api/bootstrap", requireAuth, (req, res) => {
  const sortedUsers = [...req.db.users].filter((user) => !user.terminated).sort((a, b) => userRankSortValue(b) - userRankSortValue(a) || actorName(a).localeCompare(actorName(b), "de"));
  const archivedUsers = [...req.db.users].filter((user) => user.terminated).sort((a, b) => new Date(b.termination?.terminatedAt || b.updatedAt || 0) - new Date(a.termination?.terminatedAt || a.updatedAt || 0));
  res.json({
    liveRevision: liveRevision(),
    clientRefreshRevision,
    currentUser: publicUser(req.user),
    users: sortedUsers.map(publicUser),
    archivedUsers: archivedUsers.map(publicUser),
    ranks: req.db.settings.ranks,
    roles,
    departmentPositions,
    settings: publicSettings(req.db.settings),
    mailboxThreads: publicMailboxThreads(req.db, req.user),
    customPages: req.db.settings.customPages || [],
    departments: req.db.settings.departments.map((department) => publicDepartment(department, req.db, req.user)),
    absences: (req.db.absences || []).map((absence) => publicAbsence(req.db, absence)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    notes: [...req.db.notes].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    dutyHistory: (req.db.dutyHistory || []).map((entry) => ({
      ...entry,
      user: publicUser(req.db.users.find((user) => user.id === entry.userId))
    })),
    logs: (req.db.logs || []).slice(0, 1000),
    disciplinary: (req.db.disciplinary || []).map((entry) => publicDisciplinaryEntry(entry, req.user)),
    duty: req.db.duty.map((entry) => ({
      ...entry,
      user: publicUser(req.db.users.find((user) => user.id === entry.userId))
    }))
  });
});

app.get("/api/live-revision", requireAuth, (req, res) => {
  res.json({ liveRevision: liveRevision(), clientRefreshRevision });
});

app.post("/api/absences", requireAuth, (req, res) => {
  const startDate = String(req.body.startDate || "").slice(0, 10);
  const endDate = String(req.body.endDate || "").slice(0, 10);
  const reason = String(req.body.reason || "").trim();
  const today = todayIso();
  const minStart = new Date(`${today}T00:00:00.000Z`);
  minStart.setUTCDate(minStart.getUTCDate() - 1);
  const minStartIso = minStart.toISOString().slice(0, 10);
  if (!startDate || !endDate) return res.status(400).json({ error: "Bitte Beginn und Ende auswählen." });
  if (startDate < minStartIso) return res.status(400).json({ error: "Der Beginn darf maximal 1 Tag in der Vergangenheit liegen." });
  const minEnd = new Date(`${startDate}T00:00:00.000Z`);
  minEnd.setUTCDate(minEnd.getUTCDate() + 1);
  const minEndIso = minEnd.toISOString().slice(0, 10);
  if (endDate < minEndIso) return res.status(400).json({ error: "Abmeldungen müssen mindestens 1 Tag laufen." });
  if (!reason) return res.status(400).json({ error: "Bitte einen kurzen Grund angeben." });
  const absence = {
    id: makeId("absence"),
    userId: req.user.id,
    startDate,
    endDate,
    reason,
    createdAt: nowIso(),
    createdBy: req.user.id,
    endedAt: "",
    endedBy: "",
    endReason: ""
  };
  req.db.absences.unshift(absence);
  logAction(req.db, req.user, "Abmeldung erstellt", `${startDate} bis ${endDate}`, { absenceId: absence.id, reason });
  writeDb(req.db);
  res.status(201).json({ absence: publicAbsence(req.db, absence), absences: req.db.absences.map((item) => publicAbsence(req.db, item)) });
});

app.patch("/api/absences/:id/end", requireAuth, (req, res) => {
  const absence = req.db.absences.find((item) => item.id === req.params.id);
  if (!absence) return res.status(404).json({ error: "Abmeldung nicht gefunden." });
  const isOwner = absence.userId === req.user.id;
  const isManager = canManageAbsences(req.user, req.db);
  if (!isOwner && !isManager) return res.status(403).json({ error: "Du darfst diese Abmeldung nicht beenden." });
  if (absence.endedAt) return res.status(400).json({ error: "Diese Abmeldung ist bereits beendet." });
  const reason = String(req.body.reason || "").trim();
  if (isManager && !isOwner && !reason) return res.status(400).json({ error: "Bitte einen Grund für das frühzeitige Beenden angeben." });
  absence.endedAt = nowIso();
  absence.endedBy = req.user.id;
  absence.endReason = reason || (isOwner ?"Selbst zurückgezogen" : "Frühzeitig beendet");
  const targetUser = req.db.users.find((user) => user.id === absence.userId);
  logAction(req.db, req.user, "Abmeldung beendet", targetUser ?actorName(targetUser) : absence.userId, { absenceId: absence.id, userId: absence.userId, reason: absence.endReason });
  writeDb(req.db);
  res.json({ absence: publicAbsence(req.db, absence), absences: req.db.absences.map((item) => publicAbsence(req.db, item)) });
});

app.post("/api/mailbox/threads", requireAuth, (req, res) => {
  const participantIds = [...new Set([req.user.id, ...(Array.isArray(req.body.participantIds) ?req.body.participantIds.map(String) : [])])]
    .filter((userId) => req.db.users.some((user) => user.id === userId && !user.terminated && !user.locked));
  const body = String(req.body.body || "").trim();
  const title = String(req.body.title || "").trim() || "Neue Nachricht";
  if (participantIds.length < 2) return res.status(400).json({ error: "Bitte mindestens eine Person auswählen." });
  if (!body) return res.status(400).json({ error: "Bitte eine Nachricht eintragen." });
  const createdAt = nowIso();
  const thread = {
    id: makeId("mail"),
    title,
    participantIds,
    leaderIds: [req.user.id],
    createdBy: req.user.id,
    createdAt,
    updatedAt: createdAt,
    readBy: { [req.user.id]: createdAt },
    archivedBy: {},
    deletedBy: {},
    messages: [{ id: makeId("msg"), senderId: req.user.id, body, createdAt }]
  };
  req.db.settings.mailboxThreads = normalizeMailboxThreads([thread, ...(req.db.settings.mailboxThreads || [])]);
  logAction(req.db, req.user, "Postfach Chat erstellt", title, { participantIds });
  writeDb(req.db);
  res.status(201).json({ thread: publicMailboxThread(req.db, thread, req.user), mailboxThreads: publicMailboxThreads(req.db, req.user) });
});

app.post("/api/mailbox/threads/:id/messages", requireAuth, (req, res) => {
  const thread = req.db.settings.mailboxThreads.find((item) => item.id === req.params.id && item.participantIds.includes(req.user.id) && !item.deletedBy?.[req.user.id] && !item.removedBy?.[req.user.id]);
  if (!thread) return res.status(404).json({ error: "Chat nicht gefunden." });
  const body = String(req.body.body || "").trim();
  const attachments = normalizeMailboxAttachments(Array.isArray(req.body.attachments) ?req.body.attachments : []);
  if (!body && !attachments.length) return res.status(400).json({ error: "Bitte eine Nachricht oder ein Bild eintragen." });
  const createdAt = nowIso();
  thread.messages.push({ id: makeId("msg"), senderId: req.user.id, body, createdAt, attachments });
  thread.updatedAt = createdAt;
  thread.readBy = { ...(thread.readBy || {}), [req.user.id]: createdAt };
  thread.archivedBy = { ...(thread.archivedBy || {}) };
  delete thread.archivedBy[req.user.id];
  logAction(req.db, req.user, "Postfach Nachricht gesendet", thread.title, { threadId: thread.id });
  writeDb(req.db);
  res.status(201).json({ thread: publicMailboxThread(req.db, thread, req.user), mailboxThreads: publicMailboxThreads(req.db, req.user) });
});

app.post("/api/mailbox/threads/:id/read", requireAuth, (req, res) => {
  const thread = req.db.settings.mailboxThreads.find((item) => item.id === req.params.id && item.participantIds.includes(req.user.id));
  if (!thread) return res.status(404).json({ error: "Chat nicht gefunden." });
  thread.readBy = { ...(thread.readBy || {}), [req.user.id]: nowIso() };
  writeDb(req.db);
  res.json({ thread: publicMailboxThread(req.db, thread, req.user), mailboxThreads: publicMailboxThreads(req.db, req.user) });
});

app.patch("/api/mailbox/threads/:id", requireAuth, (req, res) => {
  const thread = req.db.settings.mailboxThreads.find((item) => item.id === req.params.id && item.participantIds.includes(req.user.id) && !item.deletedBy?.[req.user.id] && !item.removedBy?.[req.user.id]);
  if (!thread) return res.status(404).json({ error: "Chat nicht gefunden." });

  const validUserIds = new Set(req.db.users.filter((user) => !user.terminated && !user.locked).map((user) => user.id));
  const requestedActiveIds = [...new Set(Array.isArray(req.body.participantIds) ?req.body.participantIds.map(String) : [])]
    .filter((userId) => validUserIds.has(userId));
  if (!requestedActiveIds.includes(req.user.id)) requestedActiveIds.unshift(req.user.id);
  if (requestedActiveIds.length < 2) return res.status(400).json({ error: "Ein Chat braucht mindestens zwei aktive Personen." });

  const previousActiveIds = (thread.participantIds || []).filter((userId) => !thread.removedBy?.[userId]);
  const allParticipantIds = [...new Set([...(thread.participantIds || []), ...requestedActiveIds])].filter((userId) => validUserIds.has(userId));
  const removedBy = { ...(thread.removedBy || {}) };
  const changedAt = nowIso();
  previousActiveIds.forEach((userId) => {
    if (!requestedActiveIds.includes(userId)) removedBy[userId] = changedAt;
  });
  requestedActiveIds.forEach((userId) => {
    delete removedBy[userId];
    if (thread.deletedBy?.[userId]) delete thread.deletedBy[userId];
  });

  thread.participantIds = allParticipantIds;
  thread.removedBy = removedBy;
  thread.leaderIds = (thread.leaderIds || [thread.createdBy]).filter((userId) => requestedActiveIds.includes(userId));
  if (!thread.leaderIds.length && requestedActiveIds.includes(thread.createdBy)) thread.leaderIds = [thread.createdBy];
  if (!thread.leaderIds.length) thread.leaderIds = [req.user.id];
  thread.updatedAt = changedAt;
  thread.readBy = Object.fromEntries(Object.entries(thread.readBy || {}).filter(([userId]) => allParticipantIds.includes(userId)));
  thread.archivedBy = Object.fromEntries(Object.entries(thread.archivedBy || {}).filter(([userId]) => allParticipantIds.includes(userId)));
  thread.deletedBy = Object.fromEntries(Object.entries(thread.deletedBy || {}).filter(([userId]) => allParticipantIds.includes(userId)));
  logAction(req.db, req.user, "Postfach Chat verwaltet", thread.title, { threadId: thread.id, participantIds: allParticipantIds, activeParticipantIds: requestedActiveIds });
  writeDb(req.db);
  res.json({ thread: publicMailboxThread(req.db, thread, req.user), mailboxThreads: publicMailboxThreads(req.db, req.user) });
});

app.post("/api/mailbox/threads/:id/archive", requireAuth, (req, res) => {
  const thread = req.db.settings.mailboxThreads.find((item) => item.id === req.params.id && item.participantIds.includes(req.user.id) && !item.deletedBy?.[req.user.id]);
  if (!thread) return res.status(404).json({ error: "Chat nicht gefunden." });
  thread.archivedBy = { ...(thread.archivedBy || {}), [req.user.id]: nowIso() };
  writeDb(req.db);
  res.json({ thread: publicMailboxThread(req.db, thread, req.user), mailboxThreads: publicMailboxThreads(req.db, req.user) });
});

app.post("/api/mailbox/threads/:id/unarchive", requireAuth, (req, res) => {
  const thread = req.db.settings.mailboxThreads.find((item) => item.id === req.params.id && item.participantIds.includes(req.user.id));
  if (!thread) return res.status(404).json({ error: "Chat nicht gefunden." });
  thread.archivedBy = { ...(thread.archivedBy || {}) };
  delete thread.archivedBy[req.user.id];
  thread.deletedBy = { ...(thread.deletedBy || {}) };
  delete thread.deletedBy[req.user.id];
  writeDb(req.db);
  res.json({ thread: publicMailboxThread(req.db, thread, req.user), mailboxThreads: publicMailboxThreads(req.db, req.user) });
});

function deleteMailboxThreadForUser(req, res) {
  const thread = req.db.settings.mailboxThreads.find((item) => item.id === req.params.id && item.participantIds.includes(req.user.id));
  if (!thread) return res.status(404).json({ error: "Chat nicht gefunden." });
  thread.deletedBy = { ...(thread.deletedBy || {}), [req.user.id]: nowIso() };
  logAction(req.db, req.user, "Postfach Chat geloescht", thread.title, { threadId: thread.id });
  writeDb(req.db);
  res.json({ mailboxThreads: publicMailboxThreads(req.db, req.user) });
}

app.post("/api/mailbox/threads/:id/delete", requireAuth, deleteMailboxThreadForUser);
app.delete("/api/mailbox/threads/:id", requireAuth, deleteMailboxThreadForUser);

function requireItLead(req, res, next) {
  if (req.user?.role !== "IT-Leitung") {
    return res.status(403).json({ error: "Nur die IT-Leitung darf diese Aktion ausfuehren." });
  }
  next();
}

function removeUserReferences(db, removedUserIds = []) {
  const removed = new Set(removedUserIds.filter(Boolean));
  if (!removed.size) return;
  db.duty = (db.duty || []).filter((entry) => !removed.has(entry.userId));
  db.dutyHistory = (db.dutyHistory || []).filter((entry) => !removed.has(entry.userId));
  db.disciplinary = (db.disciplinary || []).filter((entry) => !removed.has(entry.userId));
  db.absences = (db.absences || []).filter((entry) => !removed.has(entry.userId));
  db.sessions = (db.sessions || []).filter((session) => !removed.has(session.userId));
  (db.settings?.departments || []).forEach((department) => {
    department.members = (department.members || []).filter((member) => !removed.has(member.userId));
    department.memberNotes = (department.memberNotes || []).filter((entry) => !removed.has(entry.userId));
  });
  const permissions = db.settings?.permissions || {};
  [...Object.values(permissions.pages || {}), ...Object.values(permissions.actions || {})].forEach((rule) => {
    if (rule && Array.isArray(rule.users)) rule.users = rule.users.filter((userId) => !removed.has(userId));
  });
  db.settings.mailboxThreads = (db.settings?.mailboxThreads || []).map((thread) => {
    const participantIds = (thread.participantIds || []).filter((userId) => !removed.has(userId));
    const cleanUserMap = (value = {}) => Object.fromEntries(Object.entries(value).filter(([userId]) => !removed.has(userId)));
    return {
      ...thread,
      participantIds,
      leaderIds: (thread.leaderIds || []).filter((userId) => !removed.has(userId) && participantIds.includes(userId)),
      readBy: cleanUserMap(thread.readBy),
      archivedBy: cleanUserMap(thread.archivedBy),
      deletedBy: cleanUserMap(thread.deletedBy),
      removedBy: cleanUserMap(thread.removedBy)
    };
  }).filter((thread) => (thread.participantIds || []).length);
  for (const [token, entry] of activeWebClients.entries()) {
    if (removed.has(entry.userId)) activeWebClients.delete(token);
  }
}

app.get("/api/it/mailbox/threads", requireAuth, requireItLead, (req, res) => {
  const threads = (req.db.settings.mailboxThreads || [])
    .slice()
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .map((thread) => publicAdminMailboxThread(req.db, thread));
  res.json({ threads });
});

app.get("/api/it/mailbox/threads/:id", requireAuth, requireItLead, (req, res) => {
  const thread = (req.db.settings.mailboxThreads || []).find((item) => item.id === req.params.id);
  if (!thread) return res.status(404).json({ error: "Chat nicht gefunden." });
  logAction(req.db, req.user, "Postfach Chat administrativ geöffnet", thread.title, { threadId: thread.id, participantIds: thread.participantIds });
  writeDb(req.db);
  res.json({ thread: publicAdminMailboxThread(req.db, thread) });
});

app.patch("/api/settings/fluctuation/:id", requireAuth, requireItLead, (req, res) => {
  const rows = req.db.settings.fluctuation || [];
  const row = rows.find((item) => item.id === req.params.id);
  if (!row) return res.status(404).json({ error: "Fluktuationseintrag nicht gefunden." });
  const before = { ...row };
  const type = String(req.body.type || row.type || "").trim();
  if (!["Eingestellt", "Kündigung", "Kündigung"].includes(type)) {
    return res.status(400).json({ error: "Ungültiger Typ." });
  }
  const createdAt = req.body.createdAt ?new Date(req.body.createdAt) : new Date(row.createdAt || nowIso());
  if (Number.isNaN(createdAt.getTime())) return res.status(400).json({ error: "Ungültiges Datum." });

  row.name = String(req.body.name || row.name || "").trim();
  row.dn = String(req.body.dn ?? row.dn ?? "").trim();
  row.rank = Number.isInteger(Number(req.body.rank)) ?Number(req.body.rank) : row.rank;
  row.actorName = String(req.body.actorName ?? row.actorName ?? "").trim();
  row.type = type === "Kündigung" ?"Kündigung" : type;
  row.reason = String(req.body.reason ?? row.reason ?? "").trim();
  row.createdAt = createdAt.toISOString();
  if (!row.name) return res.status(400).json({ error: "Name ist erforderlich." });

  logAction(req.db, req.user, "Fluktuationseintrag bearbeitet", row.name, { before, after: { ...row } });
  writeDb(req.db);
  res.json({ fluctuation: req.db.settings.fluctuation });
});

app.delete("/api/settings/fluctuation/:id", requireAuth, requireItLead, (req, res) => {
  const rows = req.db.settings.fluctuation || [];
  const index = rows.findIndex((item) => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Fluktuationseintrag nicht gefunden." });
  const [removed] = rows.splice(index, 1);
  logAction(req.db, req.user, "Fluktuationseintrag gelöscht", removed.name || removed.id, { removed });
  writeDb(req.db);
  res.json({ fluctuation: req.db.settings.fluctuation });
});

app.post("/api/hr/users", requireAuth, (req, res) => {
  if (!canManageAbsences(req.user, req.db)) return res.status(403).json({ error: "Nur Personalabteilung-Leitung oder Direktion darf hier einstellen." });
  try {
    const user = createDienstblattUser(req.db, req.user, {
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      phone: req.body.phone,
      dn: nextFreeDienstnummer(req.db),
      rank: 0,
      role: "User",
      baseRole: "User",
      joinedAt: todayIso(),
      trainings: {}
    });
    logAction(req.db, req.user, "Mitglied durch Personalabteilung erstellt", actorName(user), { userId: user.id });
    writeDb(req.db);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Mitglied konnte nicht erstellt werden." });
  }
});

app.post("/api/users", requireAuth, requireRole("Direktion"), (req, res) => {
  try {
    const requestedRank = Number(String(req.body.rank ?? "").match(/\d+/)?.[0]);
    const rankError = assertCanSetUserRank(req.user, requestedRank);
    if (rankError) return res.status(403).json({ error: rankError });
    const user = createDienstblattUser(req.db, req.user, req.body);
    writeDb(req.db);
    res.status(201).json({ user });
  } catch (error) {
    res.status(400).json({ error: error.message || "Benutzer konnte nicht erstellt werden." });
  }
});

app.patch("/api/users/:id", requireAuth, requireRole("Direktion"), (req, res) => {
  const user = req.db.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });

  const normalized = normalizeUserInput(req.body, user);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const canAffectTarget = !assertCanAffectUser(req.user, user);
  if (Number(normalized.value.rank) !== Number(user.rank)) {
    const targetError = assertCanAffectUser(req.user, user);
    if (targetError) return res.status(403).json({ error: "Du darfst den Rang bei dir selbst sowie bei gleichem oder höherem Rang nicht ändern." });
    const rankError = assertCanSetUserRank(req.user, normalized.value.rank);
    if (rankError) return res.status(403).json({ error: rankError });
  }
  if (!canAffectTarget) normalized.value.rank = user.rank;
  const roleCheck = protectItRoleChange(req.user, user.role, normalized.value.role);
  if (roleCheck.error) return res.status(403).json({ error: roleCheck.error });
  normalized.value.role = roleCheck.role;

  const dnConflict = resolveDnConflict(req.db, user.id, normalized.value.dn, Boolean(req.body.overwriteDn));
  if (dnConflict?.error) return res.status(400).json({ error: dnConflict.error });

  const before = publicUser(user);
  const previousRole = user.role;
  const previousDiscordId = user.discordId || "";
  const rankChanged = Number(user.rank) !== Number(normalized.value.rank);
  const beforeTrainings = { ...(user.trainings || {}) };
  Object.assign(user, normalized.value, {
    lastPromotionAt: rankChanged ?todayIso() : user.lastPromotionAt,
    updatedAt: nowIso()
  });
  updateTrainingMeta(user, beforeTrainings, user.trainings, req.user);
  syncDirektionMembership(req.db, user, { roleAssigned: previousRole !== "Direktion" && user.role === "Direktion" });

  const after = publicUser(user);
  logAction(req.db, req.user, "Benutzer bearbeitet", `${user.firstName} ${user.lastName}`.trim(), { before, after, description: userChangeSummary(req.db, before, after) });
  writeDb(req.db);
  if (previousDiscordId && !user.discordId) {
    unlinkDiscordAccount(req.db, user, previousDiscordId, req.user, "Discord ID entfernt");
  } else {
    syncDiscordRolesForUser(req.db, user, "Benutzer bearbeitet");
  }
  res.json({ user: publicUser(user) });
});

app.patch("/api/users/trainings/bulk", requireAuth, requireRole("Direktion"), (req, res) => {
  const incomingUsers = req.body.users && typeof req.body.users === "object" ?req.body.users : {};
  const updatedUsers = [];
  let changedCount = 0;
  Object.entries(incomingUsers).forEach(([userId, incomingTrainings]) => {
    const user = req.db.users.find((item) => item.id === userId && !item.terminated);
    if (!user || isFrakverwaltungUser(user) || !incomingTrainings || typeof incomingTrainings !== "object") return;
    const before = publicUser(user);
    const beforeTrainings = { ...(user.trainings || {}) };
    user.trainings = { ...Object.fromEntries(trainingNames.map((training) => [training, false])), ...(user.trainings || {}) };
    let changed = false;
    trainingNames.forEach((training) => {
      if (!Object.prototype.hasOwnProperty.call(incomingTrainings, training)) return;
      const nextValue = Boolean(incomingTrainings[training]);
      if (Boolean(user.trainings[training]) !== nextValue) changed = true;
      user.trainings[training] = nextValue;
    });
    if (!changed) return;
    updateTrainingMeta(user, beforeTrainings, user.trainings, req.user);
    user.updatedAt = nowIso();
    const after = publicUser(user);
    logAction(req.db, req.user, "Module in Mitgliederliste gesammelt bearbeitet", `${user.firstName} ${user.lastName}`.trim(), { before, after, description: userChangeSummary(req.db, before, after) });
    updatedUsers.push(after);
    changedCount += 1;
  });
  if (changedCount) {
    writeDb(req.db);
    updatedUsers.forEach((updatedUser) => {
      const dbUser = req.db.users.find((item) => item.id === updatedUser.id);
      if (dbUser) syncDiscordRolesForUser(req.db, dbUser, "Module in Mitgliederliste gesammelt bearbeitet");
    });
  }
  res.json({ users: updatedUsers, changedCount });
});

app.patch("/api/users/:id/trainings", requireAuth, requireRole("Direktion"), (req, res) => {
  const user = req.db.users.find((item) => item.id === req.params.id && !item.terminated);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  if (isFrakverwaltungUser(user)) return res.status(400).json({ error: "Frakverwaltung kann keine Module erhalten." });
  const incoming = req.body.trainings && typeof req.body.trainings === "object" ?req.body.trainings : {};
  const before = publicUser(user);
  const beforeTrainings = { ...(user.trainings || {}) };
  user.trainings = { ...Object.fromEntries(trainingNames.map((training) => [training, false])), ...(user.trainings || {}) };
  trainingNames.forEach((training) => {
    if (Object.prototype.hasOwnProperty.call(incoming, training)) user.trainings[training] = Boolean(incoming[training]);
  });
  updateTrainingMeta(user, beforeTrainings, user.trainings, req.user);
  user.updatedAt = nowIso();
  const after = publicUser(user);
  logAction(req.db, req.user, "Module in Mitgliederliste bearbeitet", `${user.firstName} ${user.lastName}`.trim(), { before, after, description: userChangeSummary(req.db, before, after) });
  writeDb(req.db);
  syncDiscordRolesForUser(req.db, user, "Module in Mitgliederliste bearbeitet");
  res.json({ user: after });
});

app.post("/api/training/est/:id", requireAuth, (req, res) => {
  const user = req.db.users.find((item) => item.id === req.params.id && !item.terminated);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  const trainingDepartment = getDepartment(req.db, "training-recruitment");
  if (!canManageDepartmentAction(req.user, trainingDepartment, req.db, "departmentLeadership")) {
    return res.status(403).json({ error: "Keine Berechtigung." });
  }
  if (user.trainings?.EST) return res.json({ user: publicUser(user) });
  const before = publicUser(user);
  const beforeTrainings = { ...(user.trainings || {}) };
  user.trainings = { ...Object.fromEntries(trainingNames.map((training) => [training, false])), ...(user.trainings || {}), EST: true };
  updateTrainingMeta(user, beforeTrainings, user.trainings, req.user);
  user.updatedAt = nowIso();
  const after = publicUser(user);
  logAction(req.db, req.user, "Ausbildung EST hinzugefügt", `${user.firstName} ${user.lastName}`.trim(), { before, after, description: "EST nach bestandener Prüfung vergeben" });
  writeDb(req.db);
  res.json({ user: after });
});

app.patch("/api/training/modules/:id", requireAuth, (req, res) => {
  const user = req.db.users.find((item) => item.id === req.params.id && !item.terminated);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  if (/direktion/i.test(`${user.role || ""} ${user.baseRole || ""}`)) return res.status(403).json({ error: "Module dürfen nicht an Direktion vergeben oder entzogen werden." });
  const trainingDepartment = getDepartment(req.db, "training-recruitment");
  const incoming = req.body.trainings && typeof req.body.trainings === "object" ?req.body.trainings : {};
  const before = publicUser(user);
  const beforeTrainings = { ...(user.trainings || {}) };
  user.trainings = { ...Object.fromEntries(trainingNames.map((training) => [training, false])), ...(user.trainings || {}) };
  const wantsGrant = trainingNames.some((training) => Object.prototype.hasOwnProperty.call(incoming, training) && !Boolean(user.trainings[training]) && Boolean(incoming[training]));
  const wantsRevoke = trainingNames.some((training) => Object.prototype.hasOwnProperty.call(incoming, training) && Boolean(user.trainings[training]) && !Boolean(incoming[training]));
  if (wantsGrant && !canManageDepartmentAction(req.user, trainingDepartment, req.db, "departmentModuleGrant")) return res.status(403).json({ error: "Keine Berechtigung zum Vergeben von Modulen." });
  if (wantsRevoke && !canManageDepartmentAction(req.user, trainingDepartment, req.db, "departmentModuleRevoke")) return res.status(403).json({ error: "Keine Berechtigung zum Entziehen von Modulen." });
  trainingNames.forEach((training) => {
    if (Object.prototype.hasOwnProperty.call(incoming, training)) user.trainings[training] = Boolean(incoming[training]);
  });
  updateTrainingMeta(user, beforeTrainings, user.trainings, req.user);
  user.updatedAt = nowIso();
  const after = publicUser(user);
  logAction(req.db, req.user, "Module vergeben", `${user.firstName} ${user.lastName}`.trim(), { before, after, description: userChangeSummary(req.db, before, after) });
  writeDb(req.db);
  syncDiscordRolesForUser(req.db, user, "Module vergeben");
  res.json({ user: after });
});

app.patch("/api/settings/uprank-rules", requireAuth, requireRole("Direktion"), (req, res) => {
  const before = normalizeUprankRules(req.db.settings.uprankRules);
  const incoming = Array.isArray(req.body.rules) ?req.body.rules : [];
  req.db.settings.uprankRules = normalizeUprankRules(incoming);
  logAction(req.db, req.user, "Uprank Voraussetzungen geändert", "Direktion", { before, after: req.db.settings.uprankRules });
  writeDb(req.db);
  res.json({ rules: req.db.settings.uprankRules });
});

app.patch("/api/settings/training-modules", requireAuth, (req, res) => {
  const trainingDepartment = getDepartment(req.db, "training-recruitment");
  if (!canManageDepartmentAction(req.user, trainingDepartment, req.db, "departmentTrainingChecks")) {
    return res.status(403).json({ error: "Nur Direktion und IT dürfen die Haken Verwaltung bearbeiten." });
  }
  const current = normalizeTrainingModuleSettings(req.db.settings.trainingModules);
  const incomingLabels = req.body.labels && typeof req.body.labels === "object" ?req.body.labels : current.labels;
  const incomingDetails = req.body.details && typeof req.body.details === "object" ?req.body.details : current.details;
  const incomingCategories = req.body.categories && typeof req.body.categories === "object" ?req.body.categories : current.categories;
  const incomingRequirements = req.body.requirements && typeof req.body.requirements === "object" ?req.body.requirements : current.requirements;
  const incomingOrder = Array.isArray(req.body.order) ?req.body.order : current.order;
  const incomingDeleted = Array.isArray(req.body.deleted) ?req.body.deleted : current.deleted;
  const incomingHidden = Array.isArray(req.body.hidden) ?req.body.hidden : current.hidden;
  const before = current;
  req.db.settings.trainingModules = normalizeTrainingModuleSettings({ labels: incomingLabels, details: incomingDetails, categories: incomingCategories, requirements: incomingRequirements, order: incomingOrder, deleted: incomingDeleted, hidden: incomingHidden });
  logAction(req.db, req.user, "Ausbildungs-Haken verwaltet", "Police Academy", { before, after: req.db.settings.trainingModules });
  writeDb(req.db);
  res.json({ settings: publicSettings(req.db.settings) });
});

app.patch("/api/settings/onboarding-tutorial", requireAuth, requireRole("IT"), (req, res) => {
  const before = normalizeOnboardingTutorial(req.db.settings.onboardingTutorial);
  req.db.settings.onboardingTutorial = normalizeOnboardingTutorial(req.body.steps || []);
  logAction(req.db, req.user, "Dienstblatt Tutorial bearbeitet", "IT", { before, after: req.db.settings.onboardingTutorial.map((step) => ({ ...step, imageUrl: step.imageUrl ?"[Bild]" : "", imageUrls: step.imageUrls?.length ?`[${step.imageUrls.length} Bilder]` : [] })) });
  writeDb(req.db);
  res.json({ settings: publicSettings(req.db.settings) });
});

app.patch("/api/settings/dn-blacklist", requireAuth, requireRole("Direktion"), (req, res) => {
  const before = normalizeDnBlacklist(req.db.settings.dnBlacklist);
  const blacklist = normalizeDnBlacklist(req.body.dnBlacklist);
  req.db.settings.dnBlacklist = blacklist;
  logAction(req.db, req.user, "Dienstnummer Blacklist geaendert", "Direktion", { before, after: blacklist });
  writeDb(req.db);
  res.json({ dnBlacklist: blacklist, settings: publicSettings(req.db.settings) });
});

app.patch("/api/settings/sanction-catalog", requireAuth, (req, res) => {
  const hr = req.db.settings.departments.find((department) => department.id === "human-resources");
  if (!req.user || !canManageDepartmentAction(req.user, hr, req.db, "departmentLeadership")) {
    return res.status(403).json({ error: "Keine Berechtigung." });
  }
  const before = normalizeSanctionCatalog(req.db.settings.sanctionCatalog);
  req.db.settings.sanctionCatalog = normalizeSanctionCatalog(req.body.catalog || []);
  logAction(req.db, req.user, "Sanktionskatalog geändert", "Personalabteilung", { before, after: req.db.settings.sanctionCatalog });
  writeDb(req.db);
  res.json({ settings: publicSettings(req.db.settings) });
});

app.post("/api/users/:id/uprank-adjustments", requireAuth, requireRole("Direktion"), (req, res) => {
  const user = req.db.users.find((item) => item.id === req.params.id && !item.terminated);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  const targetError = assertCanAffectUser(req.user, user);
  if (targetError) return res.status(403).json({ error: targetError });
  const type = String(req.body.type || "");
  if (!["Verkürzung", "Verlängerung", "Sonderuprank"].includes(type)) return res.status(400).json({ error: "Ungültige Uprank-Art." });
  const targetRank = Number(req.body.targetRank || user.rank + 1);
  const rankError = assertCanSetUserRank(req.user, targetRank);
  if (rankError) return res.status(403).json({ error: rankError });
  if (!Number.isInteger(targetRank) || targetRank <= Number(user.rank)) return res.status(400).json({ error: "Ungültiger Zielrang." });
  const days = ["Verkürzung", "Verlängerung"].includes(type) ?Math.max(1, Number.parseInt(req.body.days, 10) || 0) : 0;
  const reason = String(req.body.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "Bitte einen Grund angeben." });
  const adjustment = {
    id: makeId("uprank_adjustment"),
    userId: user.id,
    name: actorName(user),
    type,
    targetRank,
    days,
    reason,
    actorName: actorName(req.user),
    createdAt: nowIso()
  };
  const previousSpecial = type === "Sonderuprank"
    ?(req.db.settings.uprankAdjustments || []).filter((item) => item.userId === user.id && item.type === "Sonderuprank")
    : [];
  req.db.settings.uprankAdjustments = type === "Sonderuprank"
    ?[adjustment, ...(req.db.settings.uprankAdjustments || []).filter((item) => !(item.userId === user.id && item.type === "Sonderuprank"))]
    :[adjustment, ...(req.db.settings.uprankAdjustments || [])];
  logDisciplinary(req.db, user, type, reason, req.user);
  logAction(req.db, req.user, previousSpecial.length ?`${type} angepasst` : `${type} eingetragen`, actorName(user), { before: previousSpecial, after: adjustment, reason });
  writeDb(req.db);
  res.status(201).json({ adjustment });
});

app.delete("/api/users/:id/uprank-adjustments/:adjustmentId", requireAuth, requireRole("Direktion"), (req, res) => {
  const user = req.db.users.find((item) => item.id === req.params.id && !item.terminated);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  const targetError = assertCanAffectUser(req.user, user);
  if (targetError) return res.status(403).json({ error: targetError });
  const before = [...(req.db.settings.uprankAdjustments || [])];
  const adjustmentId = String(req.params.adjustmentId || "");
  const removed = adjustmentId === "sonderuprank"
    ?before.filter((item) => item.userId === user.id && item.type === "Sonderuprank").sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0]
    :before.find((item) => item.id === adjustmentId && item.userId === user.id);
  if (!removed) return res.status(404).json({ error: "Uprank-Vormerkung nicht gefunden." });
  req.db.settings.uprankAdjustments = removed.type === "Sonderuprank"
    ?before.filter((item) => !(item.userId === user.id && item.type === "Sonderuprank"))
    :before.filter((item) => item.id !== adjustmentId);
  logAction(req.db, req.user, `${removed.type} entzogen`, actorName(user), { before: removed });
  writeDb(req.db);
  res.json({ uprankAdjustments: req.db.settings.uprankAdjustments });
});

app.post("/api/users/:id/uprank-block", requireAuth, requireRole("Direktion"), (req, res) => {
  const user = req.db.users.find((item) => item.id === req.params.id && !item.terminated);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  const targetError = assertCanAffectUser(req.user, user);
  if (targetError) return res.status(403).json({ error: targetError });
  const until = String(req.body.until || "").slice(0, 10);
  const reason = String(req.body.reason || "").trim();
  if (!until || until < todayIso()) return res.status(400).json({ error: "Bitte ein gültiges Datum angeben." });
  if (!reason) return res.status(400).json({ error: "Bitte einen Grund angeben." });
  const entry = {
    id: makeId("disciplinary"),
    type: "Sanktion",
    sanctionType: "Custom",
    userId: user.id,
    name: actorName(user),
    dn: user.dn,
    rank: user.rank,
    actorName: actorName(req.user),
    reason,
    title: "Uprank-Sperre",
    amount: 0,
    internal: false,
    uprankBlockDays: 0,
    uprankBlockedUntil: until,
    strikeCount: 0,
    expiresAt: "",
    createdAt: nowIso()
  };
  req.db.disciplinary.unshift(entry);
  logAction(req.db, req.user, "Uprank-Sperre eingetragen", actorName(user), { after: entry });
  writeDb(req.db);
  res.status(201).json({ entry });
});

app.post("/api/users/:id/uprank", requireAuth, requireRole("Direktion"), (req, res) => {
  const user = req.db.users.find((item) => item.id === req.params.id && !item.terminated);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  const targetError = assertCanAffectUser(req.user, user);
  if (targetError) return res.status(403).json({ error: targetError });
  const targetRank = Number(req.body.targetRank || user.rank + 1);
  const rankError = assertCanSetUserRank(req.user, targetRank);
  if (rankError) return res.status(403).json({ error: rankError });
  if (!Number.isInteger(targetRank) || targetRank <= Number(user.rank)) return res.status(400).json({ error: "Ungültiger Zielrang." });
  if (!req.body.ingameDone) return res.status(400).json({ error: "Ingame muss abgehakt sein." });
  const reason = String(req.body.reason || "").trim();
  const evaluation = evaluateUprank(req.db, user, targetRank);
  const special = Boolean(req.body.special) || evaluation.hasSpecial;
  if (evaluation.rule.specialOnly && !special) return res.status(400).json({ error: "Dieser Rang ist nur per Sonderuprank möglich." });
  if (!special && (!evaluation.regularReady || evaluation.missingDays || evaluation.missingTrainings.length)) {
    return res.status(400).json({ error: "Die Uprank Voraussetzungen sind noch nicht erfüllt." });
  }
  if (activeNegativeEntries(req.db.disciplinary, user.id).length) return res.status(400).json({ error: "Dieses Mitglied hat noch offene Sanktionen oder Geldstrafen in der Akte." });

  if (special && !reason) return res.status(400).json({ error: "Bitte Sonderuprank begründen." });
  const before = publicUser(user);
  user.rank = targetRank;
  user.lastPromotionAt = todayIso();
  user.updatedAt = nowIso();
  const after = publicUser(user);
  logDisciplinary(req.db, user, "Uprank", reason || `Uprank auf ${rankText(req.db, targetRank)}`, req.user);
  logAction(req.db, req.user, "Uprank durchgeführt", actorName(user), {
    before,
    after,
    reason,
    ingameDone: true,
    description: `Uprank: ${rankText(req.db, before.rank)} -> ${rankText(req.db, after.rank)}; Ingame erledigt${reason ?`; Grund: ${reason}` : ""}`
  });
  writeDb(req.db);
  syncDiscordRolesForUser(req.db, user, "Uprank");
  res.json({ user: after });
});

app.patch("/api/users/:id/lock", requireAuth, requireRole("Direktion"), (req, res) => {
  const user = req.db.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  const targetError = assertCanAffectUser(req.user, user, Boolean(req.body.locked) ?"sperren" : "entsperren");
  if (targetError) return res.status(403).json({ error: targetError });
  const reason = String(req.body.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "Bitte einen Grund angeben." });
  const before = publicUser(user);
  setAccountStatus(user, Boolean(req.body.locked) ?"Gesperrt" : "Aktiv");
  user.updatedAt = nowIso();
  req.db.sessions = req.db.sessions.filter((session) => session.userId !== user.id);
  logDisciplinary(req.db, user, user.locked ?"Sperre" : "Entsperrt", reason, req.user);
  logAction(req.db, req.user, user.locked ?"Benutzer gesperrt" : "Benutzer entsperrt", `${user.firstName} ${user.lastName}`.trim(), { reason, before, after: publicUser(user) });
  writeDb(req.db);
  res.json({ user: publicUser(user) });
});

app.post("/api/users/:id/suspend", requireAuth, requireRole("Direktion"), (req, res) => {
  const user = req.db.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  const targetError = assertCanAffectUser(req.user, user, "suspendieren");
  if (targetError) return res.status(403).json({ error: targetError });
  const reason = String(req.body.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "Bitte einen Grund angeben." });
  const before = publicUser(user);
  setAccountStatus(user, "Suspendiert");
  user.updatedAt = nowIso();
  req.db.sessions = req.db.sessions.filter((session) => session.userId !== user.id);
  logDisciplinary(req.db, user, "Suspendierung", reason, req.user);
  logAction(req.db, req.user, "Benutzer suspendiert", `${user.firstName} ${user.lastName}`.trim(), { reason, before, after: publicUser(user) });
  writeDb(req.db);
  res.json({ user: publicUser(user) });
});

app.post("/api/users/:id/dismiss", requireAuth, requireRole("Direktion"), (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "Du kannst dich nicht selbst entlassen." });
  const user = req.db.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  const targetError = assertCanAffectUser(req.user, user, "entlassen");
  if (targetError) return res.status(403).json({ error: targetError });
  const reason = String(req.body.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "Bitte einen Grund angeben." });
  const before = publicUser(user);
  const oldRank = user.rank;
  const oldDn = user.dn;
  const oldTrainings = { ...(user.trainings || {}) };
  setAccountStatus(user, "Entlassen");
  user.terminated = true;
  user.termination = {
    reason,
    oldRank,
    oldDn,
    oldTrainings,
    terminatedAt: nowIso(),
    actorName: actorName(req.user)
  };
  user.updatedAt = nowIso();
  req.db.duty = req.db.duty.filter((entry) => entry.userId !== user.id);
  req.db.sessions = req.db.sessions.filter((session) => session.userId !== user.id);
  req.db.settings.departments.forEach((department) => {
    department.members = department.members.filter((member) => member.userId !== user.id);
  });
  logFluctuation(req.db, user, "Kündigung", req.user);
  req.db.settings.fluctuation[0].reason = reason;
  logDisciplinary(req.db, user, "Entlassen", reason, req.user);
  logAction(req.db, req.user, "Benutzer entlassen", `${user.firstName} ${user.lastName}`.trim(), { reason, before, after: publicUser(user) });
  writeDb(req.db);
  syncDiscordRolesForUser(req.db, user, "Benutzer entlassen");
  res.json({ user: publicUser(user) });
});

app.post("/api/users/:id/rehire", requireAuth, requireRole("Direktion"), (req, res) => {
  const user = req.db.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  if (!user.terminated) return res.status(400).json({ error: "Account ist nicht archiviert." });
  const dn = String(req.body.dn || user.termination?.oldDn || user.dn || "").trim();
  const dnError = validateDigits(dn, "Dienstnummer");
  if (dnError) return res.status(400).json({ error: dnError });
  const dnConflict = resolveDnConflict(req.db, user.id, dn, Boolean(req.body.overwriteDn));
  if (dnConflict?.error) return res.status(400).json({ error: dnConflict.error });
  const rank = Number(req.body.rank ?? user.termination?.oldRank ?? user.rank);
  const rankError = assertCanSetUserRank(req.user, rank);
  if (rankError) return res.status(403).json({ error: rankError });
  if (!Number.isInteger(rank) || rank < 0) return res.status(400).json({ error: "Ungültiger Rang." });
  const firstName = String(req.body.firstName || user.firstName || "").trim();
  const lastName = String(req.body.lastName || user.lastName || "").trim();
  const phone = String(req.body.phone || user.phone || "").trim();
  const joinedAt = String(req.body.joinedAt || todayIso()).slice(0, 10);
  const requestedRole = roles.includes(req.body.role) ?req.body.role : user.role;
  const roleCheck = protectItRoleChange(req.user, user.role, requestedRole);
  if (roleCheck.error) return res.status(403).json({ error: roleCheck.error });
  const role = roleCheck.role;
  const requestedBaseRole = String(req.body.baseRole || "").trim();
  const baseRole = roles.includes(requestedBaseRole) && !["Template", "IT", "IT-Leitung"].includes(requestedBaseRole)
    ?requestedBaseRole
    : user.baseRole || (["Template", "IT", "IT-Leitung"].includes(role) ?"Direktion" : role);
  if (!firstName || !lastName || !phone) return res.status(400).json({ error: "Name, Nachname und Telefonnummer sind Pflichtfelder." });
  const before = publicUser(user);
  user.terminated = false;
  setAccountStatus(user, "Aktiv");
  user.firstName = firstName;
  user.lastName = lastName;
  user.phone = phone;
  user.role = role;
  user.baseRole = baseRole;
  user.teamler = Boolean(req.body.teamler);
  user.dn = dn;
  user.rank = rank;
  user.joinedAt = joinedAt;
  const beforeTrainings = { ...(user.trainings || {}) };
  user.trainings = { ...Object.fromEntries(trainingNames.map((training) => [training, false])), ...(req.body.trainings || user.termination?.oldTrainings || user.trainings || {}) };
  updateTrainingMeta(user, beforeTrainings, user.trainings, req.user);
  user.rehiredAt = nowIso();
  user.updatedAt = nowIso();
  syncDirektionMembership(req.db, user, { roleAssigned: role === "Direktion" });
  logFluctuation(req.db, user, "Eingestellt", req.user);
  req.db.settings.fluctuation[0].reason = String(req.body.reason || "Wiedereinstellung").trim() || "Wiedereinstellung";
  logDisciplinary(req.db, user, "Wiedereinstellung", req.db.settings.fluctuation[0].reason, req.user);
  logAction(req.db, req.user, "Benutzer wiedereingestellt", `${user.firstName} ${user.lastName}`.trim(), { before, after: publicUser(user) });
  writeDb(req.db);
  syncDiscordRolesForUser(req.db, user, "Benutzer wiedereingestellt");
  res.json({ user: publicUser(user) });
});

app.post("/api/users/:id/file", requireAuth, (req, res) => {
  if (!canManagePersonnelFiles(req.user, req.db)) return res.status(403).json({ error: "Keine Berechtigung." });
  const user = req.db.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  const type = String(req.body.type || "").trim();
  const reason = String(req.body.reason || "").trim();
  if (!["Aktennotiz", "Sanktion", "Strike"].includes(type)) return res.status(400).json({ error: "Ungültiger Akteneintrag." });
  if (!reason) return res.status(400).json({ error: "Bitte einen Text oder Grund angeben." });
  const sanctionType = type === "Strike" ?"Strike" : String(req.body.sanctionType || "").trim();
  if (type === "Sanktion" && !["Strike", "Geldstrafe", "Custom"].includes(sanctionType)) return res.status(400).json({ error: "Bitte eine Sanktionsart auswählen." });
  const customSanction = Boolean(req.body.customSanction);
  const catalogId = String(req.body.catalogId || "").trim();
  if (type === "Sanktion" && customSanction && !canCreateCustomSanctions(req.user, req.db)) {
    return res.status(403).json({ error: "Eigene Sanktionen dürfen nur Perso-Leitung, Direktion oder IT vergeben." });
  }
  if (type === "Sanktion" && !customSanction && !req.db.settings.sanctionCatalog.some((item) => item.id === catalogId)) {
    return res.status(400).json({ error: "Bitte eine Sanktion aus dem Katalog auswählen." });
  }
  const catalogItem = type === "Sanktion" && !customSanction ?req.db.settings.sanctionCatalog.find((item) => item.id === catalogId) : null;
  const amount = Math.max(0, Number(req.body.amount || 0));
  const fineRange = sanctionFineRangeFromText(catalogItem?.fineText);
  const requiresCatalogFineRange = fineRange && (sanctionType === "Geldstrafe" || Number(catalogItem?.amount || 0) > 0 || amount > 0);
  if (type === "Sanktion" && !customSanction && requiresCatalogFineRange && !canOverrideSanctionFineRange(req.user, req.db)) {
    if (amount < fineRange.min || amount > fineRange.max) {
      return res.status(400).json({ error: `Geldstrafe muss im Sanktionsrahmen ${fineRange.text} liegen.` });
    }
  }
  const strikeCount = sanctionType === "Strike" || type === "Strike" ?Math.max(1, Math.min(3, Number(req.body.strikeCount || 1))) : 0;
  if ((type === "Strike" || sanctionType === "Strike") && activeStrikeCount(req.db.disciplinary, user.id) + strikeCount > 3) {
    return res.status(400).json({ error: "Dieses Mitglied hat bereits 3/3 aktive Strikes." });
  }
  const expiresAt = String(req.body.expiresAt || "").trim();
  const noExpiry = Boolean(req.body.noExpiry);
  if ((type === "Strike" || sanctionType === "Strike") && !expiresAt && !noExpiry) {
    return res.status(400).json({ error: "Bitte ein Ablaufdatum angeben oder Kein Ablaufdatum auswählen." });
  }
  const entry = {
    id: makeId("disciplinary"),
    type: type === "Aktennotiz" ?"Aktennotiz" : "Sanktion",
    sanctionType: type === "Aktennotiz" ?"" : sanctionType,
    userId: user.id,
    name: `${user.firstName} ${user.lastName}`.trim(),
    dn: user.dn,
    rank: user.rank,
    actorName: actorName(req.user),
    reason,
    title: String(req.body.title || sanctionType || type).trim(),
    amount,
    internal: Boolean(req.body.internal && req.user.role === "Direktion"),
    uprankBlockDays: Math.max(0, Number(req.body.uprankBlockDays || 0)),
    uprankBlockedUntil: Math.max(0, Number(req.body.uprankBlockDays || 0)) ?new Date(Date.now() + Math.max(0, Number(req.body.uprankBlockDays || 0)) * 86400000).toISOString().slice(0, 10) : "",
    strikeCount,
    noExpiry,
    catalogId,
    customSanction,
    expiresAt,
    createdAt: nowIso()
  };
  if (entry.type === "Sanktion") {
    entry.workflowStatus = "pending_approval";
    entry.submittedAt = entry.createdAt;
    entry.submittedBy = actorName(req.user);
  }
  req.db.disciplinary.unshift(entry);
  logAction(req.db, req.user, `${entry.type} zur Freigabe eingetragen`, `${user.firstName} ${user.lastName}`.trim(), { reason, sanctionType: entry.sanctionType, amount: entry.amount || "" });
  writeDb(req.db);
  res.status(201).json({ disciplinary: req.db.disciplinary });
});

app.delete("/api/users/:id/file/:entryId", requireAuth, (req, res) => {
  if (!canManagePersonnelFiles(req.user, req.db)) return res.status(403).json({ error: "Keine Berechtigung." });
  const user = req.db.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  const entry = (req.db.disciplinary || []).find((item) => item.id === req.params.entryId && item.userId === user.id);
  if (!entry) return res.status(404).json({ error: "Akteneintrag nicht gefunden." });
  if (isSanctionFileEntry(entry)) {
    const workflow = sanctionWorkflowStatus(entry);
    if (workflow === "rejected") {
      req.db.disciplinary = req.db.disciplinary.filter((item) => item.id !== entry.id);
      logAction(req.db, req.user, "Abgelehnte Sanktion gelöscht", `${user.firstName} ${user.lastName}`.trim(), { before: entry });
    } else if (entry.archivedAt) {
      if ((rolePower[req.user.role] || 0) < rolePower.Direktion) return res.status(403).json({ error: "Archivierte Sanktionen dürfen nur Direktion oder IT löschen." });
      req.db.disciplinary = req.db.disciplinary.filter((item) => item.id !== entry.id);
      logAction(req.db, req.user, "Archivierte Sanktion gelöscht", `${user.firstName} ${user.lastName}`.trim(), { before: entry });
    } else {
      entry.archivedAt = nowIso();
      entry.archivedBy = actorName(req.user);
      logAction(req.db, req.user, "Sanktion archiviert", `${user.firstName} ${user.lastName}`.trim(), { before: entry });
    }
  } else if (entry.type === "Aktennotiz") {
    req.db.disciplinary = req.db.disciplinary.filter((item) => item.id !== entry.id);
    logAction(req.db, req.user, "Aktennotiz entfernt", `${user.firstName} ${user.lastName}`.trim(), { before: entry });
  } else {
    return res.status(400).json({ error: "Dieser Eintrag kann nicht entfernt werden." });
  }
  writeDb(req.db);
  res.json({ ok: true });
});

app.patch("/api/users/:id/file/:entryId", requireAuth, (req, res) => {
  if (!canManagePersonnelFiles(req.user, req.db)) return res.status(403).json({ error: "Keine Berechtigung." });
  const user = req.db.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  const entry = (req.db.disciplinary || []).find((item) => item.id === req.params.entryId && item.userId === user.id);
  if (!entry) return res.status(404).json({ error: "Akteneintrag nicht gefunden." });
  const before = { ...entry };
  if (entry.type === "Aktennotiz") {
    const reason = String(req.body.reason || "").trim();
    if (!reason) return res.status(400).json({ error: "Bitte eine Notiz angeben." });
    entry.reason = reason;
    entry.updatedAt = nowIso();
    entry.updatedBy = actorName(req.user);
    logAction(req.db, req.user, "Aktennotiz bearbeitet", `${user.firstName} ${user.lastName}`.trim(), { before, after: entry });
  } else if (req.body.rejected && (entry.type === "Sanktion" || entry.type === "Strike")) {
    if (!canApprovePersonnelSanctions(req.user, req.db)) return res.status(403).json({ error: "Nur Direktion oder Personalabteilungs-Leitung darf Sanktionen ablehnen." });
    if (entry.approvedAt || entry.workflowStatus === "open" || entry.workflowStatus === "active") return res.status(400).json({ error: "Bereits freigegebene Sanktionen können nicht mehr abgelehnt werden." });
    if (entry.rejectedAt) return res.status(400).json({ error: "Diese Sanktion wurde bereits abgelehnt." });
    const reason = String(req.body.reason || req.body.rejectedReason || "").trim();
    if (!reason) return res.status(400).json({ error: "Bitte einen Ablehnungsgrund angeben." });
    entry.workflowStatus = "rejected";
    entry.rejectedAt = nowIso();
    entry.rejectedBy = actorName(req.user);
    entry.rejectedReason = reason;
    logAction(req.db, req.user, "Sanktion abgelehnt", `${user.firstName} ${user.lastName}`.trim(), { before, after: entry });
  } else if (req.body.approved && (entry.type === "Sanktion" || entry.type === "Strike")) {
    if (!canApprovePersonnelSanctions(req.user, req.db)) return res.status(403).json({ error: "Nur Direktion oder Personalabteilungs-Leitung darf Sanktionen freigeben." });
    if (entry.approvedAt) return res.status(400).json({ error: "Diese Sanktion wurde bereits freigegeben." });
    if (entry.rejectedAt || entry.workflowStatus === "rejected") return res.status(400).json({ error: "Abgelehnte Sanktionen können nicht freigegeben werden." });
    const isStrike = entry.type === "Strike" || entry.sanctionType === "Strike" || Number(entry.strikeCount || 0) > 0;
    if (isStrike) {
      const otherEntries = (req.db.disciplinary || []).filter((item) => item.id !== entry.id);
      if (activeStrikeCount(otherEntries, user.id) + Math.max(1, Number(entry.strikeCount || 1)) > 3) {
        return res.status(400).json({ error: "Dieses Mitglied hätte nach Freigabe mehr als 3/3 aktive Strikes." });
      }
    }
    entry.workflowStatus = "open";
    entry.approvedAt = nowIso();
    entry.approvedBy = actorName(req.user);
    logAction(req.db, req.user, "Sanktion freigegeben", `${user.firstName} ${user.lastName}`.trim(), { before, after: entry });
  } else if (req.body.announced && (entry.type === "Sanktion" || entry.type === "Strike")) {
    if (!entry.approvedAt && entry.workflowStatus === "pending_approval") return res.status(400).json({ error: "Diese Sanktion muss zuerst freigegeben werden." });
    if (entry.announcedAt) return res.status(400).json({ error: "Diese Sanktion wurde bereits mitgeteilt." });
    entry.workflowStatus = "active";
    entry.announcedAt = nowIso();
    entry.announcedBy = actorName(req.user);
    logAction(req.db, req.user, "Sanktion mitgeteilt", `${user.firstName} ${user.lastName}`.trim(), { before, after: entry });
  } else if (req.body.paid && ((entry.type === "Sanktion" && entry.sanctionType === "Geldstrafe") || entry.type === "Geldstrafe" || Number(entry.amount || 0) > 0)) {
    if (entry.workflowStatus === "pending_approval" && !entry.approvedAt) return res.status(400).json({ error: "Diese Geldstrafe muss zuerst freigegeben werden." });
    if (!entry.announcedAt) return res.status(400).json({ error: "Diese Sanktion muss zuerst als mitgeteilt markiert werden." });
    const paidTo = String(req.body.paidTo || "").trim();
    if (!paidTo) return res.status(400).json({ error: "Bitte angeben, an wen die Geldstrafe bezahlt wurde." });
    entry.paidAt = nowIso();
    entry.paidBy = actorName(req.user);
    entry.paidTo = paidTo;
    if (entry.type === "Sanktion" || entry.type === "Strike") entry.workflowStatus = "active";
    logAction(req.db, req.user, "Geldstrafe bezahlt", `${user.firstName} ${user.lastName}`.trim(), { before, after: entry });
  } else if (req.body.strikeResolved && (entry.type === "Strike" || entry.sanctionType === "Strike" || Number(entry.strikeCount || 0) > 0)) {
    if (entry.workflowStatus === "pending_approval" && !entry.approvedAt) return res.status(400).json({ error: "Diese Sanktion muss zuerst freigegeben werden." });
    const reason = String(req.body.reason || req.body.strikeResolvedReason || "").trim();
    const expired = entry.expiresAt && new Date(entry.expiresAt) <= new Date();
    if (!expired && !reason) return res.status(400).json({ error: "Bitte einen Grund angeben, warum der Strike vor Ablauf entfernt wurde." });
    entry.strikeResolvedAt = nowIso();
    entry.strikeResolvedBy = actorName(req.user);
    entry.strikeResolvedReason = reason || "Nach Ablauf entfernt";
    logAction(req.db, req.user, "Strike abgehakt", `${user.firstName} ${user.lastName}`.trim(), { before, after: entry });
  } else if ((entry.type === "Sanktion" || entry.type === "Strike") && req.body.resolved) {
    const workflow = sanctionWorkflowStatus(entry);
    if (workflow === "pending_approval" || workflow === "open") return res.status(400).json({ error: "Die Sanktion muss zuerst freigegeben und verkündet oder bezahlt werden." });
    const hasFine = entry.sanctionType === "Geldstrafe" || entry.type === "Geldstrafe" || Number(entry.amount || 0) > 0;
    const hasStrike = entry.type === "Strike" || entry.sanctionType === "Strike" || Number(entry.strikeCount || 0) > 0;
    const strikeDone = !hasStrike || entry.strikeResolvedAt || (entry.expiresAt && new Date(entry.expiresAt) <= new Date());
    const fineDone = !hasFine || entry.paidAt;
    if (!fineDone || !strikeDone) return res.status(400).json({ error: "Strike und Geldstrafe müssen zuerst separat abgehakt werden." });
    entry.archivedAt = nowIso();
    entry.archivedBy = actorName(req.user);
    logAction(req.db, req.user, "Sanktion erledigt", `${user.firstName} ${user.lastName}`.trim(), { before, after: entry });
  } else {
    return res.status(400).json({ error: "Dieser Eintrag kann nicht bearbeitet werden." });
  }
  writeDb(req.db);
  res.json({ entry });
});

app.delete("/api/users/:id", requireAuth, requireRole("IT"), (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "Du kannst dich nicht selbst löschen." });
  req.db.users = req.db.users.filter((user) => user.id !== req.params.id);
  removeUserReferences(req.db, [req.params.id]);
  logAction(req.db, req.user, "Benutzer gelöscht", req.params.id);
  writeDb(req.db);
  res.json({ ok: true });
});

app.patch("/api/profile/password", requireAuth, (req, res) => {
  const oldPassword = String(req.body.oldPassword || "");
  const newPassword = String(req.body.newPassword || "");
  if (!req.user.mustChangePassword && req.user.passwordHash !== hashPassword(oldPassword)) return res.status(400).json({ error: "Altes Passwort stimmt nicht." });
  if (!newPassword) return res.status(400).json({ error: "Neues Passwort darf nicht leer sein." });
  const wasPendingActivation = Boolean(req.user.mustChangePassword);
  const firstActivation = wasPendingActivation && !req.user.activatedAt;
  const changedAt = nowIso();
  req.user.passwordHash = hashPassword(newPassword);
  req.user.mustChangePassword = false;
  if (wasPendingActivation) {
    if (!req.user.activatedAt) req.user.activatedAt = changedAt;
    req.user.notificationBaselineAt = changedAt;
    req.user.changelogReadIds = [];
    req.user.tutorialCompleted = Boolean(req.user.tutorialSkipped);
  }
  req.user.updatedAt = changedAt;
  logAction(req.db, req.user, "Passwort geändert", `${req.user.firstName} ${req.user.lastName}`.trim());
  writeDb(req.db);
  if (wasPendingActivation && req.user.discordId) {
    syncDiscordRolesForUser(req.db, req.user, "Account aktiviert");
  }
  res.json({ ok: true, activated: wasPendingActivation, firstActivation, user: publicUser(req.user) });
});

app.patch("/api/profile/tutorial", requireAuth, (req, res) => {
  req.user.tutorialCompleted = true;
  req.user.tutorialCompletedAt = nowIso();
  logAction(req.db, req.user, "Tutorial abgeschlossen", `${req.user.firstName} ${req.user.lastName}`.trim());
  writeDb(req.db);
  res.json({ ok: true, user: publicUser(req.user) });
});

app.patch("/api/it/users/:id/tutorial-skip", requireAuth, requireRole("IT"), (req, res) => {
  const user = req.db.users.find((item) => item.id === req.params.id && !item.terminated);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  const before = { tutorialCompleted: Boolean(user.tutorialCompleted), tutorialSkipped: Boolean(user.tutorialSkipped) };
  user.tutorialSkipped = true;
  user.tutorialCompleted = true;
  user.tutorialCompletedAt = nowIso();
  user.updatedAt = nowIso();
  logAction(req.db, req.user, "Tutorial übersprungen", actorName(user), { before, after: { tutorialCompleted: user.tutorialCompleted, tutorialSkipped: user.tutorialSkipped } });
  writeDb(req.db);
  res.json({ user: publicUser(user) });
});

app.patch("/api/profile/changelog-read", requireAuth, (req, res) => {
  const validIds = new Set((req.db.settings.changelog || []).map((entry) => String(entry.id || "")).filter(Boolean));
  const incoming = Array.isArray(req.body.ids) ?req.body.ids.map(String).filter((id) => validIds.has(id)) : [];
  req.user.changelogReadIds = [...new Set([...(req.user.changelogReadIds || []).map(String), ...incoming])];
  req.user.updatedAt = nowIso();
  writeDb(req.db);
  res.json({ ok: true, user: publicUser(req.user) });
});

app.patch("/api/profile/avatar", requireAuth, (req, res) => {
  const avatarUrl = String(req.body.avatarUrl || "").trim();
  if (avatarUrl && !/^https?:\/\//i.test(avatarUrl) && !avatarUrl.startsWith("/") && !avatarUrl.startsWith("data:image/")) {
    return res.status(400).json({ error: "Avatar muss eine http(s)- oder lokale URL sein." });
  }
  const before = req.user.avatarUrl || "";
  req.user.avatarUrl = avatarUrl;
  req.user.updatedAt = nowIso();
  logAction(req.db, req.user, "Avatar aktualisiert", `${req.user.firstName} ${req.user.lastName}`.trim(), { before: before ?"Avatar vorhanden" : "Kein Avatar", after: avatarUrl ?"Avatar hochgeladen" : "Avatar entfernt" });
  writeDb(req.db);
  res.json({ user: publicUser(req.user) });
});

app.patch("/api/profile/twitch", requireAuth, async (req, res) => {
  try {
    const user = await updateUserTwitch(req.db, req.user, req.user, req.body.twitchLogin || "");
    writeDb(req.db);
    res.json({ user, twitchConfigured: twitchConfigured(req.db.settings) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/profile/twitch/check", requireAuth, async (req, res) => {
  try {
    const result = await checkSingleTwitchUser(req.db, req.user);
    writeDb(req.db);
    res.json({ user: publicUser(req.user), twitchConfigured: twitchConfigured(req.db.settings), ...result });
  } catch (error) {
    res.status(400).json({ error: error.message, twitchConfigured: twitchConfigured(req.db.settings) });
  }
});

app.patch("/api/it/users/:id/twitch", requireAuth, requireRole("IT"), async (req, res) => {
  const user = req.db.users.find((item) => item.id === req.params.id && !item.terminated);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  try {
    const updatedUser = await updateUserTwitch(req.db, req.user, user, req.body.twitchLogin || "");
    writeDb(req.db);
    res.json({ user: updatedUser, twitchConfigured: twitchConfigured(req.db.settings) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch("/api/settings/defcon", requireAuth, requirePermission("actions", "editDefcon", "Supervisor"), (req, res) => {
  const defcon = String(req.body.defcon || "");
  if (!/^DEFCON [1-5]$/.test(defcon)) return res.status(400).json({ error: "Ungültige DEFCON-Stufe." });
  const before = { defcon: req.db.settings.defcon, defconText: req.db.settings.defconText };
  req.db.settings.defcon = defcon;
  req.db.settings.defconText = typeof req.body.defconText === "string" ?req.body.defconText.trim() : String(req.db.settings.defconText || "");
  req.db.settings.defconUpdatedBy = `${req.user.firstName} ${req.user.lastName}`.trim();
  req.db.settings.defconUpdatedAt = nowIso();
  logAction(req.db, req.user, "DEFCON geändert", "DEFCON", { before, after: { defcon, defconText: req.db.settings.defconText } });
  writeDb(req.db);
  res.json({ settings: publicSettings(req.db.settings) });
});

app.patch("/api/information", requireAuth, requirePermission("actions", "manageInformation", "Direktion"), (req, res) => {
  const before = {
    informationText: req.db.settings.informationText,
    applicationStatus: req.db.settings.applicationStatus,
    informationRightsBriefText: req.db.settings.informationRightsBriefText,
    informationRightsText: req.db.settings.informationRightsText,
    informationLinks: req.db.settings.informationLinks,
    informationDocs: req.db.settings.informationDocs,
    informationDocChanges: req.db.settings.informationDocChanges,
    informationPermits: req.db.settings.informationPermits,
    informationFactions: req.db.settings.informationFactions
  };
  req.db.settings.informationText = String(req.body.informationText || "").trim();
  req.db.settings.applicationStatus = ["Offen", "Geschlossen"].includes(req.body.applicationStatus) ?req.body.applicationStatus : "Offen";
  req.db.settings.informationRightsBriefText = String(req.body.informationRightsBriefText || "").trim();
  req.db.settings.informationRightsText = String(req.body.informationRightsText || "").trim();
  req.db.settings.informationLinks = Array.isArray(req.body.informationLinks) ?req.body.informationLinks.map((item) => ({ id: String(item.id || makeId("link")), title: String(item.title || "").trim(), url: String(item.url || "").trim() })).filter((item) => item.title && item.url) : [];
  req.db.settings.informationDocs = Array.isArray(req.body.informationDocs) ?req.body.informationDocs.map((item) => ({ id: String(item.id || makeId("doc")), title: String(item.title || "").trim(), body: String(item.body || "").trim(), updatedAt: String(item.updatedAt || new Date().toISOString()), updatedBy: String(item.updatedBy || "") })).filter((item) => item.title) : [];
  req.db.settings.informationDocChanges = normalizeInformationDocChanges(req.body.informationDocChanges);
  req.db.settings.informationPermits = Array.isArray(req.body.informationPermits) ?req.body.informationPermits.map((item) => ({ id: String(item.id || makeId("permit")), name: String(item.name || "").trim(), description: String(item.description || "").trim(), validUntil: String(item.validUntil || "").trim() })).filter((item) => item.name && item.description && item.validUntil) : [];
  req.db.settings.informationFactions = Array.isArray(req.body.informationFactions) ?req.body.informationFactions.map((item) => ({ id: String(item.id || makeId("faction")), organization: String(item.organization || "").trim(), status: ["Normal", "Mittel", "Hoch"].includes(item.status) ?item.status : "Normal" })).filter((item) => item.organization) : [];
  logAction(req.db, req.user, "Informationen geändert", "Informationen", { before: {
    docs: before.informationDocs?.length || 0,
    changes: before.informationDocChanges?.length || 0,
    links: before.informationLinks?.length || 0,
    rightsBriefLength: String(before.informationRightsBriefText || "").length,
    rightsLength: String(before.informationRightsText || "").length,
    permits: before.informationPermits?.length || 0,
    factions: before.informationFactions?.length || 0
  }, after: {
    informationText: req.db.settings.informationText,
    applicationStatus: req.db.settings.applicationStatus,
    docs: req.db.settings.informationDocs.length,
    changes: req.db.settings.informationDocChanges.length,
    links: req.db.settings.informationLinks.length,
    rightsBriefLength: req.db.settings.informationRightsBriefText.length,
    rightsLength: req.db.settings.informationRightsText.length,
    permits: req.db.settings.informationPermits.length,
    factions: req.db.settings.informationFactions.length
  } });
  writeDb(req.db);
  res.json({ settings: publicSettings(req.db.settings) });
});

app.post("/api/information/edit-locks", requireAuth, requirePermission("actions", "manageInformation", "Direktion"), (req, res) => {
  const key = String(req.body.key || "").trim();
  const label = String(req.body.label || "").trim();
  if (!key) return res.status(400).json({ error: "Bearbeitungsbereich fehlt." });
  publicInformationEditLocks();
  const existing = informationEditLocks.get(key);
  if (existing && existing.userId !== req.user.id) {
    return res.status(409).json({ error: `${existing.userName || "Jemand"} bearbeitet gerade ${existing.label || "diesen Bereich"}.`, lock: existing, settings: publicSettings(req.db.settings) });
  }
  const isNewLock = !existing;
  const lock = {
    key,
    label,
    userId: req.user.id,
    userName: actorName(req.user),
    updatedAt: nowIso()
  };
  informationEditLocks.set(key, lock);
  if (isNewLock) informationEditLocksRevision = nowIso();
  res.json({ lock, settings: publicSettings(req.db.settings) });
});

app.delete("/api/information/edit-locks/:key", requireAuth, requirePermission("actions", "manageInformation", "Direktion"), (req, res) => {
  const key = String(req.params.key || "");
  const existing = informationEditLocks.get(key);
  if (existing?.userId === req.user.id) {
    informationEditLocks.delete(key);
    informationEditLocksRevision = nowIso();
  }
  res.json({ settings: publicSettings(req.db.settings) });
});

app.patch("/api/it/ranks", requireAuth, requireRole("IT"), (req, res) => {
  const nextRanks = Array.isArray(req.body.ranks) ?req.body.ranks : [];
  if (!nextRanks.length) return res.status(400).json({ error: "Es muss mindestens ein Rang vorhanden sein." });

  const before = req.db.settings.ranks;
  req.db.settings.ranks = nextRanks
    .map((rank) => ({
      value: Number(rank.value),
      label: String(rank.label || `Template ${rank.value} - Rang ${rank.value}`).trim()
    }))
    .filter((rank) => Number.isInteger(rank.value) && rank.value >= 0)
    .sort((a, b) => a.value - b.value);
  logAction(req.db, req.user, "Ränge geändert", "IT", { before, after: req.db.settings.ranks });
  writeDb(req.db);
  res.json({ ranks: req.db.settings.ranks });
});

app.patch("/api/it/nav-labels", requireAuth, requireRole("IT"), (req, res) => {
  const navLabels = req.body.navLabels && typeof req.body.navLabels === "object" ?req.body.navLabels : {};
  const before = {
    navLabels: req.db.settings.navLabels,
    departments: req.db.settings.departments.map((department) => ({ id: department.id, name: department.name }))
  };
  const nextNavLabels = {};
  Object.entries(navLabels).forEach(([key, value]) => {
    const label = String(value || key).trim();
    if (key.startsWith("dept:")) {
      const departmentId = key.slice(5);
      const department = req.db.settings.departments.find((item) => item.id === departmentId);
      if (department && label) department.name = label;
      return;
    }
    nextNavLabels[key] = label;
  });
  req.db.settings.navLabels = nextNavLabels;
  logAction(req.db, req.user, "Reiter geändert", "IT", {
    before,
    after: {
      navLabels: req.db.settings.navLabels,
      departments: req.db.settings.departments.map((department) => ({ id: department.id, name: department.name }))
    }
  });
  writeDb(req.db);
  res.json({
    navLabels: req.db.settings.navLabels,
    departments: req.db.settings.departments.map((department) => publicDepartment(department, req.db, req.user))
  });
});

app.patch("/api/it/page-order", requireAuth, requireRole("IT"), (req, res) => {
  const pageOrder = Array.isArray(req.body.pageOrder) ?req.body.pageOrder.map(String).filter(Boolean) : [];
  const before = req.db.settings.pageOrder || [];
  req.db.settings.pageOrder = [...new Set(pageOrder)];
  logAction(req.db, req.user, "Reiter sortiert", "IT", { before, after: req.db.settings.pageOrder });
  writeDb(req.db);
  res.json({ settings: publicSettings(req.db.settings) });
});

app.post("/api/it/custom-pages", requireAuth, requireRole("IT"), (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name ist erforderlich." });
  req.db.settings.customPages = Array.isArray(req.db.settings.customPages) ?req.db.settings.customPages : [];
  const existingKeys = new Set([
    ...req.db.settings.customPages.map((page) => page.key),
    ...req.db.settings.departments.map((department) => `dept:${department.id}`)
  ]);
  let base = `custom:${slugify(name)}`;
  let key = base;
  let index = 2;
  while (existingKeys.has(key)) key = `${base}-${index++}`;
  const page = { key, name, createdAt: nowIso() };
  req.db.settings.customPages.push(page);
  req.db.settings.navLabels = { ...(req.db.settings.navLabels || {}), [key]: name };
  req.db.settings.permissions = normalizePermissions(req.db.settings.permissions || {});
  req.db.settings.permissions.pages[key] = { all: false, roles: ["IT", "IT-Leitung"], ranks: [], users: [], departments: [], positions: [] };
  req.db.settings.pageOrder = [...new Set([...(req.db.settings.pageOrder || []), key])];
  logAction(req.db, req.user, "Reiter erstellt", name, { after: page });
  writeDb(req.db);
  res.status(201).json({ page, settings: publicSettings(req.db.settings) });
});

app.post("/api/it/departments", requireAuth, requireRole("IT"), (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name ist erforderlich." });
  const existingIds = new Set(req.db.settings.departments.map((department) => department.id));
  let base = slugify(name, "abteilung");
  let id = base;
  let index = 2;
  while (existingIds.has(id)) id = `${base}-${index++}`;
  const department = makeDepartment(id, name, "Leeres Abteilungsblatt", "Offen");
  req.db.settings.departments.push(department);
  req.db.settings.permissions = normalizePermissions(req.db.settings.permissions || {});
  req.db.settings.permissions.pages[`dept:${id}`] = { all: false, roles: ["IT", "IT-Leitung"], ranks: [], users: [], departments: [], positions: [] };
  req.db.settings.pageOrder = [...new Set([...(req.db.settings.pageOrder || []), `dept:${id}`])];
  logAction(req.db, req.user, "Abteilung erstellt", name, { after: department });
  writeDb(req.db);
  res.status(201).json({
    department: publicDepartment(department, req.db, req.user),
    settings: publicSettings(req.db.settings),
    departments: req.db.settings.departments.map((item) => publicDepartment(item, req.db, req.user))
  });
});

app.patch("/api/it/permissions", requireAuth, requireRole("IT"), (req, res) => {
  const before = req.db.settings.permissions || defaultPermissions();
  req.db.settings.permissions = normalizePermissions(req.body.permissions || {});
  logAction(req.db, req.user, "Berechtigungen geändert", "IT", { before, after: req.db.settings.permissions });
  writeDb(req.db);
  res.json({ permissions: req.db.settings.permissions });
});

app.patch("/api/it/default-password", requireAuth, requireRole("IT"), (req, res) => {
  const defaultPassword = String(req.body.defaultPassword || "").trim();
  if (!defaultPassword) return res.status(400).json({ error: "Das Standardpasswort darf nicht leer sein." });
  const beforeSet = Boolean(req.db.settings.defaultPassword);
  req.db.settings.defaultPassword = defaultPassword;
  logAction(req.db, req.user, "Standardpasswort geändert", "IT", { beforeSet, afterSet: true });
  writeDb(req.db);
  res.json({ settings: publicSettings(req.db.settings) });
});

app.get("/api/it/secrets", requireAuth, requireItLead, (req, res) => {
  res.json({ secrets: publicSecretConfig(req.db.settings) });
});

app.patch("/api/it/secrets", requireAuth, requireItLead, (req, res) => {
  const body = req.body && typeof req.body === "object" ?req.body : {};
  const clear = body.clear && typeof body.clear === "object" ?body.clear : {};
  const map = {
    discordApplicationId: "DISCORD_APPLICATION_ID",
    discordPublicKey: "DISCORD_PUBLIC_KEY",
    discordServerId: "DISCORD_SERVER_ID",
    discordSyncChannelId: "DISCORD_SYNC_CHANNEL_ID",
    discordItChannelId: "DISCORD_IT_CHANNEL_ID",
    discordInviteUrl: "DISCORD_INVITE_URL",
    discordOauthRedirectUrl: "DISCORD_OAUTH_REDIRECT_URL",
    discordUnsyncedRoleId: "DISCORD_UNSYNCED_ROLE_ID",
    publicBaseUrl: "PUBLIC_BASE_URL",
    twitchClientId: "TWITCH_CLIENT_ID",
    discordClientSecret: "DISCORD_CLIENT_SECRET",
    discordBotToken: "DISCORD_BOT_TOKEN",
    twitchClientSecret: "TWITCH_CLIENT_SECRET"
  };
  const updates = {};
  const twitchConfig = normalizeTwitchLivecheckConfig(req.db.settings.twitchLivecheck);
  const beforeDiscordSync = normalizeDiscordSync(req.db.settings.discordSync);
  const discordSync = normalizeDiscordSync(req.db.settings.discordSync);
  Object.entries(map).forEach(([inputKey, envKey]) => {
    if (clear[inputKey]) {
      updates[envKey] = "";
      if (inputKey === "twitchClientSecret") twitchConfig.clientSecret = "";
      if (inputKey === "discordClientSecret") discordSync.clientSecret = "";
      if (inputKey === "discordBotToken") discordSync.botToken = "";
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(body, inputKey)) return;
    const value = String(body[inputKey] || "").trim();
    if (["discordClientSecret", "discordBotToken", "twitchClientSecret"].includes(inputKey) && !value) return;
    updates[envKey] = value;
    if (inputKey === "twitchClientId") twitchConfig.clientId = value;
    if (inputKey === "twitchClientSecret") twitchConfig.clientSecret = value;
    if (inputKey === "discordApplicationId") discordSync.applicationId = value;
    if (inputKey === "discordPublicKey") discordSync.publicKey = value;
    if (inputKey === "discordServerId") discordSync.serverId = value;
    if (inputKey === "discordSyncChannelId") discordSync.syncChannelId = value;
    if (inputKey === "discordItChannelId") discordSync.itChannelId = value;
    if (inputKey === "discordInviteUrl") discordSync.inviteUrl = value;
    if (inputKey === "discordOauthRedirectUrl") discordSync.oauthRedirectUrl = value;
    if (inputKey === "discordUnsyncedRoleId") discordSync.unsyncedRoleId = value;
    if (inputKey === "discordClientSecret") discordSync.clientSecret = value;
    if (inputKey === "discordBotToken") discordSync.botToken = value;
    if (inputKey === "publicBaseUrl") req.db.settings.publicBaseUrl = normalizePublicUrl(value, "");
  });
  updateEnvFile(updates);
  req.db.settings.twitchLivecheck = twitchConfig;
  req.db.settings.discordSync = discordSync;
  twitchAccessToken = "";
  twitchAccessTokenExpiresAt = 0;
  logAction(req.db, req.user, "Secrets aktualisiert", "IT Leitung", { keys: Object.keys(updates) });
  writeDb(req.db);
  const discordChanged = beforeDiscordSync.botToken !== discordSync.botToken
    || beforeDiscordSync.serverId !== discordSync.serverId
    || beforeDiscordSync.applicationId !== discordSync.applicationId
    || beforeDiscordSync.enabled !== discordSync.enabled;
  if (discordChanged && discordClient) {
    discordClient.destroy?.();
    discordClient = null;
    discordBotStarting = false;
  }
  if (discordChanged) startDiscordBot();
  res.json({ secrets: publicSecretConfig(req.db.settings) });
});

app.patch("/api/it/discord-sync", requireAuth, requireItLead, (req, res) => {
  const incoming = req.body.discordSync && typeof req.body.discordSync === "object" ?req.body.discordSync : {};
  const current = normalizeDiscordSync(req.db.settings.discordSync);
  const clearBotToken = Boolean(incoming.clearBotToken);
  const clearClientSecret = Boolean(incoming.clearClientSecret);
  const next = normalizeDiscordSync({
    ...incoming,
    importedRoles: current.importedRoles,
    clientSecret: clearClientSecret ?"" : String(incoming.clientSecret || "").trim() || current.clientSecret,
    botToken: clearBotToken ?"" : String(incoming.botToken || "").trim() || current.botToken
  });
  const before = publicDiscordSync(current);
  req.db.settings.discordSync = next;
  logAction(req.db, req.user, "Discord Sync geaendert", "IT", { before, after: publicDiscordSync(next) });
  writeDb(req.db);
  const mustRestartBot = current.botToken !== next.botToken || current.serverId !== next.serverId || current.enabled !== next.enabled;
  if ((!next.enabled || mustRestartBot) && discordClient) {
    discordClient.destroy?.();
    discordClient = null;
    discordBotStarting = false;
  }
  startDiscordBot();
  if (discordClient && next.enabled) {
    registerDiscordCommands(discordClient, next).catch((error) => console.warn("Discord Befehle konnten nicht registriert werden:", error.message));
    sendDiscordSyncPanel(discordClient, next).catch((error) => console.warn("Discord Sync Panel Update fehlgeschlagen:", error.message));
  }
  res.json({ settings: publicSettings(req.db.settings) });
});

app.post("/api/it/discord-sync/import-roles", requireAuth, requireItLead, async (req, res) => {
  const sync = normalizeDiscordSync(req.db.settings.discordSync);
  if (!sync.serverId || !sync.botToken) return res.status(400).json({ error: "Server ID und Bot Token muessen hinterlegt sein." });
  try {
    const roles = await discordApiRequest("GET", sync, `/guilds/${encodeURIComponent(sync.serverId)}/roles`);
    const importedRoles = normalizeDiscordImportedRoles((Array.isArray(roles) ?roles : []).filter((role) => role.name !== "@everyone"));
    req.db.settings.discordSync = normalizeDiscordSync({ ...sync, importedRoles });
    logAction(req.db, req.user, "Discord Rollen importiert", "IT", { roles: importedRoles.length });
    writeDb(req.db);
    res.json({ settings: publicSettings(req.db.settings), roles: importedRoles });
  } catch (error) {
    res.status(400).json({ error: error.message || "Discord Rollen konnten nicht importiert werden." });
  }
});

app.post("/api/it/discord-sync/run", requireAuth, requireItLead, async (req, res) => {
  if (discordFullSyncRunning) return res.status(409).json({ error: "Discord Gesamtsync laeuft bereits. Bitte warte, bis der aktuelle Lauf abgeschlossen ist." });
  const sync = normalizeDiscordSync(req.db.settings.discordSync);
  if (!sync.enabled || !sync.serverId || !sync.botToken) return res.status(400).json({ error: "Discord Sync ist noch nicht vollst\u00e4ndig eingerichtet." });
  discordFullSyncRunning = true;
  discordFullSyncStatus = {
    running: true,
    startedAt: nowIso(),
    finishedAt: "",
    synced: 0,
    failed: 0,
    skipped: 0,
    failedAccounts: [],
    error: ""
  };
  setImmediate(() => {
    runDiscordFullSyncJob(req.user.id).catch((error) => {
      console.warn("Discord Gesamtsync Hintergrundjob fehlgeschlagen:", error.message);
    });
  });
  res.status(202).json({ started: true, status: publicDiscordFullSyncStatus() });
});

app.get("/api/it/discord-sync/status", requireAuth, requireItLead, (req, res) => {
  res.json({ status: publicDiscordFullSyncStatus() });
});

app.post("/api/it/users/:id/discord-sync", requireAuth, requireItLead, async (req, res) => {
  const sync = normalizeDiscordSync(req.db.settings.discordSync);
  if (!sync.enabled || !sync.serverId || !sync.botToken) return res.status(400).json({ error: "Discord Sync ist noch nicht vollst\u00e4ndig eingerichtet." });
  const user = req.db.users.find((item) => item.id === req.params.id && !item.terminated);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  const incomingDiscordId = String(req.body.discordId || "").trim();
  if (!user.discordId) {
    if (!incomingDiscordId) return res.status(400).json({ error: "Discord User-ID fehlt." });
    const discordIdError = validateDigits(incomingDiscordId, "Discord User-ID");
    if (discordIdError) return res.status(400).json({ error: discordIdError });
    const otherUser = req.db.users.find((item) => item.id !== user.id && !item.terminated && item.discordId === incomingDiscordId);
    if (otherUser) return res.status(400).json({ error: "Dieser Discord Account ist bereits mit einem anderen Dienstblatt-Account verknüpft." });
    let discordMember = null;
    try {
      discordMember = await discordApiRequest("GET", sync, `/guilds/${encodeURIComponent(sync.serverId)}/members/${encodeURIComponent(incomingDiscordId)}`);
    } catch (error) {
      return res.status(400).json({ error: error.message || "Discord Mitglied konnte nicht gefunden werden." });
    }
    const before = publicUser(user);
    user.discordId = incomingDiscordId;
    user.discordName = discordMember.nick || discordMember.user?.global_name || discordMember.user?.username || "";
    user.updatedAt = nowIso();
    logAction(req.db, req.user, "Discord Sync gesetzt", actorName(user), { before, after: publicUser(user), discordId: user.discordId, discordName: user.discordName });
    writeDb(req.db);
  }
  try {
    const ok = await syncDiscordRolesForUser(req.db, user, "Manueller Mitgliedersync", { force: true });
    res.json({ user: publicUser(user), synced: ok !== false });
  } catch (error) {
    console.warn("Discord Mitgliedersync fehlgeschlagen:", error.message);
    res.status(500).json({ error: error.message || "Discord Mitgliedersync fehlgeschlagen." });
  }
});

app.post("/api/it/discord-sync/test", requireAuth, requireItLead, async (req, res) => {
  const sync = normalizeDiscordSync(req.db.settings.discordSync);
  if (!sync.botToken) return res.status(400).json({ error: "Bot Token fehlt." });
  try {
    const bot = await discordApiRequest("GET", sync, "/users/@me");
    let guild = null;
    if (sync.serverId) guild = await discordApiRequest("GET", sync, `/guilds/${encodeURIComponent(sync.serverId)}`);
    res.json({
      ok: true,
      botName: bot.username ?`${bot.username}${bot.discriminator && bot.discriminator !== "0" ?`#${bot.discriminator}` : ""}` : "Discord Bot",
      guildName: guild?.name || ""
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Discord Verbindung fehlgeschlagen." });
  }
});

app.post("/api/it/users/:id/reset-password", requireAuth, requireRole("Direktion"), (req, res) => {
  const user = req.db.users.find((item) => item.id === req.params.id && !item.terminated);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  try {
    const publicResetUser = resetUserPassword(req.db, user, req.user);
    writeDb(req.db);
    return res.json({ user: publicResetUser });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Passwort Reset fehlgeschlagen." });
  }
  const defaultPassword = String(req.db.settings.defaultPassword || DEFAULT_PASSWORD);
  if (!defaultPassword) return res.status(400).json({ error: "Es ist kein gültiges Standardpasswort hinterlegt." });
  user.passwordHash = hashPassword(defaultPassword);
  user.mustChangePassword = true;
  user.tutorialCompleted = false;
  user.changelogReadIds = [];
  user.updatedAt = nowIso();
  logAction(req.db, req.user, "Passwort zurückgesetzt", actorName(user), { userId: user.id });
  writeDb(req.db);
  res.json({ user: publicUser(user) });
});

app.post("/api/it/users/:id/reset-discord", requireAuth, requireRole("Direktion"), (req, res) => {
  const user = req.db.users.find((item) => item.id === req.params.id && !item.terminated);
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  const publicResetUser = resetUserDiscord(req.db, user, req.user);
  writeDb(req.db);
  return res.json({ user: publicResetUser });
  const previousDiscordId = user.discordId || "";
  const previousDiscordName = user.discordName || "";
  user.discordId = "";
  user.discordName = "";
  user.updatedAt = nowIso();
  logAction(req.db, req.user, "Discord Sync zurückgesetzt", actorName(user), { userId: user.id, previousDiscordId, previousDiscordName });
  writeDb(req.db);
  if (previousDiscordId) unlinkDiscordAccount(req.db, user, previousDiscordId, req.user, "Discord Sync Reset");
  res.json({ user: publicUser(user) });
});

app.patch("/api/it/devmode", requireAuth, requireRole("IT"), (req, res) => {
  const before = Boolean(req.db.settings.devMode);
  req.db.settings.devMode = Boolean(req.body.devMode);
  logAction(req.db, req.user, req.db.settings.devMode ?"Devmode aktiviert" : "Devmode deaktiviert", "IT", { before, after: req.db.settings.devMode });
  writeDb(req.db);
  res.json({ settings: publicSettings(req.db.settings) });
});

app.patch("/api/it/maintenance", requireAuth, requireRole("IT"), (req, res) => {
  const before = Boolean(req.db.settings.maintenanceMode);
  req.db.settings.maintenanceMode = Boolean(req.body.maintenanceMode);
  logAction(req.db, req.user, req.db.settings.maintenanceMode ?"Wartungsarbeiten aktiviert" : "Wartungsarbeiten deaktiviert", "IT", { before, after: req.db.settings.maintenanceMode });
  writeDb(req.db);
  res.json({ settings: publicSettings(req.db.settings) });
});

app.get("/api/gibson-cola/status", requireAuth, (req, res) => {
  res.json({ party: req.db.settings.gibsonColaParty || {}, enabled: req.db.settings.gibsonColaButtonEnabled !== false });
});

app.post("/api/gibson-cola/party", requireAuth, (req, res) => {
  if (req.db.settings.gibsonColaButtonEnabled === false) return res.status(403).json({ error: "Der Cola Zero Button ist aktuell deaktiviert." });
  const party = {
    id: makeId("cola_party"),
    triggeredAt: nowIso(),
    triggeredById: req.user.id,
    triggeredByName: actorName(req.user)
  };
  req.db.settings.gibsonColaParty = party;
  logAction(req.db, req.user, "Cola Zero für Gibson ausgelöst", "Dienstblatt", party);
  writeDb(req.db);
  res.json({ party });
});

function parseCustomAnimationAsset(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpe?g|gif|webp)|video\/(?:mp4|webm));base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) return null;
  const base64 = match[2].replace(/\s+/g, "");
  const bytes = Buffer.byteLength(base64, "base64");
  if (bytes > CUSTOM_ANIMATION_MAX_BYTES) {
    const error = new Error("Die Datei ist zu groß. Maximal erlaubt sind 18 MB.");
    error.status = 413;
    throw error;
  }
  return { mimeType: match[1].toLowerCase(), bytes };
}

function parseCustomAnimationUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  let parsed = null;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!["https:", "http:"].includes(parsed.protocol)) return null;
  let clean = parsed.toString();
  if (/giphy\.com$/i.test(parsed.hostname) && parsed.pathname.startsWith("/gifs/")) {
    const slug = parsed.pathname.split("/").filter(Boolean).pop() || "";
    const id = slug.split("-").pop();
    if (/^[a-z0-9]+$/i.test(id)) clean = `https://media.giphy.com/media/${id}/giphy.gif`;
    parsed = new URL(clean);
  }
  const pathname = parsed.pathname.toLowerCase();
  const ext = pathname.split(".").pop();
  const mimeType = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    mp4: "video/mp4",
    webm: "video/webm"
  }[ext] || "";
  if (!mimeType && !/commons\.wikimedia\.org$/i.test(parsed.hostname)) return null;
  return { url: clean, mimeType };
}

app.get("/api/custom-animation/status", requireAuth, (req, res) => {
  const animation = normalizeCustomAnimation(req.db.settings.customAnimation);
  if (animation.event?.id && String(req.query.seen || "") === String(animation.event.id)) {
    return res.json({ event: {}, config: publicCustomAnimation(animation) });
  }
  if (animation.event?.triggeredAt && Date.now() - new Date(animation.event.triggeredAt).getTime() > 45000) {
    return res.json({ event: {}, config: publicCustomAnimation(animation) });
  }
  const event = animation.event?.id && (animation.assetDataUrl || animation.assetUrl) ?{
    ...animation.event,
    title: animation.event.title || animation.title,
    durationMs: animation.event.durationMs || animation.durationMs,
    assetDataUrl: animation.assetDataUrl,
    assetUrl: animation.assetUrl,
    mimeType: animation.mimeType,
    fileName: animation.fileName
  } : {};
  res.json({ event, config: publicCustomAnimation(animation) });
});

app.patch("/api/it/custom-animation", requireAuth, requireRole("IT"), (req, res) => {
  const before = publicCustomAnimation(req.db.settings.customAnimation);
  const current = normalizeCustomAnimation(req.db.settings.customAnimation);
  const title = String(req.body.title || "Dienstblatt Animation").trim().slice(0, 80) || "Dienstblatt Animation";
  const durationMs = Math.min(10000, Math.max(1000, Number(req.body.durationMs || current.durationMs || 6000)));
  let assetDataUrl = current.assetDataUrl;
  let assetUrl = current.assetUrl;
  let mimeType = current.mimeType;
  let fileName = current.fileName;
  if (req.body.clearAsset) {
    assetDataUrl = "";
    assetUrl = "";
    mimeType = "";
    fileName = "";
  }
  if (req.body.assetDataUrl) {
    let parsed = null;
    try {
      parsed = parseCustomAnimationAsset(req.body.assetDataUrl);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message || "Animation konnte nicht gespeichert werden." });
    }
    if (!parsed) return res.status(400).json({ error: "Bitte eine PNG, JPG, GIF, WebP, MP4 oder WebM Datei hochladen." });
    assetDataUrl = String(req.body.assetDataUrl || "");
    assetUrl = "";
    mimeType = parsed.mimeType;
    fileName = String(req.body.fileName || "animation").trim().slice(0, 120);
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "assetUrl") && String(req.body.assetUrl || "").trim() && !req.body.assetDataUrl && !req.body.clearAsset) {
    const parsedUrl = parseCustomAnimationUrl(req.body.assetUrl);
    if (!parsedUrl) return res.status(400).json({ error: "Bitte eine direkte URL zu PNG, JPG, GIF, WebP, MP4 oder WebM eintragen." });
    assetDataUrl = "";
    assetUrl = parsedUrl.url;
    mimeType = parsedUrl.mimeType || (/\.(mp4|webm)(?:$|[?#])/i.test(parsedUrl.url) ?"video/mp4" : "image/gif");
    fileName = String(req.body.fileName || path.basename(new URL(parsedUrl.url).pathname) || "Internet Animation").trim().slice(0, 120);
  }
  req.db.settings.customAnimation = normalizeCustomAnimation({ ...current, title, durationMs, assetDataUrl, assetUrl, mimeType, fileName });
  logAction(req.db, req.user, "Dienstblatt Animation geändert", "IT", { before, after: publicCustomAnimation(req.db.settings.customAnimation) });
  writeDb(req.db);
  res.json({ settings: publicSettings(req.db.settings) });
});

app.post("/api/it/custom-animation/items", requireAuth, requireRole("IT"), (req, res) => {
  const before = publicCustomAnimation(req.db.settings.customAnimation);
  const current = normalizeCustomAnimation(req.db.settings.customAnimation);
  const title = String(req.body.title || current.title || "Animation").trim().slice(0, 80) || "Animation";
  const durationMs = Math.min(10000, Math.max(1000, Number(req.body.durationMs || current.durationMs || 6000)));
  let assetDataUrl = "";
  let assetUrl = "";
  let mimeType = "";
  let fileName = String(req.body.fileName || title).trim().slice(0, 120);
  if (req.body.assetDataUrl) {
    let parsed = null;
    try {
      parsed = parseCustomAnimationAsset(req.body.assetDataUrl);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message || "Animation konnte nicht gespeichert werden." });
    }
    if (!parsed) return res.status(400).json({ error: "Bitte eine PNG, JPG, GIF, WebP, MP4 oder WebM Datei hochladen." });
    assetDataUrl = String(req.body.assetDataUrl || "");
    mimeType = parsed.mimeType;
  } else if (req.body.assetUrl) {
    const parsedUrl = parseCustomAnimationUrl(req.body.assetUrl);
    if (!parsedUrl) return res.status(400).json({ error: "Bitte eine direkte URL zu PNG, JPG, GIF, WebP, MP4 oder WebM eintragen." });
    assetUrl = parsedUrl.url;
    mimeType = parsedUrl.mimeType || (/\.(mp4|webm)(?:$|[?#])/i.test(parsedUrl.url) ?"video/mp4" : "image/gif");
    fileName = String(req.body.fileName || path.basename(new URL(parsedUrl.url).pathname) || title).trim().slice(0, 120);
  } else if (current.assetDataUrl || current.assetUrl) {
    assetDataUrl = current.assetDataUrl;
    assetUrl = current.assetUrl;
    mimeType = current.mimeType;
    fileName = current.fileName || title;
  } else {
    return res.status(400).json({ error: "Bitte zuerst eine Datei oder URL auswählen." });
  }
  const item = { id: makeId("anim"), title, durationMs, assetDataUrl, assetUrl, mimeType, fileName, createdAt: nowIso() };
  req.db.settings.customAnimation = normalizeCustomAnimation({ ...current, items: [item, ...current.items] });
  logAction(req.db, req.user, "Dienstblatt Animation gespeichert", "IT", { before, after: publicCustomAnimation(req.db.settings.customAnimation), item: { ...item, assetDataUrl: item.assetDataUrl ?"[upload]" : "" } });
  writeDb(req.db);
  res.status(201).json({ settings: publicSettings(req.db.settings), item: publicCustomAnimation(req.db.settings.customAnimation).items.find((entry) => entry.id === item.id) });
});

app.delete("/api/it/custom-animation/items/:id", requireAuth, requireRole("IT"), (req, res) => {
  const current = normalizeCustomAnimation(req.db.settings.customAnimation);
  const beforeCount = current.items.length;
  req.db.settings.customAnimation = normalizeCustomAnimation({ ...current, items: current.items.filter((item) => item.id !== req.params.id) });
  if (beforeCount === req.db.settings.customAnimation.items.length) return res.status(404).json({ error: "Animation nicht gefunden." });
  logAction(req.db, req.user, "Dienstblatt Animation gelöscht", "IT", { id: req.params.id });
  writeDb(req.db);
  res.json({ settings: publicSettings(req.db.settings) });
});

app.post("/api/it/custom-animation/trigger", requireAuth, requireRole("IT"), (req, res) => {
  const animation = normalizeCustomAnimation(req.db.settings.customAnimation);
  const selectedItem = req.body.itemId ?animation.items.find((item) => item.id === req.body.itemId) : null;
  let source = selectedItem || animation;
  if (!selectedItem && req.body.assetUrl) {
    const parsedUrl = parseCustomAnimationUrl(req.body.assetUrl);
    if (!parsedUrl) return res.status(400).json({ error: "Bitte eine direkte URL zu PNG, JPG, GIF, WebP, MP4 oder WebM eintragen." });
    source = {
      title: String(req.body.title || "Animation").trim().slice(0, 80) || "Animation",
      durationMs: Math.min(10000, Math.max(1000, Number(req.body.durationMs || 6000))),
      assetDataUrl: "",
      assetUrl: parsedUrl.url,
      mimeType: parsedUrl.mimeType || (/\.(mp4|webm)(?:$|[?#])/i.test(parsedUrl.url) ?"video/mp4" : "image/gif"),
      fileName: path.basename(new URL(parsedUrl.url).pathname) || "Internet Animation"
    };
  }
  if (!source.assetDataUrl && !source.assetUrl) return res.status(400).json({ error: "Bitte zuerst eine Animation speichern." });
  const event = {
    id: makeId("custom_animation"),
    triggeredAt: nowIso(),
    startAt: new Date(Date.now() + 2500).toISOString(),
    triggeredById: req.user.id,
    triggeredByName: actorName(req.user),
    title: source.title || animation.title,
    durationMs: source.durationMs || animation.durationMs
  };
  req.db.settings.customAnimation = normalizeCustomAnimation({ ...animation, event });
  logAction(req.db, req.user, "Dienstblatt Animation ausgelöst", "IT", event);
  writeDb(req.db);
  res.json({
    event: {
      ...event,
      assetDataUrl: source.assetDataUrl,
      assetUrl: source.assetUrl,
      mimeType: source.mimeType,
      fileName: source.fileName
    }
  });
});

app.post("/api/information/changes/read-all", requireAuth, (req, res) => {
  const requestedIds = Array.isArray(req.body.ids) ?new Set(req.body.ids.map((id) => String(id || "")).filter(Boolean)) : new Set();
  let changed = false;
  req.db.settings.informationDocChanges = (req.db.settings.informationDocChanges || []).map((change) => {
    if (requestedIds.size && !requestedIds.has(String(change.id || ""))) return change;
    if (!isAfterNotificationBaseline(change.createdAt, req.user)) return change;
    if ((change.acknowledgedBy || []).includes(req.user.id)) return change;
    changed = true;
    return { ...change, acknowledgedBy: Array.from(new Set([...(change.acknowledgedBy || []), req.user.id])) };
  });
  if (changed) writeDb(req.db);
  res.json({ settings: publicSettings(req.db.settings) });
});

app.post("/api/information/changes/:changeId/read", requireAuth, (req, res) => {
  const changeId = String(req.params.changeId || "");
  let found = false;
  req.db.settings.informationDocChanges = (req.db.settings.informationDocChanges || []).map((change) => {
    if (change.id !== changeId) return change;
    found = true;
    return { ...change, acknowledgedBy: Array.from(new Set([...(change.acknowledgedBy || []), req.user.id])) };
  });
  if (!found) return res.status(404).json({ error: "Benachrichtigung nicht gefunden." });
  writeDb(req.db);
  res.json({ settings: publicSettings(req.db.settings) });
});

app.delete("/api/information/changes/:changeId", requireAuth, (req, res) => {
  const changeId = String(req.params.changeId || "");
  let found = false;
  req.db.settings.informationDocChanges = (req.db.settings.informationDocChanges || []).map((change) => {
    if (change.id !== changeId) return change;
    found = true;
    return {
      ...change,
      acknowledgedBy: Array.from(new Set([...(change.acknowledgedBy || []), req.user.id])),
      deletedBy: Array.from(new Set([...(change.deletedBy || []), req.user.id]))
    };
  });
  if (!found) return res.status(404).json({ error: "Benachrichtigung nicht gefunden." });
  writeDb(req.db);
  res.json({ settings: publicSettings(req.db.settings) });
});

app.patch("/api/it/defcon-card", requireAuth, requireRole("IT"), (req, res) => {
  const before = Boolean(req.db.settings.hideDefconCard);
  req.db.settings.hideDefconCard = Boolean(req.body.hideDefconCard);
  logAction(req.db, req.user, req.db.settings.hideDefconCard ?"DEFCON Kachel ausgeblendet" : "DEFCON Kachel eingeblendet", "IT", { before, after: req.db.settings.hideDefconCard });
  writeDb(req.db);
  res.json({ settings: publicSettings(req.db.settings) });
});

app.patch("/api/it/information-links-card", requireAuth, requireRole("IT"), (req, res) => {
  const before = Boolean(req.db.settings.hideInformationLinksCard);
  req.db.settings.hideInformationLinksCard = Boolean(req.body.hideInformationLinksCard);
  logAction(req.db, req.user, req.db.settings.hideInformationLinksCard ?"Link Weiterleitungen ausgeblendet" : "Link Weiterleitungen eingeblendet", "IT", { before, after: req.db.settings.hideInformationLinksCard });
  writeDb(req.db);
  res.json({ settings: publicSettings(req.db.settings) });
});

app.patch("/api/it/restarts", requireAuth, requireRole("IT"), (req, res) => {
  const before = req.db.settings.restartTimes || [];
  const restartTimes = Array.isArray(req.body.restartTimes) ?req.body.restartTimes : [];
  req.db.settings.restartTimes = [...new Set(restartTimes
    .map((time) => String(time || "").trim())
    .filter((time) => /^\d{2}:\d{2}$/.test(time)))]
    .sort();
  logAction(req.db, req.user, "Restartzeiten geändert", "IT", { before, after: req.db.settings.restartTimes });
  writeDb(req.db);
  res.json({ settings: publicSettings(req.db.settings) });
});

app.post("/api/it/client-refresh", requireAuth, requireRole("IT"), (req, res) => {
  clientRefreshRevision = nowIso();
  logAction(req.db, req.user, "Client-Refresh ausgelöst", "IT", { revision: clientRefreshRevision });
  writeDb(req.db);
  res.json({ ok: true, liveRevision: liveRevision(), clientRefreshRevision });
});

app.get("/api/it/export", requireAuth, requireItLead, (req, res) => {
  const exportDb = backupSnapshot(req.db);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", "attachment; filename=\"lspd-dienstblatt-export.json\"");
  res.send(JSON.stringify(exportDb, null, 2));
});

app.post("/api/it/backups", requireAuth, requireItLead, (req, res) => {
  const backup = createStoredBackup(req.db, req.user, "Manuell");
  logAction(req.db, req.user, "Backup erstellt", backup.id, { type: backup.type, changesSinceLast: backup.changesSinceLast, sizeBytes: backup.sizeBytes });
  writeDb(req.db);
  res.status(201).json({ backup: publicBackup(backup), settings: publicSettings(req.db.settings) });
});

app.get("/api/it/backups/:id/download", requireAuth, requireItLead, (req, res) => {
  const backup = normalizeBackups(req.db.settings.backups).find((item) => item.id === req.params.id);
  if (!backup) return res.status(404).json({ error: "Backup nicht gefunden." });
  const payload = readBackupPayload(backup);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${backupFilename(backup)}"`);
  res.send(JSON.stringify(payload, null, 2));
});

app.post("/api/it/backups/:id/restore", requireAuth, requireItLead, (req, res) => {
  const backup = normalizeBackups(req.db.settings.backups).find((item) => item.id === req.params.id);
  if (!backup) return res.status(404).json({ error: "Backup nicht gefunden." });
  const result = buildImportedDb(readBackupPayload(backup));
  if (result.error) return res.status(400).json({ error: result.error });
  const nextDb = result.db;
  nextDb.settings = nextDb.settings || {};
  nextDb.settings.backups = normalizeBackups(req.db.settings.backups);
  logAction(nextDb, req.user, "Backup wiederhergestellt", backup.id, { backupCreatedAt: backup.createdAt, changesSinceLast: backup.changesSinceLast });
  writeDb(nextDb);
  res.json({ ok: true, users: nextDb.users.length });
});

app.post("/api/it/import", requireAuth, requireItLead, (req, res) => {
  const imported = req.body?.db || req.body;
  const result = buildImportedDb(imported);
  if (result.error) return res.status(400).json({ error: result.error });
  const nextDb = result.db;
  nextDb.settings.backups = normalizeBackups(req.db.settings.backups);
  writeDb(nextDb);
  res.json({ ok: true, users: nextDb.users.length });
});

app.post("/api/it/clear-sessions", requireAuth, requireRole("IT"), (req, res) => {
  req.db.sessions = req.db.sessions.filter((session) => session.userId === req.user.id);
  for (const [token, entry] of activeWebClients.entries()) {
    if (entry.userId !== req.user.id) activeWebClients.delete(token);
  }
  writeDb(req.db);
  res.json({ ok: true });
});

app.post("/api/it/clear-seizures", requireAuth, requireItLead, (req, res) => {
  const removed = Array.isArray(req.db.settings.seizures) ?req.db.settings.seizures.length : 0;
  req.db.settings.seizures = [];
  logAction(req.db, req.user, "Beschlagnahmungen geleert", "IT-Leitung", { removed });
  writeDb(req.db);
  res.json({ ok: true, removed, settings: publicSettings(req.db.settings) });
});

app.post("/api/it/clear-member-accounts", requireAuth, requireItLead, (req, res) => {
  const removedUserIds = (req.db.users || []).filter((user) => user.id !== req.user.id).map((user) => user.id);
  req.db.users = (req.db.users || []).filter((user) => user.id === req.user.id);
  removeUserReferences(req.db, removedUserIds);
  logAction(req.db, req.user, "Mitglieder-Accounts geleert", "IT-Leitung", { removed: removedUserIds.length });
  writeDb(req.db);
  res.json({ ok: true, removed: removedUserIds.length });
});

app.post("/api/it/clear-logs", requireAuth, requireItLead, (req, res) => {
  const removed = {
    logs: Array.isArray(req.db.logs) ?req.db.logs.length : 0,
    dutyHistory: Array.isArray(req.db.dutyHistory) ?req.db.dutyHistory.length : 0,
    fluctuation: Array.isArray(req.db.settings?.fluctuation) ?req.db.settings.fluctuation.length : 0
  };
  req.db.logs = [];
  req.db.dutyHistory = [];
  req.db.settings.fluctuation = [];
  writeDb(req.db);
  res.json({ ok: true, removed, logs: [], dutyHistory: [], fluctuation: [] });
});

app.post("/api/activity/ping", requireAuth, (req, res) => {
  updateActiveWebClient(req, req.body.page);
  res.json({ ok: true });
});

app.get("/api/it/activity", requireAuth, requireRole("IT"), (req, res) => {
  updateActiveWebClient(req, req.query.page || "IT");
  res.json({ active: activeWebClientRows(req.db) });
});

app.post("/api/it/activity/:userId/jumpscare", requireAuth, requireRole("IT"), (req, res) => {
  const target = req.db.users.find((user) => user.id === req.params.userId && !user.terminated);
  if (!target) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  cleanupJumpscareEvents();
  const event = {
    id: makeId("jumpscare"),
    targetUserId: target.id,
    triggeredById: req.user.id,
    triggeredByName: actorName(req.user),
    createdAt: nowIso(),
    createdMs: Date.now()
  };
  jumpscareEvents.set(target.id, event);
  logAction(req.db, req.user, "Jumpscare ausgelöst", actorName(target), { targetUserId: target.id });
  writeDb(req.db);
  res.json({ event });
});

app.get("/api/jumpscare/status", requireAuth, (req, res) => {
  updateActiveWebClient(req, req.query.page);
  cleanupJumpscareEvents();
  res.json({ event: jumpscareEvents.get(req.user.id) || null });
});

app.post("/api/changelog", requireAuth, requireRole("IT"), (req, res) => {
  const body = String(req.body.body || "").trim();
  const type = ["Verbesserung / Anpassung", "Bug Fixes"].includes(req.body.type) ?req.body.type : "Verbesserung / Anpassung";
  if (!body) return res.status(400).json({ error: "Bitte einen Changelog-Text eintragen." });
  const createdAt = nowIso();
  const entry = {
    id: makeId("changelog"),
    version: nextChangelogVersion(req.db.settings.changelog || []),
    type,
    title: changelogTitle(new Date(createdAt)),
    body,
    authorId: req.user.id,
    authorName: actorName(req.user),
    authorRole: req.user.role,
    createdAt
  };
  req.db.settings.changelog = normalizeChangelog([entry, ...(req.db.settings.changelog || [])]);
  logAction(req.db, req.user, "Changelog erstellt", entry.version, { after: entry });
  writeDb(req.db);
  res.status(201).json({ entry, settings: publicSettings(req.db.settings) });
});

app.patch("/api/changelog/:id", requireAuth, requireRole("IT"), (req, res) => {
  const entry = (req.db.settings.changelog || []).find((item) => item.id === req.params.id);
  if (!entry) return res.status(404).json({ error: "Changelog nicht gefunden." });
  const body = String(req.body.body || "").trim();
  const type = ["Verbesserung / Anpassung", "Bug Fixes"].includes(req.body.type) ?req.body.type : "Verbesserung / Anpassung";
  if (!body) return res.status(400).json({ error: "Bitte einen Changelog-Text eintragen." });
  const before = { ...entry };
  entry.type = type;
  entry.body = body;
  entry.updatedAt = nowIso();
  entry.updatedBy = actorName(req.user);
  req.db.settings.changelog = normalizeChangelog(req.db.settings.changelog);
  logAction(req.db, req.user, "Changelog bearbeitet", entry.version, { before, after: entry });
  writeDb(req.db);
  res.json({ entry, settings: publicSettings(req.db.settings) });
});

app.delete("/api/changelog/:id", requireAuth, requireRole("IT"), (req, res) => {
  const before = req.db.settings.changelog || [];
  const entry = before.find((item) => item.id === req.params.id);
  if (!entry) return res.status(404).json({ error: "Changelog nicht gefunden." });
  req.db.settings.changelog = normalizeChangelog(before.filter((item) => item.id !== req.params.id));
  logAction(req.db, req.user, "Changelog gelöscht", entry.version, { before: entry });
  writeDb(req.db);
  res.json({ ok: true, settings: publicSettings(req.db.settings) });
});

app.patch("/api/departments/:departmentId/positions", requireAuth, requireRole("IT"), (req, res) => {
  const department = getDepartment(req.db, req.params.departmentId);
  if (!department) return res.status(404).json({ error: "Abteilung nicht gefunden." });
  const incoming = Array.isArray(req.body.positions) ?req.body.positions : [];
  const normalized = incoming
    .map((item) => ({
      old: String(item.old || "").trim(),
      label: String(item.label || "").trim(),
      leader: Boolean(item.leader),
      color: String(item.color || "").trim()
    }))
    .filter((item) => item.label);
  const nextPositions = [...new Set(normalized.map((item) => item.label))];
  if (!nextPositions.length) return res.status(400).json({ error: "Mindestens eine Position ist erforderlich." });
  if (!nextPositions.includes("Direktion")) return res.status(400).json({ error: "Die Position Direktion muss erhalten bleiben." });
  const removedPositions = departmentPositionsFor(department).filter((position) => !normalized.some((item) => item.old === position || item.label === position));
  const positionInUse = removedPositions.find((position) => department.members.some((member) => member.position === position));
  if (positionInUse) return res.status(400).json({ error: `Die Position ${positionInUse} ist noch vergeben und kann nicht entfernt werden.` });

  const before = { positions: [...departmentPositionsFor(department)], leaderPositions: [...departmentLeaderPositionsFor(department)], positionColors: { ...(department.positionColors || {}) } };
  normalized.forEach((item) => {
    if (item.old && item.old !== item.label) {
      department.members.forEach((member) => {
        if (member.position === item.old) member.position = item.label;
      });
    }
  });
  department.positions = nextPositions;
  department.leaderPositions = [...new Set(normalized.filter((item) => item.leader || item.label === "Direktion").map((item) => item.label))].filter((position) => nextPositions.includes(position));
  department.positionColors = normalizeDepartmentPositionColors(Object.fromEntries(normalized.map((item) => [item.label, item.color || defaultPositionColor(item.label)])), nextPositions);
  logAction(req.db, req.user, "Abteilungsränge geändert", department.name, { before, after: { positions: department.positions, leaderPositions: department.leaderPositions, positionColors: department.positionColors } });
  writeDb(req.db);
  syncDiscordRolesForDepartmentMembers(req.db, department, "Abteilungspositionen geaendert");
  res.json({ department: publicDepartment(department, req.db, req.user) });
});

app.patch("/api/departments/:departmentId/info", requireAuth, (req, res) => {
  const department = getDepartment(req.db, req.params.departmentId);
  if (!canManageDepartmentAction(req.user, department, req.db, "departmentInfo")) return res.status(403).json({ error: "Keine Berechtigung." });
  const before = { description: department.description, applicationStatus: department.applicationStatus, requirements: department.requirements, rightsText: department.rightsText, trainingDocsUrl: department.trainingDocsUrl, links: department.links, permits: department.permits, factions: department.factions, docs: department.docs };
  department.description = String(req.body.description || "").trim();
  department.applicationStatus = ["Offen", "Geschlossen"].includes(req.body.applicationStatus) ?req.body.applicationStatus : "Offen";
  department.requirements = String(req.body.requirements || "").trim();
  department.rightsText = String(req.body.rightsText || "").trim();
  department.trainingDocsUrl = String(req.body.trainingDocsUrl || "").trim();
  department.links = Array.isArray(req.body.links) ?req.body.links.map((item) => ({ id: String(item.id || makeId("link")), title: String(item.title || "").trim(), url: String(item.url || "").trim() })).filter((item) => item.title && item.url) : [];
  department.permits = Array.isArray(req.body.permits) ?req.body.permits.map((item) => ({ id: String(item.id || makeId("permit")), name: String(item.name || "").trim(), description: String(item.description || "").trim(), validUntil: String(item.validUntil || "").trim() })).filter((item) => item.name && item.description && item.validUntil) : [];
  department.factions = Array.isArray(req.body.factions) ?req.body.factions.map((item) => ({ id: String(item.id || makeId("faction")), organization: String(item.organization || "").trim(), status: ["Normal", "Mittel", "Hoch"].includes(item.status) ?item.status : "Normal" })).filter((item) => item.organization) : [];
  department.docs = Array.isArray(req.body.docs) ?req.body.docs.map((item) => ({
    id: String(item.id || makeId("doc")),
    title: String(item.title || "").trim(),
    body: String(item.body || "").trim(),
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    authorId: String(item.authorId || req.user.id),
    authorName: String(item.authorName || fullName(req.user))
  })).filter((item) => item.title) : [];
  logAction(req.db, req.user, "Abteilungsinfos geändert", department.name, { before, after: { description: department.description, applicationStatus: department.applicationStatus, requirements: department.requirements, rightsText: department.rightsText, trainingDocsUrl: department.trainingDocsUrl, links: department.links, permits: department.permits, factions: department.factions, docs: department.docs } });
  writeDb(req.db);
  res.json({ department: publicDepartment(department, req.db, req.user) });
});

app.post("/api/departments/:departmentId/members", requireAuth, (req, res) => {
  const department = getDepartment(req.db, req.params.departmentId);
  if (!canManageDepartmentAction(req.user, department, req.db, "departmentMembers")) return res.status(403).json({ error: "Keine Berechtigung." });
  const userId = String(req.body.userId || "");
  const fallbackPosition = departmentPositionsFor(department).includes("Anwärter") ?"Anwärter" : "Mitglied";
  const swatRequestedPosition = isSwatDepartment(department) && ["Abteilungsleiter", "Mitglied"].includes(req.body.position) ?req.body.position : "";
  const requestedPosition = swatRequestedPosition || (departmentPositionsFor(department).includes(req.body.position) ?req.body.position : fallbackPosition);
  const position = department.id !== "direktion" && requestedPosition === "Direktion" ?fallbackPosition : requestedPosition;
  if (!canAssignDepartmentPosition(req.user, department, position, req.db)) return res.status(403).json({ error: "Diese Position darfst du nicht vergeben." });
  const addedUser = req.db.users.find((user) => user.id === userId);
  if (!addedUser) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  if (department.members.some((member) => member.userId === userId)) return res.status(400).json({ error: "Person ist bereits in der Abteilung." });
  if (department.id === "direktion" && addedUser.role === "Direktion") addedUser.direktionManualRemoved = false;
  const memberEntry = { userId, position, joinedAt: todayIso(), positionSince: todayIso() };
  if (isSwatDepartment(department)) {
    memberEntry.swatTeam = normalizeSwatTeam(req.body.swatTeam);
    memberEntry.swatTeamLeader = position === "Abteilungsleiter" || Boolean(req.body.swatTeamLeader);
    const actorMembership = department.members.find((member) => member.userId === req.user.id);
    if ((rolePower[req.user.role] || 0) < rolePower.Direktion) {
      if (!isSwatTeamLeaderMember(actorMembership) || normalizeSwatTeam(actorMembership.swatTeam) !== memberEntry.swatTeam) return res.status(403).json({ error: "Du darfst nur dein eigenes SWAT Team verwalten." });
      memberEntry.position = "Mitglied";
      memberEntry.swatTeamLeader = false;
    }
  }
  department.members.push(memberEntry);
  logAction(req.db, req.user, "Abteilungsmitglied hinzugefügt", department.name, { userId, position });
  writeDb(req.db);
  syncDiscordRolesForUser(req.db, addedUser, "Abteilungsmitglied hinzugefuegt");
  res.status(201).json({ department: publicDepartment(department, req.db, req.user) });
});

app.patch("/api/departments/:departmentId/members/:userId", requireAuth, (req, res) => {
  const department = getDepartment(req.db, req.params.departmentId);
  if (!canManageDepartmentAction(req.user, department, req.db, "departmentMembers")) return res.status(403).json({ error: "Keine Berechtigung." });
  const member = department.members.find((item) => item.userId === req.params.userId);
  if (!member) return res.status(404).json({ error: "Mitglied nicht gefunden." });
  if (!canTouchDepartmentMemberPosition(req.user, department, member.position)) return res.status(403).json({ error: "Diese Position darfst du nicht bearbeiten." });
  const before = { ...member };
  const swatRequestedPosition = isSwatDepartment(department) && ["Abteilungsleiter", "Mitglied"].includes(req.body.position) ?req.body.position : "";
  const nextPosition = swatRequestedPosition || (departmentPositionsFor(department).includes(req.body.position) ?req.body.position : member.position);
  if (!canAssignDepartmentPosition(req.user, department, nextPosition, req.db)) return res.status(403).json({ error: "Diese Position darfst du nicht vergeben." });
  if (member.position !== nextPosition) member.positionSince = todayIso();
  member.position = nextPosition;
  if (isSwatDepartment(department)) {
    const nextTeam = normalizeSwatTeam(req.body.swatTeam);
    const actorMembership = department.members.find((item) => item.userId === req.user.id);
    if ((rolePower[req.user.role] || 0) < rolePower.Direktion) {
      if (!isSwatTeamLeaderMember(actorMembership) || normalizeSwatTeam(actorMembership.swatTeam) !== normalizeSwatTeam(member.swatTeam) || nextTeam !== normalizeSwatTeam(actorMembership.swatTeam)) return res.status(403).json({ error: "Du darfst nur dein eigenes SWAT Team verwalten." });
      member.position = "Mitglied";
      member.swatTeamLeader = false;
    } else {
      member.swatTeamLeader = nextPosition === "Abteilungsleiter" || Boolean(req.body.swatTeamLeader);
    }
    member.swatTeam = nextTeam;
  }
  logAction(req.db, req.user, "Abteilungsmitglied bearbeitet", department.name, { before, after: member });
  writeDb(req.db);
  syncDiscordRolesForUser(req.db, req.db.users.find((user) => user.id === req.params.userId), "Abteilungsmitglied bearbeitet");
  res.json({ department: publicDepartment(department, req.db, req.user) });
});

app.delete("/api/departments/:departmentId/members/:userId", requireAuth, (req, res) => {
  const department = getDepartment(req.db, req.params.departmentId);
  if (!canManageDepartmentAction(req.user, department, req.db, "departmentMembers")) return res.status(403).json({ error: "Keine Berechtigung." });
  const member = department.members.find((item) => item.userId === req.params.userId);
  if (!member) return res.status(404).json({ error: "Mitglied nicht gefunden." });
  if (!canTouchDepartmentMemberPosition(req.user, department, member.position)) return res.status(403).json({ error: "Diese Position darfst du nicht entfernen." });
  const removedUser = req.db.users.find((user) => user.id === req.params.userId);
  if (department?.id === "direktion" && removedUser?.role === "Direktion") removedUser.direktionManualRemoved = true;
  department.members = department.members.filter((member) => member.userId !== req.params.userId);
  logAction(req.db, req.user, "Abteilungsmitglied entfernt", department.name, { userId: req.params.userId });
  writeDb(req.db);
  syncDiscordRolesForUser(req.db, removedUser, "Abteilungsmitglied entfernt");
  res.json({ department: publicDepartment(department, req.db, req.user) });
});

app.post("/api/departments/:departmentId/notes", requireAuth, (req, res) => {
  const department = getDepartment(req.db, req.params.departmentId);
  if (!canManageDepartmentAction(req.user, department, req.db, "departmentNotes")) return res.status(403).json({ error: "Keine Berechtigung." });
  const title = String(req.body.title || "").trim();
  const priority = String(req.body.priority || "").trim();
  const text = String(req.body.text || "").trim();
  const align = ["left", "center", "right"].includes(req.body.align) ?req.body.align : "left";
  const textColor = ["", "#ffffff", "#bfdbfe", "#fecaca", "#fde68a", "#bbf7d0"].includes(req.body.textColor) ?req.body.textColor : "";
  const highlightColor = ["", "rgba(37,99,235,.22)", "rgba(239,68,68,.22)", "rgba(245,158,11,.22)", "rgba(34,197,94,.18)"].includes(req.body.highlightColor) ?req.body.highlightColor : "";
  const team = isSwatDepartment(department) ?normalizeSwatTeam(req.body.team, "all") : "all";
  if (!title || !text || !["Leitung", "Info", "Mitglied"].includes(priority)) {
    return res.status(400).json({ error: "Titel, Priorität und Text sind erforderlich." });
  }
  if (isSwatDepartment(department) && team !== "all" && !canViewSwatTeamContent(req.user, department, team, req.db)) return res.status(403).json({ error: "Keine Berechtigung fuer dieses SWAT Team." });
  const note = {
    id: makeId("dept_note"),
    title,
    priority,
    team,
    text,
    align,
    textColor,
    highlightColor,
    authorId: req.user.id,
    authorName: `${req.user.firstName} ${req.user.lastName}`.trim(),
    createdAt: nowIso()
  };
  department.notes.push(note);
  logAction(req.db, req.user, "Abteilungsnotiz erstellt", department.name, { after: note });
  writeDb(req.db);
  res.status(201).json({ department: publicDepartment(department, req.db, req.user) });
});

app.patch("/api/departments/:departmentId/notes/:noteId", requireAuth, (req, res) => {
  const department = getDepartment(req.db, req.params.departmentId);
  if (!canManageDepartmentAction(req.user, department, req.db, "departmentNotes")) return res.status(403).json({ error: "Keine Berechtigung." });
  const note = department.notes.find((item) => item.id === req.params.noteId);
  if (!note) return res.status(404).json({ error: "Notiz nicht gefunden." });
  if (isSwatDepartment(department) && !canViewSwatTeamContent(req.user, department, note.team || "all", req.db)) return res.status(403).json({ error: "Keine Berechtigung fuer diese SWAT Notiz." });
  const before = { ...note };
  note.title = String(req.body.title || "").trim();
  note.priority = ["Leitung", "Info", "Mitglied"].includes(req.body.priority) ?req.body.priority : note.priority;
  note.align = ["left", "center", "right"].includes(req.body.align) ?req.body.align : note.align || "left";
  note.textColor = ["", "#ffffff", "#bfdbfe", "#fecaca", "#fde68a", "#bbf7d0"].includes(req.body.textColor) ?req.body.textColor : note.textColor || "";
  note.highlightColor = ["", "rgba(37,99,235,.22)", "rgba(239,68,68,.22)", "rgba(245,158,11,.22)", "rgba(34,197,94,.18)"].includes(req.body.highlightColor) ?req.body.highlightColor : note.highlightColor || "";
  if (isSwatDepartment(department)) {
    const nextTeam = normalizeSwatTeam(req.body.team, "all");
    if (nextTeam !== "all" && !canViewSwatTeamContent(req.user, department, nextTeam, req.db)) return res.status(403).json({ error: "Keine Berechtigung fuer dieses SWAT Team." });
    note.team = nextTeam;
  }
  note.text = String(req.body.text || "").trim();
  note.updatedAt = nowIso();
  logAction(req.db, req.user, "Abteilungsnotiz geändert", department.name, { before, after: note });
  writeDb(req.db);
  res.json({ department: publicDepartment(department, req.db, req.user) });
});

app.delete("/api/departments/:departmentId/notes/:noteId", requireAuth, (req, res) => {
  const department = getDepartment(req.db, req.params.departmentId);
  if (!canManageDepartmentAction(req.user, department, req.db, "departmentNotes")) return res.status(403).json({ error: "Keine Berechtigung." });
  const note = department.notes.find((item) => item.id === req.params.noteId);
  if (isSwatDepartment(department) && note && !canViewSwatTeamContent(req.user, department, note.team || "all", req.db)) return res.status(403).json({ error: "Keine Berechtigung fuer diese SWAT Notiz." });
  department.notes = department.notes.filter((note) => note.id !== req.params.noteId);
  logAction(req.db, req.user, "Abteilungsnotiz gelöscht", department.name, { noteId: req.params.noteId });
  writeDb(req.db);
  res.json({ department: publicDepartment(department, req.db, req.user) });
});

app.get("/api/departments/swat/status", requireAuth, (req, res) => {
  const department = getDepartment(req.db, "swat");
  if (!department) return res.status(404).json({ error: "SWAT Abteilung nicht gefunden." });
  res.json({ department: publicDepartment(department, req.db, req.user) });
});

app.post("/api/departments/swat/call", requireAuth, (req, res) => {
  const department = getDepartment(req.db, "swat");
  if (!department) return res.status(404).json({ error: "SWAT Abteilung nicht gefunden." });
  if (!canManageDepartmentAction(req.user, department, req.db, "departmentLeadership")) return res.status(403).json({ error: "Nur SWAT Leitung und Direktion duerfen SWAT ausrufen." });
  const team = normalizeSwatTeam(req.body.team);
  if (!team) return res.status(400).json({ error: "Bitte Team A, B oder C auswaehlen." });
  const active = Object.prototype.hasOwnProperty.call(req.body, "active") ?Boolean(req.body.active) : true;
  department.swatStatus = normalizeSwatStatus(department.swatStatus);
  department.swatStatus[team] = {
    active,
    calledAt: nowIso(),
    calledById: req.user.id,
    calledByName: actorName(req.user)
  };
  logAction(req.db, req.user, active ?"SWAT ausgerufen" : "SWAT Ausruf beendet", `Team ${team}`, department.swatStatus[team]);
  writeDb(req.db);
  res.json({ department: publicDepartment(department, req.db, req.user) });
});

app.post("/api/departments/:departmentId/member-notes", requireAuth, (req, res) => {
  const department = getDepartment(req.db, req.params.departmentId);
  const isHrDepartment = department?.id === "human-resources";
  const isHrMember = isHrDepartment && department.members?.some((member) => member.userId === req.user.id);
  if (!canManageDepartmentAction(req.user, department, req.db, "departmentLeadership") && !isHrMember) return res.status(403).json({ error: "Keine Berechtigung." });
  const userId = String(req.body.userId || "");
  const text = String(req.body.text || "").trim();
  const knownUser = req.db.users.find((user) => user.id === userId && !user.terminated);
  if (!department.members.some((member) => member.userId === userId) && !(isHrDepartment && knownUser)) return res.status(404).json({ error: "Mitglied nicht gefunden." });
  if (!text) return res.status(400).json({ error: "Notiz ist erforderlich." });
  const noteType = ["Rookie", "Normal"].includes(req.body.type) ?String(req.body.type) : "Normal";
  if (noteType === "Rookie" && Number(knownUser?.rank || 0) !== 0) return res.status(400).json({ error: "Rookie Akten können nur bei Rang 0 geschrieben werden." });
  const rawMeta = req.body.meta && typeof req.body.meta === "object" ?req.body.meta : {};
  const meta = noteType === "Rookie" ?{
    reportDate: String(rawMeta.reportDate || "").trim(),
    supervisingOfficer: String(rawMeta.supervisingOfficer || "").trim(),
    processingOfficer: String(rawMeta.processingOfficer || "").trim(),
    rookieName: String(rawMeta.rookieName || "").trim(),
    shift: String(rawMeta.shift || "").trim()
  } : {
    reportDate: String(rawMeta.reportDate || "").trim(),
    processingOfficer: String(rawMeta.processingOfficer || "").trim(),
    subject: String(rawMeta.subject || "").trim(),
    category: String(rawMeta.category || "").trim()
  };
  const note = {
    id: makeId("dept-member-note"),
    userId,
    type: noteType,
    text,
    meta,
    authorId: req.user.id,
    authorName: `${req.user.firstName} ${req.user.lastName}`.trim(),
    createdAt: nowIso()
  };
  department.memberNotes = Array.isArray(department.memberNotes) ?department.memberNotes : [];
  department.memberNotes.push(note);
  logAction(req.db, req.user, "Interne Abteilungsnotiz erstellt", department.name, { after: note });
  writeDb(req.db);
  res.status(201).json({ department: publicDepartment(department, req.db, req.user) });
});

app.patch("/api/departments/:departmentId/member-notes/:noteId", requireAuth, (req, res) => {
  const department = getDepartment(req.db, req.params.departmentId);
  const isHrDepartment = department?.id === "human-resources";
  const isHrMember = isHrDepartment && department.members?.some((member) => member.userId === req.user.id);
  if (!canManageDepartmentAction(req.user, department, req.db, "departmentLeadership") && !isHrMember) return res.status(403).json({ error: "Keine Berechtigung." });
  department.memberNotes = Array.isArray(department.memberNotes) ?department.memberNotes : [];
  const note = department.memberNotes.find((item) => item.id === req.params.noteId);
  if (!note) return res.status(404).json({ error: "Notiz nicht gefunden." });
  const knownUser = req.db.users.find((user) => user.id === note.userId && !user.terminated);
  const noteType = note.type === "Rookie" ?"Rookie" : "Normal";
  if (noteType === "Rookie" && Number(knownUser?.rank || 0) !== 0) return res.status(400).json({ error: "Rookie Akten können nach Rang 0 nur noch angesehen werden." });
  const text = String(req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "Notiz ist erforderlich." });
  const rawMeta = req.body.meta && typeof req.body.meta === "object" ?req.body.meta : {};
  const before = { ...note };
  note.text = text;
  note.type = noteType;
  note.meta = noteType === "Rookie" ?{
    reportDate: String(rawMeta.reportDate || "").trim(),
    supervisingOfficer: String(rawMeta.supervisingOfficer || "").trim(),
    processingOfficer: String(rawMeta.processingOfficer || "").trim(),
    rookieName: String(rawMeta.rookieName || "").trim(),
    shift: String(rawMeta.shift || "").trim()
  } : {
    reportDate: String(rawMeta.reportDate || "").trim(),
    processingOfficer: String(rawMeta.processingOfficer || "").trim(),
    subject: String(rawMeta.subject || "").trim(),
    category: String(rawMeta.category || "").trim()
  };
  note.updatedAt = nowIso();
  note.updatedBy = actorName(req.user);
  logAction(req.db, req.user, "Interne Abteilungsnotiz bearbeitet", department.name, { before, after: note });
  writeDb(req.db);
  res.json({ department: publicDepartment(department, req.db, req.user) });
});

app.delete("/api/departments/:departmentId/member-notes/:noteId", requireAuth, (req, res) => {
  const department = getDepartment(req.db, req.params.departmentId);
  if (!canManageDepartmentAction(req.user, department, req.db, "departmentLeadership")) return res.status(403).json({ error: "Keine Berechtigung." });
  department.memberNotes = Array.isArray(department.memberNotes) ?department.memberNotes : [];
  const note = department.memberNotes.find((item) => item.id === req.params.noteId);
  if (!note) return res.status(404).json({ error: "Notiz nicht gefunden." });
  department.memberNotes = department.memberNotes.filter((item) => item.id !== req.params.noteId);
  logAction(req.db, req.user, "Interne Abteilungsnotiz gelöscht", department.name, { before: note });
  writeDb(req.db);
  res.json({ department: publicDepartment(department, req.db, req.user) });
});

app.post("/api/notes", requireAuth, requirePermission("actions", "manageNotes", "Supervisor"), (req, res) => {
  const title = String(req.body.title || "").trim();
  const priority = String(req.body.priority || "").trim();
  const text = String(req.body.text || "").trim();
  if (!title || !text || !["Info", "IT-Info", "Anweisung", "Direktion"].includes(priority)) {
    return res.status(400).json({ error: "Titel, Prioritaet und Text sind erforderlich." });
  }

  const note = {
    id: makeId("note"),
    title,
    priority,
    text,
    authorId: req.user.id,
    authorName: `${req.user.firstName} ${req.user.lastName}`.trim(),
    createdAt: nowIso()
  };
  req.db.notes.push(note);
  logAction(req.db, req.user, "Notiz erstellt", note.title, { after: note });
  writeDb(req.db);
  res.status(201).json({ note });
});

app.patch("/api/notes/:id", requireAuth, requirePermission("actions", "manageNotes", "Supervisor"), (req, res) => {
  const note = req.db.notes.find((item) => item.id === req.params.id);
  if (!note) return res.status(404).json({ error: "Notiz nicht gefunden." });

  const title = String(req.body.title || "").trim();
  const priority = String(req.body.priority || "").trim();
  const text = String(req.body.text || "").trim();
  if (!title || !text || !["Info", "IT-Info", "Anweisung", "Direktion"].includes(priority)) {
    return res.status(400).json({ error: "Titel, Prioritaet und Text sind erforderlich." });
  }

  const before = { ...note };
  Object.assign(note, {
    title,
    priority,
    text,
    updatedBy: `${req.user.firstName} ${req.user.lastName}`.trim(),
    updatedAt: nowIso()
  });
  logAction(req.db, req.user, "Notiz geändert", note.title, { before, after: note });
  writeDb(req.db);
  res.json({ note });
});

app.delete("/api/notes/:id", requireAuth, requirePermission("actions", "manageNotes", "Supervisor"), (req, res) => {
  const note = req.db.notes.find((item) => item.id === req.params.id);
  req.db.notes = req.db.notes.filter((note) => note.id !== req.params.id);
  logAction(req.db, req.user, "Notiz gelöscht", note?.title || req.params.id, { before: note || null });
  writeDb(req.db);
  res.json({ ok: true });
});

app.post("/api/duty/start", requireAuth, (req, res) => {
  const status = String(req.body.status || "");
  if (!["Innendienst", "Außendienst", "Undercover Dienst", "Admin Dienst"].includes(status)) {
    return res.status(400).json({ error: "Ungültiger Dienststatus." });
  }
  const activeAbsence = activeAbsenceForUser(req.db, req.user.id);
  if (activeAbsence) {
    return res.status(403).json({ error: `Du bist noch bis ${activeAbsence.endDate} abgemeldet. Beenden kannst du die Abmeldung unter Profil > Abmeldung > Meine Abmeldungen.` });
  }
  if (status === "Admin Dienst" && !req.user.teamler && (rolePower[req.user.role] || 0) < rolePower.IT) {
    return res.status(403).json({ error: "Admin Dienst ist nur für Teamler freigegeben." });
  }
  if (status === "Undercover Dienst" && !canUserStartDuty(req.db, req.user)) {
    return res.status(403).json({ error: DETECTIVE_DUTY_ERROR });
  }
  if (req.db.duty.some((entry) => entry.userId === req.user.id)) {
    return res.status(400).json({ error: "Du bist bereits im Dienst." });
  }
  const entry = {
    id: makeId("duty"),
    userId: req.user.id,
    status,
    startedAt: nowIso()
  };
  req.db.duty.push(entry);
  req.db.dutyHistory.push({ ...entry, endedAt: "", manual: false });
  logAction(req.db, req.user, "Dienst gestartet", status, { after: entry });
  writeDb(req.db);
  res.status(201).json({ entry });
});

app.post("/api/duty/switch", requireAuth, (req, res) => {
  const status = String(req.body.status || "");
  if (!["Innendienst", "Außendienst", "Undercover Dienst", "Admin Dienst"].includes(status)) {
    return res.status(400).json({ error: "Ungültiger Dienststatus." });
  }
  if (status === "Admin Dienst" && !req.user.teamler && (rolePower[req.user.role] || 0) < rolePower.IT) {
    return res.status(403).json({ error: "Admin Dienst ist nur für Teamler freigegeben." });
  }
  if (status === "Undercover Dienst" && !canUserStartDuty(req.db, req.user)) {
    return res.status(403).json({ error: DETECTIVE_DUTY_ERROR });
  }
  const active = req.db.duty.find((entry) => entry.userId === req.user.id);
  if (!active) return res.status(400).json({ error: "Du bist aktuell nicht im Dienst." });
  const before = { ...active };
  active.status = status;
  active.switchedAt = nowIso();
  const history = req.db.dutyHistory.find((entry) => entry.id === active.id) || req.db.dutyHistory.find((entry) => entry.userId === req.user.id && !entry.endedAt);
  if (history) {
    history.status = status;
    history.switchedAt = active.switchedAt;
  }
  logAction(req.db, req.user, "Dienst umgetragen", status, { before, after: active });
  writeDb(req.db);
  res.json({ entry: active });
});

app.post("/api/duty/stop", requireAuth, (req, res) => {
  const active = req.db.duty.find((entry) => entry.userId === req.user.id);
  if (active) {
    const history = req.db.dutyHistory.find((entry) => entry.id === active.id) || req.db.dutyHistory.find((entry) => entry.userId === req.user.id && !entry.endedAt);
    if (history) history.endedAt = nowIso();
    else req.db.dutyHistory.push({ ...active, endedAt: nowIso(), manual: false });
    logAction(req.db, req.user, "Dienst beendet", active.status, { before: active, endedAt: nowIso() });
  }
  req.db.duty = req.db.duty.filter((entry) => entry.userId !== req.user.id);
  writeDb(req.db);
  res.json({ ok: true });
});

app.post("/api/duty/stop/:userId", requireAuth, requirePermission("actions", "stopSingleDuty", "User"), (req, res) => {
  const active = req.db.duty.find((entry) => entry.userId === req.params.userId);
  if (active) {
    const history = req.db.dutyHistory.find((entry) => entry.id === active.id) || req.db.dutyHistory.find((entry) => entry.userId === req.params.userId && !entry.endedAt);
    if (history) history.endedAt = nowIso();
    else req.db.dutyHistory.push({ ...active, endedAt: nowIso(), manual: false });
    logAction(req.db, req.user, "Dienst beendet", active.status, { userId: req.params.userId, before: active, endedAt: nowIso() });
  }
  req.db.duty = req.db.duty.filter((entry) => entry.userId !== req.params.userId);
  writeDb(req.db);
  res.json({ ok: true });
});

app.post("/api/duty/stop-all", requireAuth, requirePermission("actions", "stopAllDuty", "Direktion"), (req, res) => {
  const endedAt = nowIso();
  req.db.duty.forEach((active) => {
    const history = req.db.dutyHistory.find((entry) => entry.id === active.id) || req.db.dutyHistory.find((entry) => entry.userId === active.userId && !entry.endedAt);
    if (history) history.endedAt = endedAt;
    else req.db.dutyHistory.push({ ...active, endedAt, manual: false });
  });
  logAction(req.db, req.user, "Alle Dienste beendet", "Dienstblatt", { count: req.db.duty.length });
  req.db.duty = [];
  writeDb(req.db);
  res.json({ ok: true });
});

app.post("/api/duty/manual", requireAuth, requirePermission("actions", "manageDutyHours", "Direktion"), (req, res) => {
  const userId = String(req.body.userId || "");
  const status = String(req.body.status || "Manuelle Korrektur").trim();
  const startedAt = String(req.body.startedAt || "").trim();
  const endedAt = String(req.body.endedAt || "").trim();
  const reason = String(req.body.reason || "").trim();
  if (!req.db.users.some((user) => user.id === userId)) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  if (!startedAt || !endedAt || !reason) return res.status(400).json({ error: "Start, Ende und Grund sind Pflichtfelder." });
  const entry = { id: makeId("duty_manual"), userId, status, startedAt: new Date(startedAt).toISOString(), endedAt: new Date(endedAt).toISOString(), manual: true, reason, actorName: actorName(req.user) };
  req.db.dutyHistory.push(entry);
  logAction(req.db, req.user, "Dienstzeit hinzugefügt", status, { after: entry });
  writeDb(req.db);
  res.status(201).json({ entry });
});

app.delete("/api/duty/history/:id", requireAuth, requirePermission("actions", "manageDutyHours", "Direktion"), (req, res) => {
  res.status(403).json({ error: "Der Dienstzeiten-Log ist nicht löschbar." });
});

function endAllActiveDuty(db, actor, action = "Alle Dienste beendet") {
  const endedAt = nowIso();
  db.duty.forEach((active) => {
    const history = db.dutyHistory.find((entry) => entry.id === active.id) || db.dutyHistory.find((entry) => entry.userId === active.userId && !entry.endedAt);
    if (history) history.endedAt = endedAt;
    else db.dutyHistory.push({ ...active, endedAt, manual: false });
  });
  const count = db.duty.length;
  logAction(db, actor, action, "Dienstblatt", { count });
  db.duty = [];
  return count;
}

app.post("/api/seizures", requireAuth, (req, res) => {
  const suspect = String(req.body.suspect || "").trim();
  const location = String(req.body.location || "").trim();
  const numberValue = (value) => Math.max(0, Number(value || 0) || 0);
  const sourceType = ["Dealer", "Camper"].includes(String(req.body.sourceType || "").trim()) ?String(req.body.sourceType).trim() : "";
  const evidenceLinks = Array.isArray(req.body.evidenceLinks)
    ?req.body.evidenceLinks.map((item) => String(item || "").trim()).filter(Boolean)
    : String(req.body.evidenceLink || req.body.weapons || "").split("\n").map((item) => item.trim()).filter(Boolean);
  if (!suspect || !location || !evidenceLinks.length) {
    return res.status(400).json({ error: "Tatverdächtiger, Standort und mindestens ein Beweis sind Pflichtfelder." });
  }
  const entry = {
    id: makeId("seizure"),
    suspect,
    location,
    evidenceLinks,
    weapons: "",
    drugs: "",
    other: "",
    witness: String(req.body.witness || "").trim(),
    blackMoney: numberValue(req.body.blackMoney),
    crates: numberValue(req.body.crates),
    sourceType,
    vehicleId: String(req.body.vehicleId || "").trim(),
    officerId: req.user.id,
    officerName: actorName(req.user),
    createdAt: nowIso()
  };
  req.db.settings.seizures = Array.isArray(req.db.settings.seizures) ?req.db.settings.seizures : [];
  req.db.settings.seizures.unshift(entry);
  logAction(req.db, req.user, "Beschlagnahmung erstellt", suspect, { after: entry });
  writeDb(req.db);
  res.status(201).json({ seizure: entry, settings: publicSettings(req.db.settings) });
});

app.patch("/api/seizures/:id", requireAuth, (req, res) => {
  const entry = req.db.settings.seizures.find((item) => item.id === req.params.id);
  if (!entry) return res.status(404).json({ error: "Beschlagnahmung nicht gefunden." });
  const canEditAll = (rolePower[req.user.role] || 0) >= rolePower.Direktion;
  if (!canEditAll && entry.officerId !== req.user.id) return res.status(403).json({ error: "Keine Berechtigung." });
  const suspect = String(req.body.suspect || "").trim();
  const location = String(req.body.location || "").trim();
  const before = { ...entry };
  const numberValue = (value) => Math.max(0, Number(value || 0) || 0);
  const evidenceLinks = Array.isArray(req.body.evidenceLinks)
    ?req.body.evidenceLinks.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!suspect || !location || !evidenceLinks.length) return res.status(400).json({ error: "Tatverdächtiger, Standort und mindestens ein Beweis sind Pflichtfelder." });
  Object.assign(entry, {
    suspect,
    location,
    evidenceLinks,
    weapons: "",
    drugs: "",
    other: "",
    witness: String(req.body.witness || "").trim(),
    blackMoney: numberValue(req.body.blackMoney),
    crates: numberValue(req.body.crates),
    sourceType: ["Dealer", "Camper"].includes(String(req.body.sourceType || "").trim()) ?String(req.body.sourceType).trim() : "",
    vehicleId: String(req.body.vehicleId || "").trim(),
    updatedAt: nowIso(),
    updatedBy: actorName(req.user)
  });
  logAction(req.db, req.user, "Beschlagnahmung bearbeitet", suspect, { before, after: entry });
  writeDb(req.db);
  res.json({ seizure: entry, settings: publicSettings(req.db.settings) });
});

app.delete("/api/seizures/:id", requireAuth, requireRole("Direktion"), (req, res) => {
  const entry = req.db.settings.seizures.find((item) => item.id === req.params.id);
  if (!entry) return res.status(404).json({ error: "Beschlagnahmung nicht gefunden." });
  req.db.settings.seizures = req.db.settings.seizures.filter((item) => item.id !== req.params.id);
  logAction(req.db, req.user, "Beschlagnahmung gelöscht", entry.suspect || req.params.id, { before: entry });
  writeDb(req.db);
  res.json({ ok: true, settings: publicSettings(req.db.settings) });
});

app.post("/api/calendar/events", requireAuth, requireRole("Direktion"), (req, res) => {
  const title = String(req.body.title || "").trim();
  const description = String(req.body.description || "").trim();
  const startDate = String(req.body.startDate || "").trim();
  const startTime = String(req.body.startTime || "").trim();
  const endDate = String(req.body.endDate || startDate).trim();
  const endTime = String(req.body.endTime || startTime).trim();
  const type = String(req.body.type || "Allgemein").trim();
  const color = String(req.body.color || "Blau").trim();
  const location = String(req.body.location || "").trim();
  const reminder = String(req.body.reminder || "30 Minuten").trim();
  const allDay = Boolean(req.body.allDay);
  const recurrence = String(req.body.recurrence || "none").toLowerCase() === "weekly" ? "weekly" : "none";
  if (!title || !startDate || (!allDay && !startTime)) return res.status(400).json({ error: "Titel, Startdatum und Startzeit sind Pflichtfelder." });
  const event = {
    id: makeId("calendar"),
    title,
    description,
    startDate,
    startTime: allDay ?"" : startTime,
    endDate: endDate || startDate,
    endTime: allDay ?"" : endTime,
    type,
    color,
    location,
    reminder,
    allDay,
    recurrence,
    cancelledDates: [],
    authorName: actorName(req.user),
    createdAt: nowIso()
  };
  req.db.settings.calendarEvents.unshift(event);
  logAction(req.db, req.user, "Kalendertermin erstellt", title, { after: event });
  writeDb(req.db);
  res.status(201).json({ event });
});

app.patch("/api/calendar/events/:id", requireAuth, requireRole("Direktion"), (req, res) => {
  const event = req.db.settings.calendarEvents.find((item) => item.id === req.params.id);
  if (!event) return res.status(404).json({ error: "Termin nicht gefunden." });
  const before = { ...event };
  const title = String(req.body.title || "").trim();
  const startDate = String(req.body.startDate || "").trim();
  const startTime = String(req.body.startTime || "").trim();
  const allDay = Boolean(req.body.allDay);
  const recurrence = String(req.body.recurrence || "none").toLowerCase() === "weekly" ? "weekly" : "none";
  if (!title || !startDate || (!allDay && !startTime)) return res.status(400).json({ error: "Titel, Startdatum und Startzeit sind Pflichtfelder." });
  Object.assign(event, {
    title,
    description: String(req.body.description || "").trim(),
    startDate,
    startTime: allDay ?"" : startTime,
    endDate: String(req.body.endDate || startDate).trim(),
    endTime: allDay ?"" : String(req.body.endTime || startTime).trim(),
    type: String(req.body.type || "Allgemein").trim(),
    color: String(req.body.color || "Blau").trim(),
    location: String(req.body.location || "").trim(),
    reminder: String(req.body.reminder || "30 Minuten").trim(),
    allDay,
    recurrence,
    cancelledDates: Array.isArray(event.cancelledDates) ?event.cancelledDates : [],
    updatedAt: nowIso()
  });
  logAction(req.db, req.user, "Kalendertermin bearbeitet", title, { before, after: event });
  writeDb(req.db);
  res.json({ event });
});

app.post("/api/calendar/events/:id/cancel", requireAuth, requireRole("Direktion"), (req, res) => {
  const event = req.db.settings.calendarEvents.find((item) => item.id === req.params.id);
  if (!event) return res.status(404).json({ error: "Termin nicht gefunden." });
  const date = String(req.body.date || "").trim();
  const cancelled = Boolean(req.body.cancelled ?? true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Ungültiges Datum." });
  const before = { ...event, cancelledDates: [...(event.cancelledDates || [])] };
  const dates = new Set(event.cancelledDates || []);
  if (cancelled) dates.add(date);
  else dates.delete(date);
  event.cancelledDates = [...dates].sort();
  event.updatedAt = nowIso();
  logAction(req.db, req.user, cancelled ?"Kalendertermin ausfallen lassen" : "Kalendertermin wieder aktiv", event.title, { before, after: event, date });
  writeDb(req.db);
  res.json({ event });
});

app.delete("/api/calendar/events/:id", requireAuth, requireRole("Direktion"), (req, res) => {
  const event = req.db.settings.calendarEvents.find((item) => item.id === req.params.id);
  req.db.settings.calendarEvents = req.db.settings.calendarEvents.filter((item) => item.id !== req.params.id);
  logAction(req.db, req.user, "Kalendertermin gelöscht", event?.title || req.params.id, { before: event || null });
  writeDb(req.db);
  res.json({ ok: true });
});

app.get("*", (_req, res) => {
  sendIndexHtml(res);
});

function currentBerlinRestartWindow() {
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date()).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

function slugify(value, prefix = "seite") {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || prefix;
}

function runScheduledRestarts() {
  try {
    const db = readDb();
    const times = db.settings.restartTimes || [];
    if (!times.length) return;
    const { date, time } = currentBerlinRestartWindow();
    if (!times.includes(time)) return;
    db.settings.restartLastRun = db.settings.restartLastRun || {};
    if (db.settings.restartLastRun[time] === date) return;
    const count = endAllActiveDuty(db, { firstName: "System", lastName: "Restart" }, "Restart: Dienste automatisch beendet");
    db.settings.restartLastRun[time] = date;
    if (count > 0) writeDb(db);
    else writeDb(db);
  } catch (error) {
    console.error("Restart scheduler failed:", error);
  }
}

function runScheduledBackups() {
  try {
    const db = readDb();
    const { date, time } = currentBerlinRestartWindow();
    db.settings.backupLastRun = db.settings.backupLastRun || "";
    if (!["00:00", "24:00"].includes(time) || db.settings.backupLastRun === date) return;
    const backup = createStoredBackup(db, { firstName: "System", lastName: "Backup" }, "Automatisch");
    db.settings.backupLastRun = date;
    logAction(db, { firstName: "System", lastName: "Backup" }, "Automatisches Backup erstellt", backup.id, {
      changesSinceLast: backup.changesSinceLast,
      sizeBytes: backup.sizeBytes
    });
    writeDb(db);
  } catch (error) {
    console.error("Backup scheduler failed:", error);
  }
}

ensureStorage();
runScheduledRestarts();
runScheduledBackups();
runTwitchLivePoll();
setInterval(runScheduledRestarts, 30000);
setInterval(runScheduledBackups, 30000);
setInterval(runTwitchLivePoll, 60000);
startDiscordBot();
app.listen(PORT, () => {
  console.log(`LSPD Dienstblatt laeuft auf http://localhost:${PORT}`);
});
