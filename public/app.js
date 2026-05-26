function isDevModeAuthStorage() {
  return localStorage.getItem("lspd_devmode_active") === "1";
}

function storedAuthToken() {
  return isDevModeAuthStorage() ?sessionStorage.getItem("lspd_token_dev") : localStorage.getItem("lspd_token");
}

function storeAuthToken(token) {
  if (isDevModeAuthStorage()) {
    sessionStorage.setItem("lspd_token_dev", token);
    localStorage.removeItem("lspd_token");
  } else {
    localStorage.setItem("lspd_token", token);
    sessionStorage.removeItem("lspd_token_dev");
  }
}

function clearAuthToken() {
  if (isDevModeAuthStorage()) sessionStorage.removeItem("lspd_token_dev");
  else localStorage.removeItem("lspd_token");
}

function installInspectGuard() {
  const blocker = $("#inspectBlocker");
  let lastReportAt = 0;
  const canUseContextMenu = () => ["Direktion", "IT", "IT-Leitung"].includes(state.currentUser?.role);
  const reportAttempt = (reason) => {
    const now = Date.now();
    if (now - lastReportAt < 2500) return;
    lastReportAt = now;
    fetch("/api/security/inspect-attempt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(state.token ?{ Authorization: `Bearer ${state.token}` } : {})
      },
      body: JSON.stringify({ reason, page: state.page || document.title })
    }).catch(() => {});
  };
  const showBlocker = (reason) => {
    if (!blocker) return;
    blocker.classList.remove("hidden");
    window.setTimeout(() => blocker.classList.add("hidden"), 2200);
    reportAttempt(reason);
  };
  document.addEventListener("contextmenu", (event) => {
    if (canUseContextMenu()) return;
    event.preventDefault();
    showBlocker("Rechtsklick / Kontextmenü");
  });
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const blocked = event.key === "F12"
      || (event.ctrlKey && event.shiftKey && ["i", "j", "c"].includes(key))
      || (event.ctrlKey && ["u", "s"].includes(key));
    if (!blocked) return;
    event.preventDefault();
    event.stopPropagation();
    showBlocker(`Tastenkürzel ${event.ctrlKey ?"Ctrl+" : ""}${event.shiftKey ?"Shift+" : ""}${event.key}`);
  }, true);
}

const state = {
  token: storedAuthToken(),
  currentUser: null,
  users: [],
  archivedUsers: [],
  ranks: [],
  roles: [],
  departmentPositions: [],
  settings: null,
  notes: [],
  duty: [],
  dutyHistory: [],
  logs: [],
  disciplinary: [],
  absences: [],
  departments: [],
  mailboxThreads: [],
  customPages: [],
  liveRevision: "",
  clientRefreshRevision: "",
  itActivity: [],
  itActivityLoading: false,
  itActivityLoadedAt: 0,
  itMailboxThreads: [],
  itMailboxLoading: false,
  page: requestedPageFromUrl() || localStorage.getItem("lspd_page") || "Dienstblatt",
  directionTab: urlPageParam() === "Direktion" && urlTabParam() ?urlTabParam() : localStorage.getItem("lspd_direction_tab") || "overview",
  directionMemberTab: localStorage.getItem("lspd_direction_member_tab") || "members",
  profileTab: urlPageParam() === "Profil" && urlTabParam() ?urlTabParam() : localStorage.getItem("lspd_profile_tab") || "Ausbildung",
  departmentTabs: JSON.parse(localStorage.getItem("lspd_department_tabs") || "{}")
};

["pointerdown", "keydown"].forEach((eventName) => {
  document.addEventListener(eventName, unlockSwatAudio, { once: true, passive: true });
});

const DISCORD_PENDING_TOKEN_KEY = "lspd_pending_discord_token";
const DISCORD_LINK_AFTER_LOGIN_KEY = "lspd_discord_link_after_login";
const DISCORD_JOIN_ACK_KEY = "lspd_discord_join_ack";
const CHANGELOG_READ_PREFIX = "lspd_changelog_read";
const CLIENT_REFRESH_SEEN_KEY = "lspd_client_refresh_seen";
const SWAT_ALERT_PERMISSION_KEY = "lspd_swat_alert_permission";
const DEFAULT_ONBOARDING_TUTORIAL = [
  { id: "welcome", title: "Herzlich willkommen im LSPD", page: "", text: "Dein Account ist aktiviert.\n\n- Kurze Einweisung in die wichtigsten Reiter\n- Danach kannst du das Dienstblatt normal nutzen", imageUrl: "" },
  { id: "dienstblatt", title: "Dienstblatt", page: "Dienstblatt", text: "Zentrale Dienstübersicht.\n\n- Aktuelle Informationen lesen\n- Eingetragene Officer sehen\n- Als Innendienst oder Außendienst eintragen\n- Beim Dienstende immer austragen", imageUrl: "" },
  { id: "beschlagnahmungen", title: "Beschlagnahmungen", page: "Beschlagnahmung", text: "Alle abgenommenen Gegenstände dokumentieren.\n\n- Neue Beschlagnahmung öffnen\n- Tatverdächtigen und groben Standort eintragen\n- Beweise als Link oder Upload hinzufügen\n- Zusatzinfos wie Schwarzgeld sauber ergänzen", imageUrl: "" },
  { id: "informationen", title: "Informationen", page: "Informationen", text: "Wichtige Dokumente und Übersichten.\n\n- Dienst- und Fahrzeugvorschriften\n- Abzeichen und Sanktionskatalog\n- Rechte des Tatverdächtigen\n- Sondergenehmigungen und Ampelsystem", imageUrl: "" },
  { id: "abteilungen", title: "Abteilungen", page: "Abteilungen", text: "Übersicht aller Abteilungen.\n\n- Voraussetzungen prüfen\n- Mitglieder der Abteilung sehen\n- Online- und Offline-Status erkennen\n- Abteilungsinfos und Hinweise lesen", imageUrl: "" },
  { id: "mitglieder", title: "Mitglieder", page: "Mitglieder", text: "Alle Mitglieder auf einen Blick.\n\n- Ränge und vollständige Rangnamen per Hover sehen\n- Ausbildungen und Haken prüfen\n- Erkennen, welche Ausbildung für welchen Rang zählt", imageUrl: "" },
  { id: "fluktuation", title: "Mitgliederfluktation", page: "Mitgliederfluktation", text: "Personalbewegungen nachvollziehen.\n\n- Einstellungen ansehen\n- Kündigungen ansehen\n- Änderungen am Personalbestand prüfen", imageUrl: "" },
  { id: "befoerderungen", title: "Beförderungen", page: "Beförderungen", text: "Rangänderungen als Übersicht.\n\n- Beförderungen sehen\n- Degradierungen sehen\n- Änderungen für alle nachvollziehbar einsehen", imageUrl: "" },
  { id: "changelog", title: "Changelog", page: "Changelog", text: "Änderungen am Dienstblatt.\n\n- Neue Features lesen\n- Bugfixes nachvollziehen\n- Ungelesene Änderungen in der Navigation erkennen", imageUrl: "" },
  { id: "postfach", title: "Postfach", page: "Postfach", text: "Interne Nachrichten und Hinweise.\n\n- Push-Hinweise zu Vorschriftenänderungen\n- Private Chats schreiben\n- Gruppenchats für wichtige Informationen nutzen", imageUrl: "" },
  { id: "profil", title: "Profil", page: "Profil", text: "Dein eigener Account.\n\n- Eigene Daten und Ausbildungen einsehen\n- Discord und Twitch synchronisieren\n- Dienstzeiten prüfen\n- Abmeldungen einreichen oder ansehen\n- Eigene Sanktionen einsehen", imageUrl: "" },
  { id: "kalender", title: "Kalender", page: "Kalender", text: "Wichtige Termine.\n\n- Eingetragene Termine ansehen\n- Hinweise zu bevorstehenden Terminen beachten", imageUrl: "" },
  { id: "swat", title: "SWAT", page: "SWAT", text: "Hier siehst du SWAT-Teamübersichten, Status und je nach Teamzugehörigkeit interne SWAT-Notizen oder Ausrufe.", imageUrl: "" },
  { id: "discord", title: "Discord verbinden", page: "Profil", text: "Discord ist Pflicht für den Dienstblatt-Account.\n\n- Tritt zuerst dem Discord Server bei\n- Verknüpfe danach deinen Discord Account\n- Danach funktionieren Rollen und Dienstblatt-Zuordnung vollständig", imageUrl: "" }
];
const PUBLIC_BASE_URL = `${window.location.origin}/`;
const SWAT_TEAMS = ["A", "B", "C"];
const LIVE_RELOAD_INTERVAL_MS = 15000;
const SWAT_STATUS_POLL_INTERVAL_MS = 3000;
const GIBSON_COLA_POLL_INTERVAL_MS = 2000;
const GIBSON_COLA_SEEN_KEY = "lspd_gibson_cola_party_seen";
const CUSTOM_ANIMATION_POLL_INTERVAL_MS = 1000;
const CUSTOM_ANIMATION_SEEN_KEY = "lspd_custom_animation_seen";
const CUSTOM_ANIMATION_PRESETS = [
  {
    title: "Shoe Shine Banana",
    url: "https://commons.wikimedia.org/wiki/Special:Redirect/file/BananaShoeShine.gif",
    duration: 9
  },
  {
    title: "Mini Pineapple Dance",
    url: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Nueva_imagen.GIF",
    duration: 5
  },
  {
    title: "GIPHY Fortnite Dance",
    url: "https://media.giphy.com/media/WF8ooX9TomaKBf1WKb/giphy.gif",
    duration: 6
  },
  {
    title: "GIPHY Lynx Emote",
    url: "https://media.giphy.com/media/Ak8Y4FVutHzHWMJQUr/giphy.gif",
    duration: 6
  },
  {
    title: "GIPHY Orange Justice",
    url: "https://media.giphy.com/media/kKIYA0msy1b4LaCSHP/giphy.gif",
    duration: 6
  },
  {
    title: "GIPHY Battle Dance",
    url: "https://media.giphy.com/media/z83doLns1u8053r5aC/giphy.gif",
    duration: 6
  }
];
const ACTIVITY_PING_INTERVAL_MS = 10000;
const JUMPSCARE_POLL_INTERVAL_MS = 2000;
const JUMPSCARE_SEEN_KEY = "lspd_jumpscare_seen";
const TRAINING_DOCS_OUTLINE_CACHE_PREFIX = "lspd_training_docs_outline_";
let liveReloadTimer = null;
let liveReloadInFlight = false;
let discordSyncInFlight = false;
let liveReloadPendingAfterModal = false;
let swatStatusTimer = null;
let swatStatusInFlight = false;
let gibsonColaTimer = null;
let gibsonColaInFlight = false;
let customAnimationTimer = null;
let customAnimationInFlight = false;
let activityPingTimer = null;
let activityPingInFlight = false;
let jumpscareTimer = null;
let jumpscareInFlight = false;
let lastMailboxUnreadCount = 0;
let mailboxUnreadInitialized = false;
let mailboxAudioReady = false;
let informationSilentSaveQueue = Promise.resolve();
let mailboxReadQueue = Promise.resolve();
let departmentNoteMutationQueue = Promise.resolve();
const pendingDepartmentNoteDeletes = new Set();
let mailboxPendingImage = null;
let itSecrets = null;
let itSecretsLoading = false;
let tutorialReplayMode = false;
let activeInformationEditLockKey = "";
let informationEditLockTimer = null;
let membersModuleEditMode = false;
let membersModuleDraft = {};
let uprankRulesSaveQueue = Promise.resolve();
let uprankRulesPendingDraft = null;
let uprankRulesSaving = false;
let swatAudioContext = null;
let swatAudioUnlocked = false;
let calendarReminderTimer = null;

const pages = [
  "Dienstblatt",
  "Einsatzzentrale",
  "Beschlagnahmung",
  "Informationen",
  "Meine Lernkontrollen",
  "Ausbilderübersicht",
  "Abteilungen",
  "Mitglieder",
  "Mitgliederfluktation",
  "Beförderungen",
  "Changelog",
  "Postfach",
  "Profil",
  "Kalender"
];

const pageIcons = {
  "Dienstblatt": "▣",
  "Einsatzzentrale": "◉",
  "Beschlagnahmung": "◇",
  "Informationen": "ⓘ",
  "Ausbilderübersicht": "□",
  "Meine Lernkontrollen": "✺",
  "Abteilungen": "▦",
  "Mitglieder": "♙",
  "Mitgliederfluktation": "↔",
  "Beförderungen": "↟",
  "Changelog": "☰",
  "Postfach": "✉",
  "Profil": "♙",
  "Kalender": "□",
  "Direktion": "◆"
};

const adminPages = ["IT", "Direktion"];
const positionOrder = { "Direktion": 5, "Leitung": 4, "Stv. Leitung": 3, "Mitglied": 2, "Anwärter": 1 };
const trainingGroups = [
  ["EST", "Wissen", "Fahren", "Schießen", "Verhalten", "Undercover", "Wanted"],
  ["EL", "Officer Prüfung", "Prak. VHF", "Prak. EL I", "Führung", "Prak. EL II"],
  ["Air Support", "Riot", "Coquette"]
];
const DEFAULT_TRAINING_CATEGORY = "Ohne Kategorie";
const trainings = trainingGroups.flat();
function trainingModuleSettings() {
  const config = state.settings?.trainingModules || {};
  return {
    labels: config.labels && typeof config.labels === "object" ?config.labels : {},
    details: config.details && typeof config.details === "object" ?config.details : {},
    categories: config.categories && typeof config.categories === "object" ?config.categories : {},
    requirements: config.requirements && typeof config.requirements === "object" ?config.requirements : {},
    order: Array.isArray(config.order) ?config.order.filter((training) => trainings.includes(training)) : [],
    deleted: new Set(Array.isArray(config.deleted) ?config.deleted.filter((training) => trainings.includes(training)) : []),
    hidden: new Set(Array.isArray(config.hidden) ?config.hidden : [])
  };
}
function defaultTrainingCategory(training) {
  return trainings.includes(training) ?DEFAULT_TRAINING_CATEGORY : "";
}
function orderedTrainings({ includeHidden = false } = {}) {
  const config = trainingModuleSettings();
  const ordered = [...config.order, ...trainings.filter((training) => !config.order.includes(training))]
    .filter((training, index, list) => trainings.includes(training) && !config.deleted.has(training) && list.indexOf(training) === index);
  return includeHidden ?ordered : ordered.filter((training) => !config.hidden.has(training));
}
function visibleTrainingGroups() {
  const config = trainingModuleSettings();
  const groups = [];
  orderedTrainings().forEach((training) => {
    const category = config.categories[training] || defaultTrainingCategory(training);
    let group = groups.find((item) => item.title === category);
    if (!group) {
      group = { title: category, trainings: [] };
      groups.push(group);
    }
    group.trainings.push(training);
  });
  return groups;
}
function visibleTrainings() {
  return visibleTrainingGroups().flatMap((group) => group.trainings);
}
function trainingDisplayName(training) {
  return trainingModuleSettings().labels[training] || (training === "EST" ?"Grundausbildung" : training);
}
function trainingDetailText(training) {
  return trainingModuleSettings().details[training] || training;
}
function trainingRequirementText(training) {
  return trainingModuleSettings().requirements[training] || "";
}
function trainingTooltipText(training) {
  return [trainingDisplayName(training), trainingDetailText(training), trainingRequirementText(training) ?`Voraussetzung: ${trainingRequirementText(training)}` : ""].filter(Boolean).join(" · ");
}
function trainingUprankRequirementText(training) {
  const ranks = uprankRules()
    .filter((rule) => (rule.trainings || []).includes(training))
    .map((rule) => Number(rule.targetRank))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return ranks.length ?`Rang ${ranks[0]}` : "";
}
function trainingTooltipMarkup(training) {
  const requirement = trainingRequirementText(training);
  const uprankRequirement = trainingUprankRequirementText(training);
  return `
    <span class="training-hover-card" role="tooltip">
      <b>${escapeHtml(trainingDisplayName(training))}</b>
      <span>${escapeHtml(trainingDetailText(training))}</span>
      ${requirement ?`<i>Voraussetzung für Rang: ${escapeHtml(requirement)}</i>` : ""}
      ${uprankRequirement ?`<i>${escapeHtml(uprankRequirement)}</i>` : ""}
    </span>
  `;
}
const expandedDepartments = new Set(JSON.parse(localStorage.getItem("lspd_expanded_departments") || "[]"));
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedCalendarDate = isoDateLocal(new Date());
let trainingTimerInterval = null;
const dutyOptions = [
  { title: "Innendienst", description: "Büro, Verwaltung, Leitstelle", icon: "Innendienst", tone: "inside" },
  { title: "Außendienst", description: "Streife, Einsatz und Außendienst", icon: "Kalender", tone: "outside" },
  { title: "Undercover Dienst", description: "Zivile Arbeit und verdeckte Maßnahmen", icon: "Mitglieder", tone: "undercover" },
  { title: "Admin Dienst", description: "Teamler / administrative Tätigkeiten", icon: "IT", teamlerOnly: true, tone: "admin" }
];

function availableDutyOptions() {
  return dutyOptions;
}

function isDetectiveDepartment(department) {
  return `${department?.id || ""} ${department?.name || ""}`.toLowerCase().includes("detective");
}

function currentUserCanStartDuty() {
  return (state.departments || []).some((department) =>
    isDetectiveDepartment(department)
    && (department.members || []).some((member) => member.userId === state.currentUser?.id)
  );
}

const pageDescriptions = {
  "Einsatzzentrale": "Koordination laufender Einsätze und operativer Meldungen",
  "Beschlagnahmung": "Erfassung und Verwaltung beschlagnahmter Gegenstände",
  "Informationen": "Zentrale Informationen und Bewerbungsstatus verwalten",
  "Ausbilderübersicht": "Übersicht aller Ausbildungsmodule und Prüfungen",
  "Meine Lernkontrollen": "Eigene Lernkontrollen und Prüfungsstände einsehen",
  "Abteilungen": "Übersicht aller Abteilungen und Personal",
  "Mitglieder": "Übersicht aller aktiven Mitglieder und Ausbildungen",
  "Mitgliederfluktation": "Übersicht über Einstellungen und Kündigungen",
  "Beförderungen": "Ankündigungen zu Beförderungen und Degradierungen",
  "Changelog": "Änderungen und Neuerungen im Dienstblatt einsehen",
  "Postfach": "Interne Nachrichten und Mitteilungen verwalten",
  "Profil": "Eigene Accountdaten, Avatar und Passwort verwalten",
  "Kalender": "Termine, Dienste und wichtige Ereignisse planen",
  "Direktion": "Leitung, Verwaltung und Mitgliedersteuerung",
  "IT": "Systemeinstellungen, Reiter und Ränge verwalten"
};

const $ = (selector) => document.querySelector(selector);
const content = $("#content");
const modalRoot = $("#modalRoot");
const notifyRoot = $("#notifyRoot");
const warmedAvatarUrls = new Set();
let activeInformationDocUrlId = "";
let lastOpenedDeepLinkDoc = "";

function urlPageParam() {
  const params = new URLSearchParams(window.location.search);
  const page = params.get("page") || "";
  if (page) return page;
  const hashMatch = window.location.hash.match(/^#\/page\/(.+)$/);
  return hashMatch ?decodeURIComponent(hashMatch[1]) : "";
}

function urlDocParam() {
  return new URLSearchParams(window.location.search).get("doc") || "";
}

function urlTabParam() {
  return new URLSearchParams(window.location.search).get("tab") || "";
}

function requestedPageFromUrl() {
  return urlPageParam() || (urlDocParam() ?"Informationen" : "");
}

function applyUrlState({ persist = false } = {}) {
  const requestedPage = requestedPageFromUrl();
  if (requestedPage) state.page = requestedPage;
  const tab = urlTabParam();
  if (tab) {
    if (state.page === "Direktion") state.directionTab = tab;
    if (state.page === "Profil") state.profileTab = tab;
    if (state.page === "IT") localStorage.setItem("lspd_it_tab", tab);
    if (isDepartmentPage(state.page)) {
      state.departmentTabs = { ...(state.departmentTabs || {}), [state.page.replace(/^dept:/, "")]: tab };
    }
  }
  if (persist && requestedPage) localStorage.setItem("lspd_page", state.page);
}

function updateAppUrl({ docId = "", replace = false } = {}) {
  if (!state.currentUser) return;
  const url = new URL(window.location.href);
  url.searchParams.set("page", state.page || "Dienstblatt");
  const tab = currentUrlTab();
  if (tab) url.searchParams.set("tab", tab);
  else url.searchParams.delete("tab");
  if (state.page !== "Informationen") url.searchParams.delete("doc");
  else if (docId) url.searchParams.set("doc", docId);
  else url.searchParams.delete("doc");
  url.searchParams.delete("refresh");
  url.hash = "";
  const next = `${url.pathname}${url.search}`;
  if (next === `${window.location.pathname}${window.location.search}`) return;
  window.history[replace ?"replaceState" : "pushState"]({}, "", next);
}

function currentUrlTab() {
  if (state.page === "Direktion") return state.directionTab || "";
  if (state.page === "Profil") return state.profileTab || "";
  if (state.page === "IT") return localStorage.getItem("lspd_it_tab") || "overview";
  if (isDepartmentPage(state.page)) return state.departmentTabs?.[departmentByPage(state.page)?.id] || "";
  return "";
}

function navigateToPage(page, { replace = false } = {}) {
  state.page = page;
  localStorage.setItem("lspd_page", state.page);
  if (state.page === "Changelog") markChangelogRead();
  updateAppUrl({ replace });
  renderApp();
}

function warmAvatarCache() {
  const priorityUrls = ["/assets/lspd-logo-20260515.png", state.currentUser?.avatarUrl].filter(Boolean);
  const idleUrls = (state.users || []).map((user) => user.avatarUrl).filter(Boolean).filter((url) => !priorityUrls.includes(url));
  const warm = (url) => {
    if (warmedAvatarUrls.has(url)) return;
    warmedAvatarUrls.add(url);
    const image = new Image();
    image.decoding = "async";
    image.src = url;
  };
  priorityUrls.forEach(warm);
  const preloadRest = () => idleUrls.slice(0, 25).forEach(warm);
  if ("requestIdleCallback" in window) window.requestIdleCallback(preloadRest, { timeout: 2500 });
  else window.setTimeout(preloadRest, 250);
}

function hasRole(minRole) {
  const power = { User: 1, Supervisor: 2, Direktion: 3, IT: 4, "IT-Leitung": 5 };
  return (power[state.currentUser?.role] || 0) >= (power[minRole] || 0);
}

function canManageFluctuation() {
  return state.currentUser?.role === "IT-Leitung";
}

function canDeleteAccounts() {
  return hasRole("IT");
}

function canBypassRankHierarchyClient() {
  return hasRole("IT");
}

function canAffectUserRankClient(user) {
  if (!user) return false;
  if (canBypassRankHierarchyClient()) return true;
  return user.id !== state.currentUser?.id && hasRole("Direktion") && Number(state.currentUser?.rank || 0) > Number(user.rank || 0);
}

function canEditUserProfileClient(user) {
  if (!user) return hasRole("Direktion");
  return hasRole("Direktion") || hasRole("IT");
}

function canManagePersonnelFiles() {
  return canAccess("actions", "personnelFiles", "Direktion");
}

function canApprovePersonnelSanctions() {
  if (hasRole("Direktion")) return true;
  const hr = (state.departments || []).find(isHumanResourcesDepartmentSheet);
  return departmentActionAllowed(hr, "departmentLeadership");
}

function canSeeInternalFileReasons() {
  return state.currentUser?.role === "Direktion";
}

function canCreateCustomSanctions() {
  if (hasRole("Direktion") || hasRole("IT")) return true;
  const hr = (state.departments || []).find(isHumanResourcesDepartmentSheet);
  return departmentActionAllowed(hr, "departmentLeadership");
}

function canOverrideSanctionFineRange() {
  return canCreateCustomSanctions();
}

function sanctionApprovalQueue() {
  return (state.disciplinary || []).filter((entry) => isSanctionFileEntry(entry) && sanctionWorkflowStatus(entry) === "pending_approval");
}

function rejectedSanctionCases() {
  return (state.disciplinary || []).filter((entry) => isSanctionFileEntry(entry) && sanctionWorkflowStatus(entry) === "rejected");
}

function openSanctionCases() {
  return (state.disciplinary || []).filter((entry) => isSanctionFileEntry(entry) && sanctionWorkflowStatus(entry) === "open");
}

function canSeePersonnelOpenSanctionNotice() {
  const hr = (state.departments || []).find(isHumanResourcesDepartmentSheet);
  return Boolean(hr && departmentActionAllowed(hr, "departmentMembers"));
}

function notifyPersonnelOpenSanctions() {
  if (!canSeePersonnelOpenSanctionNotice()) return;
  const count = openSanctionCases().length;
  const rejected = rejectedSanctionCases().filter((entry) => !entry.rejectionSeenByPersonnel).length;
  if (count) {
    const key = `lspd_open_sanctions_notice_${count}`;
    if (sessionStorage.getItem(key) !== "1") {
      sessionStorage.setItem(key, "1");
      showNotify(`${count} offene Sanktionsvergabe${count === 1 ?"" : "n"} warten auf Bearbeitung.`, "info", 9000);
    }
  }
  if (rejected) {
    const key = `lspd_rejected_sanctions_notice_${rejected}`;
    if (sessionStorage.getItem(key) !== "1") {
      sessionStorage.setItem(key, "1");
      showNotify(`${rejected} Sanktionsfall${rejected === 1 ?"" : "e"} wurde${rejected === 1 ?"" : "n"} abgelehnt.`, "error", 11000);
    }
  }
}

function allowedRankOptionsForActor(user = null) {
  if (canBypassRankHierarchyClient()) return state.ranks;
  const myRank = Number(state.currentUser?.rank || 0);
  return state.ranks.filter((rank) => Number(rank.value) < myRank || (user && Number(rank.value) === Number(user.rank)));
}

function isItLead() {
  return state.currentUser?.role === "IT-Leitung";
}

function permissionAllows(rule, user = state.currentUser) {
  if (!rule) return false;
  if (hasRole("IT")) return true;
  if (user.role === "Direktion") return true;
  const departmentMatch = (rule.departments || []).some((departmentId) => {
    const department = state.departments.find((item) => item.id === departmentId);
    return department?.members?.some((member) => member.userId === user.id);
  });
  const positionMatch = (rule.positions || []).some((positionKey) => {
    const [departmentId, position] = String(positionKey).split(":");
    const department = state.departments.find((item) => item.id === departmentId);
    return department?.members?.some((member) => member.userId === user.id && member.position === position);
  });
  return Boolean(rule.all) || (rule.users || []).includes(user.id) || (rule.roles || []).includes(user.role) || (rule.ranks || []).map(Number).includes(Number(user.rank)) || departmentMatch || positionMatch;
}

function canAccess(area, key, fallbackRole = "IT") {
  if (hasRole("IT")) return true;
  const rule = state.settings?.permissions?.[area]?.[key];
  return rule ?permissionAllows(rule) : hasRole(fallbackRole);
}

function canSeeDepartment(page) {
  if (hasRole("IT")) return true;
  if (page === "IT") return hasRole("IT");
  if (state.currentUser?.role === "Direktion") return true;
  if (page === "dept:swat") return true;
  const rule = state.settings?.permissions?.pages?.[page];
  if (rule) return permissionAllows(rule);
  if (page === "Direktion") return hasRole("Direktion");
  return true;
}

function isPageItOnlyVisible(page) {
  const rule = state.settings?.permissions?.pages?.[page];
  if (!rule || rule.all) return false;
  const roles = rule.roles || [];
  const onlyItRole = roles.every((role) => ["IT", "IT-Leitung"].includes(role));
  const hasOtherSelectors = Boolean((rule.users || []).length || (rule.ranks || []).length || (rule.departments || []).length || (rule.positions || []).length);
  return onlyItRole && !hasOtherSelectors;
}

function isDepartmentPage(page) {
  return page.startsWith("dept:");
}

function departmentByPage(page) {
  return state.departments.find((department) => `dept:${department.id}` === page);
}

function fullName(user = state.currentUser) {
  return `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
}

function avatarMarkup(user = state.currentUser, size = "md") {
  if (user?.avatarUrl) {
    return `<img class="avatar ${size}" src="${escapeHtml(user.avatarUrl)}" alt="Avatar" loading="eager" decoding="async" fetchpriority="high">`;
  }
  return `<img class="avatar ${size}" src="/assets/lspd-logo-20260515.png" alt="LSPD" loading="eager" decoding="async" fetchpriority="high">`;
}

function rankLabel(rank) {
  const found = state.ranks.find((item) => Number(item.value) === Number(rank));
  const label = found ?found.label : `Template ${rank} - Rang ${rank}`;
  const clean = String(label).replace(/^\s*\(?\d+\)?\s*/, "").trim();
  return `(${Number(rank)}) ${clean || `Rang ${rank}`}`;
}

function rankOptionLabel(rank) {
  return rankLabel(rank.value);
}

function isFrakverwaltungUser(user) {
  return /frakverwaltung|frakverwalter/i.test(`${user?.role || ""} ${user?.baseRole || ""} ${rankLabel(user?.rank)}`);
}

function memberSortValue(user) {
  return isFrakverwaltungUser(user) ?-1 : Number(user?.rank || 0);
}

function sortMembersForRankList(users = []) {
  return [...users].sort((a, b) => memberSortValue(b) - memberSortValue(a) || fullName(a).localeCompare(fullName(b), "de"));
}

function navLabel(page) {
  if (isDepartmentPage(page)) return departmentByPage(page)?.name || page;
  const custom = state.customPages?.find((item) => item.key === page);
  if (custom) return state.settings?.navLabels?.[page] || custom.name || page;
  return state.settings?.navLabels?.[page] || page;
}

function pageDescription(page) {
  if (isDepartmentPage(page)) {
    const department = departmentByPage(page);
    return department ?`${department.name} - Abteilungsübersicht` : "Abteilungsübersicht und interne Notizen";
  }
  return pageDescriptions[page] || "Diese Seite kann später weiter ausgebaut werden";
}

function iconSvg(page) {
  if (isDepartmentPage(page)) page = "Direktion";
  if (page === "Mitgliederfluktation") return `<img class="asset-icon asset-icon-fluctuation" src="/fluctuation-icon.svg" alt="">`;
  const icons = {
    "Dienstblatt": '<path d="M8 4h8l2 2v14H6V4Z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
    "Innendienst": '<path d="M4 11h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8Z"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path d="M9 15h6M12 11v10"/>',
    "AktiveOfficer": '<circle cx="12" cy="7" r="3"/><path d="M6 21v-2a6 6 0 0 1 12 0v2"/><path d="M16.5 4.5 18 3l1.5 1.5M18 3v5"/>',
    "Aussendienst": '<path d="M5 17h14l-1.5-5h-11L5 17Z"/><path d="M7 17v2M17 17v2"/><circle cx="8" cy="17" r="1.5"/><circle cx="16" cy="17" r="1.5"/><path d="M9 8h6l2 4H7l2-4Z"/>',
    "Undercover": '<path d="M4 8c2-2 4.5-3 8-3s6 1 8 3"/><path d="M7 8h10l-1 4H8L7 8Z"/><path d="M8 16c2.5 1.5 5.5 1.5 8 0"/><path d="M9 12h.01M15 12h.01"/>',
    "Einsatzzentrale": '<path d="M4 12a8 8 0 0 1 16 0"/><path d="M7 12a5 5 0 0 1 10 0"/><path d="M12 12v5"/><path d="M9 17h6"/>',
    "Beschlagnahmung": '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M12 12 4.5 7.7M12 12l7.5-4.3M12 12v8.5"/>',
    "Informationen": '<circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/>',
    "Ausbilderübersicht": '<path d="M4 5h7a3 3 0 0 1 3 3v11a3 3 0 0 0-3-3H4V5Z"/><path d="M20 5h-6a3 3 0 0 0-3 3"/>',
    "Meine Lernkontrollen": '<path d="M8 3a4 4 0 0 0-4 4v1a3 3 0 0 0 0 6v1a4 4 0 0 0 4 4"/><path d="M16 3a4 4 0 0 1 4 4v1a3 3 0 0 1 0 6v1a4 4 0 0 1-4 4"/><path d="M8 12h8"/>',
    "Abteilungen": '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3h-3z"/>',
    "Mitglieder": '<path d="M16 21v-2a4 4 0 0 0-8 0v2"/><circle cx="12" cy="7" r="4"/><path d="M20 21v-2a3 3 0 0 0-2-2.8M4 21v-2a3 3 0 0 1 2-2.8"/>',
    "Mitgliederfluktation": '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
    "Postfach": '<path d="M4 5h16v12H7l-3 3V5Z"/>',
    "Profil": '<circle cx="12" cy="8" r="4"/><path d="M6 21a6 6 0 0 1 12 0"/>',
    "Kalender": '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M16 3v4M8 3v4M4 10h16"/>',
    "Settings": '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-2 3.4-.2-.1a1.8 1.8 0 0 0-2 .4l-.2.2-3.8-2.2.1-.3a1.8 1.8 0 0 0-.8-1.8 1.8 1.8 0 0 0-2 .1l-.3.2-3.3-2 .1-.3a1.8 1.8 0 0 0-.4-2l-.2-.2 2-3.4.3.1a1.8 1.8 0 0 0 2-.4l.2-.2 3.8 2.2-.1.3a1.8 1.8 0 0 0 .8 1.8 1.8 1.8 0 0 0 2-.1l.3-.2 3.3 2Z"/>',
    "ChevronUp": '<path d="m18 15-6-6-6 6"/>',
    "ChevronDown": '<path d="m6 9 6 6 6-6"/>',
    "Plus": '<path d="M12 5v14M5 12h14"/>',
    "Lock": '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    "Discord": '<path d="M8 8.5c2.7-1 5.3-1 8 0"/><path d="M7.5 16.5c3 1.3 6 1.3 9 0"/><path d="M8 8.5c-1.2 2-1.7 4.5-1.3 7.5 1.6 1.2 3.4 1.9 5.3 2 1.9-.1 3.7-.8 5.3-2 .4-3-.1-5.5-1.3-7.5"/><circle cx="10" cy="13" r="1"/><circle cx="14" cy="13" r="1"/>',
    "EyeOff": '<path d="M3 3l18 18"/><path d="M10.6 10.6A2 2 0 0 0 13.4 13.4"/><path d="M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 8.5 4.4 9.7 6.1a1.6 1.6 0 0 1 0 1.8 16.5 16.5 0 0 1-2.5 2.9"/><path d="M6.2 6.2A16.8 16.8 0 0 0 2.3 11.1a1.6 1.6 0 0 0 0 1.8C3.5 14.6 7 19 12 19a9.7 9.7 0 0 0 4-.8"/>',
    "Direktion": '<path d="M12 3 20 7v6c0 5-3.5 7.5-8 8-4.5-.5-8-3-8-8V7l8-4Z"/><path d="M9 12l2 2 4-4"/>',
    "Anweisung": '<path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z"/><path d="M12 8v5"/><path d="M12 16h.01"/>',
    "Info": '<circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/>',
    "IT-Info": '<path d="M8 18h8M10 22h4"/><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 9h8M8 13h5"/>',
    "IT": '<path d="M8 18h8M10 22h4"/><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 9h8M8 13h5"/>',
    "Changelog": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
    "Logout": '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[page] || icons.Dienstblatt}</svg>`;
}

function actionIcon(type) {
  const src = type === "delete" ?"/loeschen.png" : "/bearbeiten.png";
  return `<img class="asset-action-icon" src="${src}" alt="" draggable="false">`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("de-DE");
}

function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value) {
  if (!value) return "-";
  return `${formatDate(value)} ${formatTime(value)}`;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("de-DE")} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

function isoDateLocal(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDaysIso(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return isoDateLocal(date);
}

function absenceIsActive(absence) {
  const today = isoDateLocal(new Date());
  return Boolean(absence && !absence.endedAt && absence.startDate <= today && absence.endDate >= today);
}

function absenceStatusLabel(absence) {
  if (absence.endedAt) return "Zurückgezogen";
  if (absenceIsActive(absence)) return "Aktiv";
  if (absence.startDate > isoDateLocal(new Date())) return "Geplant";
  return "Inaktiv";
}

function activeAbsenceForUser(userId) {
  return (state.absences || []).find((absence) => absence.userId === userId && absenceIsActive(absence));
}

function currentUserInHumanResources() {
  const hr = (state.departments || []).find((department) => department.id === "human-resources" || /personalabteilung|human resources/i.test(department.name || ""));
  return Boolean(hr?.members?.some((member) => member.userId === state.currentUser?.id));
}

function canSeeAbsenceForUser(user) {
  if (!user) return false;
  return user.id === state.currentUser?.id || hasRole("Direktion") || currentUserInHumanResources();
}

function userAbsenceBadge(user, mode = "label") {
  if (!canSeeAbsenceForUser(user)) return "";
  const absence = activeAbsenceForUser(user?.id);
  if (!absence) return "";
  const text = `Abmeldung bis ${formatDate(absence.endDate)}`;
  if (mode === "button") return `<button class="absence-mini-pill view-user-absence" type="button" data-absence-id="${escapeHtml(absence.id)}">${escapeHtml(text)}</button>`;
  return `<span class="absence-mini-pill">${escapeHtml(text)}</span>`;
}

function monthName(date) {
  return date.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}

function calendarDayTitle(value) {
  if (!value) return "-";
  return new Date(`${value}T00:00`).toLocaleDateString("de-DE", { day: "numeric", month: "long" });
}

function durationMs(entry) {
  const start = new Date(entry.startedAt).getTime();
  const end = entry.endedAt ?new Date(entry.endedAt).getTime() : Date.now();
  return Math.max(0, end - start);
}

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${String(rest).padStart(2, "0")}m`;
}

function wrapNameForTable(name) {
  return escapeHtml(name).replace(/-/g, "-<wbr>");
}

function rangeStart(range) {
  const now = new Date();
  if (range === "Woche") {
    const week = new Date(now);
    week.setDate(now.getDate() - 7);
    return week;
  }
  if (range === "Monat") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (range === "Heute") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return null;
}

function roleClass(role) {
  return `role-${String(role || "User").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function roleBadges(user) {
  const baseRole = user?.baseRole || (["IT", "IT-Leitung"].includes(user?.role) ?"Direktion" : user?.role || "User");
  const roles = user?.role === "IT-Leitung" ?[baseRole, "IT", "IT-Leitung"] : user?.role === "IT" ?[baseRole, "IT"] : [baseRole];
  if (user?.teamler) roles.push("Teamler");
  return roles.map((role) => `<span class="role-pill ${roleClass(role)}">${escapeHtml(role)}</span>`).join("");
}

function cleanText(value) {
  let text = String(value ?? "");
  const decodeOnce = (input) => {
    if (!/[\u00c3\u00c2]/.test(input)) return input;
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
  return text
    .replaceAll("\u00c3\u201a\u00c2\u00b7", "·")
    .replaceAll("\u00c2", "")
    .replaceAll("Verk\u003frzung", "Verkürzung")
    .replaceAll("\u003fbersicht", "Übersicht")
    .replaceAll("\u003fber", "Über")
    .replaceAll("\u003fndern", "Ändern")
    .replaceAll("\u003fnderung", "Änderung")
    .replaceAll("\u003fnderungen", "Änderungen");
}

function describeLogDetails(log) {
  const details = log.details || {};
  const action = cleanText(log.action);
  if (details.description) return cleanText(details.description);
  if (action === "Avatar ge\u00e4ndert") return "Avatar wurde ge\u00e4ndert.";
  if (action === "Passwort ge\u00e4ndert") return "Passwort wurde ge\u00e4ndert.";
  if (action === "Login") return "Angemeldet.";
  if (action === "Logout") return "Abgemeldet.";
  if (action.includes("Aktennotiz")) return `Notiz ${action.includes("bearbeitet") ?"bearbeitet" : action.includes("entfernt") ?"entfernt" : "hinzugef\u00fcgt"}${details.reason ?`: ${cleanText(details.reason)}` : ""}`;
  if (action.includes("Sanktion")) return `Sanktion ${action.includes("archiviert") ?"archiviert" : "hinzugef\u00fcgt"}${details.reason ?`: ${cleanText(details.reason)}` : ""}${details.amount ?` \u00b7 ${details.amount}$` : ""}`;
  if (action.includes("Geldstrafe")) return `Geldstrafe ${action.includes("bezahlt") ?"als bezahlt markiert" : "bearbeitet"}.`;
  if (action.includes("Uprank")) return details.reason ?`Uprank: ${cleanText(details.reason)}` : "Uprank wurde dokumentiert.";
  if (details.before && details.after) {
    const changeText = describeObjectChanges(details.before, details.after);
    if (changeText) return changeText;
  }
  if (details.reason) return `Grund: ${cleanText(details.reason)}`;
  if (action.includes("Dienst gestartet")) return `In Dienst: ${cleanText(log.target)}`;
  if (action.includes("Dienst beendet")) return `Au\u00dfer Dienst: ${cleanText(details.before?.status || log.target || "")}`;
  if (action.includes("erstellt")) return "Eintrag wurde erstellt.";
  if (action.includes("gel\u00f6scht")) return "Eintrag wurde gel\u00f6scht.";
  if (action.includes("bearbeitet") || action.includes("ge\u00e4ndert")) return "Eintrag wurde ge\u00e4ndert.";
  return "";
}
function renderLogDetails(log) {
  const text = cleanText(describeLogDetails(log));
  if (!text) return `<span class="muted">-</span>`;
  const parts = text.split(";").map((part) => part.trim()).filter(Boolean);
  return `<div class="log-detail-text">${parts.map((part) => renderLogDetailPart(cleanText(part))).join("<span class=\"log-detail-separator\">;</span> ")} </div>`;
}

function renderLogDetailPart(part) {
  const match = part.match(/^(Ausbildung)\s+(.+?)\s+(hinzugef\u00fcgt|entfernt)$/i);
  if (match) {
    const tone = match[3] === "entfernt" ?"bad" : "good";
    return `${escapeHtml(match[1])} <strong>${escapeHtml(match[2].toUpperCase())}</strong> <mark class="${tone}">${escapeHtml(match[3])}</mark>`;
  }
  const changeMatch = part.match(/^([^:]+):\s*(.*?)\s*->\s*(.*)$/);
  if (changeMatch) {
    return `<strong>${escapeHtml(changeMatch[1])}</strong>: ${escapeHtml(changeMatch[2] || "-")} <span class="log-arrow">\u2192</span> ${escapeHtml(changeMatch[3] || "-")}`;
  }
  const actionMatch = part.match(/(hinzugef\u00fcgt|entfernt|bearbeitet|erstellt|gel\u00f6scht|bezahlt|Uprank|gesperrt|entlassen)/i);
  if (!actionMatch) return escapeHtml(part);
  const before = part.slice(0, actionMatch.index);
  const action = actionMatch[0];
  const after = part.slice(actionMatch.index + action.length);
  const tone = /entfernt|gel\u00f6scht|gesperrt|entlassen/i.test(action) ?"bad" : /hinzugef\u00fcgt|erstellt|bezahlt|Uprank/i.test(action) ?"good" : "neutral";
  return `${escapeHtml(before)}<mark class="${tone}">${escapeHtml(action)}</mark>${escapeHtml(after)}`;
}
function describeObjectChanges(before = {}, after = {}) {
  const changes = [];
  const fields = [
    ["firstName", "Vorname"],
    ["lastName", "Nachname"],
    ["phone", "Telefon"],
    ["dn", "Dienstnummer"],
    ["role", "Rolle"],
    ["title", "Titel"],
    ["priority", "Priorität"],
    ["text", "Text"],
    ["reason", "Grund"],
    ["status", "Status"]
  ];
  fields.forEach(([key, label]) => {
    const oldValue = String(before?.[key] ?? "");
    const newValue = String(after?.[key] ?? "");
    if (oldValue !== newValue) changes.push(`${label}: ${oldValue || "-"} -> ${newValue || "-"}`);
  });
  if ((before?.rank !== undefined || after?.rank !== undefined) && Number(before?.rank) !== Number(after?.rank)) {
    changes.push(`Rang: ${rankLabel(before?.rank)} -> ${rankLabel(after?.rank)}`);
  }
  trainings.forEach((training) => {
    const had = Boolean(before?.trainings?.[training]);
    const has = Boolean(after?.trainings?.[training]);
    if (had !== has) changes.push(`Ausbildung ${cleanText(training)} ${has ?"hinzugef\u00fcgt" : "entfernt"}`);
  });
  return changes.join("; ");
}

function logTone(action) {
  action = cleanText(action);
  if (/hinzugefügt|Uprank/i.test(action)) return "log-good";
  if (/erstellt|gestartet|hinzugefügt|Login|eingestellt/i.test(action)) return "log-good";
  if (/gelöscht|entlassen|gesperrt|beendet|Logout|Kündigung/i.test(action)) return "log-bad";
  if (/geändert|bearbeitet|aktualisiert/i.test(action)) return "log-warn";
  return "";
}

function escapeHtml(value) {
  return cleanText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizePublicUrl(value, fallback = PUBLIC_BASE_URL) {
  const raw = String(value || "").trim();
  const candidate = /^https:\/\/(fib|lspd)\.vdm67\.de\/?$/i.test(raw) ?PUBLIC_BASE_URL : raw;
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

function normalizeDiscordRedirectUrl(value, fallback = `${PUBLIC_BASE_URL}api/discord/callback`) {
  const raw = String(value || "").trim();
  const candidate = /^https:\/\/(fib|lspd)\.vdm67\.de\/?$/i.test(raw) ?fallback : raw;
  try {
    const url = new URL(candidate || fallback);
    url.hash = "";
    url.search = "";
    if (url.pathname === "/" || !url.pathname) url.pathname = "/api/discord/callback";
    return url.toString();
  } catch {
    return fallback;
  }
}

async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const shouldNotify = !options.silent && method !== "GET";
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ?{ Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error || "Aktion fehlgeschlagen.";
    if (response.status === 401 && state.token && !path.includes("/api/login") && !path.includes("/api/logout")) {
      handleAccessRevoked(message);
    }
    if (shouldNotify) showNotify(message, "error");
    const error = new Error(message);
    error.status = response.status;
    Object.assign(error, data);
    throw error;
  }
  if (shouldNotify) showNotify(successMessage(path, method), "success");
  return data;
}

async function startDiscordOAuth(mode = "login") {
  const targetError = $("#loginError");
  const button = mode === "login" ?$("#discordLoginBtn") : null;
  try {
    if (button) {
      button.disabled = true;
      button.classList.add("loading");
      button.textContent = "Weiter zu Discord...";
    }
    const config = await api("/api/discord/oauth-config", { silent: true });
    if (!config.applicationId) throw new Error("Discord Login ist noch nicht eingerichtet.");
    if (Object.prototype.hasOwnProperty.call(config, "clientSecretSet") && !config.clientSecretSet) {
      throw new Error("Discord OAuth ist noch nicht vollstaendig eingerichtet. Client Secret fehlt.");
    }
    const oauthState = crypto.randomUUID ?crypto.randomUUID() : String(Date.now());
    sessionStorage.setItem("lspd_discord_oauth_state", JSON.stringify({ state: oauthState, mode }));
    const redirectUri = normalizeDiscordRedirectUrl(config.oauthRedirectUrl || `${window.location.origin}/api/discord/callback`);
    const params = new URLSearchParams({
      client_id: config.applicationId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "identify",
      state: oauthState,
      prompt: "consent"
    });
    window.location.href = `https://discord.com/oauth2/authorize?${params.toString()}`;
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.classList.remove("loading");
      button.textContent = "Mit Discord einloggen";
    }
    if (targetError) targetError.textContent = error.message;
    else showNotify(error.message, "error");
  }
}

async function completeDiscordOAuth(accessToken, mode) {
  if (mode === "link" || state.token) {
    if (!state.token) {
      sessionStorage.setItem(DISCORD_PENDING_TOKEN_KEY, accessToken);
      showLogin();
      $("#loginError").textContent = "Discord erkannt. Bitte melde dich zuerst normal an. Nach dem Passwortwechsel kannst du Discord im Profil verknüpfen.";
      return;
    }
    const data = await api("/api/discord/link", { method: "POST", body: JSON.stringify({ accessToken }) });
    state.currentUser = data.user || state.currentUser;
    await bootstrap();
    showNotify("Synchronisation erfolgreich.", "success");
    return;
  }
  try {
    const data = await api("/api/discord/login", { method: "POST", body: JSON.stringify({ accessToken }) });
    state.token = data.token;
    storeAuthToken(state.token);
    await bootstrap();
  } catch (error) {
    sessionStorage.setItem(DISCORD_PENDING_TOKEN_KEY, accessToken);
    showLogin();
    $("#loginError").textContent = "Discord ist noch nicht verknüpft. Melde dich zuerst normal an und verknüpfe Discord danach im Profil.";
  }
}

async function completeDiscordCallbackTicket(ticket, mode) {
  try {
    const data = await api("/api/discord/callback-ticket", { method: "POST", body: JSON.stringify({ ticket, mode }), silent: true });
    if (mode === "link" || state.token) {
      state.currentUser = data.user || state.currentUser;
      await bootstrap();
      showNotify("Synchronisation erfolgreich.", "success");
      return;
    }
    state.token = data.token;
    storeAuthToken(state.token);
    await bootstrap();
  } catch (error) {
    if (error.pendingTicket) sessionStorage.setItem(DISCORD_PENDING_TOKEN_KEY, error.pendingTicket);
    showLogin();
    $("#loginError").textContent = mode === "link" || state.token
      ?"Discord erkannt. Bitte melde dich zuerst normal an. Nach dem Passwortwechsel kannst du Discord im Profil verknüpfen."
      : "Discord ist noch nicht verknüpft. Melde dich zuerst normal an und verknüpfe Discord danach im Profil.";
  }
}

function consumeDiscordLinkRequest() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("discord") !== "link") return false;
  params.delete("discord");
  const nextQuery = params.toString();
  window.history.replaceState(null, document.title, `${window.location.pathname}${nextQuery ?`?${nextQuery}` : ""}${window.location.hash}`);
  sessionStorage.setItem(DISCORD_LINK_AFTER_LOGIN_KEY, "1");
  return true;
}

async function handleDiscordOAuthRedirect() {
  const queryParams = new URLSearchParams(window.location.search);
  if (queryParams.has("discord_error")) {
    const message = queryParams.get("discord_error") || "Discord Login fehlgeschlagen.";
    const returnedState = queryParams.get("state") || "";
    const stored = JSON.parse(sessionStorage.getItem("lspd_discord_oauth_state") || "{}");
    queryParams.delete("discord_error");
    queryParams.delete("state");
    const nextQuery = queryParams.toString();
    window.history.replaceState(null, document.title, `${window.location.pathname}${nextQuery ?`?${nextQuery}` : ""}`);
    if (stored.mode === "link" && storedAuthToken() && (!returnedState || returnedState === stored.state)) {
      sessionStorage.removeItem("lspd_discord_oauth_state");
      state.token = storedAuthToken();
      try {
        await bootstrap();
        state.page = "Profil";
        state.profileTab = "Ausbildung";
        localStorage.setItem("lspd_page", state.page);
        localStorage.setItem("lspd_profile_tab", state.profileTab);
        updateAppUrl({ replace: true });
        renderApp();
        showNotify(`Discord Verknuepfung fehlgeschlagen: ${message}`, "error");
        return true;
      } catch {}
    }
    showLogin();
    $("#loginError").textContent = message;
    return true;
  }
  if (queryParams.get("discord_oauth") === "1") {
    const ticket = queryParams.get("ticket") || "";
    const returnedState = queryParams.get("state") || "";
    const stored = JSON.parse(sessionStorage.getItem("lspd_discord_oauth_state") || "{}");
    queryParams.delete("discord_oauth");
    queryParams.delete("ticket");
    queryParams.delete("state");
    const nextQuery = queryParams.toString();
    window.history.replaceState(null, document.title, `${window.location.pathname}${nextQuery ?`?${nextQuery}` : ""}`);
    if (!ticket || !stored.state || returnedState !== stored.state) {
      showLogin();
      $("#loginError").textContent = "Discord Login konnte nicht geprüft werden.";
      return true;
    }
    sessionStorage.removeItem("lspd_discord_oauth_state");
    await completeDiscordCallbackTicket(ticket, stored.mode || "login");
    return true;
  }
  if (!window.location.hash.includes("access_token=")) return false;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get("access_token") || "";
  const returnedState = params.get("state") || "";
  const stored = JSON.parse(sessionStorage.getItem("lspd_discord_oauth_state") || "{}");
  window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  if (!accessToken || !stored.state || returnedState !== stored.state) {
    showLogin();
    $("#loginError").textContent = "Discord Login konnte nicht geprüft werden.";
    return true;
  }
  sessionStorage.removeItem("lspd_discord_oauth_state");
  await completeDiscordOAuth(accessToken, stored.mode || "login");
  return true;
}

async function linkPendingDiscordAccount() {
  const pendingTicket = sessionStorage.getItem(DISCORD_PENDING_TOKEN_KEY);
  if (!pendingTicket || !state.token) return false;
  if (state.currentUser?.mustChangePassword) return false;
  try {
    const isCallbackTicket = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pendingTicket);
    const data = isCallbackTicket
      ?await api("/api/discord/callback-ticket", { method: "POST", body: JSON.stringify({ ticket: pendingTicket, mode: "link" }) })
      : await api("/api/discord/link", { method: "POST", body: JSON.stringify({ accessToken: pendingTicket }) });
    sessionStorage.removeItem(DISCORD_PENDING_TOKEN_KEY);
    state.currentUser = data.user || state.currentUser;
    showNotify("Synchronisation erfolgreich.", "success");
    return true;
  } catch (error) {
    $("#loginError").textContent = error.message;
    return false;
  }
}

async function startQueuedDiscordLink() {
  if (sessionStorage.getItem(DISCORD_LINK_AFTER_LOGIN_KEY) !== "1") return false;
  if (!state.token || state.currentUser?.mustChangePassword || state.currentUser?.discordId) return false;
  sessionStorage.removeItem(DISCORD_LINK_AFTER_LOGIN_KEY);
  await startDiscordOAuth("link");
  return true;
}

function successMessage(path, method) {
  if (path.includes("/login")) return "Erfolgreich angemeldet.";
  if (path.includes("/logout")) return "Erfolgreich abgemeldet.";
  if (path.includes("/duty/start")) return "Dienst gestartet.";
  if (path.includes("/duty/stop-all")) return "Alle Officer wurden ausgetragen.";
  if (path.includes("/duty/stop")) return "Dienst beendet.";
  if (path.includes("/notes") && method === "POST") return "Notiz erstellt.";
  if (path.includes("/notes") && method === "PATCH") return "Notiz aktualisiert.";
  if (path.includes("/notes") && method === "DELETE") return "Notiz gelöscht.";
  if (path.includes("/departments") && path.includes("/members") && method === "POST") return "Person hinzugefügt.";
  if (path.includes("/departments") && path.includes("/members") && method === "PATCH") return "Position aktualisiert.";
  if (path.includes("/departments") && path.includes("/members") && method === "DELETE") return "Person entfernt.";
  if (path.includes("/departments") && path.includes("/info")) return "Abteilungsinfos gespeichert.";
  if (path.includes("/settings/defcon")) return "DEFCON aktualisiert.";
  if (path.includes("/it/defcon-card")) return "DEFCON Kachel gespeichert.";
  if (path.includes("/profile/password")) return "Passwort geändert.";
  if (path.includes("/profile/tutorial")) return "";
  if (path.includes("/profile/changelog-read")) return "Changelog gelesen.";
  if (path.includes("/onboarding-tutorial")) return "Tutorial gespeichert.";
  if (path.includes("/profile/avatar")) return "Avatar gespeichert.";
  if (path.includes("/profile/twitch")) return "Twitch gespeichert.";
  if (path.includes("/file")) return method === "DELETE" ?"Akteneintrag entfernt." : "Akteneintrag gespeichert.";
  if (path.includes("/seizures") && method === "POST") return "Beschlagnahmung eingetragen.";
  if (path.includes("/seizures") && method === "PATCH") return "Beschlagnahmung gespeichert.";
  if (path.includes("/seizures") && method === "DELETE") return "Beschlagnahmung gelöscht.";
  if (path.includes("/mailbox/threads") && method === "POST") return path.includes("/messages") ?"Nachricht gesendet." : "Chat erstellt.";
  if (path.includes("/changelog") && method === "POST") return "Changelog erstellt.";
  if (path.includes("/changelog") && method === "PATCH") return "Changelog gespeichert.";
  if (path.includes("/changelog") && method === "DELETE") return "Changelog gelöscht.";
  if (path.includes("/settings/fluctuation") && method === "PATCH") return "Fluktuationseintrag gespeichert.";
  if (path.includes("/settings/fluctuation") && method === "DELETE") return "Fluktuationseintrag gelöscht.";
  if (path.includes("/uprank-adjustments") && method === "POST") return "Uprank-Vormerkung gespeichert.";
  if (path.includes("/uprank-adjustments") && method === "DELETE") return "Uprank-Vormerkung entfernt.";
  if (path.includes("/uprank-block")) return "Uprank-Sperre gespeichert.";
  if (path.includes("/uprank") && method === "POST") return "Beförderung gespeichert.";
  if (path.includes("/suspend")) return "Mitglied suspendiert.";
  if (path.includes("/dismiss")) return "Mitglied entlassen.";
  if (path.includes("/users") && method === "POST") return "Mitglied eingestellt.";
  if (path.includes("/users") && method === "PATCH") return "Account aktualisiert.";
  if (path.includes("/users") && method === "DELETE") return "Account gelöscht.";
  if (path.includes("/it/ranks")) return "Ränge gespeichert.";
  if (path.includes("/it/nav-labels")) return "Reiter gespeichert.";
  if (path.includes("/it/permissions")) return "Rechte gespeichert.";
  if (path.includes("/it/default-password")) return "Standardpasswort gespeichert.";
  if (path.includes("/reset-password")) return "Passwort zurückgesetzt.";
  if (path.includes("/information")) return "Informationen gespeichert.";
  return "Aktion erfolgreich.";
}

function showNotify(message, type = "success", options = {}) {
  if (type === "success" && /(gelöscht|löschen|entfernt|entfernen|abgelehnt|fehlgeschlagen|fehler)/i.test(cleanText(message))) {
    type = /(fehlgeschlagen|fehler)/i.test(cleanText(message)) ?"error" : "danger";
  }
  const duration = Number(options.duration || 0) || Math.min(5000, Math.max(3000, 2200 + String(message).length * 35));
  const item = document.createElement("div");
  item.className = `notify ${type} ${options.className || ""}`.trim();
  item.style.setProperty("--notify-duration", `${duration}ms`);
  const title = options.title || (type === "success" ?"Erfolg" : type === "danger" ?"Gelöscht" : type === "info" ?"Hinweis" : "Fehler");
  item.innerHTML = `
    <div class="notify-icon">${type === "success" ?"✓" : type === "danger" ?"×" : "!"}</div>
    <button class="notify-close" type="button" aria-label="Benachrichtigung schliessen">&times;</button>
    <div class="notify-copy">
      <strong>${escapeHtml(title)}</strong>
      ${Array.isArray(options.lines) && options.lines.length
        ?`<div class="notify-lines">${options.lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</div>`
        :`<span>${escapeHtml(message)}</span>`}
    </div>
    <div class="notify-progress"></div>
  `;
  let remaining = duration;
  let startedAt = 0;
  let closeTimer = null;
  let removeTimer = null;
  let closed = false;
  const clearTimers = () => {
    window.clearTimeout(closeTimer);
    window.clearTimeout(removeTimer);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimers();
    item.classList.remove("paused");
    item.classList.add("leaving");
    removeTimer = window.setTimeout(() => item.remove(), 280);
  };
  const armTimer = () => {
    startedAt = performance.now();
    closeTimer = window.setTimeout(close, Math.max(120, remaining));
  };
  item.addEventListener("mouseenter", () => {
    if (closed) return;
    window.clearTimeout(closeTimer);
    remaining = Math.max(120, remaining - (performance.now() - startedAt));
    item.classList.add("paused");
  });
  item.addEventListener("mouseleave", () => {
    if (closed) return;
    item.classList.remove("paused");
    armTimer();
  });
  item.addEventListener("click", (event) => {
    if (event.target.closest(".notify-close")) return;
    close();
  });
  item.querySelector(".notify-close")?.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });
  notifyRoot.appendChild(item);
  armTimer();
}

async function bootstrap() {
  const previousUnread = mailboxUnreadInitialized ?lastMailboxUnreadCount : mailboxUnreadCount();
  const data = await api("/api/bootstrap");
  Object.assign(state, data);
  applyUrlState({ persist: true });
  markClientRefreshRevisionSeen(data.clientRefreshRevision);
  const nextUnread = mailboxUnreadCount();
  if (mailboxUnreadInitialized && nextUnread > previousUnread && !isViewingUnreadMailboxChat()) playMailboxPing();
  warmAvatarCache();
  syncDevModeAuthStorage();
  const visiblePages = getVisiblePages();
  if (!visiblePages.includes(state.page)) {
    state.page = "Dienstblatt";
    localStorage.setItem("lspd_page", state.page);
    updateAppUrl({ replace: true });
  }
  renderApp();
  handleSwatCallNotifications();
  promptSwatAlertPermission();
  startLiveReloadWatcher();
  startSwatStatusWatcher();
  startGibsonColaWatcher();
  startActivityWatchers();
  lastMailboxUnreadCount = nextUnread;
  mailboxUnreadInitialized = true;
}

function updateDepartmentState(updatedDepartment) {
  if (!updatedDepartment?.id) return null;
  if (pendingDepartmentNoteDeletes.size) {
    updatedDepartment = {
      ...updatedDepartment,
      notes: (updatedDepartment.notes || []).filter((note) => !pendingDepartmentNoteDeletes.has(note.id)),
      memberNotes: (updatedDepartment.memberNotes || []).filter((note) => !pendingDepartmentNoteDeletes.has(note.id))
    };
  }
  state.departments = (state.departments || []).map((department) => (
    department.id === updatedDepartment.id ?updatedDepartment : department
  ));
  return state.departments.find((department) => department.id === updatedDepartment.id) || updatedDepartment;
}

function isSwatDepartment(department) {
  return String(department?.id || "").toLowerCase() === "swat";
}

function normalizeSwatTeam(value, fallback = "") {
  const team = String(value || "").trim().toUpperCase().replace(/^TEAM\s+/, "");
  return SWAT_TEAMS.includes(team) ?team : fallback;
}

function swatTeamLabel(team) {
  const resolved = normalizeSwatTeam(team);
  return resolved ?`Team ${resolved}` : "Kein Team";
}

function mySwatMembership(department) {
  if (!isSwatDepartment(department)) return null;
  return (department.members || []).find((member) => member.userId === state.currentUser?.id) || null;
}

function isSwatTeamLeaderMember(member) {
  return Boolean(member?.swatTeamLeader || member?.position === "Abteilungsleiter");
}

function canViewSwatTeam(team, department) {
  if (!isSwatDepartment(department)) return true;
  const resolved = normalizeSwatTeam(team);
  if (hasRole("Direktion")) return true;
  const myTeam = normalizeSwatTeam(mySwatMembership(department)?.swatTeam);
  if (!resolved || team === "all") return Boolean(myTeam);
  return myTeam === resolved;
}

function canReceiveSwatCallAlert(team, department) {
  if (!isSwatDepartment(department)) return false;
  if (!isCurrentUserOnDuty()) return false;
  const calledTeam = normalizeSwatTeam(team);
  if (!calledTeam) return false;
  return normalizeSwatTeam(mySwatMembership(department)?.swatTeam) === calledTeam;
}

function isCurrentUserOnDuty() {
  return Boolean(state.duty?.some((entry) => entry.userId === state.currentUser?.id));
}

function playSwatCallSound() {
  try {
    swatAudioContext = swatAudioContext || new (window.AudioContext || window.webkitAudioContext)();
    swatAudioContext.resume?.();
    const now = swatAudioContext.currentTime;
    const duration = 4.6;
    const toneLength = 0.46;
    const master = swatAudioContext.createGain();
    const lowGain = swatAudioContext.createGain();
    const highGain = swatAudioContext.createGain();
    const filter = swatAudioContext.createBiquadFilter();
    const compressor = swatAudioContext.createDynamicsCompressor();
    const oscillators = [
      { frequency: 410, type: "square", gain: lowGain, level: 0.12 },
      { frequency: 820, type: "triangle", gain: lowGain, level: 0.035 },
      { frequency: 547, type: "square", gain: highGain, level: 0.12 },
      { frequency: 1094, type: "triangle", gain: highGain, level: 0.035 }
    ].map((config) => {
      const oscillator = swatAudioContext.createOscillator();
      const oscillatorGain = swatAudioContext.createGain();
      oscillator.type = config.type;
      oscillator.frequency.setValueAtTime(config.frequency, now);
      oscillatorGain.gain.setValueAtTime(config.level, now);
      oscillator.connect(oscillatorGain);
      oscillatorGain.connect(config.gain);
      return oscillator;
    });
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(720, now);
    filter.Q.setValueAtTime(0.9, now);
    master.gain.setValueAtTime(0.001, now);
    master.gain.exponentialRampToValueAtTime(0.95, now + 0.08);
    master.gain.setValueAtTime(0.95, now + duration - 0.22);
    master.gain.exponentialRampToValueAtTime(0.001, now + duration);
    lowGain.gain.setValueAtTime(0.0001, now);
    highGain.gain.setValueAtTime(0.0001, now);
    for (let offset = 0; offset < duration; offset += toneLength * 2) {
      const lowStart = now + offset;
      const highStart = lowStart + toneLength;
      const nextLowStart = highStart + toneLength;
      lowGain.gain.setTargetAtTime(1, lowStart, 0.015);
      lowGain.gain.setTargetAtTime(0.0001, highStart - 0.03, 0.012);
      highGain.gain.setTargetAtTime(1, highStart, 0.015);
      highGain.gain.setTargetAtTime(0.0001, nextLowStart - 0.03, 0.012);
    }
    lowGain.connect(filter);
    highGain.connect(filter);
    filter.connect(master);
    master.connect(compressor);
    compressor.connect(swatAudioContext.destination);
    oscillators.forEach((oscillator) => {
      oscillator.start(now);
      oscillator.stop(now + duration);
    });
    window.setTimeout(() => {
      try {
        oscillators.forEach((oscillator) => oscillator.disconnect());
        lowGain.disconnect();
        highGain.disconnect();
        filter.disconnect();
        master.disconnect();
        compressor.disconnect();
      } catch {}
    }, Math.ceil(duration * 1000) + 250);
  } catch {}
}

function unlockSwatAudio() {
  if (swatAudioUnlocked) return;
  try {
    swatAudioContext = swatAudioContext || new (window.AudioContext || window.webkitAudioContext)();
    swatAudioContext.resume?.();
    swatAudioUnlocked = true;
  } catch {}
}

async function enableSwatAlerts({ test = false } = {}) {
  unlockSwatAudio();
  localStorage.setItem(SWAT_ALERT_PERMISSION_KEY, "enabled");
  if (test) {
    showNotify("Browser-Ton ist aktiviert.", "info", {
      title: "Browser-Ton bereit",
      className: "swat-call-notify",
      duration: 9000,
      lines: ["Töne wurden im Browser freigegeben.", "Wichtige Dienstblatt-Meldungen koennen jetzt mit Ton abgespielt werden."]
    });
    playSwatCallSound();
  }
}

function promptSwatAlertPermission() {
  if (!state.token || sessionStorage.getItem("lspd_swat_alert_prompted") === "1") return;
  if (localStorage.getItem(SWAT_ALERT_PERMISSION_KEY) === "enabled") return;
  sessionStorage.setItem("lspd_swat_alert_prompted", "1");
  window.setTimeout(() => {
    if (!state.token || !modalRoot?.classList.contains("hidden")) return;
    openModal(`
      <h3>Browser-Ton aktivieren</h3>
      <p class="muted">Damit wichtige Meldungen im Dienstblatt hörbar sind, muss der Browser einmalig Ton abspielen dürfen.</p>
      <p class="browser-audio-warning">Bitte Browser-Töne aktivieren bzw. zulassen. Ohne Freigabe können Alarm- und Hinweistöne nicht abgespielt werden.</p>
      <div class="modal-actions">
        <button class="orange-btn" id="enableSwatAlerts">Ton aktivieren</button>
      </div>
    `, (modal) => {
      modal.querySelector("#enableSwatAlerts")?.addEventListener("click", async () => {
        await enableSwatAlerts({ test: true });
        closeModal();
      });
    });
  }, 900);
}

function triggerSwatPageFlash() {
  document.body.classList.remove("swat-alert-flash");
  void document.body.offsetWidth;
  document.body.classList.add("swat-alert-flash");
  window.setTimeout(() => document.body.classList.remove("swat-alert-flash"), 11000);
}

function handleSwatCallNotifications() {
  const swat = state.departments.find((department) => department.id === "swat");
  if (!swat?.swatStatus) return;
  SWAT_TEAMS.forEach((team) => {
    const status = swat.swatStatus[team];
    if (!status?.active || !status.calledAt) return;
    if (!canReceiveSwatCallAlert(team, swat)) return;
    const key = `lspd_swat_call_seen_${team}`;
    if (localStorage.getItem(key) === status.calledAt) return;
    localStorage.setItem(key, status.calledAt);
    const lines = [
      "Das SWAT ist ausgerufen.",
      `Team: ${team}`,
      `Ausgerufen von: ${status.calledByName || "Unbekannt"}`,
      `Zeit: ${formatDateTime(status.calledAt)}`
    ];
    showNotify(`SWAT Team ${team} wurde ausgerufen.`, "info", {
      title: "SWAT AUSGERUFEN",
      className: "swat-call-notify",
      duration: 60000,
      lines
    });
    triggerSwatPageFlash();
    playSwatCallSound();
  });
}

async function pollSwatStatus() {
  if (swatStatusInFlight || !shouldCheckLiveReload()) return;
  swatStatusInFlight = true;
  try {
    const data = await api("/api/departments/swat/status", { silent: true });
    if (!data.department) return;
    const previous = state.departments.find((department) => department.id === "swat");
    const updatedDepartment = updateDepartmentState(data.department) || data.department;
    handleSwatCallNotifications();
    if (
      state.page === "dept:swat"
      && modalRoot?.classList.contains("hidden")
      && JSON.stringify(previous?.swatStatus || {}) !== JSON.stringify(updatedDepartment.swatStatus || {})
    ) {
      renderDepartmentPage(updatedDepartment);
    }
  } catch (error) {
    if (error.status === 401) handleAccessRevoked(error.message);
  } finally {
    swatStatusInFlight = false;
  }
}

function enableMailboxAudio() {
  mailboxAudioReady = true;
}

function playMailboxPing() {
  if (!mailboxAudioReady) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.setValueAtTime(660, context.currentTime + 0.08);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.2);
    window.setTimeout(() => context.close?.(), 260);
  } catch {}
}

function isViewingUnreadMailboxChat() {
  if (state.page !== "Postfach") return false;
  const threadId = localStorage.getItem("lspd_mailbox_thread") || "";
  const thread = (state.mailboxThreads || []).find((item) => item.id === threadId);
  return Boolean(thread?.unreadCount);
}

function changelogReadKey() {
  return `${CHANGELOG_READ_PREFIX}_${state.currentUser?.id || "guest"}`;
}

function notificationBaselineTime() {
  const timestamp = Date.parse(state.currentUser?.notificationBaselineAt || state.currentUser?.activatedAt || "");
  return Number.isFinite(timestamp) ?timestamp : 0;
}

function isAfterNotificationBaseline(value) {
  const baseline = notificationBaselineTime();
  if (!baseline) return true;
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) && timestamp >= baseline;
}

function createdChangelogEntries() {
  return (state.settings?.changelog || []).filter((entry) => entry?.id && entry?.createdAt && isAfterNotificationBaseline(entry.createdAt));
}

function readChangelogIds() {
  const ids = new Set(Array.isArray(state.currentUser?.changelogReadIds) ?state.currentUser.changelogReadIds.map(String) : []);
  try {
    const stored = JSON.parse(localStorage.getItem(changelogReadKey()) || "[]");
    if (Array.isArray(stored)) stored.map(String).forEach((id) => ids.add(id));
  } catch {
    return ids;
  }
  return ids;
}

function changelogUnreadCount() {
  const readIds = readChangelogIds();
  return createdChangelogEntries().filter((entry) => !readIds.has(String(entry.id))).length;
}

function markChangelogRead() {
  const ids = createdChangelogEntries().map((entry) => String(entry.id));
  const readIds = readChangelogIds();
  const changed = ids.some((id) => !readIds.has(id));
  if (!changed) return false;
  localStorage.setItem(changelogReadKey(), JSON.stringify(ids));
  if (state.currentUser) state.currentUser.changelogReadIds = [...new Set([...(state.currentUser.changelogReadIds || []).map(String), ...ids])];
  api("/api/profile/changelog-read", { method: "PATCH", body: JSON.stringify({ ids }), silent: true })
    .then((data) => { if (data.user) state.currentUser = data.user; })
    .catch(() => {});
  return true;
}

function shouldCheckLiveReload() {
  return Boolean(state.token)
    && $("#appView") && !$("#appView").classList.contains("hidden");
}

function hasSeenClientRefreshRevision(revision) {
  return !revision || localStorage.getItem(CLIENT_REFRESH_SEEN_KEY) === String(revision);
}

function markClientRefreshRevisionSeen(revision) {
  if (!revision) return;
  localStorage.setItem(CLIENT_REFRESH_SEEN_KEY, String(revision));
}

async function clearBrowserCachesForRefresh() {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch (error) {
    console.warn("Cache konnte nicht vollständig geleert werden", error);
  }
}

async function reloadForClientRefresh(revision) {
  markClientRefreshRevisionSeen(revision);
  await clearBrowserCachesForRefresh();
  const url = new URL(window.location.href);
  url.searchParams.set("refresh", Date.now());
  window.location.replace(`${url.pathname}${url.search}`);
}

async function refreshDienstblattIfChanged() {
  if (liveReloadInFlight || !shouldCheckLiveReload()) return;
  liveReloadInFlight = true;
  try {
    const data = await api("/api/live-revision", { silent: true });
    const nextClientRefreshRevision = String(data.clientRefreshRevision || "");
    const isNewClientRefresh = nextClientRefreshRevision
      && nextClientRefreshRevision !== String(state.clientRefreshRevision || "")
      && !hasSeenClientRefreshRevision(nextClientRefreshRevision);
    if (isNewClientRefresh) {
      if (modalRoot && !modalRoot.classList.contains("hidden")) {
        liveReloadPendingAfterModal = { type: "client-refresh", revision: nextClientRefreshRevision };
        return;
      }
      reloadForClientRefresh(nextClientRefreshRevision);
      return;
    }
    if (!data.liveRevision || data.liveRevision === state.liveRevision) {
      if (nextClientRefreshRevision) state.clientRefreshRevision = nextClientRefreshRevision;
      return;
    }
    if (nextClientRefreshRevision) {
      state.clientRefreshRevision = nextClientRefreshRevision;
      markClientRefreshRevisionSeen(nextClientRefreshRevision);
    }
    if (modalRoot && !modalRoot.classList.contains("hidden")) {
      liveReloadPendingAfterModal = { type: "bootstrap" };
      return;
    }
    await bootstrap();
  } catch (error) {
    if (error.status === 401) handleAccessRevoked(error.message);
  } finally {
    liveReloadInFlight = false;
  }
}

function startLiveReloadWatcher() {
  if (liveReloadTimer) return;
  liveReloadTimer = window.setInterval(refreshDienstblattIfChanged, LIVE_RELOAD_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshDienstblattIfChanged();
  });
}

function startSwatStatusWatcher() {
  if (swatStatusTimer) return;
  swatStatusTimer = window.setInterval(pollSwatStatus, SWAT_STATUS_POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pollSwatStatus();
  });
}

function startGibsonColaWatcher() {
  if (gibsonColaTimer) return;
  gibsonColaTimer = window.setInterval(pollGibsonColaParty, GIBSON_COLA_POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pollGibsonColaParty();
  });
}

function startCustomAnimationWatcher() {
  if (customAnimationTimer) return;
  customAnimationTimer = window.setInterval(pollCustomAnimationEvent, CUSTOM_ANIMATION_POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pollCustomAnimationEvent();
  });
}

function startActivityWatchers() {
  if (!activityPingTimer) {
    sendActivityPing();
    activityPingTimer = window.setInterval(sendActivityPing, ACTIVITY_PING_INTERVAL_MS);
  }
  if (!jumpscareTimer) {
    jumpscareTimer = window.setInterval(pollJumpscareEvent, JUMPSCARE_POLL_INTERVAL_MS);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      sendActivityPing();
      pollJumpscareEvent();
    }
  });
}

function showLogin() {
  $("#loadingView")?.classList.add("hidden");
  $("#loginView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
}

function showApp() {
  $("#loadingView")?.classList.add("hidden");
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
}

function stopLiveReloadWatcher() {
  if (liveReloadTimer) {
    window.clearInterval(liveReloadTimer);
    liveReloadTimer = null;
  }
  if (swatStatusTimer) {
    window.clearInterval(swatStatusTimer);
    swatStatusTimer = null;
  }
  if (gibsonColaTimer) {
    window.clearInterval(gibsonColaTimer);
    gibsonColaTimer = null;
  }
  if (customAnimationTimer) {
    window.clearInterval(customAnimationTimer);
    customAnimationTimer = null;
  }
  if (activityPingTimer) {
    window.clearInterval(activityPingTimer);
    activityPingTimer = null;
  }
  if (jumpscareTimer) {
    window.clearInterval(jumpscareTimer);
    jumpscareTimer = null;
  }
}

function handleAccessRevoked(message = "Dein Zugriff wurde entzogen.") {
  clearAuthToken();
  state.token = null;
  stopLiveReloadWatcher();
  showApp();
  $(".profile-card").innerHTML = `
    <img class="avatar lg" src="/assets/lspd-logo-20260515.png" alt="LSPD">
    <div class="profile-copy">
      <strong>Zugriff entzogen</strong>
      <span>Keine aktiven Rechte</span>
      <em class="off">Gesperrte Ansicht</em>
    </div>
  `;
  $("#navigation").innerHTML = "";
  $("#pageTitle").textContent = "Zugriff entzogen";
  $("#rankLine").textContent = "Sitzung beendet";
  const description = $("#pageDescription");
  if (description) description.textContent = "Deine Berechtigungen wurden geaendert oder dein Account wurde gesperrt.";
  $("#serviceStatus").textContent = "Kein Zugriff";
  $("#serviceStatus").className = "service-pill off";
  $("#headerIcon").innerHTML = iconSvg("Lock");
  $("#headerIcon").classList.remove("hidden");
  content.innerHTML = `
    <section class="force-password-stage">
      <div class="force-password-brand">
        <img src="/assets/lspd-logo-20260515.png" alt="LSPD">
        <span>LSPD Dienstblatt</span>
      </div>
      <div class="panel force-password-panel">
        <span class="login-kicker">Sitzung beendet</span>
        <h3>Keine Berechtigung mehr</h3>
        <p class="muted">${escapeHtml(message || "Dein Zugriff wurde entzogen. Bitte lade die Seite neu oder melde dich erneut an, falls dein Account wieder freigegeben wurde.")}</p>
        <button class="orange-btn" id="revokedReload" type="button">Seite neu laden</button>
      </div>
    </section>
  `;
  $("#revokedReload")?.addEventListener("click", () => window.location.reload());
}

function renderApp() {
  showApp();
  if (state.currentUser?.mustChangePassword) {
    renderPasswordChangeRequired();
    return;
  }
  if (state.currentUser && state.currentUser.tutorialCompleted === false) {
    renderOnboardingTutorial();
    return;
  }
  if (state.settings?.discordSync?.applicationId && !state.currentUser?.discordId && state.page !== "Profil" && localStorage.getItem(DISCORD_JOIN_ACK_KEY) !== "1") {
    renderDiscordLinkRequired();
    return;
  }
  renderNavigation();
  renderTopbar();
  renderDevModeBanner();
  renderMaintenanceBanner();
  if (!requestedPageFromUrl()) updateAppUrl({ replace: true });
  renderPage();
  refreshEllipsisTooltipTargets();
  handleDeepLinkAfterRender();
  notifyPersonnelOpenSanctions();
}

function ellipsisTooltipText(element) {
  return String(element?.dataset?.fullText || element?.getAttribute("aria-label") || element?.textContent || "").replace(/\s+/g, " ").trim();
}

function isEllipsisTooltipTarget(element) {
  if (!element || element.nodeType !== 1 || element.closest(".custom-ellipsis-tooltip")) return false;
  if (element.closest("#navigation, .navigation")) return false;
  const text = ellipsisTooltipText(element);
  if (text.length < 4) return false;
  const style = window.getComputedStyle(element);
  const clipsText = style.textOverflow === "ellipsis" || (style.whiteSpace === "nowrap" && ["hidden", "clip"].includes(style.overflowX));
  if (!clipsText && !element.dataset.fullText) return false;
  return element.scrollWidth > element.clientWidth + 1 || Boolean(element.dataset.fullText);
}

function refreshEllipsisTooltipTargets(root = document) {
  const candidates = root.querySelectorAll("*");
  candidates.forEach((element) => {
    if (isEllipsisTooltipTarget(element)) element.classList.add("has-ellipsis-tooltip");
    else element.classList.remove("has-ellipsis-tooltip");
  });
}

function installEllipsisTooltips() {
  let tooltip = null;
  let activeTarget = null;
  const ensureTooltip = () => {
    if (tooltip) return tooltip;
    tooltip = document.createElement("div");
    tooltip.className = "custom-ellipsis-tooltip hidden";
    document.body.appendChild(tooltip);
    return tooltip;
  };
  const positionTooltip = (event) => {
    if (!tooltip || !activeTarget) return;
    const margin = 12;
    const rect = tooltip.getBoundingClientRect();
    let left = event.clientX + margin;
    let top = event.clientY + margin;
    if (left + rect.width > window.innerWidth - margin) left = window.innerWidth - rect.width - margin;
    if (top + rect.height > window.innerHeight - margin) top = event.clientY - rect.height - margin;
    tooltip.style.left = `${Math.max(margin, left)}px`;
    tooltip.style.top = `${Math.max(margin, top)}px`;
  };
  const hideTooltip = () => {
    activeTarget = null;
    if (tooltip) tooltip.classList.add("hidden");
  };
  document.addEventListener("pointerover", (event) => {
    let target = event.target.closest(".has-ellipsis-tooltip");
    let probe = event.target;
    while (!target && probe && probe !== document.body) {
      if (isEllipsisTooltipTarget(probe)) target = probe;
      probe = probe.parentElement;
    }
    if (!target || !isEllipsisTooltipTarget(target)) return;
    target.classList.add("has-ellipsis-tooltip");
    activeTarget = target;
    const tip = ensureTooltip();
    tip.textContent = ellipsisTooltipText(target);
    tip.classList.remove("hidden");
    positionTooltip(event);
  });
  document.addEventListener("pointermove", positionTooltip);
  document.addEventListener("pointerout", (event) => {
    if (activeTarget && (!event.relatedTarget || !activeTarget.contains(event.relatedTarget))) hideTooltip();
  });
  window.addEventListener("scroll", hideTooltip, true);
  window.addEventListener("resize", hideTooltip);
}

function handleDeepLinkAfterRender() {
  const docId = urlDocParam();
  if (!docId || state.page !== "Informationen" || lastOpenedDeepLinkDoc === docId) return;
  const docExists = informationDocs().some((doc) => doc.id === docId);
  if (!docExists || !modalRoot.classList.contains("hidden")) return;
  lastOpenedDeepLinkDoc = docId;
  openInformationDocView(docId, null, { replaceUrl: true });
}

function renderPasswordChangeRequired() {
  $(".profile-card").innerHTML = `
    ${avatarMarkup(state.currentUser, "lg")}
    <div class="profile-copy">
      <strong>${escapeHtml(fullName())}</strong>
      <span>Passwortwechsel erforderlich</span>
      <em class="off">Gesperrte Ansicht</em>
    </div>
  `;
  $("#navigation").innerHTML = "";
  $("#pageTitle").textContent = "Passwort ändern";
  $("#rankLine").textContent = "Sicherheitsprüfung";
  const description = $("#pageDescription");
  if (description) description.textContent = "Du musst dein Passwort ändern, bevor du das Dienstblatt nutzen kannst.";
  $("#serviceStatus").textContent = "Passwortwechsel erforderlich";
  $("#serviceStatus").className = "service-pill off";
  $("#headerIcon").innerHTML = iconSvg("IT");
  $("#headerIcon").classList.remove("hidden");
  renderDevModeBanner();
  renderMaintenanceBanner();
  content.innerHTML = `
    <section class="force-password-stage">
      <div class="force-password-brand">
        <img src="/assets/lspd-logo-20260515.png" alt="LSPD">
        <span>LSPD Dienstblatt</span>
      </div>
      <div class="panel force-password-panel">
        <span class="login-kicker">Sicherheitsprüfung</span>
        <h3>Passwort ändern</h3>
        <p class="muted">Du bist mit dem Standardpasswort angemeldet. Lege zuerst nur dein eigenes Passwort fest. Discord kommt danach als separater Hinweis.</p>
        <div class="security-note-box">
          <strong>Passwörter sind geschützt und nicht einsehbar.</strong>
          <span>Auch die IT kann dein Passwort nicht auslesen. Es kann nur auf das Standardpasswort zurückgesetzt und danach von dir neu gesetzt werden.</span>
        </div>
        <label>Neues Passwort<input type="password" id="forcedNewPassword" autocomplete="new-password" required></label>
        <label>Neues Passwort wiederholen<input type="password" id="forcedRepeatPassword" autocomplete="new-password" required></label>
        <p id="forcedPasswordError" class="form-error"></p>
        <button class="orange-btn" id="saveForcedPassword" type="button">Passwort speichern</button>
      </div>
    </section>
  `;
  $("#saveForcedPassword")?.addEventListener("click", saveForcedPassword);
}

async function saveForcedPassword() {
  const newPassword = $("#forcedNewPassword")?.value || "";
  const repeatPassword = $("#forcedRepeatPassword")?.value || "";
  if (!newPassword) {
    $("#forcedPasswordError").textContent = "Bitte ein neues Passwort eintragen.";
    return;
  }
  if (newPassword !== repeatPassword) {
    $("#forcedPasswordError").textContent = "Die neuen Passwörter stimmen nicht überein.";
    return;
  }
  try {
    const data = await api("/api/profile/password", { method: "PATCH", body: JSON.stringify({ newPassword }) });
    if (state.settings?.discordSync?.applicationId) {
      state.page = "Dienstblatt";
      localStorage.setItem("lspd_page", state.page);
    }
    await bootstrap();
  } catch (error) {
    $("#forcedPasswordError").textContent = error.message;
  }
}

function onboardingTutorialSteps() {
  const stored = Array.isArray(state.settings?.onboardingTutorial) ?state.settings.onboardingTutorial : [];
  const byId = new Map(stored.map((step) => [String(step.id || ""), step]));
  return DEFAULT_ONBOARDING_TUTORIAL.map((fallback) => {
    const storedStep = byId.get(fallback.id) || {};
    return {
      ...fallback,
      imageUrl: storedStep.imageUrl || "",
      imageUrls: Array.isArray(storedStep.imageUrls) ?storedStep.imageUrls : (storedStep.imageUrl ?[storedStep.imageUrl] : []),
      page: fallback.page
    };
  });
}

function tutorialImageUrls(step = {}) {
  return Array.from(new Set([...(Array.isArray(step.imageUrls) ?step.imageUrls : []), step.imageUrl || ""].map((url) => String(url || "").trim()).filter(Boolean)));
}

function renderTutorialMedia(step, index) {
  const images = tutorialImageUrls(step);
  if (!images.length) return tutorialDefaultIllustration(step, index);
  return `
    <div class="tutorial-image-scroll-wrap ${images.length > 1 ?"has-more" : ""}">
      <div class="tutorial-image-grid count-${Math.min(images.length, 4)}">
      ${images.map((url, imageIndex) => `<button class="tutorial-image-open" type="button" data-image-src="${escapeHtml(url)}"><img src="${escapeHtml(url)}" alt="${escapeHtml(step.title)} Bild ${imageIndex + 1}"></button>`).join("")}
      </div>
      ${images.length > 1 ?`<div class="tutorial-scroll-hint"><span>Weiter scrollen</span><b>↓</b></div>` : ""}
    </div>
  `;
}

function openTutorialImagePreview(src = "") {
  if (!src) return;
  openModal(`
    <h3>Tutorial Bild</h3>
    <div class="evidence-popup-preview tutorial-popup-preview">
      <img src="${escapeHtml(src)}" alt="Tutorial Bild">
    </div>
  `, (modal) => modal.classList.add("evidence-preview-modal", "tutorial-image-modal"));
}

function tutorialDefaultIllustration(step, index) {
  const page = step.page || "Start";
  return `
    <div class="tutorial-illustration">
      <div class="tutorial-browser-bar"><i></i><i></i><i></i><span>dienstblatt-template</span></div>
      <div class="tutorial-screen">
        <aside>
          ${DEFAULT_ONBOARDING_TUTORIAL.slice(1).map((item) => `<b class="${item.page === step.page ?"active" : ""}">${escapeHtml(item.page)}</b>`).join("")}
        </aside>
        <main>
          <span class="tutorial-arrow">➜</span>
          <strong>${escapeHtml(page)}</strong>
          <p>${index === 0 ?"Deine wichtigsten Bereiche im Überblick" : "Bereich ansehen oder mit Weiter fortfahren"}</p>
        </main>
      </div>
    </div>
  `;
}

function renderTutorialText(text = "") {
  const blocks = String(text || "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (!blocks.length) return "";
  return `
    <div class="tutorial-text-blocks">
      ${blocks.map((block, index) => {
        const lines = block.split(/\n+/).map((line) => line.trim()).filter(Boolean);
        if (lines.length > 1 || /^[-*]\s+/.test(lines[0] || "")) {
          return `
            <section class="tutorial-info-card">
              ${index === 0 ?`<strong>Wichtig</strong>` : `<strong>Merken</strong>`}
              <ul>
                ${lines.map((line) => `<li>${escapeHtml(line.replace(/^[-*]\s+/, ""))}</li>`).join("")}
              </ul>
            </section>
          `;
        }
        return `<p class="tutorial-lead-text">${escapeHtml(block)}</p>`;
      }).join("")}
    </div>
  `;
}

function renderOnboardingTutorial(options = {}) {
  const replay = Boolean(options.replay || tutorialReplayMode);
  const steps = onboardingTutorialSteps();
  const maxIndex = Math.max(0, steps.length - 1);
  const index = Math.min(maxIndex, Math.max(0, Number(localStorage.getItem("lspd_onboarding_step") || 0)));
  const step = steps[index] || steps[0];
  const isDiscordStep = step.id === "discord";
  const stepLabel = isDiscordStep ?"Discord Sync" : step.page || "Dienstblatt";
  const discordLinked = Boolean(state.currentUser?.discordId);
  $(".profile-card").innerHTML = `
    ${avatarMarkup(state.currentUser, "lg")}
    <div class="profile-copy">
      <strong>${escapeHtml(fullName())}</strong>
      <span>Tutorial erforderlich</span>
      <em class="off">Einweisung</em>
    </div>
  `;
  $("#navigation").innerHTML = "";
  $("#pageTitle").textContent = "Dienstblatt Tutorial";
  $("#rankLine").textContent = replay ?"Tutorial ansehen" : "Pflicht-Einweisung nach dem Passwortwechsel";
  const description = $("#pageDescription");
  if (description) description.textContent = "Klicke dich einmal durch die wichtigsten Bereiche.";
  $("#serviceStatus").textContent = "Tutorial";
  $("#serviceStatus").className = "service-pill off";
  $("#headerIcon").innerHTML = iconSvg("Dienstblatt");
  $("#headerIcon").classList.remove("hidden");
  $("#openTutorialBtn")?.classList.add("hidden");
  $("#hardRefreshBtn")?.classList.add("hidden");
  $("#topDiscordLink")?.classList.add("hidden");
  renderDevModeBanner();
  renderMaintenanceBanner();
  content.innerHTML = `
    <section class="tutorial-stage">
      <div class="panel tutorial-panel">
        <div class="tutorial-progress-head">
          <span class="login-kicker">Schritt ${index + 1} von ${steps.length}</span>
          <div class="tutorial-dots">${steps.map((_, dotIndex) => `<i class="${dotIndex === index ?"active" : dotIndex < index ?"done" : ""}"></i>`).join("")}</div>
        </div>
        <div class="tutorial-layout">
          ${index === 0 ?`
            <div class="tutorial-welcome-card">
              <span class="login-kicker">Dein Dienstblatt Account</span>
              <h3>${escapeHtml(fullName())}</h3>
              <div class="tutorial-profile-grid">
                <span><b>Rang</b>${escapeHtml(rankLabel(state.currentUser?.rank))}</span>
                <span><b>Dienstnummer</b>${escapeHtml(state.currentUser?.dn || "-")}</span>
                <span><b>Telefon</b>${escapeHtml(state.currentUser?.phone || "-")}</span>
                <span><b>Discord</b>${escapeHtml(state.currentUser?.discordName || (state.currentUser?.discordId ?"Verknüpft" : "Noch nicht verknüpft"))}</span>
              </div>
              <p>Prüfe deine Daten kurz. Falls etwas nicht stimmt, melde dich bei der zuständigen Verwaltung.</p>
            </div>
          ` : isDiscordStep ?`
            <div class="tutorial-discord-hero ${discordLinked ?"linked" : ""}">
              <span class="login-kicker">Pflichtschritt</span>
              <h3>Discord verbinden</h3>
              <p>Damit Rollen, Account-Zuordnung und Dienstblatt-Funktionen richtig laufen, muss dein Discord Account mit dem Dienstblatt verbunden sein.</p>
              <div class="tutorial-discord-status">
                <b>${discordLinked ?"Verbunden" : "Noch nicht verbunden"}</b>
                <span>${discordLinked ?escapeHtml(state.currentUser.discordName || "Discord Account") : "Discord Server beitreten und danach den Account verknüpfen."}</span>
              </div>
            </div>
          ` : `<div class="tutorial-media">
            ${renderTutorialMedia(step, index)}
          </div>`}
          <div class="tutorial-copy">
            <span class="login-kicker">${index === 0 ?"Willkommen" : escapeHtml(stepLabel)}</span>
            <h3>${escapeHtml(step.title)}</h3>
            ${renderTutorialText(step.text)}
            ${isDiscordStep ?`
              <div class="tutorial-discord-card ${discordLinked ?"linked" : ""}">
                <strong>${discordLinked ?"Discord ist verknüpft" : "Discord Sync fehlt noch"}</strong>
                <span>${discordLinked ?escapeHtml(state.currentUser.discordName || "Discord Account") : "Tritt dem Discord bei und verknüpfe danach deinen Account."}</span>
                <div class="button-row">
                  <a class="red-btn" href="${escapeHtml(discordJoinUrl())}" target="_blank" rel="noreferrer">Discord Server beitreten</a>
                  ${discordLinked ?"" : `<button class="blue-btn" id="tutorialDiscordLink" type="button">Discord verknüpfen</button>`}
                </div>
              </div>
            ` : ""}
            <div class="tutorial-actions">
              ${replay ?`<button class="ghost-btn" id="tutorialExitReplay" type="button">Tutorial beenden</button>` : ""}
              <button class="ghost-btn" id="tutorialPrev" type="button" ${index === 0 ?"disabled" : ""}>Zurück</button>
              ${index < maxIndex ?`<button class="blue-btn" id="tutorialNext" type="button" ${isDiscordStep && !discordLinked && !replay ?"disabled" : ""}>Weiter</button>` : `<button class="orange-btn" id="tutorialFinish" type="button" ${isDiscordStep && !discordLinked && !replay ?"disabled" : ""}>${replay ?"Tutorial schließen" : "Tutorial abschließen"}</button>`}
            </div>
            ${isDiscordStep && !discordLinked && !replay ?`<p class="form-error tutorial-required-hint">Bitte verknüpfe deinen Discord, bevor du das Tutorial abschließt.</p>` : ""}
          </div>
        </div>
      </div>
    </section>
  `;
  $("#tutorialPrev")?.addEventListener("click", () => {
    localStorage.setItem("lspd_onboarding_step", String(Math.max(0, index - 1)));
    renderOnboardingTutorial();
  });
  $("#tutorialNext")?.addEventListener("click", () => {
    localStorage.setItem("lspd_onboarding_step", String(Math.min(maxIndex, index + 1)));
    renderOnboardingTutorial({ replay });
  });
  $("#tutorialExitReplay")?.addEventListener("click", closeTutorialReplay);
  $("#tutorialDiscordLink")?.addEventListener("click", () => startDiscordOAuth("link"));
  document.querySelectorAll(".tutorial-image-open").forEach((button) => button.addEventListener("click", () => openTutorialImagePreview(button.dataset.imageSrc)));
  document.querySelectorAll(".tutorial-image-scroll-wrap").forEach((wrap) => {
    const grid = wrap.querySelector(".tutorial-image-grid");
    grid?.addEventListener("scroll", () => {
      if (grid.scrollTop > 12) wrap.classList.add("hint-hidden");
      else wrap.classList.remove("hint-hidden");
    }, { passive: true });
  });
  $("#tutorialFinish")?.addEventListener("click", completeOnboardingTutorial);
}

function closeTutorialReplay() {
  tutorialReplayMode = false;
  localStorage.removeItem("lspd_onboarding_step");
  renderApp();
}

async function completeOnboardingTutorial(targetPage = "") {
  if (typeof targetPage !== "string") targetPage = "";
  if (tutorialReplayMode) {
    closeTutorialReplay();
    return;
  }
  const currentStep = onboardingTutorialSteps()[Math.min(onboardingTutorialSteps().length - 1, Math.max(0, Number(localStorage.getItem("lspd_onboarding_step") || 0)))];
  if (currentStep?.id === "discord" && !state.currentUser?.discordId) {
    showNotify("Bitte verknüpfe zuerst deinen Discord Account.", "error");
    return;
  }
  try {
    const data = await api("/api/profile/tutorial", { method: "PATCH", silent: true });
    if (data.user) state.currentUser = data.user;
    localStorage.removeItem("lspd_onboarding_step");
    if (targetPage) {
      state.page = targetPage;
      localStorage.setItem("lspd_page", targetPage);
      updateAppUrl({ page: targetPage, tab: "", doc: "", replace: true });
    }
    await bootstrap();
    showNotify("Tutorial abgeschlossen. Willkommen im Dienstblatt.", "success");
  } catch (error) {
    showNotify(error.message, "error");
  }
}

function renderDiscordLinkRequired() {
  const discordUrl = discordJoinUrl();
  $(".profile-card").innerHTML = `
    ${avatarMarkup(state.currentUser, "lg")}
    <div class="profile-copy">
      <strong>${escapeHtml(fullName())}</strong>
      <span>Discord beitreten</span>
      <em class="off">Hinweis</em>
    </div>
  `;
  $("#navigation").innerHTML = "";
  $("#pageTitle").textContent = "Discord beitreten";
  $("#rankLine").textContent = "Nächster Schritt nach dem Passwortwechsel";
  $("#serviceStatus").textContent = "Discord fehlt";
  $("#serviceStatus").className = "service-pill off";
  $("#headerIcon").innerHTML = iconSvg("Profil");
  $("#headerIcon").classList.remove("hidden");
  renderDevModeBanner();
  renderMaintenanceBanner();
  content.innerHTML = `
    <section class="force-password-stage discord-required-stage">
      <div class="force-password-brand">
        <img src="/assets/lspd-logo-20260515.png" alt="LSPD">
        <span>LSPD Dienstblatt</span>
      </div>
      <div class="panel force-password-panel discord-required-panel">
        <span class="login-kicker">Discord Beitritt</span>
        <h3>Bitte joine zuerst den LSPD Discord</h3>
        <p class="muted">Damit Rollen, Name und Dienstblatt-Zugriff sauber zusammenpassen, musst du auf dem offiziellen LSPD Discord sein.</p>
        <div class="discord-join-steps">
          <div><b>1</b><span>Discord öffnen und dem Server beitreten.</span></div>
          <div><b>2</b><span>Im Discord Channel auf die Nachricht achten und dort die Verknüpfung starten.</span></div>
          <div><b>3</b><span>Danach wirst du ins Dienstblatt weitergeleitet und bekommst dort nochmal den Hinweis zur Verknüpfung.</span></div>
        </div>
        <div class="discord-required-actions">
          <a class="red-btn discord-join-main-btn" id="discordJoinContinue" href="${escapeHtml(discordUrl)}" target="_blank" rel="noopener">Discord Server beitreten</a>
          <button class="ghost-btn" id="refreshDiscordStatus" type="button">Status neu prüfen</button>
        </div>
        <p class="muted small-hint">Hier wird nichts automatisch verknüpft. Die Verknüpfung läuft über Discord oder manuell im Profil.</p>
        <p id="discordRequiredError" class="form-error"></p>
      </div>
    </section>
  `;
  $("#discordJoinContinue")?.addEventListener("click", () => {
    localStorage.setItem(DISCORD_JOIN_ACK_KEY, "1");
    window.setTimeout(() => {
      state.page = "Dienstblatt";
      localStorage.setItem("lspd_page", state.page);
      renderApp();
      showNotify("Bitte verknüpfe deinen Discord über den Discord-Channel oder im Reiter Profil.", "info");
    }, 350);
  });
  $("#refreshDiscordStatus")?.addEventListener("click", async () => {
    try {
      await bootstrap();
    } catch (error) {
      $("#discordRequiredError").textContent = error.message;
    }
  });
}

function discordJoinUrl() {
  const sync = state.settings?.discordSync || {};
  if (sync.inviteUrl) return sync.inviteUrl;
  return "";
}

function syncDevModeAuthStorage() {
  const active = Boolean(state.settings?.devMode);
  localStorage.setItem("lspd_devmode_active", active ?"1" : "0");
  if (active) {
    if (state.token) sessionStorage.setItem("lspd_token_dev", state.token);
    localStorage.removeItem("lspd_token");
  } else {
    if (state.token) localStorage.setItem("lspd_token", state.token);
    sessionStorage.removeItem("lspd_token_dev");
  }
}

function renderDevModeBanner() {
  const banner = $("#devModeBanner");
  if (!banner) return;
  banner.classList.toggle("hidden", !state.settings?.devMode);
  banner.innerHTML = state.settings?.devMode ?`
    <strong>DEVMODE</strong>
    <span>aktiv</span>
  ` : "";
}

function renderMaintenanceBanner() {
  const banner = $("#maintenanceBanner");
  if (!banner) return;
  banner.classList.toggle("hidden", !state.settings?.maintenanceMode);
  banner.innerHTML = state.settings?.maintenanceMode ?`
    <strong>Wartungsarbeiten</strong>
    <span>Server kann kurzzeitig neu starten</span>
  ` : "";
}

function renderNavigation() {
  const visiblePages = getVisiblePages();
  const myDuty = state.duty.find((entry) => entry.userId === state.currentUser.id);
  const directionSanctionCount = canApprovePersonnelSanctions() ?sanctionApprovalQueue().length : 0;

  $(".profile-card").innerHTML = `
    ${avatarMarkup(state.currentUser, "lg")}
    <div class="profile-copy">
      <strong>${escapeHtml(fullName())}</strong>
      <span>${escapeHtml(rankLabel(state.currentUser.rank))}</span>
      <em class="${myDuty ?"on" : "off"}">${myDuty ?"Im Dienst" : "Außer Dienst"}</em>
    </div>
  `;

  $("#navigation").innerHTML = visiblePages.map((page) => `
    <button class="nav-btn ${state.page === page ?"active" : ""}" data-page="${escapeHtml(page)}">
      <span class="nav-icon">
        ${iconSvg(page)}
        ${page === "Changelog" && changelogUnreadCount() ?`<em class="nav-badge changelog-nav-badge">${Math.min(99, changelogUnreadCount())}</em>` : ""}
      </span>
      <span class="nav-label">${escapeHtml(navLabel(page))}</span>
      <span class="nav-meta">
        ${restrictedPageIcon(page)}
        ${page === "Postfach" && mailboxUnreadCount() ?`<em class="nav-count-badge">${Math.min(99, mailboxUnreadCount())}</em>` : ""}
        ${page === "Direktion" && directionSanctionCount ?`<em class="nav-count-badge nav-count-badge-danger">${Math.min(99, directionSanctionCount)}</em>` : ""}
      </span>
    </button>
  `).join("");
  refreshNavigationOverflowState();

  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.page === "IT" && state.page !== "IT") localStorage.setItem("lspd_it_tab", "overview");
      if (button.dataset.page === "Postfach" && state.page !== "Postfach") {
        const unreadDocChanges = visibleInformationDocChangesForUser(state.settings?.informationDocChanges || [])
          .filter((change) => unreadMailboxItems().some((item) => item.id === change.id));
        if (unreadDocChanges.length) localStorage.setItem("lspd_mailbox_view", "unread");
      }
      navigateToPage(button.dataset.page);
    });
  });
}

function refreshNavigationOverflowState() {
  window.requestAnimationFrame(() => {
    document.querySelectorAll("#navigation .nav-btn").forEach((button) => {
      const label = button.querySelector(".nav-label");
      if (!label) return;
      button.classList.remove("nav-btn-truncated");
      label.style.whiteSpace = "nowrap";
      const isTruncated = label.scrollWidth > label.clientWidth + 1;
      label.style.whiteSpace = "";
      button.classList.toggle("nav-btn-truncated", isTruncated);
    });
  });
}

function getVisiblePages() {
  const departmentNav = (state.departments || [])
    .filter((department) => department.id !== "direktion" && department.canOpen)
    .map((department) => `dept:${department.id}`);
  const basePages = [
    ...pages.filter(canSeeDepartment),
    ...adminPages.filter(canSeeDepartment),
    ...(state.customPages || []).map((page) => page.key).filter(canSeeDepartment),
    ...departmentNav.filter(canSeeDepartment)
  ];
  return orderPages(basePages);
}

function renderTopbar() {
  const myDuty = state.duty.find((entry) => entry.userId === state.currentUser.id);
  $("#pageTitle").textContent = navLabel(state.page);
  $("#rankLine").textContent = state.page === "Dienstblatt" ?`Willkommen zurück, ${fullName()}` : pageDescription(state.page);
  $("#headerIcon").innerHTML = state.page === "Dienstblatt" ?"" : iconSvg(state.page);
  $("#headerIcon").classList.toggle("hidden", state.page === "Dienstblatt");
  $("#headerTitleBlock").classList.toggle("with-icon", state.page !== "Dienstblatt");
  $("#serviceStatus").textContent = myDuty ?"Im Dienst" : "Außer Dienst";
  $("#serviceStatus").className = `service-pill ${myDuty ?"on" : "off"}`;
  const discordLink = $("#topDiscordLink");
  if (discordLink) {
    const inviteUrl = discordJoinUrl();
    discordLink.classList.toggle("hidden", !inviteUrl);
    discordLink.href = inviteUrl || "#";
    discordLink.innerHTML = `<img src="/assets/discord-icon.svg" alt="Discord" draggable="false">`;
  }
  const templateBanner = $("#templateModeBanner");
  if (templateBanner) {
    templateBanner.textContent = state.settings?.siteModeLabel || "Showcase Template";
    templateBanner.classList.toggle("hidden", !templateBanner.textContent.trim());
  }
  renderCalendarHeaderNotice();
  renderGibsonColaButton();
  const tutorialButton = $("#openTutorialBtn");
  if (tutorialButton) {
    tutorialButton.classList.toggle("hidden", state.currentUser?.tutorialCompleted === false);
    tutorialButton.onclick = openTutorialReplay;
  }
  const refreshBtn = $("#hardRefreshBtn");
  if (refreshBtn) {
    refreshBtn.classList.remove("hidden");
    refreshBtn.onclick = hardRefreshApp;
  }
}

function openTutorialReplay() {
  tutorialReplayMode = true;
  localStorage.setItem("lspd_onboarding_step", "0");
  renderOnboardingTutorial({ replay: true });
}

function renderGibsonColaButton() {
  const button = $("#gibsonColaBtn");
  if (!button) return;
  button.classList.toggle("hidden", !state.settings?.gibsonColaButtonEnabled);
  button.onclick = state.settings?.gibsonColaButtonEnabled ?triggerGibsonColaPartyForAll : null;
}

async function triggerGibsonColaPartyForAll() {
  try {
    const data = await api("/api/gibson-cola/party", { method: "POST", body: "{}" });
    triggerGibsonColaParty(data.party);
  } catch (error) {
    showNotify(error.message || "Cola Zero konnte nicht geholt werden.", "error");
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

function customAnimationFormBody(options = {}) {
  const file = $("#customAnimationFile")?.files?.[0] || null;
  const body = {
    title: $("#customAnimationTitle")?.value.trim() || "Dienstblatt Animation",
    durationMs: Math.min(10, Math.max(1, Number($("#customAnimationDuration")?.value || 6))) * 1000,
    clearAsset: Boolean(options.clearAsset)
  };
  const assetUrl = $("#customAnimationUrl")?.value.trim() || "";
  if (assetUrl && !body.clearAsset) body.assetUrl = assetUrl;
  return { body, file };
}

async function attachCustomAnimationFile(body, file) {
  if (file && !body.clearAsset) {
    if (file.size > 18 * 1024 * 1024) throw new Error("Die Datei ist zu groß. Maximal erlaubt sind 18 MB.");
    body.assetDataUrl = await readFileAsDataUrl(file);
    body.fileName = file.name;
    body.assetUrl = "";
  }
  return body;
}

async function saveCustomAnimationSettings(options = {}) {
  const { body, file } = customAnimationFormBody(options);
  await attachCustomAnimationFile(body, file);
  const data = await api("/api/it/custom-animation", { method: "PATCH", body: JSON.stringify(body) });
  state.settings = data.settings;
  showNotify(body.clearAsset ?"Animation entfernt." : "Animation gespeichert.");
  renderIT();
}

async function saveCustomAnimationItem() {
  const { body, file } = customAnimationFormBody();
  await attachCustomAnimationFile(body, file);
  const data = await api("/api/it/custom-animation/items", { method: "POST", body: JSON.stringify(body) });
  state.settings = data.settings;
  showNotify("Animation in Liste gespeichert.");
  renderIT();
}

async function triggerCustomAnimationForAll(itemId = "") {
  const data = await api("/api/it/custom-animation/trigger", { method: "POST", body: JSON.stringify({ itemId }) });
  triggerCustomAnimationEvent(data.event);
  showNotify("Animation wurde ausgelöst.");
}

async function deleteCustomAnimationItem(itemId) {
  const data = await api(`/api/it/custom-animation/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
  state.settings = data.settings;
  showNotify("Animation gelöscht.");
  renderIT();
}

function triggerGibsonColaParty(party = {}) {
  if (party?.id) localStorage.setItem(GIBSON_COLA_SEEN_KEY, party.id);
  if (document.querySelector(".cola-party-overlay")) return;
  document.body.classList.add("cola-party-active");
  const overlay = document.createElement("div");
  overlay.className = "cola-party-overlay";
  overlay.setAttribute("aria-hidden", "true");
  const bottleCount = 24;
  overlay.innerHTML = `
    <div class="cola-party-title">Gibson bekommt eine Cola Zero</div>
    ${Array.from({ length: bottleCount }).map((_, index) => {
      const left = 4 + ((index * 37) % 92);
      const delay = (index % 8) * 0.13;
      const duration = 3.2 + (index % 5) * 0.3;
      const scale = 0.82 + (index % 4) * 0.08;
      return `<div class="cola-bottle" style="--left:${left}%;--delay:${delay}s;--duration:${duration}s;--scale:${scale};"><span>Cola</span><b>ZERO</b><em>Gibson</em></div>`;
    }).join("")}
  `;
  document.body.appendChild(overlay);
  window.setTimeout(() => {
    overlay.remove();
    document.body.classList.remove("cola-party-active");
  }, 6500);
}

async function pollGibsonColaParty() {
  if (gibsonColaInFlight || !shouldCheckLiveReload()) return;
  gibsonColaInFlight = true;
  try {
    const data = await api("/api/gibson-cola/status", { silent: true });
    if (typeof data.enabled === "boolean" && state.settings) {
      state.settings.gibsonColaButtonEnabled = data.enabled;
      renderGibsonColaButton();
    }
    const party = data.party || {};
    if (!party.id) return;
    if (localStorage.getItem(GIBSON_COLA_SEEN_KEY) === party.id) return;
    if (party.triggeredAt && Date.now() - new Date(party.triggeredAt).getTime() > 30000) {
      localStorage.setItem(GIBSON_COLA_SEEN_KEY, party.id);
      return;
    }
    triggerGibsonColaParty(party);
  } catch (error) {
    if (error.status === 401) handleAccessRevoked(error.message);
  } finally {
    gibsonColaInFlight = false;
  }
}

function triggerCustomAnimationEvent(event = {}) {
  if (event?.id) localStorage.setItem(CUSTOM_ANIMATION_SEEN_KEY, event.id);
  const source = event.assetDataUrl || event.assetUrl || "";
  if (!source) return;
  const durationMs = Math.min(10000, Math.max(1000, Number(event.durationMs || 6000)));
  const startAt = event.startAt ?new Date(event.startAt).getTime() : Date.now();
  const delayMs = Math.max(0, Math.min(5000, startAt - Date.now()));
  window.setTimeout(() => {
    document.querySelector(".custom-animation-overlay")?.remove();
    const mimeType = String(event.mimeType || "");
    const isVideo = mimeType.startsWith("video/");
    const media = isVideo
      ?`<video class="custom-animation-media" src="${escapeHtml(source)}" autoplay muted playsinline ${durationMs >= 9500 ?"loop" : ""}></video>`
      :`<img class="custom-animation-media" src="${escapeHtml(source)}" alt="">`;
    const overlay = document.createElement("div");
    overlay.className = "custom-animation-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="custom-animation-stage">
        ${media}
      </div>
    `;
    document.body.appendChild(overlay);
    const video = overlay.querySelector("video");
    if (video) video.play().catch(() => {});
    window.setTimeout(() => overlay.remove(), durationMs);
  }, delayMs);
}

async function pollCustomAnimationEvent() {
  if (customAnimationInFlight || !shouldCheckLiveReload()) return;
  customAnimationInFlight = true;
  try {
    const seen = localStorage.getItem(CUSTOM_ANIMATION_SEEN_KEY) || "";
    const data = await api(`/api/custom-animation/status?seen=${encodeURIComponent(seen)}`, { silent: true });
    const event = data.event || {};
    if (!event.id) return;
    if (localStorage.getItem(CUSTOM_ANIMATION_SEEN_KEY) === event.id) return;
    if (event.triggeredAt && Date.now() - new Date(event.triggeredAt).getTime() > 30000) {
      localStorage.setItem(CUSTOM_ANIMATION_SEEN_KEY, event.id);
      return;
    }
    triggerCustomAnimationEvent(event);
  } catch (error) {
    if (error.status === 401) handleAccessRevoked(error.message);
  } finally {
    customAnimationInFlight = false;
  }
}

async function sendActivityPing() {
  if (activityPingInFlight || !shouldCheckLiveReload()) return;
  activityPingInFlight = true;
  try {
    await api("/api/activity/ping", { method: "POST", body: JSON.stringify({ page: navLabel(state.page) }), silent: true });
  } catch (error) {
    if (error.status === 401) handleAccessRevoked(error.message);
  } finally {
    activityPingInFlight = false;
  }
}

async function pollJumpscareEvent() {
  if (jumpscareInFlight || !shouldCheckLiveReload()) return;
  jumpscareInFlight = true;
  try {
    const data = await api(`/api/jumpscare/status?page=${encodeURIComponent(navLabel(state.page))}`, { silent: true });
    const event = data.event || null;
    if (!event?.id || localStorage.getItem(JUMPSCARE_SEEN_KEY) === event.id) return;
    if (event.createdAt && Date.now() - new Date(event.createdAt).getTime() > 30000) {
      localStorage.setItem(JUMPSCARE_SEEN_KEY, event.id);
      return;
    }
    localStorage.setItem(JUMPSCARE_SEEN_KEY, event.id);
    triggerJumpscare(event);
  } catch (error) {
    if (error.status === 401) handleAccessRevoked(error.message);
  } finally {
    jumpscareInFlight = false;
  }
}

function playJumpscareSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const now = context.currentTime;
    const master = context.createGain();
    const filter = context.createBiquadFilter();
    const distortion = context.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i += 1) {
      const x = (i * 2) / curve.length - 1;
      curve[i] = Math.tanh(6 * x);
    }
    distortion.curve = curve;
    distortion.oversample = "4x";
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(2800, now + 0.45);
    filter.Q.setValueAtTime(1.8, now);
    master.gain.setValueAtTime(0.001, now);
    master.gain.exponentialRampToValueAtTime(1, now + 0.035);
    master.gain.setValueAtTime(1, now + 1.25);
    master.gain.exponentialRampToValueAtTime(0.001, now + 1.75);
    const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length);
    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer;
    const scream = context.createOscillator();
    scream.type = "sawtooth";
    scream.frequency.setValueAtTime(180, now);
    scream.frequency.exponentialRampToValueAtTime(720, now + 0.18);
    scream.frequency.exponentialRampToValueAtTime(145, now + 1.55);
    noise.connect(filter);
    scream.connect(filter);
    filter.connect(distortion);
    distortion.connect(master);
    master.connect(context.destination);
    noise.start(now);
    scream.start(now);
    noise.stop(now + 1.8);
    scream.stop(now + 1.8);
    window.setTimeout(() => context.close?.(), 2200);
  } catch {}
}

function triggerJumpscare(event = {}) {
  if (document.querySelector(".jumpscare-overlay")) return;
  const overlay = document.createElement("div");
  overlay.className = "jumpscare-overlay";
  overlay.innerHTML = `
    <div class="jumpscare-face">
      <span></span><span></span>
      <b></b>
    </div>
    <strong>JUMPSCARE</strong>
    <small>${escapeHtml(event.triggeredByName || "IT")} hat dich erwischt</small>
  `;
  document.body.appendChild(overlay);
  playJumpscareSound();
  window.setTimeout(() => overlay.remove(), 3600);
}

function reminderMinutes(value = "") {
  const text = String(value || "").toLowerCase();
  if (text.includes("keine")) return null;
  if (text.includes("tag")) return 24 * 60;
  if (text.includes("stunde")) return 60;
  const match = text.match(/\d+/);
  return match ?Number(match[0]) : 30;
}

function nextCalendarReminderEvent() {
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const startIso = isoDateLocal(now);
  const endIso = isoDateLocal(horizon);
  return calendarEventInstances(state.settings?.calendarEvents || [], startIso, endIso)
    .filter((event) => !event.cancelled && !event.allDay && event.startDate && event.startTime)
    .map((event) => {
      const minutes = reminderMinutes(event.reminder || "30 Minuten");
      if (!Number.isFinite(minutes)) return null;
      const start = new Date(`${event.startDate}T${event.startTime}`);
      const diffMs = start.getTime() - now.getTime();
      if (diffMs < 0 || diffMs > minutes * 60000) return null;
      return { event, start, minutesUntil: Math.max(0, Math.ceil(diffMs / 60000)) };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start)[0] || null;
}

function renderCalendarHeaderNotice() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  let notice = $("#calendarHeaderNotice");
  if (!notice) {
    notice = document.createElement("button");
    notice.id = "calendarHeaderNotice";
    notice.className = "calendar-header-notice hidden";
    notice.type = "button";
    topbar.insertBefore(notice, topbar.querySelector(".top-actions"));
  }
  const next = nextCalendarReminderEvent();
  notice.classList.toggle("hidden", !next);
  if (next) {
    notice.innerHTML = `${iconSvg("Kalender")} <strong>${escapeHtml(next.event.title)}</strong><span>in ${next.minutesUntil || "weniger als 1"} Min.</span>`;
    notice.onclick = () => {
      selectedCalendarDate = next.event.startDate;
      navigateToPage("Kalender");
    };
  }
  if (!calendarReminderTimer) {
    calendarReminderTimer = window.setInterval(() => {
      if (state.token && $("#appView") && !$("#appView").classList.contains("hidden")) renderCalendarHeaderNotice();
    }, 30000);
  }
}

async function hardRefreshApp() {
  await clearBrowserCachesForRefresh();
  window.location.reload();
}

function renderPage() {
  if (state.page === "Dienstblatt") return renderDienstblatt();
  if (state.page === "Mitglieder") return renderMembers();
  if (state.page === "Mitgliederfluktation") return renderFluctuation();
  if (state.page === "Beförderungen") {
    content.innerHTML = renderPromotionAnnouncements();
    return;
  }
  if (state.page === "Beschlagnahmung") return renderSeizures();
  if (state.page === "Kalender") return renderCalendar();
  if (state.page === "Informationen") return renderInformation();
  if (state.page === "Changelog") return renderChangelog();
  if (state.page === "Direktion") return renderDirektion();
  if (state.page === "IT") return renderIT();
  if (state.page === "Abteilungen") return renderDepartmentsOverview();
  if (isDepartmentPage(state.page)) return renderDepartmentPage(departmentByPage(state.page));
  if (state.page === "Profil") return renderProfile();
  return renderTemplate(state.page);
}

function renderDienstblatt() {
  const agents = state.duty.length;
  const undercover = state.duty.filter((entry) => entry.status === "Undercover Dienst").length;
  const outside = state.duty.filter((entry) => entry.status === "Außendienst").length;
  const inside = state.duty.filter((entry) => entry.status === "Innendienst").length;
  const adminDuty = state.duty.filter((entry) => entry.status === "Admin Dienst").length;
  const myDuty = state.duty.find((entry) => entry.userId === state.currentUser.id);
  const discordMissingNotice = state.settings?.discordSync?.applicationId && !state.currentUser?.discordId
    ?`<section class="panel discord-dashboard-notice">
        <div>
          <span class="login-kicker">Discord fehlt</span>
          <h3>Bitte Discord verknüpfen</h3>
          <p>Du bist im Dienstblatt. Verknüpfe deinen Discord bitte über die Nachricht im Discord-Channel oder im Reiter Profil, damit Rollen und Name automatisch synchronisiert werden.</p>
        </div>
        <button class="ghost-btn" id="openProfileDiscordNotice" type="button">Zum Profil</button>
      </section>`
    : "";

  content.innerHTML = `
    ${discordMissingNotice}
    ${state.settings?.hideDefconCard ?"" : `<section class="panel defcon-panel ${defconClass(state.settings.defcon)}">
      <div>
        <div class="defcon-value">${escapeHtml(state.settings.defcon)}</div>
        ${state.settings.defconText ?`<p>${escapeHtml(state.settings.defconText)}</p>` : ""}
      </div>
      <div class="defcon-meta">
        <div>Aktualisiert von ${escapeHtml(state.settings.defconUpdatedBy)} - ${formatDate(state.settings.defconUpdatedAt)} - ${formatTime(state.settings.defconUpdatedAt)}</div>
      </div>
      ${canAccess("actions", "editDefcon", "Supervisor") ?`<button class="icon-btn" id="defconBtn" title="DEFCON bearbeiten">⚙</button>` : ""}
    </section>`}

    <section class="grid-4 dashboard-stats">
      <div class="stat-card"><span>Aktive Officer</span><i>${iconSvg("AktiveOfficer")}</i><strong>${agents}</strong><small>Im Einsatz</small></div>
      <div class="stat-card"><span>Außendienst</span><i>${iconSvg("Aussendienst")}</i><strong>${outside}</strong><small>Auf Streife</small></div>
      <div class="stat-card"><span>Undercover Dienst</span><i>${iconSvg("Undercover")}</i><strong>${undercover}</strong><small>Zivil Einheit</small></div>
      <div class="stat-card"><span>Innendienst ${adminDuty ?`<em class="admin-duty-count">(${adminDuty})</em>` : ""}</span><i>${iconSvg("Innendienst")}</i><strong>${inside}</strong><small>Im Büro${adminDuty ?" · Admin Dienst" : ""}</small></div>
    </section>

    <section class="panel">
      <div class="panel-header">
        <h3><span class="section-icon">▣</span>Dienstblatt-Notizen</h3>
        ${canAccess("actions", "manageNotes", "Supervisor") ?`<button class="blue-btn" id="addNoteBtn"><span>+</span> Notiz hinzufügen</button>` : ""}
      </div>
      <div class="note-list">
        ${state.notes.length ?state.notes.map(renderNote).join("") : `<p class="muted">Noch keine Notizen vorhanden.</p>`}
      </div>
    </section>

    <section class="panel">
      <div class="panel-header">
        <h3><span class="section-icon">♙</span>Aktive Officer</h3>
        <div class="button-row">
          ${myDuty ?`<button class="ghost-btn action-btn" id="switchDutyBtn"><span>${iconSvg("Einsatzzentrale")}</span> Umtragen</button>` : ""}
          ${myDuty ?"" : `<button class="blue-btn action-btn" id="startDutyBtn" title="Dienst eintragen"><span>+</span> Eintragen</button>`}
          ${myDuty ?`<button class="red-btn action-btn" id="stopDutyBtn"><span>${iconSvg("Profil")}</span> Austragen</button>` : ""}
          ${canAccess("actions", "stopAllDuty", "Direktion") ?`<button class="orange-btn action-btn" id="stopAllDutyBtn"><span>${iconSvg("Mitglieder")}</span> Alle Austragen</button>` : ""}
        </div>
      </div>
      ${renderDutyTable()}
    </section>
  `;

  $("#defconBtn")?.addEventListener("click", openDefconModal);
  $("#openProfileDiscordNotice")?.addEventListener("click", () => {
    state.page = "Profil";
    localStorage.setItem("lspd_page", state.page);
    renderApp();
  });
  $("#addNoteBtn")?.addEventListener("click", () => openNoteModal());
  $("#startDutyBtn")?.addEventListener("click", openStartDutyModal);
  $("#switchDutyBtn")?.addEventListener("click", openSwitchDutyModal);
  $("#stopDutyBtn")?.addEventListener("click", () => openStopDutyModal(myDuty));
  $("#stopAllDutyBtn")?.addEventListener("click", openStopAllDutyModal);
}

function renderNote(note) {
  const className = note.priority.toLowerCase();
  const priorityClass = className.replace(/[^a-z0-9-]/g, "");
  const noteCardClass = ["it-info", "direktion", "anweisung"].includes(priorityClass) ?` note-${priorityClass}` : "";
  return `
    <article class="note-card${noteCardClass}" data-note-id="${escapeHtml(note.id)}">
      <div class="note-top">
        <div class="note-title">
          <span class="note-priority-icon">${iconSvg(note.priority)}</span>
          <strong>${escapeHtml(note.title)}</strong>
          <span class="badge ${priorityClass}">${escapeHtml(note.priority)}</span>
        </div>
        ${canAccess("actions", "manageNotes", "Supervisor") ?`<div class="note-actions">
          <button class="mini-icon edit-note" data-note-id="${escapeHtml(note.id)}" title="Notiz bearbeiten">${actionIcon("edit")}</button>
          <button class="mini-icon danger delete-note" data-note-id="${escapeHtml(note.id)}" title="Notiz löschen">${actionIcon("delete")}</button>
        </div>` : ""}
      </div>
      <p>${linkifyText(note.text)}</p>
      <small class="muted">${escapeHtml(note.authorName)} · ${formatDate(note.createdAt)} ${formatTime(note.createdAt)}</small>
    </article>
  `;
}

function linkifyText(text) {
  return escapeHtml(text || "").replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    const cleanUrl = url.replace(/[.,;:!?)]$/, "");
    const suffix = url.slice(cleanUrl.length);
    return `<a href="${cleanUrl}" target="_blank" rel="noreferrer">${cleanUrl}</a>${suffix}`;
  });
}

function wrapTextareaSelection(area, before = "", after = before) {
  if (!area) return;
  const start = area.selectionStart || 0;
  const end = area.selectionEnd || 0;
  const selected = area.value.slice(start, end);
  area.setRangeText(`${before}${selected}${after}`, start, end, "end");
  if (!selected) area.setSelectionRange(start + before.length, start + before.length);
  area.focus();
}

function defconClass(defcon) {
  const value = Number(String(defcon).replace(/\D/g, ""));
  if (value === 1) return "defcon-1";
  if (value === 2) return "defcon-2";
  if (value === 3) return "defcon-3";
  if (value === 4) return "defcon-4";
  return "defcon-5";
}

function renderDutyTable() {
  if (!state.duty.length) return `<p class="muted">Aktuell ist niemand im Dienst.</p>`;
  const canStopSingleDuty = canAccess("actions", "stopSingleDuty", "User");
  const sortedDuty = [...state.duty].sort((a, b) => {
    const userA = a.user || state.users.find((item) => item.id === a.userId) || {};
    const userB = b.user || state.users.find((item) => item.id === b.userId) || {};
    return Number(userB.rank || 0) - Number(userA.rank || 0)
      || fullName(userA).localeCompare(fullName(userB), "de");
  });
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Rang</th><th>Name</th><th>Dienststart</th><th>Telefon</th><th>Status</th><th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          ${sortedDuty.map((entry) => {
            const user = entry.user || state.users.find((item) => item.id === entry.userId);
            return `
              <tr>
                <td>${escapeHtml(rankLabel(user?.rank))}</td>
                <td><span class="member-name duty-member-name">${avatarMarkup(user, "sm")}<span>${escapeHtml(fullName(user))}</span>${twitchLiveBadge(user)}</span></td>
                <td>${formatTime(entry.startedAt)}</td>
                <td>${escapeHtml(user?.phone || "-")}</td>
                <td><span class="status-chip ${statusClass(entry.status)}">${escapeHtml(entry.status)}</span></td>
                <td>${canStopSingleDuty ?`<button class="agent-action remove-duty" data-user-id="${entry.userId}" title="Person austragen">${iconSvg("Profil")}</button>` : `<span class="muted">-</span>`}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function twitchLiveBadge(user) {
  const live = user?.twitchLive || {};
  if (!user?.twitchLogin || !live.live || !live.matched) return "";
  const url = live.url || `https://www.twitch.tv/${encodeURIComponent(user.twitchLogin)}`;
  return `<a class="twitch-live-badge" href="${escapeHtml(url)}" target="_blank" rel="noreferrer" title="${escapeHtml(live.title || "Twitch Stream öffnen")}">Live</a>`;
}

function twitchStatusText(user) {
  if (!user?.twitchLogin) return "Nicht verknüpft. Bei passendem Firma-Titel erscheint im Dienst eine Live-Kachel.";
  const live = user.twitchLive || {};
  const checked = live.checkedAt ?` · geprüft ${formatDateTime(live.checkedAt)}` : "";
  if (live.live && live.matched) return `${escapeHtml(user.twitchLogin)} · Firma Stream live${checked}`;
  if (live.live) return `${escapeHtml(user.twitchLogin)} · Live, aber kein Firma-Titel${checked}${live.title ?` · ${escapeHtml(live.title)}` : ""}`;
  return `${escapeHtml(user.twitchLogin)} · aktuell nicht live${checked}`;
}

function statusClass(status) {
  if (status === "Innendienst") return "status-inside";
  if (status === "Admin Dienst") return "status-admin";
  if (status === "Außendienst") return "status-outside";
  if (status === "Undercover Dienst") return "status-undercover";
  return "";
}

function renderMembers() {
  const rows = sortMembersForRankList(state.users);
  const frakverwaltungCount = rows.filter(isFrakverwaltungUser).length;
  const memberCount = rows.length - frakverwaltungCount;
  const search = localStorage.getItem("lspd_members_search") || "";
  const canManageModules = hasRole("Direktion");
  const moduleEditHint = membersModuleEditMode ?`<span class="muted">Klicke direkt auf Haken oder X und speichere danach gesammelt.</span>` : "";
  content.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Mitglieder <span class="heading-count">${memberCount}</span> <span class="heading-count frak-count">${frakverwaltungCount}</span></h3>
          ${moduleEditHint}
        </div>
        <div class="button-row">
          <span class="muted">${rows.length} Einträge</span>
          ${canManageModules ?membersModuleEditMode ?`
            <button class="ghost-btn compact-action" id="cancelMemberModuleEdit" type="button">Abbrechen</button>
            <button class="blue-btn compact-action" id="saveMemberModuleEdit" type="button">Module speichern</button>
          ` : `<button class="blue-btn compact-action" id="startMemberModuleEdit" type="button">Module bearbeiten</button>` : ""}
        </div>
      </div>
      <div class="filter-row members-search-row">
        <input id="membersSearch" value="${escapeHtml(search)}" placeholder="Mitglied, DN, Rang oder Ausbildung suchen">
      </div>
      <div class="table-scrollbar-sync members-scrollbar-top" id="membersTopScrollbar"><div></div></div>
      <div class="table-wrap members-table-wrap" id="membersTableWrap">
        <table class="members-table">
          <thead>
            <tr>
              <th class="member-name-col text-left">Name</th>
              <th class="text-center">Telefon</th>
              <th class="text-left">DN</th>
              <th class="member-rank-col text-center">Rang</th>
              <th class="text-left">Beitritt</th>
              <th class="text-left">Letzte Beförderung</th>
              ${visibleTrainingGroups().map((group) => group.trainings.map((item, index) => `<th class="${index === 0 ?"training-group-start" : ""} text-center"><span class="training-hover-anchor members-training-head"><span>${escapeHtml(trainingDisplayName(item))}</span>${trainingUprankRequirementText(item) ?`<small>${escapeHtml(trainingUprankRequirementText(item))}</small>` : ""}${trainingTooltipMarkup(item)}</span></th>`).join("")).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows.map((user) => {
              const isFrakverwaltung = isFrakverwaltungUser(user);
              const showAbsence = canSeeAbsenceForUser(user) && activeAbsenceForUser(user.id);
              return `
              <tr class="filterable-row ${user.id === state.currentUser?.id ?"member-row-self" : ""} ${isFrakverwaltung ?"member-row-frakverwaltung" : ""} ${showAbsence ?"member-row-absence" : ""}" data-search="${escapeHtml(memberSearchText(user))}">
                <td class="member-name-col text-left"><span class="member-name member-name-wrap">${avatarMarkup(user, "sm")}<span>${wrapNameForTable(fullName(user))}${userAbsenceBadge(user)}</span></span></td>
                <td class="text-center">${escapeHtml(user.phone)}</td>
                <td class="text-left">${escapeHtml(user.dn)}</td>
                <td class="member-rank-col text-center">${isFrakverwaltung ?`<span class="frakverwaltung-pill">Frakverwaltung</span>` : `<span class="rank-number" data-rank-label="${escapeHtml(rankLabel(user.rank))}">${escapeHtml(user.rank)}</span>`}</td>
                <td class="text-left">${formatDate(user.joinedAt)}</td>
                <td class="text-left">${formatDate(user.lastPromotionAt)}</td>
                ${visibleTrainingGroups().map((group) => group.trainings.map((training) => {
                  if (isFrakverwaltung) return `<td class="text-center training-hidden">-</td>`;
                  const hasTraining = memberModuleValue(user, training);
                  const changed = membersModuleEditMode && Boolean(user.trainings?.[training]) !== hasTraining;
                  return `<td class="text-center ${hasTraining ?"training-yes" : "training-no"} ${changed ?"module-draft-changed" : ""}"><span class="training-hover-anchor">${membersModuleEditMode ?`<button class="member-module-cell" type="button" data-user-id="${escapeHtml(user.id)}" data-training="${escapeHtml(training)}" aria-label="${escapeHtml(training)} für ${escapeHtml(fullName(user))} umschalten">${hasTraining ?"✓" : "X"}</button>` : hasTraining ?"✓" : "X"}${trainingTooltipMarkup(training)}</span></td>`;
                }).join("")).join("")}
              </tr>
            `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
  setupTableFilter("#membersSearch");
  $("#membersSearch")?.addEventListener("input", (event) => localStorage.setItem("lspd_members_search", event.target.value));
  if (search) $("#membersSearch")?.dispatchEvent(new Event("input"));
  document.querySelectorAll(".view-user-absence").forEach((button) => button.addEventListener("click", () => openAbsenceInfoModal(button.dataset.absenceId)));
  $("#startMemberModuleEdit")?.addEventListener("click", startMembersModuleEdit);
  $("#cancelMemberModuleEdit")?.addEventListener("click", cancelMembersModuleEdit);
  $("#saveMemberModuleEdit")?.addEventListener("click", saveMembersModuleEdit);
  document.querySelectorAll(".member-module-cell").forEach((button) => button.addEventListener("click", () => toggleMembersModuleDraft(button, button.dataset.userId, button.dataset.training)));
  setupSyncedHorizontalScroll("#membersTopScrollbar", "#membersTableWrap", ".members-table");
}

function memberModuleValue(user, training) {
  if (membersModuleEditMode && membersModuleDraft[user.id] && Object.prototype.hasOwnProperty.call(membersModuleDraft[user.id], training)) {
    return Boolean(membersModuleDraft[user.id][training]);
  }
  return Boolean(user.trainings?.[training]);
}

function startMembersModuleEdit() {
  if (!hasRole("Direktion")) {
    showNotify("Nur Direktion und IT dürfen Module im Mitglieder-Reiter bearbeiten.", "error");
    return;
  }
  membersModuleDraft = {};
  state.users.filter((user) => !isFrakverwaltungUser(user)).forEach((user) => {
    membersModuleDraft[user.id] = Object.fromEntries(visibleTrainings().map((training) => [training, Boolean(user.trainings?.[training])]));
  });
  membersModuleEditMode = true;
  renderMembers();
}

function cancelMembersModuleEdit() {
  membersModuleEditMode = false;
  membersModuleDraft = {};
  renderMembers();
}

function toggleMembersModuleDraft(button, userId, training) {
  if (!membersModuleEditMode || !membersModuleDraft[userId] || !visibleTrainings().includes(training)) return;
  membersModuleDraft[userId][training] = !membersModuleDraft[userId][training];
  const nextValue = Boolean(membersModuleDraft[userId][training]);
  const user = state.users.find((item) => item.id === userId);
  const cell = button?.closest("td");
  if (button) button.textContent = nextValue ?"✓" : "X";
  if (cell) {
    cell.classList.toggle("training-yes", nextValue);
    cell.classList.toggle("training-no", !nextValue);
    cell.classList.toggle("module-draft-changed", Boolean(user?.trainings?.[training]) !== nextValue);
  }
}

async function saveMembersModuleEdit() {
  const button = $("#saveMemberModuleEdit");
  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Speichere...";
    }
    const data = await api("/api/users/trainings/bulk", {
      method: "PATCH",
      silent: true,
      body: JSON.stringify({ users: membersModuleDraft })
    });
    const updated = new Map((data.users || []).map((user) => [user.id, user]));
    state.users = state.users.map((user) => updated.get(user.id) || user);
    membersModuleEditMode = false;
    membersModuleDraft = {};
    showNotify(`${data.changedCount || 0} Moduländerungen gespeichert.`);
    renderMembers();
  } catch (error) {
    showNotify(error.message || "Module konnten nicht gespeichert werden.", "error");
    if (button) {
      button.disabled = false;
      button.textContent = "Module speichern";
    }
  }
}

function setupSyncedHorizontalScroll(topSelector, wrapSelector, tableSelector) {
  const top = $(topSelector);
  const wrap = $(wrapSelector);
  const table = $(tableSelector);
  if (!top || !wrap || !table) return;
  const inner = top.firstElementChild;
  if (inner) inner.style.width = `${table.scrollWidth}px`;
  let syncing = false;
  const sync = (source, target) => {
    if (syncing) return;
    syncing = true;
    target.scrollLeft = source.scrollLeft;
    syncing = false;
  };
  top.addEventListener("scroll", () => sync(top, wrap));
  wrap.addEventListener("scroll", () => sync(wrap, top));
}

function memberSearchText(user) {
  const completedTrainings = visibleTrainings().filter((training) => user.trainings?.[training]);
  const fileSummary = userDisciplinarySummary(user.id);
  return [
    fullName(user),
    user.firstName,
    user.lastName,
    user.phone,
    user.dn,
    user.rank,
    rankLabel(user.rank),
    user.role,
    user.baseRole,
    roleBadges(user).replace(/<[^>]+>/g, " "),
    user.discordUsername,
    user.discordId,
    userAccountStatus(user),
    lastDutyActivityLabel(user),
    lastDutyActivityForUser(user.id)?.startedAt ?formatDateTime(lastDutyActivityForUser(user.id).startedAt.toISOString()) : "",
    user.mustChangePassword ?"Nicht aktiviert Standardpasswort" : "Aktiviert Passwort geaendert",
    fileSummary.activeStrikes ?`Aktive Strikes ${fileSummary.activeStrikes}` : "",
    fileSummary.openFines.length ?`Offene Geldstrafen ${fileSummary.openFineAmount}` : "",
    canSeeAbsenceForUser(user) && activeAbsenceForUser(user.id) ?"Abmeldung aktiv" : "",
    isFrakverwaltungUser(user) ?"Frakverwaltung" : "",
    ...(user.departments || []),
    ...completedTrainings
  ].filter(Boolean).join(" ");
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function searchTokens(value) {
  return normalizeSearchText(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function smartSearchMatch(haystack, query) {
  const terms = searchTokens(query);
  if (!terms.length) return true;
  const text = normalizeSearchText(haystack);
  const tokens = searchTokens(haystack);
  return terms.every((term) => {
    if (tokens.some((token) => token.startsWith(term))) return true;
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}`, "u").test(text);
  });
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function userDisciplinarySummary(userId) {
  const entries = (state.disciplinary || []).filter((entry) => entry.userId === userId);
  const activeStrikes = entries
    .filter(isActiveDisciplinaryStrike)
    .reduce((sum, entry) => sum + Math.max(1, Number(entry.strikeCount || 1)), 0);
  const openFines = entries.filter(isOpenDisciplinaryFine);
  const openFineAmount = openFines.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  return { activeStrikes, openFines, openFineAmount };
}

function isActiveDisciplinaryStrike(entry) {
  const isStrike = entry?.type === "Strike" || (entry?.type === "Sanktion" && entry?.sanctionType === "Strike");
  const expired = entry?.expiresAt && new Date(entry.expiresAt) <= new Date();
  if (entry?.workflowStatus || entry?.submittedAt || entry?.approvedAt || entry?.announcedAt) {
    return Boolean(isStrike && sanctionWorkflowStatus(entry) === "active" && !entry?.strikeResolvedAt && !expired);
  }
  return Boolean(isStrike && !entry?.archivedAt && !entry?.strikeResolvedAt && !expired);
}

function isOpenDisciplinaryFine(entry) {
  if (entry?.workflowStatus || entry?.submittedAt || entry?.approvedAt || entry?.paidAt) {
    return isDisciplinaryFine(entry) && sanctionWorkflowStatus(entry) === "open";
  }
  return isDisciplinaryFine(entry) && !entry?.paidAt && !entry?.archivedAt;
}

function isDisciplinaryFine(entry) {
  return entry?.sanctionType === "Geldstrafe" || entry?.type === "Geldstrafe" || Number(entry?.amount || 0) > 0;
}

function isFineOnlyEntry(entry) {
  return entry?.sanctionType === "Geldstrafe" || entry?.type === "Geldstrafe";
}

function disciplinaryEntryUser(entry) {
  return state.users.find((user) => user.id === entry.userId) || (state.archivedUsers || []).find((user) => user.id === entry.userId) || null;
}

function disciplinaryEntryName(entry) {
  const user = disciplinaryEntryUser(entry);
  return user ?fullName(user) : entry.name || entry.userName || entry.userId || "Unbekannter Account";
}

function renderDirectionFileSummary(user) {
  const summary = userDisciplinarySummary(user.id);
  if (!summary.activeStrikes && !summary.openFines.length) return `<span class="muted">-</span>`;
  return `
    <div class="direction-file-summary">
      ${summary.activeStrikes ?`<span class="strike-counter ${summary.activeStrikes >= 3 ?"danger" : summary.activeStrikes >= 2 ?"warn" : ""}">${summary.activeStrikes}/3 Strikes</span>` : ""}
      ${summary.openFines.length ?`<span class="file-pill open">${summary.openFines.length} offen · ${summary.openFineAmount.toLocaleString("de-DE")} $</span>` : ""}
    </div>
  `;
}

function renderDirectionDisciplinaryOverview() {
  const activeUserIds = new Set((state.users || []).map((user) => user.id));
  const activeStrikeRows = (state.disciplinary || []).filter((entry) => activeUserIds.has(entry.userId) && isActiveDisciplinaryStrike(entry));
  const openFineRows = (state.disciplinary || []).filter((entry) => activeUserIds.has(entry.userId) && isOpenDisciplinaryFine(entry));
  if (!activeStrikeRows.length && !openFineRows.length) return "";
  return `
    <div class="direction-file-overview">
      <div class="direction-file-overview-head">
        <strong>Aktive Aktenhinweise</strong>
        <span>${activeStrikeRows.length} Strike-Eintrag${activeStrikeRows.length === 1 ?"" : "e"} / ${openFineRows.length} offene Geldstrafe${openFineRows.length === 1 ?"" : "n"}</span>
      </div>
      <div class="direction-file-overview-list">
        ${activeStrikeRows.map((entry) => {
          const user = disciplinaryEntryUser(entry);
          return `<article>
            <span class="strike-counter ${Number(entry.strikeCount || 1) >= 3 ?"danger" : Number(entry.strikeCount || 1) >= 2 ?"warn" : ""}">${Math.max(1, Number(entry.strikeCount || 1))} Strike${Number(entry.strikeCount || 1) > 1 ?"s" : ""}</span>
            <strong>${escapeHtml(disciplinaryEntryName(entry))}</strong>
            <small>${user ?`DN ${escapeHtml(user.dn || entry.dn || "-")}` : `Nicht in aktiver Mitgliederliste · DN ${escapeHtml(entry.dn || "-")}`} · ${formatDateTime(entry.createdAt)}</small>
          </article>`;
        }).join("")}
        ${openFineRows.map((entry) => {
          const user = disciplinaryEntryUser(entry);
          return `<article>
            <span class="file-pill open">${Number(entry.amount || 0).toLocaleString("de-DE")} $ offen</span>
            <strong>${escapeHtml(disciplinaryEntryName(entry))}</strong>
            <small>${user ?`DN ${escapeHtml(user.dn || entry.dn || "-")}` : `Nicht in aktiver Mitgliederliste · DN ${escapeHtml(entry.dn || "-")}`} · ${formatDateTime(entry.createdAt)}</small>
          </article>`;
        }).join("")}
      </div>
    </div>
  `;
}

function renderInformation() {
  const links = state.settings.informationLinks || [];
  const permits = state.settings.informationPermits || [];
  const factions = state.settings.informationFactions || [];
  content.innerHTML = `
    <section class="department-info-view information-admin-view">
      <div class="info-box full information-card">
        <div class="department-modal-heading">
          <h4>Rechte Definition</h4>
          ${canAccess("actions", "manageInformation", "Direktion") ?`<button class="blue-btn" id="editInformationRights">${actionIcon("edit")} Bearbeiten</button>` : ""}
        </div>
        <div class="rich-text-view">${formatDepartmentText(state.settings.informationRightsText)}</div>
      </div>
      <div class="info-box full information-card redirects-card">
        <div class="department-modal-heading">
          <h4>Weiterleitungen</h4>
          ${canAccess("actions", "manageInformation", "Direktion") ?`<button class="blue-btn" id="addInformationLink">${iconSvg("Plus")} Hinzufügen</button>` : ""}
        </div>
        <div class="link-card-grid">${links.map((link) => `
          <article class="small-link-card">
            <strong>${escapeHtml(link.title)}</strong>
            <span class="link-label">Link:</span>
            <a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.url)}</a>
            ${canAccess("actions", "manageInformation", "Direktion") ?`<span class="button-row"><button class="blue-btn compact-action edit-info-link" data-id="${link.id}" title="Bearbeiten">${actionIcon("edit")} Bearbeiten</button><button class="mini-icon danger delete-info-link" data-id="${link.id}" title="Löschen">${actionIcon("delete")}</button></span>` : ""}
          </article>
        `).join("") || `<p class="muted">Noch keine Weiterleitungen.</p>`}</div>
      </div>
      <div class="info-box full information-card">
        <div class="department-modal-heading">
          <h4>Sondergenehmigungen</h4>
          ${canAccess("actions", "manageInformation", "Direktion") ?`<button class="blue-btn" id="addInformationPermit">${iconSvg("Plus")} Hinzufügen</button>` : ""}
        </div>
        <div class="table-wrap compact-table">
          <table>
            <thead><tr><th>Vor- und Nachname</th><th>Beschreibung</th><th>Gültig Bis</th><th>Aktionen</th></tr></thead>
            <tbody>${permits.map((permit) => `<tr><td>${escapeHtml(permit.name)}</td><td>${escapeHtml(permit.description)}</td><td>${formatDate(permit.validUntil)}</td><td>${canAccess("actions", "manageInformation", "Direktion") ?`<button class="mini-icon edit-info-permit" data-id="${permit.id}">${actionIcon("edit")}</button><button class="mini-icon danger delete-info-permit" data-id="${permit.id}">${actionIcon("delete")}</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Keine Sondergenehmigungen.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <div class="info-box full information-card">
        <div class="department-modal-heading">
          <h4>Fraktionen</h4>
          ${canAccess("actions", "manageInformation", "Direktion") ?`<button class="blue-btn" id="addInformationFaction">${iconSvg("Plus")} Hinzufügen</button>` : ""}
        </div>
        <div class="table-wrap compact-table">
          <table>
            <thead><tr><th>Organisation</th><th>Status</th><th>Aktionen</th></tr></thead>
            <tbody>${factions.map((faction) => `<tr><td>${escapeHtml(faction.organization)}</td><td><span class="status-label">${renderStatusDot(faction.status)}</span></td><td>${canAccess("actions", "manageInformation", "Direktion") ?`<button class="mini-icon edit-info-faction" data-id="${faction.id}">${actionIcon("edit")}</button><button class="mini-icon danger delete-info-faction" data-id="${faction.id}">${actionIcon("delete")}</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">Keine Fraktionen.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </section>
  `;
  $("#editInformationRights")?.addEventListener("click", openInformationRightsModal);
  $("#addInformationLink")?.addEventListener("click", () => openInformationLinkModal());
  $("#addInformationPermit")?.addEventListener("click", () => openInformationPermitModal());
  $("#addInformationFaction")?.addEventListener("click", () => openInformationFactionModal());
  document.querySelectorAll(".edit-info-link").forEach((button) => button.addEventListener("click", () => openInformationLinkModal(links.find((item) => item.id === button.dataset.id))));
  document.querySelectorAll(".delete-info-link").forEach((button) => button.addEventListener("click", () => deleteInformationItem("informationLinks", button.dataset.id)));
  document.querySelectorAll(".edit-info-permit").forEach((button) => button.addEventListener("click", () => openInformationPermitModal(permits.find((item) => item.id === button.dataset.id))));
  document.querySelectorAll(".delete-info-permit").forEach((button) => button.addEventListener("click", () => deleteInformationItem("informationPermits", button.dataset.id)));
  document.querySelectorAll(".edit-info-faction").forEach((button) => button.addEventListener("click", () => openInformationFactionModal(factions.find((item) => item.id === button.dataset.id))));
  document.querySelectorAll(".delete-info-faction").forEach((button) => button.addEventListener("click", () => deleteInformationItem("informationFactions", button.dataset.id)));
}

function openInformationEditModal() {
  openModal(`
    <h3>Informationen bearbeiten</h3>
    <label>Beschreibung<textarea id="informationText">${escapeHtml(state.settings.informationText)}</textarea></label>
    <label>Bewerbungsstatus
      <select id="informationApplicationStatus">
        <option ${state.settings.applicationStatus === "Offen" ?"selected" : ""}>Offen</option>
        <option ${state.settings.applicationStatus === "Geschlossen" ?"selected" : ""}>Geschlossen</option>
      </select>
    </label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="blue-btn" id="saveInformation">Speichern</button>
    </div>
  `, (modal) => {
    modal.querySelector("#saveInformation").addEventListener("click", async () => {
      try {
        await saveInformationPatch({ informationText: $("#informationText").value, applicationStatus: $("#informationApplicationStatus").value });
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

async function saveInformationPatch(patch) {
  await api("/api/information", {
    method: "PATCH",
    body: JSON.stringify({
      informationText: state.settings.informationText,
      applicationStatus: state.settings.applicationStatus,
      informationRightsBriefText: state.settings.informationRightsBriefText || "",
      informationRightsText: state.settings.informationRightsText || "",
      informationLinks: state.settings.informationLinks || [],
      informationDocs: state.settings.informationDocs || [],
      informationDocChanges: state.settings.informationDocChanges || [],
      informationPermits: state.settings.informationPermits || [],
      informationFactions: state.settings.informationFactions || [],
      ...patch
    })
  });
  closeModal();
  await bootstrap();
}

function openInformationRightsModal() {
  openModal(`
    <h3>Rechte bearbeiten</h3>
    <label>Rechte Belehrung<textarea id="informationRightsBriefText" rows="7">${escapeHtml(state.settings.informationRightsBriefText || "")}</textarea></label>
    <label>Rechte Definition<textarea id="informationRightsText" rows="12">${escapeHtml(state.settings.informationRightsText || "")}</textarea></label>
    <p class="muted">Überschriften mit ##, dicke Schrift mit **Text**.</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions"><button class="ghost-btn" data-close>Abbrechen</button><button class="blue-btn" id="saveInformationRights">Speichern</button></div>
  `, (modal) => {
    modal.querySelector("#saveInformationRights").addEventListener("click", async () => {
      try {
        await saveInformationPatch({ informationRightsBriefText: $("#informationRightsBriefText").value, informationRightsText: $("#informationRightsText").value });
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openInformationLinkModal(link = null) {
  openModal(`
    <h3>${link ?"Weiterleitung bearbeiten" : "Weiterleitung hinzufügen"}</h3>
    <label>Titel<input id="informationLinkTitle" value="${escapeHtml(link?.title || "")}"></label>
    <label>Link<input id="informationLinkUrl" value="${escapeHtml(link?.url || "")}" placeholder="https://..."></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions"><button class="ghost-btn" data-close>Abbrechen</button><button class="blue-btn" id="saveInformationLink">Speichern</button></div>
  `, (modal) => {
    modal.querySelector("#saveInformationLink").addEventListener("click", async () => {
      try {
        const title = $("#informationLinkTitle").value.trim();
        const url = $("#informationLinkUrl").value.trim();
        if (!title || !url) throw new Error("Titel und Link sind erforderlich.");
        await saveInformationPatch({ informationLinks: upsertById(state.settings.informationLinks, { id: link?.id, title, url }) });
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openInformationPermitModal(permit = null) {
  openModal(`
    <h3>${permit ?"Sondergenehmigung bearbeiten" : "Sondergenehmigung hinzufügen"}</h3>
    <label>Vor- und Nachname<input id="informationPermitName" value="${escapeHtml(permit?.name || "")}"></label>
    <label>Beschreibung<textarea id="informationPermitDescription">${escapeHtml(permit?.description || "")}</textarea></label>
    <label>Gültig Bis<input id="informationPermitValidUntil" type="date" value="${escapeHtml(permit?.validUntil || "")}"></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions"><button class="ghost-btn" data-close>Abbrechen</button><button class="blue-btn" id="saveInformationPermit">Speichern</button></div>
  `, (modal) => {
    modal.querySelector("#saveInformationPermit").addEventListener("click", async () => {
      try {
        const name = $("#informationPermitName").value.trim();
        const description = $("#informationPermitDescription").value.trim();
        const validUntil = $("#informationPermitValidUntil").value;
        if (!name || !description || !validUntil) throw new Error("Alle Felder sind erforderlich.");
        await saveInformationPatch({ informationPermits: upsertById(state.settings.informationPermits, { id: permit?.id, name, description, validUntil }) });
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openInformationFactionModal(faction = null) {
  openModal(`
    <h3>${faction ?"Fraktion bearbeiten" : "Fraktion hinzufügen"}</h3>
    <label>Organisation<input id="informationFactionOrganization" value="${escapeHtml(faction?.organization || "")}"></label>
    <label>Status
      <select id="informationFactionStatus">
        ${["Normal", "Mittel", "Hoch"].map((status) => `<option ${faction?.status === status ?"selected" : ""}>${status}</option>`).join("")}
      </select>
    </label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions"><button class="ghost-btn" data-close>Abbrechen</button><button class="blue-btn" id="saveInformationFaction">Speichern</button></div>
  `, (modal) => {
    modal.querySelector("#saveInformationFaction").addEventListener("click", async () => {
      try {
        const organization = $("#informationFactionOrganization").value.trim();
        const status = $("#informationFactionStatus").value;
        if (!organization) throw new Error("Organisation ist erforderlich.");
        await saveInformationPatch({ informationFactions: upsertById(state.settings.informationFactions, { id: faction?.id, organization, status }) });
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

async function deleteInformationItem(key, id) {
  try {
    await saveInformationPatch({ [key]: (state.settings[key] || []).filter((item) => item.id !== id) });
  } catch (error) {
    showNotify(error.message, "error");
  }
}

function openDeleteInformationConfirm(key, id, title = "Eintrag löschen?") {
  openModal(`
    <h3>${escapeHtml(title)}</h3>
    <p class="muted">Dieser Eintrag wird dauerhaft entfernt.</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="red-btn" id="confirmInformationDelete">Löschen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmInformationDelete").addEventListener("click", async () => {
      try {
        await deleteInformationItem(key, id);
        closeModal();
        renderInformation();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function renderDirektion() {
  if (!canSeeDepartment("Direktion")) {
    content.innerHTML = `<section class="panel"><h3>Kein Zugriff</h3><p class="muted">Dieser Bereich ist nur für die Direktion sichtbar.</p></section>`;
    return;
  }
  const directionDepartment = state.departments.find((department) => department.id === "direktion");
  const directionMembersCount = directionDepartment?.members.length || 0;
  const activeUserIds = new Set((state.users || []).map((user) => user.id));
  const activeStrikeCount = (state.disciplinary || [])
    .filter((entry) => activeUserIds.has(entry.userId) && isActiveDisciplinaryStrike(entry))
    .reduce((sum, entry) => sum + Math.max(1, Number(entry.strikeCount || 1)), 0);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const monthFines = (state.disciplinary || []).filter((entry) => activeUserIds.has(entry.userId) && isDisciplinaryFine(entry) && new Date(entry.createdAt) >= monthStart);
  const openFines = monthFines.filter(isOpenDisciplinaryFine);
  const monthFineAmount = monthFines.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const activeAbsences = (state.absences || []).filter(absenceIsActive).length;
  const inactiveCount = inactiveDirectionUsers().length;
  const memberTabs = [
    ["members", "Mitglieder"],
    ["activity", `Aktivitätscheck${inactiveCount ?` (${inactiveCount})` : ""}`],
    ["absences", "Abmeldungen"],
    ["upranks", "Upranks"],
    ["uprankRules", "Uprank Voraussetzungen"],
    ["fluctuation", "Mitgliederfluktation"],
    ["hours", "Dienstzeiten"]
  ];
  const tabs = [
    ["overview", "Übersicht"],
    ["memberManagement", "Mitgliederverwaltung"],
    ["sanctions", `Sanktionsfälle${sanctionApprovalQueue().length + openSanctionCases().length + rejectedSanctionCases().length ?` (${sanctionApprovalQueue().length + openSanctionCases().length + rejectedSanctionCases().length})` : ""}`],
    ["dnBlacklist", "DN Blacklist"],
    ["logs", "Logs"]
  ];
  if (memberTabs.some(([id]) => id === state.directionTab)) {
    state.directionMemberTab = state.directionTab;
    state.directionTab = "memberManagement";
    localStorage.setItem("lspd_direction_tab", state.directionTab);
    localStorage.setItem("lspd_direction_member_tab", state.directionMemberTab);
  }
  if (!tabs.some(([id]) => id === state.directionTab)) state.directionTab = "overview";
  if (!memberTabs.some(([id]) => id === state.directionMemberTab)) state.directionMemberTab = "members";

  content.innerHTML = `
    <section class="internal-subhead department-overview-head">
      <h2>Direktion Abteilung</h2>
      <div class="department-control-row">
        <div class="tabs-row direction-tabs">
          ${tabs.map(([id, label]) => `<button class="${state.directionTab === id ?"tab-active" : ""} ${id === "sanctions" && sanctionApprovalQueue().length + openSanctionCases().length ?"tab-danger" : ""}" data-direction-tab="${id}">${label}</button>`).join("")}
        </div>
        <button class="blue-btn vote-btn">${iconSvg("Abteilungen")} Abstimmung</button>
      </div>
      ${state.directionTab === "overview" ?`
      <div class="direction-overview-focus">
        <article class="direction-focus-card">
          <span>Mitglieder</span>
          <strong>${state.users.length}</strong>
          <small>Aktive Mitglieder im Dienstblatt</small>
        </article>
        <article class="direction-focus-card muted-card">
          <span>Abmeldungen</span>
          <strong>${activeAbsences}</strong>
          <small>Aktuell aktiv</small>
        </article>
        <article class="direction-focus-card strike-card">
          <span>Aktive Strikes</span>
          <strong>${activeStrikeCount}</strong>
          <small>Nicht archiviert oder abgelaufen</small>
        </article>
        <article class="direction-focus-card fine-card">
          <span>Geldstrafen Monat</span>
          <strong>${monthFines.length}</strong>
          <small>${openFines.length} offen / ${monthFineAmount.toLocaleString("de-DE")} $ gesamt</small>
        </article>
        <article class="direction-focus-card sanction-approval-card ${sanctionApprovalQueue().length ?"danger" : ""}">
          <span>Freigaben</span>
          <strong>${sanctionApprovalQueue().length}</strong>
          <small>Sanktionsvergaben warten auf Direktion</small>
        </article>
      </div>
      ${renderDirectionSanctionApprovalSummary()}
      ${renderDirectionDepartmentContent(directionDepartment, directionMembersCount)}
      ` : ""}
      ${state.directionTab === "memberManagement" ?`
        <div class="panel direction-member-tabs-panel">
          <div class="tabs-row direction-member-tabs">
            ${memberTabs.map(([id, label]) => `<button class="${state.directionMemberTab === id ?"tab-active" : ""}" data-direction-member-tab="${id}">${label}</button>`).join("")}
          </div>
        </div>
        ${state.directionMemberTab === "members" ?renderDirectionMembersPanel() : ""}
        ${state.directionMemberTab === "activity" ?renderDirectionActivityPanel() : ""}
        ${state.directionMemberTab === "absences" ?renderAbsenceOverviewPanel("direction") : ""}
        ${state.directionMemberTab === "upranks" ?renderDirectionUpranksPanel() : ""}
        ${state.directionMemberTab === "uprankRules" ?renderDirectionUprankRulesPanel() : ""}
        ${state.directionMemberTab === "fluctuation" ?renderDirectionFluctuationPanel() : ""}
        ${state.directionMemberTab === "hours" ?renderDirectionHoursPanel() : ""}
      ` : ""}
      ${state.directionTab === "sanctions" ?renderDirectionSanctionCasesPanel() : ""}
      ${state.directionTab === "dnBlacklist" ?renderDirectionDnBlacklistPanel() : ""}
      ${state.directionTab === "logs" ?renderLogsPanel() : ""}
    </section>
  `;

  document.querySelectorAll("[data-direction-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.directionTab = button.dataset.directionTab;
      localStorage.setItem("lspd_direction_tab", state.directionTab);
      updateAppUrl({ replace: true });
      renderDirektion();
    });
  });
  document.querySelectorAll("[data-direction-member-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.directionMemberTab = button.dataset.directionMemberTab;
      localStorage.setItem("lspd_direction_member_tab", state.directionMemberTab);
      updateAppUrl({ replace: true });
      renderDirektion();
    });
  });
  $("#createUserBtn")?.addEventListener("click", () => openUserModal());
  $("#openDirectionSanctions")?.addEventListener("click", () => {
    state.directionTab = "sanctions";
    localStorage.setItem("lspd_direction_tab", state.directionTab);
    updateAppUrl({ replace: true });
    renderDirektion();
  });
  bindSanctionCaseActions();
  $("#addManualDutyBtn")?.addEventListener("click", openManualDutyModal);
  $("#hoursUserSelect")?.addEventListener("change", (event) => {
    localStorage.setItem("lspd_hours_user", event.target.value);
    renderDirektion();
  });
  document.querySelectorAll(".department-add").forEach((button) => button.addEventListener("click", () => openDepartmentMemberModal(directionDepartment)));
  document.querySelectorAll(".department-manage").forEach((button) => button.addEventListener("click", () => openDepartmentManageModal(directionDepartment)));
  document.querySelectorAll(".dept-note-add").forEach((button) => button.addEventListener("click", () => openDepartmentNoteModal(directionDepartment)));
  document.querySelectorAll(".user-actions").forEach((button) => button.addEventListener("click", () => openUserActionsModal(state.users.find((user) => user.id === button.dataset.id))));
  document.querySelectorAll(".reset-member-password").forEach((button) => button.addEventListener("click", () => openResetPasswordModal(state.users.find((user) => user.id === button.dataset.userId))));
  document.querySelectorAll(".reset-member-discord").forEach((button) => button.addEventListener("click", () => openResetDiscordModal(state.users.find((user) => user.id === button.dataset.userId))));
  document.querySelectorAll(".archive-delete").forEach((button) => button.addEventListener("click", () => openDeleteUserModal(button.dataset.id)));
  document.querySelectorAll(".archive-rehire").forEach((button) => button.addEventListener("click", () => openRehireUserModal(findAnyUser(button.dataset.id))));
  bindUprankActions();
  $("#uprankSearch")?.addEventListener("input", (event) => {
    localStorage.setItem("lspd_uprank_search", event.target.value);
    updateUprankList();
  });
  $("#uprankRulesForm")?.addEventListener("submit", saveUprankRules);
  $("#dnBlacklistForm")?.addEventListener("submit", saveDnBlacklist);
  bindFluctuationActions();
  setupTableFilter("#directionMembersSearch");
  $("#directionMembersSearch")?.addEventListener("input", (event) => localStorage.setItem("lspd_direction_members_search", event.target.value));
  if ($("#directionMembersSearch")?.value) $("#directionMembersSearch")?.dispatchEvent(new Event("input"));
  setupTableFilter("#directionActivitySearch");
  $("#directionActivitySearch")?.addEventListener("input", (event) => localStorage.setItem("lspd_direction_activity_search", event.target.value));
  if ($("#directionActivitySearch")?.value) $("#directionActivitySearch")?.dispatchEvent(new Event("input"));
  setupTableFilter("#logSearch");
  setupTableFilter("#hoursSearch");
  setupTableFilter("#directionFluctuationSearch");
  setupTableFilter("#absenceSearch");
  $("#absenceSearch")?.addEventListener("input", (event) => localStorage.setItem("lspd_absence_search_direction", event.target.value));
  if ($("#absenceSearch")?.value) $("#absenceSearch")?.dispatchEvent(new Event("input"));
  $("#toggleAbsenceArchive")?.addEventListener("click", () => {
    const open = localStorage.getItem("lspd_absence_archive_direction") === "1";
    localStorage.setItem("lspd_absence_archive_direction", open ?"0" : "1");
    renderDirektion();
  });
  document.querySelectorAll(".end-absence").forEach((button) => button.addEventListener("click", () => openEndAbsenceModal(button.dataset.id, true)));
  document.querySelectorAll(".view-user-absence").forEach((button) => button.addEventListener("click", () => openAbsenceInfoModal(button.dataset.absenceId)));
  document.querySelectorAll(".manage-user-absence").forEach((button) => button.addEventListener("click", () => openAbsenceManageModal(button.dataset.absenceId, button.dataset.canEnd === "1")));
}

function renderDirectionSanctionApprovalSummary() {
  const pending = sanctionApprovalQueue();
  const open = openSanctionCases();
  if (!pending.length && !open.length) return "";
  return `
    <div class="panel direction-sanction-summary">
      <div>
        <span class="eyebrow">Sanktionsfälle</span>
        <h3>${pending.length ?`${pending.length} Freigabe${pending.length === 1 ?"" : "n"} offen` : `${open.length} offene Bearbeitung${open.length === 1 ?"" : "en"}`}</h3>
        <p class="muted">Freigaben werden durch die Direktion geprüft. Danach liegen offene Fälle für Verkündung oder Zahlung bereit.</p>
      </div>
      <button class="red-btn" id="openDirectionSanctions" type="button">${iconSvg("Direktion")} Sanktionsfälle öffnen</button>
    </div>
  `;
}

function renderDirectionSanctionCasesPanel() {
  const pending = sanctionApprovalQueue();
  const open = openSanctionCases();
  const active = (state.disciplinary || []).filter((entry) => isSanctionFileEntry(entry) && sanctionWorkflowStatus(entry) === "active");
  const rejected = rejectedSanctionCases();
  return `
    <div class="panel direction-sanction-cases">
      <div class="panel-header">
        <div>
          <h3>Sanktionsfälle</h3>
          <p class="muted">Freigeben, offene Fälle verfolgen und den Status der betroffenen Person sehen.</p>
        </div>
      </div>
      <div class="sanction-case-grid">
        ${renderSanctionCaseColumn("Warten auf Freigabe", pending, "pending")}
        ${renderSanctionCaseColumn("Offen", open, "open")}
        ${renderSanctionCaseColumn("Aktiv", active, "active")}
        ${renderSanctionCaseColumn("Abgelehnt", rejected, "rejected")}
      </div>
    </div>
  `;
}

function renderSanctionCaseColumn(title, entries, tone) {
  return `
    <section class="sanction-case-column ${tone}">
      <div class="file-section-head"><h4>${escapeHtml(title)}</h4><span>${entries.length}</span></div>
      <div class="sanction-case-list">
        ${entries.map(renderSanctionCaseCard).join("") || `<p class="muted">Keine Einträge.</p>`}
      </div>
    </section>
  `;
}

function renderSanctionCaseCard(entry) {
  const user = findAnyUser(entry.userId) || {};
  const workflow = sanctionWorkflowStatus(entry);
  const onDuty = (state.duty || []).some((duty) => duty.userId === entry.userId);
  const amount = Number(entry.amount || 0);
  const statusLabel = workflow === "pending_approval" ?"Warten auf Freigabe" : workflow === "open" ?"Offen" : workflow === "active" ?"Aktiv" : workflow === "rejected" ?"Abgelehnt" : "Archiv";
  const needsAnnouncement = workflow === "open" && !entry.announcedAt;
  const statusIcon = workflow === "pending_approval" ?"⏳" : workflow === "open" ?"📣" : workflow === "active" ?"✅" : workflow === "rejected" ?"✕" : "🗄️";
  const infoItems = [
    `👤 Vergeben durch ${escapeHtml(entry.submittedBy || entry.actorName || "-")}`,
    entry.approvedBy ?`🛡️ Freigegeben durch ${escapeHtml(entry.approvedBy)}` : "",
    entry.announcedBy ?`📣 Mitgeteilt durch ${escapeHtml(entry.announcedBy)}` : "",
    entry.paidBy ?`💵 Bezahlt an ${escapeHtml(entry.paidTo || "-")}` : "",
    entry.rejectedBy ?`✕ Abgelehnt durch ${escapeHtml(entry.rejectedBy)}` : ""
  ].filter(Boolean);
  return `
    <article class="sanction-case-card ${workflow}">
      <div class="sanction-case-head">
        <div>
          <strong>${escapeHtml(fullName(user))}</strong>
          <small>${escapeHtml(rankLabel(user.rank))} · DN ${escapeHtml(user.dn || "-")}</small>
        </div>
        <span class="online-state ${onDuty ?"online" : "offline"}">${onDuty ?"Online" : "Offline"}</span>
      </div>
      <div class="sanction-case-body">
        <div class="sanction-case-title-row">
          <b>${escapeHtml(entry.title || entry.sanctionType || entry.type || "Sanktion")}</b>
          <span class="sanction-status-chip">${statusIcon} ${escapeHtml(statusLabel)}</span>
        </div>
        <div class="sanction-case-facts">
          ${amount ?`<span class="fine">💵 ${amount.toLocaleString("de-DE")} $</span>` : ""}
          ${Number(entry.strikeCount || 0) ?`<span class="strike">⚠️ ${Number(entry.strikeCount)} Strike</span>` : ""}
        </div>
        ${entry.reason ?`<p class="sanction-case-reason"><em>Grund</em>${escapeHtml(entry.reason)}</p>` : ""}
        ${entry.rejectedReason ?`<p class="sanction-case-reason rejected"><em>Ablehnungsgrund</em>${escapeHtml(entry.rejectedReason)}</p>` : ""}
        <div class="sanction-case-timeline">
          ${infoItems.map((item) => `<span>${item}</span>`).join("")}
        </div>
      </div>
      <div class="sanction-case-actions">
        ${workflow === "pending_approval" && canApprovePersonnelSanctions() ?`<button class="blue-btn approve-file-entry" data-user-id="${escapeHtml(entry.userId)}" data-id="${escapeHtml(entry.id)}">Freigeben</button>` : ""}
        ${workflow === "pending_approval" && canApprovePersonnelSanctions() ?`<button class="red-btn reject-file-entry" data-user-id="${escapeHtml(entry.userId)}" data-id="${escapeHtml(entry.id)}">Ablehnen</button>` : ""}
        ${needsAnnouncement ?`<button class="orange-btn announce-file-entry" data-user-id="${escapeHtml(entry.userId)}" data-id="${escapeHtml(entry.id)}">Mitgeteilt</button>` : ""}
        ${workflow === "open" && isDisciplinaryFine(entry) && entry.announcedAt ?`<button class="orange-btn mark-fine-paid" data-user-id="${escapeHtml(entry.userId)}" data-id="${escapeHtml(entry.id)}">Bezahlt</button>` : ""}
        <button class="ghost-btn open-personnel-file" data-user-id="${escapeHtml(entry.userId)}">Personalakte öffnen</button>
      </div>
    </article>
  `;
}

function bindSanctionCaseActions() {
  document.querySelectorAll(".direction-sanction-cases .open-personnel-file").forEach((button) => button.addEventListener("click", () => openPersonnelFileModal(findAnyUser(button.dataset.userId))));
  document.querySelectorAll(".direction-sanction-cases .approve-file-entry").forEach((button) => button.addEventListener("click", () => openApproveSanctionModal(findAnyUser(button.dataset.userId), (state.disciplinary || []).find((entry) => entry.id === button.dataset.id))));
  document.querySelectorAll(".direction-sanction-cases .reject-file-entry").forEach((button) => button.addEventListener("click", () => openRejectSanctionModal(findAnyUser(button.dataset.userId), (state.disciplinary || []).find((entry) => entry.id === button.dataset.id), { returnToDirection: true })));
  document.querySelectorAll(".direction-sanction-cases .announce-file-entry").forEach((button) => button.addEventListener("click", () => openAnnounceSanctionModal(findAnyUser(button.dataset.userId), (state.disciplinary || []).find((entry) => entry.id === button.dataset.id))));
  document.querySelectorAll(".direction-sanction-cases .mark-fine-paid").forEach((button) => button.addEventListener("click", () => openFinePaidModal(findAnyUser(button.dataset.userId), (state.disciplinary || []).find((entry) => entry.id === button.dataset.id))));
}

function renderDirectionDepartmentContent(department, memberCount = department?.members?.length || 0) {
  if (!department) return "";
  const canMembers = departmentActionAllowed(department, "departmentMembers");
  const canNotes = departmentActionAllowed(department, "departmentNotes");
  return `
    <div class="department-layout department-overview-content">
      <div class="panel">
        <div class="panel-header">
          <h3><span class="section-icon">${iconSvg("Mitglieder")}</span>Abteilungsmitglieder <span class="heading-count">${memberCount}</span></h3>
          ${canMembers ?`<button class="blue-btn department-manage" data-department-id="${escapeHtml(department.id)}">${iconSvg("Mitglieder")} Personal verwalten</button>` : ""}
        </div>
        ${renderDepartmentMemberTable(department)}
      </div>
      <div class="panel">
        <div class="panel-header">
          <h3><span class="section-icon">${iconSvg("Einsatzzentrale")}</span>Notizen</h3>
          ${canNotes ?`<button class="blue-btn dept-note-add" data-department-id="${escapeHtml(department.id)}">+ Neue Notiz</button>` : ""}
        </div>
        <div class="note-list">
          ${department.notes.length ?department.notes.map((note) => renderDepartmentNote(department, note)).join("") : `<p class="muted">Noch keine Notizen vorhanden.</p>`}
        </div>
      </div>
    </div>
  `;
}

function renderDirectionMembersPanel() {
  const archiveRows = state.archivedUsers || [];
  const rows = sortMembersForRankList(state.users);
  const search = localStorage.getItem("lspd_direction_members_search") || "";
  return `
    <div class="panel department-overview-content">
      <div class="panel-header">
        <h3>Mitgliederverwaltung</h3>
        <button class="blue-btn" id="createUserBtn">Neues Mitglied einstellen</button>
      </div>
      <div class="filter-row members-search-row">
        <input id="directionMembersSearch" value="${escapeHtml(search)}" placeholder="Mitglied, DN, Telefon, Rang, Rolle oder letzten Dienst suchen">
      </div>
      ${renderDirectionDisciplinaryOverview()}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Telefon</th><th>DN</th><th>Rang</th><th>Rolle</th><th>Status</th><th>Letzter Dienst</th><th>Akte</th><th>Aktionen</th></tr></thead>
          <tbody>
            ${rows.map((user) => {
              const isFrakverwaltung = isFrakverwaltungUser(user);
              return `
              <tr class="filterable-row ${userStatusRowClass(user)} ${isFrakverwaltung ?"member-row-frakverwaltung" : ""} ${activeAbsenceForUser(user.id) ?"member-row-absence" : ""}" data-search="${escapeHtml(memberSearchText(user))}">
                <td><strong>${escapeHtml(fullName(user))}</strong><small class="table-subline">Einstellung: ${formatDate(user.joinedAt)}</small>${userAbsenceBadge(user, "button")}</td>
                <td>${escapeHtml(user.phone)}</td>
                <td>${escapeHtml(user.dn)}</td>
                <td>${isFrakverwaltung ?`<span class="frakverwaltung-pill">Frakverwaltung</span>` : escapeHtml(rankLabel(user.rank))}</td>
                <td>${roleBadges(user)}</td>
                <td>${renderAccountStatus(user)}</td>
                <td>${renderLastDutyCell(user)}</td>
                <td>${renderDirectionFileSummary(user)}</td>
                <td>
                  <div class="button-row">
                    <button class="mini-icon user-actions" data-id="${user.id}" title="Aktionen">${actionIcon("edit")}</button>
                    <button class="mini-icon reset-member-password" data-user-id="${escapeHtml(user.id)}" title="Passwort Reset">${iconSvg("Lock")}</button>
                    <button class="mini-icon reset-member-discord" data-user-id="${escapeHtml(user.id)}" title="Discord Reset">${iconSvg("Discord")}</button>
                  </div>
                </td>
              </tr>
            `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>
    <div class="panel department-overview-content">
      <div class="panel-header">
        <h3>Archiv</h3>
        <span class="muted">${archiveRows.length} entlassene Accounts</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Kündigungsgrund</th><th>Alte DN</th><th>Alter Rang</th><th>Alte Ausbildungen</th><th>Entlassen am</th><th>Aktionen</th></tr></thead>
          <tbody>
            ${archiveRows.map((user) => {
              const info = terminationInfo(user);
              return `
              <tr>
                <td>${escapeHtml(fullName(user))}</td>
                <td>${escapeHtml(info.reason || "-")}</td>
                <td>${escapeHtml(info.oldDn || "-")}</td>
                <td>${escapeHtml(rankLabel(info.oldRank))}</td>
                <td class="archive-training-list">${renderTrainingSummary(info.oldTrainings)}</td>
                <td>${formatDateTime(info.terminatedAt)}</td>
                <td>
                  <div class="button-row">
                    <button class="blue-btn archive-rehire" data-id="${escapeHtml(user.id)}">Wiedereinstellen</button>
                    ${canDeleteAccounts() ?`<button class="mini-icon danger archive-delete" data-id="${escapeHtml(user.id)}" title="Löschen">${actionIcon("delete")}</button>` : ""}
                  </div>
                </td>
              </tr>`;
            }).join("") || `<tr><td colspan="7" class="muted">Noch keine entlassenen Personen im Archiv.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderDirectionActivityPanel() {
  const inactiveRows = inactiveDirectionUsers();
  const search = localStorage.getItem("lspd_direction_activity_search") || "";
  let lastActivityGroup = "";
  const activityRowsHtml = inactiveRows.map((user) => {
    const activity = lastDutyActivityForUser(user.id);
    const groupLabel = activity ?`${activity.days} Tage ohne Dienst` : "Noch nie eingetragen";
    const groupHeader = groupLabel !== lastActivityGroup
      ?`<tr class="activity-group-row"><td colspan="6"><span>${escapeHtml(groupLabel)}</span></td></tr>`
      : "";
    lastActivityGroup = groupLabel;
    return `
      ${groupHeader}
      <tr class="filterable-row activity-row-stale" data-search="${escapeHtml(memberSearchText(user))}">
        <td><strong>${escapeHtml(fullName(user))}</strong><small class="table-subline">${escapeHtml(user.phone || "-")}</small></td>
        <td>${escapeHtml(user.dn || "-")}</td>
        <td>${isFrakverwaltungUser(user) ?`<span class="frakverwaltung-pill activity-rank-pill">Frakverwaltung</span>` : `<span class="activity-rank-pill">${escapeHtml(rankLabel(user.rank))}</span>`}</td>
        <td>${renderLastDutyCell(user)}</td>
        <td><span class="file-pill open">${escapeHtml(groupLabel)}</span></td>
        <td><button class="mini-icon user-actions" data-id="${escapeHtml(user.id)}" title="Aktionen">${actionIcon("edit")}</button></td>
      </tr>
    `;
  }).join("");
  return `
    <div class="panel department-overview-content direction-activity-panel">
      <div class="panel-header">
        <div>
          <h3>Aktivitätscheck</h3>
          <p class="muted">Zeigt Mitglieder, die seit mehr als 3 Tagen nicht im Dienst eingetragen waren. Aktive Abmeldungen werden ausgeblendet.</p>
        </div>
        <span class="activity-warning-pill">${inactiveRows.length} inaktiv</span>
      </div>
      <div class="filter-row members-search-row">
        <input id="directionActivitySearch" value="${escapeHtml(search)}" placeholder="Inaktive Person, DN, Rang oder letzten Dienst suchen">
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>DN</th><th>Rang</th><th>Letzter Dienst</th><th>Status</th><th>Aktionen</th></tr></thead>
          <tbody>
            ${activityRowsHtml || `<tr><td colspan="6" class="muted">Keine inaktiven Mitglieder ohne Abmeldung gefunden.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function terminationInfo(user) {
  const fallback = (state.settings.fluctuation || []).find((row) => row.userId === user.id && row.type === "Kündigung") || {};
  return {
    reason: user.termination?.reason || fallback.reason || "",
    oldRank: user.termination?.oldRank ?? fallback.rank ?? user.rank,
    oldDn: user.termination?.oldDn ?? fallback.dn ?? user.dn,
    oldTrainings: user.termination?.oldTrainings || user.trainings || {},
    terminatedAt: user.termination?.terminatedAt || fallback.createdAt || user.updatedAt
  };
}

function userAccountStatus(user) {
  return user?.accountStatus || (user?.terminated ?"Entlassen" : user?.locked ?"Gesperrt" : "Aktiv");
}

function userStatusRowClass(user) {
  const status = userAccountStatus(user);
  if (status === "Suspendiert") return "member-row-suspended";
  if (status === "Gesperrt") return "member-row-locked";
  return "";
}

function renderAccountStatus(user) {
  const status = userAccountStatus(user);
  const className = status === "Aktiv" ?"active" : status === "Suspendiert" ?"suspended" : "locked";
  return `<span class="account-status-chip ${className}">${escapeHtml(status)}</span>`;
}

function dnConflictFor(dn, currentUserId = "") {
  const value = String(dn || "").trim();
  if (!value) return null;
  const isCurrentUserDn = [...(state.users || []), ...(state.archivedUsers || [])].some((item) => item.id === currentUserId && String(item.dn || "") === value);
  if (!isCurrentUserDn && (state.settings.dnBlacklist || []).includes(value)) return { blacklisted: true, dn: value };
  return [...(state.users || []), ...(state.archivedUsers || [])].find((item) => item.id !== currentUserId && String(item.dn || "") === value);
}

function nextFreeDienstnummer(start = 20) {
  const used = new Set([...(state.users || []), ...(state.archivedUsers || [])]
    .map((user) => Number.parseInt(user.dn, 10))
    .filter((dn) => Number.isInteger(dn) && dn >= start));
  (state.settings.dnBlacklist || [])
    .map((dn) => Number.parseInt(dn, 10))
    .filter((dn) => Number.isInteger(dn) && dn >= start)
    .forEach((dn) => used.add(dn));
  let dn = start;
  while (used.has(dn)) dn += 1;
  return String(dn);
}

function renderDnConflictBox(holder, dn) {
  if (!holder) return "";
  if (holder.blacklisted) {
    return `
      <div class="info-box full dn-conflict-box">
        <strong>Dienstnummer gesperrt</strong>
        <p>DN ${escapeHtml(dn)} ist durch die Direktion gesperrt und kann nicht vergeben werden.</p>
      </div>
    `;
  }
  const info = terminationInfo(holder);
  const status = userAccountStatus(holder);
  return `
    <div class="info-box full dn-conflict-box">
      <strong>Dienstnummer bereits vergeben</strong>
      <p>DN ${escapeHtml(dn)} ist vergeben an ${escapeHtml(fullName(holder))} - Status: ${escapeHtml(status)}${holder.terminated ?` - Entlassen am ${formatDateTime(info.terminatedAt)}` : ""}</p>
      ${holder.terminated ?`<label class="checkbox-line">Dienstnummer überschreiben und beim archivierten Account entfernen<input type="checkbox" id="overwriteDn"></label>` : `<p class="form-error">Aktive Mitglieder können nicht überschrieben werden.</p>`}
    </div>
  `;
}

function renderTrainingSummary(trainingsMap = {}) {
  const done = visibleTrainings().filter((training) => trainingsMap?.[training]);
  return done.length ?done.map((training) => `<span class="training-mini">${escapeHtml(trainingDisplayName(training))}</span>`).join("") : `<span class="muted">Keine</span>`;
}

function renderTrainingPicker(selectedTrainings = {}) {
  return `
    <div class="training-picker">
      ${visibleTrainingGroups().map((group) => `
        <section class="training-picker-group">
          <div class="training-picker-title">${escapeHtml(group.title)}</div>
          <div class="training-picker-grid">
            ${group.trainings.map((training) => `
              <label class="training-toggle">
                <input type="checkbox" name="training_${training}" ${selectedTrainings[training] ?"checked" : ""}>
                <span>${escapeHtml(trainingDisplayName(training))}</span>
              </label>
            `).join("")}
          </div>
        </section>
      `).join("")}
    </div>
  `;
}

function openMemberModulesModal(user) {
  if (!hasRole("Direktion")) {
    showNotify("Nur Direktion und IT dürfen Module im Mitglieder-Reiter bearbeiten.", "error");
    return;
  }
  if (!user || isFrakverwaltungUser(user)) {
    showNotify("Für Frakverwaltung können keine Module vergeben werden.", "error");
    return;
  }
  openModal(`
    <h3>Module bearbeiten</h3>
    <p class="muted">${escapeHtml(fullName(user))} · DN ${escapeHtml(user.dn || "-")} · ${escapeHtml(rankLabel(user.rank))}</p>
    <div class="button-row full">
      <button class="ghost-btn compact-action" type="button" id="grantAllMemberModules">Alle vergeben</button>
      <button class="ghost-btn compact-action" type="button" id="revokeAllMemberModules">Alle entfernen</button>
    </div>
    <div class="full">
      ${renderTrainingPicker(user.trainings || {})}
    </div>
    <p id="modalError" class="form-error full"></p>
    <div class="modal-actions full">
      <button class="ghost-btn" type="button" data-close>Abbrechen</button>
      <button class="blue-btn" type="button" id="saveMemberModules">Module speichern</button>
    </div>
  `, (modal) => {
    const setAll = (checked) => {
      modal.querySelectorAll('.training-picker input[type="checkbox"]').forEach((input) => {
        input.checked = checked;
      });
    };
    modal.querySelector("#grantAllMemberModules")?.addEventListener("click", () => setAll(true));
    modal.querySelector("#revokeAllMemberModules")?.addEventListener("click", () => setAll(false));
    modal.querySelector("#saveMemberModules")?.addEventListener("click", async () => {
      const selected = Object.fromEntries(visibleTrainings().map((training) => [
        training,
        Boolean(modal.querySelector(`[name="training_${CSS.escape(training)}"]`)?.checked)
      ]));
      try {
        const data = await api(`/api/users/${user.id}/trainings`, {
          method: "PATCH",
          body: JSON.stringify({ trainings: selected })
        });
        state.users = state.users.map((item) => item.id === user.id ?data.user : item);
        closeModal();
        renderMembers();
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

function renderItToggleOld(checked = false) {
  return `
    <label class="it-toggle">
      <input type="checkbox" name="isIT" ${checked ?"checked" : ""}>
      <span class="it-toggle-ui"></span>
      <span><b>IT-Rolle</b><small>Zusätzliche Systemrechte vergeben</small></span>
    </label>
  `;
}

function editableRoleOptions(user = null) {
  return state.roles.filter((role) => !["IT", "IT-Leitung"].includes(role));
}

function baseRoleForUser(user = null) {
  return user?.baseRole || (["IT", "IT-Leitung"].includes(user?.role) ?"Direktion" : user?.role || "User");
}

function renderItRoleControls(user = null) {
  const isIt = ["IT", "IT-Leitung"].includes(user?.role);
  const isLead = user?.role === "IT-Leitung";
  const disabled = canGrantItRoles() ?"" : "disabled";
  return `
    <div class="it-role-controls full">
      <label class="it-toggle">
        <input type="checkbox" name="isIT" ${isIt ?"checked" : ""} ${disabled}>
        <span class="it-toggle-ui"></span>
        <span><b>IT</b><small>Zusätzliche IT-Rechte</small></span>
      </label>
      <label class="it-toggle">
        <input type="checkbox" name="isITLead" ${isLead ?"checked" : ""} ${disabled}>
        <span class="it-toggle-ui"></span>
        <span><b>IT-Leitung</b><small>Darf IT-Rollen vergeben</small></span>
      </label>
    </div>
  `;
}

function renderTeamlerControl(user = null) {
  return `
    <label class="it-toggle">
      <input type="checkbox" name="teamler" ${user?.teamler ?"checked" : ""}>
      <span class="it-toggle-ui"></span>
      <span><b>Teamler</b><small>Darf Admin Dienst stempeln</small></span>
    </label>
  `;
}

function renderDirectionFluctuationPanel() {
  const rows = state.settings.fluctuation || [];
  const canManage = canManageFluctuation();
  return `
    <div class="panel department-overview-content">
      <div class="panel-header"><h3>Mitgliederfluktation</h3><input id="directionFluctuationSearch" class="compact-input" placeholder="Suchen"></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>DN</th><th>Rang</th><th>Bearbeitet von</th><th>Typ</th><th>Grund</th><th>Datum</th>${canManage ?"<th>Aktionen</th>" : ""}</tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr class="filterable-row">
                <td>${escapeHtml(row.name)}</td>
                <td>${escapeHtml(row.dn || "-")}</td>
                <td>${escapeHtml(fluctuationRankLabel(row))}</td>
                <td>${escapeHtml(row.actorName || "-")}</td>
                <td><span class="fluctuation-chip ${fluctuationTypeClass(row)}">${escapeHtml(row.type)}</span></td>
                <td>${escapeHtml(row.reason || "-")}</td>
                <td>${formatDateTime(row.createdAt)}</td>
                ${canManage ?`<td><span class="button-row"><button class="mini-icon edit-fluctuation" data-id="${escapeHtml(row.id)}" title="Bearbeiten">${actionIcon("edit")}</button><button class="mini-icon danger delete-fluctuation" data-id="${escapeHtml(row.id)}" title="Löschen">${actionIcon("delete")}</button></span></td>` : ""}
              </tr>
            `).join("") || `<tr><td colspan="${canManage ?8 : 7}" class="muted">Noch keine Einträge.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function isDismissedFluctuation(row) {
  return row?.type === "Kündigung";
}

function isFrakverwaltungFluctuation(row) {
  if (!row) return false;
  if (/frakverwaltung|fraktionsverwaltung|frakverwalter/i.test(`${row.role || ""} ${row.baseRole || ""} ${row.name || ""} ${row.reason || ""}`)) return true;
  const user = row.userId ?findAnyUser(row.userId) : null;
  return isFrakverwaltungUser(user);
}

function fluctuationRankLabel(row) {
  return isFrakverwaltungFluctuation(row) ?"Fraktionsverwaltung" : rankLabel(row?.rank);
}

function fluctuationTypeClass(row) {
  return row?.type === "Eingestellt" ?"hired" : "dismissed";
}

function fluctuationById(id) {
  return (state.settings.fluctuation || []).find((row) => row.id === id);
}

function datetimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function bindFluctuationActions() {
  if (!canManageFluctuation()) return;
  document.querySelectorAll(".edit-fluctuation").forEach((button) => {
    button.addEventListener("click", () => openFluctuationModal(fluctuationById(button.dataset.id)));
  });
  document.querySelectorAll(".delete-fluctuation").forEach((button) => {
    button.addEventListener("click", () => openDeleteFluctuationModal(fluctuationById(button.dataset.id)));
  });
}

function openFluctuationModal(row) {
  if (!row || !canManageFluctuation()) return;
  const selectedType = isDismissedFluctuation(row) ?"Kündigung" : "Eingestellt";
  openModal(`
    <h3>Fluktuationseintrag bearbeiten</h3>
    <form id="fluctuationForm" class="modal-form">
      <label>Name<input id="fluctuationName" required value="${escapeHtml(row.name || "")}"></label>
      <label>DN<input id="fluctuationDn" value="${escapeHtml(row.dn || "")}"></label>
      <label>Rang<select id="fluctuationRank">${state.ranks.map((rank) => `<option value="${rank.level}" ${Number(row.rank) === Number(rank.level) ?"selected" : ""}>${escapeHtml(rankOptionLabel(rank))}</option>`).join("")}</select></label>
      <label>Bearbeitet von<input id="fluctuationActor" value="${escapeHtml(row.actorName || "")}"></label>
      <label>Typ<select id="fluctuationType"><option ${selectedType === "Eingestellt" ?"selected" : ""}>Eingestellt</option><option ${selectedType === "Kündigung" ?"selected" : ""}>Kündigung</option></select></label>
      <label>Grund<textarea id="fluctuationReason" rows="4">${escapeHtml(row.reason || "")}</textarea></label>
      <label>Datum<input id="fluctuationCreatedAt" type="datetime-local" value="${datetimeLocalValue(row.createdAt)}"></label>
      <div class="modal-actions">
        <button type="button" class="ghost-btn" onclick="closeModal()">Abbrechen</button>
        <button class="blue-btn">Speichern</button>
      </div>
    </form>
  `, () => {
    $("#fluctuationForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = await api(`/api/settings/fluctuation/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: $("#fluctuationName").value,
          dn: $("#fluctuationDn").value,
          rank: Number($("#fluctuationRank").value),
          actorName: $("#fluctuationActor").value,
          type: $("#fluctuationType").value,
          reason: $("#fluctuationReason").value,
          createdAt: $("#fluctuationCreatedAt").value
        })
      });
      state.settings.fluctuation = data.fluctuation || state.settings.fluctuation;
      closeModal();
      renderApp();
    });
  });
}

function openDeleteFluctuationModal(row) {
  if (!row || !canManageFluctuation()) return;
  openModal(`
    <h3>Fluktuationseintrag löschen</h3>
    <p class="muted">Dieser Eintrag wird dauerhaft aus Direktion und aus dem Reiter Mitgliederfluktation entfernt.</p>
    <div class="profile-summary">
      <strong>${escapeHtml(row.name || "-")}</strong>
      <span>${escapeHtml(row.type || "-")} · ${formatDateTime(row.createdAt)}</span>
    </div>
    <div class="modal-actions">
      <button type="button" class="ghost-btn" onclick="closeModal()">Abbrechen</button>
      <button id="confirmDeleteFluctuation" class="red-btn">Löschen</button>
    </div>
  `, () => {
    $("#confirmDeleteFluctuation").addEventListener("click", async () => {
      const data = await api(`/api/settings/fluctuation/${row.id}`, { method: "DELETE" });
      state.settings.fluctuation = data.fluctuation || [];
      closeModal();
      renderApp();
    });
  });
}

function renderDirectionHoursPanel() {
  const rows = state.dutyHistory || [];
  const selectedUserId = localStorage.getItem("lspd_hours_user") || "all";
  const scopedRows = selectedUserId === "all" ?rows : rows.filter((entry) => entry.userId === selectedUserId);
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sumFrom = (from = null) => scopedRows.filter((entry) => !from || new Date(entry.startedAt) >= from).reduce((sum, entry) => sum + durationMs(entry), 0);
  return `
    <div class="panel department-overview-content">
      <div class="panel-header">
        <h3>Dienstzeiten Verwaltung</h3>
        <div class="button-row">
          <select id="hoursUserSelect" class="compact-input">
            <option value="all">Alle Mitglieder</option>
            ${state.users.map((user) => `<option value="${user.id}" ${selectedUserId === user.id ?"selected" : ""}>${escapeHtml(fullName(user))}</option>`).join("")}
          </select>
          <button class="blue-btn" id="addManualDutyBtn">Stunden hinzufügen</button>
        </div>
      </div>
      <div class="grid-4 compact-stats">
        <div class="stat-card"><span>Heute</span><strong>${formatDuration(sumFrom(dayStart))}</strong><small>${selectedUserId === "all" ?"Alle Mitglieder" : "Ausgewähltes Mitglied"}</small></div>
        <div class="stat-card"><span>Woche</span><strong>${formatDuration(sumFrom(weekStart))}</strong><small>Letzte 7 Tage</small></div>
        <div class="stat-card"><span>Monat</span><strong>${formatDuration(sumFrom(monthStart))}</strong><small>Aktueller Monat</small></div>
        <div class="stat-card"><span>Gesamt</span><strong>${formatDuration(sumFrom())}</strong><small>Alle Zeiten</small></div>
      </div>
      <div class="filter-row">
        <input id="hoursSearch" placeholder="Name, Diensttyp oder Status suchen">
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Dienstbeginn</th><th>Dienstende</th><th>Diensttyp</th><th>Dauer</th><th>Status</th></tr></thead>
          <tbody>
            ${scopedRows.map((entry) => `
              <tr class="filterable-row">
                <td>${escapeHtml(fullName(entry.user || findAnyUser(entry.userId)) || "-")}</td>
                <td>${formatDateTime(entry.startedAt)}</td>
                <td>${entry.endedAt ?formatDateTime(entry.endedAt) : "Läuft noch"}</td>
                <td>${escapeHtml(entry.status)}</td>
                <td>${formatDuration(durationMs(entry))}</td>
                <td>${entry.endedAt ?"Beendet" : "Aktiv"}</td>
              </tr>
            `).join("") || `<tr><td colspan="6" class="muted">Noch keine Dienstzeiten.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function uprankRules() {
  return Array.isArray(state.settings.uprankRules) ?state.settings.uprankRules : [];
}

function uprankAdjustmentsFor(userId, targetRank, type = "") {
  return (state.settings.uprankAdjustments || []).filter((item) =>
    item.userId === userId &&
    Number(item.targetRank) === Number(targetRank) &&
    (!type || item.type === type)
  );
}

function daysSince(dateValue) {
  const time = new Date(dateValue || Date.now()).getTime();
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

function effectiveRankDaysForUser(user) {
  const start = new Date(user.lastPromotionAt || user.joinedAt || Date.now());
  const rawDays = daysSince(start);
  const pauseDays = (state.absences || [])
    .filter((absence) => absence.userId === user.id)
    .reduce((sum, absence) => {
      const absenceStart = new Date(`${absence.startDate}T00:00:00`);
      const absenceEnd = new Date(`${absence.endedAt ?isoDateLocal(new Date(absence.endedAt)) : absence.endDate}T00:00:00`);
      const from = new Date(Math.max(start.getTime(), absenceStart.getTime()));
      const to = new Date(Math.min(Date.now(), absenceEnd.getTime()));
      if (to < from) return sum;
      const days = Math.floor((to - from) / 86400000) + 1;
      return sum + Math.max(0, days - 3);
    }, 0);
  return Math.max(0, rawDays - pauseDays);
}

function activeUprankBlockForUser(userId) {
  const blocks = (state.disciplinary || [])
    .filter((entry) => entry.userId === userId && entry.uprankBlockedUntil && !entry.archivedAt && entry.uprankBlockedUntil >= isoDateLocal(new Date()))
    .sort((a, b) => String(b.uprankBlockedUntil).localeCompare(String(a.uprankBlockedUntil)));
  return blocks[0] || null;
}

function dutySumForUser(userId, from) {
  return (state.dutyHistory || [])
    .filter((entry) => entry.userId === userId && (!from || new Date(entry.startedAt) >= from))
    .reduce((sum, entry) => sum + durationMs(entry), 0);
}

function lastDutyEntryForUser(userId) {
  return [...(state.duty || []), ...(state.dutyHistory || [])]
    .filter((entry) => entry.userId === userId && entry.startedAt)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0] || null;
}

function lastDutyActivityForUser(userId) {
  const entry = lastDutyEntryForUser(userId);
  if (!entry?.startedAt) return null;
  const startedAt = new Date(entry.startedAt);
  if (Number.isNaN(startedAt.getTime())) return null;
  const diffMs = Date.now() - startedAt.getTime();
  const days = Math.max(0, Math.floor(diffMs / 86400000));
  return { entry, startedAt, days };
}

function lastDutyActivityLabel(user) {
  const activity = lastDutyActivityForUser(user?.id);
  if (!activity) return "Noch nie eingetragen";
  if ((state.duty || []).some((entry) => entry.userId === user.id)) return "Aktuell im Dienst";
  if (activity.days === 0) return "Heute";
  if (activity.days === 1) return "Gestern";
  return `Vor ${activity.days} Tagen`;
}

function inactiveDirectionUsers() {
  const activeDutyUserIds = new Set((state.duty || []).map((entry) => entry.userId));
  return sortMembersForRankList(state.users || [])
    .filter((user) => !isFrakverwaltungUser(user))
    .filter((user) => !activeDutyUserIds.has(user.id))
    .filter((user) => !activeAbsenceForUser(user.id))
    .filter((user) => {
      const activity = lastDutyActivityForUser(user.id);
      return !activity || activity.days > 3;
    })
    .sort((a, b) => {
      const activityA = lastDutyActivityForUser(a.id);
      const activityB = lastDutyActivityForUser(b.id);
      const daysA = activityA ?activityA.days : Number.MAX_SAFE_INTEGER;
      const daysB = activityB ?activityB.days : Number.MAX_SAFE_INTEGER;
      if (daysA !== daysB) return daysA - daysB;
      const rankA = Number(a.rank || 0);
      const rankB = Number(b.rank || 0);
      if (rankA !== rankB) return rankB - rankA;
      return fullName(a).localeCompare(fullName(b), "de");
    });
}

function renderLastDutyCell(user) {
  const activity = lastDutyActivityForUser(user.id);
  const isOnline = (state.duty || []).some((entry) => entry.userId === user.id);
  const stale = !activity || activity.days > 3;
  return `
    <span class="last-duty-cell ${isOnline ?"online" : stale ?"stale" : "fresh"}">
      <strong>${escapeHtml(lastDutyActivityLabel(user))}</strong>
      <small>${activity ?formatDateTime(activity.startedAt.toISOString()) : "Keine Diensthistorie"}</small>
    </span>
  `;
}

function isOpenNegativeFileEntry(entry) {
  if (!entry || entry.type === "Aktennotiz") return false;
  if (entry.archivedAt) return false;
  const workflow = sanctionWorkflowStatus(entry);
  if (workflow === "pending_approval") return false;
  if (workflow === "open") return true;
  if (workflow === "rejected") return false;
  if (workflow === "archive") return false;
  const hasFine = isDisciplinaryFine(entry);
  const hasStrike = isDisciplinaryStrike(entry);
  if (hasFine && !entry.paidAt) return true;
  if (hasStrike && !entry.strikeResolvedAt) {
    if (entry.expiresAt && new Date(entry.expiresAt) <= new Date()) return false;
    return true;
  }
  return Boolean(entry.uprankBlockedUntil && entry.uprankBlockedUntil >= isoDateLocal(new Date()));
}

function isDisciplinaryStrike(entry) {
  return entry?.type === "Strike" || entry?.sanctionType === "Strike" || Number(entry?.strikeCount || 0) > 0;
}

function isSanctionFileEntry(entry) {
  return Boolean(entry && (entry.type === "Sanktion" || entry.type === "Strike" || entry.type === "Geldstrafe" || isDisciplinaryFine(entry)));
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
    if (isDisciplinaryFine(entry) && !entry.paidAt) return "open";
    return "active";
  }
  if (isDisciplinaryFine(entry) && !entry.paidAt) return "open";
  if (isDisciplinaryStrike(entry) && !entry.strikeResolvedAt) return "active";
  if (entry.uprankBlockedUntil && entry.uprankBlockedUntil >= isoDateLocal(new Date())) return "active";
  return "archive";
}

function isFileEntryResolvable(entry) {
  if (!entry || entry.archivedAt || (entry.expiresAt && new Date(entry.expiresAt) <= new Date())) return false;
  const workflow = sanctionWorkflowStatus(entry);
  if (workflow === "pending_approval" || workflow === "open") return false;
  const fineDone = !isDisciplinaryFine(entry) || Boolean(entry.paidAt);
  const strikeDone = !isDisciplinaryStrike(entry) || Boolean(entry.strikeResolvedAt);
  return fineDone && strikeDone;
}

function openNegativeEntriesForUser(userId) {
  return (state.disciplinary || []).filter((entry) => entry.userId === userId && isOpenNegativeFileEntry(entry));
}

function evaluateUprank(user, targetRankOverride = null) {
  const currentRank = Number(user.rank || 0);
  const targetRank = Number(targetRankOverride || currentRank + 1);
  const rule = uprankRules().find((item) => Number(item.targetRank) === targetRank) || { targetRank, minDays: 14, trainings: [], specialOnly: targetRank >= 7 };
  const reduction = uprankAdjustmentsFor(user.id, targetRank, "Verkürzung").reduce((sum, item) => sum + Number(item.days || 0), 0);
  const extension = uprankAdjustmentsFor(user.id, targetRank, "Verlängerung").reduce((sum, item) => sum + Number(item.days || 0), 0);
  const effectiveDays = Math.max(0, Number(rule.minDays || 0) - reduction + extension);
  const daysOnRank = effectiveRankDaysForUser(user);
  const blockEntry = activeUprankBlockForUser(user.id);
  const blockMissingDays = blockEntry ?Math.max(1, daysSince(new Date()) + Math.ceil((new Date(`${blockEntry.uprankBlockedUntil}T00:00:00`) - Date.now()) / 86400000)) : 0;
  const missingDays = Math.max(0, effectiveDays - daysOnRank, blockMissingDays);
  const missingTrainings = (rule.trainings || []).filter((training) => !user.trainings?.[training]);
  const hasSpecial = uprankAdjustmentsFor(user.id, targetRank, "Sonderuprank").length > 0;
  const negativeEntries = openNegativeEntriesForUser(user.id);
  const hiddenSpecialRank = targetRank >= 10;
  const regularReady = missingDays === 0 && missingTrainings.length === 0;
  return {
    user,
    targetRank,
    rule,
    reduction,
    extension,
    effectiveDays,
    daysOnRank,
    missingDays,
    blockEntry,
    missingTrainings,
    hasSpecial,
    hiddenSpecialRank,
    negativeEntries,
    hasNegative: negativeEntries.length > 0,
    regularReady,
    ready: !hiddenSpecialRank && ((regularReady && !rule.specialOnly) || hasSpecial),
    needsSpecial: !hiddenSpecialRank && regularReady && rule.specialOnly && !hasSpecial
  };
}

function allUprankRows() {
  const maxRank = Math.max(...state.ranks.map((rank) => Number(rank.value)));
  const rows = [];
  const seen = new Set();
  const specialByUser = new Map();
  (state.settings?.uprankAdjustments || [])
    .filter((item) => item.type === "Sonderuprank")
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .forEach((item) => {
      if (!specialByUser.has(item.userId)) specialByUser.set(item.userId, item);
    });
  const addRow = (user, targetRank = null) => {
    if (!user || user.terminated || Number(user.rank) >= maxRank) return;
    const resolvedTarget = Number(targetRank || Number(user.rank) + 1);
    if (!Number.isFinite(resolvedTarget) || resolvedTarget <= Number(user.rank)) return;
    const key = `${user.id}:${resolvedTarget}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(evaluateUprank(user, resolvedTarget));
  };
  state.users.forEach((user) => {
    const special = specialByUser.get(user.id);
    addRow(user, special ?Number(special.targetRank) : null);
  });
  return rows;
}

function renderDirectionUpranksPanel() {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const searchValue = localStorage.getItem("lspd_uprank_search") || "";
  const searchTerm = searchValue.trim().toLowerCase();
  const allRows = allUprankRows();
  const visibleRows = allRows
    .filter((row) => {
      const searchText = `${fullName(row.user)} ${row.user.dn || ""} ${rankLabel(row.user.rank)} ${rankLabel(row.targetRank)} ${row.missingTrainings.join(" ")}`.toLowerCase();
      if (searchTerm) return smartSearchMatch(searchText, searchTerm);
      if (row.blockEntry) return false;
      return row.ready || row.needsSpecial || (row.hasNegative && row.regularReady);
    })
    .sort((a, b) => {
      const specialA = a.rule.specialOnly || a.hasSpecial || a.needsSpecial;
      const specialB = b.rule.specialOnly || b.hasSpecial || b.needsSpecial;
      if (specialA !== specialB) return Number(specialA) - Number(specialB);
      return a.targetRank - b.targetRank || a.user.lastName.localeCompare(b.user.lastName);
    });
  const readyCount = allRows.filter((row) => row.ready && !row.hasNegative).length;
  const specialCount = allRows.filter((row) => row.needsSpecial).length;
  const negativeCount = allRows.filter((row) => row.hasNegative && row.regularReady).length;
  return `
    <div class="panel department-overview-content">
      <div class="panel-header">
        <h3>Upranks</h3>
        <span class="muted">${readyCount} bereit \u00b7 ${specialCount} Sonderuprank n\u00f6tig \u00b7 ${negativeCount} mit offener Akte</span>
      </div>
      <div class="uprank-search-row">
        <input id="uprankSearch" placeholder="Person suchen, um Uprank-Status zu pr\u00fcfen" value="${escapeHtml(searchValue)}">
        <small>${searchTerm ?"Suchmodus: alle passenden Personen werden angezeigt." : "Standard: nur berechtigte oder Sonderuprank-relevante Personen."}</small>
      </div>
      <div class="uprank-list">
        ${visibleRows.map((row) => renderUprankCard(row, weekStart, monthStart, Boolean(searchTerm))).join("") || `<p class="muted">${searchTerm ?"Keine Person gefunden." : "Keine Uprank-Kandidaten vorhanden."}</p>`}
      </div>
    </div>
  `;
}

function renderDirectionRankChangesPanel() {
  return renderPromotionAnnouncements();
}

function promotionLogEntry(log = {}) {
  const details = log.details || {};
  const beforeRank = Number(details.before?.rank);
  const afterRank = Number(details.after?.rank);
  if (!Number.isFinite(beforeRank) || !Number.isFinite(afterRank) || beforeRank === afterRank) return null;
  const beforeUser = details.before || {};
  const afterUser = details.after || {};
  const personId = String(afterUser.id || beforeUser.id || "");
  const target = cleanText(fullName(afterUser) || fullName(beforeUser) || log.target || "Unbekannt");
  const createdAt = String(log.createdAt || "");
  return {
    log,
    key: [personId || target, beforeRank, afterRank, createdAt.slice(0, 10)].join(":"),
    target,
    beforeRank,
    afterRank,
    type: afterRank < beforeRank ?"demotion" : "promotion",
    details: `${rankLabel(beforeRank)} -> ${rankLabel(afterRank)}`
  };
}

function rankChangeLogs() {
  const unique = new Map();
  (state.logs || [])
    .map(promotionLogEntry)
    .filter(Boolean)
    .sort((a, b) => String(b.log?.createdAt || "").localeCompare(String(a.log?.createdAt || "")))
    .forEach((entry) => {
      const existing = unique.get(entry.key);
      const entryAction = cleanText(entry.log?.action || "");
      const existingAction = cleanText(existing?.log?.action || "");
      if (!existing || (/Uprank durchgeführt|Rang/i.test(entryAction) && !/Uprank durchgeführt|Rang/i.test(existingAction))) {
        unique.set(entry.key, entry);
      }
    });
  return [...unique.values()]
    .sort((a, b) => String(b.log?.createdAt || "").localeCompare(String(a.log?.createdAt || "")))
    .slice(0, 250);
}

function groupedPromotionLogs(rows = []) {
  return rows.reduce((groups, entry) => {
    const day = String(entry.log?.createdAt || "").slice(0, 10) || "Unbekannt";
    const existing = groups.find((group) => group.day === day);
    if (existing) existing.entries.push(entry);
    else groups.push({ day, entries: [entry] });
    return groups;
  }, []);
}

function renderPromotionAnnouncements() {
  const rows = rankChangeLogs();
  const groups = groupedPromotionLogs(rows);
  return `
    <section class="promotion-page">
      <div class="promotion-page-head">
        <div>
          <span class="eyebrow">Personalankündigungen</span>
          <h2>Beförderungen / Degradierungen</h2>
        </div>
        <span>${rows.length} Einträge</span>
      </div>
      <div class="promotion-announcement-list">
        ${groups.map((group) => `
          <section class="promotion-day-group">
            <div class="promotion-day-heading">
              <strong>${escapeHtml(formatDate(group.day))}</strong>
              <span>${group.entries.length} ${group.entries.length === 1 ?"Eintrag" : "Einträge"}</span>
            </div>
            <div class="promotion-day-list">
              ${group.entries.map((entry) => {
                const demotion = entry.type === "demotion";
                return `
                  <article class="promotion-announcement ${demotion ?"demotion" : "promotion"}">
                    <div class="promotion-announcement-icon">${demotion ?"↓" : "↑"}</div>
                    <div>
                      <span>${escapeHtml(demotion ?"Degradierung" : "Beförderung")}</span>
                      <strong>${escapeHtml(entry.target)}</strong>
                      <p>${escapeHtml(entry.details)}</p>
                      <small>${formatTime(entry.log?.createdAt)} · Eingetragen von ${escapeHtml(entry.log?.actorName || "-")}</small>
                    </div>
                  </article>
                `;
              }).join("")}
            </div>
          </section>
        `).join("") || `<div class="panel"><p class="muted">Noch keine Beförderungen oder Degradierungen dokumentiert.</p></div>`}
      </div>
    </section>
  `;
}

function currentUprankRows(searchTerm = "") {
  const allRows = allUprankRows();
  return allRows
    .filter((row) => {
      const searchText = `${fullName(row.user)} ${row.user.dn || ""} ${rankLabel(row.user.rank)} ${rankLabel(row.targetRank)} ${row.missingTrainings.join(" ")}`.toLowerCase();
      if (searchTerm) return smartSearchMatch(searchText, searchTerm);
      if (row.blockEntry) return false;
      return row.ready || row.needsSpecial || (row.hasNegative && row.regularReady);
    })
    .sort((a, b) => {
      const specialA = a.rule.specialOnly || a.hasSpecial || a.needsSpecial;
      const specialB = b.rule.specialOnly || b.hasSpecial || b.needsSpecial;
      if (specialA !== specialB) return Number(specialA) - Number(specialB);
      return a.targetRank - b.targetRank || a.user.lastName.localeCompare(b.user.lastName);
    });
}

function updateUprankList() {
  const input = $("#uprankSearch");
  const list = document.querySelector(".uprank-list");
  if (!input || !list) return;
  const searchTerm = input.value.trim().toLowerCase();
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const rows = currentUprankRows(searchTerm);
  list.innerHTML = rows.map((row) => renderUprankCard(row, weekStart, monthStart, Boolean(searchTerm))).join("") || `<p class="muted">${searchTerm ?"Keine Person gefunden." : "Keine Uprank-Kandidaten vorhanden."}</p>`;
  const hint = document.querySelector(".uprank-search-row small");
  if (hint) hint.textContent = searchTerm ?"Suchmodus: alle passenden Personen werden angezeigt." : "Standard: nur berechtigte oder Sonderuprank-relevante Personen.";
  bindUprankActions();
}

function bindUprankActions() {
  document.querySelectorAll(".uprank-run").forEach((button) => button.addEventListener("click", () => openUprankModal(findAnyUser(button.dataset.id), button.dataset.special === "true", Number(button.dataset.targetRank || 0))));
  document.querySelectorAll(".uprank-open-file").forEach((button) => button.addEventListener("click", () => openPersonnelFileModal(findAnyUser(button.dataset.id))));
  document.querySelectorAll(".uprank-shorten").forEach((button) => button.addEventListener("click", () => openUprankAdjustmentModal(findAnyUser(button.dataset.id), "Verkürzung")));
  document.querySelectorAll(".uprank-special").forEach((button) => button.addEventListener("click", () => openUprankAdjustmentModal(findAnyUser(button.dataset.id), "Sonderuprank")));
  document.querySelectorAll(".uprank-extend").forEach((button) => button.addEventListener("click", () => openUprankAdjustmentModal(findAnyUser(button.dataset.id), "Verlängerung")));
  document.querySelectorAll(".uprank-block").forEach((button) => button.addEventListener("click", () => openUprankBlockModal(findAnyUser(button.dataset.id))));
  document.querySelectorAll(".uprank-remove-special").forEach((button) => button.addEventListener("click", () => openRemoveUprankAdjustmentModal(findAnyUser(button.dataset.id), button.dataset.adjustmentId)));
}

function isUprankReleaseWindow(date = new Date()) {
  return [0, 6].includes(date.getDay());
}

function renderUprankCard(row, weekStart, monthStart, isSearchMode) {
  const weekHours = formatDuration(dutySumForUser(row.user.id, weekStart));
  const monthHours = formatDuration(dutySumForUser(row.user.id, monthStart));
  const releaseWindow = isUprankReleaseWindow();
  const previewReady = row.ready && !row.hasSpecial && !releaseWindow;
  const cardClass = row.hasNegative ?"negative-file" : previewReady ?"preview-ready" : row.ready ?"ready" : row.needsSpecial ?"special-required" : "";
  const daysText = row.effectiveDays === 0
    ?`${row.daysOnRank} Tage auf Rang${row.reduction ?` \u00b7 ${row.reduction} Tage Verk\u00fcrzung` : ""}${row.extension ?` \u00b7 ${row.extension} Tage Verl\u00e4ngerung` : ""}`
    : `${Math.min(row.daysOnRank, row.effectiveDays)}/${row.effectiveDays} Tage auf Rang${row.reduction ?` \u00b7 ${row.reduction} Tage Verk\u00fcrzung` : ""}${row.extension ?` \u00b7 ${row.extension} Tage Verl\u00e4ngerung` : ""}`;
  const canRun = (row.ready && !previewReady) || row.needsSpecial || row.hasSpecial;
  const missingTrainingText = row.missingTrainings.map((training) => trainingDisplayName(training)).join(", ");
  const accountStatus = userAccountStatus(row.user);
  const missingItems = [
    row.hiddenSpecialRank ?"nur Sonderfreigabe möglich" : "",
    row.missingDays ?`${row.missingDays} Tage fehlen` : "",
    row.blockEntry ?`Uprank-Sperre bis ${formatDate(row.blockEntry.uprankBlockedUntil)}` : "",
    row.rule.specialOnly && !row.hasSpecial ?"Sonderuprank-Freigabe fehlt" : ""
  ].filter(Boolean);
  const negativeText = row.negativeEntries.map(formatUprankNegativeEntry).join(" · ");
  const specialAdjustment = uprankAdjustmentsFor(row.user.id, row.targetRank, "Sonderuprank")
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
  return `
    <article class="uprank-card ${cardClass}">
      <div class="uprank-main">
        <strong>${escapeHtml(fullName(row.user))}</strong>
        <span>${escapeHtml(rankLabel(row.user.rank))} \u2192 ${escapeHtml(rankLabel(row.targetRank))}</span>
        <small>${daysText}</small>
      </div>
      <div class="uprank-facts">
        ${row.missingDays ?`<span class="requirement-chip missing">${row.missingDays} Tage fehlen</span>` : ""}
        ${row.blockEntry ?`<span class="requirement-chip danger">Uprank-Sperre bis ${formatDate(row.blockEntry.uprankBlockedUntil)}</span>` : ""}
        ${row.missingTrainings.length ?`<span class="requirement-chip missing">Fehlt: ${escapeHtml(missingTrainingText)}</span>` : ""}
        ${row.rule.specialOnly || row.hiddenSpecialRank ?`<span class="requirement-chip special">${row.hiddenSpecialRank ?"Nur Direktion/Sonderfreigabe" : "Nur Sonderuprank"}</span>` : ""}
        ${row.ready && !row.hasNegative ?`<span class="requirement-chip ${previewReady ?"preview" : "ok"}">${previewReady ?"Vormerkung für Samstag" : "Uprank bereit"}</span>` : ""}
        ${row.needsSpecial ?`<span class="requirement-chip special">Sonderuprank nötig</span>` : ""}
        ${row.hasSpecial ?`<span class="requirement-chip special">Manueller Sonderuprank vorgemerkt</span>` : ""}
        <span class="requirement-chip">Woche ${weekHours}</span>
        <span class="requirement-chip">Monat ${monthHours}</span>
        ${accountStatus !== "Aktiv" ?`<span class="requirement-chip danger">${escapeHtml(accountStatus)}</span>` : ""}
      </div>
      ${row.hasNegative ?`
        <div class="uprank-file-alert">
          <strong>Offene Akte</strong>
          <span>${escapeHtml(negativeText || "Offener Eintrag vorhanden")}</span>
        </div>
      ` : ""}
      <div class="uprank-actions">
        ${canRun && !row.hasNegative ?`<button class="blue-btn uprank-run" data-id="${escapeHtml(row.user.id)}" data-target-rank="${escapeHtml(row.targetRank)}" data-special="${row.hasSpecial || row.rule.specialOnly}">${row.ready ?"Befördern" : "Prüfen"}</button>` : previewReady ?`<div class="uprank-missing-box preview"><strong>Ab Samstag</strong><span>Dieser Uprank ist möglich und wird vor Sonntag grün freigegeben.</span></div>` : isSearchMode && missingItems.length ?`<div class="uprank-missing-box"><strong>Prüfen</strong><span>${escapeHtml(missingItems.join(" · "))}</span></div>` : ""}
        ${row.hasNegative ?`<button class="red-btn uprank-open-file" data-id="${escapeHtml(row.user.id)}">Akte öffnen</button>` : ""}
        <button class="ghost-btn uprank-shorten" data-id="${escapeHtml(row.user.id)}">Verk\u00fcrzung</button>
        <button class="ghost-btn uprank-extend" data-id="${escapeHtml(row.user.id)}">Dauer verl\u00e4ngern</button>
        <button class="ghost-btn uprank-block" data-id="${escapeHtml(row.user.id)}">Uprank-Sperre</button>
        <button class="orange-btn uprank-special" data-id="${escapeHtml(row.user.id)}">Sonderuprank</button>
        ${specialAdjustment ?`<button class="mini-icon danger uprank-remove-special" data-id="${escapeHtml(row.user.id)}" data-adjustment-id="${escapeHtml(specialAdjustment.id || "sonderuprank")}" title="Sonderuprank entziehen">${actionIcon("delete")}</button>` : ""}
      </div>
    </article>
  `;
}

function formatUprankNegativeEntry(entry) {
  const amount = Number(entry?.amount || 0);
  const isStrike = entry?.type === "Strike" || entry?.sanctionType === "Strike";
  const base = entry?.sanctionType === "Geldstrafe" || entry?.type === "Geldstrafe"
    ?"Geldstrafe"
    : `${entry?.sanctionType || entry?.type || "Eintrag"}${isStrike && Number(entry?.strikeCount || 0) > 1 ?` (${Number(entry.strikeCount)})` : ""}`;
  return amount > 0 && base !== "Geldstrafe" ?`${base} + Geldstrafe ${amount.toLocaleString("de-DE")} $` : amount > 0 ?`Geldstrafe ${amount.toLocaleString("de-DE")} $` : base;
}
function renderDirectionUprankRulesPanel() {
  const rules = uprankRules();
  return `
    <form id="uprankRulesForm" class="panel department-overview-content">
      <div class="panel-header">
        <h3>Uprank Voraussetzungen</h3>
        <button class="blue-btn" id="saveUprankRulesButton" type="submit">${uprankRulesSaving ?"Speichert..." : "Voraussetzungen speichern"}</button>
      </div>
      <div class="uprank-rule-list">
        ${rules.map((rule) => `
          <section class="uprank-rule-card" data-target-rank="${rule.targetRank}">
            <div>
              <strong>${escapeHtml(rankLabel(Number(rule.targetRank) - 1))} → ${escapeHtml(rankLabel(rule.targetRank))}</strong>
              <small>Zielrang ${rule.targetRank}</small>
            </div>
            <label>Min. Tage auf Rang<input type="number" min="0" name="minDays_${rule.targetRank}" value="${Number(rule.minDays || 0)}"></label>
            <label class="compact-rule-toggle">
              <input type="checkbox" name="specialOnly_${rule.targetRank}" ${rule.specialOnly ?"checked" : ""}>
              <span>Nur Sonderuprank</span>
            </label>
            <div class="rule-training-grid">
              ${visibleTrainings().map((training) => `
                <label class="training-toggle">
                  <input type="checkbox" name="rule_${rule.targetRank}_${training}" ${rule.trainings?.includes(training) ?"checked" : ""}>
                  <span>${escapeHtml(trainingDisplayName(training))}</span>
                </label>
              `).join("")}
            </div>
          </section>
        `).join("")}
      </div>
      <p id="uprankRulesError" class="${uprankRulesSaving ?"muted" : "form-error"}">${uprankRulesSaving ?"Speichert gerade. Weitere Änderungen werden danach automatisch mitgespeichert." : ""}</p>
    </form>
  `;
}

function renderDirectionDnBlacklistPanel() {
  const blacklist = state.settings.dnBlacklist || [];
  return `
    <form id="dnBlacklistForm" class="panel department-overview-content">
      <div class="panel-header">
        <div>
          <h3>Dienstnummer Blacklist</h3>
          <p class="muted">Gesperrte Dienstnummern werden nicht automatisch vergeben und können nicht manuell eingetragen werden.</p>
        </div>
        <button class="blue-btn" type="submit">Blacklist speichern</button>
      </div>
      <label class="full">Gesperrte Dienstnummern
        <textarea id="dnBlacklistInput" rows="8" placeholder="Eine Dienstnummer pro Zeile oder mit Komma trennen">${escapeHtml(blacklist.join("\n"))}</textarea>
      </label>
      <div class="info-box full">
        <strong>Aktuell gesperrt</strong>
        <p>${blacklist.length ?blacklist.map((dn) => `<span class="training-mini">DN ${escapeHtml(dn)}</span>`).join("") : `<span class="muted">Keine Dienstnummern gesperrt.</span>`}</p>
      </div>
      <p id="dnBlacklistError" class="form-error"></p>
    </form>
  `;
}

function renderLogsPanel() {
  const rows = (state.logs || []).filter((log) => {
    if (hasRole("IT-Leitung")) return true;
    return !["Postfach Chat administrativ geöffnet", "Jumpscare ausgelöst"].includes(cleanText(log.action));
  });
  return `
    <div class="panel department-overview-content">
      <div class="panel-header"><h3>Website Logs</h3><span class="muted">${rows.length} Einträge</span></div>
      <div class="filter-row">
        <input id="logSearch" placeholder="Aktion, Person, Ziel oder Änderung suchen">
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Zeit</th><th>Wer</th><th>Aktion</th><th>Ziel</th><th>Beschreibung</th></tr></thead>
          <tbody>
            ${rows.map((log) => `
              <tr class="filterable-row ${logTone(log.action)}">
                <td>${formatDateTime(log.createdAt)}</td>
                <td>${escapeHtml(log.actorName || "-")}</td>
                <td><span class="log-action-chip">${escapeHtml(cleanText(log.action))}</span></td>
                <td>${escapeHtml(cleanText(log.target || "-"))}</td>
                <td>${renderLogDetails(log)}</td>
              </tr>
            `).join("") || `<tr><td colspan="5" class="muted">Noch keine Logs.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderFluctuation() {
  const rows = state.settings.fluctuation || [];
  const selectedRange = localStorage.getItem("lspd_fluctuation_range") || "Monat";
  const from = rangeStart(selectedRange);
  const rangeRows = rows.filter((row) => !from || new Date(row.createdAt) >= from);
  const monthLabel = new Date().toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  const grouped = rangeRows.reduce((acc, row) => {
    const key = new Date(row.createdAt).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
    acc[key] ||= { hired: 0, dismissed: 0 };
    if (row.type === "Eingestellt") acc[key].hired += 1;
    if (isDismissedFluctuation(row)) acc[key].dismissed += 1;
    return acc;
  }, {});
  const summary = Object.entries(grouped).length ?Object.entries(grouped) : [[monthLabel, { hired: 0, dismissed: 0 }]];
  const totalHired = rangeRows.filter((row) => row.type === "Eingestellt").length;
  const totalDismissed = rangeRows.filter(isDismissedFluctuation).length;
  content.innerHTML = `
    <section class="panel fluctuation-summary">
      <div class="panel-header">
        <h3>Fluktuation Statistik</h3>
        <select id="fluctuationRange" class="compact-input">
          ${["Heute", "Woche", "Monat", "Gesamt"].map((range) => `<option ${selectedRange === range ?"selected" : ""}>${range}</option>`).join("")}
        </select>
      </div>
      <div class="fluctuation-summary-grid">
        <div class="fluctuation-total summary-green"><span>Einstellungen</span><strong>${totalHired}</strong></div>
        <div class="fluctuation-total summary-red"><span>Kündigungen</span><strong>${totalDismissed}</strong></div>
        <div class="fluctuation-summary-list">
          ${summary.map(([label, item]) => `
            <div class="fluctuation-summary-row">
              <strong>${escapeHtml(label)}</strong>
              <span class="summary-green">+ ${item.hired}</span>
              <span class="summary-red">- ${item.dismissed}</span>
            </div>
          `).join("")}
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-header"><h3>Mitgliederfluktation</h3><span class="muted">${rangeRows.length} Einträge</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Typ</th><th>Grund</th><th>Datum</th></tr></thead>
          <tbody>
            ${rangeRows.length ?rangeRows.map((row) => `
              <tr class="filterable-row">
                <td>${escapeHtml(row.name)}</td>
                <td><span class="fluctuation-chip ${fluctuationTypeClass(row)}">${escapeHtml(row.type)}</span></td>
                <td>${escapeHtml(row.reason || "-")}</td>
                <td>${formatDateTime(row.createdAt)}</td>
              </tr>
            `).join("") : `<tr><td colspan="4" class="muted">Noch keine Einträge.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
  $("#fluctuationRange").addEventListener("change", (event) => {
    localStorage.setItem("lspd_fluctuation_range", event.target.value);
    renderFluctuation();
  });
}

function editableItPages() {
  return orderPages([...pages, ...adminPages, ...(state.customPages || []).map((page) => page.key), ...state.departments.filter((department) => department.id !== "direktion").map((department) => `dept:${department.id}`)]);
}

function orderPages(items) {
  const unique = [...new Set(items.filter(Boolean))];
  const order = state.settings?.pageOrder || [];
  const defaultWeight = new Map(pages.map((page, index) => [page, index]));
  const weight = new Map(order.map((page, index) => [page, index]));
  const sorted = unique.sort((a, b) => {
    const aWeight = weight.has(a) ?weight.get(a) : defaultWeight.has(a) ?defaultWeight.get(a) : 10000 + unique.indexOf(a);
    const bWeight = weight.has(b) ?weight.get(b) : defaultWeight.has(b) ?defaultWeight.get(b) : 10000 + unique.indexOf(b);
    return aWeight - bWeight;
  });
  const learningIndex = sorted.indexOf("Meine Lernkontrollen");
  const trainerIndex = sorted.indexOf("Ausbilderübersicht");
  if (learningIndex !== -1 && trainerIndex !== -1 && trainerIndex !== learningIndex + 1) {
    const [trainerPage] = sorted.splice(trainerIndex, 1);
    sorted.splice(sorted.indexOf("Meine Lernkontrollen") + 1, 0, trainerPage);
  }
  return sorted;
}

function isCustomPage(page) {
  return (state.customPages || []).some((item) => item.key === page);
}

function isInternalSheetPage(page) {
  return page === "IT" || page === "Direktion" || isDepartmentPage(page);
}

function permissionRule(area, key) {
  return state.settings.permissions?.[area]?.[key] || { roles: [], ranks: [], users: [] };
}

function isPageViewRestricted(page) {
  return !Boolean(permissionRule("pages", page).all);
}

function restrictedPageIcon(page) {
  if (!isPageViewRestricted(page)) return "";
  const icon = isInternalSheetPage(page) ?"Lock" : "EyeOff";
  const title = isInternalSheetPage(page) ?"Geschütztes internes Blatt" : "Ausgeblendeter Reiter";
  return `<span class="nav-hidden-eye" title="${title}">${iconSvg(icon)}</span>`;
}

function restrictedPageEditIcon(page) {
  if (!isPageViewRestricted(page)) return "";
  const icon = isInternalSheetPage(page) ?"Lock" : "EyeOff";
  const title = isInternalSheetPage(page) ?"Ansehen ist eingeschränkt" : "Reiter ist ausgeblendet";
  return `<span class="page-lock" title="${title}">${iconSvg(icon)}</span>`;
}

function departmentActionAllowed(department, action) {
  if (!department) return false;
  const key = `${action}:${department.id}`;
  const rule = state.settings?.permissions?.actions?.[key];
  const membership = department.members.find((member) => member.userId === state.currentUser?.id);
  if (isSwatDepartment(department) && ["departmentLeadership", "departmentMembers"].includes(action) && isSwatTeamLeaderMember(membership)) return true;
  if (!rule && action === "departmentLeadership") {
    if (hasRole("Direktion")) return true;
    return departmentLeaderPositionsFor(department).includes(membership?.position);
  }
  return rule ?canAccess("actions", key, "IT") : Boolean(department.canManage);
}

function departmentPositionsFor(department) {
  if (isSwatDepartment(department)) return ["Abteilungsleiter", "Mitglied"];
  const positions = Array.isArray(department?.positions) && department.positions.length ?department.positions : state.departmentPositions;
  return [...new Set(positions || [])];
}

function departmentLeaderPositionsFor(department) {
  if (isSwatDepartment(department)) return ["Abteilungsleiter"];
  const positions = departmentPositionsFor(department);
  const fallback = positions.filter((position) => ["Direktion", "Leitung", "Stv. Leitung"].includes(position));
  const leaders = Array.isArray(department?.leaderPositions) ?department.leaderPositions.filter((position) => positions.includes(position)) : fallback;
  return [...new Set(leaders.length ?leaders : fallback)];
}

function defaultPositionColor(position) {
  if (position === "Direktion" || position === "Anwärter") return "green";
  if (position === "Leitung") return "red";
  if (position === "Stv. Leitung") return "orange";
  if (position === "Mitglied") return "blue";
  return "blue";
}

function positionColorFor(department, position) {
  const color = department?.positionColors?.[position] || defaultPositionColor(position);
  return ["green", "red", "orange", "blue"].includes(color) ?color : defaultPositionColor(position);
}

function positionPowerFor(department, position) {
  const positions = departmentPositionsFor(department);
  const index = positions.indexOf(position);
  return index === -1 ?0 : positions.length - index;
}

function canGrantItRoles() {
  return state.currentUser?.role === "IT-Leitung";
}

function departmentTab(department) {
  const selected = state.page === `dept:${department?.id}` && urlTabParam() ?urlTabParam() : state.departmentTabs?.[department.id] || "overview";
  if (selected === "members" && !isHumanResourcesDepartmentSheet(department)) return "overview";
  if (selected === "leadership" && !departmentActionAllowed(department, "departmentLeadership") && !isHumanResourcesDepartmentSheet(department)) return "overview";
  if (selected === "absences") return isHumanResourcesDepartmentSheet(department) ?"leadership" : "overview";
  if (["estExam", "moduleExam"].includes(selected)) return hasRole("IT") && isTrainingDepartmentSheet(department) ?"hiddenTraining" : "overview";
  if (selected === "hiddenTraining" && (!hasRole("IT") || !isTrainingDepartmentSheet(department))) return "overview";
  if (selected === "moduleGrant" && !isTrainingDepartmentSheet(department)) return "overview";
  if (selected === "trainingDocs" && !isTrainingDepartmentSheet(department)) return "overview";
  return selected;
}

function setDepartmentTab(department, tab) {
  state.departmentTabs = { ...(state.departmentTabs || {}), [department.id]: tab };
  localStorage.setItem("lspd_department_tabs", JSON.stringify(state.departmentTabs));
  updateAppUrl({ replace: true });
}

function isTrainingDepartmentSheet(department) {
  const name = cleanText(department?.name || "");
  return /(training|ausbildung|police academy|academy)/i.test(name) && !/(human|humane|ressource|resource|personalabteilung|personal)/i.test(name);
}

function isHumanResourcesDepartmentSheet(department) {
  const name = cleanText(department?.name || "");
  return /(human|humane|ressource|resource|hr|personalabteilung|personal)/i.test(name);
}

function departmentsForOverview() {
  const departments = [...state.departments];
  const pageOrder = state.settings?.pageOrder || [];
  const originalIndex = new Map(departments.map((department, index) => [department.id, index]));
  return departments.sort((a, b) => {
    if (a.id === "direktion") return -1;
    if (b.id === "direktion") return 1;
    const aOrder = pageOrder.indexOf(`dept:${a.id}`);
    const bOrder = pageOrder.indexOf(`dept:${b.id}`);
    if (aOrder !== -1 || bOrder !== -1) return (aOrder === -1 ?10000 : aOrder) - (bOrder === -1 ?10000 : bOrder);
    return (originalIndex.get(a.id) || 0) - (originalIndex.get(b.id) || 0);
  });
}

function renderPermissionPickList(type, items, selected = []) {
  const placeholders = {
    role: "z.B. User, Supervisor, Direktion",
    department: "z.B. SWAT, Training, Metro",
    position: "z.B. Leitung, Stv. Leitung, Anwärter",
    rank: "z.B. 0, 5, Sergeant, Director",
    user: "z.B. Name, Dienstnummer, Alexa"
  };
  return `
    <div class="permission-picker" data-perm-picker="${type}">
      <input class="permission-search" placeholder="${escapeHtml(placeholders[type] || "Suchen und hinzufügen")}">
      <small class="permission-hint">${escapeHtml(type === "user" ?"Nach Name oder DN suchen und dann aktivieren." : "Suchen, Vorschlag auswählen und per Schalter aktivieren.")}</small>
      <div class="permission-checks">
        ${items.map((item) => {
          const isSelected = selected.includes(item.value);
          return `<label class="permission-toggle ${isSelected ?"selected" : "suggestion-hidden"}"><input type="checkbox" data-perm-${type}="${escapeHtml(item.value)}" ${isSelected ?"checked" : ""}><span class="permission-switch"></span><span>${escapeHtml(item.label)}</span></label>`;
        }).join("")}
      </div>
    </div>
  `;
}

function permissionSummary(area, key) {
  const rule = permissionRule(area, key);
  if (rule.all) return "Alle";
  const parts = [];
  if (rule.roles?.length) parts.push(`${rule.roles.length} Gruppen`);
  if (rule.departments?.length) parts.push(`${rule.departments.length} Abteilungen`);
  if (rule.positions?.length) parts.push(`${rule.positions.length} Positionen`);
  if (rule.ranks?.length) parts.push(`${rule.ranks.length} Ränge`);
  if (rule.users?.length) parts.push(`${rule.users.length} Personen`);
  return parts.length ?parts.join(" / ") : "Nur Standardrechte";
}

function renderPermissionEditor(area, key, label, description = "") {
  const rule = permissionRule(area, key);
  const rankItems = [...state.ranks].sort((a, b) => Number(a.value) - Number(b.value)).map((rank) => ({ value: String(rank.value), label: rankOptionLabel(rank) }));
  const roleItems = state.roles.map((role) => ({ value: role, label: role }));
  const userItems = state.users.map((user) => ({ value: user.id, label: `${fullName(user)} - DN ${user.dn || "-"}` }));
  const departmentItems = state.departments.filter((department) => department.id !== "direktion").map((department) => ({ value: department.id, label: department.name }));
  const positionItems = state.departments.flatMap((department) => departmentPositionsFor(department).map((position) => ({ value: `${department.id}:${position}`, label: `${department.name} - ${position}` })));
  return `
    <article class="permission-row" data-permission-area="${area}" data-permission-key="${escapeHtml(key)}">
      <div class="permission-row-head">
        <div class="permission-copy">
          <strong>${escapeHtml(label)}</strong>
          ${description ?`<small>${escapeHtml(description)}</small>` : ""}
        </div>
        <span class="permission-summary">${escapeHtml(permissionSummary(area, key))}</span>
      </div>
      <label class="permission-all-control"><input type="checkbox" data-perm-all ${rule.all ?"checked" : ""}><span class="permission-switch"></span><span>Alle erlauben</span></label>
      <div class="permission-controls">
        <div><span>Gruppen</span>${renderPermissionPickList("role", roleItems, rule.roles || [])}</div>
        <div><span>Abteilungen</span>${renderPermissionPickList("department", departmentItems, rule.departments || [])}</div>
        <div><span>Positionen</span>${renderPermissionPickList("position", positionItems, rule.positions || [])}</div>
        <div><span>Ränge</span>${renderPermissionPickList("rank", rankItems, (rule.ranks || []).map(String))}</div>
        <div><span>Personen</span>${renderPermissionPickList("user", userItems, rule.users || [])}</div>
      </div>
    </article>
  `;
}
function collectPermissionEditors() {
  const permissions = {
    pages: { ...(state.settings.permissions?.pages || {}) },
    actions: { ...(state.settings.permissions?.actions || {}) }
  };
  document.querySelectorAll("[data-permission-area][data-permission-key]").forEach((row) => {
    permissions[row.dataset.permissionArea][row.dataset.permissionKey] = {
      all: Boolean(row.querySelector("[data-perm-all]")?.checked),
      roles: Array.from(row.querySelectorAll("[data-perm-role]:checked")).map((input) => input.dataset.permRole),
      ranks: Array.from(row.querySelectorAll("[data-perm-rank]:checked")).map((input) => Number(input.dataset.permRank)),
      users: Array.from(row.querySelectorAll("[data-perm-user]:checked")).map((input) => input.dataset.permUser),
      departments: Array.from(row.querySelectorAll("[data-perm-department]:checked")).map((input) => input.dataset.permDepartment),
      positions: Array.from(row.querySelectorAll("[data-perm-position]:checked")).map((input) => input.dataset.permPosition)
    };
  });
  return permissions;
}

function renderITOverviewPanel(editablePages) {
  const activeDuty = state.duty.length;
  const protectedPages = editablePages.filter((page) => isInternalSheetPage(page) && isPageViewRestricted(page)).length;
  const restartTimes = state.settings.restartTimes || [];
  const leadDangerTools = isItLead() ?`
        <section class="it-overview-block it-danger-zone">
          <div><strong>IT-Leitung Bereinigung</strong><small>Endgueltige Aktionen fuer Daten, die bewusst geleert werden sollen.</small></div>
          <div class="it-action-grid compact-actions">
            <button class="it-tool danger-tool" id="clearSeizuresBtn" type="button"><strong>Beschlagnahmungen leeren</strong><span>${(state.settings?.seizures || []).length} Eintraege entfernen</span></button>
            <button class="it-tool danger-tool" id="clearMemberAccountsBtn" type="button"><strong>Mitglieder-Accounts loeschen</strong><span>Alle Accounts ausser deinem entfernen</span></button>
            <button class="it-tool danger-tool" id="clearLogsBtn" type="button"><strong>Logs loeschen</strong><span>${(state.logs || []).length + (state.dutyHistory || []).length + (state.settings?.fluctuation || []).length} Eintraege aus Logs, Dienstzeiten und Fluktation entfernen</span></button>
          </div>
        </section>
  ` : "";
  return `
    <div class="panel it-section-card it-overview-start it-overview-redesign">
      <div class="it-overview-headline">
        <div>
          <h3>IT Übersicht</h3>
          <p class="muted">Zentrale Verwaltung für Sicherungen, Struktur, Sessions und Restarts.</p>
        </div>
        <div class="it-status-strip">
          <span><b>${editablePages.length}</b> Reiter</span>
          <span><b>${state.departments.length}</b> Abteilungen</span>
          <span><b>${activeDuty}</b> im Dienst</span>
          <span><b>${protectedPages}</b> geschützt</span>
        </div>
      </div>
      <div class="it-overview-grid">
        <section class="it-overview-block">
          <div><strong>Daten & Sessions</strong><small>Sichern, importieren und aktive Logins steuern.</small></div>
          <div class="it-action-grid compact-actions">
            <button class="it-tool" id="overviewClearSessions"><strong>Sessions</strong><span>Andere Logins abmelden</span></button>
            <button class="it-tool" id="forceClientRefresh"><strong>Website neu laden</strong><span>Alle Clients Cache leeren lassen</span></button>
          </div>
        </section>
        <section class="it-overview-block">
          <div><strong>Struktur</strong><small>Neue Blätter anlegen und schnell in die Reiterverwaltung springen.</small></div>
          <div class="it-action-grid compact-actions">
            <button class="it-tool" id="overviewCreatePage"><strong>Reiter erstellen</strong><span>Leeres Template-Blatt</span></button>
            <button class="it-tool" id="overviewCreateDepartment"><strong>Abteilung erstellen</strong><span>Abteilungs-Template</span></button>
            <button class="it-tool ${state.settings?.devMode ?"devmode-on" : ""}" id="overviewToggleDevMode"><strong>Devmode</strong><span>${state.settings?.devMode ?"Aktiv" : "Aus"}</span></button>
            <button class="it-tool ${state.settings?.maintenanceMode ?"devmode-on" : ""}" id="overviewToggleMaintenance"><strong>Wartungsarbeiten</strong><span>${state.settings?.maintenanceMode ?"Aktiv" : "Aus"}</span></button>
            <button class="it-tool ${state.settings?.hideDefconCard ?"devmode-on" : ""}" id="overviewToggleDefconCard"><strong>DEFCON Kachel</strong><span>${state.settings?.hideDefconCard ?"Ausgeblendet" : "Sichtbar"}</span></button>
            <button class="it-tool ${state.settings?.hideInformationLinksCard !== false ?"devmode-on" : ""}" id="overviewToggleInformationLinks"><strong>Link Weiterleitung</strong><span>${state.settings?.hideInformationLinksCard !== false ?"Ausgeblendet" : "Sichtbar"}</span></button>
          </div>
        </section>
        ${leadDangerTools}
        <section class="it-overview-block it-overview-restarts">
          <div><strong>Restarts</strong><small>${restartTimes.length ?`${restartTimes.length} Restartzeit${restartTimes.length === 1 ?"" : "en"} aktiv` : "Noch keine Restartzeit angelegt"}</small></div>
          <div class="restart-editor">
            <input id="restartTimeInput" type="time" value="00:00">
            <button class="blue-btn" id="addRestartTime" type="button">Hinzufügen</button>
          </div>
          <div class="restart-list">
            ${restartTimes.map((time) => `
              <span class="restart-chip"><b>${escapeHtml(time)}</b><button class="mini-icon delete-restart-time" type="button" data-time="${escapeHtml(time)}" title="Löschen">${actionIcon("delete")}</button></span>
            `).join("") || `<p class="muted">Noch keine Restartzeiten angelegt.</p>`}
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderITBackupPanel() {
  const backups = [...(state.settings?.backups || [])].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const latest = backups[0];
  return `
    <div class="panel it-section-card it-backup-card">
      <div class="it-section-title">
        <span>06</span>
        <div><h3>Backup</h3><p class="muted">Vollständige Dienstblatt-Datenbank sichern oder wiederherstellen.</p></div>
      </div>
      <div class="backup-status-grid">
        <article class="info-box">
          <strong>Letztes Backup</strong>
          <p>${latest ?`${formatDateTime(latest.createdAt)} · ${escapeHtml(latest.type)}` : "Noch kein Backup vorhanden."}</p>
        </article>
        <article class="info-box">
          <strong>Änderungen seit vorherigem Backup</strong>
          <p>${latest ?Number(latest.changesSinceLast || 0).toLocaleString("de-DE") : "0"}</p>
        </article>
        <article class="info-box">
          <strong>Automatik</strong>
          <p>Täglich um 00:00 Uhr</p>
        </article>
      </div>
      <div class="it-overview-grid">
        <section class="it-overview-block">
          <div><strong>Datensicherung</strong><small>Exportiert alle Daten: Mitglieder, Vorschriften, Reiter, Abteilungen, Logs, Discord Sync und Einstellungen.</small></div>
          <div class="it-action-grid compact-actions">
            <button class="it-tool" id="backupCreateStored" type="button"><strong>Backup erstellen</strong><span>Speichern und bereitstellen</span></button>
            <button class="it-tool" id="backupExportData" type="button"><strong>Direkt exportieren</strong><span>JSON herunterladen</span></button>
          </div>
        </section>
        <section class="it-overview-block">
          <div><strong>Datenimport</strong><small>Importiert eine komplette Dienstblatt-Datensicherung und ersetzt den aktuellen Online-Stand.</small></div>
          <div class="it-action-grid compact-actions">
            <button class="it-tool" id="backupImportData" type="button"><strong>Backup importieren</strong><span>Datenbank wiederherstellen</span></button>
          </div>
        </section>
      </div>
      <div class="backup-list-wrap">
        <div class="panel-header slim">
          <h3>Gespeicherte Backups</h3>
          <span class="muted">${backups.length} Sicherung${backups.length === 1 ?"" : "en"}</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Datum</th><th>Typ</th><th>Erstellt von</th><th>Änderungen</th><th>Größe</th><th>Aktionen</th></tr></thead>
            <tbody>
              ${backups.map((backup) => `
                <tr>
                  <td>${formatDateTime(backup.createdAt)}</td>
                  <td><span class="backup-type-pill ${backup.type === "Manuell" ?"manual" : "auto"}">${escapeHtml(backup.type)}</span></td>
                  <td>${escapeHtml(backup.createdByName || "System")}</td>
                  <td>${Number(backup.changesSinceLast || 0).toLocaleString("de-DE")}</td>
                  <td>${formatBytes(backup.sizeBytes)}</td>
                  <td>
                    <span class="button-row">
                      <button class="blue-btn compact-action backup-download" type="button" data-id="${escapeHtml(backup.id)}">Download</button>
                      <button class="orange-btn compact-action backup-restore" type="button" data-id="${escapeHtml(backup.id)}">Einspielen</button>
                    </span>
                  </td>
                </tr>
              `).join("") || `<tr><td colspan="6" class="muted">Noch keine gespeicherten Backups vorhanden.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderITSecretsPanel() {
  if (!isItLead()) return "";
  if (!itSecrets && !itSecretsLoading) loadITSecrets();
  const secrets = itSecrets || {};
  const secretState = (set) => set ?`<span class="secret-state set">Gesetzt</span>` : `<span class="secret-state missing">Nicht gesetzt</span>`;
  return `
    <div class="panel it-section-card it-secrets-card">
      <div class="it-section-title">
        <span>07</span>
        <div><h3>Secrets & API Daten</h3><p class="muted">Nur IT-Leitung. Secrets werden nicht im Klartext angezeigt und nicht in Git committed.</p></div>
        <button class="blue-btn" id="saveItSecrets" type="button">Speichern</button>
      </div>
      ${itSecretsLoading && !itSecrets ?`<p class="muted">Secrets werden geladen...</p>` : ""}
        <div class="secret-config-grid">
        <section class="secret-config-block">
          <h4>Website / Render</h4>
          <label>Öffentliche Basis-URL<input id="secretPublicBaseUrl" value="${escapeHtml(secrets.publicBaseUrl || "")}" autocomplete="off" placeholder="https://deine-render-domain.onrender.com/"></label>
          <p class="muted">Wird für Discord OAuth Callback und externe Links genutzt. Lokal kann das Feld leer bleiben.</p>
        </section>
        <section class="secret-config-block">
          <h4>Twitch Livecheck</h4>
          <label>Client ID<input id="secretTwitchClientId" value="${escapeHtml(secrets.twitchClientId || "")}" autocomplete="off"></label>
          <label>Client Secret ${secretState(secrets.twitchClientSecretSet)}<input id="secretTwitchClientSecret" type="password" placeholder="${secrets.twitchClientSecretSet ?"Leer lassen zum Behalten" : "Client Secret eintragen"}" autocomplete="new-password"></label>
          <label class="checkbox-line">Twitch Client Secret löschen<input id="clearTwitchClientSecret" type="checkbox"></label>
        </section>
        <section class="secret-config-block">
          <h4>Discord App</h4>
          <label>Client ID / Application ID<input id="secretDiscordApplicationId" value="${escapeHtml(secrets.discordApplicationId || "")}" autocomplete="off" placeholder="Discord Client ID aus dem Developer Portal"></label>
          <label>Public Key<input id="secretDiscordPublicKey" value="${escapeHtml(secrets.discordPublicKey || "")}" autocomplete="off"></label>
          <label>Client Secret ${secretState(secrets.discordClientSecretSet)}<input id="secretDiscordClientSecret" type="password" placeholder="${secrets.discordClientSecretSet ?"Leer lassen zum Behalten" : "Client Secret eintragen"}" autocomplete="new-password"></label>
          <label class="checkbox-line">Discord Client Secret löschen<input id="clearDiscordClientSecretSecret" type="checkbox"></label>
          <p class="muted">Die Discord Client ID ist im Developer Portal die gleiche ID wie die Application ID.</p>
        </section>
        <section class="secret-config-block">
          <h4>Discord Bot & Channels</h4>
          <label>Bot Token ${secretState(secrets.discordBotTokenSet)}<input id="secretDiscordBotToken" type="password" placeholder="${secrets.discordBotTokenSet ?"Leer lassen zum Behalten" : "Bot Token eintragen"}" autocomplete="new-password"></label>
          <label class="checkbox-line">Bot Token löschen<input id="clearDiscordBotTokenSecret" type="checkbox"></label>
          <label>Server ID<input id="secretDiscordServerId" value="${escapeHtml(secrets.discordServerId || "")}" autocomplete="off"></label>
          <label>Sync Channel ID<input id="secretDiscordSyncChannelId" value="${escapeHtml(secrets.discordSyncChannelId || "")}" autocomplete="off"></label>
          <label>IT Channel ID<input id="secretDiscordItChannelId" value="${escapeHtml(secrets.discordItChannelId || "")}" autocomplete="off"></label>
          <label>Rolle für nicht verknüpft<input id="secretDiscordUnsyncedRoleId" value="${escapeHtml(secrets.discordUnsyncedRoleId || "")}" autocomplete="off"></label>
          <label>Invite URL<input id="secretDiscordInviteUrl" value="${escapeHtml(secrets.discordInviteUrl || "")}" autocomplete="off"></label>
          <label>OAuth Redirect URL<input id="secretDiscordOauthRedirectUrl" value="${escapeHtml(secrets.discordOauthRedirectUrl || "")}" autocomplete="off"></label>
        </section>
      </div>
      <p id="secretSaveMessage" class="muted"></p>
    </div>
  `;
}

async function loadITSecrets() {
  if (itSecretsLoading || !isItLead()) return;
  itSecretsLoading = true;
  try {
    const data = await api("/api/it/secrets", { silent: true });
    itSecrets = data.secrets || {};
  } catch (error) {
    showNotify(error.message, "error");
  } finally {
    itSecretsLoading = false;
    if (state.page === "IT" && (localStorage.getItem("lspd_it_tab") || "overview") === "secrets") renderIT();
  }
}
function renderITDepartmentPositionsPanel() {
  const departments = state.departments.filter((department) => department.id !== "direktion");
  return `
    <div class="panel it-section-card it-department-positions-card">
      <div class="it-section-title">
        <span>04</span>
        <div><h3>Interne Abteilungsränge</h3><p class="muted">Positionen wie Leitung, Stv. Leitung oder eigene interne Ränge pro Abteilung bearbeiten.</p></div>
      </div>
      <div class="it-department-position-grid">
        ${departments.map((department) => `
          <article class="department-position-shortcut">
            <strong>${escapeHtml(department.name)}</strong>
            <small>${departmentPositionsFor(department).map(escapeHtml).join(" / ")}</small>
            <button class="ghost-btn edit-department-positions" type="button" data-page-key="dept:${escapeHtml(department.id)}">Positionen bearbeiten</button>
          </article>
        `).join("") || `<p class="muted">Keine Abteilungen vorhanden.</p>`}
      </div>
    </div>
  `;
}

function discordRoleColor(role) {
  const color = Number(role?.color || 0);
  return color ?`#${color.toString(16).padStart(6, "0")}` : "#99aab5";
}

function discordSelectedRoleIds(selectedRoleIds = []) {
  const ids = Array.isArray(selectedRoleIds) ?selectedRoleIds : String(selectedRoleIds || "").split(",");
  return [...new Set(ids.map((roleId) => String(roleId || "").trim()).filter(Boolean))];
}

function renderDiscordRolePicker(attribute, key, selectedRoleIds, readOnly = false) {
  const roles = state.settings?.discordSync?.importedRoles || [];
  const selected = discordSelectedRoleIds(selectedRoleIds);
  if (!roles.length) {
    return `<div class="discord-role-picker disabled" ${attribute}="${escapeHtml(key)}" data-selected=""><span class="muted">Bitte zuerst Server-Rollen importieren.</span></div>`;
  }
  const selectedRoles = selected.map((roleId) => roles.find((role) => String(role.id) === String(roleId))).filter(Boolean);
  if (readOnly) {
    return `
      <div class="discord-role-picker disabled readonly" ${attribute}="${escapeHtml(key)}" data-selected="${escapeHtml(selected.join(","))}">
        <div class="discord-role-chip-list">
          ${selectedRoles.map((role) => `<span class="discord-role-chip" style="--role-color:${discordRoleColor(role)}"><b>@${escapeHtml(role.name)}</b></span>`).join("") || `<span class="discord-role-empty">Keine Rolle ausgewählt</span>`}
        </div>
      </div>
    `;
  }
  return `
    <div class="discord-role-picker" ${attribute}="${escapeHtml(key)}" data-selected="${escapeHtml(selected.join(","))}">
      <div class="discord-role-chip-list">
        ${selectedRoles.map((role) => `
          <span class="discord-role-chip" style="--role-color:${discordRoleColor(role)}" data-role-id="${escapeHtml(role.id)}">
            <b>@${escapeHtml(role.name)}</b>
            <button type="button" class="discord-role-remove" data-role-id="${escapeHtml(role.id)}">×</button>
          </span>
        `).join("") || `<span class="discord-role-empty">Keine Rolle ausgewählt</span>`}
      </div>
      <input class="discord-role-search" type="text" autocomplete="off" placeholder="@rolle suchen">
      <div class="discord-role-menu hidden">
        ${roles.map((role) => `
          <button type="button" class="discord-role-option ${selected.includes(String(role.id)) ?"selected" : ""}" data-role-id="${escapeHtml(role.id)}" data-role-name="${escapeHtml(role.name.toLowerCase())}" style="--role-color:${discordRoleColor(role)}">
            <span>@${escapeHtml(role.name)}</span>
            <small>${role.managed ?"verwaltet" : `Position ${escapeHtml(role.position)}`}</small>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderDiscordSyncPanel() {
  const sync = state.settings?.discordSync || {};
  const canEditDiscordSync = isItLead();
  const readonlyAttr = canEditDiscordSync ?"" : "disabled";
  const rankRoles = sync.rankRoles || {};
  const roleRoles = sync.roleRoles || {};
  const departmentRoles = sync.departmentRoles || {};
  const importedRoles = sync.importedRoles || [];
  const sortedRanks = [...state.ranks].sort((a, b) => b.value - a.value);
  const specialRoles = ["Frakverwaltung"];
  const orderedDepartmentKeys = orderPages((state.departments || []).map((department) => `dept:${department.id}`));
  const departments = orderedDepartmentKeys
    .map((key) => (state.departments || []).find((department) => `dept:${department.id}` === key))
    .filter(Boolean);
  return `
    <div class="panel it-section-card it-discord-card ${canEditDiscordSync ?"" : "discord-readonly"}">
      <div class="it-section-title">
        <div><h3>Discord Sync</h3><p class="muted">Rang- und Abteilungsrollen vorbereiten, damit Discord-Rollen passend zum Dienstblatt vergeben werden koennen.</p></div>
        <div class="button-row">
          <button class="ghost-btn" id="importDiscordRoles" type="button" ${readonlyAttr}>Server-Rollen importieren</button>
          <button class="ghost-btn" id="testDiscordSync" type="button" ${readonlyAttr}>Verbindung testen</button>
          <button class="ghost-btn" id="runDiscordSync" type="button" ${readonlyAttr}>Jetzt synchronisieren</button>
          <button class="blue-btn" id="saveDiscordSync" type="button" ${readonlyAttr}>Discord Sync speichern</button>
        </div>
      </div>
      <div class="discord-sync-layout">
        <div class="discord-sync-config">
          <label class="switch-line"><input id="discordSyncEnabled" type="checkbox" ${sync.enabled ?"checked" : ""} ${readonlyAttr}><span>Discord Sync aktivieren</span></label>
          <label>Client ID / Application ID<input id="discordApplicationId" inputmode="numeric" autocomplete="off" value="${escapeHtml(sync.applicationId || "")}" placeholder="Discord Client ID aus dem Developer Portal" ${readonlyAttr}></label>
          <label>Öffentlicher Schlüssel<input id="discordPublicKey" autocomplete="off" value="${escapeHtml(sync.publicKey || "")}" placeholder="Discord Public Key" ${readonlyAttr}></label>
          <label>OAuth Callback URL<input id="discordOauthRedirectUrl" autocomplete="off" value="${escapeHtml(normalizeDiscordRedirectUrl(sync.oauthRedirectUrl || `${PUBLIC_BASE_URL}api/discord/callback`))}" placeholder="Exakt wie im Discord Developer Portal" ${readonlyAttr}></label>
          <label>Client Secret<input id="discordClientSecret" type="password" autocomplete="new-password" data-lpignore="true" data-1p-ignore="true" placeholder="${sync.clientSecretSet ?"Client Secret ist gespeichert - leer lassen zum Behalten" : "Discord Client Secret eintragen"}" ${readonlyAttr}></label>
          <label class="switch-line"><input id="clearDiscordClientSecret" type="checkbox" ${readonlyAttr}><span>Gespeichertes Client Secret entfernen</span></label>
          <label>Server ID<input id="discordServerId" inputmode="numeric" autocomplete="off" value="${escapeHtml(sync.serverId || "")}" placeholder="Discord Server ID" ${readonlyAttr}></label>
          <label>Sync Channel ID<input id="discordSyncChannelId" inputmode="numeric" autocomplete="off" value="${escapeHtml(sync.syncChannelId || "")}" placeholder="Channel für Join- und Verknüpfungs-Embed" ${readonlyAttr}></label>
          <label>IT Channel ID<input id="discordItChannelId" inputmode="numeric" autocomplete="off" value="${escapeHtml(sync.itChannelId || "")}" placeholder="Channel für Sync-Erfolg und Fehler" ${readonlyAttr}></label>
          <label>Rolle für nicht verknüpft<input id="discordUnsyncedRoleId" inputmode="numeric" autocomplete="off" value="${escapeHtml(sync.unsyncedRoleId || "")}" placeholder="Discord Rollen-ID für nicht verknüpfte Accounts" ${readonlyAttr}></label>
          <label>Discord Invite Link<input id="discordInviteUrl" autocomplete="off" value="${escapeHtml(sync.inviteUrl || "")}" placeholder="https://discord.gg/..." ${readonlyAttr}></label>
          <label>Bot Token<input id="discordBotToken" type="password" autocomplete="new-password" data-lpignore="true" data-1p-ignore="true" placeholder="${sync.botTokenSet ?"Token ist gespeichert - leer lassen zum Behalten" : "Bot Token eintragen"}" ${readonlyAttr}></label>
          <label class="switch-line"><input id="clearDiscordBotToken" type="checkbox" ${readonlyAttr}><span>Gespeicherten Bot Token entfernen</span></label>
          <p class="muted">Die Discord Client ID ist im Developer Portal die gleiche ID wie die Application ID. Für Rollen-Sync muss in der Discord Application ein Bot-User existieren und mit bot-Scope auf dem Server sein. Der Bot braucht Rollen verwalten und seine höchste Rolle muss über den Rollen liegen, die hier vergeben werden sollen.</p>
          <p class="discord-import-status">${importedRoles.length ?`${importedRoles.length} Server-Rollen importiert.` : "Noch keine Server-Rollen importiert."}</p>
        </div>
        <div class="discord-sync-section">
          <div><strong>Sonderrollen</strong><small>Eigene Accountrollen wie Frakverwaltung bekommen separate Discord-Rollen.</small></div>
          <div class="discord-role-grid">
            ${specialRoles.map((role) => `
              <div class="discord-role-row">
                <span>${escapeHtml(role)}</span>
                ${renderDiscordRolePicker("data-discord-role-role", role, roleRoles[role] || [], !canEditDiscordSync)}
              </div>
            `).join("")}
          </div>
        </div>
        <div class="discord-sync-section">
          <div><strong>Ränge</strong><small>Jeder Dienstblatt-Rang kann mehrere Discord-Rollen bekommen.</small></div>
          <div class="discord-role-grid">
            ${sortedRanks.map((rank) => `
              <div class="discord-role-row">
                <span>${escapeHtml(rankOptionLabel(rank))}</span>
                ${renderDiscordRolePicker("data-discord-rank-role", rank.value, rankRoles[String(rank.value)] || [], !canEditDiscordSync)}
              </div>
            `).join("")}
          </div>
        </div>
        <div class="discord-sync-section">
          <div><strong>Abteilungsrollen</strong><small>Pro Abteilung werden nur Leader-Rollen einzeln und eine allgemeine Mitgliederrolle gepflegt.</small></div>
          <div class="discord-department-list">
            ${departments.map((department) => `
              <article class="discord-department-card">
                <div><strong>${escapeHtml(department.name)}</strong><small>${departmentLeaderPositionsFor(department).filter((position) => position !== "Direktion").length} Leader-Rollen + Mitglieder</small></div>
                <div class="discord-role-grid">
                  ${[
                    ...departmentLeaderPositionsFor(department).filter((position) => position !== "Direktion"),
                    "__member"
                  ].map((position) => {
                    const key = `${department.id}:${position}`;
                    const label = position === "__member" ?`${department.name} Mitglieder` : `${department.name} ${position} Leader`;
                    return `
                      <div class="discord-role-row">
                        <span>${escapeHtml(label)}</span>
                        ${renderDiscordRolePicker("data-discord-dept-role", key, departmentRoles[key] || [], !canEditDiscordSync)}
                      </div>
                    `;
                  }).join("")}
                  ${isSwatDepartment(department) ?SWAT_TEAMS.flatMap((team) => ([
                    { key: `swat:team:${team}`, label: `SWAT Team ${team}` },
                    { key: `swat:teamLeader:${team}`, label: `SWAT Team ${team} Leitung` }
                  ])).map((item) => `
                    <div class="discord-role-row">
                      <span>${escapeHtml(item.label)}</span>
                      ${renderDiscordRolePicker("data-discord-dept-role", item.key, departmentRoles[item.key] || [], !canEditDiscordSync)}
                    </div>
                  `).join("") : ""}
                </div>
              </article>
            `).join("") || `<p class="muted">Keine Abteilungen vorhanden.</p>`}
          </div>
        </div>
      </div>
      <p id="discordSyncMessage" class="muted"></p>
    </div>
  `;
}

function renderItMemberDiscordStatus(user) {
  const linked = Boolean(user.discordId);
  const account = linked ?`${user.discordName || "Discord Account"} · ${user.discordId}` : "Nicht gesynced";
  return `
    <div class="it-member-discord ${linked ?"linked" : "missing"}">
      <span class="discord-status-dot ${linked ?"linked" : ""}"></span>
      <span>
        <strong>Discord</strong>
        <small>${escapeHtml(account)}</small>
      </span>
      <button class="${linked ?"ghost-btn" : "blue-btn"} sync-member-discord" type="button" data-user-id="${escapeHtml(user.id)}">
        ${linked ?"Neu syncen" : "Syncen"}
      </button>
    </div>
  `;
}

function renderItMemberTwitchStatus(user) {
  const linked = Boolean(user.twitchLogin);
  const live = user.twitchLive || {};
  const status = linked
    ? `${user.twitchLogin}${live.live ?` · ${live.matched ?"Firma live" : "Live"}` : ""}`
    : "Nicht verknüpft";
  return `
    <div class="it-member-discord ${linked ?"linked" : "missing"}">
      <span class="discord-status-dot twitch ${linked ?"linked" : ""}"></span>
      <span>
        <strong>Twitch</strong>
        <small>${escapeHtml(status)}</small>
      </span>
      <button class="${linked ?"ghost-btn" : "blue-btn"} edit-member-twitch" type="button" data-user-id="${escapeHtml(user.id)}">
        ${linked ?"Ändern" : "Verknüpfen"}
      </button>
    </div>
  `;
}

function renderItMemberActivationStatus(user) {
  const activated = !user.mustChangePassword;
  return `
    <span class="it-activation-chip ${activated ?"active" : "pending"}">
      <strong>${activated ?"Aktiviert" : "Nicht aktiviert"}</strong>
      <small>${activated ?"Standardpasswort geändert" : "Standardpasswort noch aktiv"} · ${user.tutorialSkipped ?"Tutorial Skip" : user.tutorialCompleted ?"Tutorial fertig" : "Tutorial offen"}</small>
    </span>
  `;
}

async function skipTutorialForUser(userId) {
  const data = await api(`/api/it/users/${encodeURIComponent(userId)}/tutorial-skip`, { method: "PATCH", body: "{}" });
  state.users = state.users.map((user) => user.id === userId ?data.user : user);
  showNotify("Tutorial für Account übersprungen.", "success");
  renderIT();
}

function renderITActivityPanel() {
  const rows = state.itActivity || [];
  return `
    <div class="panel it-section-card it-activity-card">
      <div class="it-section-title">
        <span>LIVE</span>
        <div><h3>Aktive Website-Nutzer</h3><p class="muted">Alle Browser, die das Dienstblatt gerade offen haben und eingeloggt sind.</p></div>
        <button class="blue-btn" id="refreshItActivity" type="button">Aktualisieren</button>
      </div>
      <div class="it-activity-list">
        ${state.itActivityLoading ?`<p class="muted">Aktivität wird geladen...</p>` : rows.length ?rows.map((row) => `
          <article class="it-activity-row">
            <div class="it-activity-user">
              ${avatarMarkup(row.user, "sm")}
              <span><strong>${escapeHtml(fullName(row.user))}</strong><small>DN ${escapeHtml(row.user?.dn || "-")} · ${escapeHtml(rankLabel(row.user?.rank))}</small></span>
            </div>
            <div class="it-activity-meta">
              <span><b>Reiter</b>${escapeHtml(row.page || "-")}</span>
              <span><b>Zuletzt</b>vor ${Number(row.secondsAgo || 0)}s</span>
              <span><b>Rolle</b>${escapeHtml(row.user?.role || "-")}</span>
            </div>
            <button class="red-btn trigger-jumpscare" type="button" data-user-id="${escapeHtml(row.user?.id || "")}">Jumpscare</button>
          </article>
        `).join("") : `<p class="muted">Gerade ist niemand aktiv gemeldet.</p>`}
      </div>
    </div>
  `;
}

async function loadItActivity({ silent = false } = {}) {
  if (!hasRole("IT")) return;
  state.itActivityLoading = !silent;
  if (!silent && state.page === "IT") renderIT();
  try {
    const data = await api("/api/it/activity", { silent: true });
    state.itActivity = data.active || [];
    state.itActivityLoadedAt = Date.now();
  } catch (error) {
    if (!silent) showNotify(error.message, "error");
  } finally {
    state.itActivityLoading = false;
    if (state.page === "IT" && (localStorage.getItem("lspd_it_tab") || "overview") === "activity") renderIT();
  }
}

async function triggerUserJumpscare(userId) {
  try {
    await api(`/api/it/activity/${encodeURIComponent(userId)}/jumpscare`, { method: "POST", body: "{}" });
    showNotify("Jumpscare ausgelöst.", "success");
    loadItActivity({ silent: true });
  } catch (error) {
    showNotify(error.message, "error");
  }
}

function renderITMailboxAdminPanel() {
  const threads = state.itMailboxThreads || [];
  const selectedId = localStorage.getItem("lspd_it_mailbox_thread") || threads[0]?.id || "";
  const activeThread = threads.find((thread) => thread.id === selectedId) || threads[0] || null;
  return `
    <section class="it-mailbox-admin">
      <div class="panel it-section-card it-mailbox-admin-card">
        <div class="it-section-title">
          <span>MAIL</span>
          <div><h3>Postfach Verwaltung</h3><p class="muted">IT-Leitung Ansicht für alle Chats und deren Nachrichten.</p></div>
          <button class="blue-btn" id="refreshItMailbox" type="button">Aktualisieren</button>
        </div>
        <div class="it-mailbox-layout">
          <aside class="it-mailbox-thread-list">
            ${state.itMailboxLoading ?`<p class="muted">Chats werden geladen...</p>` : threads.map((thread) => renderItMailboxThreadButton(thread, activeThread)).join("") || `<p class="muted">Keine Chats vorhanden.</p>`}
          </aside>
          <section class="it-mailbox-reader">
            ${activeThread ?renderMailboxChat({ ...activeThread, canWrite: false, deleted: false, removed: false }) : `<div class="mailbox-empty"><strong>Kein Chat ausgewählt.</strong><span>Wähle links einen Chat aus.</span></div>`}
          </section>
        </div>
      </div>
    </section>
  `;
}

function renderItMailboxThreadButton(thread, activeThread) {
  const participants = thread.activeParticipants || thread.participants || [];
  const messageCount = (thread.messages || []).length;
  return `
    <button class="it-mailbox-thread ${activeThread?.id === thread.id ?"active" : ""}" type="button" data-it-mailbox-thread="${escapeHtml(thread.id)}">
      <span><b>${escapeHtml(thread.title)}</b><small>${escapeHtml(participants.map((user) => fullName(user)).join(", ") || "Keine aktiven Teilnehmer")}</small></span>
      <em>${messageCount} Nachricht${messageCount === 1 ?"" : "en"}</em>
      <i>${formatDateTime(thread.updatedAt || thread.createdAt)}</i>
    </button>
  `;
}

async function loadItMailboxThreads({ silent = false } = {}) {
  if (!isItLead()) return;
  state.itMailboxLoading = !silent;
  if (!silent && state.page === "IT") renderIT();
  try {
    const data = await api("/api/it/mailbox/threads", { silent: true });
    state.itMailboxThreads = data.threads || [];
  } catch (error) {
    if (!silent) showNotify(error.message, "error");
  } finally {
    state.itMailboxLoading = false;
    if (state.page === "IT" && (localStorage.getItem("lspd_it_tab") || "overview") === "mailboxAdmin") renderIT();
  }
}

async function openItMailboxThread(threadId) {
  try {
    const data = await api(`/api/it/mailbox/threads/${encodeURIComponent(threadId)}`, { silent: true });
    state.itMailboxThreads = (state.itMailboxThreads || []).map((thread) => thread.id === threadId ?data.thread : thread);
    localStorage.setItem("lspd_it_mailbox_thread", threadId);
    renderIT();
  } catch (error) {
    showNotify(error.message, "error");
  }
}

function renderIT() {
  if (!hasRole("IT")) {
    content.innerHTML = `<section class="panel"><h3>Kein Zugriff</h3><p class="muted">Dieser Bereich ist nur für IT sichtbar.</p></section>`;
    return;
  }

  const editablePages = editableItPages();
  const sortedRanks = [...state.ranks].sort((a, b) => b.value - a.value);
  const storedItTab = state.page === "IT" && urlTabParam() ?urlTabParam() : localStorage.getItem("lspd_it_tab") || "overview";
  const itTabs = [["overview", "Übersicht"], ["activity", "Aktivität"], ["pages", "Reiter"], ["members", "Mitglieder"], ["ranks", "Ränge"], ["discord", "Discord Sync"], ["academy", "Academy"]];
  if (isItLead()) itTabs.push(["mailboxAdmin", "Postfach Verwaltung"], ["backup", "Backup"], ["secrets", "Secrets"]);
  const visibleItTabs = itTabs;
  const itTab = visibleItTabs.some(([id]) => id === storedItTab) ?storedItTab : "overview";
  const itMembersSearch = localStorage.getItem("lspd_it_members_search") || "";
  content.innerHTML = `
    <section class="it-command-center">
      <div class="panel it-hero-panel it-overview-card">
        <div>
          <h3><span class="section-icon">${iconSvg("IT")}</span>IT Verwaltung</h3>
          <p class="muted">Systemsteuerung, Rechte, Mitglieder und Ränge übersichtlich getrennt.</p>
        </div>
        <div class="tabs-row it-tabs">
          ${visibleItTabs.map(([id, label]) => `<button class="${itTab === id ?"tab-active" : ""}" data-it-tab="${id}">${label}</button>`).join("")}
        </div>
      </div>
    </section>

    <section class="it-workbench">
      ${itTab === "overview" ?renderITOverviewPanel(editablePages) : ""}
      ${itTab === "activity" ?renderITActivityPanel() : ""}
      ${itTab === "mailboxAdmin" && isItLead() ?renderITMailboxAdminPanel() : ""}
      ${itTab === "backup" ?renderITBackupPanel() : ""}
      ${itTab === "secrets" ?renderITSecretsPanel() : ""}
      ${itTab === "academy" ?renderTrainingManagementPanels({ mode: "it" }) : ""}
      <div class="panel it-section-card it-pages-card ${itTab === "pages" ?"" : "hidden"}">
        <div class="it-section-title">
          <span>03</span>
          <div><h3>Reiter & Rechte</h3><p class="muted">Namen ändern und Rechte direkt pro Reiter öffnen.</p></div>
          <div class="button-row">
            <button class="ghost-btn" id="createCustomPage" type="button">Reiter erstellen</button>
            <button class="ghost-btn" id="createDepartmentPage" type="button">Abteilung erstellen</button>
            <button class="blue-btn" id="saveNavLabels" type="button">Speichern</button>
          </div>
        </div>
        <div class="edit-list it-compact-list">
          ${editablePages.map((page, index) => `
            ${isInternalSheetPage(page) && !isInternalSheetPage(editablePages[index - 1] || "") ?`<div class="edit-section-divider"><span>Abteilungsblätter</span><small>Direktion, IT und Abteilungen mit eigenen Rechten für Ansicht, Personal, Notizen und interne Buttons.</small></div>` : ""}
            <label class="edit-row">
              <span class="edit-icon">${iconSvg(page)}</span>
              <span class="edit-name">${restrictedPageEditIcon(page)}${escapeHtml(isDepartmentPage(page) ?navLabel(page) : page)}</span>
              <input data-nav-key="${escapeHtml(page)}" value="${escapeHtml(navLabel(page))}">
              <span class="page-order-controls">
                <button class="mini-icon page-move" type="button" data-page-key="${escapeHtml(page)}" data-direction="-1" title="Nach oben">${iconSvg("ChevronUp")}</button>
                <button class="mini-icon page-move" type="button" data-page-key="${escapeHtml(page)}" data-direction="1" title="Nach unten">${iconSvg("ChevronDown")}</button>
              </span>
              <button class="mini-icon page-permission-open" type="button" data-page-key="${escapeHtml(page)}" title="Rechte verwalten" aria-label="Rechte verwalten">${actionIcon("edit")}</button>
            </label>
          `).join("")}
        </div>
        <p id="navSaveMessage" class="muted"></p>
      </div>
      ${itTab === "pages" ?renderITDepartmentPositionsPanel() : ""}

      <div class="panel it-section-card it-members-card ${itTab === "members" ?"" : "hidden"}">
        <div class="it-section-title">
          <span>04</span>
          <div><h3>Mitglieder</h3><p class="muted">Accounts, Ränge und IT-Zugänge direkt im IT-Blatt bearbeiten.</p></div>
          <button class="blue-btn" id="itCreateMember" type="button">Neues Mitglied einstellen</button>
        </div>
        <div id="defaultCredentialPanel" class="it-password-panel" autocomplete="off">
          <div>
            <strong>Standardpasswort</strong>
            <small>Neue Accounts bekommen dieses Passwort automatisch. Einzelne Accounts kannst du unten darauf zurücksetzen.</small>
          </div>
          <input id="defaultCredentialValue" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" placeholder="Neues Standardpasswort">
          <button class="blue-btn" id="saveDefaultCredential" type="button">Standardpasswort speichern</button>
          <p id="defaultCredentialMessage" class="muted"></p>
        </div>
        <div class="filter-row members-search-row">
          <input id="itMembersSearch" value="${escapeHtml(itMembersSearch)}" placeholder="Mitglied, DN, Telefon, Rang oder Rolle suchen">
        </div>
        <div class="it-member-list">
          ${sortMembersForRankList(state.users).map((user) => `
            <div class="it-member-row filterable-row" data-search="${escapeHtml(memberSearchText(user))}">
              <span>${avatarMarkup(user, "sm")}<span><strong>${escapeHtml(fullName(user))}</strong><small>DN ${escapeHtml(user.dn || "-")} · ${escapeHtml(rankLabel(user.rank))}</small></span></span>
              <span class="it-member-roles">${roleBadges(user)}</span>
              ${renderItMemberActivationStatus(user)}
              ${renderItMemberDiscordStatus(user)}
              ${renderItMemberTwitchStatus(user)}
              <button class="ghost-btn skip-member-tutorial" type="button" data-user-id="${escapeHtml(user.id)}" ${user.tutorialSkipped ?"disabled" : ""}>Tutorial skippen</button>
              <button class="ghost-btn reset-member-password" type="button" data-user-id="${escapeHtml(user.id)}">Passwort Reset</button>
              <button class="ghost-btn reset-member-discord" type="button" data-user-id="${escapeHtml(user.id)}">Discord Reset</button>
              <button class="mini-icon it-edit-member" type="button" data-user-id="${escapeHtml(user.id)}" title="Aktionen">${actionIcon("edit")}</button>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="panel it-section-card it-ranks-card ${itTab === "ranks" ?"" : "hidden"}">
        <div class="it-section-title">
          <span>05</span>
          <div><h3>Ränge</h3><p class="muted">Rangnamen bearbeiten, hinzufügen oder entfernen.</p></div>
          <div class="button-row">
            <button class="ghost-btn" id="addRank" type="button">Rang hinzufügen</button>
            <button class="red-btn" id="removeRank" type="button">Rang entfernen</button>
            <button class="blue-btn" id="saveRanks" type="button">Speichern</button>
          </div>
        </div>
        <div class="edit-list rank-edit-list it-compact-list">
          ${sortedRanks.map((rank) => `
            <label class="edit-row">
              <span class="rank-number">Rang ${rank.value}</span>
              <input data-rank-value="${rank.value}" value="${escapeHtml(rank.label)}">
              <span class="edit-pencil">${actionIcon("edit")}</span>
            </label>
          `).join("")}
        </div>
        <p id="rankSaveMessage" class="muted"></p>
      </div>
      ${itTab === "discord" ?renderDiscordSyncPanel() : ""}
    </section>

  `;

  document.querySelectorAll("[data-it-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      localStorage.setItem("lspd_it_tab", button.dataset.itTab);
      updateAppUrl({ replace: true });
      renderIT();
    });
  });
  $("#refreshItActivity")?.addEventListener("click", () => loadItActivity());
  document.querySelectorAll(".trigger-jumpscare").forEach((button) => button.addEventListener("click", () => triggerUserJumpscare(button.dataset.userId)));
  if (itTab === "activity" && !state.itActivityLoading && Date.now() - Number(state.itActivityLoadedAt || 0) > 5000) {
    loadItActivity({ silent: Boolean(state.itActivity?.length) });
  }
  $("#refreshItMailbox")?.addEventListener("click", () => loadItMailboxThreads());
  document.querySelectorAll("[data-it-mailbox-thread]").forEach((button) => button.addEventListener("click", () => openItMailboxThread(button.dataset.itMailboxThread)));
  if (itTab === "mailboxAdmin" && isItLead() && !state.itMailboxLoading && !(state.itMailboxThreads || []).length) {
    loadItMailboxThreads();
  }

  $("#saveNavLabels")?.addEventListener("click", async () => {
    const navLabels = {};
    document.querySelectorAll("[data-nav-key]").forEach((input) => {
      navLabels[input.dataset.navKey] = input.value;
    });
    try {
      const data = await api("/api/it/nav-labels", { method: "PATCH", body: JSON.stringify({ navLabels }) });
      state.settings.navLabels = data.navLabels;
      if (Array.isArray(data.departments)) state.departments = data.departments;
      $("#navSaveMessage").textContent = "Reiter gespeichert.";
      renderNavigation();
      renderTopbar();
    } catch (error) {
      $("#navSaveMessage").textContent = error.message;
      $("#navSaveMessage").className = "form-error";
    }
  });

  document.querySelectorAll(".page-move").forEach((button) => button.addEventListener("click", () => movePageOrder(button.dataset.pageKey, Number(button.dataset.direction))));
  $("#createCustomPage")?.addEventListener("click", () => openCreatePageModal("custom"));
  $("#createDepartmentPage")?.addEventListener("click", () => openCreatePageModal("department"));
  $("#overviewCreatePage")?.addEventListener("click", () => openCreatePageModal("custom"));
  $("#overviewCreateDepartment")?.addEventListener("click", () => openCreatePageModal("department"));
  document.querySelectorAll(".edit-department-positions").forEach((button) => button.addEventListener("click", () => openPagePermissionModal(button.dataset.pageKey)));

  $("#saveRanks")?.addEventListener("click", async () => {
    const ranks = Array.from(document.querySelectorAll("[data-rank-value]"))
      .sort((a, b) => Number(a.dataset.rankValue) - Number(b.dataset.rankValue))
      .map((input) => ({ value: Number(input.dataset.rankValue), label: input.value }));
    try {
      const data = await api("/api/it/ranks", { method: "PATCH", body: JSON.stringify({ ranks }) });
      state.ranks = data.ranks;
      $("#rankSaveMessage").textContent = "Ränge gespeichert.";
      renderNavigation();
      renderTopbar();
    } catch (error) {
      $("#rankSaveMessage").textContent = error.message;
      $("#rankSaveMessage").className = "form-error";
    }
  });

  $("#addRank")?.addEventListener("click", openAddRankModal);
  $("#removeRank")?.addEventListener("click", openRemoveRankModal);
  $("#itCreateMember")?.addEventListener("click", () => openUserModal());
  setupTableFilter("#itMembersSearch");
  $("#itMembersSearch")?.addEventListener("input", (event) => localStorage.setItem("lspd_it_members_search", event.target.value));
  if ($("#itMembersSearch")?.value) $("#itMembersSearch")?.dispatchEvent(new Event("input"));
  $("#saveDefaultCredential")?.addEventListener("click", saveDefaultPassword);
  $("#saveItSecrets")?.addEventListener("click", saveITSecrets);
  $("#saveDiscordSync")?.addEventListener("click", saveDiscordSyncSettings);
  $("#importDiscordRoles")?.addEventListener("click", importDiscordRoles);
  $("#testDiscordSync")?.addEventListener("click", testDiscordSync);
  $("#runDiscordSync")?.addEventListener("click", runDiscordSync);
  if (isItLead()) setupDiscordRolePickers();
  else {
    document.querySelectorAll(".it-discord-card input, .it-discord-card select, .it-discord-card textarea").forEach((input) => {
      input.disabled = true;
    });
    document.querySelectorAll(".it-discord-card button").forEach((button) => {
      button.disabled = true;
    });
  }
  document.querySelectorAll(".it-edit-member").forEach((button) => button.addEventListener("click", () => openUserActionsModal(state.users.find((user) => user.id === button.dataset.userId))));
  document.querySelectorAll(".skip-member-tutorial").forEach((button) => button.addEventListener("click", () => skipTutorialForUser(button.dataset.userId).catch((error) => showNotify(error.message, "error"))));
  document.querySelectorAll(".reset-member-password").forEach((button) => button.addEventListener("click", () => openResetPasswordModal(state.users.find((user) => user.id === button.dataset.userId))));
  document.querySelectorAll(".reset-member-discord").forEach((button) => button.addEventListener("click", () => openResetDiscordModal(state.users.find((user) => user.id === button.dataset.userId))));
  document.querySelectorAll(".edit-member-twitch").forEach((button) => button.addEventListener("click", () => openTwitchLinkModal(state.users.find((user) => user.id === button.dataset.userId), { admin: true })));
  setupTrainingManagementActions();
  document.querySelectorAll(".sync-member-discord").forEach((button) => button.addEventListener("click", () => {
    const user = state.users.find((item) => item.id === button.dataset.userId);
    if (user?.discordId) syncMemberDiscord(user).catch((error) => showNotify(error.message, "error"));
    else openSyncDiscordModal(user);
  }));
  document.querySelectorAll(".page-permission-open").forEach((button) => button.addEventListener("click", () => openPagePermissionModal(button.dataset.pageKey)));
  setupPermissionSearch(document);
  document.querySelectorAll(".it-section summary button").forEach((button) => {
    button.addEventListener("click", (event) => event.stopPropagation());
  });

  const exportBackup = async () => {
    const response = await fetch("/api/it/export", { headers: { Authorization: `Bearer ${state.token}` } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      showNotify(data.error || "Datensicherung fehlgeschlagen.", "error");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lspd-dienstblatt-export.json";
    link.click();
    URL.revokeObjectURL(url);
  };
  const downloadStoredBackup = async (backupId) => {
    const response = await fetch(`/api/it/backups/${backupId}/download`, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      showNotify(data.error || "Backup-Download fehlgeschlagen.", "error");
      return;
    }
    const disposition = response.headers.get("Content-Disposition") || "";
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || "lspd-dienstblatt-backup.json";
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };
  $("#exportDataBtn")?.addEventListener("click", exportBackup);
  $("#backupExportData")?.addEventListener("click", exportBackup);
  $("#backupCreateStored")?.addEventListener("click", async () => {
    const data = await api("/api/it/backups", { method: "POST", body: "{}" });
    state.settings = data.settings || state.settings;
    showNotify("Backup erstellt und gespeichert.");
    renderIT();
  });
  document.querySelectorAll(".backup-download").forEach((button) => button.addEventListener("click", () => downloadStoredBackup(button.dataset.id)));
  document.querySelectorAll(".backup-restore").forEach((button) => button.addEventListener("click", () => openBackupRestoreModal(button.dataset.id)));

  $("#importDataBtn")?.addEventListener("click", openDataImportModal);
  $("#backupImportData")?.addEventListener("click", openDataImportModal);

  $("#clearSessionsBtn")?.addEventListener("click", async () => {
    await api("/api/it/clear-sessions", { method: "POST", body: "{}" });
  });
  $("#overviewClearSessions")?.addEventListener("click", async () => {
    await api("/api/it/clear-sessions", { method: "POST", body: "{}" });
    showNotify("Andere Sessions wurden abgemeldet.");
  });

  $("#toggleDevModeBtn")?.addEventListener("click", async () => {
    const data = await api("/api/it/devmode", {
      method: "PATCH",
      body: JSON.stringify({ devMode: !state.settings?.devMode })
    });
    state.settings = data.settings;
    syncDevModeAuthStorage();
    renderApp();
  });
  $("#overviewToggleDevMode")?.addEventListener("click", async () => {
    const data = await api("/api/it/devmode", {
      method: "PATCH",
      body: JSON.stringify({ devMode: !state.settings?.devMode })
    });
    state.settings = data.settings;
    syncDevModeAuthStorage();
    renderApp();
  });
  $("#overviewToggleMaintenance")?.addEventListener("click", async () => {
    const data = await api("/api/it/maintenance", {
      method: "PATCH",
      body: JSON.stringify({ maintenanceMode: !state.settings?.maintenanceMode })
    });
    state.settings = data.settings;
    renderApp();
  });
  $("#clearSeizuresBtn")?.addEventListener("click", () => openConfirmModal({
    title: "Beschlagnahmungen leeren",
    text: "Alle geposteten Beschlagnahmungen werden endgueltig geloescht.",
    confirmText: "Beschlagnahmungen leeren",
    onConfirm: async () => {
      const data = await api("/api/it/clear-seizures", { method: "POST", body: "{}" });
      state.settings = data.settings || { ...state.settings, seizures: [] };
      renderIT();
      showNotify("Beschlagnahmungen wurden geleert.");
    }
  }));
  $("#clearMemberAccountsBtn")?.addEventListener("click", () => openConfirmModal({
    title: "Mitglieder-Accounts loeschen",
    text: "Alle Mitglieder-Accounts ausser deinem aktuellen Account werden endgueltig geloescht.",
    confirmText: "Accounts loeschen",
    onConfirm: async () => {
      await api("/api/it/clear-member-accounts", { method: "POST", body: "{}" });
      await bootstrap();
      showNotify("Alle anderen Mitglieder-Accounts wurden geloescht.");
    }
  }));
  $("#clearLogsBtn")?.addEventListener("click", () => openConfirmModal({
    title: "Logs loeschen",
    text: "Alle Logs, Dienstzeiten und Eintraege der Mitgliederfluktation werden endgueltig geloescht.",
    confirmText: "Logs loeschen",
    onConfirm: async () => {
      const data = await api("/api/it/clear-logs", { method: "POST", body: "{}" });
      state.logs = data.logs || [];
      state.dutyHistory = data.dutyHistory || [];
      state.settings.fluctuation = data.fluctuation || [];
      renderIT();
      showNotify("Logs, Dienstzeiten und Mitgliederfluktation wurden geloescht.");
    }
  }));
  $("#saveCustomAnimation")?.addEventListener("click", async () => {
    try {
      await saveCustomAnimationSettings();
    } catch (error) {
      showNotify(error.message || "Animation konnte nicht gespeichert werden.", "error");
    }
  });
  $("#saveCustomAnimationItem")?.addEventListener("click", async () => {
    try {
      await saveCustomAnimationItem();
    } catch (error) {
      showNotify(error.message || "Animation konnte nicht in die Liste gespeichert werden.", "error");
    }
  });
  $("#clearCustomAnimation")?.addEventListener("click", async () => {
    try {
      await saveCustomAnimationSettings({ clearAsset: true });
    } catch (error) {
      showNotify(error.message || "Animation konnte nicht entfernt werden.", "error");
    }
  });
  $("#triggerCustomAnimation")?.addEventListener("click", async () => {
    try {
      await triggerCustomAnimationForAll();
    } catch (error) {
      showNotify(error.message || "Animation konnte nicht abgespielt werden.", "error");
    }
  });
  document.querySelectorAll(".custom-animation-play").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.source === "saved") {
        triggerCustomAnimationForAll(button.dataset.id).catch((error) => showNotify(error.message || "Animation konnte nicht abgespielt werden.", "error"));
        return;
      }
      const payload = {
        title: button.dataset.title || "Dienstblatt Animation",
        durationMs: Math.min(10, Math.max(1, Number(button.dataset.duration || 6))) * 1000,
        assetUrl: button.dataset.url || ""
      };
      api("/api/it/custom-animation/trigger", { method: "POST", body: JSON.stringify(payload) })
        .then((data) => {
          triggerCustomAnimationEvent(data.event);
          showNotify("Animation wurde ausgelöst.");
        })
        .catch((error) => showNotify(error.message || "Animation konnte nicht abgespielt werden.", "error"));
    });
  });
  document.querySelectorAll(".custom-animation-delete").forEach((button) => {
    button.addEventListener("click", () => deleteCustomAnimationItem(button.dataset.id).catch((error) => showNotify(error.message || "Animation konnte nicht gelöscht werden.", "error")));
  });
  $("#overviewToggleDefconCard")?.addEventListener("click", async () => {
    const data = await api("/api/it/defcon-card", {
      method: "PATCH",
      body: JSON.stringify({ hideDefconCard: !state.settings?.hideDefconCard })
    });
    state.settings = data.settings;
    renderApp();
  });
  $("#overviewToggleInformationLinks")?.addEventListener("click", async () => {
    const currentlyHidden = state.settings?.hideInformationLinksCard !== false;
    const data = await api("/api/it/information-links-card", {
      method: "PATCH",
      body: JSON.stringify({ hideInformationLinksCard: !currentlyHidden })
    });
    state.settings = data.settings;
    renderApp();
  });
  $("#forceClientRefresh")?.addEventListener("click", forceClientRefresh);
  $("#addRestartTime")?.addEventListener("click", () => saveRestartTimes([...(state.settings.restartTimes || []), $("#restartTimeInput").value]));
  document.querySelectorAll(".delete-restart-time").forEach((button) => {
    button.addEventListener("click", () => saveRestartTimes((state.settings.restartTimes || []).filter((time) => time !== button.dataset.time)));
  });
}

async function saveRestartTimes(times) {
  const data = await api("/api/it/restarts", {
    method: "PATCH",
    body: JSON.stringify({ restartTimes: Array.from(new Set(times.filter(Boolean))).sort() })
  });
  state.settings = data.settings;
  renderIT();
}

async function forceClientRefresh() {
  const data = await api("/api/it/client-refresh", { method: "POST", body: "{}" });
  showNotify("Website-Refresh ausgelöst. Alle aktiven Clients laden gleich neu.");
  state.clientRefreshRevision = "";
  localStorage.removeItem(CLIENT_REFRESH_SEEN_KEY);
  if (data.liveRevision) state.liveRevision = "";
}

async function checkProfileTwitchLive() {
  const button = $("#profileTwitchCheck");
  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Prüfe...";
    }
    const data = await api("/api/profile/twitch/check", { method: "POST", body: "{}" });
    state.currentUser = data.user || state.currentUser;
    state.users = state.users.map((item) => item.id === state.currentUser.id ?state.currentUser : item);
    renderProfile();
    showNotify(data.message || "Twitch geprüft.");
  } catch (error) {
    showNotify(error.message || "Twitch Check fehlgeschlagen.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Jetzt prüfen";
    }
  }
}

async function saveITSecrets() {
  if (!isItLead()) return;
  const body = {
    publicBaseUrl: $("#secretPublicBaseUrl")?.value.trim() || "",
    discordApplicationId: $("#secretDiscordApplicationId")?.value.trim() || "",
    discordPublicKey: $("#secretDiscordPublicKey")?.value.trim() || "",
    discordServerId: $("#secretDiscordServerId")?.value.trim() || "",
    discordSyncChannelId: $("#secretDiscordSyncChannelId")?.value.trim() || "",
    discordItChannelId: $("#secretDiscordItChannelId")?.value.trim() || "",
    discordUnsyncedRoleId: $("#secretDiscordUnsyncedRoleId")?.value.trim() || "",
    discordInviteUrl: $("#secretDiscordInviteUrl")?.value.trim() || "",
    discordOauthRedirectUrl: $("#secretDiscordOauthRedirectUrl")?.value.trim() || "",
    twitchClientId: $("#secretTwitchClientId")?.value.trim() || "",
    discordClientSecret: $("#secretDiscordClientSecret")?.value.trim() || "",
    discordBotToken: $("#secretDiscordBotToken")?.value.trim() || "",
    twitchClientSecret: $("#secretTwitchClientSecret")?.value.trim() || "",
    clear: {
      discordClientSecret: Boolean($("#clearDiscordClientSecretSecret")?.checked),
      discordBotToken: Boolean($("#clearDiscordBotTokenSecret")?.checked),
      twitchClientSecret: Boolean($("#clearTwitchClientSecret")?.checked)
    }
  };
  try {
    const data = await api("/api/it/secrets", { method: "PATCH", body: JSON.stringify(body) });
    itSecrets = data.secrets || {};
    showNotify("Secrets gespeichert.");
    renderIT();
  } catch (error) {
    const message = $("#secretSaveMessage");
    if (message) {
      message.textContent = error.message;
      message.className = "form-error";
    } else {
      showNotify(error.message, "error");
    }
  }
}

function updateDiscordRolePicker(picker) {
  const roles = state.settings?.discordSync?.importedRoles || [];
  const selected = discordSelectedRoleIds(picker.dataset.selected || "");
  const chipList = picker.querySelector(".discord-role-chip-list");
  if (chipList) {
    chipList.innerHTML = selected.map((roleId) => roles.find((role) => String(role.id) === String(roleId))).filter(Boolean).map((role) => `
      <span class="discord-role-chip" style="--role-color:${discordRoleColor(role)}" data-role-id="${escapeHtml(role.id)}">
        <b>@${escapeHtml(role.name)}</b>
        <button type="button" class="discord-role-remove" data-role-id="${escapeHtml(role.id)}">×</button>
      </span>
    `).join("") || `<span class="discord-role-empty">Keine Rolle ausgewählt</span>`;
  }
  picker.querySelectorAll(".discord-role-option").forEach((option) => {
    option.classList.toggle("selected", selected.includes(String(option.dataset.roleId)));
  });
}

function filterDiscordRolePicker(picker) {
  const query = (picker.querySelector(".discord-role-search")?.value || "").replace(/^@/, "").trim().toLowerCase();
  picker.querySelectorAll(".discord-role-option").forEach((option) => {
    const match = !query || (option.dataset.roleName || "").includes(query);
    option.classList.toggle("hidden", !match);
  });
}

function setupDiscordRolePickers() {
  document.querySelectorAll(".discord-role-picker:not(.disabled)").forEach((picker) => {
    const input = picker.querySelector(".discord-role-search");
    const menu = picker.querySelector(".discord-role-menu");
    input?.addEventListener("focus", () => {
      menu?.classList.remove("hidden");
      filterDiscordRolePicker(picker);
    });
    input?.addEventListener("input", () => {
      menu?.classList.remove("hidden");
      filterDiscordRolePicker(picker);
    });
    picker.querySelectorAll(".discord-role-option").forEach((option) => {
      option.addEventListener("click", () => {
        const selected = discordSelectedRoleIds(picker.dataset.selected || "");
        const roleId = String(option.dataset.roleId || "");
        if (roleId && !selected.includes(roleId)) selected.push(roleId);
        picker.dataset.selected = selected.join(",");
        if (input) input.value = "";
        updateDiscordRolePicker(picker);
        filterDiscordRolePicker(picker);
        input?.focus();
      });
    });
    picker.addEventListener("click", (event) => {
      const remove = event.target.closest(".discord-role-remove");
      if (!remove) return;
      const selected = discordSelectedRoleIds(picker.dataset.selected || "").filter((roleId) => roleId !== String(remove.dataset.roleId || ""));
      picker.dataset.selected = selected.join(",");
      updateDiscordRolePicker(picker);
      filterDiscordRolePicker(picker);
    });
  });
  if (!window.discordRolePickerOutsideCloseInstalled) {
    window.discordRolePickerOutsideCloseInstalled = true;
    document.addEventListener("click", (event) => {
      document.querySelectorAll(".discord-role-picker .discord-role-menu").forEach((menu) => {
        if (!menu.closest(".discord-role-picker")?.contains(event.target)) menu.classList.add("hidden");
      });
    });
  }
}

async function saveDefaultPassword() {
  const input = $("#defaultCredentialValue");
  const message = $("#defaultCredentialMessage");
  const defaultPassword = input?.value.trim() || "";
  if (!defaultPassword) {
    if (message) {
      message.textContent = "Bitte ein Standardpasswort eintragen.";
      message.className = "form-error";
    }
    return;
  }
  try {
    const data = await api("/api/it/default-password", { method: "PATCH", body: JSON.stringify({ defaultPassword }) });
    state.settings = data.settings || state.settings;
    if (input) input.value = "";
    if (message) {
      message.textContent = "Standardpasswort gespeichert. Neue Accounts und Resets nutzen es ab jetzt.";
      message.className = "muted";
    }
  } catch (error) {
    if (message) {
      message.textContent = error.message;
      message.className = "form-error";
    }
  }
}

async function saveDiscordSyncSettings(options = {}) {
  if (!isItLead()) {
    showNotify("Discord Sync darf nur von der IT-Leitung bearbeitet werden.", "error");
    return;
  }
  const skipNotify = Boolean(options.skipNotify);
  const rethrow = Boolean(options.rethrow);
  const message = $("#discordSyncMessage");
  const rankRoles = {};
  document.querySelectorAll("[data-discord-rank-role]").forEach((picker) => {
    const roleIds = discordSelectedRoleIds(picker.dataset.selected || "");
    if (roleIds.length) rankRoles[picker.dataset.discordRankRole] = roleIds;
  });
  const roleRoles = {};
  document.querySelectorAll("[data-discord-role-role]").forEach((picker) => {
    const roleIds = discordSelectedRoleIds(picker.dataset.selected || "");
    if (roleIds.length) roleRoles[picker.dataset.discordRoleRole] = roleIds;
  });
  const departmentRoles = {};
  document.querySelectorAll("[data-discord-dept-role]").forEach((picker) => {
    const roleIds = discordSelectedRoleIds(picker.dataset.selected || "");
    if (roleIds.length) departmentRoles[picker.dataset.discordDeptRole] = roleIds;
  });
  const discordSync = {
    enabled: $("#discordSyncEnabled")?.checked || false,
    applicationId: $("#discordApplicationId")?.value.trim() || "",
    clientSecret: $("#discordClientSecret")?.value.trim() || "",
    clearClientSecret: $("#clearDiscordClientSecret")?.checked || false,
    publicKey: $("#discordPublicKey")?.value.trim() || "",
    oauthRedirectUrl: $("#discordOauthRedirectUrl")?.value.trim() || "",
    serverId: $("#discordServerId")?.value.trim() || "",
    syncChannelId: $("#discordSyncChannelId")?.value.trim() || "",
    itChannelId: $("#discordItChannelId")?.value.trim() || "",
    unsyncedRoleId: $("#discordUnsyncedRoleId")?.value.trim() || "",
    inviteUrl: $("#discordInviteUrl")?.value.trim() || "",
    botToken: $("#discordBotToken")?.value.trim() || "",
    clearBotToken: $("#clearDiscordBotToken")?.checked || false,
    rankRoles,
    roleRoles,
    departmentRoles
  };
  try {
    const data = await api("/api/it/discord-sync", { method: "PATCH", body: JSON.stringify({ discordSync }) });
    state.settings = data.settings || state.settings;
    renderIT();
    if (!skipNotify) showNotify("Discord Sync gespeichert.");
  } catch (error) {
    if (message) {
      message.textContent = error.message;
      message.className = "form-error";
    }
    if (rethrow) throw error;
  }
}

async function importDiscordRoles() {
  if (!isItLead()) {
    showNotify("Discord Sync darf nur von der IT-Leitung bearbeitet werden.", "error");
    return;
  }
  const message = $("#discordSyncMessage");
  try {
    await saveDiscordSyncSettings({ skipNotify: true, rethrow: true });
    const data = await api("/api/it/discord-sync/import-roles", { method: "POST", body: "{}" });
    state.settings = data.settings || state.settings;
    renderIT();
    showNotify(`${data.roles?.length || 0} Discord Rollen importiert.`);
  } catch (error) {
    if (message) {
      message.textContent = error.message;
      message.className = "form-error";
    }
  }
}

async function testDiscordSync() {
  if (!isItLead()) {
    showNotify("Discord Sync darf nur von der IT-Leitung bearbeitet werden.", "error");
    return;
  }
  const message = $("#discordSyncMessage");
  try {
    await saveDiscordSyncSettings({ skipNotify: true, rethrow: true });
    const data = await api("/api/it/discord-sync/test", { method: "POST", body: "{}" });
    const guildText = data.guildName ?` / Server: ${data.guildName}` : "";
    showNotify(`Discord Verbindung OK: ${data.botName || "Bot"}${guildText}`);
  } catch (error) {
    if (message) {
      message.textContent = error.message;
      message.className = "form-error";
    }
  }
}

async function runDiscordSync() {
  if (!isItLead()) {
    showNotify("Discord Sync darf nur von der IT-Leitung bearbeitet werden.", "error");
    return;
  }
  const message = $("#discordSyncMessage");
  const button = $("#runDiscordSync");
  if (discordSyncInFlight) {
    if (message) {
      message.className = "muted";
      message.textContent = "Discord Gesamtsync läuft bereits. Bitte warte, bis der aktuelle Lauf abgeschlossen ist.";
    }
    showNotify("Discord Sync läuft bereits.", "error");
    return;
  }
  discordSyncInFlight = true;
  const startedAt = Date.now();
  try {
    if (button) {
      button.disabled = true;
      button.classList.add("loading");
      button.textContent = "Synchronisiere...";
    }
    if (message) {
      message.className = "muted";
      message.textContent = "Discord Gesamtsync läuft. Bitte warten, Rollen und Nicknames werden gerade geprüft...";
    }
    showNotify("Discord Gesamtsync wurde gestartet und läuft im Hintergrund.", "success");
    const data = await api("/api/it/discord-sync/run", { method: "POST", body: "{}", silent: true });
    if (data.started) {
      await pollDiscordSyncStatus(startedAt);
      return;
    }
    const duration = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    if (message) {
      const failedAccounts = Array.isArray(data.failedAccounts) ?data.failedAccounts : [];
      message.className = data.failed ?"form-error discord-sync-result" : "muted discord-sync-result";
      message.innerHTML = `
        <strong>Gesamtsync abgeschlossen nach ${duration}s.</strong><br>
        ${escapeHtml(data.synced || 0)} Account${Number(data.synced || 0) === 1 ?"" : "s"} geprüft${data.skipped ?`, ${escapeHtml(data.skipped)} übersprungen` : ""}.
        ${data.failed ?`<br><b>${escapeHtml(data.failed)} Account${Number(data.failed) === 1 ?"" : "s"} mit Fehlern:</b><br>${failedAccounts.map((item) => `- ${escapeHtml(item.name || "Unbekannter Account")}: ${escapeHtml(item.details || "Keine Detailangabe vorhanden.")}`).join("<br>")}` : "<br>Keine Fehler gemeldet."}
      `;
    }
    showNotify(data.failed ?`Discord Sync abgeschlossen: ${data.failed} Account(s) mit Fehlern.` : `Discord Sync für ${data.synced || 0} Accounts abgeschlossen.`, data.failed ?"error" : "success");
  } catch (error) {
    if (message) {
      message.textContent = error.message;
      message.className = "form-error";
    }
  } finally {
    discordSyncInFlight = false;
    if (button) {
      button.disabled = false;
      button.classList.remove("loading");
      button.textContent = "Jetzt synchronisieren";
    }
  }
}

async function pollDiscordSyncStatus(startedAt) {
  const message = $("#discordSyncMessage");
  const button = $("#runDiscordSync");
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt < 2 ?1000 : 3000));
    const data = await api("/api/it/discord-sync/status", { silent: true });
    const status = data.status || {};
    if (message) {
      message.className = status.error ?"form-error discord-sync-result" : "muted discord-sync-result";
      message.innerHTML = status.running
        ? `<strong>Discord Gesamtsync läuft...</strong><br>${escapeHtml(status.synced || 0)} Account${Number(status.synced || 0) === 1 ?"" : "s"} bisher geprüft${status.failed ?`, ${escapeHtml(status.failed)} mit Fehlern` : ""}.`
        : renderDiscordSyncStatusResult(status, startedAt);
    }
    if (!status.running) {
      showNotify(status.error ?`Discord Sync fehlgeschlagen: ${status.error}` : status.failed ?`Discord Sync abgeschlossen: ${status.failed} Account(s) mit Fehlern.` : `Discord Sync für ${status.synced || 0} Accounts abgeschlossen.`, status.error || status.failed ?"error" : "success");
      return;
    }
    if (button) button.disabled = true;
  }
  if (message) {
    message.textContent = "Discord Sync läuft im Hintergrund weiter. Bitte später den Status erneut prüfen oder die Seite neu laden.";
    message.className = "muted";
  }
}

function renderDiscordSyncStatusResult(status, startedAt) {
  const duration = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  const failedAccounts = Array.isArray(status.failedAccounts) ?status.failedAccounts : [];
  if (status.error) return `<strong>Gesamtsync fehlgeschlagen nach ${duration}s.</strong><br>${escapeHtml(status.error)}`;
  return `
    <strong>Gesamtsync abgeschlossen nach ${duration}s.</strong><br>
    ${escapeHtml(status.synced || 0)} Account${Number(status.synced || 0) === 1 ?"" : "s"} geprüft${status.skipped ?`, ${escapeHtml(status.skipped)} übersprungen` : ""}.
    ${status.failed ?`<br><b>${escapeHtml(status.failed)} Account${Number(status.failed) === 1 ?"" : "s"} mit Fehlern:</b><br>${failedAccounts.map((item) => `- ${escapeHtml(item.name || "Unbekannter Account")}: ${escapeHtml(item.details || "Keine Detailangabe vorhanden.")}`).join("<br>")}` : "<br>Keine Fehler gemeldet."}
  `;
}

async function syncMemberDiscord(user, discordId = "") {
  if (!user) return;
  const body = discordId ?{ discordId } : {};
  const data = await api(`/api/it/users/${user.id}/discord-sync`, { method: "POST", body: JSON.stringify(body), silent: true });
  const index = state.users.findIndex((item) => item.id === user.id);
  if (index !== -1 && data.user) state.users[index] = data.user;
  showNotify(data.synced ?"Discord Sync abgeschlossen." : "Discord Sync mit Hinweisen abgeschlossen.", data.synced ?"success" : "error");
  renderIT();
}

function openSyncDiscordModal(user) {
  if (!user) return;
  openModal(`
    <h3>Discord Sync starten</h3>
    <p class="muted">${escapeHtml(fullName(user))} ist noch nicht mit Discord gesynced. Trage die Discord User-ID ein, dann verknüpft der Bot den Account und synchronisiert Rollen sowie Nickname.</p>
    <label>Discord User-ID<input id="syncDiscordId" inputmode="numeric" pattern="[0-9]*" placeholder="z.B. 123456789012345678"></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" type="button" data-close>Abbrechen</button>
      <button class="blue-btn" id="confirmMemberDiscordSync" type="button">Syncen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmMemberDiscordSync").addEventListener("click", async () => {
      try {
        const discordId = modal.querySelector("#syncDiscordId").value.trim();
        await syncMemberDiscord(user, discordId);
        closeModal();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openResetPasswordModal(user) {
  if (!user) return;
  openModal(`
    <h3>Passwort zurücksetzen</h3>
    <p class="muted">${escapeHtml(fullName(user))} kann sich danach wieder mit dem aktuellen Standardpasswort anmelden.</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" type="button" data-close>Abbrechen</button>
      <button class="orange-btn" id="confirmPasswordReset" type="button">Auf Standardpasswort setzen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmPasswordReset").addEventListener("click", async () => {
      try {
        await api(`/api/it/users/${user.id}/reset-password`, { method: "POST", body: "{}" });
        closeModal();
        await bootstrap();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openResetDiscordModal(user) {
  if (!user) return;
  openModal(`
    <h3>Discord Sync zurücksetzen</h3>
    <p class="muted">${escapeHtml(fullName(user))} wird vollständig vom Discord Sync getrennt. Discord-ID, gespeicherter Discord Name, Rollen-Sync und Nickname-Verknüpfung werden aufgehoben.</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" type="button" data-close>Abbrechen</button>
      <button class="red-btn" id="confirmDiscordReset" type="button">Discord Sync resetten</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmDiscordReset").addEventListener("click", async () => {
      try {
        await api(`/api/it/users/${user.id}/reset-discord`, { method: "POST", body: "{}" });
        closeModal();
        await bootstrap();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

async function movePageOrder(page, direction) {
  const list = editableItPages();
  const index = list.indexOf(page);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= list.length) return;
  const next = [...list];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  const data = await api("/api/it/page-order", { method: "PATCH", body: JSON.stringify({ pageOrder: next }) });
  state.settings = data.settings;
  renderNavigation();
  renderIT();
}

function openCreatePageModal(type) {
  const isDepartment = type === "department";
  openModal(`
    <h3>${isDepartment ?"Abteilung erstellen" : "Reiter erstellen"}</h3>
    <p class="muted">${isDepartment ?"Erstellt ein leeres Abteilungsblatt mit Übersicht, Leitung und Notizen." : "Erstellt einen leeren Template-Reiter."}</p>
    <label>Name<input id="newPageName" placeholder="${isDepartment ?"z.B. Detective" : "z.B. Dienstanweisungen"}"></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="blue-btn" id="confirmCreatePage">Erstellen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmCreatePage").addEventListener("click", async () => {
      try {
        const name = modal.querySelector("#newPageName").value.trim();
        const data = await api(isDepartment ?"/api/it/departments" : "/api/it/custom-pages", {
          method: "POST",
          body: JSON.stringify({ name })
        });
        state.settings = data.settings || state.settings;
        if (Array.isArray(data.departments)) state.departments = data.departments;
        if (Array.isArray(data.settings?.customPages)) state.customPages = data.settings.customPages;
        else if (!isDepartment && data.page) state.customPages = [...(state.customPages || []), data.page];
        closeModal();
        renderNavigation();
        renderIT();
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

function openDataImportModal() {
  openModal(`
    <h3>Daten importieren</h3>
    <p class="muted">Importiert eine vollständige Dienstblatt-Datensicherung und ersetzt alle aktuellen Online-Daten. Danach wirst du abgemeldet und meldest dich mit den importierten Accounts neu an.</p>
    <label>Datensicherung auswählen<input id="dataImportFile" type="file" accept="application/json,.json"></label>
    <label class="checkbox-line">Ich verstehe, dass die aktuellen Online-Daten ersetzt werden.<input type="checkbox" id="confirmDataImport"></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="red-btn" id="runDataImport">Importieren</button>
    </div>
  `, (modal) => {
    modal.querySelector("#runDataImport").addEventListener("click", async () => {
      const file = modal.querySelector("#dataImportFile").files?.[0];
      const confirmed = modal.querySelector("#confirmDataImport").checked;
      if (!file) {
        modal.querySelector("#modalError").textContent = "Bitte eine JSON-Datei auswählen.";
        return;
      }
      if (!confirmed) {
        modal.querySelector("#modalError").textContent = "Bitte die Sicherheitsabfrage bestätigen.";
        return;
      }
      try {
        const text = await file.text();
        const db = JSON.parse(text);
        const data = await api("/api/it/import", { method: "POST", body: JSON.stringify({ db }) });
        clearAuthToken();
        state.token = "";
        state.currentUser = null;
        closeModal();
        showNotify(`Import abgeschlossen: ${data.users} Benutzer importiert. Bitte neu einloggen.`, "success");
        window.setTimeout(() => window.location.reload(), 900);
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message || "Import fehlgeschlagen.";
      }
    });
  });
}

async function saveItPermissions() {
  try {
    const data = await api("/api/it/permissions", { method: "PATCH", body: JSON.stringify({ permissions: collectPermissionEditors() }) });
    state.settings.permissions = data.permissions;
    const message = $("#permissionSaveMessage");
    if (message) {
      message.textContent = "Rechte gespeichert.";
      message.className = "muted";
    }
    renderNavigation();
    return data.permissions;
  } catch (error) {
    const message = $("#permissionSaveMessage");
    if (message) {
      message.textContent = error.message;
      message.className = "form-error";
    }
    throw error;
  }
}

function setupPermissionSearch(root = document) {
  root.querySelectorAll(".permission-search").forEach((input) => {
    const picker = input.closest(".permission-picker");
    const checks = picker.querySelector(".permission-checks");
    const syncPicker = (resetScroll = false) => {
      const term = input.value.toLowerCase().trim();
      checks.querySelectorAll("label").forEach((label) => {
        const checked = Boolean(label.querySelector("input")?.checked);
        const matches = label.textContent.toLowerCase().includes(term);
        label.classList.toggle("selected", checked);
        label.classList.toggle("suggestion-hidden", !checked && (!term || !matches));
      });
      if (resetScroll) checks.scrollTop = 0;
    };
    input.addEventListener("input", () => {
      syncPicker();
    });
    checks.querySelectorAll("input").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        syncPicker(true);
      });
    });
    syncPicker();
  });
}

function pagePermissionActions(page) {
  if (isDepartmentPage(page)) {
    const department = departmentByPage(page);
    return [
      [`departmentMembers:${department?.id}`, "Personal verwalten", "Person hinzufügen, Personal verwalten und Positionen ändern."],
      [`departmentNotes:${department?.id}`, "Notizen verwalten", "Notizen erstellen, bearbeiten und löschen."],
      ...(department?.id === "human-resources" ?[["personnelFiles", "Personalakten / Sanktionen", "Personalakten öffnen, Notizen schreiben und Sanktionen/Geldstrafen verwalten."]] : []),
      [`departmentInfo:${department?.id}`, "Informationen und interne Buttons", "Abteilungsinformationen, Weiterleitungen, Sondergenehmigungen und weitere interne Buttons bearbeiten."],
      [`departmentLeadership:${department?.id}`, "Leitung-Bereich", "Internen Leitungstab sehen und Mitgliedsnotizen anlegen."],
      ...(department?.id === "training-recruitment" ?[
        [`departmentModuleGrant:${department.id}`, "Module vergeben", "Haken und Module in der Modulvergabe hinzufügen."],
        [`departmentModuleRevoke:${department.id}`, "Module entziehen", "Haken und Module in der Modulvergabe wieder entfernen."],
        [`departmentTrainingChecks:${department.id}`, "Haken Verwaltung", "Haken umbenennen, Details/Kategorien/Reihenfolge und Sichtbarkeit bearbeiten."]
      ] : [])
    ];
  }
  const map = {
    Dienstblatt: [["editDefcon", "DEFCON anpassen", "Zahnrad und DEFCON-Stufe."], ["manageNotes", "Dienstblatt-Notizen", "Notizen schreiben/bearbeiten/löschen."], ["stopSingleDuty", "Einzelne Personen austragen", "Einzelne aktive Dienst-Einträge beenden. Standardmäßig für alle erlaubt."], ["stopAllDuty", "Alle austragen", "Alle Dienste beenden."]],
    Informationen: [["manageInformation", "Informationen bearbeiten", "Weiterleitungen, Sondergenehmigungen und Fraktionen."]],
    Direktion: [["manageMembers", "Mitgliederverwaltung", "Accounts und Archiv verwalten."], ["manageDutyHours", "Dienstzeiten verwalten", "Stunden hinzufügen/entfernen."], ["viewLogs", "Logs sehen", "Logs im Direktionsbereich."]]
  };
  return map[page] || [];
}

function renderDepartmentPositionManager(department) {
  if (!department) return "";
  const leaderPositions = departmentLeaderPositionsFor(department);
  const colorOptions = [["green", "Grün"], ["red", "Rot"], ["orange", "Orange"], ["blue", "Blau"]];
  return `
    <section class="department-position-manager">
      <div class="permission-row-head">
        <div class="permission-copy">
          <strong>Interne Ränge / Positionen</strong>
          <small>Abteilungsränge sortieren, umbenennen und als Leader markieren. Leader haben Zugriff auf Leitung, Notizen und Personalverwaltung.</small>
        </div>
        <button class="ghost-btn" type="button" id="addDepartmentPosition">+ Rang hinzufügen</button>
      </div>
      <div class="department-position-list" id="departmentPositionList">
        ${departmentPositionsFor(department).map((position) => `
          <label class="department-position-row">
            <span>${escapeHtml(position)}</span>
            <input data-dept-position-old="${escapeHtml(position)}" value="${escapeHtml(position)}" ${position === "Direktion" ?"readonly" : ""}>
            <select data-dept-position-color class="position-color-select">
              ${colorOptions.map(([value, label]) => `<option value="${value}" ${positionColorFor(department, position) === value ?"selected" : ""}>${label}</option>`).join("")}
            </select>
            <label class="leader-position-toggle"><input type="checkbox" data-dept-position-leader ${leaderPositions.includes(position) || position === "Direktion" ?"checked" : ""} ${position === "Direktion" ?"disabled" : ""}><span>Leader</span></label>
            <span class="position-order-controls">
              <button class="mini-icon move-department-position" type="button" data-direction="-1" title="Nach oben">${iconSvg("ChevronUp")}</button>
              <button class="mini-icon move-department-position" type="button" data-direction="1" title="Nach unten">${iconSvg("ChevronDown")}</button>
            </span>
            <button class="mini-icon danger remove-department-position" type="button" ${position === "Direktion" ?"disabled" : ""}>${actionIcon("delete")}</button>
          </label>
        `).join("")}
      </div>
    </section>
  `;
}
function collectDepartmentPositions(modal) {
  return Array.from(modal.querySelectorAll("[data-dept-position-old]")).map((input) => ({
    old: input.dataset.deptPositionOld,
    label: input.value.trim(),
    leader: Boolean(input.closest(".department-position-row")?.querySelector("[data-dept-position-leader]")?.checked),
    color: input.closest(".department-position-row")?.querySelector("[data-dept-position-color]")?.value || defaultPositionColor(input.value.trim())
  })).filter((item) => item.label);
}

function openPagePermissionModal(page) {
  const actions = pagePermissionActions(page);
  const department = isDepartmentPage(page) ?departmentByPage(page) : null;
  openModal(`
    <h3>Rechte: ${escapeHtml(navLabel(page))}</h3>
    <p class="muted">Hier stellst du Ansehen und wichtige interne Funktionen für dieses Blatt ein. IT und Direktion bleiben berechtigt, nur der IT-Reiter bleibt ausschließlich IT.</p>
    <div class="permission-list modal-permission-list">
      ${department ?renderDepartmentPositionManager(department) : ""}
      ${renderPermissionEditor("pages", page, "Blatt ansehen", pageDescription(page))}
      ${actions.map(([key, label, description]) => renderPermissionEditor("actions", key, label, description)).join("")}
    </div>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="blue-btn" id="savePagePermissions">Rechte speichern</button>
    </div>
  `, (modal) => {
    modal.classList.add("permission-modal");
    setupPermissionSearch(modal);
    modal.querySelector("#addDepartmentPosition")?.addEventListener("click", () => {
      modal.querySelector("#departmentPositionList")?.insertAdjacentHTML("beforeend", `
        <label class="department-position-row">
          <span>Neu</span>
          <input data-dept-position-old="" value="" placeholder="Name des neuen Rangs">
          <select data-dept-position-color class="position-color-select">
            <option value="green">Grün</option>
            <option value="red">Rot</option>
            <option value="orange">Orange</option>
            <option value="blue" selected>Blau</option>
          </select>
          <label class="leader-position-toggle"><input type="checkbox" data-dept-position-leader><span>Leader</span></label>
          <span class="position-order-controls">
            <button class="mini-icon move-department-position" type="button" data-direction="-1" title="Nach oben">${iconSvg("ChevronUp")}</button>
            <button class="mini-icon move-department-position" type="button" data-direction="1" title="Nach unten">${iconSvg("ChevronDown")}</button>
          </span>
          <button class="mini-icon danger remove-department-position" type="button">${actionIcon("delete")}</button>
        </label>
      `);
    });
    modal.addEventListener("click", (event) => {
      const removeButton = event.target.closest(".remove-department-position");
      if (removeButton && !removeButton.disabled) removeButton.closest(".department-position-row")?.remove();
      const moveButton = event.target.closest(".move-department-position");
      if (moveButton) {
        const row = moveButton.closest(".department-position-row");
        const direction = Number(moveButton.dataset.direction || 0);
        if (direction < 0 && row?.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
        if (direction > 0 && row?.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
      }
    });
    modal.querySelector("#savePagePermissions").addEventListener("click", async () => {
      try {
        if (department) {
          await api(`/api/departments/${department.id}/positions`, {
            method: "PATCH",
            body: JSON.stringify({ positions: collectDepartmentPositions(modal) })
          });
        }
        await saveItPermissions();
        closeModal();
        await bootstrap();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openAddRankModal() {
  const next = Math.max(...state.ranks.map((rank) => Number(rank.value)), -1) + 1;
  openModal(`
    <h3>Rang hinzufügen</h3>
    <label>Rangnummer<input id="newRankValue" type="number" min="0" value="${next}"></label>
    <label>Rangname<input id="newRankLabel" placeholder="Name des Rangs"></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="blue-btn" id="confirmAddRank">Hinzufügen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmAddRank").addEventListener("click", () => {
      const value = Number($("#newRankValue").value);
      const label = $("#newRankLabel").value.trim();
      if (!Number.isInteger(value) || value < 0 || !label) {
        $("#modalError").textContent = "Bitte Rangnummer und Rangname angeben.";
        return;
      }
      if (state.ranks.some((rank) => Number(rank.value) === value)) {
        $("#modalError").textContent = "Diese Rangnummer existiert bereits.";
        return;
      }
      state.ranks.push({ value, label });
      closeModal();
      renderIT();
    });
  });
}

function openRemoveRankModal() {
  openModal(`
    <h3>Rang entfernen</h3>
    <label>Rang auswählen
      <select id="removeRankValue">
        ${[...state.ranks].sort((a, b) => Number(a.value) - Number(b.value)).map((rank) => `<option value="${rank.value}">Rang ${rank.value} - ${escapeHtml(rank.label)}</option>`).join("")}
      </select>
    </label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="red-btn" id="confirmRemoveRank">Löschen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmRemoveRank").addEventListener("click", () => {
      const value = Number($("#removeRankValue").value);
      state.ranks = state.ranks.filter((rank) => Number(rank.value) !== value);
      closeModal();
      renderIT();
    });
  });
}

function renderDepartmentsOverview() {
  const departments = departmentsForOverview();
  content.innerHTML = `
    <section class="department-grid">
      ${departments.map((department) => renderDepartmentCard(department)).join("")}
    </section>
  `;

  document.querySelectorAll(".department-add").forEach((button) => {
    button.addEventListener("click", () => openDepartmentMemberModal(state.departments.find((department) => department.id === button.dataset.departmentId)));
  });
  document.querySelectorAll(".department-manage").forEach((button) => {
    button.addEventListener("click", () => openDepartmentManageModal(state.departments.find((department) => department.id === button.dataset.departmentId)));
  });
  document.querySelectorAll(".department-expand").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.departmentId;
      if (expandedDepartments.has(id)) expandedDepartments.delete(id);
      else expandedDepartments.add(id);
      localStorage.setItem("lspd_expanded_departments", JSON.stringify([...expandedDepartments]));
      renderDepartmentsOverview();
    });
  });
}

function renderDepartmentCard(department) {
  const members = [...department.members].sort((a, b) => {
    if (isSwatDepartment(department)) {
      const teamCompare = normalizeSwatTeam(a.swatTeam, "Z").localeCompare(normalizeSwatTeam(b.swatTeam, "Z"), "de");
      if (teamCompare) return teamCompare;
      if (Boolean(a.swatTeamLeader) !== Boolean(b.swatTeamLeader)) return a.swatTeamLeader ?-1 : 1;
    }
    return positionPowerFor(department, b.position) - positionPowerFor(department, a.position) || b.user.rank - a.user.rank;
  });
  const isExpanded = expandedDepartments.has(department.id);
  const visibleMembers = isExpanded ?members : members.slice(0, 5);
  const hiddenCount = Math.max(0, members.length - 5);
  return `
    <article class="department-card ${isSwatDepartment(department) ?"swat-department-card" : ""}">
      <div class="department-card-head">
        <strong>${iconSvg("Direktion")} ${escapeHtml(department.name)} <span class="department-member-count">${members.length}</span></strong>
        <span class="application-pill ${department.applicationStatus === "Offen" ?"open" : "closed"}">${escapeHtml(department.applicationStatus)}</span>
      </div>
      <button class="department-info info-strip" type="button" data-department-id="${escapeHtml(department.id)}">${iconSvg("Informationen")} Informationen</button>
      <table class="mini-table">
        <thead><tr><th>Position</th><th>Rang</th><th>Name</th></tr></thead>
        <tbody>
          ${visibleMembers.length ?visibleMembers.map((member) => {
            const swatLeader = isSwatDepartment(department) && isSwatTeamLeaderMember(member);
            const displayPosition = swatLeader ?`Teamleiter ${swatTeamLabel(member.swatTeam)}` : member.position;
            return `
            <tr>
              <td><span class="position-chip ${positionClass(member.position, department)} ${swatLeader ?"swat-leader-chip" : ""}">${escapeHtml(displayPosition)}</span></td>
              <td>${escapeHtml(member.user.rank)}</td>
              <td class="dept-card-name"><span class="online-dot ${member.isOnDuty ?"online" : ""}"></span><span>${escapeHtml(fullName(member.user))}</span></td>
            </tr>
          `; }).join("") : `<tr><td colspan="3" class="muted">Noch keine Mitglieder.</td></tr>`}
        </tbody>
      </table>
      ${departmentActionAllowed(department, "departmentMembers") ?`<button class="blue-btn department-manage" data-department-id="${escapeHtml(department.id)}">${iconSvg("Mitglieder")} Personal verwalten</button>` : ""}
      ${hiddenCount ?`<button class="blue-btn department-expand" data-department-id="${escapeHtml(department.id)}">${iconSvg("ChevronDown")} ${isExpanded ?"Weniger anzeigen" : `${hiddenCount} weitere anzeigen`}</button>` : ""}
    </article>
  `;
}

function renderDepartmentPage(department) {
  if (!department) {
    renderTemplate("Abteilung");
    return;
  }
  const leaders = department.members.filter((member) => ["Leitung", "Stv. Leitung"].includes(member.position) || (isSwatDepartment(department) && member.swatTeamLeader));
  const leaderText = isSwatDepartment(department)
    ?SWAT_TEAMS.map((team) => {
      const leader = department.members.find((member) => member.swatTeamLeader && normalizeSwatTeam(member.swatTeam) === team);
      return `${swatTeamLabel(team)}: ${leader ?fullName(leader.user) : "-"}`;
    }).join(" · ")
    : leaders.map((member) => fullName(member.user)).join(", ") || "-";
  const canMembers = departmentActionAllowed(department, "departmentMembers");
  const canNotes = departmentActionAllowed(department, "departmentNotes");
  const canInfo = departmentActionAllowed(department, "departmentInfo");
  const canLeadership = departmentActionAllowed(department, "departmentLeadership");
  const isTrainingDepartment = isTrainingDepartmentSheet(department);
  const isHumanResourcesDepartment = isHumanResourcesDepartmentSheet(department);
  const isDetectiveSheet = isDetectiveDepartment(department);
  const showLeadership = canLeadership || isHumanResourcesDepartment;
  const tab = departmentTab(department);
  content.innerHTML = `
    <section class="internal-subhead department-overview-head">
      <h2>${escapeHtml(department.name)} Abteilung</h2>
      <div class="department-control-row">
        <div class="tabs-row department-tabs">
          <button class="${tab === "overview" ?"tab-active" : ""}" data-department-tab="overview">\u00dcbersicht</button>
          ${isDetectiveSheet ?`<button class="${tab === "docs" ?"tab-active" : ""}" data-department-tab="docs">Dienstvorschriften</button>` : ""}
          ${isHumanResourcesDepartment ?`<button class="${tab === "members" ?"tab-active" : ""}" data-department-tab="members">Mitgliederverwaltung</button>` : ""}
          ${isTrainingDepartment ?`<button class="${tab === "moduleGrant" ?"tab-active" : ""}" data-department-tab="moduleGrant">Modulvergabe</button><button class="${tab === "trainingDocs" ?"tab-active" : ""}" data-department-tab="trainingDocs">Ausbildungen</button>${hasRole("IT") ?`<button class="${tab === "hiddenTraining" ?"tab-active" : ""}" data-department-tab="hiddenTraining">Ausgeblendet</button>` : ""}` : ""}
          ${showLeadership ?`<button class="${tab === "leadership" ?"tab-active" : ""}" data-department-tab="leadership">Leitung</button>` : ""}
        </div>
        <div class="department-header-actions">
          ${canInfo && tab === "trainingDocs" && isTrainingDepartment ?`<button class="ghost-btn vote-btn" id="editTrainingDocsLink" type="button">Google Docs Link einfügen</button>` : ""}
          ${canInfo ?`<button class="blue-btn vote-btn">${iconSvg("Abteilungen")} Abstimmung</button>` : ""}
        </div>
      </div>
      ${(!isHumanResourcesDepartment || tab === "overview") && tab !== "hiddenTraining" && tab !== "trainingDocs" ?`<div class="grid-3 internal-stats">
        <div class="stat-card internal-stat-card"><span>Mitglieder</span><i>${iconSvg("Mitglieder")}</i><strong>${department.members.length}</strong><small>Aktive Mitarbeiter</small></div>
        <div class="stat-card internal-stat-card"><span>Leitung / Stv. Leitung</span><i>${iconSvg("Direktion")}</i><strong>${escapeHtml(leaderText === "-" ?"-" : leaders.length)}</strong><small>${escapeHtml(leaderText)}</small></div>
      </div>` : ""}
      ${tab === "overview" ?renderDepartmentOverviewPanels(department, canMembers, canNotes) : ""}
      ${tab === "docs" && isDetectiveSheet ?renderDepartmentDocumentsPanel(department, canInfo) : ""}
      ${tab === "members" && isHumanResourcesDepartment ?renderHrLeadershipMemberCreatePanel(department, canLeadership) : ""}
      ${tab === "leadership" && showLeadership ?renderDepartmentLeadershipPanel(department) : ""}
      ${tab === "hiddenTraining" && isTrainingDepartment && hasRole("IT") ?renderHiddenTrainingPanel(department) : ""}
      ${tab === "moduleGrant" && isTrainingDepartment ?renderTrainingModuleGrantPanel(department) : ""}
      ${tab === "trainingDocs" && isTrainingDepartment ?renderTrainingDocsPanel(department, canInfo) : ""}
    </section>
  `;
  document.querySelectorAll("[data-department-tab]").forEach((button) => button.addEventListener("click", () => {
    setDepartmentTab(department, button.dataset.departmentTab);
    renderDepartmentPage(department);
  }));
  document.querySelectorAll("[data-training-hidden-tab]").forEach((button) => button.addEventListener("click", () => {
    localStorage.setItem(`lspd_training_hidden_tab_${department.id}`, button.dataset.trainingHiddenTab);
    renderDepartmentPage(department);
  }));
  document.querySelectorAll("[data-hr-leadership-tab]").forEach((button) => button.addEventListener("click", () => {
    localStorage.setItem(`lspd_hr_leadership_tab_${department.id}`, button.dataset.hrLeadershipTab);
    renderDepartmentPage(department);
  }));
  $("#hrCreateMember")?.addEventListener("click", openHrUserModal);
  $("#hrMemberSearch")?.addEventListener("input", (event) => {
    localStorage.setItem("lspd_hr_member_search", event.target.value);
    renderDepartmentPage(department);
    const input = $("#hrMemberSearch");
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  });
  $("#addSanctionCatalogRow")?.addEventListener("click", () => {
    const rows = $("#sanctionCatalogRows");
    if (rows) rows.insertAdjacentHTML("beforeend", renderSanctionCatalogCategory("Neue Kategorie", [defaultSanctionCatalogItem("Neue Kategorie")]));
  });
  document.querySelectorAll(".add-sanction-catalog-to-category").forEach((button) => button.addEventListener("click", () => {
    const body = button.closest(".catalog-category-block")?.querySelector(".catalog-category-body");
    if (body) body.insertAdjacentHTML("beforeend", renderSanctionCatalogEditorRow(defaultSanctionCatalogItem(button.dataset.category || "Allgemein")));
  }));
  $("#hrSanctionCatalogForm")?.addEventListener("submit", saveHrSanctionCatalog);
  $("#sanctionCatalogRows")?.addEventListener("click", (event) => {
    const removeButton = event.target.closest(".remove-sanction-catalog-row");
    if (removeButton) removeButton.closest(".catalog-editor-row")?.remove();
  });
  document.querySelectorAll(".remove-sanction-catalog-row").forEach((button) => button.addEventListener("click", () => button.closest(".catalog-editor-row")?.remove()));
  document.querySelectorAll(".department-add").forEach((button) => button.addEventListener("click", () => openDepartmentMemberModal(department)));
  document.querySelectorAll(".department-manage").forEach((button) => button.addEventListener("click", () => openDepartmentManageModal(department)));
  document.querySelectorAll(".dept-note-add").forEach((button) => button.addEventListener("click", () => openDepartmentNoteModal(department)));
  document.querySelectorAll(".department-doc-open").forEach((button) => button.addEventListener("click", () => openDepartmentDocumentView(department, button.dataset.docId)));
  $("#addDepartmentDoc")?.addEventListener("click", () => openDepartmentDocumentCreateTypeModal(department));
  document.querySelectorAll(".department-doc-edit").forEach((button) => button.addEventListener("click", () => openDepartmentDocumentModal(department, (department.docs || []).find((doc) => doc.id === button.dataset.docId))));
  document.querySelectorAll(".department-doc-delete").forEach((button) => button.addEventListener("click", () => openDeleteDepartmentDocumentModal(department, button.dataset.docId)));
  $("#editTrainingDocsLink")?.addEventListener("click", () => openTrainingDocsLinkModal(department));
  loadTrainingDocsOutline();
  $("#swatCallBtn")?.addEventListener("click", () => openSwatCallModal(department));
  document.querySelectorAll(".swat-team-add").forEach((button) => button.addEventListener("click", () => openDepartmentManageModal(department, { swatTeam: button.dataset.team || "" })));
  document.querySelectorAll(".swat-team-deactivate").forEach((button) => button.addEventListener("click", () => setSwatTeamStatus(department, button.dataset.team || "", false)));
  document.querySelectorAll(".dept-member-file-menu").forEach((button) => button.addEventListener("click", () => openDepartmentMemberFileMenu(department, button.dataset.userId)));
  document.querySelectorAll(".hr-open-sanction-file").forEach((button) => button.addEventListener("click", () => openPersonnelFileModal(findAnyUser(button.dataset.userId))));
  document.querySelectorAll(".dept-member-note-add").forEach((button) => button.addEventListener("click", () => openDepartmentMemberNoteModal(department, button.dataset.userId, button.dataset.noteType || "Normal")));
  document.querySelectorAll(".dept-member-notes-view").forEach((button) => button.addEventListener("click", () => openDepartmentMemberNotesViewModal(department, button.dataset.userId, button.dataset.noteType || "")));
  document.querySelectorAll(".delete-dept-member-note").forEach((button) => button.addEventListener("click", () => openDeleteDepartmentMemberNoteModal(department, button.dataset.noteId)));
  document.querySelectorAll(".manage-user-absence").forEach((button) => button.addEventListener("click", () => openAbsenceManageModal(button.dataset.absenceId, button.dataset.canEnd === "1")));
  $("#leadershipSearch")?.addEventListener("input", (event) => {
    localStorage.setItem(`lspd_leadership_search_${department.id}`, event.target.value);
    renderDepartmentPage(department);
    const input = $("#leadershipSearch");
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  });
  $("#leadershipRange")?.addEventListener("change", (event) => {
    localStorage.setItem(`lspd_leadership_range_${department.id}`, event.target.value);
    renderDepartmentPage(department);
  });
  setupTableFilter("#absenceSearch");
  $("#absenceSearch")?.addEventListener("input", (event) => localStorage.setItem(`lspd_absence_search_department_${department.id}`, event.target.value));
  if ($("#absenceSearch")?.value) $("#absenceSearch")?.dispatchEvent(new Event("input"));
  document.querySelectorAll(".end-absence").forEach((button) => button.addEventListener("click", () => openEndAbsenceModal(button.dataset.id, true)));
  document.querySelectorAll(".view-user-absence").forEach((button) => button.addEventListener("click", () => openAbsenceInfoModal(button.dataset.absenceId)));
  $("#startEstExam")?.addEventListener("click", () => {
    const candidateId = userIdFromExamInput("estCandidateInput", "estCandidateList");
    if (!candidateId) {
      showNotify("Bitte zuerst einen Prüfling auswählen.", "error");
      return;
    }
    const exam = createTrainingExam("est", candidateId, "", trainingStore().estModules);
    saveActiveTrainingExam(exam);
    renderDepartmentPage(department);
    openTrainingExamModal(exam.id);
    showNotify("Grundausbildung angelegt.", "success");
  });
  $("#continueEstExam")?.addEventListener("click", () => {
    openTrainingExamModal($("#continueEstExam")?.dataset.examId);
  });
  $("#startModuleExam")?.addEventListener("click", () => {
    const candidateId = userIdFromExamInput("moduleCandidateInput", "moduleCandidateList");
    const selectedModules = Array.from($("#moduleExamSelect")?.selectedOptions || []).map((option) => option.value);
    if (!candidateId || !selectedModules.length) {
      showNotify("Bitte Prüfling und Modul auswählen.", "error");
      return;
    }
    const store = trainingStore();
    const modules = store.moduleModules.filter((module) => selectedModules.includes(module.id));
    const exam = createTrainingExam("module", candidateId, "", modules);
    saveActiveTrainingExam(exam);
    renderDepartmentPage(department);
    openTrainingExamModal(exam.id);
    showNotify("Modul Prüfung angelegt.", "success");
  });
  $("#moduleGrantSearch")?.addEventListener("input", (event) => {
    localStorage.setItem("lspd_training_module_grant_search", event.target.value);
    renderDepartmentPage(department);
  });
  document.querySelectorAll(".save-module-grant").forEach((button) => button.addEventListener("click", async () => {
    const userId = button.dataset.userId;
    const selected = {};
    let changed = false;
    document.querySelectorAll(`[data-module-grant="${CSS.escape(userId)}"]`).forEach((toggle) => {
      const value = toggle.getAttribute("aria-pressed") === "true";
      selected[toggle.dataset.training] = value;
      if ((toggle.dataset.initial === "1") !== value) changed = true;
    });
    if (!changed) {
      showNotify("Keine Moduländerung ausgewählt.", "success");
      return;
    }
    try {
      await api(`/api/training/modules/${userId}`, { method: "PATCH", body: JSON.stringify({ trainings: selected }) });
      await bootstrap();
      showNotify("Module gespeichert.", "success");
    } catch (error) {
      showNotify(error.message, "error");
    }
  }));
  document.querySelectorAll(".module-toggle").forEach((button) => button.addEventListener("click", () => {
    if (button.disabled) return;
    const next = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", next ?"true" : "false");
    button.classList.toggle("is-active", next);
    const status = button.querySelector("i");
    if (status) status.textContent = next ?"Vergeben" : "Offen";
  }));
  setupTrainingManagementActions(department);
  document.querySelectorAll(".training-exam-open").forEach((button) => button.addEventListener("click", () => openTrainingExamModal(button.dataset.examId, button.dataset.readonly === "true")));
  document.querySelectorAll(".training-exam-archive").forEach((button) => button.addEventListener("click", () => archiveTrainingExam(button.dataset.examId, department)));
  document.querySelectorAll(".training-exam-delete").forEach((button) => button.addEventListener("click", () => openDeleteTrainingExamModal(button.dataset.examId, department)));
  document.querySelectorAll(".training-exam-pause").forEach((button) => button.addEventListener("click", () => pauseTrainingExam(button.dataset.examId, department)));
  document.querySelectorAll(".training-exam-stop").forEach((button) => button.addEventListener("click", () => archiveTrainingExam(button.dataset.examId, department)));
  document.querySelectorAll(".training-est-grant").forEach((button) => button.addEventListener("click", () => grantEstTrainingFromArchive(button.dataset.userId, department)));
  setupExamUserPickers(document);
  document.querySelectorAll(".training-archive-search").forEach((input) => input.addEventListener("input", () => {
    const term = input.value.toLowerCase();
    input.closest(".training-archive-card")?.querySelectorAll(".training-archive-row").forEach((row) => row.classList.toggle("hidden", !row.textContent.toLowerCase().includes(term)));
  }));
  if (trainingTimerInterval) window.clearInterval(trainingTimerInterval);
  trainingTimerInterval = window.setInterval(() => {
    document.querySelectorAll(".exam-live-timer[data-started-at]").forEach((item) => {
      const startedAt = item.dataset.startedAt;
      item.textContent = item.dataset.paused === "true" ?"Pausiert" : startedAt ?formatDuration(Date.now() - new Date(startedAt).getTime()) : "Noch nicht gestartet";
    });
  }, 1000);
}

function googleDocsLinkInfo(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!/\.google\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/(document|spreadsheets|presentation|forms)\/d\/(?:e\/)?([^/]+)/i);
    if (!match) return null;
    const [, type, id] = match;
    const normalizedType = type.toLowerCase();
    const published = url.pathname.includes("/pub") || url.pathname.includes("/d/e/");
    if (published) {
      url.searchParams.set("embedded", "true");
      return { type: normalizedType, id, embedUrl: url.toString(), sourceUrl: raw, published };
    }
    return { type: normalizedType, id, embedUrl: `https://docs.google.com/${normalizedType}/d/${encodeURIComponent(id)}/preview`, sourceUrl: raw, published };
  } catch {
    return null;
  }
}

function googleDocsEmbedUrl(value = "") {
  return googleDocsLinkInfo(value)?.embedUrl || "";
}

function renderTrainingDocsPanel(department, canEdit = false) {
  const docsUrl = String(department.trainingDocsUrl || "").trim();
  const docsInfo = googleDocsLinkInfo(docsUrl);
  const embedUrl = docsInfo?.embedUrl || "";
  const showOutline = docsInfo?.type === "document";
  return `
    <div class="panel department-overview-content training-docs-panel">
      ${embedUrl ?`
        <div class="training-docs-embed-shell ${showOutline ?"with-outline" : ""}">
          ${showOutline ?`
            <aside class="training-docs-outline" id="trainingDocsOutline" data-doc-url="${escapeHtml(docsUrl)}">
              <strong>Struktur</strong>
              <span class="muted">Wird geladen...</span>
            </aside>
          ` : ""}
          <div class="training-docs-frame-wrap">
            <iframe id="trainingDocsFrame" class="training-docs-frame" src="${escapeHtml(embedUrl)}" data-base-src="${escapeHtml(embedUrl)}" title="Police Academy Ausbildungen" loading="eager" referrerpolicy="no-referrer-when-downgrade"></iframe>
          </div>
        </div>
      ` : docsUrl ?`
        <div class="empty-state training-docs-empty">
          <strong>Der Link kann nicht direkt eingebettet werden.</strong>
          <span>Bitte nutze einen Google Docs, Tabellen, Präsentationen oder Forms Link.</span>
          <a class="blue-btn" href="${escapeHtml(docsUrl)}" target="_blank" rel="noopener">Extern öffnen</a>
        </div>
      ` : `
        <div class="empty-state training-docs-empty">
          <strong>Noch kein Ausbildungsdokument hinterlegt.</strong>
          <span>Füge oben einen Google-Docs-Link ein, damit er hier integriert angezeigt wird.</span>
        </div>
      `}
    </div>
  `;
}

function openTrainingDocsLinkModal(department) {
  const docsUrl = String(department.trainingDocsUrl || "").trim();
  openModal(`
    <h3>Google Docs Link einfügen</h3>
    <p class="muted">Füge hier den Google Docs, Tabellen, Präsentationen oder Forms Link für die Police Academy Ausbildungen ein.</p>
    <label>Google Docs Link<textarea id="trainingDocsUrl" rows="4" placeholder="Google Docs Link hier einfügen">${escapeHtml(docsUrl)}</textarea></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      ${docsUrl ?`<button class="ghost-btn" id="clearTrainingDocsUrl" type="button">Link entfernen</button>` : ""}
      <button class="ghost-btn" data-close type="button">Abbrechen</button>
      <button class="blue-btn" id="saveTrainingDocsUrl" type="button">Speichern</button>
    </div>
  `, (modal) => {
    modal.querySelector("#saveTrainingDocsUrl")?.addEventListener("click", async () => {
      try {
        await saveDepartmentInfo(department, { trainingDocsUrl: modal.querySelector("#trainingDocsUrl")?.value.trim() || "" });
        showNotify("Ausbildungen gespeichert.", "success");
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
    modal.querySelector("#clearTrainingDocsUrl")?.addEventListener("click", async () => {
      try {
        await saveDepartmentInfo(department, { trainingDocsUrl: "" });
        showNotify("Ausbildungslink entfernt.", "success");
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

async function loadTrainingDocsOutline() {
  const outlineRoot = $("#trainingDocsOutline");
  const frame = $("#trainingDocsFrame");
  const sourceUrl = outlineRoot?.dataset.docUrl || "";
  if (!outlineRoot || !frame || !sourceUrl) return;
  const jumpToTrainingDocHeading = (headingId = "") => {
    if (!headingId) return;
    const base = frame.dataset.baseSrc || frame.src.split("#")[0];
    try {
      const url = new URL(base, window.location.origin);
      url.hash = `heading=${headingId}`;
      frame.src = url.toString();
    } catch {
      frame.src = `${base.split("#")[0]}#heading=${headingId}`;
    }
  };
  const showTrainingDocsJumpHighlight = (title = "") => {
    const frameWrap = frame.closest(".training-docs-frame-wrap");
    if (!frameWrap) return;
    frameWrap.querySelector(".training-docs-jump-highlight")?.remove();
    frameWrap.classList.remove("is-jump-highlighted");
    window.requestAnimationFrame(() => frameWrap.classList.add("is-jump-highlighted"));
    const marker = document.createElement("div");
    marker.className = "training-docs-jump-highlight";
    marker.innerHTML = `<strong>Geöffnet</strong><span>${escapeHtml(title || "Ausgewählter Abschnitt")}</span>`;
    frameWrap.append(marker);
    window.setTimeout(() => {
      marker.remove();
      frameWrap.classList.remove("is-jump-highlighted");
    }, 2600);
  };
  const cacheKey = `${TRAINING_DOCS_OUTLINE_CACHE_PREFIX}${sourceUrl}`;
  const renderOutline = (outline, cached = false) => {
    if (!outline.length) {
      outlineRoot.innerHTML = `<strong>Struktur</strong><span class="muted">Keine Überschriften gefunden. Nutze in Google Docs Überschriften, damit hier ein Inhaltsverzeichnis entsteht.</span>`;
      return;
    }
    outlineRoot.innerHTML = `
      <strong>Struktur</strong>
      <label class="training-docs-search">
        <span>Im Dokument suchen</span>
        <input id="trainingDocsSearch" type="search" autocomplete="off" placeholder="Struktur und Text durchsuchen">
      </label>
      <div id="trainingDocsSearchResults" class="training-docs-search-results hidden"></div>
      ${cached ?`<small class="training-docs-cache-note">Zwischengespeicherte Struktur. Aktualisierung läuft im Hintergrund.</small>` : ""}
      <div class="training-docs-outline-list">
        ${outline.map((item) => `<button type="button" data-google-heading="${escapeHtml(item.id)}" class="level-${escapeHtml(item.level)}">${escapeHtml(item.text)}</button>`).join("")}
      </div>
    `;
    outlineRoot.onclick = (event) => {
      const button = event.target.closest("[data-google-heading]");
      if (!button || !outlineRoot.contains(button)) return;
      event.preventDefault();
      jumpToTrainingDocHeading(button.dataset.googleHeading || "");
      showTrainingDocsJumpHighlight(button.textContent.trim());
      outlineRoot.querySelectorAll("button.active").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
    };
    const searchInput = outlineRoot.querySelector("#trainingDocsSearch");
    const searchResults = outlineRoot.querySelector("#trainingDocsSearchResults");
    let searchTimer = null;
    searchInput?.addEventListener("input", () => {
      const term = searchInput.value.trim().toLowerCase();
      outlineRoot.querySelectorAll("[data-google-heading]").forEach((button) => {
        button.classList.toggle("hidden", Boolean(term) && !button.textContent.toLowerCase().includes(term));
      });
      window.clearTimeout(searchTimer);
      if (!term) {
        searchResults?.classList.add("hidden");
        if (searchResults) searchResults.innerHTML = "";
        return;
      }
      if (searchResults) {
        searchResults.classList.remove("hidden");
        searchResults.innerHTML = `<span class="muted">Text wird gesucht...</span>`;
      }
      searchTimer = window.setTimeout(async () => {
        try {
          const result = await api(`/api/google-docs-search?url=${encodeURIComponent(sourceUrl)}&q=${encodeURIComponent(searchInput.value.trim())}`, { silent: true });
          const matches = Array.isArray(result.matches) ?result.matches : [];
          if (!searchResults) return;
          searchResults.innerHTML = matches.length ?`
            <strong>${matches.length} Texttreffer</strong>
            <div class="training-docs-search-list">
              ${matches.map((match) => `
                <button type="button" data-google-heading="${escapeHtml(match.headingId || "")}">
                  <b>${escapeHtml(match.headingText || "Texttreffer")}</b>
                  <span>${escapeHtml(match.snippet || "")}</span>
                </button>
              `).join("")}
            </div>
          ` : `<span class="muted">Keine Texttreffer gefunden.</span>`;
          searchResults.querySelectorAll("[data-google-heading]").forEach((button) => {
            button.addEventListener("click", () => {
              const headingId = button.dataset.googleHeading || "";
              jumpToTrainingDocHeading(headingId);
              showTrainingDocsJumpHighlight(button.querySelector("b")?.textContent?.trim() || button.textContent.trim());
            });
          });
        } catch (error) {
          if (searchResults) searchResults.innerHTML = `<span class="muted">${escapeHtml(error.message || "Suche konnte nicht geladen werden.")}</span>`;
        }
      }, 280);
    });
  };
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
    if (Array.isArray(cached?.outline) && cached.outline.length) renderOutline(cached.outline, true);
  } catch {}
  try {
    const data = await api(`/api/google-docs-outline?url=${encodeURIComponent(sourceUrl)}`, { silent: true });
    const outline = Array.isArray(data.outline) ?data.outline : [];
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ outline, fetchedAt: data.fetchedAt || new Date().toISOString() }));
    } catch {}
    renderOutline(outline, false);
  } catch (error) {
    if (!outlineRoot.querySelector("[data-google-heading]")) {
      outlineRoot.innerHTML = `<strong>Struktur</strong><span class="muted">${escapeHtml(error.message || "Struktur konnte nicht geladen werden.")}</span>`;
    }
  }
}

function renderDepartmentOverviewPanels(department, canMembers, canNotes) {
  if (isSwatDepartment(department)) return renderSwatOverviewPanels(department, canMembers, canNotes);
  return `
    <div class="department-layout department-overview-content">
      <div class="panel">
        <div class="panel-header">
          <h3><span class="section-icon">${iconSvg("Mitglieder")}</span>Abteilungsmitglieder</h3>
          ${canMembers ?`<button class="blue-btn department-manage" data-department-id="${escapeHtml(department.id)}">${iconSvg("Mitglieder")} Personal verwalten</button>` : ""}
        </div>
        ${renderDepartmentMemberTable(department)}
      </div>
      <div class="panel">
        <div class="panel-header">
          <h3><span class="section-icon">${iconSvg("Einsatzzentrale")}</span>Notizen</h3>
          ${canNotes ?`<button class="blue-btn dept-note-add" data-department-id="${escapeHtml(department.id)}">+ Neue Notiz</button>` : ""}
        </div>
        <div class="note-list">
          ${department.notes.length ?department.notes.map((note) => renderDepartmentNote(department, note)).join("") : `<p class="muted">Noch keine Notizen vorhanden.</p>`}
        </div>
      </div>
    </div>
  `;
}

function renderDepartmentDocumentsPanel(department, canEdit = false) {
  const docs = [...(department.docs || [])].sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  return `
    <div class="panel department-documents-panel">
      <div class="panel-header">
        <div>
          <h3>Dienstvorschriften</h3>
          <p class="muted">Detective-interne Dokumente und Vorschriften.</p>
        </div>
        ${canEdit ?`<button class="blue-btn" id="addDepartmentDoc" type="button">${iconSvg("Plus")} Hinzufügen</button>` : ""}
      </div>
      <div class="information-doc-grid department-doc-grid">
        ${docs.map((doc) => `
          <article class="information-doc-tile department-doc-tile">
            <button class="information-doc-open department-doc-open" type="button" data-doc-id="${escapeHtml(doc.id)}">
              <span class="doc-type-pill">Dienstvorschrift</span>
              <strong>${escapeHtml(doc.title)}</strong>
              <small>${escapeHtml((doc.body || "").replace(/[#*_>\-`]/g, "").slice(0, 140) || "Kein Inhalt")}</small>
              <em>${escapeHtml(doc.authorName || "-")} · ${formatDateTime(doc.updatedAt || doc.createdAt)}</em>
            </button>
            ${canEdit ?`<div class="doc-tile-actions"><button class="mini-icon department-doc-edit" type="button" data-doc-id="${escapeHtml(doc.id)}" title="Bearbeiten">${actionIcon("edit")}</button><button class="mini-icon danger department-doc-delete" type="button" data-doc-id="${escapeHtml(doc.id)}" title="Löschen">${actionIcon("delete")}</button></div>` : ""}
          </article>
        `).join("") || `<p class="muted">Noch keine Dienstvorschriften hinterlegt.</p>`}
      </div>
    </div>
  `;
}

function openDepartmentDocumentView(department, docId) {
  const doc = (department.docs || []).find((item) => item.id === docId);
  if (!doc) return;
  const canEdit = departmentActionAllowed(department, "departmentInfo");
  openModal(`
    <div class="paper-doc-modal">
      <div class="paper-doc-head">
        <div>
          <span class="eyebrow">${escapeHtml(department.name)}</span>
          <h3>${escapeHtml(doc.title)}</h3>
          <p class="muted">${escapeHtml(doc.authorName || "-")} · ${formatDateTime(doc.updatedAt || doc.createdAt)}</p>
        </div>
        ${canEdit ?`<button class="blue-btn compact-action" id="editDepartmentDoc" type="button">${actionIcon("edit")} Bearbeiten</button>` : ""}
      </div>
      <div class="paper-doc-body">${formatInformationDocText(doc.body || "") || ""}</div>
    </div>
    <div class="modal-actions"><button class="ghost-btn" data-close>Schließen</button></div>
  `, (modal) => {
    modal.querySelector("#editDepartmentDoc")?.addEventListener("click", () => openDepartmentDocumentModal(department, doc));
  });
}

function openDepartmentDocumentCreateTypeModal(department) {
  openModal(`
    <h3>Dienstvorschrift hinzufügen</h3>
    <p class="muted">Wähle aus, wie die neue Vorschrift aufgebaut werden soll.</p>
    <div class="doc-create-choice-grid">
      <button class="doc-create-choice" type="button" id="createTextDepartmentDoc">
        <span>${iconSvg("Informationen")}</span>
        <b>Normales Textfeld</b>
        <small>Freier Text mit Absätzen, Links und Bildern als eingefügte Inhalte.</small>
      </button>
      <button class="doc-create-choice" type="button" id="createStructuredDepartmentDoc">
        <span>${iconSvg("Dienstblatt")}</span>
        <b>Vorschriften-Menü</b>
        <small>Header, Bildbereich, Daten und Zusatzinfos wie bei den Dokumenten.</small>
      </button>
    </div>
    <div class="modal-actions"><button class="ghost-btn" data-close>Abbrechen</button></div>
  `, (modal) => {
    modal.querySelector("#createTextDepartmentDoc")?.addEventListener("click", () => openDepartmentDocumentModal(department));
    modal.querySelector("#createStructuredDepartmentDoc")?.addEventListener("click", () => {
      openDepartmentDocumentModal(department, {
        title: "",
        body: serializeStructuredRegulations({
          headerTitle: "",
          headerText: "",
          items: [{ id: makeTrainingId("rule"), image: "", title: "", data: "", info: "" }]
        })
      });
    });
  });
}

function openDepartmentDocumentModal(department, doc = null) {
  const existingDoc = Boolean(doc?.id);
  openModal(`
    <h3>${existingDoc ?"Dienstvorschrift bearbeiten" : "Dienstvorschrift erstellen"}</h3>
    <label>Titel<input id="departmentDocTitle" value="${escapeHtml(doc?.title || "")}" placeholder="Titel der Vorschrift" required></label>
    <label>Inhalt<textarea id="departmentDocBody" rows="16" placeholder="Text, Links oder Bilder einfügen. Dick schreiben mit **Text**.">${escapeHtml(doc?.body || "")}</textarea></label>
    <p class="muted">Absätze bleiben erhalten. Links werden beim Öffnen anklickbar.</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="blue-btn" id="saveDepartmentDoc">Speichern</button>
    </div>
  `, (modal) => {
    modal.querySelector("#saveDepartmentDoc")?.addEventListener("click", async () => {
      const title = modal.querySelector("#departmentDocTitle")?.value.trim() || "";
      const body = modal.querySelector("#departmentDocBody")?.value || "";
      if (!title) {
        modal.querySelector("#modalError").textContent = "Bitte einen Titel eintragen.";
        return;
      }
      const nextDoc = {
        ...(doc || {}),
        id: doc?.id || makeTrainingId("deptdoc"),
        title,
        body,
        createdAt: doc?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        authorId: doc?.authorId || state.currentUser.id,
        authorName: doc?.authorName || fullName(state.currentUser)
      };
      try {
        await saveDepartmentInfo(department, { docs: upsertById(department.docs || [], nextDoc) });
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

function openDeleteDepartmentDocumentModal(department, docId) {
  const doc = (department.docs || []).find((item) => item.id === docId);
  if (!doc) return;
  openModal(`
    <h3>Dienstvorschrift löschen</h3>
    <p class="muted">${escapeHtml(doc.title)}</p>
    <p>Diese Dienstvorschrift wirklich löschen?</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="red-btn" id="confirmDeleteDepartmentDoc">Löschen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmDeleteDepartmentDoc")?.addEventListener("click", async () => {
      try {
        await saveDepartmentInfo(department, { docs: (department.docs || []).filter((item) => item.id !== docId) });
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

function activeEstExamOld() {
  try {
    return JSON.parse(localStorage.getItem("lspd_active_est_exam") || "null");
  } catch {
    return null;
  }
}

function legacyEstModules() {
  return [
    { name: "Rechtskunde", description: "Rechtsfragen und Grundlagen", questions: ["Wann darf eine Person durchsucht werden?", "Welche Rechte gelten bei einer Festnahme?"] },
    { name: "Dienstvorschriften", description: "Interne Regeln und Vorgehen", questions: ["Wie wird ein Einsatzbericht dokumentiert?", "Wann wird eine Leitung informiert?"] },
    { name: "Ortskunde", description: "Orte, Wege und Zuständigkeiten", questions: ["Wo befindet sich der Sammelpunkt?", "Welche Route führt zum Vespucci PD?"] }
  ];
}

const TRAINING_STORE_KEY = "lspd_training_exam_store";

const EST_LOCATION_PROMPTS = [
  "Würfelpark",
  "LSPD HQ",
  "Vespucci Kleidungsladen",
  "EKZ",
  "Ententeich",
  "Alamosee",
  "Schweinefarm",
  "Pferderanch",
  "Casino",
  "Container Hafen",
  "Missionrow PD",
  "Tequilala Bar"
];

function makeTrainingId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function grantEstTrainingFromArchive(userId, department) {
  try {
    await api(`/api/training/est/${userId}`, { method: "POST" });
    await bootstrap();
    renderDepartmentPage(department);
    showNotify("Grundausbildung vergeben.", "success");
  } catch (error) {
    showNotify(error.message, "error");
  }
}

function defaultTrainingQuestion(prompt, type = "manual", maxPoints = null) {
  const resolvedMaxPoints = maxPoints ?? (type === "location" ?1 : type === "scenario" ?10 : 3);
  return {
    id: makeTrainingId("question"),
    prompt,
    type,
    solution: type === "manual" ?"Musterlösung für den Prüfer eintragen." : "",
    answers: type === "choice" ?["Antwortmöglichkeit"] : [],
    correctAnswers: [],
    wrongAnswers: [],
    image: "",
    scenarioInfo: "",
    fileAction: "",
    stationType: "",
    targetSeconds: 0,
    timeSeconds: 0,
    maxPoints: resolvedMaxPoints
  };
}

function defaultTrainingStore() {
  return {
    estModules: [
      { id: "est-law", name: "Rechtskunde", description: "Rechtsfragen und Grundlagen", phase: 1, questions: [defaultTrainingQuestion("Wann darf eine Person durchsucht werden?", "manual", 3), defaultTrainingQuestion("Welche Rechte gelten bei einer Festnahme?", "manual", 3)] },
      { id: "est-location", name: "Ortskunde", description: "Orte, Wege und Zuständigkeiten", questions: EST_LOCATION_PROMPTS.map((place) => defaultTrainingQuestion(place, "location")) },
      { id: "est-scenario", name: "Szenario", description: "10-80 / praktisches Szenario mit Akten-/Prüferinfos", phase: 2, questions: [defaultTrainingQuestion("10-80 Szenario", "scenario", 10)] },
      { id: "est-rules", name: "Dienstvorschriften", description: "Interne Regeln und Vorgehen", phase: 3, questions: [defaultTrainingQuestion("Wie wird ein Einsatzbericht dokumentiert?", "manual", 3)] },
      { id: "est-drive", name: "Fahrstrecke", description: "Fahrroute mit Bild und automatischer Zeitwertung", questions: [defaultTrainingQuestion("Fahrstrecke 1", "location", 10)] },
      { id: "est-heli", name: "Helistrecke", description: "Helikopterroute und Landedächer mit Bild und Zeitwertung", phase: 4, questions: [defaultTrainingQuestion("Helistrecke Route", "location", 10), defaultTrainingQuestion("Dachlandung 1", "location", 10)] }
    ],
    moduleModules: trainings.filter((training) => training !== "EST").slice(0, 6).map((training) => ({
      id: `module-${training.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: training,
      description: "Modulprüfung vorbereiten",
      questions: [defaultTrainingQuestion(`${training}: Prüffrage eintragen.`, "manual", 3)]
    })),
    activeExams: []
  };
}

function trainingStore() {
  try {
    const stored = JSON.parse(localStorage.getItem(TRAINING_STORE_KEY) || "null");
    if (stored?.estModules?.length) return normalizeTrainingStore({ ...defaultTrainingStore(), ...stored, activeExams: stored.activeExams || [] });
  } catch {
    return defaultTrainingStore();
  }
  const defaults = defaultTrainingStore();
  localStorage.setItem(TRAINING_STORE_KEY, JSON.stringify(defaults));
  return defaults;
}

function normalizeTrainingStore(store) {
  const defaults = defaultTrainingStore();
  const normalizedQuestionMaxPoints = (module, question) => {
    if (module.id === "est-location") return 1;
    if (["est-drive", "est-heli"].includes(module.id)) return Math.min(10, Math.max(1, Number(question.maxPoints || 10)));
    if (question.type === "scenario" || module.id === "est-scenario") return Math.min(10, Math.max(5, Number(question.maxPoints || 10)));
    return Math.min(10, Math.max(3, Number(question.maxPoints || 3)));
  };
  const mergeModules = (current, fallback) => {
    const modules = [...(current || [])];
    fallback.forEach((module) => {
      if (!modules.some((item) => item.id === module.id || item.name === module.name)) modules.push(module);
    });
    return modules.map((module) => ({
      ...module,
      questions: (module.questions || []).map((question) => ({
        ...question,
        answers: Array.isArray(question.answers) ?question.answers : [...(question.correctAnswers || []), ...(question.wrongAnswers || [])].filter(Boolean),
        correctAnswers: [],
        wrongAnswers: [],
        image: question.image || "",
        scenarioInfo: question.scenarioInfo || "",
        fileAction: question.fileAction || "",
        stationType: question.stationType || (module.id === "est-heli" && /dach|landung|combat/i.test(question.prompt || "") ?"combat" : module.id === "est-heli" ?"route" : ""),
        targetSeconds: Number(question.targetSeconds || 0),
        timeSeconds: Number(question.timeSeconds || 0),
        maxPoints: normalizedQuestionMaxPoints(module, question),
        penaltyPoints: 0,
        questionPenalty: false
      }))
    }));
  };
  return {
    ...defaults,
    ...store,
    estModules: mergeModules(store.estModules, defaults.estModules),
    moduleModules: mergeModules(store.moduleModules, defaults.moduleModules),
    activeExams: store.activeExams || []
  };
}

function saveTrainingStore(store) {
  localStorage.setItem(TRAINING_STORE_KEY, JSON.stringify(store));
}

function activeEstExam() {
  return trainingStore().activeExams.find((exam) => exam.kind === "est" && !["Vorbereitung", "Abgeschlossen", "Archiviert"].includes(exam.status));
}

function activeExamItems(kind) {
  return trainingStore().activeExams
    .filter((exam) => exam.kind === kind && !["Vorbereitung", "Abgeschlossen", "Archiviert"].includes(exam.status))
    .sort((a, b) => new Date(b.createdAt || b.startedAt || 0) - new Date(a.createdAt || a.startedAt || 0));
}

function examElapsedText(exam) {
  if (exam.status === "Pausiert") return "Pausiert";
  if (!exam.startedAt) return "Noch nicht gestartet";
  const pausedMs = Number(exam.pausedTotalMs || 0);
  return formatDuration(Date.now() - new Date(exam.startedAt).getTime() - pausedMs);
}

function saveActiveTrainingExam(exam) {
  const store = trainingStore();
  store.activeExams = [exam, ...store.activeExams.filter((item) => item.id !== exam.id)];
  saveTrainingStore(store);
}

function createTrainingExam(kind, candidateId, secondExaminerId, modules) {
  return {
    id: makeTrainingId("exam"),
    kind,
    candidateId,
    examinerId: state.currentUser?.id,
    secondExaminerId,
    status: "Vorbereitung",
    moduleIndex: 0,
    questionIndex: 0,
    reviewMode: false,
    finalResult: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    modules: modules.map((module) => ({
      id: module.id,
      name: module.name,
      description: module.description,
      questions: module.questions.map((question) => ({ ...question, result: null, traineeAnswer: "", selectedCorrect: [], selectedWrong: [], manualPoints: 0 }))
    }))
  };
}

function examCurrentModule(exam) {
  return exam.modules[exam.moduleIndex] || null;
}

function examCurrentQuestion(exam) {
  return examCurrentModule(exam)?.questions?.[exam.questionIndex] || null;
}

function examUserOptionLabel(user) {
  return `${fullName(user)} - DN ${user.dn || "-"} - ${rankLabel(user.rank)}`;
}

function renderExamUserPicker(id, listId, users, placeholder) {
  return `
    <div class="exam-user-picker" data-exam-picker="${id}">
      <input id="${id}" value="" placeholder="${escapeHtml(placeholder)}" autocomplete="off">
      <input id="${id}Value" type="hidden" value="">
      <div class="exam-user-options" id="${listId}">
        ${users.map((user) => `<button type="button" data-user-id="${escapeHtml(user.id)}" data-label="${escapeHtml(examUserOptionLabel(user))}">${escapeHtml(examUserOptionLabel(user))}</button>`).join("") || `<span class="muted">Keine passenden Mitglieder.</span>`}
      </div>
    </div>
  `;
}

function userIdFromExamInput(inputId, listId) {
  const selectedId = $(`#${inputId}Value`)?.value || "";
  if (selectedId) return selectedId;
  const value = $(`#${inputId}`)?.value.trim() || "";
  if (!value) return "";
  const option = Array.from(document.querySelectorAll(`#${listId} button`)).find((item) => item.dataset.label === value);
  return option?.dataset.userId || "";
}

function setupExamUserPickers(root = document) {
  root.querySelectorAll(".exam-user-picker").forEach((picker) => {
    const input = picker.querySelector("input:not([type='hidden'])");
    const hidden = picker.querySelector("input[type='hidden']");
    const options = picker.querySelector(".exam-user-options");
    const sync = () => {
      const term = input.value.toLowerCase().trim();
      hidden.value = "";
      options.querySelectorAll("button").forEach((button) => {
        button.classList.toggle("hidden", term && !button.dataset.label.toLowerCase().includes(term));
      });
    };
    input.addEventListener("focus", () => picker.classList.add("open"));
    input.addEventListener("click", () => picker.classList.add("open"));
    input.addEventListener("input", sync);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") picker.classList.remove("open");
    });
    options.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
      input.value = button.dataset.label;
      hidden.value = button.dataset.userId;
      picker.classList.remove("open");
    }));
  });
}

function examArchiveItems(kind) {
  return trainingStore().activeExams
    .filter((exam) => exam.kind === kind && ["Archiviert", "Abgeschlossen"].includes(exam.status))
    .sort((a, b) => new Date(b.archivedAt || b.startedAt || 0) - new Date(a.archivedAt || a.startedAt || 0));
}

function renderTrainingExamArchive(kind, department) {
  const rows = examArchiveItems(kind);
  const canManageArchive = departmentActionAllowed(department, "departmentLeadership");
  return `
    <section class="panel training-archive-card">
      <div class="panel-header"><div><h3>${kind === "est" ?"Grundausbildung Archiv" : "Modul Prüfungsarchiv"}</h3><p class="muted">${rows.length} archivierte Prüfungen</p></div><input class="compact-input training-archive-search" placeholder="Archiv durchsuchen"></div>
      <div class="training-archive-list">
        ${rows.length ?rows.map((exam) => renderTrainingExamArchiveRow(exam, canManageArchive)).join("") : `<p class="muted">Noch keine archivierten Prüfungen.</p>`}
      </div>
    </section>
  `;
}

function renderActiveTrainingExams(kind, department) {
  const rows = activeExamItems(kind);
  const canManage = departmentActionAllowed(department, "departmentLeadership");
  return `
    <section class="panel training-active-card">
      <div class="panel-header"><div><h3>Aktive Prüfungen</h3><p class="muted">${rows.length} laufende oder vorbereitete Prüfungen</p></div></div>
      <div class="training-archive-list">
        ${rows.length ?rows.map((exam) => renderActiveTrainingExamRow(exam, canManage)).join("") : `<p class="muted">Keine aktive Prüfung vorhanden.</p>`}
      </div>
    </section>
  `;
}

function renderActiveTrainingExamRow(exam, canManage) {
  const candidate = state.users.find((user) => user.id === exam.candidateId);
  const examiner = state.users.find((user) => user.id === exam.examinerId);
  return `
    <article class="training-archive-row">
      <div>
        <strong>${escapeHtml(candidate ?fullName(candidate) : "Unbekannter Prüfling")}</strong>
        <small>${exam.kind === "est" ?"Grundausbildung" : "Modul Prüfung"} · ${escapeHtml(exam.status)}</small>
      </div>
      <span><b>Prüfer</b>${escapeHtml(examiner ?fullName(examiner) : "-")}</span>
      <span><b>Dauer</b><span class="exam-live-timer" data-started-at="${escapeHtml(exam.startedAt || "")}">${escapeHtml(examElapsedText(exam))}</span></span>
      <div class="button-row">
        <button class="blue-btn training-exam-open" data-exam-id="${escapeHtml(exam.id)}" type="button">Öffnen</button>
        <button class="ghost-btn training-exam-pause" data-exam-id="${escapeHtml(exam.id)}" type="button">Pausieren</button>
        <button class="ghost-btn training-exam-stop" data-exam-id="${escapeHtml(exam.id)}" type="button">Stoppen</button>
        ${canManage ?`<button class="mini-icon danger training-exam-delete" data-exam-id="${escapeHtml(exam.id)}" type="button" title="Löschen">${actionIcon("delete")}</button>` : ""}
      </div>
    </article>
  `;
}

function renderTrainingExamArchiveRow(exam, canManageArchive) {
  const candidate = state.users.find((user) => user.id === exam.candidateId);
  const examiner = state.users.find((user) => user.id === exam.examinerId);
  const secondExaminer = state.users.find((user) => user.id === exam.secondExaminerId);
  const percent = Number(exam.finalResult?.percent || 0);
  const passed = Boolean(exam.finalResult) && percent >= 70;
  const alreadyHasEst = Boolean(candidate?.trainings?.EST);
  const result = exam.finalResult ?`${passed ?"Bestanden" : "Nicht bestanden"} · ${percent}% · ${exam.finalResult.points}/${exam.finalResult.total} Punkte` : "Ohne finale Auswertung";
  return `
    <article class="training-archive-row ${exam.kind === "est" && exam.finalResult ?passed ?"exam-passed" : "exam-failed" : ""}">
      <div>
        <strong>${escapeHtml(candidate ?fullName(candidate) : "Unbekannter Prüfling")}</strong>
        <small>${exam.kind === "est" ?"Grundausbildung" : "Modul Prüfung"} · ${escapeHtml(exam.status)} · ${formatDateTime(exam.archivedAt || exam.startedAt)}</small>
      </div>
      <span><b>Prüfer</b>${escapeHtml(examiner ?fullName(examiner) : "-")}${secondExaminer ?` / ${escapeHtml(fullName(secondExaminer))}` : ""}</span>
      <span><b>Ergebnis</b>${escapeHtml(result)}</span>
      <div class="button-row">
        <button class="blue-btn training-exam-open" data-exam-id="${escapeHtml(exam.id)}" data-readonly="true" type="button">Verlauf öffnen</button>
        ${exam.kind === "est" && passed && candidate && !alreadyHasEst && canManageArchive ?`<button class="green-btn training-est-grant" data-user-id="${escapeHtml(candidate.id)}" type="button">Grundausbildung vergeben</button>` : ""}
        ${exam.kind === "est" && alreadyHasEst ?`<span class="requirement-chip ok">Grundausbildung vergeben</span>` : ""}
        ${canManageArchive ?`<button class="mini-icon danger training-exam-delete" data-exam-id="${escapeHtml(exam.id)}" type="button" title="Archiv löschen">${actionIcon("delete")}</button>` : ""}
      </div>
    </article>
  `;
}

function legacyRenderEstExamPanel(department) {
  const candidates = state.users.filter((user) => !user.trainings?.EST);
  const activeExam = activeEstExam();
  const candidate = activeExam ?state.users.find((user) => user.id === activeExam.candidateId) : null;
  const secondExaminer = activeExam ?state.users.find((user) => user.id === activeExam.secondExaminerId) : null;
  return `
    <div class="training-exam-layout department-overview-content">
      ${renderActiveTrainingExams("est", department)}
      <section class="panel training-exam-card compact-est-panel">
        <div class="panel-header">
          <div><h3>EST Prüfung</h3><p class="muted">Vorlage für EST-Prüfungen mit Prüfer, Modulen, Pause und Auswertung ab 75%.</p></div>
          ${activeExam ?`<span class="requirement-chip ${activeExam.status === "Pausiert" ?"special" : "ok"}">${escapeHtml(activeExam.status)}</span>` : ""}
        </div>
        <div class="exam-start-grid compact-exam-start est-create-row">
          <label>Prüfling ohne EST
            <select id="estCandidateSelect"><option value="">Prüfling auswählen</option>${candidates.map((user) => `<option value="${user.id}">${escapeHtml(fullName(user))} - DN ${escapeHtml(user.dn || "-")}</option>`).join("")}</select>
          </label>
          <label>2. Prüfer optional
            <select id="estSecondExaminer"><option value=""></option>${state.users.map((user) => `<option value="${user.id}">${escapeHtml(fullName(user))}</option>`).join("")}</select>
          </label>
          <button class="blue-btn" id="startEstExam" type="button" ${candidates.length ?"" : "disabled"}>EST Prüfung starten</button>
        </div>
        ${activeExam ?`
          <div class="active-exam-box">
            <div>
              <strong>${escapeHtml(candidate ?fullName(candidate) : "Unbekannter Prüfling")}</strong>
              <small>Prüfer: ${escapeHtml(fullName(state.currentUser))}${secondExaminer ?` · 2. Prüfer: ${escapeHtml(fullName(secondExaminer))}` : ""}</small>
            </div>
            <div class="button-row">
              ${activeExam.status === "Pausiert" ?`<button class="blue-btn" id="continueEstExam" type="button">Fortsetzen</button>` : `<button class="ghost-btn" id="pauseEstExam" type="button">Pausieren</button>`}
            </div>
          </div>
          <div class="exam-module-grid">
            ${estModules().map((module, moduleIndex) => `
              <article class="exam-module-card">
                <span>Modul ${moduleIndex + 1}</span>
                <strong>${escapeHtml(module.name)}</strong>
                <small>${escapeHtml(module.description)}</small>
                <div class="exam-question-list">
                  ${module.questions.map((question, index) => `
                    <label class="exam-question-row">
                      <input type="checkbox">
                      <span><b>Frage ${index + 1}</b>${escapeHtml(question)}<small>Multiple Choice oder Textbewertung wird später aus dem Fragenpool geladen.</small></span>
                    </label>
                  `).join("")}
                </div>
              </article>
            `).join("")}
          </div>
          <div class="exam-result-preview">
            <span><b>Auswertung</b>Ab 75% bestanden</span>
            <span class="result-pass">Bestanden</span>
            <span class="result-fail">Nicht bestanden</span>
          </div>
        ` : `<p class="muted">Wähle einen Prüfling aus, um die EST-Prüfung als laufende Vorlage zu starten.</p>`}
      </section>
    </div>
  `;
}

function legacyRenderModuleExamPanel(department) {
  const moduleOptions = visibleTrainings().filter((training) => training !== "EST");
  return `
    <div class="training-exam-layout department-overview-content">
      <section class="panel training-exam-card">
        <div class="panel-header"><div><h3>Ausbildungen</h3><p class="muted">Vorlage für spätere Modulprüfungen aus offenen Ausbildungen.</p></div></div>
        <div class="exam-start-grid">
          <label>Mitglied
            <select>${state.users.map((user) => `<option>${escapeHtml(fullName(user))} - DN ${escapeHtml(user.dn || "-")}</option>`).join("")}</select>
          </label>
          <label>Module auswählen
            <select multiple>${moduleOptions.map((training) => `<option>${escapeHtml(training)}</option>`).join("")}</select>
          </label>
          <button class="blue-btn" type="button">Modulprüfung vorbereiten</button>
        </div>
        <div class="exam-module-grid">
          ${moduleOptions.slice(0, 6).map((training) => `
            <article class="exam-module-card">
              <span>Modul</span>
              <strong>${escapeHtml(training)}</strong>
              <small>Fragen, Punkte und Antworten werden später über die Modul Verwaltung gepflegt.</small>
            </article>
          `).join("")}
        </div>
      </section>
    </div>
  `;
}

function legacyRenderTrainingManagementPanels() {
  return `
    <section class="training-management-grid">
      <article class="panel training-manage-card">
        <div class="panel-header"><div><h3>EST Verwaltung</h3><p class="muted">Fragenpool für Rechtskunde, Dienstvorschriften und Ortskunde.</p></div><button class="blue-btn" type="button">Frage hinzufügen</button></div>
        <div class="exam-module-grid">
          ${estModules().map((module) => `
            <div class="exam-module-card">
              <strong>${escapeHtml(module.name)}</strong>
              <small>Multiple Choice oder Textfrage · Punktevergabe · richtige und falsche Antworten</small>
              <label>Beispielfrage<input placeholder="Frage eingeben"></label>
              <label>Antworten<textarea placeholder="Richtige und falsche Antworten hinterlegen"></textarea></label>
            </div>
          `).join("")}
        </div>
      </article>
      <article class="panel training-manage-card">
        <div class="panel-header"><div><h3>Modul Verwaltung</h3><p class="muted">Eigene Module für weitere Ausbildungen anlegen und vorbereiten.</p></div><button class="blue-btn" type="button">Modul erstellen</button></div>
        <div class="module-template-list">
          ${visibleTrainings().filter((training) => training !== "EST").slice(0, 9).map((training) => `<span>${escapeHtml(trainingDisplayName(training))}<small>Fragenpool vorbereiten</small></span>`).join("")}
        </div>
      </article>
    </section>
  `;
}

function legacyActiveRenderEstExamPanel(department) {
  const store = trainingStore();
  const candidates = state.users.filter((user) => !user.trainings?.EST);
  const activeExam = activeEstExam();
  const candidate = activeExam ?state.users.find((user) => user.id === activeExam.candidateId) : null;
  const secondExaminer = activeExam ?state.users.find((user) => user.id === activeExam.secondExaminerId) : null;
  return `
    <div class="training-exam-layout department-overview-content">
      <section class="panel training-exam-card">
        <div class="panel-header">
          <div><h3>EST Prüfung</h3><p class="muted">Prüfung erstellen und danach in einem eigenen Fenster durchführen.</p></div>
          ${activeExam ?`<span class="requirement-chip ${activeExam.status === "Pausiert" ?"special" : "ok"}">${escapeHtml(activeExam.status)}</span>` : ""}
        </div>
        <div class="exam-start-grid">
          <label>Prüfling ohne EST
            <select id="estCandidateSelect">${candidates.map((user) => `<option value="${user.id}">${escapeHtml(fullName(user))} - DN ${escapeHtml(user.dn || "-")}</option>`).join("")}</select>
          </label>
          <button class="blue-btn" id="startEstExam" type="button" ${candidates.length ?"" : "disabled"}>EST Prüfung erstellen</button>
        </div>
        ${activeExam ?`
          <div class="active-exam-box">
            <div>
              <strong>${escapeHtml(candidate ?fullName(candidate) : "Unbekannter Prüfling")}</strong>
              <small>Aktive EST-Prüfung · Prüfer: ${escapeHtml(fullName(state.currentUser))}${secondExaminer ?` · 2. Prüfer: ${escapeHtml(fullName(secondExaminer))}` : ""}</small>
            </div>
            <button class="blue-btn" id="continueEstExam" data-exam-id="${escapeHtml(activeExam.id)}" type="button">Prüfungsfenster öffnen</button>
          </div>
        ` : `<p class="muted">Wähle einen Prüfling aus. Die Durchführung öffnet sich danach als eigenes Fenster.</p>`}
        <div class="est-module-strip">
          ${store.estModules.map((module, moduleIndex) => `
            <article class="est-module-chip">
              <span>Modul ${moduleIndex + 1}</span>
              <strong>${escapeHtml(module.name)}</strong>
            </article>
          `).join("")}
        </div>
      </section>
    </div>
  `;
}

function legacyActiveRenderModuleExamPanel(department) {
  const store = trainingStore();
  return `
    <div class="training-exam-layout department-overview-content">
      <section class="panel training-exam-card">
        <div class="panel-header"><div><h3>Ausbildungen</h3><p class="muted">Modulprüfung erstellen und in einem eigenen Fenster durchführen.</p></div></div>
        <div class="exam-start-grid">
          <label>Mitglied
            <select id="moduleCandidateSelect"><option value="">Mitglied auswählen</option>${state.users.map((user) => `<option value="${user.id}">${escapeHtml(fullName(user))} - DN ${escapeHtml(user.dn || "-")}</option>`).join("")}</select>
          </label>
          <label>2. Prüfer optional
            <select id="moduleSecondExaminer"><option value=""></option>${state.users.map((user) => `<option value="${user.id}">${escapeHtml(fullName(user))}</option>`).join("")}</select>
          </label>
          <label>Module auswählen
            <select id="moduleExamSelect" multiple>${store.moduleModules.map((module) => `<option value="${module.id}">${escapeHtml(module.name)}</option>`).join("")}</select>
          </label>
          <button class="blue-btn" id="startModuleExam" type="button">Modulprüfung erstellen</button>
        </div>
        <div class="exam-module-grid">
          ${store.moduleModules.map((module) => `
              <article class="exam-module-card">
                <span>Modul</span>
                <strong>${escapeHtml(module.name)}</strong>
                <small>${escapeHtml(module.description || "Prüfungsmodul")}</small>
              </article>
          `).join("")}
        </div>
      </section>
    </div>
  `;
}

function legacyLargeRenderEstExamPanel(department) {
  const store = trainingStore();
  const candidates = state.users.filter((user) => !user.trainings?.EST);
  const activeExam = activeEstExam();
  const candidate = activeExam ?state.users.find((user) => user.id === activeExam.candidateId) : null;
  const secondExaminer = activeExam ?state.users.find((user) => user.id === activeExam.secondExaminerId) : null;
  return `
    <div class="training-exam-layout department-overview-content">
      <section class="panel training-exam-card">
        <div class="panel-header">
          <div><h3>EST Prüfung</h3><p class="muted">Prüfung erstellen und danach in einem eigenen Fenster durchführen.</p></div>
          ${activeExam ?`<span class="requirement-chip ${activeExam.status === "Pausiert" ?"special" : "ok"}">${escapeHtml(activeExam.status)}</span>` : ""}
        </div>
        <div class="exam-start-grid">
          <label>Prüfling ohne EST
            ${renderExamUserPicker("estCandidateInput", "estCandidateList", candidates, "Prüfling auswählen")}
          </label>
          <label>2. Prüfer optional
            <select id="estSecondExaminer"><option value=""></option>${state.users.map((user) => `<option value="${user.id}">${escapeHtml(fullName(user))}</option>`).join("")}</select>
          </label>
          <button class="blue-btn" id="startEstExam" type="button" ${candidates.length ?"" : "disabled"}>EST Prüfung erstellen</button>
        </div>
        ${activeExam ?`
          <div class="active-exam-box">
            <div>
              <strong>${escapeHtml(candidate ?fullName(candidate) : "Unbekannter Prüfling")}</strong>
              <small>Aktive EST-Prüfung · Prüfer: ${escapeHtml(fullName(state.currentUser))}${secondExaminer ?` · 2. Prüfer: ${escapeHtml(fullName(secondExaminer))}` : ""}</small>
            </div>
            <span class="button-row"><button class="blue-btn" id="continueEstExam" data-exam-id="${escapeHtml(activeExam.id)}" type="button">Prüfungsfenster öffnen</button><button class="ghost-btn training-exam-archive" data-exam-id="${escapeHtml(activeExam.id)}" type="button">Archivieren</button></span>
          </div>
        ` : `<p class="muted">Wähle einen Prüfling aus. Die Durchführung öffnet sich danach als eigenes Fenster.</p>`}
        <div class="exam-module-grid">
          ${store.estModules.map((module, moduleIndex) => `
            <article class="exam-module-card">
              <span>Modul ${moduleIndex + 1}</span>
              <strong>${escapeHtml(module.name)}</strong>
              <small>${escapeHtml(module.description || "Prüfungsmodul")}</small>
            </article>
          `).join("")}
        </div>
      </section>
      ${renderTrainingExamArchive("est", department)}
    </div>
  `;
}

function renderEstExamPanel(department) {
  const store = trainingStore();
  const candidates = state.users.filter((user) => !user.trainings?.EST);
  const activeExam = activeEstExam();
  const candidate = activeExam ?state.users.find((user) => user.id === activeExam.candidateId) : null;
  const secondExaminer = activeExam ?state.users.find((user) => user.id === activeExam.secondExaminerId) : null;
  return `
    <div class="training-exam-layout department-overview-content">
      ${renderActiveTrainingExams("est", department)}
      <section class="panel training-exam-card compact-est-panel">
        <div class="panel-header">
          <div><h3>EST Prüfung</h3><p class="muted">Prüfling auswählen und Prüfung vorbereiten.</p></div>
          ${activeExam ?`<span class="requirement-chip ${activeExam.status === "Pausiert" ?"special" : "ok"}">${escapeHtml(activeExam.status)}</span>` : ""}
        </div>
        <div class="exam-start-grid compact-exam-start est-create-row">
          <label>Prüfling ohne EST
            ${renderExamUserPicker("estCandidateInput", "estCandidateList", candidates, "Prüfling auswählen")}
          </label>
          <button class="blue-btn" id="startEstExam" type="button" ${candidates.length ?"" : "disabled"}>EST Prüfung erstellen</button>
        </div>
        ${activeExam ?`
          <div class="active-exam-box compact-active-exam">
            <div>
              <strong>${escapeHtml(candidate ?fullName(candidate) : "Unbekannter Prüfling")}</strong>
              <small>Aktive EST-Prüfung · Prüfer: ${escapeHtml(fullName(state.currentUser))}${secondExaminer ?` · 2. Prüfer: ${escapeHtml(fullName(secondExaminer))}` : ""}</small>
            </div>
            <span class="button-row"><button class="blue-btn" id="continueEstExam" data-exam-id="${escapeHtml(activeExam.id)}" type="button">Prüfungsfenster öffnen</button><button class="ghost-btn training-exam-archive" data-exam-id="${escapeHtml(activeExam.id)}" type="button">Archivieren</button></span>
          </div>
        ` : `<p class="muted">Wähle einen Prüfling aus. Die Durchführung öffnet sich danach als eigenes Fenster.</p>`}
        <div class="est-module-strip">
          ${store.estModules.map((module, moduleIndex) => `
            <article class="est-module-chip">
              <span>Modul ${moduleIndex + 1}</span>
              <strong>${escapeHtml(module.name)}</strong>
            </article>
          `).join("")}
        </div>
      </section>
      ${renderTrainingExamArchive("est", department)}
    </div>
  `;
}

function renderModuleExamPanel(department) {
  const store = trainingStore();
  return `
    <div class="training-exam-layout department-overview-content">
      ${renderActiveTrainingExams("module", department)}
      <section class="panel training-exam-card">
        <div class="panel-header"><div><h3>Ausbildungen</h3><p class="muted">Mitglied und Modul auswählen, danach Prüfung öffnen und starten.</p></div></div>
        <div class="module-start-card">
          <label>Mitglied
            ${renderExamUserPicker("moduleCandidateInput", "moduleCandidateList", state.users, "Mitglied auswählen")}
          </label>
          <label>Module auswählen
            <select id="moduleExamSelect">${store.moduleModules.map((module) => `<option value="${module.id}">${escapeHtml(module.name)}</option>`).join("")}</select>
          </label>
          <button class="blue-btn" id="startModuleExam" type="button">Modulprüfung erstellen</button>
        </div>
      </section>
      ${renderTrainingExamArchive("module", department)}
    </div>
  `;
}

function renderSwatOverviewPanels(department, canMembers, canNotes) {
  const visibleNotes = (department.notes || []).filter((note) => canViewSwatTeam(note.team || "all", department));
  const myMembership = mySwatMembership(department);
  const canManageAllTeams = hasRole("Direktion") || hasRole("IT");
  const canManageTeam = (team) => canManageAllTeams || (isSwatTeamLeaderMember(myMembership) && normalizeSwatTeam(myMembership.swatTeam) === team);
  return `
    <div class="swat-overview">
      <div class="panel swat-teams-panel">
        <div class="panel-header">
          <h3><span class="section-icon">${iconSvg("Mitglieder")}</span>SWAT Teams</h3>
          <div class="button-row">
            ${departmentActionAllowed(department, "departmentLeadership") ?`<button class="orange-btn" id="swatCallBtn" type="button">${iconSvg("Einsatzzentrale")} SWAT ausrufen</button>` : ""}
            ${canMembers ?`<button class="blue-btn department-manage" data-department-id="${escapeHtml(department.id)}">${iconSvg("Mitglieder")} Personal verwalten</button>` : ""}
          </div>
        </div>
        <div class="swat-team-grid">
          ${SWAT_TEAMS.map((team) => {
            const status = department.swatStatus?.[team] || {};
            const members = (department.members || [])
              .filter((member) => normalizeSwatTeam(member.swatTeam) === team)
              .sort((a, b) => Number(isSwatTeamLeaderMember(b)) - Number(isSwatTeamLeaderMember(a)) || Number(b.user?.rank || 0) - Number(a.user?.rank || 0) || fullName(a.user).localeCompare(fullName(b.user), "de"));
            return `
              <article class="swat-team-card ${status.active ?"active" : ""}">
                <div class="swat-team-head">
                  <strong>Team ${team} <span class="swat-team-count">${members.length}</span></strong>
                  <div class="swat-team-badges">
                    <span class="swat-team-count-label">${members.length} Mitglied${members.length === 1 ?"" : "er"}</span>
                    <span class="swat-status ${status.active ?"active" : ""}">${status.active ?"Aktiv" : "Inaktiv"}</span>
                  </div>
                </div>
                ${status.active ?`<small class="muted">Ausgerufen von ${escapeHtml(status.calledByName || "-")} · ${formatDateTime(status.calledAt)}</small>` : `<small class="muted">Nicht ausgerufen</small>`}
                ${status.active && canManageTeam(team) ?`<button class="red-btn compact-action swat-team-deactivate" type="button" data-team="${team}">Team ${team} inaktiv setzen</button>` : ""}
                <div class="swat-member-list">
                  ${members.length ?members.map((member) => {
                    const isTeamLeader = isSwatTeamLeaderMember(member);
                    const positionText = isTeamLeader ?"Abteilungsleiter" : member.position || "Mitglied";
                    return `
                    <div class="swat-member-row ${isTeamLeader ?"leader" : ""}">
                      <span>${avatarMarkup(member.user, "sm")}<b>${escapeHtml(fullName(member.user))}</b></span>
                      <small>
                        <span class="swat-duty-state ${member.isOnDuty ?"online" : "offline"}"><i class="online-dot ${member.isOnDuty ?"online" : ""}"></i>${member.isOnDuty ?"Online" : "Offline"}</span>
                        ${escapeHtml(positionText)} · ${escapeHtml(rankLabel(member.user.rank))}
                      </small>
                    </div>
                  `; }).join("") : `<p class="muted">Noch keine Mitglieder.</p>`}
                </div>
                ${canManageTeam(team) ?`<button class="ghost-btn compact-action swat-team-add" type="button" data-team="${team}">${canManageAllTeams ?"Personal verwalten" : "Mein Team verwalten"}</button>` : ""}
              </article>
            `;
          }).join("")}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <h3><span class="section-icon">${iconSvg("Einsatzzentrale")}</span>Team-Notizen</h3>
          ${canNotes ?`<button class="blue-btn dept-note-add" data-department-id="${escapeHtml(department.id)}">+ Neue Notiz</button>` : ""}
        </div>
        <div class="note-list">
          ${visibleNotes.length ?visibleNotes.map((note) => renderDepartmentNote(department, note)).join("") : `<p class="muted">Keine Notizen für dein Team vorhanden.</p>`}
        </div>
      </div>
    </div>
  `;
}

function renderHiddenTrainingPanel(department) {
  const active = localStorage.getItem(`lspd_training_hidden_tab_${department.id}`) || "est";
  const current = ["est", "modules"].includes(active) ?active : "est";
  return `
    <div class="panel department-overview-content hidden-training-shell">
      <div class="panel-header">
        <div><h3>Ausgeblendete Academy-Bereiche</h3><p class="muted">Nur IT sieht diese internen Prüfungsbereiche.</p></div>
      </div>
      <div class="tabs-row sub-tabs">
        <button class="${current === "est" ?"tab-active" : ""}" data-training-hidden-tab="est">Grundausbildung</button>
        <button class="${current === "modules" ?"tab-active" : ""}" data-training-hidden-tab="modules">Ausbildungen</button>
      </div>
      ${current === "est" ?renderEstExamPanel(department) : renderModuleExamPanel(department)}
    </div>
  `;
}

function renderTrainingManagementPanels(options = {}) {
  const store = trainingStore();
  const itMode = options.mode === "it";
  const settings = trainingModuleSettings();
  const allTrainingRows = orderedTrainings({ includeHidden: true });
  return `
    <section class="training-management-grid">
      ${itMode ?renderOnboardingTutorialAdminPanel() : ""}
      ${itMode ?`<article class="panel training-manage-card">
        <div class="panel-header"><div><h3>Grundausbildung Verwaltung</h3><p class="muted">Fragenpool für Rechtskunde, Dienstvorschriften, Ortskunde, Helistrecke, Fahrstrecke und Szenario.</p></div></div>
        <div class="exam-module-grid">
          ${store.estModules.map((module) => renderTrainingModuleAdmin("est", module, false)).join("")}
        </div>
      </article>
      <article class="panel training-manage-card">
        <div class="panel-header"><div><h3>Modul Verwaltung</h3><p class="muted">Eigene Module für weitere Ausbildungen anlegen und vorbereiten.</p></div><button class="blue-btn training-module-add" type="button">Modul erstellen</button></div>
        <div class="exam-module-grid">
          ${store.moduleModules.map((module) => renderTrainingModuleAdmin("module", module, true)).join("")}
        </div>
      </article>` : ""}
      <article class="panel training-manage-card">
        <div class="panel-header"><div><h3>Haken Verwaltung</h3><p class="muted">Alle vergebbaren Haken umbenennen oder ausblenden. Bestehende Vergaben bleiben erhalten.</p></div></div>
        <div class="training-check-admin-list">
          ${allTrainingRows.map((training, index) => {
            const hidden = settings.hidden.has(training);
            const category = settings.categories[training] || defaultTrainingCategory(training);
            const requirement = trainingRequirementText(training);
            return `
              <div class="training-question-admin-row ${hidden ?"is-muted" : ""}">
                <span><b>${escapeHtml(trainingDisplayName(training))}</b><small>Kategorie: ${escapeHtml(category)} · Details: ${escapeHtml(trainingDetailText(training))}${requirement ?` · Voraussetzung für Rang: ${escapeHtml(requirement)}` : ""}${hidden ?" · ausgeblendet" : ""}</small></span>
                <span class="button-row">
                  <button class="mini-icon training-check-move" data-training="${escapeHtml(training)}" data-direction="-1" type="button" title="Nach oben" ${index === 0 ?"disabled" : ""}>${iconSvg("ChevronUp")}</button>
                  <button class="mini-icon training-check-move" data-training="${escapeHtml(training)}" data-direction="1" type="button" title="Nach unten" ${index === allTrainingRows.length - 1 ?"disabled" : ""}>${iconSvg("ChevronDown")}</button>
                </span>
                <button class="mini-icon training-check-edit" data-training="${escapeHtml(training)}" type="button" title="Haken umbenennen">${actionIcon("edit")}</button>
                <button class="ghost-btn compact-action training-check-visibility" data-training="${escapeHtml(training)}" type="button">${hidden ?"Einblenden" : "Ausblenden"}</button>
                <button class="mini-icon danger training-check-delete" data-training="${escapeHtml(training)}" type="button" title="Haken löschen">${actionIcon("delete")}</button>
              </div>
            `;
          }).join("")}
        </div>
      </article>
    </section>
  `;
}

function renderOnboardingTutorialAdminPanel() {
  const steps = onboardingTutorialSteps();
  const renderPreview = (step, index) => {
    const images = tutorialImageUrls(step);
    return images.length ?`
      <div class="tutorial-admin-image-list">
        ${images.map((url) => `<img src="${escapeHtml(url)}" alt="${escapeHtml(step.title)}">`).join("")}
      </div>
    ` : tutorialDefaultIllustration(step, index);
  };
  return `
    <article class="panel training-manage-card tutorial-admin-card">
      <div class="panel-header">
        <div><h3>Dienstblatt Tutorial</h3><p class="muted">Pflicht-Einweisung nach dem ersten Passwortwechsel. Texte und Bilder können hier angepasst werden.</p></div>
        <button class="blue-btn" id="saveOnboardingTutorial" type="button">Tutorial speichern</button>
      </div>
      <div class="tutorial-admin-list">
        ${steps.map((step, index) => `
          <div class="tutorial-admin-row" data-tutorial-step="${escapeHtml(step.id)}">
            <div class="tutorial-admin-number">${index + 1}</div>
            <div class="tutorial-admin-fields">
              <label>Titel<input data-tutorial-title value="${escapeHtml(step.title)}"></label>
              <label>Text<textarea data-tutorial-text rows="4">${escapeHtml(step.text)}</textarea></label>
              <label>Bilder URLs<textarea data-tutorial-images rows="3" placeholder="Optional: ein Bild-Link pro Zeile">${escapeHtml(tutorialImageUrls(step).join("\n"))}</textarea></label>
              <div class="button-row">
                <label class="ghost-btn tutorial-upload-btn">Bilder hochladen<input data-tutorial-upload type="file" accept="image/*" multiple></label>
                ${tutorialImageUrls(step).length ?`<button class="ghost-btn tutorial-clear-image" type="button">Bilder entfernen</button>` : ""}
              </div>
            </div>
            <div class="tutorial-admin-preview">
              ${renderPreview(step, index)}
            </div>
          </div>
        `).join("")}
      </div>
      <p id="tutorialSaveMessage" class="muted"></p>
    </article>
  `;
}

function renderTrainingModuleAdmin(bank, module, editableModule) {
  return `
    <article class="exam-module-card training-admin-module">
      <div class="training-module-head">
        <div><span>${bank === "est" ?"Grundausbildung Modul" : "Modul"}</span><strong>${escapeHtml(module.name)}</strong><small>${escapeHtml(module.description || "")}</small></div>
        <div class="button-row">
          <button class="mini-icon training-module-edit" data-bank="${bank}" data-module-id="${escapeHtml(module.id)}" type="button" title="Modul bearbeiten">${actionIcon("edit")}</button><button class="mini-icon danger training-module-delete" data-bank="${bank}" data-module-id="${escapeHtml(module.id)}" type="button" title="Modul löschen">${actionIcon("delete")}</button>
          <button class="blue-btn training-question-add" data-bank="${bank}" data-module-id="${escapeHtml(module.id)}" type="button">Frage hinzufügen</button>
        </div>
      </div>
      <div class="training-question-admin-list">
        ${module.questions.length ?module.questions.map((question) => `
          <div class="training-question-admin-row">
            <span><b>${escapeHtml(question.prompt)}</b><small>${question.type === "location" ?question.stationType === "combat" ?"Combat-Landung / Ort" : module.id === "est-location" ?"Ort" : "Strecke" : question.type === "scenario" ?"Szenario" : "Musterlösung"} · max. ${escapeHtml(question.maxPoints)} Punkt</small></span>
            <button class="mini-icon training-question-edit" data-bank="${bank}" data-module-id="${escapeHtml(module.id)}" data-question-id="${escapeHtml(question.id)}" type="button">${actionIcon("edit")}</button>
            <button class="mini-icon danger training-question-delete" data-bank="${bank}" data-module-id="${escapeHtml(module.id)}" data-question-id="${escapeHtml(question.id)}" type="button">${actionIcon("delete")}</button>
          </div>
        `).join("") : `<p class="muted">Noch keine Fragen.</p>`}
      </div>
    </article>
  `;
}

function setupTrainingManagementActions(department = null) {
  $("#saveOnboardingTutorial")?.addEventListener("click", saveOnboardingTutorial);
  document.querySelectorAll("[data-tutorial-upload]").forEach((input) => input.addEventListener("change", uploadTutorialImage));
  document.querySelectorAll(".tutorial-clear-image").forEach((button) => button.addEventListener("click", () => {
    const row = button.closest("[data-tutorial-step]");
    const input = row?.querySelector("[data-tutorial-images]");
    if (input) input.value = "";
    const preview = row?.querySelector(".tutorial-admin-preview");
    const step = collectOnboardingTutorialSteps().find((item) => item.id === row?.dataset.tutorialStep);
    if (preview && step) preview.innerHTML = tutorialDefaultIllustration(step, DEFAULT_ONBOARDING_TUTORIAL.findIndex((item) => item.id === step.id));
    button.remove();
  }));
  document.querySelectorAll(".training-question-add").forEach((button) => button.addEventListener("click", () => openTrainingQuestionModal(button.dataset.bank, button.dataset.moduleId)));
  document.querySelectorAll(".training-question-edit").forEach((button) => button.addEventListener("click", () => openTrainingQuestionModal(button.dataset.bank, button.dataset.moduleId, button.dataset.questionId)));
  document.querySelectorAll(".training-question-delete").forEach((button) => button.addEventListener("click", () => openDeleteTrainingQuestionModal(button.dataset.bank, button.dataset.moduleId, button.dataset.questionId, department)));
  document.querySelectorAll(".training-module-add").forEach((button) => button.addEventListener("click", () => openTrainingModuleModal(null, "module")));
  document.querySelectorAll(".training-module-edit").forEach((button) => button.addEventListener("click", () => openTrainingModuleModal(button.dataset.moduleId, button.dataset.bank || "module")));
  document.querySelectorAll(".training-module-delete").forEach((button) => button.addEventListener("click", () => openDeleteTrainingModuleModal(button.dataset.bank || "module", button.dataset.moduleId, department)));
  document.querySelectorAll(".training-check-edit").forEach((button) => button.addEventListener("click", () => openTrainingCheckModal(button.dataset.training)));
  document.querySelectorAll(".training-check-visibility").forEach((button) => button.addEventListener("click", () => toggleTrainingCheckVisibility(button.dataset.training, department)));
  document.querySelectorAll(".training-check-move").forEach((button) => button.addEventListener("click", () => moveTrainingCheck(button.dataset.training, Number(button.dataset.direction || 0), department)));
  document.querySelectorAll(".training-check-delete").forEach((button) => button.addEventListener("click", () => openDeleteTrainingCheckModal(button.dataset.training, department)));
}

function collectOnboardingTutorialSteps() {
  return Array.from(document.querySelectorAll("[data-tutorial-step]")).map((row) => {
    const fallback = DEFAULT_ONBOARDING_TUTORIAL.find((item) => item.id === row.dataset.tutorialStep) || {};
    return {
      id: row.dataset.tutorialStep,
      title: row.querySelector("[data-tutorial-title]")?.value.trim() || fallback.title || "",
      text: row.querySelector("[data-tutorial-text]")?.value.trim() || fallback.text || "",
      page: fallback.page || "",
      imageUrls: Array.from(new Set((row.querySelector("[data-tutorial-images]")?.value || "").split(/\n+/).map((url) => url.trim()).filter(Boolean))),
      imageUrl: ""
    };
  });
}

async function uploadTutorialImage(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  if (files.some((file) => !file.type.startsWith("image/"))) return showNotify("Bitte nur Bilder auswählen.", "error");
  if (files.some((file) => file.size > 2_500_000)) return showNotify("Tutorial-Bilder dürfen jeweils maximal 2,5 MB groß sein.", "error");
  const row = event.target.closest("[data-tutorial-step]");
  const readFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  try {
    const dataUrls = await Promise.all(files.map(readFile));
    const input = row?.querySelector("[data-tutorial-images]");
    const current = (input?.value || "").split(/\n+/).map((url) => url.trim()).filter(Boolean);
    const next = Array.from(new Set([...current, ...dataUrls]));
    if (input) input.value = next.join("\n");
    const title = row?.querySelector("[data-tutorial-title]")?.value || "Tutorial Bild";
    const preview = row?.querySelector(".tutorial-admin-preview");
    if (preview) preview.innerHTML = `<div class="tutorial-admin-image-list">${next.map((url) => `<img src="${escapeHtml(url)}" alt="${escapeHtml(title)}">`).join("")}</div>`;
  } catch {
    showNotify("Bild konnte nicht gelesen werden.", "error");
  } finally {
    event.target.value = "";
  }
}

async function saveOnboardingTutorial() {
  const message = $("#tutorialSaveMessage");
  if (message) message.textContent = "Speichert...";
  try {
    const data = await api("/api/settings/onboarding-tutorial", { method: "PATCH", body: JSON.stringify({ steps: collectOnboardingTutorialSteps() }) });
    state.settings = data.settings || state.settings;
    if (message) message.textContent = "Tutorial gespeichert.";
    showNotify("Tutorial gespeichert.", "success");
    renderIT();
  } catch (error) {
    if (message) message.textContent = error.message;
    showNotify(error.message, "error");
  }
}

function findTrainingModule(store, bank, moduleId) {
  const list = bank === "est" ?store.estModules : store.moduleModules;
  return list.find((module) => module.id === moduleId);
}

function openTrainingQuestionModal(bank, moduleId, questionId = null) {
  const store = trainingStore();
  const module = findTrainingModule(store, bank, moduleId);
  const question = module?.questions.find((item) => item.id === questionId);
  if (!module) return;
  const moduleName = cleanText(module.name || "");
  const isOrtskunde = /ortskunde/i.test(moduleName) || module.id === "est-location";
  const isFahrstrecke = /fahrstrecke/i.test(moduleName) || module.id === "est-drive";
  const isHelistrecke = /helistrecke/i.test(moduleName) || module.id === "est-heli";
  const imageEnabled = isOrtskunde || isFahrstrecke || isHelistrecke || question?.type === "location";
  const scenarioEnabled = /szenario/i.test(moduleName) || question?.type === "scenario";
  const defaultType = imageEnabled ?"location" : scenarioEnabled ?"scenario" : "manual";
  const isTimedRoute = isFahrstrecke || isHelistrecke;
  const stationType = question?.stationType || (isHelistrecke && /dach|landung|combat/i.test(question?.prompt || "") ?"combat" : "route");
  const typeLabel = isOrtskunde ?"Ortskunde · Ort mit Bild · max. 1 Punkt" : isFahrstrecke ?"Fahrstrecke · Strecke mit Sollzeit" : isHelistrecke ?"Helistrecke · Route oder Combat-Landung" : scenarioEnabled ?"Szenario" : "Frage mit Musterlösung";
  const promptLabel = isOrtskunde ?"Ort" : isFahrstrecke ?"Strecke" : isHelistrecke ?"Strecke / Combat-Landung" : "Frage";
  const maxPointsValue = isOrtskunde ?1 : Math.min(10, Number(question?.maxPoints || (isTimedRoute || scenarioEnabled ?10 : 3)));
  openModal(`
    <h3>${question ?"Frage bearbeiten" : "Frage erstellen"}</h3>
    <p class="muted">${escapeHtml(module.name)}</p>
    <form id="trainingQuestionForm" class="form-grid training-question-form">
      <label class="full">${escapeHtml(promptLabel)}<textarea name="prompt" required>${escapeHtml(question?.prompt || "")}</textarea></label>
      <input type="hidden" name="type" id="trainingQuestionType" value="${escapeHtml(defaultType)}">
      <div class="question-type-display"><span>Fragentyp</span><strong>${escapeHtml(typeLabel)}</strong></div>
      ${isOrtskunde ?`<input type="hidden" name="maxPoints" value="1">` : `<label>Max. Punkte<input name="maxPoints" type="number" min="0.5" max="10" step="0.5" value="${escapeHtml(maxPointsValue)}"></label>`}
      ${isHelistrecke ?`<label>Heli-Eintrag<select name="stationType"><option value="route" ${stationType === "route" ?"selected" : ""}>Strecke</option><option value="combat" ${stationType === "combat" ?"selected" : ""}>Combat-Landung / Ort</option></select></label>` : `<input type="hidden" name="stationType" value="">`}
      ${!imageEnabled ?`<label class="full manual-question-fields scenario-question-fields">Musterlösung / Prüferinfo<textarea name="solution" placeholder="Wird dem Prüfer während der Prüfung angezeigt.">${escapeHtml(question?.solution || "")}</textarea></label>` : `<input type="hidden" name="solution" value="${escapeHtml(question?.solution || "")}">`}
      <textarea name="answers" class="hidden">${escapeHtml((question?.answers || question?.correctAnswers || []).join("\n"))}</textarea>
      ${scenarioEnabled ?`<label class="full scenario-question-fields scenario-big-field">Szenario Ablauf / Prüferinfos<textarea name="scenarioInfo" placeholder="Beschreibe das Szenario ausführlich: Lage, Ablauf, erwartetes Verhalten, Hinweise für Prüfer...">${escapeHtml(question?.scenarioInfo || "")}</textarea></label><label class="full scenario-question-fields">Akte / Maßnahme<textarea name="fileAction" placeholder="Welche Akte, Maßnahme oder Sanktion soll vergeben werden?">${escapeHtml(question?.fileAction || "")}</textarea></label>` : `<textarea name="scenarioInfo" class="hidden">${escapeHtml(question?.scenarioInfo || "")}</textarea><textarea name="fileAction" class="hidden">${escapeHtml(question?.fileAction || "")}</textarea>`}
      ${isTimedRoute ?`<label class="image-question-fields">Sollzeit<input name="targetSeconds" value="${escapeHtml(formatSecondsInput(question?.targetSeconds || 0))}" placeholder="MM:SS oder Sekunden"></label>` : `<input type="hidden" name="targetSeconds" value="">`}
      ${imageEnabled ?`<div class="full image-upload-card">
        <label class="image-upload-drop" id="trainingQuestionImageDrop" title="Bild hochladen">
          <input id="trainingQuestionImage" type="file" accept="image/*">
          <span class="upload-icon">${iconSvg("Plus")}</span>
          <strong>Bild hochladen</strong>
          <small>Drag & Drop oder klicken</small>
        </label>
        <input name="image" type="hidden" value="${escapeHtml(question?.image || "")}">
        <div class="question-image-preview">${question?.image ?`<img src="${escapeHtml(question.image)}" alt="">` : `<span class="muted">Noch kein Bild hinterlegt.</span>`}</div>
      </div>` : `<input name="image" type="hidden" value="${escapeHtml(question?.image || "")}">`}
      <p id="modalError" class="form-error full"></p>
      <div class="modal-actions full">
        <button class="ghost-btn" type="button" data-close>Abbrechen</button>
        <button class="blue-btn" type="submit">Speichern</button>
      </div>
    </form>
  `, (modal) => {
    const handleQuestionImageFile = async (file) => {
      if (!file) return;
      const dataUrl = await readImageFileAsDataUrl(file);
      modal.querySelector("[name='image']").value = dataUrl;
      modal.querySelector(".question-image-preview").innerHTML = `<img src="${escapeHtml(dataUrl)}" alt="">`;
    };
    modal.querySelector("#trainingQuestionImage")?.addEventListener("change", async (event) => {
      await handleQuestionImageFile(event.target.files?.[0]);
    });
    const imageDrop = modal.querySelector("#trainingQuestionImageDrop");
    imageDrop?.addEventListener("dragover", (event) => {
      event.preventDefault();
      imageDrop.classList.add("drag-over");
    });
    imageDrop?.addEventListener("dragleave", () => imageDrop.classList.remove("drag-over"));
    imageDrop?.addEventListener("drop", async (event) => {
      event.preventDefault();
      imageDrop.classList.remove("drag-over");
      await handleQuestionImageFile(event.dataTransfer?.files?.[0]);
    });
    modal.querySelector("#trainingQuestionForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const type = form.get("type");
      const nextQuestion = {
        id: question?.id || makeTrainingId("question"),
        prompt: String(form.get("prompt") || "").trim(),
        type,
        solution: String(form.get("solution") || "").trim(),
        answers: String(form.get("answers") || "").split("\n").map((item) => item.trim()).filter(Boolean),
        correctAnswers: [],
        wrongAnswers: [],
        image: String(form.get("image") || "").trim(),
        scenarioInfo: String(form.get("scenarioInfo") || "").trim(),
        fileAction: String(form.get("fileAction") || "").trim(),
        stationType: String(form.get("stationType") || "").trim(),
        targetSeconds: isTimedRoute ?secondsFromTimeInput(form.get("targetSeconds")) : 0,
        timeSeconds: Number(question?.timeSeconds || 0),
        maxPoints: isOrtskunde ?1 : Math.min(10, Math.max(0.5, Number(form.get("maxPoints") || 1)))
      };
      if (!nextQuestion.prompt) {
        modal.querySelector("#modalError").textContent = "Bitte eine Frage eintragen.";
        return;
      }
      module.questions = question ?module.questions.map((item) => item.id === question.id ?nextQuestion : item) : [...module.questions, nextQuestion];
      saveTrainingStore(store);
      closeModal();
      refreshTrainingManagementView(departmentByPage(state.page));
    });
  });
}

function deleteTrainingQuestion(bank, moduleId, questionId, department) {
  const store = trainingStore();
  const module = findTrainingModule(store, bank, moduleId);
  if (!module) return;
  module.questions = module.questions.filter((question) => question.id !== questionId);
  saveTrainingStore(store);
  refreshTrainingManagementView(department);
  showNotify("Frage gelöscht.", "danger");
}

function openDeleteTrainingQuestionModal(bank, moduleId, questionId, department) {
  const store = trainingStore();
  const module = findTrainingModule(store, bank, moduleId);
  const question = module?.questions.find((item) => item.id === questionId);
  openConfirmModal({
    title: "Frage löschen",
    text: `${question?.prompt || "Diese Frage"} wirklich dauerhaft löschen?`,
    confirmText: "Frage löschen",
    onConfirm: () => deleteTrainingQuestion(bank, moduleId, questionId, department)
  });
}

function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Bitte eine Bilddatei auswählen."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Bild konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

function openTrainingModuleModal(moduleId = null, bank = "module") {
  const store = trainingStore();
  const listKey = bank === "est" ?"estModules" : "moduleModules";
  const module = store[listKey].find((item) => item.id === moduleId);
  openModal(`
    <h3>${module ?"Modul bearbeiten" : "Modul erstellen"}</h3>
    <form id="trainingModuleForm" class="form-grid">
      <label>Name<input name="name" value="${escapeHtml(module?.name || "")}" required></label>
      <label class="full">Beschreibung<textarea name="description">${escapeHtml(module?.description || "")}</textarea></label>
      <p id="modalError" class="form-error full"></p>
      <div class="modal-actions full">
        <button class="ghost-btn" type="button" data-close>Abbrechen</button>
        <button class="blue-btn" type="submit">Speichern</button>
      </div>
    </form>
  `, (modal) => {
    modal.querySelector("#trainingModuleForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const nextModule = {
        ...(module || {}),
        id: module?.id || makeTrainingId("module"),
        name: String(form.get("name") || "").trim(),
        description: String(form.get("description") || "").trim(),
        questions: module?.questions || []
      };
      if (!nextModule.name) {
        modal.querySelector("#modalError").textContent = "Bitte einen Modulnamen eintragen.";
        return;
      }
      store[listKey] = module ?store[listKey].map((item) => item.id === module.id ?nextModule : item) : [...store[listKey], nextModule];
      saveTrainingStore(store);
      closeModal();
      refreshTrainingManagementView(departmentByPage(state.page));
    });
  });
}

function applyTrainingModuleSettingsLocally(nextSettings = {}) {
  state.settings = state.settings || {};
  const current = state.settings.trainingModules || {};
  state.settings.trainingModules = {
    ...current,
    ...nextSettings,
    labels: nextSettings.labels || current.labels || {},
    details: nextSettings.details || current.details || {},
    categories: nextSettings.categories || current.categories || {},
    requirements: nextSettings.requirements || current.requirements || {},
    order: nextSettings.order || current.order || [],
    deleted: nextSettings.deleted || current.deleted || [],
    hidden: nextSettings.hidden || current.hidden || []
  };
}

async function saveTrainingModuleSettings(nextSettings, options = {}) {
  if (options.optimistic) applyTrainingModuleSettingsLocally(nextSettings);
  const data = await api("/api/settings/training-modules", {
    method: "PATCH",
    silent: true,
    body: JSON.stringify(nextSettings)
  });
  state.settings = data.settings || state.settings;
}

function persistTrainingModuleSettings(nextSettings) {
  saveTrainingModuleSettings(nextSettings).catch((error) => {
    showNotify(error.message || "Haken konnten nicht gespeichert werden.", "error");
  });
}

function openTrainingCheckModal(training) {
  if (!trainings.includes(training)) return;
  const config = trainingModuleSettings();
  const currentLabel = trainingDisplayName(training);
  const category = config.categories[training] || defaultTrainingCategory(training);
  openModal(`
    <h3>Haken umbenennen</h3>
    <p class="muted">Passe Namen und Details an. Bestehende Vergaben bleiben erhalten.</p>
    <label>Name<input id="trainingCheckLabel" value="${escapeHtml(currentLabel)}" required></label>
    <label>Details<input id="trainingCheckDetails" value="${escapeHtml(config.details[training] || training)}" placeholder="z.B. interne Info, Kürzel oder alter Name"></label>
    <label>Kategorie<input id="trainingCheckCategory" value="${escapeHtml(category)}" placeholder="z.B. Grundausbildung oder Spezialisierung"></label>
    <label>Voraussetzung für Rang<input id="trainingCheckRequirement" value="${escapeHtml(config.requirements[training] || "")}" placeholder="Optional, z.B. Rang 4"></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" type="button" data-close>Abbrechen</button>
      <button class="blue-btn" id="saveTrainingCheckLabel" type="button">Speichern</button>
    </div>
  `, (modal) => {
    modal.querySelector("#saveTrainingCheckLabel")?.addEventListener("click", async () => {
      const label = modal.querySelector("#trainingCheckLabel")?.value.trim() || "";
      const details = modal.querySelector("#trainingCheckDetails")?.value.trim() || "";
      const category = modal.querySelector("#trainingCheckCategory")?.value.trim() || defaultTrainingCategory(training);
      const requirement = modal.querySelector("#trainingCheckRequirement")?.value.trim() || "";
      if (!label) {
        modal.querySelector("#modalError").textContent = "Bitte einen Namen eintragen.";
        return;
      }
      try {
        const latestConfig = trainingModuleSettings();
        await saveTrainingModuleSettings({
          labels: { ...latestConfig.labels, [training]: label },
          details: { ...latestConfig.details, [training]: details },
          categories: { ...latestConfig.categories, [training]: category },
          requirements: { ...latestConfig.requirements, [training]: requirement },
          order: orderedTrainings({ includeHidden: true }),
          deleted: Array.from(latestConfig.deleted),
          hidden: Array.from(latestConfig.hidden)
        });
        closeModal();
        refreshTrainingManagementView(departmentByPage(state.page));
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

function toggleTrainingCheckVisibility(training, department) {
  if (!trainings.includes(training)) return;
  const config = trainingModuleSettings();
  const hidden = new Set(config.hidden);
  if (hidden.has(training)) hidden.delete(training);
  else hidden.add(training);
  const nextSettings = {
    labels: config.labels,
    details: config.details,
    categories: config.categories,
    requirements: config.requirements,
    order: orderedTrainings({ includeHidden: true }),
    deleted: Array.from(config.deleted),
    hidden: Array.from(hidden)
  };
  applyTrainingModuleSettingsLocally(nextSettings);
  refreshTrainingManagementView(department);
  showNotify(hidden.has(training) ?"Haken ausgeblendet." : "Haken eingeblendet.");
  persistTrainingModuleSettings(nextSettings);
}

function moveTrainingCheck(training, direction, department) {
  if (!trainings.includes(training) || !direction) return;
  const config = trainingModuleSettings();
  const order = orderedTrainings({ includeHidden: true });
  const index = order.indexOf(training);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
  [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
  const nextSettings = {
    labels: config.labels,
    details: config.details,
    categories: config.categories,
    requirements: config.requirements,
    order,
    deleted: Array.from(config.deleted),
    hidden: Array.from(config.hidden)
  };
  applyTrainingModuleSettingsLocally(nextSettings);
  refreshTrainingManagementView(department);
  persistTrainingModuleSettings(nextSettings);
}

function openDeleteTrainingCheckModal(training, department) {
  if (!trainings.includes(training)) return;
  openConfirmModal({
    title: "Haken löschen",
    text: `${trainingDisplayName(training)} wirklich aus der Verwaltung und aus allen Anzeigen entfernen? Bestehende alte Vergaben bleiben nur technisch im Hintergrund erhalten.`,
    confirmText: "Haken löschen",
    onConfirm: async () => {
      const config = trainingModuleSettings();
      const labels = { ...config.labels };
      const details = { ...config.details };
      const categories = { ...config.categories };
      const requirements = { ...config.requirements };
      delete labels[training];
      delete details[training];
      delete categories[training];
      delete requirements[training];
      await saveTrainingModuleSettings({
        labels,
        details,
        categories,
        requirements,
        order: orderedTrainings({ includeHidden: true }).filter((item) => item !== training),
        deleted: Array.from(new Set([...config.deleted, training])),
        hidden: Array.from(config.hidden).filter((item) => item !== training)
      });
      refreshTrainingManagementView(department);
      showNotify("Haken gelöscht.", "danger");
    }
  });
}

function refreshTrainingManagementView(department = null) {
  if (state.page === "IT") renderIT();
  else renderDepartmentPage(department || departmentByPage(state.page));
}

function deleteTrainingModule(bank, moduleId, department) {
  const store = trainingStore();
  const listKey = bank === "est" ?"estModules" : "moduleModules";
  store[listKey] = store[listKey].filter((module) => module.id !== moduleId);
  saveTrainingStore(store);
  refreshTrainingManagementView(department);
  showNotify("Modul gelöscht.", "danger");
}

function openDeleteTrainingModuleModal(bank, moduleId, department) {
  const store = trainingStore();
  const list = bank === "est" ?store.estModules : store.moduleModules;
  const module = list.find((item) => item.id === moduleId);
  openConfirmModal({
    title: "Modul löschen",
    text: `${module?.name || "Dieses Modul"} wirklich dauerhaft löschen?`,
    confirmText: "Modul löschen",
    onConfirm: () => deleteTrainingModule(bank, moduleId, department)
  });
}

function archiveTrainingExam(examId, department) {
  const store = trainingStore();
  const exam = store.activeExams.find((item) => item.id === examId);
  if (!exam) return;
  exam.status = "Archiviert";
  exam.archivedAt = new Date().toISOString();
  saveTrainingStore(store);
  renderDepartmentPage(department);
  showNotify("Prüfung archiviert.", "success");
}

function pauseTrainingExam(examId, department) {
  const store = trainingStore();
  const exam = store.activeExams.find((item) => item.id === examId);
  if (!exam) return;
  exam.status = "Pausiert";
  saveTrainingStore(store);
  renderDepartmentPage(department);
}

function deleteTrainingExam(examId, department) {
  const store = trainingStore();
  store.activeExams = store.activeExams.filter((exam) => exam.id !== examId);
  saveTrainingStore(store);
  renderDepartmentPage(department);
  showNotify("Prüfung gelöscht.", "danger");
}

function openDeleteTrainingExamModal(examId, department) {
  const store = trainingStore();
  const exam = store.activeExams.find((item) => item.id === examId);
  const candidate = state.users.find((user) => user.id === exam?.candidateId);
  openConfirmModal({
    title: "Prüfung löschen",
    text: `${candidate ?fullName(candidate) : "Diese Prüfung"} wirklich dauerhaft löschen?`,
    confirmText: "Prüfung löschen",
    onConfirm: () => deleteTrainingExam(examId, department)
  });
}

function examProgressText(exam) {
  const module = examCurrentModule(exam);
  return `${module?.name || "-"} · Frage ${exam.questionIndex + 1} von ${module?.questions.length || 0} · Modul ${exam.moduleIndex + 1} von ${exam.modules.length}`;
}

function renderExamQuestionControls(question) {
  if (!question) return "";
  if (question.type === "choice") {
    return `
      <div class="exam-answer-columns">
        <div>
          <strong>Richtige Antworten</strong>
          ${(question.correctAnswers || []).map((answer) => `<label class="exam-check"><input type="checkbox" name="correctAnswer" value="${escapeHtml(answer)}" ${question.selectedCorrect?.includes(answer) ?"checked" : ""}>${escapeHtml(answer)}</label>`).join("") || `<p class="muted">Keine richtigen Antworten hinterlegt.</p>`}
        </div>
        <div>
          <strong>Falsche / fehlende Antworten</strong>
          ${(question.wrongAnswers || []).map((answer) => `<label class="exam-check"><input type="checkbox" name="wrongAnswer" value="${escapeHtml(answer)}" ${question.selectedWrong?.includes(answer) ?"checked" : ""}>${escapeHtml(answer)}</label>`).join("") || `<p class="muted">Keine falschen Antworten hinterlegt.</p>`}
        </div>
      </div>
    `;
  }
  return `
    <div class="manual-solution-box">
      <strong>Musterlösung</strong>
      <p>${escapeHtml(question.solution || "Keine Musterlösung hinterlegt.")}</p>
    </div>
    <label class="full">Antwort des Prüflings<textarea id="examTraineeAnswer" placeholder="Antwort mitschreiben">${escapeHtml(question.traineeAnswer || "")}</textarea></label>
  `;
}

function renderExamReview(exam) {
  const total = exam.modules.flatMap((module) => module.questions).reduce((sum, question) => sum + Number(question.maxPoints || 1), 0);
  const scored = exam.modules.flatMap((module) => module.questions).reduce((sum, question) => sum + Number(question.manualPoints ?? question.result?.points ?? 0), 0);
  const percent = total ?Math.round((scored / total) * 100) : 0;
  return `
    <div class="exam-review-list">
      ${exam.modules.map((module) => `
        <section class="exam-review-module">
          <h4>${escapeHtml(module.name)}</h4>
          ${module.questions.map((question) => `
            <label class="exam-review-row">
              <span><b>${escapeHtml(question.prompt)}</b><small>Max. ${escapeHtml(question.maxPoints)} Punkte${question.type === "choice" ?" · automatisch vorbereitet" : " · manuell bewerten"}</small></span>
              <select data-review-score="${escapeHtml(question.id)}">
                ${[0, 0.5, 1, 1.5, 2].filter((value) => value <= Number(question.maxPoints || 1)).map((value) => `<option value="${value}" ${Number(question.manualPoints ?? question.result?.points ?? 0) === value ?"selected" : ""}>${value} Punkte</option>`).join("")}
              </select>
            </label>
          `).join("")}
        </section>
      `).join("")}
      <div class="exam-result-preview"><span><b>Zwischenstand</b>${scored} von ${total} Punkten</span><span class="${percent >= 75 ?"result-pass" : "result-fail"}">${percent}%</span></div>
    </div>
  `;
}

function openTrainingExamModal(examId) {
  const store = trainingStore();
  const exam = store.activeExams.find((item) => item.id === examId);
  if (!exam) return;
  const candidate = state.users.find((user) => user.id === exam.candidateId);
  const module = examCurrentModule(exam);
  const question = examCurrentQuestion(exam);
  const review = Boolean(exam.reviewMode);
  openModal(`
    <h3>${exam.kind === "est" ?"Grundausbildung" : "Modul Prüfung"}</h3>
    <p class="muted">${escapeHtml(candidate ?fullName(candidate) : "Unbekannter Prüfling")} · ${escapeHtml(examProgressText(exam))}</p>
    ${exam.finalResult ?`
      <div class="exam-result-preview">
        <span><b>Finales Ergebnis</b>${exam.finalResult.points} von ${exam.finalResult.total} Punkten</span>
        <span class="${exam.finalResult.percent >= 75 ?"result-pass" : "result-fail"}">${exam.finalResult.percent}% · ${exam.finalResult.percent >= 75 ?"Bestanden" : "Nicht bestanden"}</span>
      </div>
    ` : review ?renderExamReview(exam) : `
      <section class="exam-runner-card">
        <span>${escapeHtml(module?.name || "-")}</span>
        <h4>${escapeHtml(question?.prompt || "Keine Frage vorhanden")}</h4>
        ${renderExamQuestionControls(question)}
      </section>
    `}
    <div class="modal-actions">
      <button class="ghost-btn" id="pauseExamRunner" type="button">Zwischenspeichern & schließen</button>
      ${!exam.finalResult && !review ?`<button class="blue-btn" id="nextExamQuestion" type="button">Frage speichern / weiter</button><button class="orange-btn" id="startExamReview" type="button">Auswerten</button>` : ""}
      ${review ?`<button class="blue-btn" id="finishExamReview" type="button">Final auswerten</button>` : ""}
    </div>
  `, (modal) => {
    modal.classList.add("exam-modal");
    modal.querySelector("#examSecondExaminer")?.addEventListener("change", (event) => {
      exam.secondExaminerId = event.target.value;
      saveActiveTrainingExam(exam);
    });
    modal.querySelector("#beginExamRunner")?.addEventListener("click", () => {
      exam.secondExaminerId = modal.querySelector("#examSetupSecondExaminer")?.value || "";
      exam.status = "Laufend";
      exam.startedAt = new Date().toISOString();
      saveActiveTrainingExam(exam);
      openTrainingExamModal(exam.id);
      renderDepartmentPage(departmentByPage(state.page));
    });
    modal.querySelector("#pauseExamRunner")?.addEventListener("click", () => {
      exam.status = "Pausiert";
      saveActiveTrainingExam(exam);
      closeModal();
      renderDepartmentPage(departmentByPage(state.page));
    });
    const saveQuestion = () => {
      if (!question) return;
      if (question.type === "choice") {
        question.selectedCorrect = Array.from(modal.querySelectorAll("[name='correctAnswer']:checked")).map((input) => input.value);
        question.selectedWrong = Array.from(modal.querySelectorAll("[name='wrongAnswer']:checked")).map((input) => input.value);
        const correctCount = question.correctAnswers?.length || 0;
        const hitCount = question.selectedCorrect.length;
        const wrongCount = question.selectedWrong.length;
        const ratio = correctCount ?Math.max(0, (hitCount - wrongCount * 0.5) / correctCount) : 0;
        question.manualPoints = Math.min(Number(question.maxPoints || 1), Math.round(ratio * Number(question.maxPoints || 1) * 2) / 2);
        question.result = { points: question.manualPoints };
      } else {
        question.traineeAnswer = modal.querySelector("#examTraineeAnswer")?.value || "";
      }
      exam.status = "Laufend";
      saveActiveTrainingExam(exam);
    };
    modal.querySelector("#nextExamQuestion")?.addEventListener("click", () => {
      saveQuestion();
      if (exam.questionIndex < (examCurrentModule(exam)?.questions.length || 0) - 1) exam.questionIndex += 1;
      else if (exam.moduleIndex < exam.modules.length - 1) {
        exam.moduleIndex += 1;
        exam.questionIndex = 0;
      } else {
        exam.reviewMode = true;
      }
      saveActiveTrainingExam(exam);
      openTrainingExamModal(exam.id);
    });
    modal.querySelector("#startExamReview")?.addEventListener("click", () => {
      saveQuestion();
      exam.reviewMode = true;
      saveActiveTrainingExam(exam);
      openTrainingExamModal(exam.id);
    });
    modal.querySelector("#finishExamReview")?.addEventListener("click", () => {
      modal.querySelectorAll("[data-review-score]").forEach((select) => {
        exam.modules.forEach((reviewModule) => reviewModule.questions.forEach((reviewQuestion) => {
          if (reviewQuestion.id === select.dataset.reviewScore) reviewQuestion.manualPoints = Number(select.value);
        }));
      });
      const questions = exam.modules.flatMap((reviewModule) => reviewModule.questions);
      const total = questions.reduce((sum, item) => sum + Number(item.maxPoints || 1), 0);
      const points = questions.reduce((sum, item) => sum + Number(item.manualPoints || 0), 0);
      exam.finalResult = { total, points, percent: total ?Math.round((points / total) * 100) : 0 };
      exam.status = "Abgeschlossen";
      saveActiveTrainingExam(exam);
      openTrainingExamModal(exam.id);
      renderDepartmentPage(departmentByPage(state.page));
    });
  });
}

function renderExamArchiveDetail(exam) {
  return `
    <div class="exam-review-list">
      ${exam.modules.map((module) => `
        <section class="exam-review-module">
          <h4>${escapeHtml(module.name)}</h4>
          ${module.questions.map((question) => `
            <div class="exam-review-row">
              <span>
                <b>${escapeHtml(question.prompt)}</b>
                <small>${question.type === "choice" ?`Auswahl richtig: ${(question.selectedCorrect || []).join(", ") || "-"} · Auswahl falsch/fehlend: ${(question.selectedWrong || []).join(", ") || "-"}` : `Antwort: ${question.traineeAnswer || "-"}`}</small>
              </span>
              <strong>${escapeHtml(question.manualPoints ?? question.result?.points ?? 0)} / ${escapeHtml(question.maxPoints || 1)} Punkte</strong>
            </div>
          `).join("")}
        </section>
      `).join("")}
    </div>
  `;
}

function openTrainingExamModal(examId, readOnly = false) {
  const store = trainingStore();
  const exam = store.activeExams.find((item) => item.id === examId);
  if (!exam) return;
  const candidate = state.users.find((user) => user.id === exam.candidateId);
  const module = examCurrentModule(exam);
  const question = examCurrentQuestion(exam);
  const review = Boolean(exam.reviewMode);
  const archiveView = readOnly || exam.status === "Archiviert";
  const isSetup = exam.status === "Vorbereitung";
  openModal(`
    <h3>${exam.kind === "est" ?"Grundausbildung" : "Modul Prüfung"}</h3>
    <p class="muted">${escapeHtml(candidate ?fullName(candidate) : "Unbekannter Prüfling")} · ${escapeHtml(examProgressText(exam))}</p>
    ${!archiveView && !isSetup ?`<div class="exam-runner-meta"><label>2. Prüfer<select id="examSecondExaminer"><option value=""></option>${state.users.map((user) => `<option value="${user.id}" ${exam.secondExaminerId === user.id ?"selected" : ""}>${escapeHtml(fullName(user))}</option>`).join("")}</select></label><span><b>Dauer</b><i class="exam-live-timer" data-started-at="${escapeHtml(exam.startedAt || "")}">${escapeHtml(examElapsedText(exam))}</i></span></div>` : ""}
    ${archiveView ?renderExamArchiveDetail(exam) : isSetup ?`
      <section class="exam-runner-card">
        <span>Prüfung vorbereiten</span>
        <h4>${escapeHtml(candidate ?fullName(candidate) : "Unbekannter Prüfling")}</h4>
        <label>2. Prüfer optional<select id="examSetupSecondExaminer"><option value=""></option>${state.users.map((user) => `<option value="${user.id}" ${exam.secondExaminerId === user.id ?"selected" : ""}>${escapeHtml(fullName(user))}</option>`).join("")}</select></label>
        <p class="muted">Erst nach dem Start werden Fragen angezeigt und der Timer läuft.</p>
      </section>
    ` : exam.finalResult ?`
      <div class="exam-result-preview">
        <span><b>Finales Ergebnis</b>${exam.finalResult.points} von ${exam.finalResult.total} Punkten</span>
        <span class="${exam.finalResult.percent >= 75 ?"result-pass" : "result-fail"}">${exam.finalResult.percent}% · ${exam.finalResult.percent >= 75 ?"Bestanden" : "Nicht bestanden"}</span>
      </div>
      ${renderExamArchiveDetail(exam)}
    ` : review ?renderExamReview(exam) : `
      <section class="exam-runner-card">
        <span>${escapeHtml(module?.name || "-")}</span>
        <h4>${escapeHtml(question?.prompt || "Keine Frage vorhanden")}</h4>
        ${renderExamQuestionControls(question)}
      </section>
    `}
    <div class="modal-actions">
      <button class="ghost-btn" id="pauseExamRunner" type="button">${archiveView ?"Schließen" : isSetup ?"Abbrechen" : "Zwischenspeichern & schließen"}</button>
      ${!archiveView && isSetup ?`<button class="blue-btn" id="beginExamRunner" type="button">Prüfung starten</button>` : ""}
      ${!archiveView && !isSetup && !exam.finalResult && !review ?`<button class="blue-btn" id="nextExamQuestion" type="button">Frage speichern / weiter</button><button class="orange-btn" id="startExamReview" type="button">Auswerten</button>` : ""}
      ${!archiveView && review ?`<button class="blue-btn" id="finishExamReview" type="button">Final auswerten</button>` : ""}
    </div>
  `, (modal) => {
    modal.classList.add("exam-modal");
    if (isSetup) modal.classList.add("setup-exam-modal");
    modal.querySelector("#beginExamRunner")?.addEventListener("click", () => {
      exam.secondExaminerId = modal.querySelector("#examSetupSecondExaminer")?.value || "";
      exam.status = "Laufend";
      exam.startedAt = new Date().toISOString();
      saveActiveTrainingExam(exam);
      openTrainingExamModal(exam.id);
      renderDepartmentPage(departmentByPage(state.page));
    });
    modal.querySelector("#pauseExamRunner")?.addEventListener("click", () => {
      if (archiveView) {
        closeModal();
        return;
      }
      if (isSetup) {
        store.activeExams = store.activeExams.filter((item) => item.id !== exam.id);
        saveTrainingStore(store);
        closeModal();
        renderDepartmentPage(departmentByPage(state.page));
        return;
      }
      exam.status = "Pausiert";
      saveActiveTrainingExam(exam);
      closeModal();
      renderDepartmentPage(departmentByPage(state.page));
    });
    const saveQuestion = () => {
      if (!question) return;
      if (question.type === "choice") {
        question.selectedCorrect = Array.from(modal.querySelectorAll("[name='correctAnswer']:checked")).map((input) => input.value);
        question.selectedWrong = Array.from(modal.querySelectorAll("[name='wrongAnswer']:checked")).map((input) => input.value);
        const correctCount = question.correctAnswers?.length || 0;
        const hitCount = question.selectedCorrect.length;
        const wrongCount = question.selectedWrong.length;
        const ratio = correctCount ?Math.max(0, (hitCount - wrongCount * 0.5) / correctCount) : 0;
        question.manualPoints = Math.min(Number(question.maxPoints || 1), Math.round(ratio * Number(question.maxPoints || 1) * 2) / 2);
        question.result = { points: question.manualPoints };
      } else {
        question.traineeAnswer = modal.querySelector("#examTraineeAnswer")?.value || "";
      }
      exam.status = "Laufend";
      saveActiveTrainingExam(exam);
    };
    modal.querySelector("#nextExamQuestion")?.addEventListener("click", () => {
      saveQuestion();
      if (exam.questionIndex < (examCurrentModule(exam)?.questions.length || 0) - 1) exam.questionIndex += 1;
      else if (exam.moduleIndex < exam.modules.length - 1) {
        exam.moduleIndex += 1;
        exam.questionIndex = 0;
      } else {
        exam.reviewMode = true;
      }
      saveActiveTrainingExam(exam);
      openTrainingExamModal(exam.id);
    });
    modal.querySelector("#startExamReview")?.addEventListener("click", () => {
      saveQuestion();
      exam.reviewMode = true;
      saveActiveTrainingExam(exam);
      openTrainingExamModal(exam.id);
    });
    modal.querySelector("#finishExamReview")?.addEventListener("click", () => {
      modal.querySelectorAll("[data-review-score]").forEach((select) => {
        exam.modules.forEach((reviewModule) => reviewModule.questions.forEach((reviewQuestion) => {
          if (reviewQuestion.id === select.dataset.reviewScore) reviewQuestion.manualPoints = Number(select.value);
        }));
      });
      const questions = exam.modules.flatMap((reviewModule) => reviewModule.questions);
      const total = questions.reduce((sum, item) => sum + Number(item.maxPoints || 1), 0);
      const points = questions.reduce((sum, item) => sum + Number(item.manualPoints || 0), 0);
      exam.finalResult = { total, points, percent: total ?Math.round((points / total) * 100) : 0 };
      exam.status = "Abgeschlossen";
      exam.archivedAt = new Date().toISOString();
      saveActiveTrainingExam(exam);
      openTrainingExamModal(exam.id);
      renderDepartmentPage(departmentByPage(state.page));
    });
  });
}

function ensureExamModuleState(exam) {
  if (!exam || !Array.isArray(exam.modules)) return exam;
  exam.moduleIndex = Math.max(0, Math.min(Number(exam.moduleIndex || 0), Math.max(0, exam.modules.length - 1)));
  exam.questionIndex = Math.max(0, Number(exam.questionIndex || 0));
  exam.modules.forEach((module, moduleIndex) => {
    if (!module.status) {
      if (exam.status === "Vorbereitung") module.status = "Offen";
      else if (moduleIndex < exam.moduleIndex) module.status = "Abgeschlossen";
      else if (moduleIndex === exam.moduleIndex && exam.reviewMode) module.status = "Auswertung";
      else if (moduleIndex === exam.moduleIndex) module.status = "Laufend";
      else module.status = "Offen";
    }
    module.questions = module.questions || [];
    module.questions.forEach((question) => {
      if (!Array.isArray(question.selectedAnswers)) {
        question.selectedAnswers = [...(question.selectedCorrect || []), ...(question.selectedWrong || [])];
      }
      question.questionPenalty = Boolean(question.questionPenalty);
      question.traineeAnswer = question.traineeAnswer || "";
      question.manualPoints = Number(question.manualPoints ?? question.result?.points ?? 0);
    });
  });
  return exam;
}

function currentManagedExamModule(exam) {
  ensureExamModuleState(exam);
  return exam?.modules?.[exam.moduleIndex] || null;
}

function currentManagedExamQuestion(exam) {
  const module = currentManagedExamModule(exam);
  const questionCount = module?.questions?.length || 0;
  exam.questionIndex = Math.max(0, Math.min(Number(exam.questionIndex || 0), Math.max(0, questionCount - 1)));
  return module?.questions?.[exam.questionIndex] || null;
}

function examModuleTotal(module) {
  return (module?.questions || []).reduce((sum, question) => sum + Number(question.maxPoints || 1), 0);
}

function examModulePoints(module) {
  return (module?.questions || []).reduce((sum, question) => sum + Number(question.manualPoints ?? question.result?.points ?? 0), 0);
}

function examModulePercent(module) {
  const total = examModuleTotal(module);
  return total ?Math.round((examModulePoints(module) / total) * 100) : 0;
}

function normalizeChoiceAnswers(question) {
  return Array.from(new Set([...(question.correctAnswers || []), ...(question.wrongAnswers || [])].filter(Boolean)));
}

function scoreChoiceQuestion(question) {
  const maxPoints = Number(question.maxPoints || 1);
  const correctAnswers = question.correctAnswers || [];
  const selectedAnswers = question.selectedAnswers || [];
  const hits = correctAnswers.filter((answer) => selectedAnswers.includes(answer)).length;
  const base = correctAnswers.length ?(hits / correctAnswers.length) * maxPoints : 0;
  const points = Math.round((base - (question.questionPenalty ?1 : 0)) * 2) / 2;
  return Math.max(-1, Math.min(maxPoints, points));
}

function renderExamModuleStepper(exam) {
  ensureExamModuleState(exam);
  return `
    <div class="exam-module-stepper">
      ${exam.modules.map((module, index) => `
        <span class="${index === exam.moduleIndex ?"active" : ""} ${module.status === "Abgeschlossen" ?"done" : ""}">
          <b>${escapeHtml(module.name)}</b>
          <small>${escapeHtml(module.status || "Offen")}${module.result ?` · ${escapeHtml(module.result.percent)}%` : ""}</small>
        </span>
      `).join("")}
    </div>
  `;
}

function renderExamQuestionControls(question) {
  if (!question) return `<p class="muted">Keine Frage vorhanden.</p>`;
  if (question.type === "choice") {
    const answers = normalizeChoiceAnswers(question);
    return `
      <div class="exam-answer-list">
        <strong>Antworten des Prüflings markieren</strong>
        ${answers.length ?answers.map((answer) => `
          <label class="exam-check">
            <input data-autosave-exam type="checkbox" name="answerOption" value="${escapeHtml(answer)}" ${question.selectedAnswers?.includes(answer) ?"checked" : ""}>
            ${escapeHtml(answer)}
          </label>
        `).join("") : `<p class="muted">Keine Antwortmöglichkeiten hinterlegt.</p>`}
        <label class="exam-check penalty">
          <input data-autosave-exam type="checkbox" name="questionPenalty" ${question.questionPenalty ?"checked" : ""}>
          Frage falsch beantwortet (-1 Punkt)
        </label>
      </div>
    `;
  }
  return `
    <div class="manual-solution-box">
      <strong>Musterlösung für den Prüfer</strong>
      <p>${escapeHtml(question.solution || "Keine Musterlösung hinterlegt.")}</p>
    </div>
    <label class="full">Antwort des Prüflings<textarea data-autosave-exam id="examTraineeAnswer" placeholder="Antwort mitschreiben">${escapeHtml(question.traineeAnswer || "")}</textarea></label>
  `;
}

function renderExamAnswerSummary(question) {
  if (question.type === "choice") {
    const selected = question.selectedAnswers || [];
    const missing = (question.correctAnswers || []).filter((answer) => !selected.includes(answer));
    return `
      <small><b>Ausgewählt:</b> ${escapeHtml(selected.join(", ") || "-")}</small>
      <small><b>Nicht genannt:</b> ${escapeHtml(missing.join(", ") || "-")}</small>
      <small><b>Frage falsch beantwortet:</b> ${question.questionPenalty ?"Ja (-1 Punkt)" : "Nein"}</small>
    `;
  }
  return `
    <small><b>Antwort Prüfling:</b> ${escapeHtml(question.traineeAnswer || "-")}</small>
    <small><b>Musterlösung:</b> ${escapeHtml(question.solution || "-")}</small>
  `;
}

function renderExamReview(exam) {
  ensureExamModuleState(exam);
  const module = currentManagedExamModule(exam);
  const total = examModuleTotal(module);
  const scored = examModulePoints(module);
  const percent = examModulePercent(module);
  return `
    ${renderExamModuleStepper(exam)}
    <div class="exam-review-list">
      <section class="exam-review-module">
        <h4>${escapeHtml(module?.name || "Modul")}</h4>
        ${(module?.questions || []).map((question, index) => `
          <label class="exam-review-row detailed">
            <span>
              <b>${index + 1}. ${escapeHtml(question.prompt)}</b>
              ${renderExamAnswerSummary(question)}
              <small>Max. ${escapeHtml(question.maxPoints || 1)} Punkte</small>
            </span>
            <select data-review-score="${escapeHtml(question.id)}">
              ${[-1, 0, 0.5, 1, 1.5, 2].filter((value) => value <= Number(question.maxPoints || 1)).map((value) => `<option value="${value}" ${Number(question.manualPoints ?? question.result?.points ?? 0) === value ?"selected" : ""}>${value} Punkte</option>`).join("")}
            </select>
          </label>
        `).join("") || `<p class="muted">Keine Fragen in diesem Modul.</p>`}
      </section>
      <div class="exam-result-preview"><span><b>Modul-Zwischenstand</b>${scored} von ${total} Punkten</span><span class="${percent >= 75 ?"result-pass" : "result-fail"}">${percent}%</span></div>
    </div>
  `;
}

function renderExamArchiveDetail(exam) {
  ensureExamModuleState(exam);
  return `
    <div class="exam-review-list archive-detail">
      ${exam.modules.map((module, moduleIndex) => {
        const points = module.result?.points ?? examModulePoints(module);
        const total = module.result?.total ?? examModuleTotal(module);
        const percent = module.result?.percent ?? examModulePercent(module);
        return `
          <section class="exam-review-module archive-module-block">
            <div class="archive-module-head">
              <h4>Modul ${moduleIndex + 1}: ${escapeHtml(module.name)}</h4>
              <span class="${percent >= 75 ?"result-pass" : "result-fail"}">${escapeHtml(percent)}% · ${escapeHtml(points)} / ${escapeHtml(total)} Punkte</span>
            </div>
            ${(module.questions || []).map((question, questionIndex) => `
              <div class="exam-review-row detailed archive-question-row">
                <span>
                  <b>${questionIndex + 1}. ${escapeHtml(question.prompt)}</b>
                  ${renderExamAnswerSummary(question)}
                </span>
                <strong>${escapeHtml(question.manualPoints ?? question.result?.points ?? 0)} / ${escapeHtml(question.maxPoints || 1)} Punkte</strong>
              </div>
            `).join("") || `<p class="muted">Keine Fragen gespeichert.</p>`}
          </section>
        `;
      }).join("")}
    </div>
  `;
}

function examProgressText(exam) {
  ensureExamModuleState(exam);
  const module = currentManagedExamModule(exam);
  const questionCount = module?.questions?.length || 0;
  const status = module?.status || exam.status || "-";
  return `${module?.name || "-"} · ${status} · Frage ${Math.min(Number(exam.questionIndex || 0) + 1, Math.max(1, questionCount))} von ${questionCount} · Modul ${Number(exam.moduleIndex || 0) + 1} von ${exam.modules?.length || 0}`;
}

function renderExamModuleStart(exam, candidate) {
  const module = currentManagedExamModule(exam);
  const completed = exam.modules.filter((item) => item.status === "Abgeschlossen").length;
  return `
    ${renderExamModuleStepper(exam)}
    <section class="exam-runner-card exam-module-start-card">
      <span>${exam.status === "Vorbereitung" ?"Prüfung vorbereiten" : "Nächstes Modul bereit"}</span>
      <h4>${escapeHtml(module?.name || "Modul")}</h4>
      <p class="muted">${escapeHtml(candidate ?fullName(candidate) : "Unbekannter Prüfling")} · ${completed} von ${exam.modules.length} Modulen abgeschlossen</p>
      <label>2. Prüfer optional<select id="examSetupSecondExaminer"><option value=""></option>${state.users.map((user) => `<option value="${user.id}" ${exam.secondExaminerId === user.id ?"selected" : ""}>${escapeHtml(fullName(user))}</option>`).join("")}</select></label>
      <p class="muted">Erst nach dem Modulstart werden Fragen angezeigt. Jedes Modul wird separat ausgewertet und danach manuell fortgesetzt.</p>
    </section>
  `;
}

function openTrainingExamModal(examId, readOnly = false) {
  const store = trainingStore();
  const exam = store.activeExams.find((item) => item.id === examId);
  if (!exam) return;
  ensureExamModuleState(exam);
  const candidate = state.users.find((user) => user.id === exam.candidateId);
  const module = currentManagedExamModule(exam);
  const question = currentManagedExamQuestion(exam);
  const archiveView = readOnly || exam.status === "Archiviert";
  const isFinal = exam.status === "Abgeschlossen" || Boolean(exam.finalResult);
  const isSetup = !archiveView && !isFinal && (exam.status === "Vorbereitung" || module?.status === "Offen" || exam.status === "Modul bereit");
  const isReview = !archiveView && !isFinal && (exam.reviewMode || module?.status === "Auswertung");
  const isActive = !archiveView && !isFinal && !isSetup && !isReview;
  openModal(`
    <h3>${exam.kind === "est" ?"Grundausbildung" : "Modul Prüfung"}</h3>
    <p class="muted">${escapeHtml(candidate ?fullName(candidate) : "Unbekannter Prüfling")} · ${escapeHtml(examProgressText(exam))}</p>
    ${!archiveView && !isSetup && !isFinal ?`<div class="exam-runner-meta"><label>2. Prüfer<select id="examSecondExaminer"><option value=""></option>${state.users.map((user) => `<option value="${user.id}" ${exam.secondExaminerId === user.id ?"selected" : ""}>${escapeHtml(fullName(user))}</option>`).join("")}</select></label><span><b>Dauer</b><i class="exam-live-timer" data-started-at="${escapeHtml(exam.startedAt || "")}">${escapeHtml(examElapsedText(exam))}</i></span></div>` : ""}
    ${archiveView ?renderExamArchiveDetail(exam) : isSetup ?renderExamModuleStart(exam, candidate) : isFinal ?`
      <div class="exam-result-preview">
        <span><b>Finales Ergebnis</b>${exam.finalResult.points} von ${exam.finalResult.total} Punkten</span>
        <span class="${exam.finalResult.percent >= 75 ?"result-pass" : "result-fail"}">${exam.finalResult.percent}% · ${exam.finalResult.percent >= 75 ?"Bestanden" : "Nicht bestanden"}</span>
      </div>
      ${renderExamArchiveDetail(exam)}
    ` : isReview ?renderExamReview(exam) : `
      ${renderExamModuleStepper(exam)}
      <section class="exam-runner-card">
        <span>${escapeHtml(module?.name || "-")}</span>
        <h4>${escapeHtml(question?.prompt || "Keine Frage vorhanden")}</h4>
        ${renderExamQuestionControls(question)}
      </section>
    `}
    <div class="modal-actions">
      <button class="ghost-btn" id="pauseExamRunner" type="button">${archiveView || isFinal ?"Schließen" : isSetup ?"Abbrechen" : "Schließen"}</button>
      ${isSetup ?`<button class="blue-btn" id="beginExamRunner" type="button">${exam.status === "Vorbereitung" ?"Prüfung starten" : "Modul starten"}</button>` : ""}
      ${isActive ?`<button class="blue-btn" id="nextExamQuestion" type="button">${exam.questionIndex < (module?.questions.length || 0) - 1 ?"Frage speichern / weiter" : "Modul auswerten"}</button>` : ""}
      ${isReview ?`<button class="blue-btn" id="finishExamReview" type="button">Modul final auswerten</button>` : ""}
    </div>
  `, (modal) => {
    modal.classList.add("exam-modal");
    if (isSetup) modal.classList.add("setup-exam-modal");
    const persist = () => {
      ensureExamModuleState(exam);
      saveActiveTrainingExam(exam);
    };
    const saveQuestion = () => {
      const activeQuestion = currentManagedExamQuestion(exam);
      if (!activeQuestion) return;
      if (activeQuestion.type === "choice") {
        activeQuestion.selectedAnswers = Array.from(modal.querySelectorAll("[name='answerOption']:checked")).map((input) => input.value);
        activeQuestion.questionPenalty = Boolean(modal.querySelector("[name='questionPenalty']")?.checked);
        activeQuestion.manualPoints = scoreChoiceQuestion(activeQuestion);
        activeQuestion.result = { points: activeQuestion.manualPoints };
      } else {
        activeQuestion.traineeAnswer = modal.querySelector("#examTraineeAnswer")?.value || "";
      }
      if (module) module.status = "Laufend";
      if (!exam.startedAt) exam.startedAt = new Date().toISOString();
      exam.status = "Laufend";
      persist();
    };
    modal.querySelector("#examSecondExaminer")?.addEventListener("change", (event) => {
      exam.secondExaminerId = event.target.value;
      persist();
    });
    modal.querySelector("#beginExamRunner")?.addEventListener("click", () => {
      exam.secondExaminerId = modal.querySelector("#examSetupSecondExaminer")?.value || "";
      exam.status = "Laufend";
      if (!exam.startedAt) exam.startedAt = new Date().toISOString();
      if (module) {
        module.status = "Laufend";
        module.startedAt = module.startedAt || new Date().toISOString();
      }
      exam.reviewMode = false;
      exam.questionIndex = 0;
      persist();
      openTrainingExamModal(exam.id);
      renderDepartmentPage(departmentByPage(state.page));
    });
    modal.querySelector("#pauseExamRunner")?.addEventListener("click", () => {
      if (archiveView || isFinal) {
        closeModal();
        return;
      }
      if (isSetup && exam.status === "Vorbereitung") {
        store.activeExams = store.activeExams.filter((item) => item.id !== exam.id);
        saveTrainingStore(store);
        closeModal();
        renderDepartmentPage(departmentByPage(state.page));
        return;
      }
      if (isActive) saveQuestion();
      closeModal();
      renderDepartmentPage(departmentByPage(state.page));
    });
    modal.querySelectorAll("[data-autosave-exam]").forEach((input) => {
      input.addEventListener(input.tagName === "TEXTAREA" ?"input" : "change", saveQuestion);
    });
    modal.querySelector("#nextExamQuestion")?.addEventListener("click", () => {
      saveQuestion();
      if (exam.questionIndex < (module?.questions.length || 0) - 1) {
        exam.questionIndex += 1;
      } else if (module) {
        module.status = "Auswertung";
        exam.reviewMode = true;
      }
      persist();
      openTrainingExamModal(exam.id);
    });
    modal.querySelector("#finishExamReview")?.addEventListener("click", () => {
      modal.querySelectorAll("[data-review-score]").forEach((select) => {
        const reviewQuestion = (module?.questions || []).find((item) => item.id === select.dataset.reviewScore);
        if (reviewQuestion) {
          reviewQuestion.manualPoints = Number(select.value);
          reviewQuestion.result = { points: reviewQuestion.manualPoints };
        }
      });
      if (module) {
        module.status = "Abgeschlossen";
        module.completedAt = new Date().toISOString();
        module.result = {
          total: examModuleTotal(module),
          points: examModulePoints(module),
          percent: examModulePercent(module)
        };
      }
      const nextIndex = exam.modules.findIndex((item) => item.status !== "Abgeschlossen");
      exam.reviewMode = false;
      if (nextIndex >= 0) {
        exam.moduleIndex = nextIndex;
        exam.questionIndex = 0;
        exam.status = "Modul bereit";
        exam.modules[nextIndex].status = "Offen";
      } else {
        const total = exam.modules.reduce((sum, item) => sum + examModuleTotal(item), 0);
        const points = exam.modules.reduce((sum, item) => sum + examModulePoints(item), 0);
        exam.finalResult = { total, points, percent: total ?Math.round((points / total) * 100) : 0 };
        exam.status = "Abgeschlossen";
        exam.archivedAt = new Date().toISOString();
      }
      persist();
      openTrainingExamModal(exam.id);
      renderDepartmentPage(departmentByPage(state.page));
    });
  });
}

function shuffledItems(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function isEstLocationModule(module) {
  return /ortskunde|fahrstrecke/i.test(cleanText(module?.name || "")) || ["est-location", "est-drive"].includes(module?.id);
}

function isLocationQuestion(question, side = "main") {
  return side === "location" || question?.type === "location";
}

function orderedEstModules(modules = []) {
  const order = ["est-law", "est-location", "est-scenario", "est-rules", "est-drive", "est-heli"];
  return [...modules].sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    return (ai === -1 ?999 : ai) - (bi === -1 ?999 : bi);
  });
}

function createTrainingExam(kind, candidateId, secondExaminerId, modules) {
  const exam = {
    id: makeTrainingId("exam"),
    kind,
    candidateId,
    examinerId: state.currentUser?.id,
    secondExaminerId,
    status: "Vorbereitung",
    moduleIndex: 0,
    questionIndex: 0,
    reviewMode: false,
    finalResult: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    activeMainModuleId: "",
    modules: (kind === "est" ?orderedEstModules(modules) : modules).map((module) => ({
      id: module.id,
      name: module.name,
      description: module.description,
      phase: module.phase || 0,
      status: "Offen",
      questions: module.questions.map((question) => ({ ...question, result: null, traineeAnswer: "", selectedCorrect: [], selectedWrong: [], selectedAnswers: [], manualPoints: 0, stationType: question.stationType || "", timeSeconds: Number(question.timeSeconds || 0), targetSeconds: Number(question.targetSeconds || 0), questionPenalty: false, penaltyPoints: 0, skipped: false }))
    }))
  };
  if (kind === "est") prepareEstExamModules(exam);
  return exam;
}

function prepareEstExamModules(exam) {
  if (!exam || exam.kind !== "est" || exam.locationRandomized) return exam;
  exam.modules.filter((module) => isEstLocationModule(module) || module.id === "est-heli").forEach((sideModule) => {
    if (!sideModule.questions?.length && sideModule.id === "est-location") {
      sideModule.questions = EST_LOCATION_PROMPTS.map((place) => defaultTrainingQuestion(place, "location"));
    }
    const timed = ["est-drive", "est-heli"].includes(sideModule.id);
    sideModule.questions = shuffledItems(sideModule.questions || []).map((question) => ({
      ...question,
      type: "location",
      stationType: question.stationType || (sideModule.id === "est-heli" && /dach|landung|combat/i.test(question.prompt || "") ?"combat" : sideModule.id === "est-heli" ?"route" : ""),
      maxPoints: timed ?Number(question.maxPoints || 10) : 1,
      targetSeconds: Number(question.targetSeconds || 0),
      timeSeconds: Number(question.timeSeconds || 0),
      manualPoints: Number(question.manualPoints || 0),
      traineeAnswer: "",
      selectedAnswers: [],
      questionPenalty: false,
      penaltyPoints: 0,
      skipped: false
    }));
  });
  exam.locationRandomized = true;
  return exam;
}

function ensureExamModuleState(exam) {
  if (!exam || !Array.isArray(exam.modules)) return exam;
  if (exam.kind === "est") prepareEstExamModules(exam);
  exam.moduleIndex = Math.max(0, Math.min(Number(exam.moduleIndex || 0), Math.max(0, exam.modules.length - 1)));
  exam.questionIndex = Math.max(0, Number(exam.questionIndex || 0));
  exam.modules.forEach((module, moduleIndex) => {
    if (!module.status) {
      if (exam.status === "Vorbereitung") module.status = "Offen";
      else if (moduleIndex < exam.moduleIndex) module.status = "Abgeschlossen";
      else if (moduleIndex === exam.moduleIndex && exam.reviewMode) module.status = "Auswertung";
      else if (moduleIndex === exam.moduleIndex) module.status = "Laufend";
      else module.status = "Offen";
    }
    module.questions = module.questions || [];
    module.questions.forEach((question) => {
      if (!Array.isArray(question.selectedAnswers)) {
        question.selectedAnswers = [...(question.selectedCorrect || []), ...(question.selectedWrong || [])];
      }
      question.questionPenalty = false;
      question.penaltyPoints = 0;
      question.skipped = Boolean(question.skipped);
      question.traineeAnswer = question.traineeAnswer || "";
      question.manualPoints = Number(question.manualPoints ?? question.result?.points ?? 0);
      if (module.id === "est-location") question.maxPoints = 1;
      else if (["est-drive", "est-heli"].includes(module.id)) question.maxPoints = Math.min(10, Math.max(1, Number(question.maxPoints || 10)));
      else if (question.type === "scenario" || module.id === "est-scenario") question.maxPoints = Math.min(10, Math.max(5, Number(question.maxPoints || 10)));
      else question.maxPoints = Math.min(10, Math.max(3, Number(question.maxPoints || 3)));
    });
  });
  if (exam.kind === "est" && !exam.activeMainModuleId) {
    const firstMain = exam.modules.find((module) => !isEstLocationModule(module) && module.status !== "Abgeschlossen");
    exam.activeMainModuleId = firstMain?.id || "";
  }
  return exam;
}

function estLocationModule(exam) {
  ensureExamModuleState(exam);
  return exam.modules.find(isEstLocationModule) || null;
}

function estSideModules(exam) {
  ensureExamModuleState(exam);
  return exam.modules.filter(isEstLocationModule);
}

function estSideModulesForMain(exam, mainModule = currentManagedExamModule(exam)) {
  ensureExamModuleState(exam);
  const map = {
    "est-law": ["est-location"],
    "est-rules": ["est-drive"]
  };
  return exam.modules.filter((module) => (map[mainModule?.id] || []).includes(module.id));
}

function estMainModules(exam) {
  ensureExamModuleState(exam);
  return exam.modules.filter((module) => !isEstLocationModule(module));
}

function currentManagedExamModule(exam) {
  ensureExamModuleState(exam);
  if (exam.kind === "est" && exam.activeMainModuleId) return exam.modules.find((module) => module.id === exam.activeMainModuleId) || exam.modules[exam.moduleIndex] || null;
  return exam?.modules?.[exam.moduleIndex] || null;
}

function currentManagedExamQuestion(exam) {
  const module = currentManagedExamModule(exam);
  const questionCount = module?.questions?.length || 0;
  exam.questionIndex = Math.max(0, Math.min(Number(exam.questionIndex || 0), Math.max(0, questionCount - 1)));
  return module?.questions?.[exam.questionIndex] || null;
}

function examModuleTotal(module) {
  return (module?.questions || []).reduce((sum, question) => sum + Number(question.maxPoints || 1), 0);
}

function examModulePoints(module) {
  return (module?.questions || []).reduce((sum, question) => sum + Number(question.manualPoints ?? question.result?.points ?? 0), 0);
}

function examModulePercent(module) {
  const total = examModuleTotal(module);
  return total ?Math.round((examModulePoints(module) / total) * 100) : 0;
}

function examModuleTone(module) {
  const percent = examModulePercent(module);
  if (percent >= 75) return "good";
  if (percent >= 65) return "warn";
  return "bad";
}

function normalizeChoiceAnswers(question) {
  return Array.from(new Set([...(question.correctAnswers || []), ...(question.wrongAnswers || [])].filter(Boolean)));
}

function scoreChoiceQuestion(question) {
  if (question.skipped) return 0;
  return Math.max(0, Math.min(Number(question.maxPoints || 1), Number(question.manualPoints || 0)));
}

function scoreOptionsForQuestion(question, locationSide = false) {
  const maxPoints = Number(question.maxPoints || 1);
  const step = locationSide && maxPoints <= 1 ?0.5 : 0.5;
  const values = [];
  for (let value = 0; value <= maxPoints + 0.001; value += step) {
    values.push(Math.round(value * 10) / 10);
  }
  return values;
}

function timedQuestionPoints(question) {
  const target = Number(question.targetSeconds || 0);
  const actual = Number(question.timeSeconds || 0);
  const max = Number(question.maxPoints || 10);
  if (!target || !actual) return Number(question.manualPoints || 0);
  if (actual <= target) return max;
  const overRatio = (actual - target) / target;
  return Math.max(0, Math.round((max * Math.max(0, 1 - overRatio)) * 10) / 10);
}

function formatSecondsInput(seconds) {
  const value = Number(seconds || 0);
  if (!value) return "";
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function secondsFromTimeInput(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  if (!text.includes(":")) return Number(text) || 0;
  const [minutes, seconds] = text.split(":").map((part) => Number(part) || 0);
  return minutes * 60 + seconds;
}

function renderEstExamPanel(department) {
  const candidates = state.users.filter((user) => !user.trainings?.EST);
  return `
    <div class="training-exam-layout department-overview-content est-dashboard">
      ${renderActiveTrainingExams("est", department)}
      <section class="panel training-exam-card compact-est-start est-create-panel">
        <div class="panel-header"><div><h3>Grundausbildung starten</h3><p class="muted">Prüfling auswählen und die Prüfung vorbereiten.</p></div></div>
        <div class="est-create-box">
          <label>Prüfling ohne Grundausbildung ${renderExamUserPicker("estCandidateInput", "estCandidateList", candidates, "Prüfling suchen und auswählen")}</label>
          <button class="blue-btn" id="startEstExam" type="button">Prüfung vorbereiten</button>
        </div>
      </section>
      ${renderTrainingExamArchive("est", department)}
    </div>
  `;
}

function estCompletedExamItems() {
  return trainingStore().activeExams
    .filter((exam) => exam.kind === "est" && exam.status === "Abgeschlossen")
    .sort((a, b) => new Date(b.completedAt || b.archivedAt || b.startedAt || 0) - new Date(a.completedAt || a.archivedAt || a.startedAt || 0));
}

function activeExamItems(kind) {
  return trainingStore().activeExams
    .filter((exam) => exam.kind === kind && !["Vorbereitung", "Abgeschlossen", "Archiviert"].includes(exam.status))
    .sort((a, b) => new Date(b.createdAt || b.startedAt || 0) - new Date(a.createdAt || a.startedAt || 0));
}

function examArchiveItems(kind) {
  return trainingStore().activeExams
    .filter((exam) => exam.kind === kind && ["Archiviert", "Abgeschlossen"].includes(exam.status))
    .sort((a, b) => new Date(b.archivedAt || b.startedAt || 0) - new Date(a.archivedAt || a.startedAt || 0));
}

function renderActiveTrainingExams(kind, department) {
  const activeRows = activeExamItems(kind);
  const canManage = departmentActionAllowed(department, "departmentLeadership");
  return `
    <section class="panel training-active-card">
      <div class="panel-header"><div><h3>Aktive Prüfungen</h3><p class="muted">${activeRows.length} gestartete oder pausierte Prüfungen</p></div></div>
      <div class="training-active-grid">
        ${activeRows.length ?activeRows.map((exam) => renderActiveTrainingExamRow(exam, canManage)).join("") : `<p class="muted">Keine aktive Prüfung vorhanden.</p>`}
      </div>
    </section>
  `;
}

function renderCompletedTrainingExams(department) {
  const completedRows = estCompletedExamItems();
  const canManage = departmentActionAllowed(department, "departmentLeadership");
  return `
    <section class="panel training-completed-card">
      <div class="panel-header"><div><h3>Abgeschlossene Grundausbildungen</h3><p class="muted">${completedRows.length} fertig ausgewertete Prüfungen</p></div></div>
      <div class="training-archive-list">
        ${completedRows.length ?completedRows.map((exam) => renderCompletedTrainingExamRow(exam, canManage)).join("") : `<p class="muted">Noch keine abgeschlossene Grundausbildung.</p>`}
      </div>
    </section>
  `;
}

function renderActiveTrainingExamRow(exam, canManage) {
  ensureExamModuleState(exam);
  const candidate = state.users.find((user) => user.id === exam.candidateId);
  const examiner = state.users.find((user) => user.id === exam.examinerId);
  const activeModule = currentManagedExamModule(exam);
  const completedCount = exam.modules.filter((module) => module.status === "Abgeschlossen").length;
  const moduleBadges = exam.modules.map((module) => {
    const tone = module.status === "Abgeschlossen" ?examModuleTone(module) : module.id === activeModule?.id ?"active" : "";
    return `<span class="training-module-pill ${tone}"><b>${escapeHtml(module.name)}</b><small>${escapeHtml(module.status || "Offen")}${module.result ?` · ${escapeHtml(module.result.percent)}%` : ""}</small></span>`;
  }).join("");
  return `
    <article class="training-active-exam-card">
      <div class="training-active-head">
        <div>
          <strong>${escapeHtml(candidate ?fullName(candidate) : "Unbekannter Prüfling")}</strong>
          <small>${exam.kind === "est" ?"Grundausbildung" : "Modul Prüfung"} · ${escapeHtml(exam.status)} · ${completedCount}/${exam.modules.length} Module</small>
        </div>
        <span class="status-pill ${exam.status === "Pausiert" ?"warn" : exam.status === "Modul bereit" ?"success" : ""}">${escapeHtml(exam.status)}</span>
      </div>
      <div class="training-active-meta">
        <span><b>Prüfer</b>${escapeHtml(examiner ?fullName(examiner) : "-")}</span>
        <span><b>Dauer</b><span class="exam-live-timer" data-started-at="${escapeHtml(exam.startedAt || "")}">${escapeHtml(examElapsedText(exam))}</span></span>
        <span><b>Aktuelles Modul</b>${escapeHtml(activeModule?.name || "Noch nicht gewählt")}</span>
      </div>
      <div class="training-module-pill-row">${moduleBadges}</div>
      <div class="training-active-actions">
        <button class="blue-btn training-exam-open" data-exam-id="${escapeHtml(exam.id)}" type="button">${exam.status === "Modul bereit" ?"Nächstes Modul starten" : "Öffnen"}</button>
        <button class="ghost-btn training-exam-pause" data-exam-id="${escapeHtml(exam.id)}" type="button">${exam.status === "Pausiert" ?"Fortsetzen" : "Pausieren"}</button>
        ${canManage ?`<button class="mini-icon danger training-exam-delete" data-exam-id="${escapeHtml(exam.id)}" type="button" title="Löschen">${actionIcon("delete")}</button>` : ""}
      </div>
    </article>
  `;
}

function renderCompletedTrainingExamRow(exam, canManage) {
  const candidate = state.users.find((user) => user.id === exam.candidateId);
  const result = exam.finalResult ?`${exam.finalResult.percent}% · ${exam.finalResult.points}/${exam.finalResult.total} Punkte` : "Ohne Ergebnis";
  return `
    <article class="training-archive-row completed-exam-row">
      <div>
        <strong>${escapeHtml(candidate ?fullName(candidate) : "Unbekannter Prüfling")}</strong>
        <small>Grundausbildung abgeschlossen · ${formatDateTime(exam.completedAt || exam.archivedAt || exam.startedAt)}</small>
      </div>
      <span><b>Ergebnis</b>${escapeHtml(result)}</span>
      <span><b>Status</b>${exam.finalResult?.percent >= 75 ?"Bestanden" : "Nicht bestanden"}</span>
      <div class="button-row">
        <button class="blue-btn training-exam-open" data-exam-id="${escapeHtml(exam.id)}" data-readonly="true" type="button">Verlauf öffnen</button>
        <button class="ghost-btn training-exam-archive" data-exam-id="${escapeHtml(exam.id)}" type="button">Archivieren</button>
        ${canManage ?`<button class="mini-icon danger training-exam-delete" data-exam-id="${escapeHtml(exam.id)}" type="button" title="Löschen">${actionIcon("delete")}</button>` : ""}
      </div>
    </article>
  `;
}

function renderExamModuleStepper(exam) {
  ensureExamModuleState(exam);
  return `
    <div class="exam-module-stepper">
      ${exam.modules.map((module) => {
        const tone = module.status === "Abgeschlossen" ?examModuleTone(module) : "";
        return `
          <button type="button" class="exam-module-tab ${exam.activeMainModuleId === module.id ?"active" : ""} ${tone}" data-start-module-id="${escapeHtml(module.id)}">
            <b>${escapeHtml(module.name)}</b>
            <small>${escapeHtml(module.status || "Offen")}${module.result ?` · ${escapeHtml(module.result.percent)}%` : ""}</small>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderCatalogQuestion(question, index, side = "main") {
  const maxPoints = Number(question.maxPoints || 1);
  const scoreValues = side === "location" ?[0, 0.5, 1] : [-1, 0, 0.5, 1, 1.5, 2].filter((value) => value <= maxPoints);
  if (side === "location" || question.type === "location") {
    return `
      <article class="exam-catalog-question location-question" data-question-id="${escapeHtml(question.id)}">
        <div class="catalog-question-grid location-score-left">
          <select class="score-select score-${String(question.manualPoints || 0).replace(".", "-")}" data-exam-score="${escapeHtml(question.id)}">${scoreValues.map((value) => `<option value="${value}" ${Number(question.manualPoints || 0) === value ?"selected" : ""}>${value}</option>`).join("")}</select>
          <div class="catalog-question-body">
            <div class="catalog-question-head"><b>${index + 1}. ${escapeHtml(question.prompt)}</b><small>Ortskunde</small></div>
            ${question.image ?`<img class="location-question-image" src="${escapeHtml(question.image)}" alt="">` : ""}
          </div>
        </div>
      </article>
    `;
  }
  if (question.type === "choice") {
    const answers = normalizeChoiceAnswers(question);
    return `
      <article class="exam-catalog-question" data-question-id="${escapeHtml(question.id)}">
        <div class="catalog-question-grid">
          <div class="catalog-question-body">
            <div class="catalog-question-head"><b>${index + 1}. ${escapeHtml(question.prompt)}</b><small>Max. ${escapeHtml(maxPoints)} Punkte</small></div>
            ${question.solution ?`<div class="inline-solution">Musterlösung: ${escapeHtml(question.solution)}</div>` : ""}
            <div class="exam-answer-list neutral">
              ${answers.map((answer) => `
                <label class="exam-check">
                  <input data-autosave-exam type="checkbox" name="answerOption_${escapeHtml(question.id)}" value="${escapeHtml(answer)}" ${question.selectedAnswers?.includes(answer) ?"checked" : ""}>
                  ${escapeHtml(answer)}
                </label>
              `).join("") || `<p class="muted">Keine Antwortmöglichkeiten hinterlegt.</p>`}
              <label class="exam-check muted-check">
                <input data-autosave-exam type="checkbox" name="questionSkipped_${escapeHtml(question.id)}" ${question.skipped ?"checked" : ""}>
                Leer gelassen / nicht beantwortet
              </label>
            </div>
            <div class="penalty-line">
              <span>Fehlerpunkte</span>
              <select data-exam-penalty="${escapeHtml(question.id)}">${[0, 1, 2, 3].map((value) => `<option value="${value}" ${Number(question.penaltyPoints || 0) === value ?"selected" : ""}>-${value}</option>`).join("")}</select>
            </div>
          </div>
          <select class="score-select score-${String(scoreChoiceQuestion(question)).replace(".", "-")}" disabled><option>${escapeHtml(scoreChoiceQuestion(question))}</option></select>
        </div>
      </article>
    `;
  }
  return `
    <article class="exam-catalog-question" data-question-id="${escapeHtml(question.id)}">
      <div class="catalog-question-grid">
        <div class="catalog-question-body">
          <div class="catalog-question-head"><b>${index + 1}. ${escapeHtml(question.prompt)}</b><small>Max. ${escapeHtml(maxPoints)} Punkte</small></div>
          ${question.solution ?`<div class="inline-solution">Musterlösung: ${escapeHtml(question.solution)}</div>` : ""}
          <label>Antwort des Prüflings<textarea data-autosave-exam data-exam-answer="${escapeHtml(question.id)}" placeholder="Antwort mitschreiben">${escapeHtml(question.traineeAnswer || "")}</textarea></label>
        </div>
        <select class="score-select score-${String(question.manualPoints || 0).replace(".", "-")}" data-exam-score="${escapeHtml(question.id)}">${scoreValues.map((value) => `<option value="${value}" ${Number(question.manualPoints || 0) === value ?"selected" : ""}>${value}</option>`).join("")}</select>
      </div>
    </article>
  `;
}

function renderExamModuleStepper(exam) {
  ensureExamModuleState(exam);
  const module = currentManagedExamModule(exam);
  return `<div class="exam-current-module-chip"><span>Aktuelles Modul</span><strong>${escapeHtml(module?.name || "-")}</strong><small>${escapeHtml(module?.status || exam.status || "-")}</small></div>`;
}

function renderCatalogQuestion(question, index, side = "main") {
  const maxPoints = Number(question.maxPoints || 1);
  const scoreValues = isLocationQuestion(question, side) ?[0, 0.5, 1] : [0, 0.5, 1, 1.5, 2].filter((value) => value <= maxPoints);
  const scoreClass = (value) => `score-select score-${String(value || 0).replace(".", "-")}`;
  const scoreBlock = (html) => `<div class="question-score-row"><span>Bewertung</span>${html}</div>`;
  if (isLocationQuestion(question, side)) {
    return `
      <article class="exam-catalog-question location-question" data-question-id="${escapeHtml(question.id)}">
        <div class="catalog-question-body"><div class="catalog-question-head"><b>${index + 1}. ${escapeHtml(question.prompt)}</b><small>Praxis</small></div>${question.image ?`<img class="location-question-image" src="${escapeHtml(question.image)}" alt="">` : ""}${question.targetSeconds ?`<label>Sollzeit<input data-exam-target="${escapeHtml(question.id)}" value="${escapeHtml(formatSecondsInput(question.targetSeconds))}" placeholder="MM:SS"></label><label>Gefahrene Zeit<input data-exam-time="${escapeHtml(question.id)}" value="${escapeHtml(formatSecondsInput(question.timeSeconds || 0))}" placeholder="MM:SS"></label>` : ""}</div>
        ${scoreBlock(`<select class="${scoreClass(question.manualPoints)}" data-exam-score="${escapeHtml(question.id)}">${scoreValues.map((value) => `<option value="${value}" ${Number(question.manualPoints || 0) === value ?"selected" : ""}>${String(value).replace(".", ",")}</option>`).join("")}</select>`)}
      </article>
    `;
  }
  if (question.type === "scenario") {
    return `
      <article class="exam-catalog-question scenario-runner-question" data-question-id="${escapeHtml(question.id)}">
        <div class="catalog-question-body">
          <div class="catalog-question-head"><b>${index + 1}. ${escapeHtml(question.prompt)}</b><small>Max. ${escapeHtml(maxPoints)} Punkte</small></div>
          <label>Antwort / Ablauf des Prüflings<textarea data-autosave-exam data-exam-answer="${escapeHtml(question.id)}" placeholder="Ablauf, Entscheidungen und Antworten mitschreiben">${escapeHtml(question.traineeAnswer || "")}</textarea></label>
          ${question.solution ?`<div class="inline-solution">Musterlösung: ${escapeHtml(question.solution)}</div>` : ""}
        </div>
        ${scoreBlock(`<select class="${scoreClass(question.manualPoints)}" data-exam-score="${escapeHtml(question.id)}">${scoreValues.map((value) => `<option value="${value}" ${Number(question.manualPoints || 0) === value ?"selected" : ""}>${String(value).replace(".", ",")}</option>`).join("")}</select>`)}
      </article>
    `;
  }
  if (question.type === "choice") {
    const answers = normalizeChoiceAnswers(question);
    return `
      <article class="exam-catalog-question compact-choice-question" data-question-id="${escapeHtml(question.id)}">
        <div class="catalog-question-body">
          <div class="catalog-question-head"><b>${index + 1}. ${escapeHtml(question.prompt)}</b><small>Max. ${escapeHtml(maxPoints)} Punkte</small></div>
          <div class="exam-answer-list neutral compact-answer-list">
            ${answers.map((answer) => `<label class="exam-check compact-answer-row"><span>${escapeHtml(answer)}</span><input data-autosave-exam type="checkbox" name="answerOption_${escapeHtml(question.id)}" value="${escapeHtml(answer)}" ${question.selectedAnswers?.includes(answer) ?"checked" : ""}></label>`).join("") || `<p class="muted">Keine Antwortmöglichkeiten hinterlegt.</p>`}
            <label class="exam-check compact-answer-row muted-check"><span>Leer gelassen / nicht beantwortet</span><input data-autosave-exam type="checkbox" name="questionSkipped_${escapeHtml(question.id)}" ${question.skipped ?"checked" : ""}></label>
          </div>
        </div>
        ${scoreBlock(`<span class="auto-score ${scoreClass(scoreChoiceQuestion(question))}">${String(scoreChoiceQuestion(question)).replace(".", ",")}</span><label class="penalty-line"><span>Fehlerpunkte</span><select data-exam-penalty="${escapeHtml(question.id)}">${[0, 1, 2, 3].map((value) => `<option value="${value}" ${Number(question.penaltyPoints || 0) === value ?"selected" : ""}>-${value}</option>`).join("")}</select></label>`)}
      </article>
    `;
  }
  return `
    <article class="exam-catalog-question" data-question-id="${escapeHtml(question.id)}">
      <div class="catalog-question-body">
        <div class="catalog-question-head"><b>${index + 1}. ${escapeHtml(question.prompt)}</b><small>Max. ${escapeHtml(maxPoints)} Punkte</small></div>
        <label>Antwort des Prüflings<textarea data-autosave-exam data-exam-answer="${escapeHtml(question.id)}" placeholder="Antwort mitschreiben">${escapeHtml(question.traineeAnswer || "")}</textarea></label>
        ${question.solution ?`<div class="inline-solution">Musterlösung: ${escapeHtml(question.solution)}</div>` : ""}
      </div>
      ${scoreBlock(`<select class="${scoreClass(question.manualPoints)}" data-exam-score="${escapeHtml(question.id)}">${scoreValues.map((value) => `<option value="${value}" ${Number(question.manualPoints || 0) === value ?"selected" : ""}>${String(value).replace(".", ",")}</option>`).join("")}</select>`)}
    </article>
  `;
}

function renderEstCatalogRunner(exam) {
  const mainModule = currentManagedExamModule(exam);
  const sideModules = estSideModulesForMain(exam, mainModule);
  const isHeliModule = mainModule?.id === "est-heli";
  const mainQuestions = isHeliModule ?(mainModule?.questions || []).filter((question) => question.stationType !== "combat") : (mainModule?.questions || []);
  const heliSideQuestions = isHeliModule ?(mainModule?.questions || []).filter((question) => question.stationType === "combat") : [];
  return `
    ${renderExamModuleStepper(exam)}
    <div class="est-runner-shell">
      <section class="est-runner-main ${mainModule?.status === "Abgeschlossen" ?examModuleTone(mainModule) : ""}">
        <div class="panel-header slim"><div><h3>${escapeHtml(mainModule?.name || "Hauptmodul")}</h3><p class="muted">Fragenkatalog links · alle Eingaben speichern automatisch.</p></div></div>
        <div class="exam-catalog-list">
          ${mainQuestions.map((question, index) => renderCatalogQuestion(question, index, isHeliModule ?"location" : "main")).join("") || `<p class="muted">Keine Fragen in diesem Modul.</p>`}
        </div>
      </section>
      <aside class="est-location-side">
        <div class="panel-header slim"><div><h3>${mainModule?.id === "est-scenario" ?"Szenario-Infos" : mainModule?.id === "est-heli" ?"Dachlandungen" : mainModule?.id === "est-rules" ?"Fahrstrecke" : "Praxis"}</h3><p class="muted">${sideModules.length || mainModule?.id === "est-scenario" || isHeliModule ?"Parallel zum aktuellen Modul." : "Dieses Modul läuft ohne parallele Praxisstrecke."}</p></div></div>
        ${mainModule?.id === "est-scenario" ?renderScenarioSidePanel(mainModule) : ""}
        ${isHeliModule ?`
          <section class="est-side-module ${mainModule.status === "Abgeschlossen" ?examModuleTone(mainModule) : ""}">
            <div class="catalog-question-head"><b>Dächer / Landepunkte</b><small>${escapeHtml(mainModule.status || "Offen")}</small></div>
            <div class="exam-catalog-list location-list">
              ${heliSideQuestions.map((question, index) => renderCatalogQuestion(question, index, "location")).join("") || `<p class="muted">Keine Dachlandungen hinterlegt.</p>`}
            </div>
          </section>
        ` : ""}
        ${!isHeliModule && sideModules.length ?sideModules.map((sideModule) => `
          <section class="est-side-module ${sideModule.status === "Abgeschlossen" ?examModuleTone(sideModule) : ""}">
            <div class="catalog-question-head"><b>${escapeHtml(sideModule.name)}</b><small>${escapeHtml(sideModule.status || "Offen")}</small></div>
            <div class="exam-catalog-list location-list">
              ${(sideModule.questions || []).map((question, index) => renderCatalogQuestion(question, index, "location")).join("") || `<p class="muted">Keine Einträge hinterlegt.</p>`}
            </div>
          </section>
        `).join("") : (!isHeliModule && mainModule?.id !== "est-scenario" ?`<p class="muted">Keine parallele Praxisstrecke in diesem Abschnitt.</p>` : "")}
      </aside>
    </div>
  `;
}

function renderScenarioSidePanel(module) {
  return `
    <section class="est-side-module scenario-side-module">
      ${(module?.questions || []).map((question, index) => `
        <article class="scenario-side-card">
          <div class="catalog-question-head"><b>${index + 1}. ${escapeHtml(question.prompt)}</b><small>Prüferbereich</small></div>
          <div class="scenario-info-box">
            <strong>Szenario Ablauf / Prüferinfos</strong>
            <p>${escapeHtml(question.scenarioInfo || "Noch keine Szenario-Infos im Leitungsbereich hinterlegt.")}</p>
          </div>
          <div class="scenario-info-box">
            <strong>Akte / Maßnahme</strong>
            <p>${escapeHtml(question.fileAction || "Noch keine Akte oder Maßnahme hinterlegt.")}</p>
          </div>
        </article>
      `).join("") || `<p class="muted">Keine Szenario-Einträge hinterlegt.</p>`}
    </section>
  `;
}

function renderNextModuleMenu(exam) {
  const modules = (exam.kind === "est" ?estMainModules(exam) : exam.modules).filter((module) => module.status !== "Abgeschlossen");
  return `
    <div class="next-module-menu hidden" id="nextModuleMenu">
      <strong>Modul auswählen</strong>
      ${modules.map((module) => `
        <button type="button" class="ghost-btn next-module-pick" data-module-id="${escapeHtml(module.id)}">
          ${escapeHtml(module.name)} <small>${escapeHtml(module.status || "Offen")}</small>
        </button>
      `).join("")}
    </div>
  `;
}

function renderModuleCatalogRunner(exam) {
  const module = currentManagedExamModule(exam);
  return `
    ${renderExamModuleStepper(exam)}
    <section class="exam-runner-card">
      <div class="panel-header slim"><div><h3>${escapeHtml(module?.name || "Modul")}</h3><p class="muted">Fragenkatalog · alle Eingaben speichern automatisch.</p></div></div>
      <div class="exam-catalog-list">
        ${(module?.questions || []).map((question, index) => renderCatalogQuestion(question, index, "main")).join("") || `<p class="muted">Keine Fragen in diesem Modul.</p>`}
      </div>
    </section>
  `;
}

function renderExamModuleStart(exam, candidate) {
  const modules = exam.kind === "est" ?estMainModules(exam).filter((module) => module.status !== "Abgeschlossen") : exam.modules.filter((module) => module.status !== "Abgeschlossen");
  return `
    ${renderExamModuleStepper(exam)}
    <section class="exam-runner-card exam-module-start-card compact-start">
      <span>Prüfung vorbereiten</span>
      <h4>${escapeHtml(candidate ?fullName(candidate) : "Unbekannter Prüfling")}</h4>
      <label>2. Prüfer optional<select id="examSetupSecondExaminer"><option value=""></option>${state.users.map((user) => `<option value="${user.id}" ${exam.secondExaminerId === user.id ?"selected" : ""}>${escapeHtml(fullName(user))}</option>`).join("")}</select></label>
      <div class="module-start-choice">
        <strong>Startmodul auswählen</strong>
        ${modules.map((module) => `<button type="button" class="ghost-btn ${exam.activeMainModuleId === module.id ?"selected" : ""}" data-start-module-id="${escapeHtml(module.id)}">${escapeHtml(module.name)}</button>`).join("") || `<p class="muted">Alle Module sind abgeschlossen.</p>`}
      </div>
      <p class="muted">Ortskunde, Helistrecke und Fahrstrecke laufen rechts parallel mit und werden separat bewertet.</p>
    </section>
  `;
}

function renderExamAnswerSummary(question) {
  if (question.type === "choice") {
    const selected = question.selectedAnswers || [];
    return `
      <small><b>Markiert:</b> ${escapeHtml(selected.join(", ") || "-")}</small>
      <small><b>Antwort / Notizen:</b> ${escapeHtml(question.traineeAnswer || "-")}</small>
      <small><b>Leer:</b> ${question.skipped ?"Ja" : "Nein"}</small>
    `;
  }
  if (question.type === "scenario") {
    return `
      <small><b>Szenario:</b> ${escapeHtml(question.scenarioInfo || "-")}</small>
      <small><b>Akte / Maßnahme:</b> ${escapeHtml(question.fileAction || "-")}</small>
      <small><b>Antwort / Ablauf:</b> ${escapeHtml(question.traineeAnswer || "-")}</small>
    `;
  }
  return `
    <small><b>Antwort Prüfling:</b> ${escapeHtml(question.traineeAnswer || "-")}</small>
    <small><b>Musterlösung:</b> ${escapeHtml(question.solution || "-")}</small>
  `;
}

function renderExamArchiveDetail(exam) {
  ensureExamModuleState(exam);
  return `
    <div class="exam-review-list archive-detail">
      ${exam.modules.map((module, moduleIndex) => {
        const points = module.result?.points ?? examModulePoints(module);
        const total = module.result?.total ?? examModuleTotal(module);
        const percent = module.result?.percent ?? examModulePercent(module);
        const tone = examModuleTone(module);
        return `
          <section class="exam-review-module archive-module-block ${tone}">
            <div class="archive-module-head">
              <h4>Modul ${moduleIndex + 1}: ${escapeHtml(module.name)}</h4>
              <span>${escapeHtml(percent)}% · ${escapeHtml(points)} / ${escapeHtml(total)} Punkte</span>
            </div>
            ${(module.questions || []).map((question, questionIndex) => `
              <div class="exam-review-row detailed archive-question-row">
                <span>
                  <b>${questionIndex + 1}. ${escapeHtml(question.prompt)}</b>
                  ${renderExamAnswerSummary(question)}
                </span>
                <strong>${escapeHtml(question.manualPoints ?? question.result?.points ?? 0)} / ${escapeHtml(question.maxPoints || 1)} Punkte</strong>
              </div>
            `).join("") || `<p class="muted">Keine Fragen gespeichert.</p>`}
          </section>
        `;
      }).join("")}
    </div>
  `;
}

function examProgressText(exam) {
  ensureExamModuleState(exam);
  const completed = exam.modules.filter((module) => module.status === "Abgeschlossen").length;
  return `${completed} von ${exam.modules.length} Modulen abgeschlossen`;
}

function finalizeExamIfComplete(exam) {
  ensureExamModuleState(exam);
  if (!exam.modules.length || !exam.modules.every((module) => module.status === "Abgeschlossen")) return false;
  const total = exam.modules.reduce((sum, module) => sum + examModuleTotal(module), 0);
  const points = exam.modules.reduce((sum, module) => sum + examModulePoints(module), 0);
  exam.finalResult = { total, points, percent: total ?Math.round((points / total) * 100) : 0 };
  exam.status = "Abgeschlossen";
  exam.completedAt = new Date().toISOString();
  return true;
}

function openTrainingExamModal(examId, readOnly = false) {
  const store = trainingStore();
  const exam = store.activeExams.find((item) => item.id === examId);
  if (!exam) return;
  ensureExamModuleState(exam);
  const candidate = state.users.find((user) => user.id === exam.candidateId);
  const archiveView = readOnly || exam.status === "Archiviert" || exam.status === "Abgeschlossen";
  const isSetup = !archiveView && (exam.status === "Vorbereitung" || exam.status === "Modul bereit" || !exam.activeMainModuleId);
  const isPaused = exam.status === "Pausiert";
  const mainModule = currentManagedExamModule(exam);
  const sideModules = estSideModules(exam);
  openModal(`
    <div class="exam-modal-head">
      <div><h3>${exam.kind === "est" ?"Grundausbildung" : "Modul Prüfung"}</h3><p class="muted">${escapeHtml(candidate ?fullName(candidate) : "Unbekannter Prüfling")} · ${escapeHtml(examProgressText(exam))}</p></div>
      ${!archiveView && !isSetup ?`<div class="exam-top-actions"><span class="pause-pill ${isPaused ?"paused" : ""}">${isPaused ?"Pausiert" : "Läuft"}</span><button class="ghost-btn" id="pauseExamRunner" type="button">${isPaused ?"Fortsetzen" : "Pausieren"}</button><button class="ghost-btn" id="saveExamRunner" type="button">Speichern</button></div>` : ""}
    </div>
    ${!archiveView && !isSetup ?`<div class="exam-runner-meta compact-meta"><label>2. Prüfer<select id="examSecondExaminer"><option value=""></option>${state.users.map((user) => `<option value="${user.id}" ${exam.secondExaminerId === user.id ?"selected" : ""}>${escapeHtml(fullName(user))}</option>`).join("")}</select></label><span><b>Dauer</b><i class="exam-live-timer" data-paused="${isPaused ?"true" : "false"}" data-started-at="${escapeHtml(exam.startedAt || "")}">${escapeHtml(examElapsedText(exam))}</i></span></div>` : ""}
    ${archiveView ?`
      ${exam.finalResult ?`<div class="exam-result-preview"><span><b>Gesamtergebnis</b>${exam.finalResult.points} von ${exam.finalResult.total} Punkten</span><span class="${exam.finalResult.percent >= 75 ?"result-pass" : "result-fail"}">${exam.finalResult.percent}% · ${exam.finalResult.percent >= 75 ?"Bestanden" : "Nicht bestanden"}</span></div>` : ""}
      ${renderExamArchiveDetail(exam)}
    ` : isSetup ?renderExamModuleStart(exam, candidate) : exam.kind === "est" ?renderEstCatalogRunner(exam) : renderModuleCatalogRunner(exam)}
    <div class="modal-actions">
      <button class="ghost-btn" id="closeExamRunner" type="button">${archiveView ?"Schließen" : "Schließen"}</button>
      ${isSetup ?`<button class="blue-btn" id="beginExamRunner" type="button">${exam.status === "Modul bereit" ?"Modul starten" : "Prüfung starten"}</button>` : ""}
      ${!archiveView && !isSetup && exam.status !== "Modul bereit" ?`<button class="blue-btn" id="finishMainModule" type="button">Modul abschließen</button>` : ""}
      ${!archiveView && !isSetup && exam.status === "Modul bereit" ?`<button class="blue-btn" id="startAnotherModule" type="button">Nächstes Modul starten</button>` : ""}
    </div>
    ${!archiveView && !isSetup ?renderNextModuleMenu(exam) : ""}
  `, (modal) => {
    modal.classList.add("exam-modal", "catalog-exam-modal");
    if (isSetup) modal.classList.add("setup-exam-modal");
    if (isSetup && exam.status === "Vorbereitung" && !exam.startedAt) {
      modalRoot.dataset.discardTrainingExamId = exam.id;
    } else {
      delete modalRoot.dataset.discardTrainingExamId;
    }
    const persist = (message = "") => {
      ensureExamModuleState(exam);
      saveActiveTrainingExam(exam);
      if (message) showNotify(message, "success");
    };
    const saveQuestionFromCard = (card) => {
      const questionId = card?.dataset.questionId;
      const module = exam.modules.find((item) => item.questions.some((question) => question.id === questionId));
      const question = module?.questions.find((item) => item.id === questionId);
      if (!question) return;
      if (question.type === "choice" || question.type === "scenario") {
        question.skipped = Boolean(card.querySelector(`[name='questionSkipped_${CSS.escape(question.id)}']`)?.checked);
        question.penaltyPoints = 0;
        question.questionPenalty = false;
        question.selectedAnswers = question.skipped ?[] : Array.from(card.querySelectorAll(`[name='answerOption_${CSS.escape(question.id)}']:checked`)).map((input) => input.value);
        const answer = card.querySelector(`[data-exam-answer='${CSS.escape(question.id)}']`);
        const score = card.querySelector(`[data-exam-score='${CSS.escape(question.id)}']`);
        if (answer) question.traineeAnswer = answer.value || "";
        if (score) question.manualPoints = Number(score.value);
        question.result = { points: question.manualPoints };
      } else {
        const answer = card.querySelector(`[data-exam-answer='${CSS.escape(question.id)}']`);
        const score = card.querySelector(`[data-exam-score='${CSS.escape(question.id)}']`);
        const time = card.querySelector(`[data-exam-time='${CSS.escape(question.id)}']`);
        const target = card.querySelector(`[data-exam-target='${CSS.escape(question.id)}']`);
        if (answer) question.traineeAnswer = answer.value || "";
        if (time) question.timeSeconds = secondsFromTimeInput(time.value);
        if (target) question.targetSeconds = secondsFromTimeInput(target.value);
        if (Number(question.maxPoints || 1) > 1 || question.targetSeconds) {
          question.manualPoints = timedQuestionPoints(question);
        } else if (score) {
          question.manualPoints = Number(score.value);
        }
        question.result = { points: question.manualPoints };
      }
      if (!exam.startedAt) exam.startedAt = new Date().toISOString();
      if (module.status === "Offen") module.status = "Laufend";
      if (!["Abgeschlossen", "Archiviert", "Pausiert"].includes(exam.status)) exam.status = "Laufend";
      saveActiveTrainingExam(exam);
    };
    const saveAll = () => {
      modal.querySelectorAll(".exam-catalog-question").forEach(saveQuestionFromCard);
      saveActiveTrainingExam(exam);
    };
    modal.querySelectorAll("[data-start-module-id]").forEach((button) => button.addEventListener("click", () => {
      const module = exam.modules.find((item) => item.id === button.dataset.startModuleId);
      if (!module || isEstLocationModule(module)) return;
      button.closest(".module-start-choice, .exam-module-stepper")?.querySelectorAll("[data-start-module-id]").forEach((item) => item.classList.toggle("selected", item === button));
      exam.activeMainModuleId = module.id;
      exam.moduleIndex = exam.modules.findIndex((item) => item.id === module.id);
      persist();
      if (!isSetup) openTrainingExamModal(exam.id);
    }));
    modal.querySelector("#examSecondExaminer")?.addEventListener("change", (event) => {
      exam.secondExaminerId = event.target.value;
      persist("2. Prüfer gespeichert.");
    });
    modal.querySelector("#beginExamRunner")?.addEventListener("click", () => {
      const selected = modal.querySelector(".module-start-choice .selected")?.dataset.startModuleId || exam.activeMainModuleId || modal.querySelector("[data-start-module-id]")?.dataset.startModuleId;
      if (!selected) {
        showNotify("Bitte zuerst ein Startmodul auswählen.", "error");
        return;
      }
      delete modalRoot.dataset.discardTrainingExamId;
      const module = exam.modules.find((item) => item.id === selected);
      exam.secondExaminerId = modal.querySelector("#examSetupSecondExaminer")?.value || "";
      exam.activeMainModuleId = selected;
      exam.moduleIndex = exam.modules.findIndex((item) => item.id === selected);
      exam.status = "Laufend";
      exam.startedAt = exam.startedAt || new Date().toISOString();
      exam.modules.forEach((item) => {
        if (item.id !== selected && item.status !== "Abgeschlossen") item.status = "Offen";
      });
      if (module) {
        module.status = "Laufend";
        module.startedAt = module.startedAt || new Date().toISOString();
      }
      persist("Prüfung gestartet.");
      openTrainingExamModal(exam.id);
      renderDepartmentPage(departmentByPage(state.page));
    });
    modal.querySelectorAll("[data-autosave-exam], [data-exam-score]").forEach((input) => {
      input.addEventListener(input.tagName === "TEXTAREA" ?"input" : "change", () => {
        if (input.matches("[data-exam-score]")) {
          input.className = `score-select score-${String(input.value || 0).replace(".", "-")}`;
        }
        saveQuestionFromCard(input.closest(".exam-catalog-question"));
      });
    });
    modal.querySelector("#saveExamRunner")?.addEventListener("click", () => {
      saveAll();
      showNotify("Prüfung gespeichert.", "success");
    });
    modal.querySelector("#pauseExamRunner")?.addEventListener("click", () => {
      saveAll();
      if (exam.status === "Pausiert") {
        exam.pausedTotalMs = Number(exam.pausedTotalMs || 0) + (Date.now() - new Date(exam.pausedAt || Date.now()).getTime());
        exam.pausedAt = "";
        exam.status = "Laufend";
        if (mainModule?.status !== "Abgeschlossen") mainModule.status = "Laufend";
        showNotify("Prüfung fortgesetzt.", "success");
      } else {
        exam.status = "Pausiert";
        exam.pausedAt = new Date().toISOString();
        showNotify("Prüfung pausiert.", "success");
      }
      saveActiveTrainingExam(exam);
      renderDepartmentPage(departmentByPage(state.page));
      openTrainingExamModal(exam.id);
    });
    modal.querySelector("#finishMainModule")?.addEventListener("click", () => {
      saveAll();
      if (mainModule) {
        mainModule.status = "Abgeschlossen";
        mainModule.completedAt = new Date().toISOString();
        mainModule.result = { total: examModuleTotal(mainModule), points: examModulePoints(mainModule), percent: examModulePercent(mainModule) };
      }
      const remainingMain = estMainModules(exam).some((module) => module.status !== "Abgeschlossen");
      if (exam.kind === "est") {
        estSideModulesForMain(exam, mainModule).forEach((sideModule) => {
          sideModule.status = "Abgeschlossen";
          sideModule.completedAt = sideModule.completedAt || new Date().toISOString();
          sideModule.result = { total: examModuleTotal(sideModule), points: examModulePoints(sideModule), percent: examModulePercent(sideModule) };
        });
      }
      if (!remainingMain && exam.kind === "est") {
        estSideModules(exam).forEach((sideModule) => {
          if (sideModule.status === "Abgeschlossen") return;
          sideModule.status = "Abgeschlossen";
          sideModule.completedAt = sideModule.completedAt || new Date().toISOString();
          sideModule.result = { total: examModuleTotal(sideModule), points: examModulePoints(sideModule), percent: examModulePercent(sideModule) };
        });
      }
      const completedAll = finalizeExamIfComplete(exam);
      if (!completedAll) {
        const next = estMainModules(exam).find((module) => module.status !== "Abgeschlossen");
        if (next) {
          exam.activeMainModuleId = next.id;
          exam.moduleIndex = exam.modules.findIndex((module) => module.id === next.id);
          exam.modules.forEach((module) => {
            if (module.status !== "Abgeschlossen") module.status = module.id === next.id ?"Offen" : "Offen";
          });
        }
        exam.status = "Modul bereit";
      }
      saveActiveTrainingExam(exam);
      renderDepartmentPage(departmentByPage(state.page));
      showNotify(completedAll ?"Grundausbildung vollständig abgeschlossen." : "Modul abgeschlossen.", "success");
      if (completedAll) {
        openTrainingExamModal(exam.id, true);
      } else {
        closeModal();
      }
    });
    modal.querySelector("#startAnotherModule")?.addEventListener("click", () => {
      modal.querySelector("#nextModuleMenu")?.classList.toggle("hidden");
    });
    modal.querySelectorAll(".next-module-pick").forEach((button) => button.addEventListener("click", () => {
      saveAll();
      if (mainModule && mainModule.status !== "Abgeschlossen") {
        mainModule.status = "Abgeschlossen";
        mainModule.completedAt = new Date().toISOString();
        mainModule.result = { total: examModuleTotal(mainModule), points: examModulePoints(mainModule), percent: examModulePercent(mainModule) };
        estSideModulesForMain(exam, mainModule).forEach((sideModule) => {
          sideModule.status = "Abgeschlossen";
          sideModule.completedAt = sideModule.completedAt || new Date().toISOString();
          sideModule.result = { total: examModuleTotal(sideModule), points: examModulePoints(sideModule), percent: examModulePercent(sideModule) };
        });
      }
      const completedAll = finalizeExamIfComplete(exam);
      if (!completedAll) {
        const next = exam.modules.find((module) => module.id === button.dataset.moduleId);
        if (next) {
          exam.activeMainModuleId = next.id;
          exam.moduleIndex = exam.modules.findIndex((module) => module.id === next.id);
          next.status = "Laufend";
          exam.status = "Laufend";
        } else {
          exam.status = "Modul bereit";
        }
      }
      saveActiveTrainingExam(exam);
      renderDepartmentPage(departmentByPage(state.page));
      showNotify(completedAll ?"Grundausbildung vollständig abgeschlossen." : "Modul abgeschlossen.", "success");
      openTrainingExamModal(exam.id, completedAll);
    }));
    modal.querySelector("#closeExamRunner")?.addEventListener("click", () => {
      if (!archiveView && !isSetup) saveAll();
      closeModal();
      renderDepartmentPage(departmentByPage(state.page));
      if (!archiveView && !isSetup) showNotify("Prüfung automatisch gespeichert.", "success");
    });
  });
}

function defaultInformationDocs() {
  return ["Interne Vorschriften", "Kleiderordnung", "Fahrzeugregelung"].map((title) => ({
    id: makeTrainingId("infodoc"),
    title,
    body: `## ${title}\n\nText kann hier gepflegt werden.`,
    updatedAt: new Date().toISOString(),
    updatedBy: fullName(state.currentUser || {})
  }));
}

function informationDocs() {
  const docs = state.settings.informationDocs || [];
  return docs.length ?docs : defaultInformationDocs();
}

function unreadInformationChanges() {
  const myId = state.currentUser?.id || "";
  return uniqueInformationDocChanges(state.settings.informationDocChanges || []).filter((change) => !(change.acknowledgedBy || []).includes(myId) && !(change.deletedBy || []).includes(myId));
}

function renderSanctionCatalogReadOnly() {
  const groups = groupedSanctionCatalog(sanctionCatalog());
  return `
    <div class="info-box full information-card sanction-catalog-public-card">
      <div class="department-modal-heading">
        <h4>Sanktionskatalog</h4>
        <span class="muted">Nur Ansicht · gepflegt durch die Personalabteilung</span>
      </div>
      <div class="sanction-public-groups">
        ${groups.map((group) => `
          <section class="sanction-public-group">
            <div class="sanction-public-head">
              <strong>${escapeHtml(group.category)}</strong>
              <small>${group.items.length} Einträge</small>
            </div>
            <div class="sanction-public-list">
              ${group.items.map((item) => `
                <article class="sanction-public-row">
                  <span>${escapeHtml(item.code || "-")}</span>
                  <strong>${escapeHtml(item.title || "Ohne Titel")}</strong>
                  <small>${escapeHtml(item.fineText || item.action || "-")}</small>
                  ${item.action ?`<em>${escapeHtml(item.action)}</em>` : ""}
                </article>
              `).join("")}
            </div>
          </section>
        `).join("")}
      </div>
    </div>
  `;
}

function sanctionCatalogDisplayAction(item = {}) {
  const action = String(item.action || "").trim();
  if (/verwarnung/i.test(action) || Number(item.strikeCount || 0) > 0 || item.sanctionType === "Strike") return "Strike";
  return action || "-";
}

function renderSanctionCatalogDocument(searchTerm = "") {
  const needle = String(searchTerm || "").trim().toLowerCase();
  const groups = groupedSanctionCatalog(sanctionCatalog())
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const haystack = `${group.category} ${item.code || ""} ${item.title || ""} ${item.details || ""} ${item.fineText || ""} ${sanctionCatalogDisplayAction(item)}`.toLowerCase();
        return !needle || haystack.includes(needle);
      })
    }))
    .filter((group) => group.items.length);
  return `
    <div class="sanction-doc-view">
      <div class="sanction-doc-toolbar">
        <input id="sanctionCatalogDocSearch" value="${escapeHtml(searchTerm)}" placeholder="Sanktionskatalog durchsuchen, z.B. Funk, §1 Abs. 8 oder Strike">
        <span>${groups.reduce((sum, group) => sum + group.items.length, 0)} Treffer</span>
      </div>
      <div class="sanction-doc-table-wrap">
        ${groups.map((group) => `
          <section class="sanction-doc-group">
            <h4>${escapeHtml(group.category)}</h4>
            <table class="sanction-doc-table">
              <thead><tr><th>Paragraph</th><th>Tatbestand</th><th>Strafrahmen</th><th>Maßnahme</th></tr></thead>
              <tbody>
                ${group.items.map((item) => `
                  <tr>
                    <td>${escapeHtml(item.code || "-")}</td>
                    <td><strong>${escapeHtml(item.title || "Ohne Titel")}</strong>${item.details ?`<small>${escapeHtml(String(item.details).replace(`${item.code || ""} - ${item.title || ""}`, "").replace(/Strafrahmen:.*/g, "").replace(/Maßnahme:.*/g, "").trim())}</small>` : ""}</td>
                    <td>${escapeHtml(item.fineText || (Number(item.amount || 0) ?`${Number(item.amount).toLocaleString("de-DE")} $` : "-"))}</td>
                    <td><span class="sanction-doc-action">${escapeHtml(sanctionCatalogDisplayAction(item))}</span></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </section>
        `).join("") || `<p class="muted">Keine Einträge gefunden.</p>`}
      </div>
    </div>
  `;
}

function openSanctionCatalogDocument() {
  openModal(`
    <div class="paper-doc-modal sanction-doc-modal">
      <div class="paper-doc-head">
        <h3>Sanktionskatalog</h3>
      </div>
      <article class="paper-doc-page" id="sanctionCatalogDoc">${renderSanctionCatalogDocument()}</article>
    </div>
  `, (modal) => {
    modal.classList.add("wide-doc-modal");
    const bindSearch = () => {
      const input = modal.querySelector("#sanctionCatalogDocSearch");
      input?.addEventListener("input", () => {
        modal.querySelector("#sanctionCatalogDoc").innerHTML = renderSanctionCatalogDocument(input.value);
        bindSearch();
        const next = modal.querySelector("#sanctionCatalogDocSearch");
        next?.focus();
        next?.setSelectionRange(next.value.length, next.value.length);
      });
    };
    bindSearch();
  });
}

function renderInformation() {
  const links = state.settings.informationLinks || [];
  const docs = informationDocs();
  const changes = state.settings.informationDocChanges || [];
  const showLinks = state.settings?.hideInformationLinksCard === false;
  content.innerHTML = `
    <section class="department-info-view information-admin-view modern-info-view">
      ${showLinks ?`
      <div class="info-box full information-card redirects-card">
        <div class="department-modal-heading">
          <h4>Link Weiterleitungen</h4>
          ${canAccess("actions", "manageInformation", "Direktion") ?`<button class="blue-btn" id="addInformationLink">${iconSvg("Plus")} Hinzufügen</button>` : ""}
        </div>
        <div class="link-card-grid">${links.map((link) => `
          <article class="small-link-card">
            <strong>${escapeHtml(link.title)}</strong>
            <span class="link-label">Link:</span>
            <a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.url)}</a>
            ${canAccess("actions", "manageInformation", "Direktion") ?`<span class="button-row"><button class="blue-btn compact-action edit-info-link" data-id="${link.id}" title="Bearbeiten">${actionIcon("edit")} Bearbeiten</button><button class="mini-icon danger delete-info-link" data-id="${link.id}" title="Löschen">${actionIcon("delete")}</button></span>` : ""}
          </article>
        `).join("") || `<p class="muted">Noch keine Weiterleitungen.</p>`}</div>
      </div>
      ` : ""}
      <div class="info-box full information-card internal-doc-card">
        <div class="department-modal-heading">
          <h4>Dokumente</h4>
          ${canAccess("actions", "manageInformation", "Direktion") ?`<button class="blue-btn" id="addInformationDoc">${iconSvg("Plus")} Neue Vorschrift erstellen</button>` : ""}
        </div>
        <div class="internal-doc-grid">
          <button class="internal-doc-tile sanction-catalog-doc-tile" id="openSanctionCatalogDoc" type="button">
            <strong>Sanktionskatalog</strong>
            <small>Strikes, Geldstrafen und Maßnahmen als Tabelle</small>
          </button>
          ${docs.map((doc) => `
          <button class="internal-doc-tile" data-doc-id="${escapeHtml(doc.id)}">
            <strong>${escapeHtml(doc.title)}</strong>
            <small>Zuletzt geändert: ${formatDateTime(doc.updatedAt)}${doc.updatedBy ?` · von ${escapeHtml(doc.updatedBy)}` : ""}</small>
          </button>
        `).join("")}</div>
      </div>
      <div class="info-box full information-card">
        <div class="department-modal-heading"><h4>Changelog</h4></div>
        <div class="info-change-list">${changes.slice(0, 12).map((change) => `
          <article class="info-change-row">
            <strong>${escapeHtml(change.title || "Dokument")}</strong>
            <small>${escapeHtml(change.author || "-")} · ${formatDateTime(change.createdAt)}</small>
            <div><del>${escapeHtml(change.before || "-")}</del><ins>${escapeHtml(change.after || "-")}</ins></div>
          </article>
        `).join("") || `<p class="muted">Noch keine Änderungen.</p>`}</div>
      </div>
    </section>
  `;
  $("#addInformationLink")?.addEventListener("click", () => openInformationLinkModal());
  $("#addInformationDoc")?.addEventListener("click", () => openInformationDocCreateTypeModal());
  $("#openSanctionCatalogDoc")?.addEventListener("click", openSanctionCatalogDocument);
  document.querySelectorAll(".edit-info-link").forEach((button) => button.addEventListener("click", () => openInformationLinkModal(links.find((item) => item.id === button.dataset.id))));
  document.querySelectorAll(".delete-info-link").forEach((button) => button.addEventListener("click", () => deleteInformationItem("informationLinks", button.dataset.id)));
  document.querySelectorAll(".internal-doc-tile").forEach((button) => button.addEventListener("click", () => openInformationDocView(button.dataset.docId)));
}

function formatInformationDocText(text) {
  return formatDepartmentText(text || "");
}

function openInformationDocView(docId) {
  const docs = informationDocs();
  const doc = docs.find((item) => item.id === docId);
  if (!doc) return;
  const canEdit = canAccess("actions", "manageInformation", "Direktion");
  openModal(`
    <div class="paper-doc-modal">
      <div class="paper-doc-head">
        <h3>${escapeHtml(doc.title)}</h3>
        <input id="docSearchInput" placeholder="Im Dokument suchen">
        ${canEdit ?`<button class="blue-btn" id="editInformationDoc">${actionIcon("edit")} Bearbeiten</button>` : ""}
      </div>
      <article class="paper-doc-page" id="paperDocPage">${formatInformationDocText(doc.body)}</article>
    </div>
  `, (modal) => {
    modal.classList.add("wide-doc-modal");
    modal.querySelector("#docSearchInput")?.addEventListener("input", (event) => {
      const term = event.target.value.trim().toLowerCase();
      modal.querySelectorAll("#paperDocPage *").forEach((node) => node.classList.toggle("search-hit", term && node.textContent.toLowerCase().includes(term)));
    });
    modal.querySelector("#editInformationDoc")?.addEventListener("click", () => openInformationDocModal(doc));
  });
}

function openInformationDocModal(doc = null) {
  openModal(`
    <h3>${doc ?"Internes Dokument bearbeiten" : "Internes Dokument erstellen"}</h3>
    <label>Titel<input id="informationDocTitle" value="${escapeHtml(doc?.title || "")}"></label>
    <div class="format-toolbar"><button type="button" data-format="## ">Überschrift</button><button type="button" data-format="**fett**">Fett</button><button type="button" data-format="<span style='color:#75ffad'>Grün</span>">Grün</button><button type="button" data-format="<span style='color:#ff9ca0'>Rot</span>">Rot</button></div>
    <label>Text<textarea id="informationDocBody" rows="14">${escapeHtml(doc?.body || "")}</textarea></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions"><button class="ghost-btn" data-close>Abbrechen</button><button class="blue-btn" id="saveInformationDoc">Speichern</button></div>
  `, (modal) => {
    modal.querySelectorAll("[data-format]").forEach((button) => button.addEventListener("click", () => {
      const area = modal.querySelector("#informationDocBody");
      const value = button.dataset.format;
      area.setRangeText(value, area.selectionStart, area.selectionEnd, "end");
      area.focus();
    }));
    modal.querySelector("#saveInformationDoc").addEventListener("click", async () => {
      try {
        const title = modal.querySelector("#informationDocTitle").value.trim();
        const body = modal.querySelector("#informationDocBody").value;
        if (!title) throw new Error("Titel ist erforderlich.");
        const before = doc?.body || "";
        const nextDoc = { id: doc?.id || makeTrainingId("infodoc"), title, body, updatedAt: new Date().toISOString(), updatedBy: fullName(state.currentUser) };
        const docs = upsertById(informationDocs(), nextDoc);
        const hasBodyChange = normalizeInformationDocForCompare(before) !== normalizeInformationDocForCompare(body);
        const changes = !hasBodyChange ?(state.settings.informationDocChanges || []) : [{ id: makeTrainingId("docchange"), docId: nextDoc.id, title, before, after: body, action: doc ?"geändert" : "erstellt", createdAt: new Date().toISOString(), author: fullName(state.currentUser), acknowledgedBy: [] }, ...(state.settings.informationDocChanges || [])];
        await saveInformationPatch({ informationDocs: docs, informationDocChanges: changes });
        openInformationDocView(nextDoc.id);
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

function isInformationDocHtml(text = "") {
  return /<\/?(section|article|div|p|h[1-6]|span|strong|em|u|ul|ol|li|br|font|a|img|figure|figcaption)\b/i.test(String(text || ""));
}

function sanitizeInformationDocHtml(html = "") {
  const template = document.createElement("template");
  template.innerHTML = html || "";
  template.content.querySelectorAll("script, iframe, object, embed, link, meta, style").forEach((node) => node.remove());
  template.content.querySelectorAll("mark.doc-search-mark").forEach((node) => node.replaceWith(document.createTextNode(node.textContent || "")));
  template.content.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value || "";
      if (name.startsWith("on")) node.removeAttribute(attribute.name);
      if (["href", "src"].includes(name) && /^\s*javascript:/i.test(value)) node.removeAttribute(attribute.name);
      if (name === "style" && /expression|url\s*\(|javascript:/i.test(value)) node.removeAttribute(attribute.name);
    });
  });
  return template.innerHTML;
}

function formatInformationDocText(text = "", searchTerm = "") {
  if (isStructuredRegulationsBody(text)) return renderStructuredRegulationsView(text);
  if (isVehicleRegulationsBody(text)) return renderVehicleRegulationsView(text);
  if (isInformationDocHtml(text)) return sanitizeInformationDocHtml(text);
  if (!String(text || "").trim()) return "";
  let escaped = escapeHtml(text || "");
  const term = String(searchTerm || "").trim();
  if (term) {
    const safeTerm = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    escaped = escaped.replace(new RegExp(`(${safeTerm})`, "gi"), `<mark class="doc-search-mark">$1</mark>`);
  }
  return escaped
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/^### (.*)$/gm, "<h4>$1</h4>")
    .replace(/^## (.*)$/gm, "<h3>$1</h3>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br>")
    .replace(/^(.+)$/s, "<p>$1</p>");
}

function normalizedInformationTitle(value = "") {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
}

function isVehicleRegulationsDoc(doc = {}) {
  return normalizedInformationTitle(doc.title).startsWith("fahrzeugregel");
}

function isVehicleRegulationsBody(body = "") {
  return String(body || "").trimStart().startsWith("LSPD_VEHICLE_RULES:");
}

function isStructuredRegulationsBody(body = "") {
  return String(body || "").trimStart().startsWith("LSPD_STRUCTURED_RULES:");
}

function structuredRegulationsPayload(body = "") {
  const text = String(body || "").trimStart();
  return text.startsWith("LSPD_STRUCTURED_RULES:") ?text.slice("LSPD_STRUCTURED_RULES:".length) : "";
}

function parseStructuredRegulations(body = "") {
  if (!isStructuredRegulationsBody(body)) return { headerTitle: "", headerText: "", items: [] };
  try {
    const data = JSON.parse(structuredRegulationsPayload(body));
    return {
      headerTitle: String(data.headerTitle || "").trim(),
      headerText: String(data.headerText || "").trim(),
      items: (Array.isArray(data.items) ?data.items : []).map((item) => ({
        id: String(item.id || makeTrainingId("rule")),
        image: String(item.image || ""),
        title: String(item.title || "").trim(),
        data: String(item.data || "").trim(),
        info: String(item.info || "").trim()
      })).filter((item) => item.image || item.title || item.data || item.info)
    };
  } catch {
    return { headerTitle: "", headerText: "", items: [] };
  }
}

function serializeStructuredRegulations(data = {}) {
  const items = (Array.isArray(data.items) ?data.items : []).map((item) => ({
    id: String(item.id || makeTrainingId("rule")),
    image: String(item.image || ""),
    title: String(item.title || "").trim(),
    data: String(item.data || "").trim(),
    info: String(item.info || "").trim()
  })).filter((item) => item.image || item.title || item.data || item.info);
  return `LSPD_STRUCTURED_RULES:${JSON.stringify({
    headerTitle: String(data.headerTitle || "").trim(),
    headerText: String(data.headerText || "").trim(),
    items
  })}`;
}

function vehicleRegulationsPayload(body = "") {
  const text = String(body || "").trimStart();
  return text.startsWith("LSPD_VEHICLE_RULES:") ?text.slice("LSPD_VEHICLE_RULES:".length) : "";
}

function parseVehicleRegulations(body = "") {
  if (!isVehicleRegulationsBody(body)) return [];
  try {
    const data = JSON.parse(vehicleRegulationsPayload(body));
    return (Array.isArray(data.vehicles) ?data.vehicles : []).map((item) => ({
      id: String(item.id || makeTrainingId("vehicle")),
      image: String(item.image || ""),
      name: String(item.name || "").trim(),
      rank: String(item.rank || "").trim(),
      info: String(item.info || "").trim()
    })).filter((item) => item.image || item.name || item.rank || item.info);
  } catch {
    return [];
  }
}

function serializeVehicleRegulations(vehicles = []) {
  return `LSPD_VEHICLE_RULES:${JSON.stringify({ vehicles: vehicles.map((item) => ({
    id: String(item.id || makeTrainingId("vehicle")),
    image: String(item.image || ""),
    name: String(item.name || "").trim(),
    rank: String(item.rank || "").trim(),
    info: String(item.info || "").trim()
  })).filter((item) => item.image || item.name || item.rank || item.info) })}`;
}

function renderVehicleRegulationsView(body = "") {
  const vehicles = parseVehicleRegulations(body);
  return `
    <div class="vehicle-rules-view">
      <div class="vehicle-rules-notice">
        <strong>Wichtiger Hinweis</strong>
        <span>Unmarked / Zivil Fahrzeuge sind ausschließlich für das Detective Bureau freigegeben.</span>
      </div>
      ${vehicles.length ?vehicles.map((vehicle) => `
        <article class="vehicle-rule-card">
          <figure>${vehicle.image ?`<img src="${escapeHtml(vehicle.image)}" alt="${escapeHtml(vehicle.name || "Fahrzeug")}">` : `<span>Kein Bild</span>`}</figure>
          <div>
            <span class="vehicle-rule-kicker">Fahrzeug</span>
            <h4>${escapeHtml(vehicle.name || "Unbenanntes Fahrzeug")}</h4>
            <p><b>Freigegeben ab</b><span>${escapeHtml(vehicle.rank || "-")}</span></p>
            ${vehicle.info ?`<div class="vehicle-rule-info"><b>Zusatzinfo</b><span>${linkifyText(vehicle.info)}</span></div>` : ""}
          </div>
        </article>
      `).join("") : `<div class="vehicle-rules-empty">Noch keine Fahrzeugregelungen eingetragen.</div>`}
    </div>
  `;
}

function renderVehicleRegulationsEditor(body = "") {
  const vehicles = parseVehicleRegulations(body);
  const rows = vehicles.length ?vehicles : [{ id: makeTrainingId("vehicle"), image: "", name: "", rank: "", info: "" }];
  return `
    <div class="vehicle-rules-editor" id="vehicleRulesEditor">
      <div class="vehicle-rules-editor-head">
        <div>
          <strong>Fahrzeugregelungen</strong>
          <small>Bild links, Name, Rangfreigabe und Zusatzinfo rechts. Bilder werden automatisch verkleinert.</small>
        </div>
        <button class="blue-btn compact-action" type="button" id="addVehicleRule">${iconSvg("Plus")} Fahrzeug hinzufügen</button>
      </div>
      <div class="vehicle-rules-editor-note">
        <strong>Allgemeiner Hinweis</strong>
        <span>Unmarked / Zivil Fahrzeuge sind ausschließlich für das Detective Bureau freigegeben.</span>
      </div>
      <div class="vehicle-rule-list" id="vehicleRuleList">
        ${rows.map(renderVehicleRuleEditorRow).join("")}
      </div>
    </div>
  `;
}

function renderVehicleRuleEditorRow(vehicle) {
  const id = escapeHtml(vehicle.id || makeTrainingId("vehicle"));
  return `
    <article class="vehicle-rule-edit-row" data-vehicle-id="${id}">
      <label class="vehicle-image-drop">
        <input class="vehicle-rule-image-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif">
        <span class="vehicle-image-preview">${vehicle.image ?`<img src="${escapeHtml(vehicle.image)}" alt="">` : `${iconSvg("Plus")} Bild hochladen`}</span>
      </label>
      <div class="vehicle-rule-fields">
        <label>Name des Fahrzeugs<input class="vehicle-rule-name" value="${escapeHtml(vehicle.name || "")}" placeholder="z.B. Police Buffalo STX"></label>
        <label>Freigegeben ab Rang<input class="vehicle-rule-rank" value="${escapeHtml(vehicle.rank || "")}" placeholder="z.B. Rang 4 / Officer III"></label>
        <label class="vehicle-rule-info-field">Zusatzinfo<textarea class="vehicle-rule-extra" rows="3" placeholder="z.B. nur mit Freigabe, nur Detective Bureau, Besonderheiten...">${escapeHtml(vehicle.info || "")}</textarea></label>
      </div>
      <button class="mini-icon danger remove-vehicle-rule" type="button" title="Fahrzeug entfernen">${actionIcon("delete")}</button>
      <input class="vehicle-rule-image" type="hidden" value="${escapeHtml(vehicle.image || "")}">
    </article>
  `;
}

function renderStructuredRegulationsView(body = "") {
  const data = parseStructuredRegulations(body);
  return `
    <div class="structured-rules-view">
      ${(data.headerTitle || data.headerText) ?`
        <div class="structured-rules-header">
          ${data.headerTitle ?`<strong>${escapeHtml(data.headerTitle)}</strong>` : ""}
          ${data.headerText ?`<span>${linkifyText(data.headerText)}</span>` : ""}
        </div>
      ` : ""}
      ${data.items.length ?data.items.map((item) => `
        <article class="structured-rule-card">
          ${item.image ?`<figure><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title || "Vorschrift")}"></figure>` : ""}
          <div class="structured-rule-content">
            ${item.title ?`<h4>${escapeHtml(item.title)}</h4>` : ""}
            ${item.data ?`<div class="structured-rule-data">${linkifyText(item.data)}</div>` : ""}
            ${item.info ?`<div class="structured-rule-info"><b>Zusatzinfo</b><span>${linkifyText(item.info)}</span></div>` : ""}
          </div>
        </article>
      `).join("") : `<div class="vehicle-rules-empty">Noch keine Einträge in dieser Vorschrift.</div>`}
    </div>
  `;
}

function renderStructuredRegulationsEditor(body = "") {
  const data = parseStructuredRegulations(body);
  const rows = data.items.length ?data.items : [{ id: makeTrainingId("rule"), image: "", title: "", data: "", info: "" }];
  return `
    <div class="structured-rules-editor" id="structuredRulesEditor">
      <div class="vehicle-rules-editor-head">
        <div>
          <strong>Vorschriften-Menü</strong>
          <small>Optionaler Header, Einträge mit Bild, Daten rechts und Zusatzinfos.</small>
        </div>
        <button class="blue-btn compact-action" type="button" id="addStructuredRule">${iconSvg("Plus")} Eintrag hinzufügen</button>
      </div>
      <div class="structured-rules-header-editor">
        <label>Optionaler Header<input id="structuredRulesHeaderTitle" value="${escapeHtml(data.headerTitle || "")}" placeholder="z.B. Allgemeine Vorschrift"></label>
        <label>Optionaler Hinweis<textarea id="structuredRulesHeaderText" rows="3" placeholder="Zusätzliche Beschreibung oder Hinweise...">${escapeHtml(data.headerText || "")}</textarea></label>
      </div>
      <div class="structured-rule-list" id="structuredRuleList">
        ${rows.map(renderStructuredRuleEditorRow).join("")}
      </div>
    </div>
  `;
}

function renderStructuredRuleEditorRow(item) {
  const id = escapeHtml(item.id || makeTrainingId("rule"));
  return `
    <article class="structured-rule-edit-row" data-rule-id="${id}">
      <label class="vehicle-image-drop structured-image-drop">
        <input class="structured-rule-image-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif">
        <span class="vehicle-image-preview">${item.image ?`<img src="${escapeHtml(item.image)}" alt="">` : `${iconSvg("Plus")} Bild hochladen`}</span>
      </label>
      <div class="structured-rule-fields">
        <label>Titel / Bereich<input class="structured-rule-title" value="${escapeHtml(item.title || "")}" placeholder="z.B. Regelbereich, Fahrzeug, Ausrüstung..."></label>
        <label>Daten rechts<textarea class="structured-rule-data" rows="4" placeholder="Wichtige Daten, Stichpunkte, Links oder Freigaben...">${escapeHtml(item.data || "")}</textarea></label>
        <label>Optionale Zusatzinfos<textarea class="structured-rule-extra" rows="3" placeholder="Weitere Hinweise, Ausnahmen oder ergänzende Informationen...">${escapeHtml(item.info || "")}</textarea></label>
      </div>
      <button class="mini-icon danger remove-structured-rule" type="button" title="Eintrag entfernen">${actionIcon("delete")}</button>
      <input class="structured-rule-image" type="hidden" value="${escapeHtml(item.image || "")}">
    </article>
  `;
}

function normalizeInformationDocForCompare(value = "") {
  return informationDocTextLines(value).join("\n").replace(/\s+/g, " ").trim();
}

function isNoopInformationChange(change) {
  if (!change) return true;
  return normalizeInformationDocForCompare(change.before || "") === normalizeInformationDocForCompare(change.after || "");
}

function informationDocChangesFor(docId) {
  return uniqueInformationDocChanges(state.settings.informationDocChanges || []).filter((change) => change.docId === docId);
}

function plainInformationDocText(value = "") {
  return informationDocTextLines(value).join("\n");
}

function informationDocTextLines(value = "") {
  const template = document.createElement("template");
  template.innerHTML = formatInformationDocText(value);
  template.content.querySelectorAll("script, style").forEach((node) => node.remove());
  const lines = [];
  const push = (text) => {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (clean) lines.push(clean);
  };
  const blockSelector = "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,td,th,section,article,div";
  const blocks = [...template.content.querySelectorAll(blockSelector)]
    .filter((node) => !node.querySelector(blockSelector));
  if (blocks.length) blocks.forEach((node) => push(node.textContent));
  else push(template.content.textContent || "");
  return lines;
}

function informationChangeDiff(before = "", after = "") {
  const beforeLines = plainInformationDocText(before).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const afterLines = plainInformationDocText(after).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const afterPool = new Map();
  afterLines.forEach((line) => afterPool.set(line, (afterPool.get(line) || 0) + 1));
  const removed = [];
  beforeLines.forEach((line) => {
    const count = afterPool.get(line) || 0;
    if (count) afterPool.set(line, count - 1);
    else removed.push(line);
  });
  const beforePool = new Map();
  beforeLines.forEach((line) => beforePool.set(line, (beforePool.get(line) || 0) + 1));
  const added = [];
  afterLines.forEach((line) => {
    const count = beforePool.get(line) || 0;
    if (count) beforePool.set(line, count - 1);
    else added.push(line);
  });
  return { added, removed };
}

function renderInformationChangeDiff(change) {
  if (isStructuredRegulationsBody(change.after || "") || isStructuredRegulationsBody(change.before || "")) {
    return `
      <div class="doc-change-diff ${isInformationHighlightCleared(change) ?"cleared" : ""}">
        ${isInformationHighlightCleared(change) ?`<p class="muted">Hervorhebung entfernt${change.highlightClearedBy ?` von ${escapeHtml(change.highlightClearedBy)}` : ""}${change.highlightClearedAt ?` am ${formatDateTime(change.highlightClearedAt)}` : ""}.</p>` : ""}
        <ins>Strukturierte Vorschrift wurde aktualisiert.</ins>
      </div>
    `;
  }
  if (isVehicleRegulationsBody(change.after || "") || isVehicleRegulationsBody(change.before || "")) {
    return `
      <div class="doc-change-diff ${isInformationHighlightCleared(change) ?"cleared" : ""}">
        ${isInformationHighlightCleared(change) ?`<p class="muted">Hervorhebung entfernt${change.highlightClearedBy ?` von ${escapeHtml(change.highlightClearedBy)}` : ""}${change.highlightClearedAt ?` am ${formatDateTime(change.highlightClearedAt)}` : ""}.</p>` : ""}
        <ins>Fahrzeugregelungen wurden aktualisiert.</ins>
      </div>
    `;
  }
  const diff = informationChangeDiff(change.before || "", change.after || "");
  if (!diff.added.length && !diff.removed.length) {
    return `<p class="muted">Keine Textänderung erkannt.</p>`;
  }
  const cleared = isInformationHighlightCleared(change);
  return `
    <div class="doc-change-diff ${cleared ?"cleared" : ""}">
      ${cleared ?`<p class="muted">Hervorhebung entfernt${change.highlightClearedBy ?` von ${escapeHtml(change.highlightClearedBy)}` : ""}${change.highlightClearedAt ?` am ${formatDateTime(change.highlightClearedAt)}` : ""}. Die Änderung bleibt im Changelog erhalten.</p>` : ""}
      ${diff.removed.map((line) => `<del>${escapeHtml(line)}</del>`).join("")}
      ${diff.added.map((line) => `<ins>${escapeHtml(line)}</ins>`).join("")}
    </div>
  `;
}

function renderTrainingModuleGrantPanel(department) {
  const canGrant = departmentActionAllowed(department, "departmentModuleGrant");
  const canRevoke = departmentActionAllowed(department, "departmentModuleRevoke");
  const searchValue = localStorage.getItem("lspd_training_module_grant_search") || "";
  const searchTerm = searchValue.trim();
  const users = (state.users || []).filter((user) => {
    const roleText = `${user.role || ""} ${user.baseRole || ""}`;
    return !user.terminated && !isFrakverwaltungUser(user) && !/direktion/i.test(roleText);
  }).filter((user) => {
    const haystack = `${fullName(user)} ${user.dn || ""} ${rankLabel(user.rank)} ${visibleTrainings().filter((training) => user.trainings?.[training]).map(trainingDisplayName).join(" ")}`;
    return smartSearchMatch(haystack, searchTerm);
  });
  return `
    <div class="panel department-overview-content">
      <div class="panel-header"><div><h3>Modulvergabe</h3><p class="muted">Module vergeben und entziehen. Beide Rechte werden separat im IT-Reiter eingestellt.</p></div></div>
      <div class="leadership-toolbar"><input id="moduleGrantSearch" value="${escapeHtml(searchValue)}" placeholder="Mitglied, DN, Rang oder Modul suchen"></div>
      <div class="module-grant-list">
        ${users.map((user) => `
          <article class="module-grant-row">
            <div><strong>${escapeHtml(fullName(user))}</strong><small>DN ${escapeHtml(user.dn || "-")} · ${escapeHtml(rankLabel(user.rank))}</small></div>
            <div class="module-grant-groups">
              ${visibleTrainingGroups().map((group) => `
                <section class="module-grant-group">
                  <h4>${escapeHtml(group.title)}</h4>
                  <div class="training-check-grid">
                    ${group.trainings.map((training) => {
                      const active = Boolean(user.trainings?.[training]);
                      const canToggle = active ?canRevoke : canGrant;
                      return `<button class="module-toggle ${active ?"is-active" : ""}" type="button" title="${escapeHtml(trainingTooltipText(training))}" data-module-grant="${escapeHtml(user.id)}" data-training="${escapeHtml(training)}" data-initial="${active ?"1" : "0"}" data-enabled="${canToggle ?"1" : "0"}" aria-pressed="${active ?"true" : "false"}" ${canToggle ?"" : "disabled"}><span>${escapeHtml(trainingDisplayName(training))}</span><i>${active ?"Vergeben" : "Offen"}</i></button>`;
                    }).join("")}
                  </div>
                </section>
              `).join("")}
            </div>
            ${canGrant || canRevoke ?`<button class="blue-btn save-module-grant" type="button" data-user-id="${escapeHtml(user.id)}">Module speichern</button>` : `<span class="muted">Keine Modul-Berechtigung.</span>`}
          </article>
        `).join("") || `<p class="muted">Keine Mitglieder gefunden.</p>`}
      </div>
    </div>
  `;
}

function isRecentInformationChange(change) {
  const created = Date.parse(change?.createdAt || "");
  return Number.isFinite(created) && Date.now() - created <= 7 * 24 * 60 * 60 * 1000;
}

function isLatestInformationChange(change) {
  const current = Date.parse(change?.createdAt || "");
  if (!Number.isFinite(current)) return false;
  return !informationDocChangesFor(change.docId).some((item) => {
    const other = Date.parse(item.createdAt || "");
    return item.id !== change.id && Number.isFinite(other) && other > current;
  });
}

function isInformationHighlightCleared(change) {
  return Boolean(change?.highlightClearedAt);
}

function visibleInformationDocChangesForUser(changes = []) {
  const myId = state.currentUser?.id || "";
  return uniqueInformationDocChanges(changes).filter((change) => !(change.deletedBy || []).includes(myId));
}

function recentInformationDocHighlights(docId) {
  return informationDocChangesFor(docId).filter((change) => !isInformationHighlightCleared(change) && isRecentInformationChange(change) && isLatestInformationChange(change));
}

function markInlineInformationText(root, needle) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.includes(needle)) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest(".doc-inline-change-summary, .doc-inline-added")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const node = walker.nextNode();
  if (!node) return false;
  const index = node.nodeValue.indexOf(needle);
  const before = node.nodeValue.slice(0, index);
  const after = node.nodeValue.slice(index + needle.length);
  const mark = document.createElement("span");
  mark.className = "doc-inline-added";
  mark.textContent = needle;
  const fragment = document.createDocumentFragment();
  if (before) fragment.append(document.createTextNode(before));
  fragment.append(mark);
  if (after) fragment.append(document.createTextNode(after));
  node.replaceWith(fragment);
  return true;
}

function markInformationDocSearch(root, term) {
  const needle = String(term || "").trim();
  if (!root) return 0;
  root.querySelectorAll("mark.doc-search-mark").forEach((node) => node.replaceWith(document.createTextNode(node.textContent || "")));
  root.normalize();
  if (!needle) return 0;
  const lowerNeedle = needle.toLocaleLowerCase("de-DE");
  const collectTextNodes = (node, nodes = []) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.nodeValue.toLocaleLowerCase("de-DE").includes(lowerNeedle)) nodes.push(child);
      } else if (child.nodeType === Node.ELEMENT_NODE && !["SCRIPT", "STYLE", "MARK"].includes(child.tagName)) {
        collectTextNodes(child, nodes);
      }
    });
    return nodes;
  };
  const nodes = collectTextNodes(root);
  let count = 0;
  nodes.forEach((node) => {
    const source = node.nodeValue || "";
    const sourceLower = source.toLocaleLowerCase("de-DE");
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let index = sourceLower.indexOf(lowerNeedle, cursor);
    while (index !== -1) {
      if (index > cursor) fragment.append(document.createTextNode(source.slice(cursor, index)));
      const mark = document.createElement("mark");
      mark.className = "doc-search-mark";
      mark.textContent = source.slice(index, index + needle.length);
      fragment.append(mark);
      count += 1;
      cursor = index + needle.length;
      index = sourceLower.indexOf(lowerNeedle, cursor);
    }
    if (cursor < source.length) fragment.append(document.createTextNode(source.slice(cursor)));
    node.replaceWith(fragment);
  });
  root.querySelector(".doc-search-mark")?.scrollIntoView({ block: "center", behavior: "smooth" });
  return count;
}

function renderInformationDocWithChangeHighlight(body = "", changes = []) {
  const base = formatInformationDocText(body || "");
  const relevantChanges = Array.isArray(changes) ?changes.filter((change) => isRecentInformationChange(change) && isLatestInformationChange(change)) : [];
  if (!relevantChanges.length) return base;
  if (isStructuredRegulationsBody(body)) return base;
  if (isVehicleRegulationsBody(body)) {
    const removed = relevantChanges.flatMap((change) => informationChangeDiff(change.before || "", change.after || "").removed.map((line) => line.trim()).filter(Boolean));
    const summary = removed.length ?`
      <div class="doc-inline-change-summary">
        <strong>Gelöschte Inhalte</strong>
        ${removed.map((line) => `<del>${escapeHtml(line)}</del>`).join("")}
      </div>
    ` : "";
    return `${base}${summary}`;
  }
  const template = document.createElement("template");
  template.innerHTML = base;
  const highlighted = new Set();
  const textNodes = template.content.querySelectorAll("p, h2, h3, h4, li, blockquote, section, div");
  const removed = [];
  relevantChanges.forEach((change) => {
    const diff = informationChangeDiff(change.before || "", change.after || "");
    diff.added.forEach((line) => {
      const needle = line.trim();
      if (!needle) return;
      const target = [...textNodes].find((node) => !highlighted.has(needle) && node.textContent.trim() === needle);
      if (target) {
        target.classList.add("doc-inline-added");
        highlighted.add(needle);
      } else if (markInlineInformationText(template.content, needle)) {
        highlighted.add(needle);
      }
    });
    removed.push(...diff.removed.map((line) => line.trim()).filter(Boolean));
  });
  const summary = removed.length ?`
    <div class="doc-inline-change-summary">
      <strong>Gelöschte Inhalte</strong>
      ${removed.map((line) => `<del>${escapeHtml(line)}</del>`).join("")}
    </div>
  ` : "";
  return `${template.innerHTML}${summary}`;
}

function buildInformationDocImageBlock(dataUrl, name = "") {
  return `
    <section class="doc-media-row">
      <figure class="doc-image-frame">
        <img class="doc-image" src="${dataUrl}" alt="${escapeHtml(name)}">
      </figure>
      <div class="doc-media-text"><p><br></p></div>
    </section>
    <p><br></p>
  `;
}

function collectVehicleRegulations(modal) {
  return [...modal.querySelectorAll(".vehicle-rule-edit-row")].map((row) => ({
    id: row.dataset.vehicleId || makeTrainingId("vehicle"),
    image: row.querySelector(".vehicle-rule-image")?.value || "",
    name: row.querySelector(".vehicle-rule-name")?.value || "",
    rank: row.querySelector(".vehicle-rule-rank")?.value || "",
    info: row.querySelector(".vehicle-rule-extra")?.value || ""
  })).filter((item) => item.image || item.name.trim() || item.rank.trim() || item.info.trim());
}

function collectStructuredRegulations(modal) {
  return {
    headerTitle: modal.querySelector("#structuredRulesHeaderTitle")?.value || "",
    headerText: modal.querySelector("#structuredRulesHeaderText")?.value || "",
    items: [...modal.querySelectorAll(".structured-rule-edit-row")].map((row) => ({
      id: row.dataset.ruleId || makeTrainingId("rule"),
      image: row.querySelector(".structured-rule-image")?.value || "",
      title: row.querySelector(".structured-rule-title")?.value || "",
      data: row.querySelector(".structured-rule-data")?.value || "",
      info: row.querySelector(".structured-rule-extra")?.value || ""
    })).filter((item) => item.image || item.title.trim() || item.data.trim() || item.info.trim())
  };
}

function resizeVehicleRuleImage(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith("image/")) return reject(new Error("Bitte eine Bilddatei auswählen."));
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const maxSize = 900;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/webp", 0.82));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function bindStructuredRegulationsEditor(modal) {
  const list = modal.querySelector("#structuredRuleList");
  if (!list) return;
  const wireRow = (row) => {
    const setImage = async (file) => {
      try {
        const dataUrl = await resizeVehicleRuleImage(file);
        row.querySelector(".structured-rule-image").value = dataUrl;
        row.querySelector(".vehicle-image-preview").innerHTML = `<img src="${escapeHtml(dataUrl)}" alt="">`;
      } catch (error) {
        showNotify(error.message || "Bild konnte nicht gelesen werden.", "error");
      }
    };
    row.querySelector(".structured-rule-image-input")?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) setImage(file);
    });
    row.querySelector(".structured-image-drop")?.addEventListener("dragover", (event) => {
      if ([...(event.dataTransfer?.items || [])].some((item) => item.type.startsWith("image/"))) {
        event.preventDefault();
        row.classList.add("drag-over");
      }
    });
    row.querySelector(".structured-image-drop")?.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.querySelector(".structured-image-drop")?.addEventListener("drop", (event) => {
      const file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      row.classList.remove("drag-over");
      setImage(file);
    });
    row.querySelector(".remove-structured-rule")?.addEventListener("click", () => {
      if (list.querySelectorAll(".structured-rule-edit-row").length === 1) {
        row.querySelector(".structured-rule-image").value = "";
        row.querySelector(".structured-rule-title").value = "";
        row.querySelector(".structured-rule-data").value = "";
        row.querySelector(".structured-rule-extra").value = "";
        row.querySelector(".vehicle-image-preview").innerHTML = `${iconSvg("Plus")} Bild hochladen`;
        return;
      }
      row.remove();
    });
  };
  list.querySelectorAll(".structured-rule-edit-row").forEach(wireRow);
  modal.querySelector("#addStructuredRule")?.addEventListener("click", () => {
    list.insertAdjacentHTML("beforeend", renderStructuredRuleEditorRow({ id: makeTrainingId("rule"), image: "", title: "", data: "", info: "" }));
    wireRow(list.lastElementChild);
  });
}

function bindVehicleRegulationsEditor(modal) {
  const list = modal.querySelector("#vehicleRuleList");
  if (!list) return;
  const wireRow = (row) => {
    const setImage = async (file) => {
      try {
        const dataUrl = await resizeVehicleRuleImage(file);
        row.querySelector(".vehicle-rule-image").value = dataUrl;
        row.querySelector(".vehicle-image-preview").innerHTML = `<img src="${escapeHtml(dataUrl)}" alt="">`;
      } catch (error) {
        showNotify(error.message || "Bild konnte nicht gelesen werden.", "error");
      }
    };
    row.querySelector(".vehicle-rule-image-input")?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) setImage(file);
    });
    row.querySelector(".vehicle-image-drop")?.addEventListener("dragover", (event) => {
      if ([...(event.dataTransfer?.items || [])].some((item) => item.type.startsWith("image/"))) {
        event.preventDefault();
        row.classList.add("drag-over");
      }
    });
    row.querySelector(".vehicle-image-drop")?.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.querySelector(".vehicle-image-drop")?.addEventListener("drop", (event) => {
      const file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      row.classList.remove("drag-over");
      setImage(file);
    });
    row.querySelector(".remove-vehicle-rule")?.addEventListener("click", () => {
      if (list.querySelectorAll(".vehicle-rule-edit-row").length === 1) {
        row.querySelector(".vehicle-rule-image").value = "";
        row.querySelector(".vehicle-rule-name").value = "";
        row.querySelector(".vehicle-rule-rank").value = "";
        row.querySelector(".vehicle-rule-extra").value = "";
        row.querySelector(".vehicle-image-preview").innerHTML = `${iconSvg("Plus")} Bild hochladen`;
        return;
      }
      row.remove();
    });
  };
  list.querySelectorAll(".vehicle-rule-edit-row").forEach(wireRow);
  modal.querySelector("#addVehicleRule")?.addEventListener("click", () => {
    list.insertAdjacentHTML("beforeend", renderVehicleRuleEditorRow({ id: makeTrainingId("vehicle"), image: "", name: "", rank: "", info: "" }));
    wireRow(list.lastElementChild);
  });
}

function openInformationDocCreateTypeModal() {
  openModal(`
    <h3>Vorschrift hinzufügen</h3>
    <p class="muted">Wähle aus, wie die neue Vorschrift aufgebaut werden soll.</p>
    <div class="doc-create-choice-grid">
      <button class="doc-create-choice" type="button" id="createTextInformationDoc">
        <span>${iconSvg("Informationen")}</span>
        <b>Normales Textfeld</b>
        <small>Freier Editor mit Text, Kacheln, Links, Farben und Bildern.</small>
      </button>
      <button class="doc-create-choice" type="button" id="createStructuredInformationDoc">
        <span>${iconSvg("Dienstblatt")}</span>
        <b>Vorschriften-Menü</b>
        <small>Optionaler Header, Einträge mit Bild links sowie Daten und Zusatzinfos rechts.</small>
      </button>
    </div>
    <div class="modal-actions"><button class="ghost-btn" data-close>Abbrechen</button></div>
  `, (modal) => {
    modal.querySelector("#createTextInformationDoc")?.addEventListener("click", () => {
      closeModal();
      openInformationDocView(makeTrainingId("infodoc"), { title: "Neue Vorschrift", body: "" }, { editMode: true });
    });
    modal.querySelector("#createStructuredInformationDoc")?.addEventListener("click", () => {
      closeModal();
      openInformationDocView(makeTrainingId("infodoc"), {
        title: "Neue Vorschrift",
        body: serializeStructuredRegulations({
          headerTitle: "",
          headerText: "",
          items: [{ id: makeTrainingId("rule"), image: "", title: "", data: "", info: "" }]
        })
      }, { editMode: true });
    });
  });
}

async function saveInformationDocDirect(doc, title, body, closeAfter = false) {
  if (!title) throw new Error("Titel ist erforderlich.");
  const before = doc?.body || "";
  const hasBodyChange = normalizeInformationDocForCompare(before) !== normalizeInformationDocForCompare(body);
  const nextDoc = { id: doc?.id || makeTrainingId("infodoc"), title, body, updatedAt: new Date().toISOString(), updatedBy: fullName(state.currentUser) };
  const changes = !hasBodyChange ?(state.settings.informationDocChanges || []) : [{
    id: makeTrainingId("docchange"),
    docId: nextDoc.id,
    title,
    before,
    after: body,
    action: doc?.id ?"geändert" : "erstellt",
    createdAt: new Date().toISOString(),
    author: fullName(state.currentUser),
    acknowledgedBy: []
  }, ...(state.settings.informationDocChanges || [])];
  await saveInformationPatch({ informationDocs: upsertById(informationDocs(), nextDoc), informationDocChanges: changes });
  if (closeAfter) {
    closeModal();
    renderInformation();
  } else {
    openInformationDocView(nextDoc.id);
  }
}

function openDeleteInformationDocModal(docId) {
  const doc = informationDocs().find((item) => item.id === docId);
  if (!doc) return showNotify("Vorschrift nicht gefunden.", "error");
  openConfirmModal({
    title: "Vorschrift löschen",
    text: `${doc.title} wirklich löschen?`,
    confirmText: "Löschen",
    onConfirm: async () => {
      const docs = informationDocs().filter((item) => item.id !== docId);
      const changes = (state.settings.informationDocChanges || []).filter((change) => change.docId !== docId);
      await saveInformationPatch({ informationDocs: docs, informationDocChanges: changes });
      closeModal();
      renderInformation();
    }
  });
}

function openInformationDocCloseConfirm(doc, title, before, after) {
  openModal(`
    <div class="doc-compare-head">
      <span class="doc-compare-kicker">Vorschrift speichern</span>
      <h3>Änderung prüfen</h3>
      <p>Vergleiche die bisherige und die neue Fassung, bevor du die Änderung ins Dienstblatt übernimmst.</p>
    </div>
    <div class="doc-compare-grid">
      <section class="doc-compare-panel before">
        <header><span>Vorher</span><small>Aktuell gespeichert</small></header>
        <article class="doc-save-preview before">${formatInformationDocText(before || "")}</article>
      </section>
      <section class="doc-compare-panel after">
        <header><span>Nachher</span><small>Neue Fassung</small></header>
        <article class="doc-save-preview after">${formatInformationDocText(after || "")}</article>
      </section>
    </div>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" id="backToDocEdit">Zurück</button>
      <button class="ghost-btn" id="discardDocChanges">Nicht speichern</button>
      <button class="blue-btn" id="confirmSaveDocChanges">Speichern</button>
    </div>
  `, (confirmModal) => {
    confirmModal.classList.add("doc-compare-modal");
    confirmModal.querySelector("#backToDocEdit").addEventListener("click", () => openInformationDocView(doc.id, { title, body: after }, { editMode: true }));
    confirmModal.querySelector("#discardDocChanges").addEventListener("click", closeModal);
    confirmModal.querySelector("#confirmSaveDocChanges").addEventListener("click", async () => {
      try {
        await saveInformationDocDirect(doc, title, after, true);
      } catch (error) {
        confirmModal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

function openInformationDocView(docId, draft = null, options = {}) {
  const existing = informationDocs().find((item) => item.id === docId);
  const doc = existing || { id: docId || makeTrainingId("infodoc"), title: draft?.title || "Neue Vorschrift", body: draft?.body || "", updatedAt: new Date().toISOString() };
  if (existing || docId) {
    activeInformationDocUrlId = doc.id;
    updateAppUrl({ docId: doc.id, replace: Boolean(options.replaceUrl) });
  }
  const canManageInformation = canAccess("actions", "manageInformation", "Direktion") && !options.readOnly;
  const canEdit = canManageInformation && options.editMode;
  const effectiveTitle = draft?.title ?? doc.title;
  const sourceBody = draft?.body ?? doc.body ?? "";
  const isVehicleDoc = isVehicleRegulationsDoc({ ...doc, title: effectiveTitle }) || isVehicleRegulationsBody(sourceBody);
  const isStructuredDoc = isStructuredRegulationsBody(sourceBody);
  const editLockKey = existing ?`informationDoc:${doc.id}` : "informationDoc:new";
  const editLockLabel = existing ?`Vorschrift: ${doc.title || "Neue Vorschrift"}` : "Neue Vorschrift";
  if (canEdit && !options.lockReady && !ownsInformationEditLock(editLockKey)) {
    acquireInformationEditLock(editLockKey, editLockLabel).then((ok) => {
      if (ok) openInformationDocView(docId, draft, { ...options, lockReady: true });
    });
    return;
  }
  if (canEdit) startInformationEditLockHeartbeat(editLockKey, editLockLabel);
  const changes = informationDocChangesFor(doc.id);
  const highlightChanges = options.highlightChangeId
    ?changes.filter((change) => change.id === options.highlightChangeId && !isInformationHighlightCleared(change))
    : recentInformationDocHighlights(doc.id);
  const readOnlyBody = isStructuredDoc
    ?renderStructuredRegulationsView(sourceBody)
    : isVehicleDoc && isVehicleRegulationsBody(sourceBody)
      ?renderVehicleRegulationsView(sourceBody)
      : renderInformationDocWithChangeHighlight(doc.body, highlightChanges);
  openModal(`
    <div class="paper-doc-modal">
      <div class="paper-doc-head">
        <div class="paper-doc-title-row">
          ${canEdit ?`<input id="paperDocTitle" value="${escapeHtml(effectiveTitle)}">` : `<h3>${escapeHtml(doc.title)}</h3>`}
          ${canEdit ?`<div class="paper-doc-head-actions"><button class="blue-btn compact-action" id="saveInformationDocInline" type="button">Speichern</button>${existing ?`<button class="mini-icon danger" id="deleteInformationDocInline" type="button" title="Löschen">${actionIcon("delete")}</button>` : ""}</div>` : canManageInformation ?`<div class="paper-doc-head-actions">${highlightChanges.length ?`<button class="ghost-btn compact-action" id="clearInformationHighlights" type="button">Hervorhebung entfernen</button>` : ""}<button class="blue-btn compact-action" id="editInformationDocInline" type="button">${actionIcon("edit")} Bearbeiten</button></div>` : ""}
        </div>
        <div class="doc-search-control">
          <input id="docSearchInput" placeholder="Im Dokument suchen">
          <span id="docSearchCount">0/0</span>
        </div>
      </div>
      ${canEdit && isStructuredDoc ?renderStructuredRegulationsEditor(sourceBody) : canEdit && isVehicleDoc ?renderVehicleRegulationsEditor(sourceBody) : canEdit ?`
        <div class="docs-editor-toolbar">
          <div class="docs-toolbar-group">
            <span class="docs-toolbar-label">Text</span>
            <button class="docs-tool-btn" type="button" data-doc-command="bold" title="Fett"><strong>B</strong></button>
            <button class="docs-tool-btn" type="button" data-doc-command="italic" title="Kursiv"><em>I</em></button>
            <button class="docs-tool-btn" type="button" data-doc-command="underline" title="Unterstrichen"><u>U</u></button>
          </div>
          <div class="docs-toolbar-group">
            <span class="docs-toolbar-label">Format</span>
            <button class="docs-tool-btn wide" type="button" data-doc-block="h2">Titel</button>
            <button class="docs-tool-btn wide" type="button" data-doc-block="h3">Überschrift</button>
            <button class="docs-tool-btn wide" type="button" data-doc-block="p">Text</button>
          </div>
          <div class="docs-toolbar-group">
            <span class="docs-toolbar-label">Ausrichtung</span>
            <button class="docs-tool-btn wide" type="button" data-doc-command="justifyLeft">Links</button>
            <button class="docs-tool-btn wide" type="button" data-doc-command="justifyCenter">Zentriert</button>
            <button class="docs-tool-btn wide" type="button" data-doc-command="justifyRight">Rechts</button>
          </div>
          <div class="docs-toolbar-group">
            <span class="docs-toolbar-label">Farbe</span>
            <button class="docs-color-swatch default" type="button" data-doc-color="#ffffff" title="Standard"></button>
            <button class="docs-color-swatch green" type="button" data-doc-color="#00ff66" title="Grün"></button>
            <button class="docs-color-swatch red" type="button" data-doc-color="#ff1f1f" title="Rot"></button>
            <button class="docs-color-swatch yellow" type="button" data-doc-color="#ffd400" title="Gelb"></button>
            <button class="docs-color-swatch blue" type="button" data-doc-color="#1e90ff" title="Blau"></button>
          </div>
          <div class="docs-toolbar-group compact">
            <button class="docs-tool-btn wide" type="button" id="insertDocLink">Link einfügen</button>
            <button class="docs-tool-btn wide" type="button" id="insertDocSection">Kachel einfügen</button>
          </div>
        </div>
        <article class="paper-doc-page paper-doc-editor rich-doc-editor" id="paperDocEditor" contenteditable="true">${formatInformationDocText(sourceBody)}</article>
      ` : `<article class="paper-doc-page" id="paperDocPage">${readOnlyBody}</article>`}
      <details class="doc-change-details" ${options.focusChangeId ?"open" : ""}>
        <summary>Changelog (${changes.length})</summary>
        <div class="info-change-list">${changes.map((change) => `
          <article class="info-change-row ${options.focusChangeId === change.id ?"focus-change" : ""}" data-change-id="${escapeHtml(change.id)}">
            <div class="info-change-row-head">
              <span><strong>${escapeHtml(change.action || "geändert")}</strong><small>${escapeHtml(change.author || "-")} · ${formatDateTime(change.createdAt)}</small></span>
              ${canManageInformation && !isInformationHighlightCleared(change) ?`<button class="ghost-btn compact-action clear-information-highlight" type="button" data-change-id="${escapeHtml(change.id)}">Hervorhebung entfernen</button>` : ""}
            </div>
            ${renderInformationChangeDiff(change)}
          </article>
        `).join("") || `<p class="muted">Noch keine Änderungen.</p>`}</div>
      </details>
    </div>
  `, (modal) => {
    modal.classList.add("wide-doc-modal");
    if (options.focusChangeId) {
      window.setTimeout(() => modal.querySelector(`[data-change-id="${CSS.escape(options.focusChangeId)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 120);
    }
    const initial = sourceBody;
    const currentDocBody = () => isStructuredDoc
      ?serializeStructuredRegulations(collectStructuredRegulations(modal))
      : isVehicleDoc
        ?serializeVehicleRegulations(collectVehicleRegulations(modal))
        : sanitizeInformationDocHtml(modal.querySelector("#paperDocEditor")?.innerHTML || "");
    const x = modal.querySelector(".modal-x");
    if (x && canEdit) {
      const clone = x.cloneNode(true);
      x.replaceWith(clone);
      clone.addEventListener("click", () => {
        const title = modal.querySelector("#paperDocTitle")?.value.trim() || doc.title;
        const current = currentDocBody();
        if (normalizeInformationDocForCompare(current) !== normalizeInformationDocForCompare(initial) || title !== doc.title) openInformationDocCloseConfirm(doc, title, initial, current);
        else closeModal();
      });
    }
    const docSearchState = { index: 0 };
    const goToSearchMatch = (root, nextIndex = docSearchState.index) => {
      const matches = [...(root?.querySelectorAll(".doc-search-mark") || [])];
      const count = modal.querySelector("#docSearchCount");
      if (!matches.length) {
        docSearchState.index = 0;
        if (count) count.textContent = "0/0";
        return;
      }
      docSearchState.index = ((nextIndex % matches.length) + matches.length) % matches.length;
      matches.forEach((match, index) => match.classList.toggle("active-search-mark", index === docSearchState.index));
      if (count) count.textContent = `${docSearchState.index + 1}/${matches.length}`;
      matches[docSearchState.index]?.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    const runDocSearch = (term, keepIndex = false) => {
      const page = modal.querySelector("#paperDocPage");
      let searchRoot = page;
      if (page) {
        page.innerHTML = readOnlyBody;
        markInformationDocSearch(page, term);
      }
      const editor = modal.querySelector("#paperDocEditor");
      if (editor) {
        markInformationDocSearch(editor, term);
        searchRoot = editor;
      }
      if (!keepIndex) docSearchState.index = 0;
      goToSearchMatch(searchRoot);
    };
    modal.querySelector("#docSearchInput")?.addEventListener("input", (event) => {
      runDocSearch(event.target.value.trim());
    });
    modal.querySelector("#docSearchInput")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const root = modal.querySelector("#paperDocPage") || modal.querySelector("#paperDocEditor");
      const matches = root?.querySelectorAll(".doc-search-mark") || [];
      if (!matches.length) return;
      goToSearchMatch(root, docSearchState.index + (event.shiftKey ?-1 : 1));
    });
    modal.querySelector("#editInformationDocInline")?.addEventListener("click", () => openInformationDocView(doc.id, null, { editMode: true }));
    modal.querySelector("#clearInformationHighlights")?.addEventListener("click", () => clearInformationHighlights(doc.id, highlightChanges.map((change) => change.id)));
    modal.querySelectorAll(".clear-information-highlight").forEach((button) => button.addEventListener("click", () => clearInformationHighlights(doc.id, [button.dataset.changeId])));
    bindVehicleRegulationsEditor(modal);
    bindStructuredRegulationsEditor(modal);
    const editor = modal.querySelector("#paperDocEditor");
    const runCommand = (command, value = null) => {
      editor?.focus();
      document.execCommand(command, false, value);
    };
    modal.querySelectorAll("[data-doc-command]").forEach((button) => button.addEventListener("click", () => runCommand(button.dataset.docCommand)));
    modal.querySelectorAll("[data-doc-block]").forEach((button) => button.addEventListener("click", () => runCommand("formatBlock", button.dataset.docBlock)));
    modal.querySelectorAll("[data-doc-color]").forEach((button) => button.addEventListener("click", () => runCommand("foreColor", button.dataset.docColor)));
    modal.querySelector("#insertDocLink")?.addEventListener("click", () => {
      const url = prompt("Link einfügen:");
      if (!url) return;
      const safeUrl = /^https?:\/\//i.test(url.trim()) ?url.trim() : `https://${url.trim()}`;
      runCommand("createLink", safeUrl);
      editor?.querySelectorAll("a").forEach((link) => {
        link.target = "_blank";
        link.rel = "noreferrer";
      });
    });
    modal.querySelector("#insertDocSection")?.addEventListener("click", () => {
      editor?.focus();
      const selection = window.getSelection();
      const selectedHtml = selection && selection.rangeCount
        ?sanitizeInformationDocHtml(selection.getRangeAt(0).cloneContents().childNodes.length
          ?Array.from(selection.getRangeAt(0).cloneContents().childNodes).map((node) => node.outerHTML || escapeHtml(node.textContent || "")).join("")
          : selection.toString())
        : "";
      const content = selectedHtml.trim() || "<p><br></p>";
      runCommand("insertHTML", `<section class="doc-section">${content}</section><p><br></p>`);
    });
    editor?.addEventListener("dragover", (event) => {
      if ([...(event.dataTransfer?.items || [])].some((item) => item.type.startsWith("image/"))) {
        event.preventDefault();
        editor.classList.add("drag-over");
      }
    });
    editor?.addEventListener("dragleave", () => editor.classList.remove("drag-over"));
    editor?.addEventListener("drop", async (event) => {
      const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith("image/"));
      if (!files.length) return;
      event.preventDefault();
      editor.classList.remove("drag-over");
      for (const file of files) {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        runCommand("insertHTML", buildInformationDocImageBlock(dataUrl, file.name));
      }
    });
    modal.querySelector("#saveInformationDocInline")?.addEventListener("click", async () => {
      try {
        const title = modal.querySelector("#paperDocTitle")?.value.trim() || "";
        const body = currentDocBody();
        await saveInformationDocDirect(doc, title, body, true);
        showNotify("Vorschrift gespeichert.");
      } catch (error) {
        showNotify(error.message || "Vorschrift konnte nicht gespeichert werden.", "error");
      }
    });
    modal.querySelector("#deleteInformationDocInline")?.addEventListener("click", () => openDeleteInformationDocModal(doc.id));
  });
}

async function clearInformationHighlights(docId, changeIds = []) {
  const ids = new Set(changeIds.filter(Boolean));
  if (!ids.size) return;
  const clearedAt = new Date().toISOString();
  const clearedBy = fullName(state.currentUser);
  const changes = (state.settings.informationDocChanges || []).map((change) => ids.has(change.id)
    ?{ ...change, highlightClearedAt: clearedAt, highlightClearedBy: clearedBy }
    : change);
  await saveInformationPatch({ informationDocChanges: changes });
  showNotify(ids.size === 1 ?"Hervorhebung entfernt." : "Hervorhebungen entfernt.");
  openInformationDocView(docId);
}

function informationEditLocks() {
  const now = Date.now();
  return (state.settings?.informationEditLocks || []).filter((lock) => lock?.key && lock?.updatedAt && now - new Date(lock.updatedAt).getTime() < 2 * 60 * 1000);
}

function informationEditLock(key) {
  return informationEditLocks().find((lock) => lock.key === key) || null;
}

function ownsInformationEditLock(key) {
  const lock = informationEditLock(key);
  return Boolean(lock && lock.userId === state.currentUser?.id);
}

function renderInformationEditLockBadge(key) {
  const lock = informationEditLock(key);
  if (!lock || lock.userId === state.currentUser?.id || !canAccess("actions", "manageInformation", "Direktion")) return "";
  return `<div class="info-edit-lock">${iconSvg("Lock")} <span><b>In Bearbeitung</b><small>${escapeHtml(lock.label || "Bereich")} · ${escapeHtml(lock.userName || "Unbekannt")}</small></span></div>`;
}

function startInformationEditLockHeartbeat(key, label) {
  activeInformationEditLockKey = key;
  window.clearInterval(informationEditLockTimer);
  informationEditLockTimer = window.setInterval(() => {
    api("/api/information/edit-locks", { method: "POST", silent: true, body: JSON.stringify({ key, label }) })
      .then((data) => { state.settings = data.settings || state.settings; })
      .catch(() => {});
  }, 45000);
}

async function acquireInformationEditLock(key, label) {
  if (ownsInformationEditLock(key)) {
    startInformationEditLockHeartbeat(key, label);
    return true;
  }
  try {
    const data = await api("/api/information/edit-locks", { method: "POST", silent: true, body: JSON.stringify({ key, label }) });
    state.settings = data.settings || state.settings;
    startInformationEditLockHeartbeat(key, label);
    return true;
  } catch (error) {
    if (error.status === 409 && error.settings) state.settings = error.settings;
    showNotify(error.message || "Dieser Bereich wird gerade bearbeitet.", "error");
    renderInformation();
    return false;
  }
}

function releaseInformationEditLock() {
  const key = activeInformationEditLockKey;
  if (!key) return;
  activeInformationEditLockKey = "";
  window.clearInterval(informationEditLockTimer);
  informationEditLockTimer = null;
  api(`/api/information/edit-locks/${encodeURIComponent(key)}`, { method: "DELETE", silent: true })
    .then((data) => { state.settings = data.settings || state.settings; })
    .catch(() => {});
}

function renderInformation() {
  const links = state.settings.informationLinks || [];
  const docs = informationDocs();
  const permits = state.settings.informationPermits || [];
  const factions = state.settings.informationFactions || [];
  const canManageInformation = canAccess("actions", "manageInformation", "Direktion");
  const unread = unreadInformationChanges();
  const showLinks = state.settings?.hideInformationLinksCard === false;
  content.innerHTML = `
    <section class="department-info-view information-admin-view modern-info-view">
      <div class="info-box full information-card internal-doc-card">
        <div class="department-modal-heading">
          <h4>Dokumente</h4>
          ${canManageInformation ?`<button class="blue-btn" id="addInformationDoc">${iconSvg("Plus")} Neue Vorschrift erstellen</button>` : ""}
        </div>
        ${renderInformationEditLockBadge("informationDoc:new")}
        <div class="internal-doc-grid">
          ${docs.map((doc) => `
          <div class="internal-doc-tile-wrap">
            <button class="internal-doc-tile" data-doc-id="${escapeHtml(doc.id)}"><strong>${escapeHtml(doc.title)}</strong><small>Zuletzt geändert: ${formatDateTime(doc.updatedAt)}${doc.updatedBy ?` · von ${escapeHtml(doc.updatedBy)}` : ""}</small></button>
            ${renderInformationEditLockBadge(`informationDoc:${doc.id}`)}
            ${canManageInformation ?`<button class="mini-icon danger delete-info-doc" data-doc-id="${escapeHtml(doc.id)}" type="button" title="Löschen">${actionIcon("delete")}</button>` : ""}
          </div>
        `).join("")}
          <div class="internal-doc-tile-wrap">
            <button class="internal-doc-tile sanction-catalog-doc-tile" id="openSanctionCatalogDoc" type="button">
              <strong>Sanktionskatalog</strong>
              <small>Strikes, Geldstrafen und Maßnahmen als Tabelle</small>
            </button>
          </div>
        </div>
      </div>
      ${showLinks ?`
      <div class="info-box full information-card redirects-card">
        <div class="department-modal-heading"><h4>Link Weiterleitungen</h4>${canManageInformation ?`<button class="blue-btn" id="addInformationLink">${iconSvg("Plus")} Hinzufügen</button>` : ""}</div>
        ${renderInformationEditLockBadge("informationLinks")}
        <div class="link-card-grid">${links.map((link) => `<article class="small-link-card"><strong>${escapeHtml(link.title)}</strong><span class="link-label">Link:</span><a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.url)}</a>${canManageInformation ?`<span class="button-row"><button class="blue-btn compact-action edit-info-link" data-id="${link.id}" title="Bearbeiten">${actionIcon("edit")} Bearbeiten</button><button class="mini-icon danger delete-info-link" data-id="${link.id}" title="Löschen">${actionIcon("delete")}</button></span>` : ""}</article>`).join("") || `<p class="muted">Noch keine Weiterleitungen.</p>`}</div>
      </div>
      ` : ""}
      <div class="info-box full information-card rights-split-card">
        <div class="department-modal-heading"><h4>Rechte</h4>${canManageInformation ?`<button class="blue-btn" id="editInformationRights">${actionIcon("edit")} Bearbeiten</button>` : ""}</div>
        ${renderInformationEditLockBadge("informationRights")}
        <div class="rights-split-grid">
          <section class="rights-split-pane rights-briefing-pane">
            <h5>Rechte Belehrung</h5>
            <div class="rich-text-view">${formatDepartmentText(state.settings.informationRightsBriefText)}</div>
          </section>
          <section class="rights-split-pane">
            <h5>Rechte Definition</h5>
            <div class="rich-text-view">${formatDepartmentText(state.settings.informationRightsText)}</div>
          </section>
        </div>
      </div>
      <div class="info-box full information-card permits-card"><div class="department-modal-heading"><h4>Sondergenehmigungen</h4>${canManageInformation ?`<button class="blue-btn" id="addInformationPermit">${iconSvg("Plus")} Hinzufügen</button>` : ""}</div>${renderInformationEditLockBadge("informationPermits")}<div class="table-wrap compact-table"><table><thead><tr><th>Vor- und Nachname</th><th>Beschreibung</th><th>Gültig Bis</th><th>Aktionen</th></tr></thead><tbody>${permits.map((permit) => `<tr><td>${escapeHtml(permit.name)}</td><td>${escapeHtml(permit.description)}</td><td>${formatDate(permit.validUntil)}</td><td>${canManageInformation ?`<button class="mini-icon edit-info-permit" data-id="${permit.id}">${actionIcon("edit")}</button><button class="mini-icon danger delete-info-permit" data-id="${permit.id}">${actionIcon("delete")}</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Keine Sondergenehmigungen.</td></tr>`}</tbody></table></div></div>
      <div class="info-box full information-card"><div class="department-modal-heading"><h4>Fraktionen</h4>${canManageInformation ?`<button class="blue-btn" id="addInformationFaction">${iconSvg("Plus")} Hinzufügen</button>` : ""}</div>${renderInformationEditLockBadge("informationFactions")}<div class="table-wrap compact-table"><table><thead><tr><th>Organisation</th><th>Status</th><th>Aktionen</th></tr></thead><tbody>${factions.map((faction) => `<tr><td>${escapeHtml(faction.organization)}</td><td><span class="status-label">${renderStatusDot(faction.status)}</span></td><td>${canManageInformation ?`<button class="mini-icon edit-info-faction" data-id="${faction.id}">${actionIcon("edit")}</button><button class="mini-icon danger delete-info-faction" data-id="${faction.id}">${actionIcon("delete")}</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">Keine Fraktionen.</td></tr>`}</tbody></table></div></div>
    </section>
  `;
  $("#editInformationRights")?.addEventListener("click", async () => {
    if (await acquireInformationEditLock("informationRights", "Rechte Definition")) openInformationRightsModal();
  });
  $("#addInformationLink")?.addEventListener("click", async () => {
    if (await acquireInformationEditLock("informationLinks", "Link Weiterleitungen")) openInformationLinkModal();
  });
  $("#addInformationDoc")?.addEventListener("click", () => openInformationDocCreateTypeModal());
  $("#openSanctionCatalogDoc")?.addEventListener("click", openSanctionCatalogDocument);
  $("#addInformationPermit")?.addEventListener("click", async () => {
    if (await acquireInformationEditLock("informationPermits", "Sondergenehmigungen")) openInformationPermitModal();
  });
  $("#addInformationFaction")?.addEventListener("click", async () => {
    if (await acquireInformationEditLock("informationFactions", "Fraktionen")) openInformationFactionModal();
  });
  document.querySelectorAll(".edit-info-link").forEach((button) => button.addEventListener("click", async () => {
    if (await acquireInformationEditLock("informationLinks", "Link Weiterleitungen")) openInformationLinkModal(links.find((item) => item.id === button.dataset.id));
  }));
  document.querySelectorAll(".delete-info-link").forEach((button) => button.addEventListener("click", () => deleteInformationItem("informationLinks", button.dataset.id)));
  document.querySelectorAll(".edit-info-permit").forEach((button) => button.addEventListener("click", async () => {
    if (await acquireInformationEditLock("informationPermits", "Sondergenehmigungen")) openInformationPermitModal(permits.find((item) => item.id === button.dataset.id));
  }));
  document.querySelectorAll(".delete-info-permit").forEach((button) => button.addEventListener("click", () => deleteInformationItem("informationPermits", button.dataset.id)));
  document.querySelectorAll(".edit-info-faction").forEach((button) => button.addEventListener("click", async () => {
    if (await acquireInformationEditLock("informationFactions", "Fraktionen")) openInformationFactionModal(factions.find((item) => item.id === button.dataset.id));
  }));
  document.querySelectorAll(".delete-info-faction").forEach((button) => button.addEventListener("click", () => deleteInformationItem("informationFactions", button.dataset.id)));
  document.querySelectorAll(".internal-doc-tile[data-doc-id]").forEach((button) => button.addEventListener("click", () => openInformationDocView(button.dataset.docId)));
  document.querySelectorAll(".delete-info-doc").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    openDeleteInformationDocModal(button.dataset.docId);
  }));
}

function unreadMailboxItems() {
  const myId = state.currentUser?.id || "";
  const docChanges = uniqueInformationDocChanges(state.settings?.informationDocChanges || []).filter((change) =>
    isAfterNotificationBaseline(change.createdAt)
    && !(change.acknowledgedBy || []).includes(myId)
    && !(change.deletedBy || []).includes(myId)
  );
  const chatMessages = (state.mailboxThreads || []).flatMap((thread) =>
    Array.from({ length: Number(thread.unreadCount || 0) }, (_, index) => ({ id: `${thread.id}:${index}`, type: "chat", threadId: thread.id }))
  );
  return [...docChanges, ...chatMessages];
}

function uniqueInformationDocChanges(changes = []) {
  const seen = new Set();
  return [...changes].filter((change) => {
    if (isNoopInformationChange(change)) return false;
    const contentKey = `${change.docId || ""}:${change.title || ""}:${change.action || ""}:${change.createdAt || ""}`;
    const key = contentKey.replace(/:/g, "") ?contentKey : change.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mailboxUnreadCount() {
  return unreadMailboxItems().length;
}

function markInformationChangeRead(changeId) {
  mailboxReadQueue = mailboxReadQueue.catch(() => {}).then(() =>
    api(`/api/information/changes/${encodeURIComponent(changeId)}/read`, { method: "POST", body: "{}", silent: true })
  );
  return mailboxReadQueue;
}

function markInformationChangesRead(changeIds = []) {
  mailboxReadQueue = mailboxReadQueue.catch(() => {}).then(() =>
    api("/api/information/changes/read-all", { method: "POST", body: JSON.stringify({ ids: changeIds }), silent: true })
  );
  return mailboxReadQueue;
}

async function saveInformationPatchSilent(patch) {
  informationSilentSaveQueue = informationSilentSaveQueue.catch(() => {}).then(async () => {
    const data = await api("/api/information", {
      method: "PATCH",
      silent: true,
      body: JSON.stringify({
        informationText: state.settings.informationText,
        applicationStatus: state.settings.applicationStatus,
        informationRightsBriefText: state.settings.informationRightsBriefText || "",
        informationRightsText: state.settings.informationRightsText || "",
        informationLinks: state.settings.informationLinks || [],
        informationDocs: state.settings.informationDocs || [],
        informationDocChanges: state.settings.informationDocChanges || [],
        informationPermits: state.settings.informationPermits || [],
        informationFactions: state.settings.informationFactions || [],
        ...patch
      })
    });
    state.settings = data.settings || state.settings;
    return data;
  });
  return informationSilentSaveQueue;
}

function markInformationChangeReadLocal(changeId) {
  return markInformationChangesReadLocal([changeId]);
}

function markInformationChangesReadLocal(changeIds = []) {
  const myId = state.currentUser?.id || "";
  const ids = new Set(changeIds.map(String));
  let changed = false;
  state.settings.informationDocChanges = (state.settings.informationDocChanges || []).map((change) => {
    if (!ids.has(String(change.id)) || (change.acknowledgedBy || []).includes(myId)) return change;
    changed = true;
    return { ...change, acknowledgedBy: [...(change.acknowledgedBy || []), myId] };
  });
  return changed;
}

async function deleteMailboxMessage(changeId) {
  const data = await api(`/api/information/changes/${encodeURIComponent(changeId)}`, { method: "DELETE", silent: true });
  state.settings = data.settings || state.settings;
}

function openInformationDocChangelog(docId, changeId = "") {
  openInformationDocView(docId, null, { readOnly: true, highlightChangeId: changeId });
}

function renderPage() {
  if (state.page === "Dienstblatt") return renderDienstblatt();
  if (state.page === "Mitglieder") return renderMembers();
  if (state.page === "Mitgliederfluktation") return renderFluctuation();
  if (state.page === "Beförderungen") {
    content.innerHTML = renderPromotionAnnouncements();
    return;
  }
  if (state.page === "Beschlagnahmung") return renderSeizures();
  if (state.page === "Kalender") return renderCalendar();
  if (state.page === "Informationen") return renderInformation();
  if (state.page === "Postfach") return renderPostfach();
  if (state.page === "Changelog") return renderChangelog();
  if (state.page === "Direktion") return renderDirektion();
  if (state.page === "IT") return renderIT();
  if (state.page === "Abteilungen") return renderDepartmentsOverview();
  if (isDepartmentPage(state.page)) return renderDepartmentPage(departmentByPage(state.page));
  if (state.page === "Profil") return renderProfile();
  return renderTemplate(state.page);
}

function changelogEntries() {
  return [...(state.settings?.changelog || [])].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function renderChangelog() {
  const clearedBadge = markChangelogRead();
  const entries = changelogEntries();
  const canCreate = hasRole("IT");
  content.innerHTML = `
    <section class="changelog-page">
      <div class="changelog-page-head">
        <div>
          <h2>Changelog</h2>
        </div>
        ${canCreate ?`<button class="blue-btn" id="createChangelogBtn" type="button">${iconSvg("Plus")} Neuer Changelog</button>` : ""}
      </div>
      <section class="panel changelog-panel">
        <div class="changelog-list">
          ${entries.length ?entries.map(renderChangelogCard).join("") : `<div class="changelog-empty">Noch kein Changelog vorhanden.</div>`}
        </div>
      </section>
    </section>
  `;
  if (clearedBadge) renderNavigation();
  $("#createChangelogBtn")?.addEventListener("click", openChangelogModal);
  document.querySelectorAll(".edit-changelog").forEach((button) => button.addEventListener("click", () => openChangelogModal(changelogEntries().find((entry) => entry.id === button.dataset.id))));
  document.querySelectorAll(".delete-changelog").forEach((button) => button.addEventListener("click", () => openDeleteChangelogModal(button.dataset.id)));
}

function renderChangelogText(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];
  const formatInline = (value) => escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${formatInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(`<ul>${list.map((item) => `<li>${formatInline(item)}</li>`).join("")}</ul>`);
    list = [];
  };
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      return;
    }
    const heading = line.match(/^#{2,3}\s+(.+)$/) || line.match(/^(Verbesserungen?(?:\s*\/\s*Anpassungen?)?|Anpassungen?|Bugfixes?|Fehlerbehebungen?|Neu|Sonstiges)\s*:?\s*$/i);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push(`<h4>${formatInline(heading[1] || line.replace(/:$/, ""))}</h4>`);
      return;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      return;
    }
    flushList();
    paragraph.push(line);
  });
  flushParagraph();
  flushList();
  return blocks.length ?blocks.join("") : `<p>Keine Details eingetragen.</p>`;
}

function renderChangelogCard(entry) {
  const version = escapeHtml(entry.version || "0.0.1");
  const title = escapeHtml(`Changelog ${formatDate(entry.createdAt)}`);
  const type = ["Bug Fixes", "Fehler behoben"].includes(entry.type) ?"Bug Fixes" : "Verbesserung / Anpassung";
  const typeClass = type === "Bug Fixes" ?"fix" : "feature";
  const author = escapeHtml(entry.authorName || "Unbekannt");
  const role = entry.authorRole ?` (${escapeHtml(entry.authorRole)})` : "";
  const canEdit = hasRole("IT");
  return `
    <article class="changelog-card">
      <header>
        <div class="changelog-card-title">
          <h3>[${version}] ${title}</h3>
          <span class="changelog-badge ${typeClass}">${escapeHtml(type)}</span>
          <span class="changelog-version">${version}</span>
        </div>
        ${canEdit ?`
          <div class="button-row changelog-actions">
            <button class="mini-icon edit-changelog" type="button" data-id="${escapeHtml(entry.id)}" title="Bearbeiten">${actionIcon("edit")}</button>
            <button class="mini-icon danger delete-changelog" type="button" data-id="${escapeHtml(entry.id)}" title="Löschen">${actionIcon("delete")}</button>
          </div>
        ` : ""}
      </header>
      <div class="changelog-body">
        ${renderChangelogText(entry.body)}
      </div>
      <footer>
        <span>${iconSvg("Profil")} ${author}${role}</span>
        <span>${iconSvg("Kalender")} ${escapeHtml(formatDateTime(entry.createdAt))}</span>
      </footer>
    </article>
  `;
}

function openChangelogModal(entry = null) {
  const isEdit = Boolean(entry);
  openModal(`
    <h3>${isEdit ?"Changelog bearbeiten" : "Neuen Changelog erstellen"}</h3>
    <div class="form-grid">
      <label>Art
        <select id="changelogType">
          <option value="Verbesserung / Anpassung" ${!["Bug Fixes", "Fehler behoben"].includes(entry?.type) ?"selected" : ""}>Verbesserung / Anpassung</option>
          <option value="Bug Fixes" ${["Bug Fixes", "Fehler behoben"].includes(entry?.type) ?"selected" : ""}>Bug Fixes</option>
        </select>
      </label>
      <label class="full">Changelog
        <textarea id="changelogBody" class="changelog-editor" rows="14" placeholder="Verbesserungen&#10;- Kalender hinzugefügt&#10;- Discord-Sync optimiert&#10;&#10;Bugfixes&#10;- Fehler bei Beschlagnahmung behoben">${escapeHtml(entry?.body || "")}</textarea>
      </label>
      <p class="muted full">Nutze Überschriften wie Verbesserungen, Anpassungen oder Bugfixes und Listen mit - Punkt. Für fetten Text markiere Text und drücke Strg+B oder nutze **Text**.</p>
    </div>
    <div class="modal-actions">
      <button class="ghost-btn" type="button" id="cancelChangelog">Abbrechen</button>
      <button class="blue-btn" type="button" id="saveChangelog">${isEdit ?"Speichern" : "Changelog erstellen"}</button>
    </div>
  `, () => {
    const bodyInput = $("#changelogBody");
    bodyInput.addEventListener("keydown", (event) => {
      if (!event.ctrlKey || event.key.toLowerCase() !== "b") return;
      event.preventDefault();
      const start = bodyInput.selectionStart;
      const end = bodyInput.selectionEnd;
      const selected = bodyInput.value.slice(start, end);
      const wrapped = selected ?`**${selected}**` : "****";
      bodyInput.setRangeText(wrapped, start, end, "end");
      if (!selected) bodyInput.setSelectionRange(start + 2, start + 2);
    });
    $("#cancelChangelog").addEventListener("click", closeModal);
    $("#saveChangelog").addEventListener("click", async () => {
      const body = $("#changelogBody").value.trim();
      if (!body) return showNotify("Bitte einen Changelog-Text eintragen.", "error");
      const data = await api(isEdit ?`/api/changelog/${entry.id}` : "/api/changelog", {
        method: isEdit ?"PATCH" : "POST",
        body: JSON.stringify({
          type: $("#changelogType").value,
          body
        })
      });
      state.settings = data.settings || state.settings;
      closeModal();
      renderChangelog();
    });
  });
}

function openDeleteChangelogModal(entryId) {
  const entry = changelogEntries().find((item) => item.id === entryId);
  if (!entry) return showNotify("Changelog nicht gefunden.", "error");
  openConfirmModal({
    title: "Changelog löschen",
    text: `${entry.version || ""} wirklich löschen?`,
    confirmText: "Löschen",
    onConfirm: async () => {
      const data = await api(`/api/changelog/${entryId}`, { method: "DELETE" });
      state.settings = data.settings || state.settings;
      renderChangelog();
    }
  });
}

function openBackupRestoreModal(backupId) {
  const backup = (state.settings?.backups || []).find((item) => item.id === backupId);
  if (!backup) return showNotify("Backup nicht gefunden.", "error");
  openModal(`
    <h3>Backup einspielen</h3>
    <p class="muted">Dieses Backup vom ${escapeHtml(formatDateTime(backup.createdAt))} ersetzt den aktuellen Online-Stand. Danach werden alle aktiven Sitzungen abgemeldet.</p>
    <div class="info-box full">
      <strong>Backup-Details</strong>
      <p>${escapeHtml(backup.type)} · ${Number(backup.changesSinceLast || 0).toLocaleString("de-DE")} Änderungen seit vorherigem Backup · ${formatBytes(backup.sizeBytes)}</p>
    </div>
    <label class="checkbox-line">Ich verstehe, dass die aktuellen Online-Daten ersetzt werden.<input type="checkbox" id="confirmBackupRestore"></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="red-btn" id="runBackupRestore">Backup einspielen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#runBackupRestore").addEventListener("click", async () => {
      if (!modal.querySelector("#confirmBackupRestore").checked) {
        modal.querySelector("#modalError").textContent = "Bitte die Sicherheitsabfrage bestätigen.";
        return;
      }
      try {
        const data = await api(`/api/it/backups/${backupId}/restore`, { method: "POST", body: "{}" });
        clearAuthToken();
        state.token = "";
        state.currentUser = null;
        closeModal();
        showNotify(`Backup eingespielt: ${data.users} Benutzer wiederhergestellt. Bitte neu einloggen.`, "success");
        window.setTimeout(() => window.location.reload(), 900);
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message || "Wiederherstellung fehlgeschlagen.";
      }
    });
  });
}

function renderPostfach() {
  const unread = unreadMailboxItems();
  const rows = uniqueById(state.settings.informationDocChanges || []);
  const unreadIds = new Set(unread.map((item) => item.id));
  const mailboxView = localStorage.getItem("lspd_mailbox_view") || "changes";
  const threads = state.mailboxThreads || [];
  const selectedThreadId = localStorage.getItem("lspd_mailbox_thread") || threads[0]?.id || "";
  const activeThread = threads.find((thread) => thread.id === selectedThreadId) || threads[0] || null;
  if (mailboxView === "messages" && activeThread && activeThread.unreadCount) markMailboxThreadRead(activeThread.id).catch(() => {});
  const filteredRows = mailboxView === "unread" ?rows.filter((change) => unreadIds.has(change.id)) : rows;
  const latest = rows[0];
  const chatUnread = threads.reduce((sum, thread) => sum + Number(thread.unreadCount || 0), 0);
  const visibleChanges = mailboxView === "inbox" ?filteredRows : filteredRows;
  content.innerHTML = `
    <section class="mailbox-shell">
      <div class="mailbox-hero">
        <div>
          <span class="mailbox-kicker">Interne Mail</span>
          <h3>Postfach</h3>
          <p>Vorschriften-Änderungen und interne Chats laufen hier zentral zusammen.</p>
        </div>
        <div class="mailbox-hero-actions">
          <div class="mailbox-summary-grid">
            <span><b>${unread.length}</b><small>Ungelesen</small></span>
            <span><b>${rows.length}</b><small>Vorschriften</small></span>
            <span><b>${threads.length}</b><small>Chats</small></span>
          </div>
          <button class="blue-btn" id="newMailboxMessage" type="button">${iconSvg("Plus")} Neue Nachricht</button>
        </div>
      </div>
      <div class="mailbox-tabs" role="tablist">
        ${[
          ["changes", "Vorschriften Änderung", rows.length],
          ["unread", "Ungelesen", unread.length],
          ["inbox", "Posteingang", rows.length + threads.length],
          ["messages", "Nachrichten", threads.length]
        ].map(([key, label, count]) => `<button class="${mailboxView === key ?"active" : ""}" data-mailbox-view="${key}" type="button"><span>${escapeHtml(label)}</span><b>${count}</b></button>`).join("")}
      </div>
      <div class="mailbox-layout">
        <aside class="mailbox-side">
          <strong>${mailboxView === "messages" ?"Chats" : "Letzte Vorschriften Änderung"}</strong>
          ${latest ?`<span>${escapeHtml(latest.title || "Vorschrift")}</span><small>${escapeHtml(latest.author || "-")} · ${formatDateTime(latest.createdAt)}</small>` : `<span>Keine Änderung vorhanden</span><small>Noch keine Einträge.</small>`}
          <div class="mailbox-side-note">${chatUnread ?`${chatUnread} ungelesene Chat-Nachricht${chatUnread === 1 ?"" : "en"}.` : "Keine ungelesenen Chat-Nachrichten."}</div>
          <div class="mailbox-thread-list">
            ${threads.map((thread) => `
              <button class="${activeThread?.id === thread.id ?"active" : ""}" data-mail-thread="${escapeHtml(thread.id)}" type="button">
                <span><b>${escapeHtml(thread.title)}</b><small>${escapeHtml(thread.participants.map((user) => fullName(user)).join(", "))}</small></span>
                ${thread.unreadCount ?`<em>${thread.unreadCount}</em>` : ""}
              </button>
            `).join("") || `<p class="muted">Noch keine Chats.</p>`}
          </div>
        </aside>
        <section class="mailbox-list-panel">
          <div class="mailbox-list-head">
            <div><h4>${mailboxView === "messages" ?"Chat" : mailboxView === "unread" ?"Ungelesene Einträge" : "Vorschriften Änderungen"}</h4><p>${mailboxView === "messages" ?`${threads.length} Chats` : `${filteredRows.length} Einträge`}</p></div>
          </div>
          ${mailboxView === "messages" ?renderMailboxChat(activeThread) : `<div class="mailbox-list">
            ${visibleChanges.map((change) => {
          const read = !unreadIds.has(change.id);
          return `
            <article class="mailbox-row ${read ?"read" : "unread"}">
              <div class="mailbox-state">${read ?"Gelesen" : "Neu"}</div>
              <div class="mailbox-main">
                <strong>${escapeHtml(change.title || "Vorschrift")} wurde geändert</strong>
                <p>${escapeHtml(change.action || "geändert")} in einem Vorschriften-Dokument.</p>
              </div>
              <div class="button-row">
                <button class="blue-btn open-mail-doc" data-doc-id="${escapeHtml(change.docId)}" data-change-id="${escapeHtml(change.id)}">Änderung ansehen</button>
                ${read ?"" : `<button class="ghost-btn mark-mail-read" data-change-id="${escapeHtml(change.id)}">Als gelesen markieren</button>`}
                <button class="mini-icon danger delete-mail-message" data-change-id="${escapeHtml(change.id)}" title="Nachricht löschen">${actionIcon("delete")}</button>
              </div>
              <footer>${escapeHtml(change.author || "-")} · ${formatDateTime(change.createdAt)}</footer>
            </article>
          `;
        }).join("") || `<div class="mailbox-empty"><strong>Keine Einträge vorhanden.</strong><span>Hier ist gerade alles gelesen oder leer.</span></div>`}
          </div>`}
        </section>
      </div>
    </section>
  `;
  $("#newMailboxMessage")?.addEventListener("click", openNewMailboxThreadModal);
  document.querySelectorAll("[data-mailbox-view]").forEach((button) => button.addEventListener("click", () => {
    localStorage.setItem("lspd_mailbox_view", button.dataset.mailboxView);
    renderPostfach();
  }));
  document.querySelectorAll("[data-mail-thread]").forEach((button) => button.addEventListener("click", async () => {
    localStorage.setItem("lspd_mailbox_view", "messages");
    localStorage.setItem("lspd_mailbox_thread", button.dataset.mailThread);
    await markMailboxThreadRead(button.dataset.mailThread).catch(() => {});
    renderPostfach();
    renderNavigation();
  }));
  $("#mailboxSendMessage")?.addEventListener("click", () => sendMailboxMessage(activeThread?.id));
  $("#mailboxMessageBody")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMailboxMessage(activeThread?.id);
    }
  });
  document.querySelectorAll(".open-mail-doc").forEach((button) => button.addEventListener("click", () => {
    button.disabled = true;
    button.textContent = "Öffne...";
    markInformationChangeReadLocal(button.dataset.changeId);
    renderNavigation();
    openInformationDocChangelog(button.dataset.docId, button.dataset.changeId);
    markInformationChangeRead(button.dataset.changeId).catch((error) => showNotify(error.message, "error"));
  }));
  document.querySelectorAll(".mark-mail-read").forEach((button) => button.addEventListener("click", () => {
    markInformationChangeReadLocal(button.dataset.changeId);
    renderNavigation();
    renderPostfach();
    markInformationChangeRead(button.dataset.changeId).catch((error) => showNotify(error.message, "error"));
  }));
  document.querySelectorAll(".delete-mail-message").forEach((button) => button.addEventListener("click", async () => {
    await deleteMailboxMessage(button.dataset.changeId);
    renderApp();
  }));
}

function uniqueById(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = item?.id || JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderMailboxChat(thread) {
  if (!thread) return `<div class="mailbox-empty"><strong>Kein Chat ausgewählt.</strong><span>Starte eine neue Nachricht oder wähle links einen Chat aus.</span></div>`;
  const participants = thread.participants || [];
  return `
    <div class="mailbox-chat">
      <div class="mailbox-chat-head">
        <div><strong>${escapeHtml(thread.title)}</strong><small>${participants.length} Teilnehmer</small></div>
        <div class="mailbox-participants">${participants.map((user) => `<span>${escapeHtml(fullName(user))}</span>`).join("")}</div>
      </div>
      <div class="mailbox-chat-messages">
        ${(thread.messages || []).map((message) => {
          const own = message.senderId === state.currentUser.id;
          return `<article class="mailbox-chat-message ${own ?"own" : ""}">
            <small>${escapeHtml(fullName(message.sender || {}))} · ${formatDateTime(message.createdAt)}</small>
            <p>${escapeHtml(message.body).replace(/\n/g, "<br>")}</p>
          </article>`;
        }).join("") || `<div class="mailbox-empty"><strong>Noch keine Nachricht.</strong><span>Schreib die erste Antwort.</span></div>`}
      </div>
      <div class="mailbox-chat-compose">
        <textarea id="mailboxMessageBody" rows="3" placeholder="Nachricht schreiben..."></textarea>
        <button class="blue-btn" id="mailboxSendMessage" type="button">Senden</button>
        <p id="mailboxChatError" class="form-error"></p>
      </div>
    </div>
  `;
}

async function markMailboxThreadRead(threadId) {
  if (!threadId) return;
  const data = await api(`/api/mailbox/threads/${threadId}/read`, { method: "POST", body: "{}", silent: true });
  state.mailboxThreads = data.mailboxThreads || state.mailboxThreads;
}

async function sendMailboxMessage(threadId) {
  if (!threadId) return;
  const body = $("#mailboxMessageBody")?.value.trim() || "";
  const attachments = mailboxPendingImage ?[mailboxPendingImage] : [];
  if (!body && !attachments.length) {
    $("#mailboxChatError").textContent = "Bitte eine Nachricht oder ein Bild eintragen.";
    return;
  }
  try {
    const data = await api(`/api/mailbox/threads/${threadId}/messages`, { method: "POST", body: JSON.stringify({ body, attachments }) });
    mailboxPendingImage = null;
    state.mailboxThreads = data.mailboxThreads || state.mailboxThreads;
    renderPostfach();
    renderNavigation();
  } catch (error) {
    $("#mailboxChatError").textContent = error.message;
  }
}

function updateMailboxImagePreview() {
  const preview = $("#mailboxImagePreview");
  if (!preview) return;
  preview.classList.toggle("hidden", !mailboxPendingImage);
  preview.innerHTML = mailboxPendingImage ?`
    <img src="${escapeHtml(mailboxPendingImage.dataUrl)}" alt="${escapeHtml(mailboxPendingImage.name || "Bild")}">
    <span>${escapeHtml(mailboxPendingImage.name || "Bild")}</span>
    <button class="mini-icon danger" id="clearMailboxImage" type="button" title="Bild entfernen">${actionIcon("delete")}</button>
  ` : "";
  $("#clearMailboxImage")?.addEventListener("click", () => {
    mailboxPendingImage = null;
    updateMailboxImagePreview();
  });
}

function handleMailboxImageFile(file) {
  if (!file) return;
  if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.type)) {
    $("#mailboxChatError").textContent = "Bitte nur PNG, JPG, GIF oder WEBP hochladen.";
    return;
  }
  if (file.size > 3 * 1024 * 1024) {
    $("#mailboxChatError").textContent = "Das Bild darf maximal 3 MB groß sein.";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    mailboxPendingImage = { type: "image", name: file.name, dataUrl: String(reader.result || "") };
    $("#mailboxChatError").textContent = "";
    updateMailboxImagePreview();
  };
  reader.onerror = () => {
    $("#mailboxChatError").textContent = "Bild konnte nicht gelesen werden.";
  };
  reader.readAsDataURL(file);
}

function openNewMailboxThreadModal() {
  const candidates = (state.users || []).filter((user) => user.id !== state.currentUser.id && !user.terminated && !user.locked);
  openModal(`
    <h3>Neue Nachricht</h3>
    <p class="muted">Wähle eine oder mehrere Personen aus. Alle ausgewählten Personen sehen denselben Chat.</p>
    <label>Titel<input id="mailboxThreadTitle" placeholder="Betreff / Chatname"></label>
    <label>Personen auswählen<select id="mailboxParticipants" multiple size="8">${candidates.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(fullName(user))} - DN ${escapeHtml(user.dn || "-")}</option>`).join("")}</select></label>
    <label>Nachricht<textarea id="mailboxThreadBody" rows="5" placeholder="Nachricht schreiben..."></textarea></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="blue-btn" id="createMailboxThread" type="button">Chat erstellen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#createMailboxThread").addEventListener("click", async () => {
      const participantIds = [...modal.querySelector("#mailboxParticipants").selectedOptions].map((option) => option.value);
      try {
        const data = await api("/api/mailbox/threads", {
          method: "POST",
          body: JSON.stringify({
            title: modal.querySelector("#mailboxThreadTitle").value,
            participantIds,
            body: modal.querySelector("#mailboxThreadBody").value
          })
        });
        state.mailboxThreads = data.mailboxThreads || state.mailboxThreads;
        localStorage.setItem("lspd_mailbox_view", "messages");
        localStorage.setItem("lspd_mailbox_thread", data.thread?.id || "");
        closeModal();
        renderPostfach();
        renderNavigation();
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

function renderPostfach() {
  const unread = unreadMailboxItems();
  const docChanges = visibleInformationDocChangesForUser(state.settings.informationDocChanges || []);
  const unreadIds = new Set(unread.map((item) => item.id));
  const allThreads = state.mailboxThreads || [];
  const storedMailboxView = localStorage.getItem("lspd_mailbox_view");
  const docUnreadChanges = docChanges.filter((change) => unreadIds.has(change.id));
  const mailboxView = ["unread", "archive", "messages", "chatArchive"].includes(storedMailboxView) ?storedMailboxView : docUnreadChanges.length ?"unread" : "messages";
  const chatArchiveThreads = allThreads.filter((thread) => thread.deleted);
  const threads = mailboxView === "chatArchive" ?chatArchiveThreads : allThreads.filter((thread) => !thread.deleted);
  const selectedThreadId = localStorage.getItem("lspd_mailbox_thread") || threads[0]?.id || "";
  const activeThread = threads.find((thread) => thread.id === selectedThreadId) || threads[0] || null;
  if (mailboxView === "messages" && activeThread?.unreadCount) markMailboxThreadRead(activeThread.id).catch(() => {});
  const chatUnread = allThreads.filter((thread) => !thread.deleted).reduce((sum, thread) => sum + Number(thread.unreadCount || 0), 0);
  const unreadThreadIds = allThreads.filter((thread) => !thread.deleted && Number(thread.unreadCount || 0) > 0).map((thread) => thread.id);
  const visibleChanges = mailboxView === "unread" ?docUnreadChanges : docChanges;
  const canMarkAllRead = docUnreadChanges.length || unreadThreadIds.length;
  content.innerHTML = `
    <section class="mailbox-shell">
      <div class="mailbox-hero">
        <div>
          <span class="mailbox-kicker">Interne Mail</span>
          <h3>Postfach</h3>
          <p>Chats, Rückfragen und interne Hinweise laufen hier zusammen.</p>
        </div>
        <div class="mailbox-hero-actions">
          <div class="mailbox-summary-grid">
            ${docUnreadChanges.length ?`<button class="mailbox-alert-chip" id="openUnreadMailbox" type="button"><b>${docUnreadChanges.length}</b><small>Vorschriften-Ping${docUnreadChanges.length === 1 ?"" : "s"}</small></button>` : `<span><b>0</b><small>Vorschriften</small></span>`}
            <button class="mailbox-alert-chip ${mailboxView === "messages" ?"active" : ""}" id="openMainMailbox" type="button"><b>${allThreads.filter((thread) => !thread.deleted).length}</b><small>Chats</small></button>
            <button class="mailbox-alert-chip ${mailboxView === "archive" ?"active" : ""}" id="openDocArchiveMailbox" type="button"><b>${docChanges.length}</b><small>Vorschriften-Archiv</small></button>
            <button class="mailbox-alert-chip ${mailboxView === "chatArchive" ?"active" : ""}" id="openChatArchiveMailbox" type="button"><b>${chatArchiveThreads.length}</b><small>Chat-Archiv</small></button>
            <span><b>${chatUnread}</b><small>Ungelesen</small></span>
          </div>
          <button class="blue-btn" id="newMailboxMessage" type="button">${iconSvg("Plus")} Neuer Chat</button>
        </div>
      </div>
      <div class="mailbox-layout">
        <aside class="mailbox-side">
          <div class="mailbox-side-title">
            <strong>${mailboxView === "chatArchive" ?"Chat-Archiv" : "Chats"}</strong>
            <small>${mailboxView === "chatArchive" ?`${chatArchiveThreads.length} gelöscht` : chatUnread ?`${chatUnread} Ping${chatUnread === 1 ?"" : "s"}` : "Alles gelesen"}</small>
          </div>
          <div class="mailbox-thread-list open">
            ${threads.map((thread) => renderMailboxThreadButton(thread, activeThread)).join("") || `<p class="muted">${mailboxView === "chatArchive" ?"Keine gelöschten Chats." : "Keine Chats."}</p>`}
          </div>
        </aside>
        <section class="mailbox-list-panel">
          <div class="mailbox-list-head">
            <div><h4>${mailboxView === "messages" || mailboxView === "chatArchive" ?"Chat" : mailboxView === "archive" ?"Vorschriften-Archiv" : "Ungelesene Benachrichtigungen"}</h4><p>${mailboxView === "messages" || mailboxView === "chatArchive" ?`${threads.length} Chat${threads.length === 1 ?"" : "s"} sichtbar` : `${visibleChanges.length} Einträge`}</p></div>
            ${canMarkAllRead ?`<button class="ghost-btn compact-action" id="markAllMailboxRead" type="button">Alle als gelesen markieren</button>` : ""}
          </div>
          ${mailboxView === "messages" || mailboxView === "chatArchive" ?renderMailboxChat(activeThread) : renderMailboxDocChanges(visibleChanges, unreadIds)}
        </section>
      </div>
    </section>
  `;
  $("#newMailboxMessage")?.addEventListener("click", openNewMailboxThreadModal);
  $("#openMainMailbox")?.addEventListener("click", () => {
    localStorage.setItem("lspd_mailbox_view", "messages");
    renderPostfach();
  });
  $("#openUnreadMailbox")?.addEventListener("click", () => {
    localStorage.setItem("lspd_mailbox_view", "unread");
    renderPostfach();
  });
  $("#openDocArchiveMailbox")?.addEventListener("click", () => {
    localStorage.setItem("lspd_mailbox_view", mailboxView === "archive" ?"messages" : "archive");
    renderPostfach();
  });
  $("#openChatArchiveMailbox")?.addEventListener("click", () => {
    localStorage.setItem("lspd_mailbox_view", mailboxView === "chatArchive" ?"messages" : "chatArchive");
    localStorage.removeItem("lspd_mailbox_thread");
    renderPostfach();
  });
  document.querySelectorAll(".mailbox-thread-open").forEach((button) => button.addEventListener("click", async () => {
    const thread = (state.mailboxThreads || []).find((item) => item.id === button.dataset.mailThread);
    localStorage.setItem("lspd_mailbox_view", thread?.deleted ?"chatArchive" : "messages");
    localStorage.setItem("lspd_mailbox_thread", button.dataset.mailThread);
    if (thread?.unreadCount) updateMailboxThreadLocal(button.dataset.mailThread, (item) => ({ ...item, unreadCount: 0 }));
    renderPostfach();
    renderNavigation();
    markMailboxThreadRead(button.dataset.mailThread).catch(() => {});
  }));
  document.querySelectorAll(".mailbox-delete-thread").forEach((button) => button.addEventListener("click", () => deleteMailboxThread(button.dataset.mailThread)));
  document.querySelectorAll(".mailbox-restore-thread").forEach((button) => button.addEventListener("click", () => unarchiveMailboxThread(button.dataset.mailThread)));
  $("#mailboxManagePeople")?.addEventListener("click", () => openMailboxParticipantsModal(activeThread));
  $("#mailboxArchiveCurrent")?.addEventListener("click", () => activeThread?.deleted || activeThread?.archived ?unarchiveMailboxThread(activeThread.id) : archiveMailboxThread(activeThread?.id));
  $("#mailboxSendMessage")?.addEventListener("click", () => sendMailboxMessage(activeThread?.id));
  $("#mailboxMessageBody")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMailboxMessage(activeThread?.id);
    }
  });
  $("#mailboxImageBtn")?.addEventListener("click", () => $("#mailboxImageInput")?.click());
  $("#mailboxImageInput")?.addEventListener("change", (event) => handleMailboxImageFile(event.target.files?.[0]));
  $("#markAllMailboxRead")?.addEventListener("click", () => {
    const changeIds = docUnreadChanges.map((change) => change.id);
    markInformationChangesReadLocal(changeIds);
    unreadThreadIds.forEach((threadId) => updateMailboxThreadLocal(threadId, (item) => ({ ...item, unreadCount: 0 })));
    renderPostfach();
    renderNavigation();
    Promise.all([
      changeIds.length ?markInformationChangesRead(changeIds) : Promise.resolve(),
      ...unreadThreadIds.map((threadId) => markMailboxThreadRead(threadId))
    ]).catch((error) => showNotify(error.message, "error"));
  });
  const compose = $(".mailbox-chat-compose");
  compose?.addEventListener("dragover", (event) => {
    event.preventDefault();
    compose.classList.add("drag-over");
  });
  compose?.addEventListener("dragleave", () => compose.classList.remove("drag-over"));
  compose?.addEventListener("drop", (event) => {
    event.preventDefault();
    compose.classList.remove("drag-over");
    handleMailboxImageFile(event.dataTransfer?.files?.[0]);
  });
  updateMailboxImagePreview();
  document.querySelectorAll(".mailbox-open-doc").forEach((button) => button.addEventListener("click", () => {
    markInformationChangeReadLocal(button.dataset.changeId);
    renderNavigation();
    openInformationDocChangelog(button.dataset.docId, button.dataset.changeId);
    markInformationChangeRead(button.dataset.changeId).catch((error) => showNotify(error.message, "error"));
  }));
  document.querySelectorAll(".mailbox-mark-read").forEach((button) => button.addEventListener("click", () => {
    markInformationChangeReadLocal(button.dataset.changeId);
    renderPostfach();
    renderNavigation();
    markInformationChangeRead(button.dataset.changeId).catch((error) => showNotify(error.message, "error"));
  }));
  document.querySelectorAll(".mailbox-delete-change").forEach((button) => button.addEventListener("click", async () => {
    openDeleteMailboxMessageModal(button.dataset.changeId);
  }));
}

function openDeleteMailboxMessageModal(changeId) {
  const change = (state.settings.informationDocChanges || []).find((item) => item.id === changeId);
  openModal(`
    <h3>Hinweis entfernen?</h3>
    <p class="muted">"${escapeHtml(change?.title || "Dieser Vorschriften-Hinweis")}" wird nur aus deinem Postfach entfernt.</p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="red-btn" id="confirmMailboxChangeDelete" type="button">Entfernen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmMailboxChangeDelete").addEventListener("click", () => {
      closeModal();
      const savePromise = deleteMailboxMessage(changeId);
      renderPostfach();
      renderNavigation();
      savePromise.catch((error) => showNotify(error.message, "error"));
    });
  });
}

function renderMailboxDocChanges(changes, unreadIds) {
  return `<div class="mailbox-list">
    ${changes.map((change) => {
      const read = !unreadIds.has(change.id);
      return `
        <article class="mailbox-row ${read ?"read" : "unread"}">
          <div class="mailbox-main">
            <strong>${escapeHtml(change.title || "Vorschriften Änderung")}</strong>
            <p>${escapeHtml(change.action || "geändert")} in einem Vorschriften-Dokument.</p>
          </div>
          <span class="mailbox-state">${read ?"Gelesen" : "Neu"}</span>
          <footer>${escapeHtml(change.author || "System")} · ${formatDateTime(change.createdAt)}</footer>
          <div class="button-row">
            <button class="blue-btn compact-action mailbox-open-doc" data-doc-id="${escapeHtml(change.docId)}" data-change-id="${escapeHtml(change.id)}" type="button">Öffnen</button>
            ${read ?"" : `<button class="ghost-btn compact-action mailbox-mark-read" data-change-id="${escapeHtml(change.id)}" type="button">Gelesen</button>`}
            <button class="mini-icon danger mailbox-delete-change" data-change-id="${escapeHtml(change.id)}" type="button" title="Entfernen">${actionIcon("delete")}</button>
          </div>
        </article>
      `;
    }).join("") || `<div class="mailbox-empty"><strong>Keine Einträge.</strong><span>Hier erscheinen Vorschriften-Änderungen und ungelesene Hinweise.</span></div>`}
  </div>`;
}

function renderMailboxThreadButton(thread, activeThread) {
  const participants = (thread.activeParticipants || thread.participants || []).filter((user) => user.id !== state.currentUser.id);
  return `
    <article class="mailbox-thread-card ${activeThread?.id === thread.id ?"active" : ""} ${thread.deleted ?"is-deleted" : ""} ${thread.removed ?"is-removed" : ""}">
      <button class="mailbox-thread-open" data-mail-thread="${escapeHtml(thread.id)}" type="button">
        <span><b>${escapeHtml(thread.title)}</b><small>${thread.removed ?"Du wurdest entfernt" : thread.deleted ?"Für dich gelöscht" : escapeHtml(participants.map((user) => fullName(user)).join(", ") || "Nur du")}</small></span>
        ${thread.unreadCount ?`<em>${thread.unreadCount}</em>` : ""}
      </button>
      <div class="mailbox-thread-actions">
        ${thread.deleted ?`<button class="mini-icon mailbox-restore-thread" data-mail-thread="${escapeHtml(thread.id)}" title="Chat wieder anzeigen" type="button">${actionIcon("edit")}</button>` : `<button class="mini-icon danger mailbox-delete-thread" data-mail-thread="${escapeHtml(thread.id)}" title="Chat nur für dich löschen" type="button">${actionIcon("delete")}</button>`}
      </div>
    </article>
  `;
}

function renderMailboxMessageBody(message) {
  const body = message.body ?`<p>${linkifyText(message.body).replace(/\n/g, "<br>")}</p>` : "";
  const attachments = (message.attachments || []).map((attachment) => {
    if (attachment.type !== "image" || !attachment.dataUrl) return "";
    return `<a class="mailbox-image-link" href="${escapeHtml(attachment.dataUrl)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(attachment.dataUrl)}" alt="${escapeHtml(attachment.name || "Chat-Bild")}"></a>`;
  }).join("");
  return `${body}${attachments ?`<div class="mailbox-attachments">${attachments}</div>` : ""}`;
}

function renderMailboxChat(thread) {
  if (!thread) return `<div class="mailbox-empty"><strong>Kein Chat ausgewählt.</strong><span>Starte einen neuen Chat oder wähle links einen Chat aus.</span></div>`;
  const participants = thread.activeParticipants || thread.participants || [];
  const canWrite = Boolean(thread.canWrite);
  return `
    <div class="mailbox-chat">
      <div class="mailbox-chat-head">
        <div class="mailbox-chat-title">
          <div><strong>${escapeHtml(thread.title)}</strong><small>${participants.length} Teilnehmer</small></div>
          <div class="button-row">
            ${canWrite ?`<button class="ghost-btn" id="mailboxManagePeople" type="button">Personen verwalten</button>` : ""}
            ${thread.deleted ?`<button class="ghost-btn" id="mailboxArchiveCurrent" type="button">Chat wieder anzeigen</button>` : `<button class="ghost-btn" id="mailboxArchiveCurrent" type="button">${thread.archived ?"Chat aktivieren" : "Chat minimieren"}</button>`}
          </div>
        </div>
        <div class="mailbox-participants">${participants.map((user) => `<span>${escapeHtml(fullName(user))}</span>`).join("")}</div>
        ${thread.removed ?`<p class="mailbox-chat-notice">Du wurdest aus diesem Chat entfernt. Du siehst nur Nachrichten bis zu deiner Entfernung und kannst nicht mehr antworten.</p>` : ""}
        ${thread.deleted ?`<p class="mailbox-chat-notice">Dieser Chat ist für dich gelöscht und liegt im Chat-Archiv.</p>` : ""}
      </div>
      <div class="mailbox-chat-messages">
        ${(thread.messages || []).map((message) => {
          const own = message.senderId === state.currentUser.id;
          return `<article class="mailbox-chat-message ${own ?"own" : ""}">
            <small>${escapeHtml(fullName(message.sender || {}))} · ${formatDateTime(message.createdAt)}</small>
            ${renderMailboxMessageBody(message)}
          </article>`;
        }).join("") || `<div class="mailbox-empty"><strong>Noch keine Nachricht.</strong><span>Schreib die erste Antwort.</span></div>`}
      </div>
      ${canWrite ?`<div class="mailbox-chat-compose">
        <textarea id="mailboxMessageBody" rows="3" placeholder="Nachricht schreiben..."></textarea>
        <input id="mailboxImageInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
        <button class="ghost-btn" id="mailboxImageBtn" type="button">Bild</button>
        <button class="blue-btn" id="mailboxSendMessage" type="button">Senden</button>
        <div id="mailboxImagePreview" class="mailbox-image-preview hidden"></div>
        <p id="mailboxChatError" class="form-error"></p>
      </div>` : `<div class="mailbox-empty compact"><strong>Antworten nicht möglich.</strong><span>${thread.removed ?"Du bist kein aktiver Teilnehmer mehr." : "Stelle den Chat erst wieder her."}</span></div>`}
    </div>
  `;
}

function updateMailboxThreadLocal(threadId, updater) {
  let changed = false;
  state.mailboxThreads = (state.mailboxThreads || []).map((thread) => {
    if (thread.id !== threadId) return thread;
    changed = true;
    return updater({ ...thread });
  });
  return changed;
}

function syncMailboxThreadsFromResponse(data) {
  if (data?.mailboxThreads) state.mailboxThreads = data.mailboxThreads;
  renderNavigation();
}

async function archiveMailboxThread(threadId) {
  if (!threadId) return;
  const previousThreads = state.mailboxThreads;
  updateMailboxThreadLocal(threadId, (thread) => ({ ...thread, archived: true }));
  renderPostfach();
  renderNavigation();
  api(`/api/mailbox/threads/${threadId}/archive`, { method: "POST", body: "{}", silent: true })
    .then(syncMailboxThreadsFromResponse)
    .catch((error) => {
      state.mailboxThreads = previousThreads;
      renderPostfach();
      showNotify(error.message, "error");
    });
}

async function unarchiveMailboxThread(threadId) {
  if (!threadId) return;
  const previousThreads = state.mailboxThreads;
  updateMailboxThreadLocal(threadId, (thread) => ({ ...thread, archived: false, deleted: false }));
  localStorage.setItem("lspd_mailbox_view", "messages");
  localStorage.setItem("lspd_mailbox_thread", threadId);
  renderPostfach();
  renderNavigation();
  api(`/api/mailbox/threads/${threadId}/unarchive`, { method: "POST", body: "{}", silent: true })
    .then(syncMailboxThreadsFromResponse)
    .catch((error) => {
      state.mailboxThreads = previousThreads;
      renderPostfach();
      showNotify(error.message, "error");
    });
}

async function deleteMailboxThread(threadId) {
  if (!threadId) return;
  const thread = (state.mailboxThreads || []).find((item) => item.id === threadId);
  openModal(`
    <h3>Chat löschen?</h3>
    <p class="muted">"${escapeHtml(thread?.title || "Dieser Chat")}" wird nur für dich ins Chat-Archiv verschoben. Andere Teilnehmer behalten den Chat.</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="red-btn" id="confirmMailboxDelete" type="button">Für mich löschen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmMailboxDelete").addEventListener("click", () => {
      closeModal();
      performDeleteMailboxThread(threadId);
    });
  });
}

function performDeleteMailboxThread(threadId) {
  const previousThreads = state.mailboxThreads;
  updateMailboxThreadLocal(threadId, (thread) => ({ ...thread, deleted: true, unreadCount: 0 }));
  if (localStorage.getItem("lspd_mailbox_thread") === threadId) localStorage.removeItem("lspd_mailbox_thread");
  renderPostfach();
  renderNavigation();
  api(`/api/mailbox/threads/${threadId}/delete`, { method: "POST", body: "{}", silent: true })
    .then(syncMailboxThreadsFromResponse)
    .catch((error) => {
      state.mailboxThreads = previousThreads;
      renderPostfach();
      showNotify(error.message, "error");
    });
}

function mailboxUserSearchText(user) {
  return `${fullName(user)} ${user.dn || ""} ${rankLabel(user.rank)} ${user.role || ""}`.toLowerCase();
}

function renderMailboxUserPicker(modal, candidates, selectedIds) {
  const query = (modal.querySelector("#mailboxUserSearch")?.value || "").trim().toLowerCase();
  const picker = modal.querySelector("#mailboxUserPicker");
  const visible = candidates.filter((user) => !query || mailboxUserSearchText(user).includes(query)).slice(0, 80);
  picker.innerHTML = visible.map((user) => {
    const checked = selectedIds.has(user.id);
    return `
      <label class="mailbox-user-row">
        <span>
          <strong>${escapeHtml(fullName(user))}</strong>
          <small>DN ${escapeHtml(user.dn || "-")} · ${escapeHtml(rankLabel(user.rank))}</small>
        </span>
        <input type="checkbox" data-mailbox-user="${escapeHtml(user.id)}" ${checked ?"checked" : ""}>
      </label>
    `;
  }).join("") || `<div class="mailbox-empty"><strong>Keine Personen gefunden.</strong><span>Prüfe deine Suche.</span></div>`;
  picker.querySelectorAll("[data-mailbox-user]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    if (checkbox.checked) selectedIds.add(checkbox.dataset.mailboxUser);
    else selectedIds.delete(checkbox.dataset.mailboxUser);
    renderMailboxUserPicker(modal, candidates, selectedIds);
  }));
}

function openNewMailboxThreadModal() {
  const candidates = (state.users || []).filter((user) => user.id !== state.currentUser.id && !user.terminated && !user.locked);
  openModal(`
    <h3>Neuer Chat</h3>
    <p class="muted">Suche Personen und füge mehrere direkt hinzu.</p>
    <label>Titel<input id="mailboxThreadTitle" placeholder="Betreff / Chatname"></label>
    <label>Personen suchen<input id="mailboxUserSearch" placeholder="Name, DN oder Rolle suchen"></label>
    <div id="mailboxUserPicker" class="mailbox-user-picker"></div>
    <label>Nachricht<textarea id="mailboxThreadBody" rows="5" placeholder="Nachricht schreiben..."></textarea></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="blue-btn" id="createMailboxThread" type="button">Chat erstellen</button>
    </div>
  `, (modal) => {
    const selectedIds = new Set();
    const renderPicker = () => renderMailboxUserPicker(modal, candidates, selectedIds);
    modal.querySelector("#mailboxUserSearch").addEventListener("input", renderPicker);
    renderPicker();
    modal.querySelector("#createMailboxThread").addEventListener("click", async () => {
      try {
        const data = await api("/api/mailbox/threads", {
          method: "POST",
          body: JSON.stringify({
            title: modal.querySelector("#mailboxThreadTitle").value,
            participantIds: [...selectedIds],
            body: modal.querySelector("#mailboxThreadBody").value
          })
        });
        state.mailboxThreads = data.mailboxThreads || state.mailboxThreads;
        localStorage.setItem("lspd_mailbox_thread", data.thread?.id || "");
        closeModal();
        renderPostfach();
        renderNavigation();
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

function openMailboxParticipantsModal(thread) {
  if (!thread) return;
  const candidates = (state.users || []).filter((user) => !user.terminated && !user.locked);
  const selectedIds = new Set(thread.activeParticipantIds || thread.participantIds || []);
  selectedIds.add(state.currentUser.id);
  openModal(`
    <h3>Chat verwalten</h3>
    <p class="muted">Personen für "${escapeHtml(thread.title)}" hinzufügen oder entfernen.</p>
    <label>Personen suchen<input id="mailboxUserSearch" placeholder="Name, DN oder Rolle suchen"></label>
    <div id="mailboxUserPicker" class="mailbox-user-picker"></div>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="blue-btn" id="saveMailboxThreadPeople" type="button">Speichern</button>
    </div>
  `, (modal) => {
    const renderPicker = () => renderMailboxUserPicker(modal, candidates, selectedIds);
    modal.querySelector("#mailboxUserSearch").addEventListener("input", renderPicker);
    renderPicker();
    modal.querySelector("#saveMailboxThreadPeople").addEventListener("click", async () => {
      selectedIds.add(state.currentUser.id);
      try {
        const data = await api(`/api/mailbox/threads/${thread.id}`, {
          method: "PATCH",
          body: JSON.stringify({ participantIds: [...selectedIds] })
        });
        state.mailboxThreads = data.mailboxThreads || state.mailboxThreads;
        closeModal();
        renderPostfach();
        renderNavigation();
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

function renderExamModuleStart(exam, candidate) {
  const nextModule = exam.kind === "est" ?estMainModules(exam).find((module) => module.status !== "Abgeschlossen") : exam.modules.find((module) => module.status !== "Abgeschlossen");
  if (nextModule) {
    exam.activeMainModuleId = nextModule.id;
    exam.moduleIndex = exam.modules.findIndex((module) => module.id === nextModule.id);
  }
  const flow = exam.kind === "est"
    ?[
      ["1", "Rechtskunde + Ortskunde", "Rechtsfragen links, Ortskunde rechts parallel."],
      ["2", "10-80 Szenario", "Großes Szenariofeld mit Prüferinfos und Akte/Maßnahme."],
      ["3", "Dienstvorschriften + Fahrstrecke", "Vorschriften links, Fahrstrecke rechts mit Zeitwertung."],
      ["4", "Helistrecke", "Route und Landedächer mit Bild, Zeit und Bewertung."]
    ]
    : [];
  return `
    <section class="exam-runner-card exam-module-start-card compact-start">
      <span>Prüfung vorbereiten</span>
      <h4>${escapeHtml(candidate ?fullName(candidate) : "Unbekannter Prüfling")}</h4>
      <div class="exam-setup-row">
        <label class="exam-setup-second">2. Prüfer optional<select id="examSetupSecondExaminer"><option value=""></option>${state.users.map((user) => `<option value="${user.id}" ${exam.secondExaminerId === user.id ?"selected" : ""}>${escapeHtml(fullName(user))}</option>`).join("")}</select></label>
      </div>
      <input type="hidden" data-start-module-id="${escapeHtml(nextModule?.id || "")}">
      <div class="est-fixed-flow">
        <strong>${exam.status === "Vorbereitung" ?"Startet automatisch mit Rechtskunde" : `Nächstes Modul: ${escapeHtml(nextModule?.name || "-")}`}</strong>
        ${flow.map(([nr, title, text]) => `<span class="${nextModule?.name && title.includes(nextModule.name) ?"active" : ""}"><b>${nr}</b><i>${escapeHtml(title)}</i><small>${escapeHtml(text)}</small></span>`).join("")}
      </div>
      <p class="muted">Die Reihenfolge ist fest. Das Startfenster wird erst gespeichert, wenn die Prüfung wirklich gestartet wurde.</p>
    </section>
  `;
}

function renderExamModuleStepper(exam) {
  ensureExamModuleState(exam);
  const module = currentManagedExamModule(exam);
  return `<div class="exam-current-module-chip"><span>Aktuelles Modul</span><strong>${escapeHtml(module?.name || "-")}</strong><small>${escapeHtml(module?.status || exam.status || "-")}</small></div>`;
}

function renderCatalogQuestion(question, index, side = "main") {
  const maxPoints = Number(question.maxPoints || 1);
  const timed = maxPoints > 1 || Number(question.targetSeconds || 0) > 0;
  const scoreValues = timed ?Array.from({ length: Math.floor(maxPoints) + 1 }, (_, value) => value) : scoreOptionsForQuestion(question, side === "location" || question.type === "location");
  const scoreClass = (value) => `score-select score-${String(value || 0).replace(".", "-")}`;
  const scorePanel = (html) => `<div class="question-score-row"><span>Bewertung</span>${html}</div>`;
  if (side === "location" || question.type === "location") {
    const actualPoints = timedQuestionPoints(question);
    return `
      <article class="exam-catalog-question score-left-question location-question" data-question-id="${escapeHtml(question.id)}">
        ${scorePanel(timed
          ?`<strong class="auto-time-score">${String(actualPoints).replace(".", ",")} / ${escapeHtml(maxPoints)}</strong><input type="hidden" data-exam-score="${escapeHtml(question.id)}" value="${escapeHtml(actualPoints)}">`
          : `<select class="${scoreClass(question.manualPoints)}" data-exam-score="${escapeHtml(question.id)}">${scoreValues.map((value) => `<option value="${value}" ${Number(question.manualPoints || 0) === value ?"selected" : ""}>${String(value).replace(".", ",")}</option>`).join("")}</select>`)}
        <div class="question-content-box">
          <div class="catalog-question-head"><b>${index + 1}. ${escapeHtml(question.prompt)}</b><small>${timed ?"Zeitwertung" : "Bild / Strecke"}</small></div>
          ${question.image ?`<img class="location-question-image" src="${escapeHtml(question.image)}" alt="">` : ""}
          ${timed ?`<div class="time-score-row"><label>Sollzeit<input data-autosave-exam data-exam-target="${escapeHtml(question.id)}" value="${escapeHtml(formatSecondsInput(question.targetSeconds || 0))}" placeholder="MM:SS"></label><label>Gefahrene Zeit<input data-autosave-exam data-exam-time="${escapeHtml(question.id)}" value="${escapeHtml(formatSecondsInput(question.timeSeconds || 0))}" placeholder="MM:SS"></label></div>` : ""}
          ${question.solution ?`<div class="inline-solution">${escapeHtml(question.solution)}</div>` : ""}
        </div>
      </article>
    `;
  }
  if (question.type === "choice" || question.type === "scenario") {
    const answers = question.type === "scenario" ?[] : (question.answers || normalizeChoiceAnswers(question));
    return `
      <article class="exam-catalog-question score-right-question compact-choice-question" data-question-id="${escapeHtml(question.id)}">
        <div class="question-content-box">
          <div class="catalog-question-head"><b>${index + 1}. ${escapeHtml(question.prompt)}</b><small>Max. ${escapeHtml(maxPoints)} Punkte</small></div>
          ${question.scenarioInfo ?`<div class="scenario-info-box"><strong>Szenario</strong><p>${escapeHtml(question.scenarioInfo)}</p></div>` : ""}
          ${question.fileAction ?`<div class="scenario-info-box"><strong>Akte / Maßnahme</strong><p>${escapeHtml(question.fileAction)}</p></div>` : ""}
          ${answers.length ?`<div class="exam-answer-list neutral compact-answer-list">${answers.map((answer) => `<label class="exam-check compact-answer-row"><span>${escapeHtml(answer)}</span><input data-autosave-exam type="checkbox" name="answerOption_${escapeHtml(question.id)}" value="${escapeHtml(answer)}" ${question.selectedAnswers?.includes(answer) ?"checked" : ""}></label>`).join("")}</div>` : ""}
          <label>Antwort / Notizen des Prüflings<textarea data-autosave-exam data-exam-answer="${escapeHtml(question.id)}" placeholder="Antwort oder Ablauf mitschreiben">${escapeHtml(question.traineeAnswer || "")}</textarea></label>
          ${question.solution ?`<div class="inline-solution">Musterlösung: ${escapeHtml(question.solution)}</div>` : ""}
        </div>
        ${scorePanel(`<select class="${scoreClass(question.manualPoints)}" data-exam-score="${escapeHtml(question.id)}">${scoreValues.map((value) => `<option value="${value}" ${Number(question.manualPoints || 0) === value ?"selected" : ""}>${String(value).replace(".", ",")}</option>`).join("")}</select>`)}
      </article>
    `;
  }
  return `
    <article class="exam-catalog-question score-right-question" data-question-id="${escapeHtml(question.id)}">
      <div class="question-content-box">
        <div class="catalog-question-head"><b>${index + 1}. ${escapeHtml(question.prompt)}</b><small>Max. ${escapeHtml(maxPoints)} Punkte</small></div>
        <label>Antwort des Prüflings<textarea data-autosave-exam data-exam-answer="${escapeHtml(question.id)}" placeholder="Antwort mitschreiben">${escapeHtml(question.traineeAnswer || "")}</textarea></label>
        ${question.solution ?`<div class="inline-solution">Musterlösung: ${escapeHtml(question.solution)}</div>` : ""}
      </div>
      ${scorePanel(`<select class="${scoreClass(question.manualPoints)}" data-exam-score="${escapeHtml(question.id)}">${scoreValues.map((value) => `<option value="${value}" ${Number(question.manualPoints || 0) === value ?"selected" : ""}>${String(value).replace(".", ",")}</option>`).join("")}</select>`)}
    </article>
  `;
}

function renderDepartmentLeadershipPanel(department) {
  if (isHumanResourcesDepartmentSheet(department)) return renderHumanResourcesLeadershipPanel(department);
  const searchValue = localStorage.getItem(`lspd_leadership_search_${department.id}`) || "";
  const selectedRange = localStorage.getItem(`lspd_leadership_range_${department.id}`) || "Gesamt";
  const searchTerm = searchValue.trim();
  const myTeam = normalizeSwatTeam(mySwatMembership(department)?.swatTeam);
  const canSeeAllSwatTeams = hasRole("Direktion");
  const members = department.members.filter((member) => {
    if (isSwatDepartment(department)) {
      const memberTeam = normalizeSwatTeam(member.swatTeam);
      if (!canSeeAllSwatTeams && myTeam && memberTeam !== myTeam) return false;
    }
    const haystack = `${fullName(member.user)} ${member.position} ${rankLabel(member.user.rank)} ${member.user.dn || ""}`;
    return smartSearchMatch(haystack, searchTerm);
  }).sort((a, b) => {
    if (isSwatDepartment(department)) {
      const teamCompare = normalizeSwatTeam(a.swatTeam).localeCompare(normalizeSwatTeam(b.swatTeam), "de");
      if (teamCompare) return teamCompare;
      if (Boolean(a.swatTeamLeader) !== Boolean(b.swatTeamLeader)) return a.swatTeamLeader ?-1 : 1;
    }
    return (positionOrder[b.position] || 0) - (positionOrder[a.position] || 0) || fullName(a.user).localeCompare(fullName(b.user), "de");
  });
  return `
    <div class="panel department-overview-content">
      <div class="panel-header"><h3>Leitung</h3><span class="muted">${cleanText("Interne Mitglieder\u00fcbersicht")}</span></div>
      <div class="leadership-toolbar">
        <input id="leadershipSearch" value="${escapeHtml(searchValue)}" placeholder="Name, DN, Position oder Rang suchen">
        <label>Zeitraum
          <select id="leadershipRange">
            ${["Heute", "Woche", "Monat", "Gesamt"].map((range) => `<option ${selectedRange === range ?"selected" : ""}>${range}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="leadership-member-list">
        ${members.length ?members.map((member) => renderLeadershipMemberCard(department, member, selectedRange)).join("") : `<p class="muted">Keine Mitglieder gefunden.</p>`}
      </div>
    </div>
    ${isTrainingDepartmentSheet(department) && departmentActionAllowed(department, "departmentTrainingChecks") ?renderTrainingManagementPanels({ mode: "checks" }) : ""}
  `;
}

function dutyRangeStarts() {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return { Heute: dayStart, Woche: weekStart, Monat: monthStart, Gesamt: null };
}

function dutyRangeSumForUser(userId, range) {
  return dutySumForUser(userId, dutyRangeStarts()[range] || null);
}

function renderLeadershipMemberCard(department, member, selectedRange = "Gesamt") {
  const notes = (department.memberNotes || []).filter((note) => note.userId === member.userId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const ranges = ["Heute", "Woche", "Monat", "Gesamt"];
  return `
    <article class="leadership-member-card">
      <div class="leadership-member-head">
        <span>${avatarMarkup(member.user, "sm")}<strong>${escapeHtml(fullName(member.user))}</strong></span>
        <button class="blue-btn dept-member-note-add" data-user-id="${escapeHtml(member.userId)}">+ Interne Notiz</button>
      </div>
      <div class="leadership-facts">
        <span><b>Position</b>${escapeHtml(member.position)}</span>
        ${isSwatDepartment(department) ?`<span><b>Team</b>${escapeHtml(swatTeamLabel(member.swatTeam))}${member.swatTeamLeader ?` · Teamleiter` : ""}</span>` : ""}
        <span><b>In Abteilung seit</b>${formatDate(member.joinedAt)}</span>
        <span><b>Aktuelle Rolle seit</b>${formatDate(member.positionSince || member.joinedAt)}</span>
      </div>
      <div class="leadership-hours">
        ${ranges.map((range) => `<span class="${selectedRange === range ?"active" : ""}"><b>${range}</b>${formatDuration(dutyRangeSumForUser(member.userId, range))}</span>`).join("")}
      </div>
      <div class="leadership-notes">
        ${notes.length ?notes.map((note) => `<div><p>${escapeHtml(note.text)}</p><small>${escapeHtml(note.authorName || "-")} \u00b7 ${formatDate(note.createdAt)}</small></div>`).join("") : `<p class="muted">Keine internen Notizen.</p>`}
      </div>
    </article>
  `;
}

function renderDepartmentMemberTable(department) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Mitglied</th><th>Position</th><th>Rang</th></tr></thead>
        <tbody>
          ${department.members.map((member) => `
            <tr>
              <td><span class="member-name truncate"><span class="online-dot ${member.isOnDuty ?"online" : ""}"></span>${avatarMarkup(member.user, "sm")}<span>${escapeHtml(fullName(member.user))}</span></span></td>
              <td><span class="position-chip ${positionClass(member.position, department)}">${escapeHtml(member.position)}</span></td>
              <td><span class="department-rank-label">${escapeHtml(rankLabel(member.user.rank))}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDepartmentNote(department, note) {
  const priority = note.priority || "Info";
  const className = priority.toLowerCase();
  const teamBadge = isSwatDepartment(department) ?`<span class="badge dept-info">${note.team === "all" || !note.team ?"Alle Teams" : escapeHtml(swatTeamLabel(note.team))}</span>` : "";
  const align = ["left", "center", "right"].includes(note.align) ?note.align : "left";
  const textColor = note.textColor || "";
  const highlightColor = note.highlightColor || "";
  const style = [
    textColor ?`color:${escapeHtml(textColor)}` : "",
    highlightColor ?`background:${escapeHtml(highlightColor)}` : ""
  ].filter(Boolean).join(";");
  return `
    <article class="note-card">
      <div class="note-top">
        <div class="note-title"><strong>${escapeHtml(note.title)}</strong><span class="badge dept-${className}">${escapeHtml(priority)}</span>${teamBadge}</div>
        ${departmentActionAllowed(department, "departmentNotes") ?`<div class="note-actions">
          <button class="mini-icon edit-dept-note" data-department-id="${department.id}" data-note-id="${note.id}">${actionIcon("edit")}</button>
          <button class="mini-icon danger delete-dept-note" data-department-id="${department.id}" data-note-id="${note.id}">${actionIcon("delete")}</button>
        </div>` : ""}
      </div>
      <div class="department-note-body align-${escapeHtml(align)}" style="${style}">${formatDepartmentNoteText(note.text)}</div>
      <small class="muted">${escapeHtml(note.authorName)} · ${formatDate(note.createdAt)}</small>
    </article>
  `;
}

function formatDepartmentNoteText(value = "") {
  const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
  return lines.map((line) => {
    if (!line.trim()) return `<br>`;
    return `<div>${formatDepartmentInlineText(line)}</div>`;
  }).join("");
}

function positionClass(position, department = null) {
  return positionColorFor(department, position);
}

function renderProfileTrainingPanel(user) {
  const renderTrainingTile = (training) => {
    const done = Boolean(user.trainings?.[training]);
    const meta = user.trainingMeta?.[training] || {};
    const requirement = trainingRequirementText(training);
    const detail = trainingDetailText(training);
    const metaText = meta.completedAt
      ?`${formatDateTime(meta.completedAt)} · ${escapeHtml(meta.completedBy || "Unbekannt")}`
      : "Vor Systemumstellung";
    return `
      <div class="profile-training-row ${done ?"done" : "open"}">
        <span class="profile-training-info">
          <b class="profile-training-name">${escapeHtml(trainingDisplayName(training))}</b>
          <small>${escapeHtml(detail)}</small>
          ${requirement ?`<em>Voraussetzung für Rang: ${escapeHtml(requirement)}</em>` : ""}
        </span>
        <b class="profile-training-state">${done ?"Abgeschlossen" : "Offen"}${done ?`<small>${metaText}</small>` : ""}</b>
      </div>
    `;
  };
  return `
    <div class="panel-header"><h3>Ausbildung</h3></div>
    <div class="profile-training-group-grid">
      ${visibleTrainingGroups().map((group) => `
        <section class="profile-training-group">
          <h4>${escapeHtml(group.title)}</h4>
          <div class="profile-training-grid flat-training-grid">
            ${group.trainings.map(renderTrainingTile).join("")}
          </div>
        </section>
      `).join("")}
    </div>
  `;
}

function renderProfileFilePanel(user) {
  const entries = (state.disciplinary || [])
    .filter((entry) => entry.userId === user.id && entry.type !== "Aktennotiz")
    .filter((entry) => isSanctionFileEntry(entry) && ["active", "archive"].includes(sanctionWorkflowStatus(entry)))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const activeEntries = entries.filter(isOpenNegativeFileEntry);
  const archivedEntries = entries.filter((entry) => !isOpenNegativeFileEntry(entry));
  return `
    <div class="panel-header"><h3>Sanktionen & Geldstrafen</h3><span class="muted">${entries.length} Einträge</span></div>
    <div class="profile-file-grid">
      <section class="file-section sanctions">
        <div class="file-section-head"><h4>Aktiv</h4><span>${activeEntries.length}</span></div>
        <div class="personnel-file-list compact">${activeEntries.map((entry) => renderFileEntry(entry, { activeStrike: isActiveDisciplinaryStrike(entry), expired: entry.expiresAt && new Date(entry.expiresAt) <= new Date() })).join("") || `<p class="muted">Keine aktiven Sanktionen.</p>`}</div>
      </section>
      <section class="file-section history">
        <div class="file-section-head"><h4>Archiv</h4><span>${archivedEntries.length}</span></div>
        <div class="personnel-file-list compact">${archivedEntries.map((entry) => renderFileEntry(entry, { expired: entry.expiresAt && new Date(entry.expiresAt) <= new Date(), archive: true })).join("") || `<p class="muted">Noch kein Archiv.</p>`}</div>
      </section>
    </div>
  `;
}

function renderProfile() {
  const user = state.currentUser;
  const profileTabs = ["Ausbildung", "Dienstzeiten", "Abmeldung", "Sanktionen", "Anmeldung Prüfung"];
  const myHistory = (state.dutyHistory || []).filter((entry) => entry.userId === user.id).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  const trainingDone = visibleTrainings().filter((training) => Boolean(user.trainings?.[training])).length;
  const trainingTotal = visibleTrainings().length || 1;
  const trainingPercent = Math.round((trainingDone / trainingTotal) * 100);
  const sumDuty = (status = null) => myHistory
    .filter((entry) => !status || entry.status === status || (status === "Innendienst" && entry.status === "Admin Dienst"))
    .reduce((sum, entry) => sum + durationMs(entry), 0);
  content.innerHTML = `
    <section class="panel profile-hero">
      ${avatarMarkup(user, "xl")}
      <div class="profile-main">
        <strong>${escapeHtml(fullName(user))}</strong>
        <div class="profile-badges">
          <span class="rank-pill">${escapeHtml(rankLabel(user.rank))}</span>
          ${roleBadges(user)}
        </div>
        <div class="profile-inline-facts">
          <span><b>Dienstnummer</b>${escapeHtml(user.dn)}</span>
          <span><b>Telefon</b>${escapeHtml(user.phone)}</span>
          <span><b>Beitritt Datum</b>${formatDate(user.joinedAt)}</span>
        </div>
      </div>
      <div class="profile-actions">
        <button class="orange-btn action-btn" id="openPasswordModal">${iconSvg("IT")} Passwort ändern</button>
        <button class="blue-btn action-btn" id="avatarPickBtn">${iconSvg("Profil")} Avatar ändern</button>
        <input id="avatarFileInput" class="hidden" type="file" accept="image/*">
      </div>
    </section>
    <section class="profile-discord-strip">
      <span class="discord-status-dot ${user.discordId ?"linked" : ""}"></span>
      <div>
        <strong>Discord</strong>
        <small>${user.discordId ?`<span class="discord-hover-id" title="Discord ID: ${escapeHtml(user.discordId)}">${escapeHtml(user.discordName || "Discord Account")}</span>` : "Nicht verknüpft. Discord Login und Rollen-Sync sind erst nach der Verknüpfung aktiv."}</small>
      </div>
      <button class="ghost-btn compact-action" id="profileDiscordLinkSecondary" type="button">${user.discordId ?"Verbindung erneuern" : "Discord verknüpfen"}</button>
    </section>
    <section class="profile-discord-strip profile-twitch-strip">
      <span class="discord-status-dot twitch ${user.twitchLogin ?"linked" : ""}"></span>
      <div>
        <strong>Twitch</strong>
        <small>${twitchStatusText(user)}</small>
      </div>
      <div class="profile-strip-actions">
        ${user.twitchLogin ?`<button class="ghost-btn compact-action" id="profileTwitchCheck" type="button">Jetzt prüfen</button>` : ""}
        <button class="ghost-btn compact-action" id="profileTwitchLink" type="button">${user.twitchLogin ?"Twitch ändern" : "Twitch verknüpfen"}</button>
      </div>
    </section>
    <section class="grid-4 profile-stat-grid">
      <div class="stat-card progress-stat">
        <span>Ausbildungsfortschritt</span>
        <strong>${trainingPercent}%</strong>
        <div class="progress-bar"><i style="width: ${trainingPercent}%"></i></div>
        <small>${trainingDone} von ${trainingTotal} abgeschlossen</small>
      </div>
      <div class="stat-card"><span>Dienststunden</span><strong>${formatDuration(sumDuty())}</strong><small>Alle Dienste</small></div>
      <div class="stat-card split-stat">
        <span>Außendienst</span>
        <div class="service-split">
          <span><b>Normal</b>${formatDuration(sumDuty("Außendienst"))}</span>
          <span><b>Undercover</b>${formatDuration(sumDuty("Undercover Dienst"))}</span>
        </div>
      </div>
      <div class="stat-card"><span>Innendienst</span><strong>${formatDuration(sumDuty("Innendienst"))}</strong><small>Büro & Verwaltung</small></div>
    </section>
    <section class="tabs-row profile-tabs">
      ${profileTabs.map((tab) => `<button class="${state.profileTab === tab ?"tab-active" : ""}" data-profile-tab="${escapeHtml(tab)}">${escapeHtml(tab)}</button>`).join("")}
    </section>
    <section class="panel">
      ${state.profileTab === "Ausbildung" ?renderProfileTrainingPanel(user) : state.profileTab === "Abmeldung" ?renderProfileAbsencePanel(user) : state.profileTab === "Sanktionen" ?renderProfileFilePanel(user) : state.profileTab === "Dienstzeiten" ?`
        <div class="panel-header"><h3>Dienstzeiten</h3><span class="muted">${myHistory.length} Einträge</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Dienstbeginn</th><th>Dienstende</th><th>Diensttyp</th><th>Dauer</th><th>Status</th></tr></thead>
            <tbody>
              ${myHistory.map((entry) => `
                <tr>
                  <td>${formatDateTime(entry.startedAt)}</td>
                  <td>${entry.endedAt ?formatDateTime(entry.endedAt) : "Läuft noch"}</td>
                  <td>${escapeHtml(entry.status)}</td>
                  <td>${formatDuration(durationMs(entry))}</td>
                  <td>${entry.endedAt ?"Beendet" : "Aktiv"}</td>
                </tr>
              `).join("") || `<tr><td colspan="5" class="muted">Noch keine Dienstzeiten.</td></tr>`}
            </tbody>
          </table>
        </div>
      ` : `<div class="template-page"><h3>${escapeHtml(state.profileTab)}</h3><p class="muted">Dieser Bereich kann später erweitert werden.</p></div>`}
    </section>
  `;

  document.querySelectorAll("[data-profile-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.profileTab = button.dataset.profileTab;
      localStorage.setItem("lspd_profile_tab", state.profileTab);
      updateAppUrl({ replace: true });
      renderProfile();
    });
  });
  $("#openPasswordModal").addEventListener("click", openPasswordModal);
  $("#profileDiscordLinkSecondary")?.addEventListener("click", () => startDiscordOAuth("link"));
  $("#profileTwitchLink")?.addEventListener("click", openTwitchLinkModal);
  $("#profileTwitchCheck")?.addEventListener("click", checkProfileTwitchLive);
  $("#avatarPickBtn").addEventListener("click", () => $("#avatarFileInput").click());
  $("#avatarFileInput").addEventListener("change", uploadAvatarFile);
  $("#absenceForm")?.addEventListener("submit", saveAbsence);
  $("#absenceStartDate")?.addEventListener("change", syncAbsenceEndMinimum);
  document.querySelectorAll(".end-absence").forEach((button) => button.addEventListener("click", () => openEndAbsenceModal(button.dataset.id, false)));
}

function syncAbsenceEndMinimum() {
  const startInput = $("#absenceStartDate");
  const endInput = $("#absenceEndDate");
  if (!startInput || !endInput || !startInput.value) return;
  const minEnd = addDaysIsoFrom(startInput.value, 1);
  endInput.min = minEnd;
  if (!endInput.value || endInput.value < minEnd) endInput.value = minEnd;
}

function addDaysIsoFrom(value, days) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return isoDateLocal(date);
}

function renderProfileAbsencePanel(user) {
  const myAbsences = (state.absences || []).filter((absence) => absence.userId === user.id);
  const defaultStart = isoDateLocal(new Date());
  const defaultEnd = addDaysIso(1);
  return `
    <div class="panel-header"><h3>Abmeldung</h3><span class="muted">${myAbsences.length} Einträge</span></div>
    <form id="absenceForm" class="form-grid">
      <label>Beginn<input id="absenceStartDate" type="date" min="${escapeHtml(addDaysIso(-1))}" value="${escapeHtml(defaultStart)}" required></label>
      <label>Ende<input id="absenceEndDate" type="date" min="${escapeHtml(defaultEnd)}" value="${escapeHtml(defaultEnd)}" required></label>
      <label class="full">Kurzer Grund<textarea id="absenceReason" rows="3" placeholder="Grund der Abmeldung" required></textarea></label>
      <p id="absenceError" class="form-error full"></p>
      <div class="modal-actions full"><button class="blue-btn" type="submit">Abmeldung speichern</button></div>
    </form>
    <div class="panel-header compact-subhead"><h3>Meine Abmeldungen</h3></div>
    ${renderAbsenceTable(myAbsences, { own: true })}
  `;
}

function renderHumanResourcesLeadershipPanel(department) {
  const tab = localStorage.getItem(`lspd_hr_leadership_tab_${department.id}`) || "activity";
  const canManage = departmentActionAllowed(department, "departmentLeadership");
  const visibleTabs = canManage ?[["activity", "Abteilungsaktivität"], ["catalog", "Sanktionskatalog"]] : [["activity", "Abteilungsaktivität"]];
  const activeTab = visibleTabs.some(([id]) => id === tab) ?tab : "activity";
  return `
    <div class="panel department-overview-content">
      <div class="panel-header"><h3>Leitung</h3><span class="muted">Personalabteilung intern</span></div>
      <div class="tabs-row sub-tabs">
        ${visibleTabs.map(([id, label]) => `<button class="${activeTab === id ?"tab-active" : ""}" data-hr-leadership-tab="${id}">${label}</button>`).join("")}
      </div>
      ${activeTab === "catalog" ?renderHrSanctionCatalogPanel() : renderDepartmentLeadershipActivityPanel(department)}
    </div>
  `;
}

function renderDepartmentLeadershipActivityPanel(department) {
  const searchValue = localStorage.getItem(`lspd_leadership_search_${department.id}`) || "";
  const selectedRange = localStorage.getItem(`lspd_leadership_range_${department.id}`) || "Gesamt";
  const searchTerm = searchValue.trim();
  const members = department.members.filter((member) => {
    const haystack = `${fullName(member.user)} ${member.position} ${rankLabel(member.user.rank)} ${member.user.dn || ""}`;
    return smartSearchMatch(haystack, searchTerm);
  });
  return `
    <div class="leadership-toolbar">
      <input id="leadershipSearch" value="${escapeHtml(searchValue)}" placeholder="Name, DN, Position oder Rang suchen">
      <label>Zeitraum
        <select id="leadershipRange">
          ${["Heute", "Woche", "Monat", "Gesamt"].map((range) => `<option ${selectedRange === range ?"selected" : ""}>${range}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="leadership-member-list">
      ${members.length ?members.map((member) => renderLeadershipMemberCard(department, member, selectedRange)).join("") : `<p class="muted">Keine Mitglieder gefunden.</p>`}
    </div>
  `;
}

function renderHrLeadershipMemberCreatePanel(department, canManage = false) {
  const searchValue = localStorage.getItem("lspd_hr_member_search") || "";
  const searchTerm = searchValue.trim();
  const openCases = openSanctionCases();
  const members = hrManagedUsers().filter((user) => {
    const absence = activeAbsenceForUser(user.id);
    const haystack = `${fullName(user)} ${user.dn || ""} ${rankLabel(user.rank)} ${user.phone || ""} ${absence ?absence.reason : ""}`;
    return smartSearchMatch(haystack, searchTerm);
  });
  return `
    <div class="hr-management-shell">
      <div class="department-modal-heading hr-create-head">
        <div><h4>Mitgliederverwaltung</h4><p class="muted">Alle aktiven Mitglieder ohne Direktion und Fraktionsverwaltung. Abmeldungen werden direkt markiert.</p></div>
        ${canManage ?`<button class="blue-btn" id="hrCreateMember" type="button">${iconSvg("Plus")} Neues Mitglied</button>` : ""}
      </div>
      <div class="leadership-toolbar hr-member-toolbar">
        <input id="hrMemberSearch" value="${escapeHtml(searchValue)}" placeholder="Name, DN, Rang, Telefon oder Abmeldung suchen">
      </div>
      ${openCases.length ?`
        <section class="hr-open-sanctions-panel">
          <div class="file-section-head"><h4>Offene Sanktionsvergaben</h4><span>${openCases.length}</span></div>
          <div class="hr-open-sanction-list">
            ${openCases.slice(0, 8).map((entry) => {
              const user = findAnyUser(entry.userId) || {};
              const onDuty = (state.duty || []).some((duty) => duty.userId === entry.userId);
              return `<button class="hr-open-sanction-card hr-open-sanction-file" type="button" data-user-id="${escapeHtml(entry.userId)}">
                <span><b>${escapeHtml(fullName(user) || "Unbekannt")}</b><small>${escapeHtml(entry.title || entry.sanctionType || "Sanktion")}${Number(entry.amount || 0) ?` · ${Number(entry.amount || 0).toLocaleString("de-DE")} $` : ""}</small></span>
                <em class="online-state ${onDuty ?"online" : "offline"}">${onDuty ?"Online" : "Offline"}</em>
              </button>`;
            }).join("")}
          </div>
        </section>
      ` : ""}
      <div class="hr-member-list">
        ${members.length ?members.map((user) => renderHrManagedMemberRow(department, user, canManage)).join("") : `<p class="muted">Keine Mitglieder gefunden.</p>`}
      </div>
    </div>
  `;
}

function sanctionCatalog() {
  const fallback = [
    { category: "Allgemein", code: "", title: "Dienstpflicht verletzt", details: "Verstoß gegen Dienstpflichten oder Anweisungen.", fineText: "", action: "Verwarnung", sanctionType: "Strike", amount: 0, strikeCount: 1, uprankBlockDays: 0 }
  ];
  return Array.isArray(state.settings?.sanctionCatalog) && state.settings.sanctionCatalog.length ?state.settings.sanctionCatalog : fallback;
}

function defaultSanctionCatalogItem(category = "") {
  return { category, code: "", title: "", details: "", fineText: "", action: "", sanctionType: "Geldstrafe", amount: 0, strikeCount: 0, uprankBlockDays: 0 };
}

function groupedSanctionCatalog(catalog) {
  const groups = new Map();
  catalog.forEach((item) => {
    const category = String(item.category || "Allgemein").trim() || "Allgemein";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  });
  return [...groups.entries()].map(([category, items]) => ({ category, items }));
}

function sanctionCatalogSummary(items) {
  const strikes = items.filter((item) => Number(item.strikeCount || 0) > 0 || /verwarnung/i.test(item.action || "")).length;
  const fines = items.filter((item) => String(item.fineText || "").trim() || Number(item.amount || 0) > 0).length;
  const custom = items.length - Math.max(strikes, 0);
  return `
    <span>${items.length} Einträge</span>
    <span>${strikes} Verwarnungen</span>
    <span>${fines} Geldstrafen</span>
    ${custom > 0 ?`<span>${custom} weitere Maßnahmen</span>` : ""}
  `;
}

function sanctionCatalogLabel(item) {
  return [item.code, item.title, item.fineText ?`(${item.fineText})` : "", item.action ?`- ${item.action}` : ""].filter(Boolean).join(" ");
}

function sanctionCatalogDetails(item) {
  const lines = [
    item.category ?`Kategorie: ${item.category}` : "",
    item.code ?`Paragraph: ${item.code}` : "",
    item.title ?`Tatbestand: ${item.title}` : "",
    item.fineText ?`Strafrahmen: ${item.fineText}` : "",
    item.action ?`Maßnahme: ${item.action}` : "",
    item.details || ""
  ];
  return lines.filter(Boolean).join("\n");
}

function sanctionFineRangeFromText(value) {
  const text = String(value || "");
  const amounts = [...text.matchAll(/\d[\d.]*/g)]
    .map((match) => Number(String(match[0] || "").replace(/\./g, "")))
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  if (!amounts.length) return null;
  return {
    min: Math.min(...amounts),
    max: amounts.length > 1 ?Math.max(...amounts) : Math.min(...amounts),
    text
  };
}

function formatFineAmount(amount) {
  return `${Number(amount || 0).toLocaleString("de-DE")} $`;
}

function renderHrSanctionCatalogPanel() {
  const catalog = sanctionCatalog();
  const groups = groupedSanctionCatalog(catalog);
  return `
    <form id="hrSanctionCatalogForm" class="hr-management-shell">
      <div class="department-modal-heading hr-create-head">
        <div><h4>Sanktionskatalog</h4><p class="muted">Verwarnung wird automatisch als 1 Strike geführt. Kategorien, Strafrahmen und Maßnahmen sind direkt in den Vorlagen hinterlegt.</p></div>
        <button class="blue-btn" id="addSanctionCatalogRow" type="button">${iconSvg("Plus")} Kategorie / Vorlage</button>
      </div>
      <div id="sanctionCatalogRows" class="catalog-editor-list">
        ${groups.map((group) => renderSanctionCatalogCategory(group.category, group.items)).join("")}
      </div>
      <p id="sanctionCatalogError" class="form-error"></p>
      <div class="modal-actions"><button class="blue-btn" type="submit">Katalog speichern</button></div>
    </form>
  `;
}

function renderSanctionCatalogCategory(category, items = []) {
  return `
    <section class="catalog-category-block">
      <div class="catalog-category-head">
        <div>
          <strong>${escapeHtml(category)}</strong>
          <small>${sanctionCatalogSummary(items)}</small>
        </div>
        <button class="small-action add-sanction-catalog-to-category" type="button" data-category="${escapeHtml(category)}">${iconSvg("Plus")} Eintrag</button>
      </div>
      <div class="catalog-category-body">
        ${items.map((item) => renderSanctionCatalogEditorRow({ ...item, category: item.category || category })).join("")}
      </div>
    </section>
  `;
}

function renderSanctionCatalogEditorRow(item = {}) {
  const warning = Number(item.strikeCount || 0) > 0 || /verwarnung/i.test(item.action || "");
  return `
    <article class="catalog-editor-row">
      <label>Kategorie<input name="category" value="${escapeHtml(item.category || "Allgemein")}" placeholder="z. B. §1 Allgemeiner Polizeidienst"></label>
      <label>Paragraph<input name="code" value="${escapeHtml(item.code || "")}" placeholder="§1 Abs. 1"></label>
      <label class="catalog-title-field">Tatbestand<input name="title" value="${escapeHtml(item.title || "")}" placeholder="Titel der Sanktion"></label>
      <label>Strafrahmen<input name="fineText" value="${escapeHtml(item.fineText || "")}" placeholder="$1.000 - $3.000"></label>
      <label>Folge / Hinweis<input name="action" value="${escapeHtml(item.action || "")}" placeholder="Verwarnung, Kündigung, Strafverfolgung"></label>
      <label>Wirkung<select name="sanctionType">
        ${["Geldstrafe", "Strike", "Custom"].map((type) => `<option ${item.sanctionType === type ?"selected" : ""}>${type}</option>`).join("")}
      </select></label>
      <label>Geldstrafe ab<input name="amount" type="number" min="0" step="100" value="${Number(item.amount || 0)}"></label>
      <label>Strikes<input name="strikeCount" type="number" min="0" max="3" value="${warning ?1 : Number(item.strikeCount || 0)}"></label>
      <label>Uprank-Sperre Tage<input name="uprankBlockDays" type="number" min="0" value="${Number(item.uprankBlockDays || 0)}"></label>
      <label class="full">Details<textarea name="details" rows="2" placeholder="Beschreibung / Grund">${escapeHtml(item.details || "")}</textarea></label>
      <button class="mini-icon danger remove-sanction-catalog-row" type="button" title="Vorlage entfernen">${actionIcon("delete")}</button>
    </article>
  `;
}

async function saveHrSanctionCatalog(event) {
  event.preventDefault();
  const parseFineAmount = (fineText) => Number(String(fineText || "").replace(/\./g, "").match(/\d+/)?.[0] || 0);
  const catalog = [...document.querySelectorAll(".catalog-editor-row")].map((row) => {
    const fineText = row.querySelector('[name="fineText"]')?.value.trim() || "";
    const action = row.querySelector('[name="action"]')?.value.trim() || "";
    const warning = /verwarnung/i.test(action);
    const amount = Number(row.querySelector('[name="amount"]')?.value || 0) || parseFineAmount(fineText);
    return {
      category: row.querySelector('[name="category"]')?.value.trim() || "Allgemein",
      code: row.querySelector('[name="code"]')?.value.trim() || "",
      title: row.querySelector('[name="title"]')?.value.trim() || "",
      fineText,
      action,
      sanctionType: warning ?"Strike" : row.querySelector('[name="sanctionType"]')?.value || "Geldstrafe",
      amount,
      strikeCount: warning ?1 : Number(row.querySelector('[name="strikeCount"]')?.value || 0),
      uprankBlockDays: Number(row.querySelector('[name="uprankBlockDays"]')?.value || 0),
      details: row.querySelector('[name="details"]')?.value.trim() || ""
    };
  }).filter((item) => item.title);
  try {
    const data = await api("/api/settings/sanction-catalog", { method: "PATCH", body: JSON.stringify({ catalog }) });
    state.settings = data.settings || { ...state.settings, sanctionCatalog: catalog };
    showNotify("Sanktionskatalog gespeichert.");
    renderApp();
  } catch (error) {
    $("#sanctionCatalogError").textContent = error.message;
  }
}

function hrManagedUsers() {
  return (state.users || [])
    .filter((user) => {
      const roleText = `${user.role || ""} ${user.baseRole || ""}`;
      const isDirection = /direktion/i.test(roleText);
      return (!isDirection || hasRole("Direktion")) && !/frakverwaltung|frakverwalter/i.test(roleText);
    })
    .sort((a, b) => Number(b.rank || 0) - Number(a.rank || 0) || Number(a.dn || 99999) - Number(b.dn || 99999) || fullName(a).localeCompare(fullName(b), "de"));
}

function renderHrManagedMemberRow(department, user, canManage = false) {
  const absence = activeAbsenceForUser(user.id);
  const notes = (department?.memberNotes || []).filter((note) => note.userId === user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const rookieNotes = notes.filter((note) => note.type === "Rookie");
  const fileEntries = openNegativeEntriesForUser(user.id);
  const openFineAmount = fileEntries.filter(isDisciplinaryFine).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const strikeCount = fileEntries.filter((entry) => entry.sanctionType === "Strike" || entry.type === "Strike").reduce((sum, entry) => sum + Math.max(1, Number(entry.strikeCount || 1)), 0);
  return `
    <article class="hr-member-row ${canManage ?"can-manage" : "readonly"} ${absence ?"is-absent" : ""}">
      <div class="hr-member-main">
        ${avatarMarkup(user, "sm")}
        <span><strong>${escapeHtml(fullName(user))}</strong><small>DN ${escapeHtml(user.dn || "-")} · ${escapeHtml(rankLabel(user.rank))}</small></span>
      </div>
      <div class="hr-member-meta">
        <span><b>Telefon</b>${escapeHtml(user.phone || "-")}</span>
        <span><b>Einstellung</b>${formatDate(user.joinedAt || user.createdAt)}</span>
        ${absence ?`<span class="hr-absence-card"><b>Abgemeldet</b><small>Bis ${formatDate(absence.endDate)}</small></span>` : ""}
      </div>
      ${canManage ?`<div class="hr-member-hours">
        <span><b>Heute</b>${formatDuration(dutyRangeSumForUser(user.id, "Heute"))}</span>
        <span><b>Woche</b>${formatDuration(dutyRangeSumForUser(user.id, "Woche"))}</span>
        <span><b>Monat</b>${formatDuration(dutyRangeSumForUser(user.id, "Monat"))}</span>
      </div>` : ""}
      <div class="hr-member-actions">
        <button class="blue-btn dept-member-file-menu" type="button" data-user-id="${escapeHtml(user.id)}">Personalakte</button>
        ${absence ?`<button class="orange-btn manage-user-absence" type="button" data-absence-id="${escapeHtml(absence.id)}" data-can-end="${canManage ?"1" : "0"}">Abmeldung verwalten</button>` : ""}
      </div>
      <div class="hr-member-file-summary">
        ${Number(user.rank || 0) === 0 || rookieNotes.length ?`<span><b>${rookieNotes.length}</b><small>Rookie Akten</small></span>` : ""}
        <span class="${fileEntries.length ?"danger" : ""}"><b>${fileEntries.length}</b><small>Offene Sanktionen</small></span>
        <span class="${openFineAmount ?"danger" : ""}"><b>${openFineAmount.toLocaleString("de-DE")} $</b><small>Offene Geldstrafen</small></span>
        ${strikeCount ?`<span class="danger"><b>${strikeCount}/3</b><small>Aktive Strikes</small></span>` : ""}
      </div>
    </article>
  `;
}

function renderAbsenceTable(absences, options = {}) {
  const rows = [...absences].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")) || String(b.startDate).localeCompare(String(a.startDate)));
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${options.own ?"" : "<th>Person</th>"}<th>Beginn</th><th>Ende</th><th>Status</th><th>Grund</th><th>Beendet</th><th>Aktionen</th></tr></thead>
        <tbody>
          ${rows.map((absence) => {
            const canEnd = !absence.endedAt && (absence.endDate >= isoDateLocal(new Date()));
            return `<tr class="filterable-row" data-search="${escapeHtml([fullName(absence.user || {}), absence.startDate, absence.endDate, absence.reason, absenceStatusLabel(absence)].join(" "))}">
              ${options.own ?"" : `<td>${escapeHtml(fullName(absence.user || {}))}</td>`}
              <td>${formatDate(absence.startDate)}</td>
              <td>${formatDate(absence.endDate)}</td>
              <td><span class="status-chip ${absenceIsActive(absence) ?"status-inside" : "status-outside"}">${escapeHtml(absenceStatusLabel(absence))}</span></td>
              <td>${escapeHtml(absence.reason)}</td>
              <td>${absence.endedAt ?`${formatDateTime(absence.endedAt)}${absence.endedByUser ?`<br><small>durch ${escapeHtml(fullName(absence.endedByUser))}</small>` : ""}${absence.endReason ?`<br><small>${escapeHtml(absence.endReason)}</small>` : ""}` : "-"}</td>
              <td>${canEnd ?`<button class="mini-icon danger end-absence" data-id="${escapeHtml(absence.id)}" title="Abmeldung beenden">${iconSvg("Logout")}</button>` : `<span class="muted">-</span>`}</td>
            </tr>`;
          }).join("") || `<tr><td colspan="${options.own ?6 : 7}" class="muted">Keine Abmeldungen vorhanden.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderAbsenceOverviewPanel(scope = "direction") {
  const search = localStorage.getItem(`lspd_absence_search_${scope}`) || "";
  const rows = state.absences || [];
  const today = isoDateLocal(new Date());
  const activeRows = rows.filter((absence) => !absence.endedAt && absence.endDate >= today);
  const archivedRows = rows.filter((absence) => absence.endedAt || absence.endDate < today);
  const archiveToggle = scope === "direction";
  const archiveOpen = !archiveToggle || localStorage.getItem("lspd_absence_archive_direction") === "1";
  return `
    <section class="panel">
      <div class="panel-header">
        <div><h3>Abmeldungen</h3><span class="muted">${activeRows.length} aktiv/geplant / ${archivedRows.length} Archiv</span></div>
        <span class="button-row">
          ${archiveToggle ?`<button id="toggleAbsenceArchive" class="ghost-btn compact-action" type="button">${archiveOpen ?"Archiv ausblenden" : "Archiv einblenden"}</button>` : ""}
          <input id="absenceSearch" class="compact-input" value="${escapeHtml(search)}" placeholder="Name, Zeitraum, Status oder Grund suchen">
        </span>
      </div>
      <div class="absence-section"><h4>Aktive und geplante Abmeldungen</h4>${renderAbsenceTable(activeRows)}</div>
      ${archiveOpen ?`<div class="absence-section"><h4>Archiv</h4>${renderAbsenceTable(archivedRows)}</div>` : `<div class="absence-section"><h4>Archiv</h4><p class="muted">Archiv ist ausgeblendet. ${archivedRows.length} archivierte Abmeldung${archivedRows.length === 1 ?"" : "en"} vorhanden.</p></div>`}
    </section>
  `;
}

async function saveAbsence(event) {
  event.preventDefault();
  $("#absenceError").textContent = "";
  try {
    const data = await api("/api/absences", {
      method: "POST",
      body: JSON.stringify({
        startDate: $("#absenceStartDate").value,
        endDate: $("#absenceEndDate").value,
        reason: $("#absenceReason").value
      })
    });
    state.absences = data.absences || state.absences;
    showNotify("Abmeldung gespeichert.");
    renderProfile();
  } catch (error) {
    $("#absenceError").textContent = error.message;
  }
}

function openEndAbsenceModal(id, requireReason = false) {
  const absence = (state.absences || []).find((item) => item.id === id);
  if (!absence) return;
  openModal(`
    <h3>Abmeldung beenden</h3>
    <p class="muted">${escapeHtml(fullName(absence.user || state.currentUser || {}))} - ${formatDate(absence.startDate)} bis ${formatDate(absence.endDate)}</p>
    <label>Grund<textarea id="absenceEndReason" rows="3" ${requireReason ?"required" : ""} placeholder="${requireReason ?"Grund erforderlich" : "Optional"}"></textarea></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="red-btn" id="confirmEndAbsence">Abmeldung beenden</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmEndAbsence").addEventListener("click", async () => {
      const reason = modal.querySelector("#absenceEndReason").value.trim();
      if (requireReason && !reason) {
        modal.querySelector("#modalError").textContent = "Bitte einen Grund angeben.";
        return;
      }
      try {
        const data = await api(`/api/absences/${id}/end`, { method: "PATCH", body: JSON.stringify({ reason }) });
        state.absences = data.absences || state.absences;
        closeModal();
        renderApp();
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

function openAbsenceInfoModal(id) {
  const absence = (state.absences || []).find((item) => item.id === id);
  if (!absence) return;
  openModal(`
    <h3>Aktive Abmeldung</h3>
    <p class="muted">${escapeHtml(fullName(absence.user || {}))}</p>
    <div class="info-box">
      <strong>${formatDate(absence.startDate)} bis ${formatDate(absence.endDate)}</strong>
      <p>${escapeHtml(absence.reason)}</p>
    </div>
    <div class="modal-actions"><button class="ghost-btn" data-close>Schließen</button></div>
  `);
}

function openAbsenceManageModal(id, canEnd = false) {
  const absence = (state.absences || []).find((item) => item.id === id);
  if (!absence) return;
  const canEndNow = Boolean(canEnd) && !absence.endedAt && absence.endDate >= isoDateLocal(new Date());
  openModal(`
    <h3>Abmeldung verwalten</h3>
    <p class="muted">${escapeHtml(fullName(absence.user || {}))}</p>
    <div class="absence-manage-card">
      <span><b>Zeitraum</b>${formatDate(absence.startDate)} bis ${formatDate(absence.endDate)}</span>
      <span><b>Status</b>${escapeHtml(absenceStatusLabel(absence))}</span>
      <p>${escapeHtml(absence.reason)}</p>
    </div>
    ${canEndNow ?`<label>Grund zum vorzeitigen Beenden<textarea id="absenceEndReason" rows="3" required placeholder="Grund erforderlich"></textarea></label>` : `<p class="muted">Diese Abmeldung kann aktuell nur angesehen werden.</p>`}
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Schließen</button>
      ${canEndNow ?`<button class="red-btn" id="confirmEndAbsence">Abmeldung beenden</button>` : ""}
    </div>
  `, (modal) => {
    modal.querySelector("#confirmEndAbsence")?.addEventListener("click", async () => {
      const reason = modal.querySelector("#absenceEndReason").value.trim();
      if (!reason) {
        modal.querySelector("#modalError").textContent = "Bitte einen Grund angeben.";
        return;
      }
      try {
        const data = await api(`/api/absences/${id}/end`, { method: "PATCH", body: JSON.stringify({ reason }) });
        state.absences = data.absences || state.absences;
        closeModal();
        renderApp();
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

function openTwitchLinkModal(user = state.currentUser, options = {}) {
  if (!user) return;
  const isAdminEdit = Boolean(options.admin);
  openModal(`
    <h3>${isAdminEdit ?`Twitch verwalten` : "Twitch verknüpfen"}</h3>
    <p class="muted">${isAdminEdit ?escapeHtml(fullName(user)) : "Trage nur deinen Twitch-Namen oder Kanal-Link ein."}</p>
    <label>Twitch Name oder Link<input id="twitchLoginInput" value="${escapeHtml(user?.twitchLogin || "")}" placeholder="z.B. deinname oder https://twitch.tv/deinname"></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      ${user?.twitchLogin ?`<button class="red-btn" id="unlinkTwitch">Trennen</button>` : ""}
      <button class="blue-btn" id="saveTwitch">Speichern</button>
    </div>
  `, (modal) => {
    const save = async (value) => {
      try {
        const data = await api(isAdminEdit ?`/api/it/users/${user.id}/twitch` : "/api/profile/twitch", {
          method: "PATCH",
          body: JSON.stringify({ twitchLogin: value })
        });
        if (!isAdminEdit) state.currentUser = data.user;
        if (state.currentUser?.id === data.user.id) state.currentUser = data.user;
        state.users = state.users.map((item) => item.id === data.user.id ?data.user : item);
        closeModal();
        if (isAdminEdit) renderIT();
        else renderProfile();
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    };
    modal.querySelector("#saveTwitch")?.addEventListener("click", () => save(modal.querySelector("#twitchLoginInput")?.value || ""));
    modal.querySelector("#unlinkTwitch")?.addEventListener("click", () => save(""));
  });
}

function openPasswordModal() {
  openModal(`
    <h3>Passwort ändern</h3>
    <label>Altes Passwort<input type="password" id="oldPassword" required></label>
    <label>Neues Passwort<input type="password" id="newPassword" required></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="orange-btn" id="savePassword">Speichern</button>
    </div>
  `, (modal) => {
    modal.querySelector("#savePassword").addEventListener("click", async () => {
      try {
        await api("/api/profile/password", { method: "PATCH", body: JSON.stringify({ oldPassword: $("#oldPassword").value, newPassword: $("#newPassword").value }) });
        closeModal();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function resizeAvatarFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Bitte wähle eine Bilddatei aus."));
      return;
    }
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxSize = 512;
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.86));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Das Bild konnte nicht gelesen werden."));
    };
    image.src = objectUrl;
  });
}

async function uploadAvatarFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    openAvatarCropModal(file);
  } catch (error) {
    openModal(`<h3>Avatar konnte nicht gespeichert werden</h3><p class="form-error">${escapeHtml(error.message)}</p><div class="modal-actions"><button class="ghost-btn" data-close>Schließen</button></div>`);
  } finally {
    event.target.value = "";
  }
}

async function saveAvatarUrl(avatarUrl) {
  const data = await api("/api/profile/avatar", { method: "PATCH", body: JSON.stringify({ avatarUrl }) });
  state.currentUser = data.user;
  renderNavigation();
  renderProfile();
}

function openAvatarCropModal(file) {
  if (!file.type.startsWith("image/")) {
    openModal(`<h3>Avatar konnte nicht gelesen werden</h3><p class="form-error">Bitte wähle eine Bilddatei aus.</p><div class="modal-actions"><button class="ghost-btn" data-close>Schließen</button></div>`);
    return;
  }
  const objectUrl = URL.createObjectURL(file);
  openModal(`
    <h3>Avatar anpassen</h3>
    <div class="avatar-crop-layout">
      <div class="avatar-crop-frame" id="avatarCropFrame"><img id="avatarCropImage" src="${escapeHtml(objectUrl)}" alt="Avatar Vorschau" draggable="false"></div>
      <p class="muted">Bild direkt ziehen. Mit dem Mausrad zoomst du rein oder raus.</p>
    </div>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="blue-btn" id="saveCroppedAvatar">Avatar speichern</button>
    </div>
  `, (modal) => {
    const image = modal.querySelector("#avatarCropImage");
    const frame = modal.querySelector("#avatarCropFrame");
    const crop = { zoom: 0.78, x: 0, y: 0, dragging: false, startX: 0, startY: 0, originX: 0, originY: 0 };
    const syncPreview = () => {
      image.style.transform = `translate(${crop.x}px, ${crop.y}px) scale(${crop.zoom})`;
    };
    frame.addEventListener("wheel", (event) => {
      event.preventDefault();
      const nextZoom = crop.zoom + (event.deltaY < 0 ?0.08 : -0.08);
      crop.zoom = Math.min(3, Math.max(0.45, nextZoom));
      syncPreview();
    }, { passive: false });
    frame.addEventListener("pointerdown", (event) => {
      crop.dragging = true;
      crop.startX = event.clientX;
      crop.startY = event.clientY;
      crop.originX = crop.x;
      crop.originY = crop.y;
      frame.setPointerCapture(event.pointerId);
    });
    frame.addEventListener("pointermove", (event) => {
      if (!crop.dragging) return;
      crop.x = crop.originX + event.clientX - crop.startX;
      crop.y = crop.originY + event.clientY - crop.startY;
      syncPreview();
    });
    frame.addEventListener("pointerup", () => {
      crop.dragging = false;
    });
    syncPreview();
    modal.querySelector("#saveCroppedAvatar").addEventListener("click", async () => {
      try {
        const avatarUrl = cropAvatarImage(image, crop.zoom, crop.x, crop.y);
        URL.revokeObjectURL(objectUrl);
        await saveAvatarUrl(avatarUrl);
        closeModal();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function cropAvatarImage(image, zoom, offsetX, offsetY) {
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("Bild ist noch nicht geladen.");
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0e1728";
  ctx.fillRect(0, 0, size, size);
  const baseScale = Math.max(size / image.naturalWidth, size / image.naturalHeight) * zoom;
  const drawWidth = image.naturalWidth * baseScale;
  const drawHeight = image.naturalHeight * baseScale;
  ctx.drawImage(image, (size - drawWidth) / 2 + offsetX * 2, (size - drawHeight) / 2 + offsetY * 2, drawWidth, drawHeight);
  return canvas.toDataURL("image/jpeg", 0.88);
}

function renderTemplate(page) {
  content.innerHTML = `
    <section class="panel template-page">
      <h3>${escapeHtml(navLabel(page))}</h3>
      <p class="muted">Template-Seite. Die Funktionen können hier als nächstes erweitert werden.</p>
    </section>
  `;
}

function seizureItems() {
  return [...(state.settings?.seizures || [])].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return amount > 0 ?`${amount.toLocaleString("de-DE")}$` : "-";
}

function seizureEvidenceLinks(item) {
  const links = Array.isArray(item.evidenceLinks) ?item.evidenceLinks : [];
  const legacy = [item.weapons, item.drugs, item.other].map((value) => String(value || "").trim()).filter(Boolean);
  return [...links.map((value) => String(value || "").trim()).filter(Boolean), ...legacy];
}

function renderEvidenceLinks(item) {
  const links = seizureEvidenceLinks(item);
  if (!links.length) return "-";
  return `<div class="evidence-link-list">${links.map((link, index) => {
    const isUrl = /^https?:\/\//i.test(link);
    const isPrnt = /^https?:\/\/(?:www\.)?prnt\.sc\//i.test(link);
    const isGyazo = /^https?:\/\/(?:www\.)?gyazo\.com\//i.test(link);
    const isImgur = /^https?:\/\/(?:www\.)?imgur\.com\//i.test(link);
    const isDirectImgur = /^https?:\/\/i\.imgur\.com\/.+\.(?:png|jpe?g|webp|gif)(?:\?.*)?$/i.test(link);
    const isDirectImage = isDirectImgur || /^https?:\/\/i\.gyazo\.com\/.+\.(?:png|jpe?g|webp|gif)(?:\?.*)?$/i.test(link);
    const previewSrc = isDirectImage ?escapeHtml(link) : isPrnt || isGyazo || isImgur ?`/api/evidence-preview?url=${encodeURIComponent(link)}` : escapeHtml(link);
    const isUploadedImage = /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(link);
    const loading = index < 2 ?"eager" : "lazy";
    const priority = index < 2 ?' fetchpriority="high"' : "";
    const imageAttrs = `width="152" height="86" loading="${loading}" decoding="async"${priority} onload="this.closest('.evidence-preview-card')?.classList.add('is-loaded')"`;
    if (isUploadedImage) {
      return `<div class="evidence-preview-card uploaded-preview"><button class="evidence-thumb-link evidence-preview-open" type="button" data-link="${escapeHtml(link)}"><img src="${escapeHtml(link)}" alt="Beweis ${index + 1}" ${imageAttrs}></button><span class="evidence-text-link">Hochgeladenes Bild</span></div>`;
    }
    return isUrl
      ?`<div class="evidence-preview-card ${isPrnt || isGyazo || isImgur ?"prnt-preview" : ""}"><button class="evidence-thumb-link evidence-preview-open" type="button" data-link="${escapeHtml(link)}"><img src="${previewSrc}" alt="Beweis ${index + 1}" ${imageAttrs} onerror="this.closest('.evidence-preview-card').classList.add('no-preview')"><span class="prnt-fallback">${isGyazo ?"GYAZO" : isPrnt ?"PRNT.SC" : isImgur ?"IMGUR" : "VORSCHAU"}</span></button><a class="evidence-text-link" href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(link)}</a></div>`
      : `<span>${escapeHtml(link)}</span>`;
  }).join("")}</div>`;
}

function renderSeizures() {
  const search = localStorage.getItem("lspd_seizure_search") || "";
  const statRange = localStorage.getItem("lspd_seizure_stat_range") || "Gesamt";
  const sourceFilter = localStorage.getItem("lspd_seizure_source_filter") || "Alle";
  const visibleLimit = Math.max(15, Number(localStorage.getItem("lspd_seizure_visible_limit") || 25));
  const items = seizureItems();
  const sourceFilteredItems = items.filter((item) => {
    const source = item.sourceType || "";
    if (sourceFilter === "Alle") return true;
    if (sourceFilter === "Ohne Art") return !["Dealer", "Camper"].includes(source);
    return source === sourceFilter;
  });
  const statStart = rangeStart(statRange);
  const statItems = statStart ?sourceFilteredItems.filter((item) => new Date(item.createdAt).getTime() >= statStart.getTime()) : sourceFilteredItems;
  const filtered = sourceFilteredItems.filter((item) => {
    const haystack = [
      item.suspect,
      item.location,
      seizureEvidenceLinks(item).join(" "),
      item.witness,
      item.sourceType,
      item.vehicleId,
      item.officerName
    ].join(" ").toLowerCase();
    return haystack.includes(search.toLowerCase());
  });
  const totalBlackMoney = statItems.reduce((sum, item) => sum + (Number(item.blackMoney) || 0), 0);
  const totalCrates = statItems.reduce((sum, item) => sum + (Number(item.crates) || 0), 0);
  const dealerCount = statItems.filter((item) => item.sourceType === "Dealer").length;
  const camperCount = statItems.filter((item) => item.sourceType === "Camper").length;
  const canDelete = hasRole("Direktion");
  const canEditAll = hasRole("Direktion");
  const ranges = ["Heute", "Woche", "Monat", "Gesamt"];
  const sourceOptions = ["Alle", "Dealer", "Camper", "Ohne Art"];
  const visibleRows = filtered.slice(0, visibleLimit);
  const hiddenRows = Math.max(0, filtered.length - visibleRows.length);

  content.innerHTML = `
    <section class="seizure-page">
      <div class="grid-4 seizure-stats">
        <article class="stat-card"><span>Einträge</span><strong>${statItems.length}</strong><small>${escapeHtml(statRange)} erfasst</small></article>
        <article class="stat-card"><span>Schwarzgeld</span><strong>${totalBlackMoney.toLocaleString("de-DE")}$</strong><small>Gesamtmenge</small></article>
        <article class="stat-card"><span>Kisten</span><strong>${totalCrates.toLocaleString("de-DE")}</strong><small>Gesamtmenge</small></article>
        <article class="stat-card"><span>Dealer / Camper</span><strong>${dealerCount} / ${camperCount}</strong><small>Besondere Fundarten</small></article>
      </div>
      <div class="seizure-stats-head">
        <label><span>Zeitraum</span><select id="seizureStatRange" class="compact-input seizure-range-select">
          ${ranges.map((range) => `<option value="${range}" ${statRange === range ?"selected" : ""}>${range}</option>`).join("")}
        </select></label>
        <label><span>Art</span><select id="seizureSourceFilter" class="compact-input seizure-range-select">
          ${sourceOptions.map((option) => `<option value="${option}" ${sourceFilter === option ?"selected" : ""}>${option}</option>`).join("")}
        </select></label>
      </div>
      <section class="panel seizure-panel">
        <div class="panel-header">
          <div><h3>${iconSvg("Beschlagnahmung")} Beschlagnahmungen (${filtered.length})</h3><p class="muted">Suche nach Tatverdächtigem, Standort, Officer oder Beweis.</p></div>
          <button class="blue-btn" id="addSeizureBtn">${iconSvg("Plus")} Neue Beschlagnahmung</button>
        </div>
        <div class="seizure-search-row">
          <input id="seizureSearch" value="${escapeHtml(search)}" placeholder="Suche nach Tatverdächtiger, Standort, Officer oder Beweis...">
          <button class="blue-btn" id="runSeizureSearch">Suchen</button>
        </div>
        <div class="table-wrap seizure-table-wrap">
          <table class="seizure-table">
            <thead>
              <tr>
                <th>Tatverdächtiger</th>
                <th>Standort</th>
                <th>Beweise</th>
                <th>Schwarzgeld</th>
                <th>Kisten</th>
                <th>Art</th>
                <th>Zeuge</th>
                <th>Zeitstempel</th>
                <th>Erfasst von</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              ${visibleRows.map((item) => `
                <tr>
                  <td>
                    <strong>${escapeHtml(item.suspect || "-")}</strong>
                    ${item.vehicleId ?`<small class="seizure-vehicle-line">KFZ / Kennzeichen: ${escapeHtml(item.vehicleId)}</small>` : ""}
                  </td>
                  <td class="seizure-location-cell">${escapeHtml(item.location || "-")}</td>
                  <td>${renderEvidenceLinks(item)}</td>
                  <td>${formatMoney(item.blackMoney)}</td>
                  <td>${Number(item.crates || 0) || "-"}</td>
                  <td><span class="seizure-pill ${item.sourceType === "Dealer" ?"dealer" : item.sourceType === "Camper" ?"camper" : "normal"}">${escapeHtml(item.sourceType && item.sourceType !== "Normal" ?item.sourceType : "-")}</span></td>
                  <td>${escapeHtml(item.witness || "-")}</td>
                  <td>${formatDateTime(item.createdAt)}</td>
                  <td>${escapeHtml(item.officerName || "-")}</td>
                  <td>${canEditAll || item.officerId === state.currentUser.id ?`<button class="mini-icon seizure-actions gear-action" data-id="${escapeHtml(item.id)}" title="Aktionen">${iconSvg("Settings")}</button>` : `<span class="muted">-</span>`}</td>
                </tr>
              `).join("") || `<tr><td colspan="10" class="empty-table">Keine Beschlagnahmungen gefunden.</td></tr>`}
            </tbody>
          </table>
        </div>
        ${hiddenRows ?`<div class="seizure-more-row"><button class="ghost-btn" id="showMoreSeizures">${iconSvg("ChevronDown")} ${hiddenRows} weitere anzeigen</button></div>` : ""}
      </section>
    </section>
  `;

  $("#addSeizureBtn")?.addEventListener("click", () => openSeizureModal());
  $("#seizureStatRange")?.addEventListener("change", (event) => {
    localStorage.setItem("lspd_seizure_stat_range", event.target.value);
    renderSeizures();
  });
  $("#seizureSourceFilter")?.addEventListener("change", (event) => {
    localStorage.setItem("lspd_seizure_source_filter", event.target.value);
    localStorage.setItem("lspd_seizure_visible_limit", "25");
    renderSeizures();
  });
  document.querySelectorAll(".seizure-actions").forEach((button) => button.addEventListener("click", () => openSeizureActionsModal(button.dataset.id)));
  document.querySelectorAll(".evidence-preview-open").forEach((button) => button.addEventListener("click", () => openEvidencePreview(button.dataset.link)));
  $("#showMoreSeizures")?.addEventListener("click", () => {
    localStorage.setItem("lspd_seizure_visible_limit", String(visibleLimit + 25));
    renderSeizures();
  });
  $("#runSeizureSearch")?.addEventListener("click", () => {
    localStorage.setItem("lspd_seizure_search", $("#seizureSearch").value);
    renderSeizures();
  });
  $("#seizureSearch")?.addEventListener("input", (event) => {
    localStorage.setItem("lspd_seizure_search", event.target.value);
  });
  $("#seizureSearch")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    localStorage.setItem("lspd_seizure_search", event.target.value);
    renderSeizures();
  });
}

function openEvidencePreview(link) {
  const isPrnt = /^https?:\/\/(?:www\.)?prnt\.sc\//i.test(link || "");
  const isGyazo = /^https?:\/\/(?:www\.)?gyazo\.com\//i.test(link || "");
  const isImgur = /^https?:\/\/(?:www\.)?imgur\.com\//i.test(link || "");
  const isDirectImage = /^https?:\/\/(?:i\.imgur\.com|i\.gyazo\.com)\/.+\.(?:png|jpe?g|webp|gif)(?:\?.*)?$/i.test(link || "");
  const preview = !isDirectImage && (isPrnt || isGyazo || isImgur) ?`/api/evidence-preview?url=${encodeURIComponent(link)}` : link;
  openModal(`
    <h3>Beweisvorschau</h3>
    <div class="evidence-popup-preview">
      <img src="${escapeHtml(preview)}" alt="Beweisvorschau">
      <p class="muted evidence-preview-fallback">Falls die Vorschau nicht lädt, öffne den Link separat.</p>
    </div>
    <a class="blue-btn evidence-popup-link" href="${escapeHtml(link)}" target="_blank" rel="noopener">Link öffnen</a>
  `, (modal) => modal.classList.add("evidence-preview-modal"));
}

function openSeizureActionsModal(id) {
  const item = seizureItems().find((entry) => entry.id === id);
  if (!item) return;
  const canEdit = hasRole("Direktion") || item.officerId === state.currentUser.id;
  const canDelete = hasRole("Direktion");
  if (!canEdit && !canDelete) return;
  openModal(`
    <h3>Beschlagnahmung Aktionen</h3>
    <p class="muted">${escapeHtml(item.suspect || "-")} · ${escapeHtml(item.location || "-")}</p>
    <div class="choice-grid">
      ${canEdit ?`<button class="choice-card" id="editSeizureAction"><strong>Bearbeiten</strong><span>Eintrag anpassen und Beweise ergänzen.</span></button>` : ""}
      ${canDelete ?`<button class="choice-card danger-choice" id="deleteSeizureAction"><strong>Löschen</strong><span>Eintrag dauerhaft entfernen.</span></button>` : ""}
    </div>
  `, (modal) => {
    modal.querySelector("#editSeizureAction")?.addEventListener("click", () => openSeizureModal(item));
    modal.querySelector("#deleteSeizureAction")?.addEventListener("click", () => openDeleteSeizureModal(id));
  });
}

function openDeleteSeizureModal(id) {
  const item = seizureItems().find((entry) => entry.id === id);
  if (!item || !hasRole("Direktion")) return;
  openModal(`
    <h3>Beschlagnahmung löschen</h3>
    <p class="muted">Eintrag von <strong>${escapeHtml(item.suspect || "-")}</strong> wirklich löschen?</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="red-btn" id="confirmDeleteSeizure">Löschen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmDeleteSeizure").addEventListener("click", async () => {
      try {
        const data = await api(`/api/seizures/${id}`, { method: "DELETE" });
        state.settings = data.settings || { ...state.settings, seizures: (state.settings.seizures || []).filter((entry) => entry.id !== id) };
        closeModal();
        renderSeizures();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openSeizureModal(item = null) {
  const isEdit = Boolean(item?.id);
  const evidenceLinks = seizureEvidenceLinks(item || {});
  const selectedSource = ["Dealer", "Camper"].includes(item?.sourceType) ?item.sourceType : "";
  const witnessOptions = state.users
    .filter((user) => !user.terminated)
    .sort((a, b) => fullName(a).localeCompare(fullName(b), "de"))
    .map((user) => `<option value="${escapeHtml(fullName(user))}" ${item?.witness === fullName(user) ?"selected" : ""}>${escapeHtml(fullName(user))} (${escapeHtml(user.dn || "-")})</option>`)
    .join("");
  openModal(`
    <div class="seizure-modal-head"><span>${iconSvg(isEdit ?"Settings" : "Plus")}</span><div><h3>${isEdit ?"Beschlagnahmung bearbeiten" : "Neue Beschlagnahmung"}</h3><p class="muted">Pflichtfelder ausfüllen, optionale Angaben nur bei Bedarf ergänzen.</p></div></div>
    <div class="seizure-modal-grid">
      <label><span class="required-label">Tatverdächtiger <b>*</b></span><input id="seizureSuspect" value="${escapeHtml(item?.suspect || "")}" placeholder="Name des Tatverdächtigen" required></label>
      <label><span class="required-label">Standort <b>*</b></span><input id="seizureLocation" value="${escapeHtml(item?.location || "")}" placeholder="Ort der Beschlagnahmung" required></label>
      <div class="seizure-source-field full">
        <div class="seizure-source-options">
          ${["Dealer", "Camper"].map((type) => `<label><input class="seizure-source-choice" type="checkbox" value="${type}" ${selectedSource === type ?"checked" : ""}><span>${type}</span></label>`).join("")}
        </div>
      </div>
      <div class="full evidence-field">
        <div class="field-title required-label">Beweise <b>*</b></div>
        <div id="evidenceLinkList" class="evidence-input-list">
          ${(evidenceLinks.length ?evidenceLinks : [""]).map((link, index) => index === 0
            ?`<input class="evidence-link-input" value="${escapeHtml(link)}" placeholder="Screenshot-Link / Beweis-Link">`
            : `<div class="evidence-input-row"><input class="evidence-link-input" value="${escapeHtml(link)}" placeholder="Weiterer Screenshot-Link / Beweis-Link"><button class="mini-icon remove-evidence-link" type="button" title="Entfernen">X</button></div>`).join("")}
        </div>
        <div class="evidence-actions-row">
          <button class="ghost-btn evidence-add-btn" type="button" id="addEvidenceLink">${iconSvg("Plus")} Weiteren Link hinzufügen</button>
          <button class="ghost-btn evidence-add-btn" type="button" id="uploadEvidenceImage">${iconSvg("Plus")} Bild hochladen</button>
          <input id="evidenceImageUpload" class="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif">
        </div>
      </div>
      <label>Schwarzgeld Menge<input id="seizureBlackMoney" type="number" min="0" step="1" value="${escapeHtml(item?.blackMoney || "")}" placeholder="0"></label>
      <label>Kisten Menge<input id="seizureCrates" type="number" min="0" step="1" value="${escapeHtml(item?.crates || "")}" placeholder="0"></label>
      <label>KFZ ID / Kennzeichen<input id="seizureVehicleId" value="${escapeHtml(item?.vehicleId || "")}" placeholder="Optional"></label>
      <label>Zeuge / Officer
        <select id="seizureWitness">
          <option value="" ${item?.witness ?"" : "selected"}>Officer auswählen...</option>
          ${witnessOptions}
        </select>
      </label>
    </div>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions"><button class="blue-btn full-action" id="saveSeizure">${isEdit ?"Beschlagnahmung speichern" : "Beschlagnahmung eintragen"}</button></div>
  `, (modal) => {
    modal.classList.add("seizure-modal");
    modal.querySelectorAll(".seizure-source-choice").forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked) return;
        modal.querySelectorAll(".seizure-source-choice").forEach((other) => {
          if (other !== input) other.checked = false;
        });
      });
    });
    modal.querySelectorAll(".remove-evidence-link").forEach((button) => button.addEventListener("click", () => button.closest(".evidence-input-row")?.remove()));
    modal.querySelector("#saveSeizure").addEventListener("click", async () => {
      try {
        const evidenceLinks = [...document.querySelectorAll(".evidence-link-input")].map((input) => input.value.trim()).filter(Boolean);
        if (!evidenceLinks.length) {
          $("#modalError").textContent = "Bitte mindestens einen Beweis-Link eintragen.";
          return;
        }
        const data = await api(isEdit ?`/api/seizures/${item.id}` : "/api/seizures", {
          method: isEdit ?"PATCH" : "POST",
          body: JSON.stringify({
            suspect: $("#seizureSuspect").value,
            location: $("#seizureLocation").value,
            evidenceLinks,
            witness: $("#seizureWitness").value,
            blackMoney: $("#seizureBlackMoney").value,
            crates: $("#seizureCrates").value,
            vehicleId: $("#seizureVehicleId").value,
            sourceType: document.querySelector(".seizure-source-choice:checked")?.value || ""
          })
        });
        state.settings = data.settings || { ...state.settings, seizures: [data.seizure, ...(state.settings.seizures || [])] };
        closeModal();
        renderSeizures();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
    modal.querySelector("#addEvidenceLink").addEventListener("click", () => {
      const row = document.createElement("div");
      row.className = "evidence-input-row";
      row.innerHTML = `<input class="evidence-link-input" placeholder="Weiterer Screenshot-Link / Beweis-Link"><button class="mini-icon remove-evidence-link" type="button" title="Entfernen">X</button>`;
      modal.querySelector("#evidenceLinkList").appendChild(row);
      row.querySelector(".remove-evidence-link").addEventListener("click", () => row.remove());
      row.querySelector("input").focus();
    });
    modal.querySelector("#uploadEvidenceImage")?.addEventListener("click", () => modal.querySelector("#evidenceImageUpload")?.click());
    modal.querySelector("#evidenceImageUpload")?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
        $("#modalError").textContent = "Bitte nur Foto-Dateien hochladen (PNG, JPG, WEBP oder GIF).";
        return;
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const row = document.createElement("div");
      row.className = "evidence-input-row uploaded-evidence-row";
      row.innerHTML = `<input class="evidence-link-input" value="${escapeHtml(dataUrl)}" readonly data-uploaded-image="true"><span class="uploaded-evidence-name">${escapeHtml(file.name)}</span><button class="mini-icon remove-evidence-link" type="button" title="Entfernen">X</button>`;
      modal.querySelector("#evidenceLinkList").appendChild(row);
      row.querySelector(".remove-evidence-link").addEventListener("click", () => row.remove());
    });
  });
}

function renderCalendar() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthStart = isoDateLocal(new Date(year, month, 1));
  const monthEnd = isoDateLocal(new Date(year, month, daysInMonth));
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);
  const baseEvents = [...(state.settings.calendarEvents || [])].sort((a, b) => `${a.startDate}T${a.startTime || "00:00"}`.localeCompare(`${b.startDate}T${b.startTime || "00:00"}`));
  const events = calendarEventInstances(baseEvents, monthStart, monthEnd);
  const monthEvents = events;
  const selectedEvents = events.filter((event) => event.startDate === selectedCalendarDate);
  const canManageCalendar = hasRole("Direktion");
  content.innerHTML = `
    <section class="calendar-layout">
      <div class="panel calendar-panel">
        <div class="calendar-head">
          <h3>${escapeHtml(monthName(calendarCursor))}</h3>
          <div class="button-row">
            <button class="ghost-btn" id="calendarToday">Heute</button>
            <button class="icon-btn calendar-prev" id="calendarPrev">${iconSvg("ChevronDown")}</button>
            <button class="icon-btn calendar-next" id="calendarNext">${iconSvg("ChevronDown")}</button>
          </div>
        </div>
        <div class="calendar-weekdays">${["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((day) => `<span>${day}</span>`).join("")}</div>
        <div class="calendar-grid">
          ${cells.map((date) => {
            if (!date) return `<div class="calendar-day muted-day"></div>`;
            const iso = isoDateLocal(date);
            const dayEvents = events.filter((event) => event.startDate === iso);
            return `<button class="calendar-day ${iso === isoDateLocal(new Date()) ?"today" : ""}" data-date="${iso}">
              <strong>${date.getDate()}</strong>
              ${dayEvents.slice(0, 3).map((event) => `<span class="calendar-event-pill ${calendarColorClass(event.cancelled ?"Rot" : event.color)} ${event.cancelled ?"calendar-cancelled" : ""}">${escapeHtml(event.cancelled ?`Fällt aus: ${event.title}` : event.title)}</span>`).join("")}
            </button>`;
          }).join("")}
        </div>
      </div>
      <aside class="calendar-side">
        <section class="panel">
          <h3>Neuer Termin</h3>
          ${canManageCalendar ?`<button class="blue-btn calendar-create-btn" id="createCalendarEvent">${iconSvg("Plus")} Termin erstellen</button>` : `<p class="muted">Termine können durch Direktion und IT verwaltet werden.</p>`}
        </section>
        <section class="panel selected-day-panel">
          <h3>${escapeHtml(calendarDayTitle(selectedCalendarDate))}</h3>
          <div class="upcoming-list">
            ${selectedEvents.length ?selectedEvents.map((event) => `
              <article class="selected-event-card ${calendarColorClass(event.cancelled ?"Rot" : event.color)} ${event.cancelled ?"calendar-cancelled-card" : ""}">
                ${canManageCalendar ?`<button class="calendar-event-settings" data-id="${escapeHtml(event.id)}" data-instance-date="${escapeHtml(event.instanceDate || event.startDate)}" title="Termin verwalten">⚙</button>` : ""}
                <strong>${escapeHtml(event.title)}</strong>
                ${event.cancelled ?`<span class="calendar-cancelled-label">Fällt an diesem Tag aus</span>` : ""}
                ${event.isRecurringInstance ?`<span class="calendar-repeat-label">Wöchentlich wiederholt</span>` : ""}
                <span class="event-meta-line"><img class="event-meta-icon" src="/uhr.png" alt="" draggable="false">${event.allDay ?"Ganztägig" : `${escapeHtml(event.startTime)} Uhr - ${escapeHtml(event.endTime || "")} Uhr`}</span>
                <small class="event-meta-line"><img class="event-meta-icon" src="/standort.png" alt="" draggable="false">${escapeHtml(event.location || "Kein Ort")}</small>
                ${event.description ?`<p>${escapeHtml(event.description)}</p>` : ""}
                <small class="event-author">Erstellt von: ${escapeHtml(event.authorName || "-")}</small>
              </article>
            `).join("") : `<p class="muted">Keine Termine an diesem Tag.</p>`}
          </div>
        </section>
        <section class="panel">
          <h3>Anstehende Termine</h3>
          <div class="upcoming-list">
            ${monthEvents.length ?monthEvents.slice(0, 8).map((event) => `
              <article class="upcoming-event ${calendarColorClass(event.cancelled ?"Rot" : event.color)} ${event.cancelled ?"calendar-cancelled-card" : ""}">
                <strong>${escapeHtml(event.title)}</strong>
                ${event.cancelled ?`<span class="calendar-cancelled-label">Fällt aus</span>` : ""}
                <span class="event-meta-line"><img class="event-meta-icon" src="/uhr.png" alt="" draggable="false">${formatDate(event.startDate)} - ${event.allDay ?"Ganztägig" : `${escapeHtml(event.startTime)} Uhr`}</span>
                <small class="event-meta-line"><img class="event-meta-icon" src="/standort.png" alt="" draggable="false">${escapeHtml(event.location || "Kein Ort")}</small>
              </article>
            `).join("") : `<p class="muted">Keine Termine in diesem Monat.</p>`}
          </div>
        </section>
      </aside>
    </section>
  `;
  $("#calendarToday").addEventListener("click", () => {
    const now = new Date();
    calendarCursor = new Date(now.getFullYear(), now.getMonth(), 1);
    renderCalendar();
  });
  $("#calendarPrev").addEventListener("click", () => {
    calendarCursor = new Date(year, month - 1, 1);
    renderCalendar();
  });
  $("#calendarNext").addEventListener("click", () => {
    calendarCursor = new Date(year, month + 1, 1);
    renderCalendar();
  });
  $("#createCalendarEvent")?.addEventListener("click", () => openCalendarEventModal(selectedCalendarDate));
  document.querySelectorAll(".calendar-day[data-date]").forEach((button) => button.addEventListener("click", () => {
    selectedCalendarDate = button.dataset.date;
    renderCalendar();
  }));
  document.querySelectorAll(".calendar-event-settings").forEach((button) => button.addEventListener("click", () => {
    const event = events.find((item) => item.id === button.dataset.id && (item.instanceDate || item.startDate) === button.dataset.instanceDate);
    openCalendarEventActionsModal(event);
  }));
}

function calendarColorClass(color = "Blau") {
  return `calendar-color-${String(color).toLowerCase().replace("ü", "ue")}`;
}

function addOneHour(time = "10:00") {
  const [hour, minute] = time.split(":").map(Number);
  return `${String((hour + 1) % 24).padStart(2, "0")}:${String(minute || 0).padStart(2, "0")}`;
}

function dateFromIsoLocal(value) {
  return new Date(`${value}T00:00`);
}

function addDaysLocal(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function calendarEventInstances(events = [], rangeStart, rangeEnd) {
  const start = dateFromIsoLocal(rangeStart);
  const end = dateFromIsoLocal(rangeEnd);
  return events.flatMap((event) => {
    if (event.recurrence !== "weekly") {
      const date = dateFromIsoLocal(event.startDate);
      if (date < start || date > end) return [];
      return [{ ...event, instanceDate: event.startDate, instanceId: `${event.id}:${event.startDate}`, isRecurringInstance: false, cancelled: false }];
    }
    const firstDate = dateFromIsoLocal(event.startDate);
    const instances = [];
    for (let current = new Date(Math.max(start.getTime(), firstDate.getTime())); current <= end; current = addDaysLocal(current, 1)) {
      if (current.getDay() !== firstDate.getDay()) continue;
      const iso = isoDateLocal(current);
      const cancelled = (event.cancelledDates || []).includes(iso);
      instances.push({ ...event, seriesStartDate: event.startDate, startDate: iso, endDate: iso, instanceDate: iso, instanceId: `${event.id}:${iso}`, isRecurringInstance: true, cancelled });
    }
    return instances;
  }).sort((a, b) => `${a.startDate}T${a.startTime || "00:00"}`.localeCompare(`${b.startDate}T${b.startTime || "00:00"}`));
}

function openCalendarEventModal(date = isoDateLocal(new Date()), event = null) {
  const isEdit = Boolean(event);
  const startDate = event?.startDate || date || isoDateLocal(new Date());
  const startTime = event?.startTime || "10:00";
  const endTime = event?.endTime || addOneHour(startTime);
  openModal(`
    <h3>${isEdit ?"Termin bearbeiten" : "Neuer Termin"}</h3>
    <p class="muted">${isEdit ?"Bearbeite den Kalender-Termin" : "Erstelle einen neuen Kalender-Termin"}</p>
    <label>Titel *<input id="calendarTitle" value="${escapeHtml(event?.title || "")}" placeholder="z.B. Training Division Meeting"></label>
    <label>Beschreibung<textarea id="calendarDescription" placeholder="Weitere Details zum Termin...">${escapeHtml(event?.description || "")}</textarea></label>
    <label class="checkbox-line">Ganztägig<input type="checkbox" id="calendarAllDay" ${event?.allDay ?"checked" : ""}></label>
    <label class="checkbox-line">Dauerhaft wöchentlich an diesem Tag wiederholen<input type="checkbox" id="calendarRepeatWeekly" ${event?.recurrence === "weekly" ?"checked" : ""}></label>
    <div class="form-grid">
      <label>Startdatum *<input id="calendarStartDate" type="date" value="${escapeHtml(startDate)}"></label>
      <label>Startzeit *<input id="calendarStartTime" type="time" value="${escapeHtml(startTime)}"></label>
      <label>Enddatum<input id="calendarEndDate" type="date" value="${escapeHtml(event?.endDate || startDate)}"></label>
      <label>Endzeit<input id="calendarEndTime" type="time" value="${escapeHtml(endTime)}"></label>
    </div>
    <label>Event-Typ<select id="calendarType">${["Allgemein", "Training", "Besprechung", "Einsatz", "Prüfung"].map((item) => `<option ${event?.type === item ?"selected" : ""}>${item}</option>`).join("")}</select></label>
    <label>Farbe<select id="calendarColor">${["Blau", "Grün", "Orange", "Rot", "Lila"].map((item) => `<option ${event?.color === item ?"selected" : ""}>${item}</option>`).join("")}</select></label>
    <label>Ort<input id="calendarLocation" value="${escapeHtml(event?.location || "")}" placeholder="z.B. Mission Row - Besprechungsraum"></label>
    <label>Erinnerung (Minuten vorher)<select id="calendarReminder">${["Keine", "10 Minuten", "30 Minuten", "1 Stunde", "1 Tag"].map((item) => `<option ${(event?.reminder || "30 Minuten") === item ?"selected" : ""}>${item}</option>`).join("")}</select></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions"><button class="ghost-btn" data-close>Abbrechen</button><button class="blue-btn" id="saveCalendarEvent">${isEdit ?"Speichern" : "Termin erstellen"}</button></div>
  `, (modal) => {
    let endTouched = isEdit;
    modal.querySelector("#calendarEndTime").addEventListener("input", () => { endTouched = true; });
    modal.querySelector("#calendarStartTime").addEventListener("input", () => {
      if (!endTouched) $("#calendarEndTime").value = addOneHour($("#calendarStartTime").value);
    });
    modal.querySelector("#saveCalendarEvent").addEventListener("click", async () => {
      try {
        await api(isEdit ?`/api/calendar/events/${event.id}` : "/api/calendar/events", {
          method: isEdit ?"PATCH" : "POST",
          body: JSON.stringify({
            title: $("#calendarTitle").value,
            description: $("#calendarDescription").value,
            allDay: $("#calendarAllDay").checked,
            startDate: $("#calendarStartDate").value,
            startTime: $("#calendarStartTime").value,
            endDate: $("#calendarEndDate").value,
            endTime: $("#calendarEndTime").value,
            type: $("#calendarType").value,
            color: $("#calendarColor").value,
            location: $("#calendarLocation").value,
            reminder: $("#calendarReminder").value,
            recurrence: $("#calendarRepeatWeekly").checked ?"weekly" : "none"
          })
        });
        closeModal();
        await bootstrap();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openCalendarEventActionsModal(event) {
  if (!event) return;
  const instanceDate = event.instanceDate || event.startDate;
  openModal(`
    <h3>Termin verwalten</h3>
    <p class="muted">${escapeHtml(event.title)}${event.isRecurringInstance ?` · ${escapeHtml(formatDate(instanceDate))}` : ""}</p>
    <div class="action-menu-list">
      <button class="ghost-btn action-menu-btn" id="editCalendarEvent">${actionIcon("edit")} Bearbeiten</button>
      ${event.isRecurringInstance ?`<button class="${event.cancelled ?"blue-btn" : "ghost-btn"} action-menu-btn" id="toggleCalendarOccurrence">${event.cancelled ?actionIcon("restore") : actionIcon("dismiss")} ${event.cancelled ?"Termin an diesem Tag wieder aktivieren" : "Termin an diesem Tag ausfallen lassen"}</button>` : ""}
      <button class="red-btn action-menu-btn" id="deleteCalendarEvent">${actionIcon("delete")} Löschen</button>
    </div>
    <div class="modal-actions"><button class="ghost-btn" data-close>Schließen</button></div>
  `, (modal) => {
    modal.querySelector("#editCalendarEvent").addEventListener("click", () => {
      closeModal();
      openCalendarEventModal(null, state.settings.calendarEvents.find((item) => item.id === event.id) || event);
    });
    modal.querySelector("#toggleCalendarOccurrence")?.addEventListener("click", async () => {
      try {
        await api(`/api/calendar/events/${event.id}/cancel`, {
          method: "POST",
          body: JSON.stringify({ date: instanceDate, cancelled: !event.cancelled })
        });
        closeModal();
        await bootstrap();
      } catch (error) {
        showNotify(error.message, "error");
      }
    });
    modal.querySelector("#deleteCalendarEvent").addEventListener("click", () => {
      closeModal();
      openDeleteCalendarEventModal(event);
    });
  });
}

function openDeleteCalendarEventModal(event) {
  if (!event) return;
  openModal(`
    <h3>Termin löschen</h3>
    <p class="muted">${escapeHtml(event.title)} wirklich löschen?</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions"><button class="ghost-btn" data-close>Abbrechen</button><button class="red-btn" id="confirmDeleteCalendarEvent">Löschen</button></div>
  `, (modal) => {
    modal.querySelector("#confirmDeleteCalendarEvent").addEventListener("click", async () => {
      try {
        await api(`/api/calendar/events/${event.id}`, { method: "DELETE" });
        closeModal();
        await bootstrap();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function setupTableFilter(selector) {
  const input = $(selector);
  if (!input) return;
  input.addEventListener("input", () => {
    const term = input.value.trim();
    document.querySelectorAll(".filterable-row").forEach((row) => {
      const searchText = `${row.dataset.search || ""} ${row.textContent || ""}`;
      const matches = smartSearchMatch(searchText, term);
      row.classList.toggle("hidden", !matches);
      row.classList.toggle("search-match", Boolean(term && matches));
    });
  });
}

function openModal(html, onReady) {
  modalRoot.innerHTML = `<div class="modal"><button class="modal-x" type="button" data-close aria-label="Schließen">×</button>${html}</div>`;
  modalRoot.classList.remove("hidden");
  document.removeEventListener("keydown", handleModalEscape, true);
  document.addEventListener("keydown", handleModalEscape, true);
  modalRoot.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", closeModal));
  onReady?.(modalRoot.querySelector(".modal"));
  refreshEllipsisTooltipTargets(modalRoot);
}

function openConfirmModal({ title = "Löschen bestätigen", text = "Diesen Eintrag wirklich löschen?", confirmText = "Löschen", onConfirm }) {
  openModal(`
    <h3>${escapeHtml(title)}</h3>
    <p class="muted">${escapeHtml(text)}</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="red-btn" id="confirmGenericDelete">${escapeHtml(confirmText)}</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmGenericDelete").addEventListener("click", async () => {
      try {
        await onConfirm?.();
        closeModal();
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

function closeModal() {
  if (activeInformationDocUrlId && modalRoot.querySelector(".paper-doc-modal, .doc-compare-modal")) {
    activeInformationDocUrlId = "";
    lastOpenedDeepLinkDoc = "";
    updateAppUrl({ replace: true });
  }
  releaseInformationEditLock();
  const discardTrainingExamId = modalRoot.dataset.discardTrainingExamId;
  if (discardTrainingExamId) {
    try {
      const store = trainingStore();
      store.activeExams = (store.activeExams || []).filter((exam) => exam.id !== discardTrainingExamId || exam.startedAt);
      saveTrainingStore(store);
      const department = departmentByPage?.(state.page);
      if (isTrainingDepartmentSheet(department) || isHumanResourcesDepartmentSheet(department)) window.setTimeout(() => renderDepartmentPage(department), 0);
    } catch {
      // Closing a modal should never block the UI.
    }
    delete modalRoot.dataset.discardTrainingExamId;
  }
  document.removeEventListener("keydown", handleModalEscape, true);
  modalRoot.classList.add("hidden");
  modalRoot.innerHTML = "";
  if (liveReloadPendingAfterModal) {
    const pendingReload = liveReloadPendingAfterModal;
    liveReloadPendingAfterModal = false;
    if (pendingReload.type === "client-refresh") {
      window.setTimeout(() => reloadForClientRefresh(pendingReload.revision), 0);
      return;
    }
    window.setTimeout(() => bootstrap().catch((error) => {
      if (error.status === 401) handleAccessRevoked(error.message);
    }), 0);
  }
}

function handleModalEscape(event) {
  if (event.key !== "Escape" || modalRoot.classList.contains("hidden")) return;
  event.preventDefault();
  const closeButton = modalRoot.querySelector(".modal-x");
  if (closeButton) closeButton.click();
  else closeModal();
}

function openDefconModal() {
  if (!hasRole("Supervisor")) {
    openModal(`<h3>Keine Berechtigung</h3><p class="muted">DEFCON kann ab Supervisor geändert werden.</p><div class="modal-actions"><button class="ghost-btn" data-close>Schließen</button></div>`);
    return;
  }
  openModal(`
    <h3>DEFCON bearbeiten</h3>
    <label>Stufe
      <select id="defconSelect">${[1, 2, 3, 4, 5].map((nr) => `<option ${state.settings.defcon === `DEFCON ${nr}` ?"selected" : ""}>DEFCON ${nr}</option>`).join("")}</select>
    </label>
    <label>Beschreibung<input id="defconText" value="${escapeHtml(state.settings.defconText ?? "Automatisch / Manuell aktualisierbar")}"></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="blue-btn" id="saveDefcon">Bestätigen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#saveDefcon").addEventListener("click", async () => {
      try {
        await api("/api/settings/defcon", { method: "PATCH", body: JSON.stringify({ defcon: $("#defconSelect").value, defconText: $("#defconText").value }) });
        closeModal();
        await bootstrap();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openNoteModal(note = null) {
  if (!note?.id) note = null;
  if (!hasRole("Supervisor")) {
    openModal(`<h3>Keine Berechtigung</h3><p class="muted">Notizen können ab Supervisor erstellt werden.</p><div class="modal-actions"><button class="ghost-btn" data-close>Schließen</button></div>`);
    return;
  }
  const isEdit = Boolean(note);
  openModal(`
    <h3>${isEdit ?"Notiz bearbeiten" : "Notiz hinzufügen"}</h3>
    <label>Titel<input id="noteTitle" value="${escapeHtml(note?.title || "")}" required></label>
    <label>Priorität
      <select id="notePriority">
        ${["Info", "IT-Info", "Anweisung", "Direktion"].map((priority) => `<option ${note?.priority === priority ?"selected" : ""}>${priority}</option>`).join("")}
      </select>
    </label>
    <label>Text<textarea id="noteText" required>${escapeHtml(note?.text || "")}</textarea></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="blue-btn" id="saveNote">${isEdit ?"Notiz aktualisieren" : "Absenden"}</button>
    </div>
  `, (modal) => {
    modal.querySelector("#saveNote").addEventListener("click", async () => {
      try {
        await api(isEdit ?`/api/notes/${note.id}` : "/api/notes", {
          method: isEdit ?"PATCH" : "POST",
          body: JSON.stringify({ title: $("#noteTitle").value, priority: $("#notePriority").value, text: $("#noteText").value })
        });
        closeModal();
        await bootstrap();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openStartDutyModal() {
  let selected = "";
  openModal(`
    <div class="duty-workflow">
      <div class="duty-workflow-head">
        <span class="duty-head-icon">${iconSvg("Dienstblatt")}</span>
        <div>
          <span class="duty-kicker">Dienststatus</span>
          <h3>Dienst eintragen</h3>
          <p>Wähle den Bereich aus, in dem du jetzt arbeitest.</p>
        </div>
      </div>
      <div class="duty-choice-grid">
      ${availableDutyOptions().map((option) => {
        const undercoverLocked = option.title === "Undercover Dienst" && !currentUserCanStartDuty();
        const adminLocked = option.teamlerOnly && !state.currentUser.teamler && !hasRole("IT");
        const disabled = undercoverLocked || adminLocked;
        const disabledText = undercoverLocked ? "Nur für berechtigte Abteilungen freigegeben" : "Nur für Teamler freigegeben";
        return `
        <button class="duty-choice-card ${escapeHtml(option.tone || "default")}" data-status="${escapeHtml(option.title)}" ${disabled ?"disabled" : ""}>
          <span class="duty-card-accent"></span>
          <i>${iconSvg(option.icon)}</i>
          <span class="duty-card-copy"><strong>${escapeHtml(option.title)}</strong><small>${escapeHtml(disabled ?disabledText : option.description)}</small></span>
          <span class="duty-card-check">✓</span>
        </button>
      `;}).join("")}
      </div>
      <p id="modalError" class="form-error"></p>
      <div class="duty-modal-actions">
        <button class="ghost-btn" data-close>Abbrechen</button>
        <button class="blue-btn" id="confirmDuty" disabled>Eintragen</button>
      </div>
    </div>
  `, (modal) => {
    modal.classList.add("duty-modal");
    modal.querySelectorAll(".duty-choice-card").forEach((button) => {
      button.addEventListener("click", () => {
        selected = button.dataset.status;
        modal.querySelectorAll(".duty-choice-card").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        $("#confirmDuty").disabled = false;
      });
    });
    modal.querySelector("#confirmDuty").addEventListener("click", async () => {
      if (!selected) {
        $("#modalError").textContent = "Bitte wähle zuerst einen Dienststatus aus.";
        return;
      }
      try {
        await api("/api/duty/start", { method: "POST", body: JSON.stringify({ status: selected }) });
        closeModal();
        await bootstrap();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openSwitchDutyModal() {
  let selected = "";
  const current = state.duty.find((entry) => entry.userId === state.currentUser.id)?.status || "";
  openModal(`
    <div class="duty-workflow">
      <div class="duty-workflow-head">
        <span class="duty-head-icon">${iconSvg("Einsatzzentrale")}</span>
        <div>
          <span class="duty-kicker">Dienstwechsel</span>
          <h3>Dienst umtragen</h3>
          <p>Aktuell: ${escapeHtml(current || "Nicht im Dienst")}</p>
        </div>
      </div>
      <div class="duty-choice-grid">
      ${availableDutyOptions().filter((option) => option.title !== current).map((option) => {
        const undercoverLocked = option.title === "Undercover Dienst" && !currentUserCanStartDuty();
        const adminLocked = option.teamlerOnly && !state.currentUser.teamler && !hasRole("IT");
        const disabled = undercoverLocked || adminLocked;
        const disabledText = undercoverLocked ? "Nur für berechtigte Abteilungen freigegeben" : "Nur für Teamler freigegeben";
        return `<button class="duty-choice-card ${escapeHtml(option.tone || "default")}" data-status="${escapeHtml(option.title)}" ${disabled ?"disabled" : ""}><span class="duty-card-accent"></span><i>${iconSvg(option.icon)}</i><span class="duty-card-copy"><strong>${escapeHtml(option.title)}</strong><small>${escapeHtml(disabled ?disabledText : option.description)}</small></span><span class="duty-card-check">✓</span></button>`;
      }).join("")}
      </div>
      <p id="modalError" class="form-error"></p>
      <div class="duty-modal-actions">
        <button class="ghost-btn" data-close>Abbrechen</button>
        <button class="blue-btn" id="confirmSwitchDuty" disabled>Umtragen</button>
      </div>
    </div>
  `, (modal) => {
    modal.classList.add("duty-modal");
    modal.querySelectorAll(".duty-choice-card").forEach((button) => button.addEventListener("click", () => {
      selected = button.dataset.status;
      modal.querySelectorAll(".duty-choice-card").forEach((item) => item.classList.toggle("active", item === button));
      $("#confirmSwitchDuty").disabled = false;
    }));
    modal.querySelector("#confirmSwitchDuty").addEventListener("click", async () => {
      try {
        await api("/api/duty/switch", { method: "POST", body: JSON.stringify({ status: selected }) });
        closeModal();
        await bootstrap();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openStopDutyModal(myDuty) {
  openModal(`
    <h3>Dienst austragen</h3>
    <p class="muted">Aktueller Status: ${escapeHtml(myDuty?.status || "Nicht im Dienst")}</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="red-btn" id="confirmStopDuty" ${myDuty ?"" : "disabled"}>Dienst beenden</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmStopDuty").addEventListener("click", async () => {
      try {
        await api("/api/duty/stop", { method: "POST", body: "{}" });
        closeModal();
        await bootstrap();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openStopAllDutyModal() {
  if (!canAccess("actions", "stopAllDuty", "Direktion")) {
    openModal(`<h3>Keine Berechtigung</h3><p class="muted">Alle austragen ist für dich nicht freigegeben.</p><div class="modal-actions"><button class="ghost-btn" data-close>Schließen</button></div>`);
    return;
  }
  openModal(`
    <h3>Alle Officer austragen</h3>
    <p class="muted">Damit werden alle aktiven Dienst-Einträge beendet.</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="orange-btn" id="confirmStopAll">Alle Austragen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmStopAll").addEventListener("click", async () => {
      try {
        await api("/api/duty/stop-all", { method: "POST", body: "{}" });
        closeModal();
        await bootstrap();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openUserModal(user) {
  if (user && !canEditUserProfileClient(user)) {
    showNotify("Du hast keine Berechtigung, diesen Account zu bearbeiten.", "error");
    return;
  }
  const isEdit = Boolean(user);
  const rankLocked = Boolean(user && !canAffectUserRankClient(user));
  const selectedTrainings = user?.trainings || {};
  const baseRoles = editableRoleOptions(user);
  const selectedRole = baseRoles.includes(baseRoleForUser(user)) ?baseRoleForUser(user) : "User";
  const initialDn = isEdit ?String(user?.dn || "") : nextFreeDienstnummer();
  const initialDnConflict = dnConflictFor(initialDn, user?.id);
  const rankOptions = allowedRankOptionsForActor(user);
  openModal(`
    <h3>${isEdit ?"Mitglied bearbeiten" : "Neues Mitglied einstellen"}</h3>
    <form id="userForm" class="form-grid">
      <label>Name<input name="firstName" value="${escapeHtml(user?.firstName || "")}" required></label>
      <label class="frak-optional-field">Nachname / Doppelname<input name="lastName" value="${escapeHtml(user?.lastName || "")}" required></label>
      <label class="normal-account-field">Telefonnummer<input name="phone" value="${escapeHtml(user?.phone || "")}" required></label>
      <label class="normal-account-field">DN<input name="dn" id="userDnInput" inputmode="numeric" pattern="[0-9]+" value="${escapeHtml(initialDn)}" required></label>
      <label>Discord User-ID<input name="discordId" inputmode="numeric" pattern="[0-9]*" value="${escapeHtml(user?.discordId || "")}" placeholder="Optional"></label>
      <label>Einstellungsdatum<input name="joinedAt" type="date" value="${escapeHtml((user?.joinedAt || new Date().toISOString()).slice(0, 10))}"></label>
      <div id="userDnConflict" class="full normal-account-field">${renderDnConflictBox(initialDnConflict, initialDn)}</div>
      <label class="normal-account-field">Rang
        <select name="rank" ${rankLocked ?"disabled" : ""}>${rankOptions.map((rank) => `<option value="${rank.value}" ${Number(user?.rank ?? 0) === Number(rank.value) ?"selected" : ""}>${escapeHtml(rankOptionLabel(rank))}</option>`).join("")}</select>
      </label>
      ${rankLocked ?`<input type="hidden" name="rank" value="${escapeHtml(user?.rank ?? 0)}"><p class="muted full">Rangänderungen sind bei dir selbst sowie bei gleichem oder höherem Rang gesperrt.</p>` : ""}
      <label>Rolle
        <select name="role">${baseRoles.map((role) => `<option ${selectedRole === role ?"selected" : ""}>${escapeHtml(role)}</option>`).join("")}</select>
      </label>
      ${renderTeamlerControl(user)}
      ${renderItRoleControls(user)}
      <div class="full normal-account-field">
        <p class="muted">Ausbildungen</p>
        ${renderTrainingPicker(selectedTrainings)}
      </div>
      <p id="modalError" class="form-error full"></p>
      <div class="modal-actions full">
        <button class="ghost-btn" type="button" data-close>Abbrechen</button>
        <button class="blue-btn" type="submit">${isEdit ?"Speichern" : "Einstellen"}</button>
      </div>
    </form>
  `, (modal) => {
    const roleSelect = modal.querySelector('select[name="role"]');
    const syncFrakverwaltungFields = () => {
      const frak = roleSelect?.value === "Frakverwaltung";
      modal.querySelectorAll(".normal-account-field").forEach((element) => element.classList.toggle("hidden", frak));
      modal.querySelector('.frak-optional-field input[name="lastName"]')?.toggleAttribute("required", !frak);
      modal.querySelector('input[name="phone"]')?.toggleAttribute("required", !frak);
      modal.querySelector('input[name="dn"]')?.toggleAttribute("required", !frak);
      if (frak) modal.querySelector("#userDnConflict").innerHTML = "";
      else {
        const dn = modal.querySelector("#userDnInput")?.value || "";
        modal.querySelector("#userDnConflict").innerHTML = renderDnConflictBox(dnConflictFor(dn, user?.id), dn);
      }
    };
    roleSelect?.addEventListener("change", syncFrakverwaltungFields);
    syncFrakverwaltungFields();
    modal.querySelector("#userForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const body = Object.fromEntries(form.entries());
      body.baseRole = body.role;
      if (canGrantItRoles()) {
        body.role = form.get("isITLead") === "on" ?"IT-Leitung" : form.get("isIT") === "on" ?"IT" : body.baseRole;
      } else {
        body.role = user?.role || body.baseRole;
      }
      delete body.isIT;
      delete body.isITLead;
      body.departments = user?.departments || [];
      const isFrak = body.baseRole === "Frakverwaltung";
      body.rank = isFrak ?0 : Number(body.rank);
      body.teamler = isFrak ?false : form.get("teamler") === "on";
      body.overwriteDn = $("#overwriteDn")?.checked || false;
      body.trainings = Object.fromEntries(visibleTrainings().map((training) => [training, isFrak ?false : form.get(`training_${training}`) === "on"]));
      try {
        await api(isEdit ?`/api/users/${user.id}` : "/api/users", {
          method: isEdit ?"PATCH" : "POST",
          body: JSON.stringify(body)
        });
        closeModal();
        await bootstrap();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
    modal.querySelector("#userDnInput").addEventListener("input", (event) => {
      const dn = event.target.value;
      modal.querySelector("#userDnConflict").innerHTML = renderDnConflictBox(dnConflictFor(dn, user?.id), dn);
    });
  });
}

function openHrUserModal() {
  const autoDn = nextFreeDienstnummer();
  const hireDate = isoDateLocal(new Date());
  openModal(`
    <h3>Neues Mitglied einstellen</h3>
    <form id="hrUserForm" class="form-grid">
      <label>Name<input name="firstName" required></label>
      <label>Nachname / Doppelname<input name="lastName" required></label>
      <label>Telefonnummer<input name="phone" required></label>
      <div class="hr-auto-grid full">
        <span><b>Dienstnummer</b>${escapeHtml(autoDn)}</span>
        <span><b>Rang</b>${escapeHtml(rankLabel(0))}</span>
        <span><b>Rolle</b>User</span>
        <span><b>Einstellungsdatum</b>${formatDate(hireDate)}</span>
      </div>
      <p id="modalError" class="form-error full"></p>
      <div class="modal-actions full">
        <button class="ghost-btn" type="button" data-close>Abbrechen</button>
        <button class="blue-btn" type="submit">Account anlegen</button>
      </div>
    </form>
  `, (modal) => {
    modal.querySelector("#hrUserForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api("/api/hr/users", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))
        });
        closeModal();
        await bootstrap();
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

function findAnyUser(userId) {
  return [...(state.users || []), ...(state.archivedUsers || [])].find((item) => item.id === userId);
}

function readUprankRulesDraft(formElement = $("#uprankRulesForm")) {
  if (!formElement) return uprankRules();
  const form = new FormData(formElement);
  return uprankRules().map((rule) => ({
    targetRank: Number(rule.targetRank),
    minDays: Number(form.get(`minDays_${rule.targetRank}`) || 0),
    specialOnly: form.get(`specialOnly_${rule.targetRank}`) === "on",
    trainings: visibleTrainings().filter((training) => form.get(`rule_${rule.targetRank}_${training}`) === "on")
  }));
}

function sameUprankRules(a = [], b = []) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function persistQueuedUprankRules() {
  while (uprankRulesPendingDraft) {
    const rules = uprankRulesPendingDraft;
    uprankRulesPendingDraft = null;
    uprankRulesSaving = true;
    const error = $("#uprankRulesError");
    const button = $("#saveUprankRulesButton");
    if (error) {
      error.textContent = "Speichert gerade. Weitere Änderungen werden danach automatisch mitgespeichert.";
      error.className = "muted";
    }
    if (button) button.textContent = "Speichert...";
    try {
      const data = await api("/api/settings/uprank-rules", { method: "PATCH", body: JSON.stringify({ rules }), silent: true });
      state.settings.uprankRules = data.rules || rules;
    } catch (error) {
      const target = $("#uprankRulesError");
      if (target) {
        target.textContent = error.message;
        target.className = "form-error";
      }
      throw error;
    }
    const liveDraft = readUprankRulesDraft();
    if (!sameUprankRules(liveDraft, state.settings.uprankRules)) uprankRulesPendingDraft = liveDraft;
  }
  uprankRulesSaving = false;
  const error = $("#uprankRulesError");
  const button = $("#saveUprankRulesButton");
  if (button) button.textContent = "Voraussetzungen speichern";
  if (error) {
    error.textContent = "Alle Änderungen gespeichert.";
    error.className = "muted";
  }
  showNotify("Uprank Voraussetzungen gespeichert.");
}

async function saveUprankRules(event) {
  event.preventDefault();
  uprankRulesPendingDraft = readUprankRulesDraft(event.currentTarget);
  uprankRulesSaveQueue = uprankRulesSaveQueue
    .catch(() => {})
    .then(() => persistQueuedUprankRules())
    .catch((error) => {
      const target = $("#uprankRulesError");
      if (target) {
        target.textContent = error.message;
        target.className = "form-error";
      }
    });
  await uprankRulesSaveQueue;
}

async function saveDnBlacklist(event) {
  event.preventDefault();
  const raw = $("#dnBlacklistInput")?.value || "";
  const dnBlacklist = [...new Set(raw.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))];
  const invalid = dnBlacklist.find((item) => !/^\d+$/.test(item));
  if (invalid) {
    $("#dnBlacklistError").textContent = `Ungültige Dienstnummer: ${invalid}`;
    return;
  }
  try {
    const data = await api("/api/settings/dn-blacklist", { method: "PATCH", body: JSON.stringify({ dnBlacklist }) });
    state.settings = data.settings || { ...state.settings, dnBlacklist: data.dnBlacklist || dnBlacklist };
    showNotify("Dienstnummer Blacklist gespeichert.");
    renderDirektion();
  } catch (error) {
    $("#dnBlacklistError").textContent = error.message;
  }
}

function openUprankModal(user, forceSpecial = false, targetRank = null) {
  const evaluation = evaluateUprank(user, targetRank);
  openModal(`
    <h3>Uprank durchf\u00fchren</h3>
    <p class="muted">${escapeHtml(fullName(user))} \u00b7 ${escapeHtml(rankLabel(user.rank))} \u2192 ${escapeHtml(rankLabel(evaluation.targetRank))}</p>
    <div class="uprank-modal-summary">
      <span class="requirement-chip ${evaluation.missingDays ?"missing" : "ok"}">${evaluation.missingDays ?`${evaluation.missingDays} Tage fehlen` : "Dauer erf\u00fcllt"}</span>
      <span class="requirement-chip ${evaluation.missingTrainings.length ?"missing" : "ok"}">${evaluation.missingTrainings.length ?`Fehlt: ${escapeHtml(evaluation.missingTrainings.join(", "))}` : "Ausbildungen erf\u00fcllt"}</span>
      <span class="requirement-chip ${forceSpecial ?"special" : "ok"}">${forceSpecial ?"Sonderuprank" : "Regul\u00e4rer Uprank"}</span>
    </div>
    <form id="uprankForm" class="form-grid">
      <label class="full">Begr\u00fcndung<textarea name="reason" placeholder="Kurz begr\u00fcnden, besonders bei Sonderupranks."></textarea></label>
      <label class="action-confirm-toggle full"><input type="checkbox" name="ingameDone" required><span><b>Ingame get\u00e4tigt</b><small>Bef\u00f6rderung wurde im Spiel umgesetzt.</small></span></label>
      <p id="modalError" class="form-error full"></p>
      <div class="modal-actions full">
        <button class="ghost-btn" type="button" data-close>Abbrechen</button>
        <button class="blue-btn" type="submit">Uprank speichern</button>
      </div>
    </form>
  `, (modal) => {
    modal.querySelector("#uprankForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        await api(`/api/users/${user.id}/uprank`, {
          method: "POST",
          body: JSON.stringify({
            targetRank: evaluation.targetRank,
            reason: form.get("reason"),
            ingameDone: form.get("ingameDone") === "on",
            special: forceSpecial
          })
        });
        closeModal();
        const data = await api("/api/bootstrap", { silent: true });
        Object.assign(state, data);
        renderDirektion();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openUprankAdjustmentModal(user, type) {
  const evaluation = evaluateUprank(user);
  const isShortening = type === "Verkürzung";
  const needsDays = ["Verkürzung", "Verlängerung"].includes(type);
  openModal(`
    <h3>${escapeHtml(type)} eintragen</h3>
    <p class="muted">${escapeHtml(fullName(user))} · Zielrang ${escapeHtml(rankLabel(evaluation.targetRank))}</p>
    <form id="uprankAdjustmentForm" class="form-grid">
      ${needsDays ?`<label>Tage ${isShortening ?"Verkürzung" : "Verlängerung"}<input type="number" name="days" min="1" value="${isShortening ?7 : 7}" required></label>` : ""}
      <label class="${isShortening ?"" : "full"}">Zielrang
        <select name="targetRank">
          ${state.ranks.filter((rank) => Number(rank.value) > Number(user.rank)).map((rank) => `<option value="${rank.value}" ${Number(rank.value) === evaluation.targetRank ?"selected" : ""}>${escapeHtml(rankOptionLabel(rank))}</option>`).join("")}
        </select>
      </label>
      <label class="full">Grund<textarea name="reason" required></textarea></label>
      <p id="modalError" class="form-error full"></p>
      <div class="modal-actions full">
        <button class="ghost-btn" type="button" data-close>Abbrechen</button>
        <button class="blue-btn" type="submit">Speichern</button>
      </div>
    </form>
  `, (modal) => {
    modal.querySelector("#uprankAdjustmentForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        await api(`/api/users/${user.id}/uprank-adjustments`, {
          method: "POST",
          body: JSON.stringify({
            type,
            targetRank: Number(form.get("targetRank")),
            days: Number(form.get("days") || 0),
            reason: form.get("reason")
          })
        });
        closeModal();
        const data = await api("/api/bootstrap", { silent: true });
        Object.assign(state, data);
        renderDirektion();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openDeleteUserModal(userId) {
  if (!canDeleteAccounts()) {
    showNotify("Accounts löschen darf nur IT oder IT-Leitung.", "error");
    return;
  }
  const user = findAnyUser(userId);
  openModal(`
    <h3>Account löschen</h3>
    <p class="muted">${escapeHtml(fullName(user))} wirklich löschen?</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="red-btn" id="confirmDelete">Löschen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmDelete").addEventListener("click", async () => {
      try {
        await api(`/api/users/${userId}`, { method: "DELETE" });
        closeModal();
        await bootstrap();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openRehireUserModal(user) {
  const info = terminationInfo(user);
  const oldDn = String(info.oldDn || user.dn || "");
  const selectedTrainings = info.oldTrainings || user.trainings || {};
  const baseRoles = editableRoleOptions(user);
  const selectedRole = baseRoles.includes(baseRoleForUser(user)) ?baseRoleForUser(user) : "User";
  openModal(`
    <h3>Wiedereinstellen</h3>
    <div class="old-data-box">
      <div>
        <strong>Alte Daten</strong>
        <p>Name: ${escapeHtml(fullName(user))} · Telefon: ${escapeHtml(user.phone || "-")} · Dienstnummer: ${escapeHtml(oldDn || "-")} · Rang: ${escapeHtml(rankLabel(info.oldRank ?? user.rank))}</p>
      </div>
      <button class="ghost-btn" type="button" id="fillOldRehireData">Alte Daten übernehmen</button>
    </div>
    <div id="rehireDnConflict"></div>
    <form id="rehireUserForm" class="form-grid">
      <label>Name<input name="firstName" id="rehireFirstName" value="" required></label>
      <label>Nachname / Doppelname<input name="lastName" id="rehireLastName" value="" required></label>
      <label>Telefonnummer<input name="phone" id="rehirePhone" value="" required></label>
      <label>Dienstnummer<input name="dn" id="rehireDnInput" inputmode="numeric" pattern="[0-9]+" value="" required></label>
      <label>Einstellungsdatum<input name="joinedAt" id="rehireJoinedAt" type="date" value=""></label>
      <label>Rang
        <select name="rank" id="rehireRank">
          <option value="">Rang auswählen</option>
          ${state.ranks.map((rank) => `<option value="${rank.value}">${escapeHtml(rankOptionLabel(rank))}</option>`).join("")}
        </select>
      </label>
      <label>Rolle
        <select name="role">${baseRoles.map((role) => `<option ${selectedRole === role ?"selected" : ""}>${escapeHtml(role)}</option>`).join("")}</select>
      </label>
      ${renderTeamlerControl(user)}
      ${renderItRoleControls(user)}
      <label class="full">Grund der Wiedereinstellung<textarea name="reason">Wiedereinstellung</textarea></label>
      <div class="full">
        <p class="muted">Ausbildungen</p>
        ${renderTrainingPicker(selectedTrainings)}
      </div>
      <p id="modalError" class="form-error full"></p>
      <div class="modal-actions full">
        <button class="ghost-btn" type="button" data-close>Abbrechen</button>
        <button class="blue-btn" type="submit">Wiedereinstellen</button>
      </div>
    </form>
  `, (modal) => {
    modal.querySelector("#rehireUserForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const baseRole = form.get("role");
      const role = canGrantItRoles() ?(form.get("isITLead") === "on" ?"IT-Leitung" : form.get("isIT") === "on" ?"IT" : baseRole) : user.role;
      try {
        await api(`/api/users/${user.id}/rehire`, {
          method: "POST",
          body: JSON.stringify({
            dn: form.get("dn"),
            rank: Number(form.get("rank")),
            firstName: form.get("firstName"),
            lastName: form.get("lastName"),
            phone: form.get("phone"),
            joinedAt: form.get("joinedAt"),
            role,
            baseRole,
            teamler: form.get("teamler") === "on",
            reason: form.get("reason"),
            overwriteDn: $("#overwriteDn")?.checked || false,
            trainings: Object.fromEntries(visibleTrainings().map((training) => [training, form.get(`training_${training}`) === "on"]))
          })
        });
        closeModal();
        await bootstrap();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
    modal.querySelector("#rehireDnInput").addEventListener("input", (event) => {
      const dn = event.target.value;
      modal.querySelector("#rehireDnConflict").innerHTML = renderDnConflictBox(dnConflictFor(dn, user.id), dn);
    });
    modal.querySelector("#fillOldRehireData").addEventListener("click", () => {
      modal.querySelector("#rehireFirstName").value = user.firstName || "";
      modal.querySelector("#rehireLastName").value = user.lastName || "";
      modal.querySelector("#rehirePhone").value = user.phone || "";
      modal.querySelector("#rehireDnInput").value = oldDn;
      modal.querySelector("#rehireJoinedAt").value = new Date().toISOString().slice(0, 10);
      modal.querySelector("#rehireRank").value = String(info.oldRank ?? user.rank ?? "");
      modal.querySelector("#rehireDnConflict").innerHTML = renderDnConflictBox(dnConflictFor(oldDn, user.id), oldDn);
    });
  });
}

function openUserActionsModal(user) {
  const canManageTarget = canAffectUserRankClient(user);
  const canEditTarget = canEditUserProfileClient(user);
  const blockedHint = user.id === state.currentUser?.id
    ?"Du kannst diese Maßnahme nicht auf dich selbst anwenden."
    : "Gleicher oder höherer Rang: Maßnahme gesperrt.";
  const disabledAttr = canManageTarget ?"" : `disabled title="${escapeHtml(blockedHint)}"`;
  openModal(`
    <div class="user-action-head">
      <div>
        <h3>Aktionen</h3>
        <p class="muted">${escapeHtml(fullName(user))} · ${escapeHtml(rankLabel(user.rank))}</p>
      </div>
      ${!canManageTarget ?`<span class="action-lock-note">${escapeHtml(blockedHint)}</span>` : ""}
    </div>
    <div class="user-action-menu">
      <div class="user-action-group">
        <p>Akte & Bearbeitung</p>
        <button class="user-action-card primary" id="actionOpenFile" type="button">
          <span>${iconSvg("Direktion")}</span><b>Akte öffnen</b><small>Aktennotizen, Sanktionen und Verlauf ansehen.</small>
        </button>
        <button class="user-action-card info" id="actionEditUser" type="button" ${canEditTarget ?"" : "disabled"}>
          <span>${iconSvg("Settings")}</span><b>Account bearbeiten</b><small>Mitgliedsdaten und Berechtigungen anpassen${canManageTarget ?"." : ", Rang bleibt gesperrt."}</small>
        </button>
      </div>
      <div class="user-action-group">
        <p>Zugriff einschränken</p>
        <button class="user-action-card warn" id="actionToggleLock" type="button" ${disabledAttr}>
          <span>${iconSvg("Lock")}</span><b>${user.locked ?"Entsperren" : "Sperren"}</b><small>${user.locked ?"Account wieder freigeben." : "Account sperren und Sitzung beenden."}</small>
        </button>
        <button class="user-action-card warn" id="actionSuspendUser" type="button" ${disabledAttr}>
          <span>${iconSvg("Logout")}</span><b>Suspendieren</b><small>Account suspendieren und Zugriff entziehen.</small>
        </button>
      </div>
      <div class="user-action-group">
        <p>Austritt</p>
        <button class="user-action-card danger" id="actionDismissUser" type="button" ${disabledAttr}>
          <span>${iconSvg("Logout")}</span><b>Entlassen</b><small>Account ins Archiv verschieben.</small>
        </button>
      </div>
      ${canDeleteAccounts() ?`<div class="user-action-group"><p>Fehlerhafte Accounts</p><button class="user-action-card critical" id="actionDeleteUser" type="button"><span>${iconSvg("Anweisung")}</span><b>Löschen</b><small>Nur IT: fehlerhaften Account endgültig entfernen.</small></button></div>` : ""}
    </div>
    <div class="modal-actions"><button class="ghost-btn" data-close>Schließen</button></div>
  `, (modal) => {
    modal.querySelector("#actionEditUser")?.addEventListener("click", () => {
      closeModal();
      openUserModal(user);
    });
    modal.querySelector("#actionOpenFile").addEventListener("click", () => {
      closeModal();
      openPersonnelFileModal(user);
    });
    modal.querySelector("#actionToggleLock")?.addEventListener("click", () => openReasonUserModal(user, user.locked ?"Entsperren" : "Sperren", `/api/users/${user.id}/lock`, "PATCH", { locked: !user.locked }));
    modal.querySelector("#actionSuspendUser")?.addEventListener("click", () => openSuspendUserModal(user));
    modal.querySelector("#actionDismissUser")?.addEventListener("click", () => openDismissUserModal(user));
    modal.querySelector("#actionDeleteUser")?.addEventListener("click", () => {
      closeModal();
      openDeleteUserModal(user.id);
    });
  });
}

function openSuspendUserModal(user) {
  openReasonUserModal(user, "Suspendieren", `/api/users/${user.id}/suspend`, "POST");
}

function openDismissUserModal(user) {
  openReasonUserModal(user, "Entlassen", `/api/users/${user.id}/dismiss`, "POST");
}

function openPersonnelFileModal(user) {
  const entries = (state.disciplinary || []).filter((entry) => entry.userId === user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const isStrike = (entry) => entry.type === "Strike" || (entry.type === "Sanktion" && entry.sanctionType === "Strike");
  const isExpired = (entry) => entry.expiresAt && new Date(entry.expiresAt) <= new Date();
  const isActiveStrike = (entry) => isStrike(entry) && isActiveDisciplinaryStrike(entry) && !isExpired(entry);
  const strikeWeight = (entry) => Math.max(1, Number(entry.strikeCount || 1));
  const notes = entries.filter((entry) => entry.type === "Aktennotiz");
  const sanctions = entries.filter((entry) => entry.type === "Sanktion" || entry.type === "Strike" || isDisciplinaryFine(entry));
  const fines = entries.filter(isDisciplinaryFine);
  const pendingApprovalEntries = sanctions.filter((entry) => sanctionWorkflowStatus(entry) === "pending_approval");
  const openSanctions = sanctions.filter((entry) => sanctionWorkflowStatus(entry) === "open");
  const activeSanctions = sanctions.filter((entry) => sanctionWorkflowStatus(entry) === "active");
  const rejectedEntries = sanctions.filter((entry) => sanctionWorkflowStatus(entry) === "rejected");
  const openFines = fines.filter(isOpenDisciplinaryFine);
  const archivedEntries = sanctions.filter((entry) => sanctionWorkflowStatus(entry) === "archive");
  const openFineAmount = openFines.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const activeStrikes = sanctions.filter(isActiveStrike).reduce((sum, entry) => sum + strikeWeight(entry), 0);
  const waitingCount = pendingApprovalEntries.length + openSanctions.length;
  const fileStateText = waitingCount ?"Freigabe / Verkündung offen" : activeSanctions.length ?"Aktive Sanktionen" : "Keine offenen Sanktionen";
  openModal(`
    <div class="personnel-file-hero">
      <div>
        <span class="eyebrow">Personalakte</span>
        <h3>${escapeHtml(fullName(user))}</h3>
        <p>${escapeHtml(rankLabel(user.rank))} · DN ${escapeHtml(user.dn || "-")} · Tel. ${escapeHtml(user.phone || "-")} · ${renderAccountStatus(user)}</p>
        <div class="personnel-file-hero-facts">
          <span><b>Discord</b>${escapeHtml(user.discordName || user.discordId || "-")}</span>
          <span><b>Beitritt</b>${formatDate(user.joinedAt || user.createdAt)}</span>
          <span><b>Letzte Beförderung</b>${formatDate(user.lastPromotionAt || user.joinedAt || user.createdAt)}</span>
          <span><b>Rolle</b>${escapeHtml(user.role || "-")}</span>
        </div>
      </div>
      <div class="personnel-file-state ${waitingCount ?"danger" : "ok"}">${fileStateText}</div>
    </div>
    <div class="file-action-bar">
      <div>
        <strong>Akte bearbeiten</strong>
        <span>Notizen, Sanktionen und offene Geldstrafen verwalten.</span>
      </div>
      <div class="button-row file-action-row">
        <button class="blue-btn" id="addFileNote">Notiz hinzufügen</button>
        <button class="orange-btn" id="addFileSanction">Sanktion vergeben</button>
      </div>
    </div>
    <div class="file-section-grid">
      <section class="file-section sanctions">
        <div class="file-section-head"><h4>Warten auf Freigabe</h4><span>${pendingApprovalEntries.length}</span></div>
        <div class="personnel-file-list compact">${pendingApprovalEntries.map((entry) => renderFileEntry(entry, { expired: isExpired(entry), manageable: true })).join("") || `<p class="muted">Keine Sanktionen zur Freigabe.</p>`}</div>
      </section>
      <section class="file-section sanctions">
        <div class="file-section-head"><h4>Offen</h4><span>${openSanctions.length}</span></div>
        <div class="personnel-file-list compact">${openSanctions.map((entry) => renderFileEntry(entry, { expired: isExpired(entry), manageable: true })).join("") || `<p class="muted">Keine offenen Verkündungen oder Zahlungen.</p>`}</div>
      </section>
      <section class="file-section sanctions">
        <div class="file-section-head"><h4>Aktiv</h4><span>${activeSanctions.length}</span></div>
        <div class="personnel-file-list compact">${activeSanctions.map((entry) => renderFileEntry(entry, { activeStrike: isActiveStrike(entry), expired: isExpired(entry), manageable: true })).join("") || `<p class="muted">Keine aktiven Sanktionen.</p>`}</div>
      </section>
      <section class="file-section sanctions rejected">
        <div class="file-section-head"><h4>Abgelehnt</h4><span>${rejectedEntries.length}</span></div>
        <div class="personnel-file-list compact">${rejectedEntries.map((entry) => renderFileEntry(entry, { manageable: true })).join("") || `<p class="muted">Keine abgelehnten Sanktionen.</p>`}</div>
      </section>
      <section class="file-section notes">
        <div class="file-section-head"><h4>Notizen</h4><span>${notes.length}</span></div>
        <div class="personnel-file-list compact">${notes.map((entry) => renderFileEntry(entry, { manageable: true })).join("") || `<p class="muted">Noch keine Notizen.</p>`}</div>
      </section>
      <section class="file-section history">
        <div class="file-section-head"><h4>Archiv</h4><span>${archivedEntries.length}</span></div>
        <div class="personnel-file-list compact">${archivedEntries.map((entry) => renderFileEntry(entry, { expired: isExpired(entry), manageable: true, archive: true })).join("") || `<p class="muted">Noch kein Archiv.</p>`}</div>
      </section>
    </div>
    <div class="modal-actions"><button class="ghost-btn" data-close>Schließen</button></div>
  `, (modal) => {
    modal.classList.add("personnel-file-modal");
    modal.querySelector("#addFileNote").addEventListener("click", () => openPersonnelFileEntryModal(user, "Aktennotiz"));
    modal.querySelector("#addFileSanction").addEventListener("click", () => openPersonnelFileEntryModal(user, "Sanktion", activeStrikes));
    modal.querySelectorAll(".resolve-file-entry").forEach((button) => button.addEventListener("click", async () => {
      try {
        const data = await api(`/api/users/${user.id}/file/${button.dataset.id}`, { method: "PATCH", body: JSON.stringify({ resolved: true }) });
        updateDisciplinaryEntryState(data.entry);
        renderApp();
        openPersonnelFileModal(findAnyUser(user.id));
      } catch (error) {
        openModal(`<h3>Akteneintrag konnte nicht erledigt werden</h3><p class="form-error">${escapeHtml(error.message)}</p><div class="modal-actions"><button class="ghost-btn" data-close>Schließen</button></div>`);
      }
    }));
    modal.querySelectorAll(".file-note-edit").forEach((button) => button.addEventListener("click", () => openEditFileNoteModal(user, entries.find((entry) => entry.id === button.dataset.id))));
    modal.querySelectorAll(".file-entry-delete").forEach((button) => button.addEventListener("click", () => openDeleteFileEntryModal(user, entries.find((entry) => entry.id === button.dataset.id))));
    modal.querySelectorAll(".approve-file-entry").forEach((button) => button.addEventListener("click", () => openApproveSanctionModal(user, entries.find((entry) => entry.id === button.dataset.id))));
    modal.querySelectorAll(".reject-file-entry").forEach((button) => button.addEventListener("click", () => openRejectSanctionModal(user, entries.find((entry) => entry.id === button.dataset.id))));
    modal.querySelectorAll(".announce-file-entry").forEach((button) => button.addEventListener("click", () => openAnnounceSanctionModal(user, entries.find((entry) => entry.id === button.dataset.id))));
    modal.querySelectorAll(".mark-fine-paid").forEach((button) => button.addEventListener("click", () => openFinePaidModal(user, entries.find((entry) => entry.id === button.dataset.id))));
    modal.querySelectorAll(".resolve-strike-entry").forEach((button) => button.addEventListener("click", () => openStrikeResolvedModal(user, entries.find((entry) => entry.id === button.dataset.id))));
  });
}

function openRemoveUprankAdjustmentModal(user, adjustmentId) {
  const adjustment = (state.settings.uprankAdjustments || [])
    .filter((item) => item.userId === user?.id && item.type === "Sonderuprank")
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .find((item) => item.id === adjustmentId) || (state.settings.uprankAdjustments || [])
    .filter((item) => item.userId === user?.id && item.type === "Sonderuprank")
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
  if (!user || !adjustment) return;
  openModal(`
    <h3>Sonderuprank entziehen</h3>
    <p class="muted">${escapeHtml(fullName(user))} · ${escapeHtml(rankLabel(adjustment.targetRank))}</p>
    <p>Diesen vorgemerkten Sonderuprank wirklich entfernen?</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions"><button class="ghost-btn" data-close>Abbrechen</button><button class="red-btn" id="confirmRemoveAdjustment">Entziehen</button></div>
  `, (modal) => {
    modal.querySelector("#confirmRemoveAdjustment").addEventListener("click", async () => {
      try {
        const deleteId = adjustment.id || adjustmentId || "sonderuprank";
        const data = await api(`/api/users/${user.id}/uprank-adjustments/${deleteId}`, { method: "DELETE" });
        state.settings.uprankAdjustments = data.uprankAdjustments || state.settings.uprankAdjustments;
        closeModal();
        updateUprankList();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function nextSundayIso() {
  const date = new Date();
  const day = date.getDay();
  const diff = (7 - day) % 7 || 7;
  date.setDate(date.getDate() + diff);
  return isoDateLocal(date);
}

function openUprankBlockModal(user) {
  if (!user) return;
  openModal(`
    <h3>Uprank-Sperre setzen</h3>
    <p class="muted">${escapeHtml(fullName(user))}</p>
    <label>Sperre bis<input id="uprankBlockUntil" type="date" value="${nextSundayIso()}"></label>
    <label>Grund<textarea id="uprankBlockReason" required></textarea></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions"><button class="ghost-btn" data-close>Abbrechen</button><button class="orange-btn" id="confirmUprankBlock">Sperre setzen</button></div>
  `, (modal) => {
    modal.querySelector("#confirmUprankBlock").addEventListener("click", async () => {
      try {
        const data = await api(`/api/users/${user.id}/uprank-block`, {
          method: "POST",
          body: JSON.stringify({ until: $("#uprankBlockUntil").value, reason: $("#uprankBlockReason").value })
        });
        updateDisciplinaryEntryState(data.entry);
        closeModal();
        updateUprankList();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function updateDisciplinaryEntryState(entry) {
  if (!entry?.id) return;
  const entries = [...(state.disciplinary || [])];
  const index = entries.findIndex((item) => item.id === entry.id);
  if (index === -1) entries.unshift(entry);
  else entries[index] = entry;
  state.disciplinary = entries;
}

function removeDisciplinaryEntryState(entryId) {
  state.disciplinary = (state.disciplinary || []).filter((entry) => entry.id !== entryId);
}

function refreshFileViews(userId) {
  renderApp();
  openPersonnelFileModal(findAnyUser(userId));
}

function openFinePaidModal(user, entry) {
  if (!entry) return;
  const payTargets = [
    "LSPD Kasse",
    ...sortMembersForRankList(state.users || []).map((person) => `${fullName(person)}${person.dn ?` · DN ${person.dn}` : ""}`)
  ];
  openModal(`
    <h3>Geldstrafe bezahlt</h3>
    <p class="muted">${escapeHtml(entry.title || "Geldstrafe")} · ${Number(entry.amount || 0).toLocaleString("de-DE")} $</p>
    <label>Bezahlt an
      <input id="finePaidTo" list="finePaidToOptions" placeholder="Person oder Kasse suchen..." required autocomplete="off">
      <datalist id="finePaidToOptions">${payTargets.map((target) => `<option value="${escapeHtml(target)}"></option>`).join("")}</datalist>
    </label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="blue-btn" id="confirmFinePaid">Als bezahlt markieren</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmFinePaid")?.addEventListener("click", async () => {
      const paidTo = modal.querySelector("#finePaidTo")?.value.trim() || "";
      if (!paidTo) {
        modal.querySelector("#modalError").textContent = "Bitte angeben, an wen bezahlt wurde.";
        return;
      }
      try {
        const data = await api(`/api/users/${user.id}/file/${entry.id}`, { method: "PATCH", body: JSON.stringify({ paid: true, paidTo }) });
        updateDisciplinaryEntryState(data.entry);
        refreshFileViews(user.id);
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

function openStrikeResolvedModal(user, entry) {
  if (!entry) return;
  const expired = entry.expiresAt && new Date(entry.expiresAt) <= new Date();
  openModal(`
    <h3>Strike abhaken</h3>
    <p class="muted">${escapeHtml(entry.title || "Strike")}${entry.expiresAt ?` · Ablauf ${formatDate(entry.expiresAt)}` : ""}</p>
    <label>Grund<textarea id="strikeResolveReason" rows="3" ${expired ?"" : "required"} placeholder="${expired ?"Optional" : "Grund erforderlich, wenn vor Ablauf entfernt"}"></textarea></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="orange-btn" id="confirmStrikeResolved">Strike abhaken</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmStrikeResolved")?.addEventListener("click", async () => {
      const reason = modal.querySelector("#strikeResolveReason")?.value.trim() || "";
      if (!expired && !reason) {
        modal.querySelector("#modalError").textContent = "Bitte einen Grund angeben.";
        return;
      }
      try {
        const data = await api(`/api/users/${user.id}/file/${entry.id}`, { method: "PATCH", body: JSON.stringify({ strikeResolved: true, reason }) });
        updateDisciplinaryEntryState(data.entry);
        refreshFileViews(user.id);
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

function openDeleteFileEntryModal(user, entry) {
  if (!entry) return;
  const archived = Boolean(entry.archivedAt);
  const rejected = sanctionWorkflowStatus(entry) === "rejected";
  openConfirmModal({
    title: rejected ?"Abgelehnte Sanktion löschen" : archived ?"Archiv-Eintrag löschen" : entry.type === "Aktennotiz" ?"Notiz löschen" : "Akteneintrag archivieren",
    text: rejected ?`${entry.title || entry.type} endgültig löschen?` : archived ?`${entry.title || entry.type} endgültig aus dem Archiv löschen?` : `${entry.title || entry.type} entfernen?`,
    confirmText: rejected || archived ?"Endgültig löschen" : "Entfernen",
    onConfirm: async () => {
      await api(`/api/users/${user.id}/file/${entry.id}`, { method: "DELETE" });
      removeDisciplinaryEntryState(entry.id);
      window.setTimeout(() => refreshFileViews(user.id), 0);
    }
  });
}

function openApproveSanctionModal(user, entry) {
  if (!entry) return;
  openConfirmModal({
    title: "Sanktion freigeben",
    text: `${entry.title || entry.sanctionType || "Sanktion"} für ${fullName(user)} freigeben? Danach liegt sie unter Offen und kann verkündet oder bezahlt werden.`,
    confirmText: "Freigeben",
    onConfirm: async () => {
      const data = await api(`/api/users/${user.id}/file/${entry.id}`, { method: "PATCH", body: JSON.stringify({ approved: true }) });
      updateDisciplinaryEntryState(data.entry);
      window.setTimeout(() => refreshFileViews(user.id), 0);
    }
  });
}

function openRejectSanctionModal(user, entry, options = {}) {
  if (!entry) return;
  openModal(`
    <h3>Sanktion ablehnen</h3>
    <p class="muted">${escapeHtml(entry.title || entry.sanctionType || "Sanktion")} für ${escapeHtml(fullName(user))}</p>
    <label>Ablehnungsgrund<textarea id="rejectSanctionReason" rows="4" required placeholder="Warum wird diese Sanktion nicht freigegeben?"></textarea></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="red-btn" id="confirmRejectSanction">Ablehnen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmRejectSanction")?.addEventListener("click", async () => {
      const reason = modal.querySelector("#rejectSanctionReason")?.value.trim() || "";
      if (!reason) {
        modal.querySelector("#modalError").textContent = "Bitte einen Ablehnungsgrund angeben.";
        return;
      }
      try {
        const data = await api(`/api/users/${user.id}/file/${entry.id}`, { method: "PATCH", body: JSON.stringify({ rejected: true, reason }) });
        updateDisciplinaryEntryState(data.entry);
        if (options.returnToDirection) {
          closeModal();
          renderApp();
        } else {
          window.setTimeout(() => refreshFileViews(user.id), 0);
        }
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

function openAnnounceSanctionModal(user, entry) {
  if (!entry) return;
  openConfirmModal({
    title: "Sanktion mitgeteilt",
    text: `${entry.title || entry.sanctionType || "Sanktion"} als mitgeteilt markieren? Danach kann eine Geldstrafe als bezahlt markiert werden.`,
    confirmText: "Mitgeteilt markieren",
    onConfirm: async () => {
      const data = await api(`/api/users/${user.id}/file/${entry.id}`, { method: "PATCH", body: JSON.stringify({ announced: true }) });
      updateDisciplinaryEntryState(data.entry);
      window.setTimeout(() => refreshFileViews(user.id), 0);
    }
  });
}

function renderFileEntry(entry, options = {}) {
  const activeStrike = Boolean(options.activeStrike);
  const expired = Boolean(options.expired);
  const manageable = Boolean(options.manageable);
  const archive = Boolean(options.archive);
  const workflow = sanctionWorkflowStatus(entry);
  const sanctionType = entry.sanctionType || (entry.type === "Strike" ?"Strike" : "");
  const className = entry.type === "Aktennotiz" ?"note" : sanctionType === "Geldstrafe" ?"fine" : sanctionType === "Strike" ?"strike" : ["Entlassen", "Sperre", "Suspendierung"].includes(entry.type) ?"danger" : "history";
  const archived = (entry.type === "Sanktion" || entry.type === "Strike") && (entry.archivedAt || expired);
  const title = entry.type === "Sanktion" || entry.type === "Strike" ?`${sanctionType}${entry.title && entry.title !== sanctionType ?` - ${entry.title}` : ""}` : entry.type;
  const reasonText = entry.internal && !canSeeInternalFileReasons() ?"Direktionsinterner Grund" : entry.reason || "-";
  const canDeleteArchived = archive && entry.archivedAt && hasRole("Direktion");
  const canDeleteRejected = manageable && workflow === "rejected" && canManagePersonnelFiles();
  const canResolve = manageable && workflow !== "rejected" && (entry.type === "Sanktion" || entry.type === "Strike") && !entry.archivedAt && !expired && isFileEntryResolvable(entry);
  const pendingResolve = manageable && workflow !== "rejected" && (entry.type === "Sanktion" || entry.type === "Strike") && !entry.archivedAt && !expired && !isFileEntryResolvable(entry);
  const canApprove = manageable && workflow === "pending_approval" && canApprovePersonnelSanctions();
  const canReject = manageable && workflow === "pending_approval" && canApprovePersonnelSanctions();
  const canAnnounce = manageable && workflow === "open" && !entry.announcedAt;
  const canMarkFinePaid = manageable && workflow === "open" && isDisciplinaryFine(entry) && entry.announcedAt && !entry.paidAt;
  const canResolveStrike = manageable && workflow === "active" && isDisciplinaryStrike(entry) && !entry.strikeResolvedAt && !expired;
  const workflowPill = workflow === "pending_approval"
    ?`<span class="file-pill pending">Warten auf Freigabe</span>`
    : workflow === "open"
      ?`<span class="file-pill open">Offen</span>`
      : workflow === "rejected"
        ?`<span class="file-pill rejected">Abgelehnt</span>`
      : workflow === "active" && !activeStrike
        ?`<span class="file-pill active">Aktiv</span>`
        : "";
  return `
    <article class="file-entry ${className} ${archived ?"archived" : ""}">
      <div>
        <div class="file-entry-head">
          <strong>${escapeHtml(title)}</strong>
          ${workflowPill}
          ${activeStrike ?`<span class="file-pill active">Aktiv${Number(entry.strikeCount || 1) > 1 ?` (${Number(entry.strikeCount)})` : ""}</span>` : ""}
          ${archived ?`<span class="file-pill archived">${entry.archivedAt ?"Erledigt" : "Abgelaufen"}</span>` : ""}
          ${entry.amount ?`<span class="file-pill fine">${Number(entry.amount).toLocaleString("de-DE")} $</span>` : ""}
          ${entry.paidAt ?`<span class="file-pill paid">Bezahlt</span>` : ""}
          ${entry.strikeResolvedAt ?`<span class="file-pill paid">Strike entfernt</span>` : ""}
          ${entry.internal ?`<span class="file-pill internal">Direktionsintern</span>` : ""}
          ${entry.uprankBlockedUntil ?`<span class="file-pill open">Uprank-Sperre bis ${formatDate(entry.uprankBlockedUntil)}</span>` : ""}
        </div>
        <p>${escapeHtml(reasonText)}</p>
        <div class="file-entry-meta">
          <span>Erstellt: ${formatDateTime(entry.createdAt)}</span>
          <span>Vergeben durch: ${escapeHtml(entry.submittedBy || entry.actorName || "-")}</span>
          ${entry.approvedAt ?`<span>Freigegeben: ${escapeHtml(entry.approvedBy || "-")} · ${formatDateTime(entry.approvedAt)}</span>` : ""}
          ${entry.rejectedAt ?`<span>Abgelehnt: ${escapeHtml(entry.rejectedBy || "-")} · ${formatDateTime(entry.rejectedAt)}</span><span>Ablehnungsgrund: ${escapeHtml(entry.rejectedReason || "-")}</span>` : ""}
          ${entry.announcedAt ?`<span>Mitgeteilt: ${escapeHtml(entry.announcedBy || "-")} · ${formatDateTime(entry.announcedAt)}</span>` : ""}
          ${entry.expiresAt ?`<span>Ablauf: ${formatDate(entry.expiresAt)}</span>` : ""}
          ${entry.paidAt ?`<span>Bezahlt: ${escapeHtml(entry.paidTo || "-")} · ${formatDateTime(entry.paidAt)} von ${escapeHtml(entry.paidBy || "-")}</span>` : ""}
          ${entry.strikeResolvedAt ?`<span>Strike entfernt: ${escapeHtml(entry.strikeResolvedReason || "-")} · ${formatDateTime(entry.strikeResolvedAt)} von ${escapeHtml(entry.strikeResolvedBy || "-")}</span>` : ""}
          ${entry.archivedBy ?`<span>Archiviert von: ${escapeHtml(entry.archivedBy)}</span>` : ""}
        </div>
      </div>
      <span class="file-entry-actions ${pendingResolve ?"has-hint" : ""}">
        ${manageable && entry.type === "Aktennotiz" ?`<button class="ghost-btn compact-action file-note-edit" data-id="${escapeHtml(entry.id)}">${actionIcon("edit")} Bearbeiten</button><button class="mini-icon danger file-entry-delete" data-id="${escapeHtml(entry.id)}" title="Notiz löschen">${actionIcon("delete")}</button>` : ""}
        ${canApprove ?`<button class="blue-btn approve-file-entry" data-id="${escapeHtml(entry.id)}">Freigeben</button>` : ""}
        ${canReject ?`<button class="red-btn reject-file-entry" data-id="${escapeHtml(entry.id)}">Ablehnen</button>` : ""}
        ${canAnnounce ?`<button class="blue-btn announce-file-entry" data-id="${escapeHtml(entry.id)}">Mitgeteilt</button>` : ""}
        ${canMarkFinePaid ?`<button class="blue-btn mark-fine-paid" data-id="${escapeHtml(entry.id)}">Geldstrafe bezahlt</button>` : ""}
        ${canResolveStrike ?`<button class="orange-btn resolve-strike-entry" data-id="${escapeHtml(entry.id)}">Strike abhaken</button>` : ""}
        ${canResolve ?`<button class="ghost-btn resolve-file-entry" data-id="${escapeHtml(entry.id)}">Eintrag erledigen</button>` : ""}
        ${pendingResolve ?`<small>${workflow === "pending_approval" ?"Wartet auf Freigabe." : workflow === "open" ?(!entry.announcedAt ?"Erst als mitgeteilt markieren." : "Erst Zahlung markieren.") : "Erst Strike/Geldstrafe separat abhaken."}</small>` : ""}
        ${canDeleteRejected ?`<button class="mini-icon danger file-entry-delete" data-id="${escapeHtml(entry.id)}" title="Abgelehnte Sanktion löschen">${actionIcon("delete")}</button>` : ""}
        ${canDeleteArchived ?`<button class="mini-icon danger file-entry-delete" data-id="${escapeHtml(entry.id)}" title="Archiv-Eintrag löschen">${actionIcon("delete")}</button>` : ""}
      </span>
    </article>
  `;
}

function renderFineEntry(entry) {
  return `
    <article class="file-entry fine ${entry.paidAt ?"paid-entry" : ""}">
      <div>
        <div class="file-entry-head">
          <strong>${escapeHtml(entry.title || "Geldstrafe")}</strong>
          <span class="file-pill fine">${Number(entry.amount || 0).toLocaleString("de-DE")} $</span>
          <span class="file-pill ${entry.paidAt ?"paid" : "open"}">${entry.paidAt ?"Bezahlt" : "Offen"}</span>
        </div>
        <p>${escapeHtml(entry.internal && !canSeeInternalFileReasons() ?"Direktionsinterner Grund" : entry.reason || "-")}</p>
        <small>${formatDateTime(entry.createdAt)} - ${escapeHtml(entry.actorName || "-")}${entry.paidAt ?` - Bezahlt: ${formatDateTime(entry.paidAt)} von ${escapeHtml(entry.paidBy || "-")}` : ""}</small>
      </div>
      ${entry.paidAt ?"" : `<button class="blue-btn mark-fine-paid" data-id="${escapeHtml(entry.id)}">Bezahlt</button>`}
    </article>
  `;
}

function openNoteActionModal(user, entry) {
  if (!entry) return;
  openModal(`
    <h3>Notiz verwalten</h3>
    <p class="muted">${escapeHtml(fullName(user))}</p>
    <div class="action-menu-list">
      <button class="ghost-btn action-menu-btn" id="editFileNote">${actionIcon("edit")} Bearbeiten</button>
      <button class="red-btn action-menu-btn" id="deleteFileNote">${actionIcon("delete")} Löschen</button>
    </div>
    <div class="modal-actions"><button class="ghost-btn" data-close>Schließen</button></div>
  `, (modal) => {
    modal.querySelector("#editFileNote").addEventListener("click", () => openEditFileNoteModal(user, entry));
    modal.querySelector("#deleteFileNote").addEventListener("click", async () => {
      try {
        await api(`/api/users/${user.id}/file/${entry.id}`, { method: "DELETE" });
        removeDisciplinaryEntryState(entry.id);
        openPersonnelFileModal(findAnyUser(user.id));
      } catch (error) {
        openModal(`<h3>Notiz konnte nicht gelöscht werden</h3><p class="form-error">${escapeHtml(error.message)}</p><div class="modal-actions"><button class="ghost-btn" data-close>Schließen</button></div>`);
      }
    });
  });
}

function openEditFileNoteModal(user, entry) {
  openModal(`
    <h3>Notiz bearbeiten</h3>
    <label>Notiz<textarea id="editFileNoteText" required>${escapeHtml(entry.reason || "")}</textarea></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions"><button class="ghost-btn" data-close>Abbrechen</button><button class="blue-btn" id="saveFileNoteEdit">Speichern</button></div>
  `, (modal) => {
    modal.querySelector("#saveFileNoteEdit").addEventListener("click", async () => {
      try {
        const data = await api(`/api/users/${user.id}/file/${entry.id}`, { method: "PATCH", body: JSON.stringify({ reason: $("#editFileNoteText").value }) });
        updateDisciplinaryEntryState(data.entry);
        openPersonnelFileModal(findAnyUser(user.id));
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openPersonnelFileEntryModal(user, type, activeStrikes = 0) {
  const catalog = sanctionCatalog();
  const allowCustomSanction = canCreateCustomSanctions();
  const allowFineOverride = canOverrideSanctionFineRange();
  openModal(`
    <div class="sanction-entry-hero">
      <div>
        <span class="eyebrow">${type === "Sanktion" ?"Personalakte" : "Aktennotiz"}</span>
        <h3>${type === "Sanktion" ?"Sanktion vergeben" : "Notiz hinzufügen"}</h3>
        <p>${escapeHtml(fullName(user))} · ${escapeHtml(rankLabel(user.rank))} · DN ${escapeHtml(user.dn || "-")}</p>
      </div>
      ${type === "Sanktion" ?`<span class="sanction-strike-state">Aktive Strikes ${activeStrikes}/3</span>` : ""}
    </div>
    ${type === "Sanktion" ?`
      <div class="sanction-entry-grid">
        <label class="full sanction-catalog-picker">Sanktionskatalog
          <div class="sanction-combobox">
            <input id="sanctionCatalogSearch" autocomplete="off" placeholder="Sanktion suchen und auswählen, z. B. Funk, §1 Abs. 8 oder Verwarnung">
            <input id="sanctionCatalogValue" type="hidden" value="">
            <div id="sanctionCatalogOptions" class="sanction-combobox-list" role="listbox"></div>
          </div>
        </label>
        <label>Sanktionsart
          <select id="sanctionType">
            <option value="">Auswählen</option>
            <option>Geldstrafe</option>
            <option ${activeStrikes >= 3 ?"disabled" : ""}>Strike</option>
            <option>Custom</option>
          </select>
        </label>
        <label>Titel<input id="fileEntryTitle" placeholder="z.B. Dienstpflicht verletzt"></label>
        <label class="sanction-fine-field">Geldstrafe<input id="sanctionAmount" type="number" min="0" step="100" placeholder="Betrag"><small id="sanctionFineRangeHint" class="field-hint"></small></label>
        <label>Uprank-Sperre Tage<input id="sanctionUprankBlockDays" type="number" min="0" placeholder="0"></label>
        <div id="sanctionFineRangeCard" class="sanction-fine-range-card full hidden"></div>
        <div class="sanction-strike-fields full">
          <div><strong>Strike Einstellungen</strong><small>Nur ausfüllen, wenn die Sanktionsart Strike ist.</small></div>
          <label>Strikes
            <select id="sanctionStrikeCount">
              <option value="">Auswählen</option>
              ${[1, 2, 3].map((count) => `<option value="${count}" ${activeStrikes + count > 3 ?"disabled" : ""}>${count} Strike${count > 1 ?"s" : ""}</option>`).join("")}
            </select>
          </label>
          <label>Ablaufdatum<input id="sanctionExpiresAt" type="date"></label>
          <label class="sanction-no-expiry-toggle"><span>Kein Ablaufdatum</span><input id="sanctionNoExpiry" type="checkbox"></label>
        </div>
        ${canSeeInternalFileReasons() ?`<label class="sanction-internal-toggle full"><span><strong>Direktionsinterner Grund verwenden</strong><small>Grund ist nur für Direktion sichtbar.</small></span><input id="sanctionInternal" type="checkbox"><i></i></label>` : ""}
      </div>
    ` : ""}
    <label class="sanction-reason-field">${type === "Sanktion" ?"Grund / Beschreibung" : "Notiz"}<textarea id="fileEntryReason" required></textarea></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="${type === "Sanktion" ?"orange-btn" : "blue-btn"}" id="saveFileEntry">Speichern</button>
    </div>
  `, (modal) => {
    modal.classList.add(type === "Sanktion" ?"sanction-entry-modal" : "file-note-entry-modal");
    const catalogSearch = modal.querySelector("#sanctionCatalogSearch");
    const catalogValue = modal.querySelector("#sanctionCatalogValue");
    const catalogOptions = modal.querySelector("#sanctionCatalogOptions");
    let selectedCatalogItem = null;
    const updateFineRangeHint = () => {
      const hint = modal.querySelector("#sanctionFineRangeHint");
      const card = modal.querySelector("#sanctionFineRangeCard");
      const amountInput = modal.querySelector("#sanctionAmount");
      if (!hint) return;
      const sanctionType = modal.querySelector("#sanctionType")?.value || "";
      const range = sanctionFineRangeFromText(selectedCatalogItem?.fineText);
      const amountValue = Number(amountInput?.value || 0);
      const showRange = Boolean(range && (sanctionType === "Geldstrafe" || amountValue > 0));
      hint.textContent = showRange ?`Sanktionsrahmen: ${range.text}` : "";
      card?.classList.toggle("hidden", !showRange);
      if (card && showRange) {
        card.innerHTML = `
          <strong>Geldstrafe laut Sanktionskatalog</strong>
          <span>${escapeHtml(range.text)} · ${formatFineAmount(range.min)} bis ${formatFineAmount(range.max)}</span>
          <small>${allowFineOverride ?"Du darfst den Betrag bei Bedarf außerhalb dieses Rahmens anpassen." : "Der Betrag muss innerhalb dieses Rahmens liegen."}</small>
        `;
      } else if (card) {
        card.innerHTML = "";
      }
      if (amountInput) {
        if (showRange && !allowFineOverride) {
          amountInput.min = String(range.min);
          amountInput.max = String(range.max);
        } else {
          amountInput.min = "0";
          amountInput.removeAttribute("max");
        }
      }
    };
    const applySanctionFieldState = () => {
      const sanctionType = modal.querySelector("#sanctionType")?.value || "";
      const isStrike = sanctionType === "Strike";
      const strikeBox = modal.querySelector(".sanction-strike-fields");
      strikeBox?.classList.toggle("active", isStrike);
      modal.querySelector("#sanctionStrikeCount")?.toggleAttribute("disabled", !isStrike);
      modal.querySelector("#sanctionExpiresAt")?.toggleAttribute("disabled", !isStrike || Boolean(modal.querySelector("#sanctionNoExpiry")?.checked));
      modal.querySelector("#sanctionNoExpiry")?.toggleAttribute("disabled", !isStrike);
      updateFineRangeHint();
    };
    const pickSanctionCatalogValue = (value) => {
      if (!catalogValue || !catalogSearch) return;
      catalogValue.value = value;
      catalogOptions?.classList.add("hidden");
      if (value === "custom") {
        selectedCatalogItem = null;
        if (!allowCustomSanction) {
          catalogValue.value = "";
          $("#modalError").textContent = "Eigene Sanktionen dürfen nur Perso-Leitung, Direktion oder IT vergeben.";
          return;
        }
        catalogSearch.value = "Eigene Sanktion";
        modal.querySelector("#fileEntryTitle").value = "";
        modal.querySelector("#sanctionType").value = "";
        modal.querySelector("#sanctionAmount").value = "";
        modal.querySelector("#sanctionStrikeCount").value = "";
        modal.querySelector("#sanctionUprankBlockDays").value = "";
        modal.querySelector("#sanctionExpiresAt").value = "";
        modal.querySelector("#sanctionNoExpiry").checked = false;
        applySanctionFieldState();
        return;
      }
      const item = catalog[Number(value)];
      if (!item) return;
      selectedCatalogItem = item;
      catalogSearch.value = sanctionCatalogLabel(item);
      modal.querySelector("#fileEntryTitle").value = [item.code, item.title].filter(Boolean).join(" - ");
      modal.querySelector("#sanctionType").value = item.sanctionType;
      modal.querySelector("#sanctionAmount").value = Number(item.amount || 0);
      modal.querySelector("#sanctionStrikeCount").value = item.sanctionType === "Strike" ?String(Math.max(1, Number(item.strikeCount || 1))) : "";
      modal.querySelector("#sanctionUprankBlockDays").value = Number(item.uprankBlockDays || 0) || "";
      modal.querySelector("#sanctionExpiresAt").value = "";
      modal.querySelector("#sanctionNoExpiry").checked = false;
      applySanctionFieldState();
    };
    const renderSanctionCatalogOptions = (query = "", forceOpen = false) => {
      if (!catalogOptions) return;
      const needle = query.trim().toLowerCase();
      const options = [
        ...catalog.map((item, index) => ({ item, index }))
          .filter(({ item }) => !needle || sanctionCatalogLabel(item).toLowerCase().includes(needle) || sanctionCatalogDetails(item).toLowerCase().includes(needle))
          .map(({ item, index }) => `<button type="button" data-value="${index}"><strong>${escapeHtml([item.code, item.title].filter(Boolean).join(" - "))}</strong><small>${escapeHtml([item.category, item.fineText, item.action].filter(Boolean).join(" · "))}</small></button>`),
        allowCustomSanction ?`<button type="button" data-value="custom" class="custom-sanction-option"><strong>Eigene Sanktion</strong><small>Freier Eintrag ohne Katalogvorlage</small></button>` : ""
      ].filter(Boolean);
      catalogOptions.innerHTML = options.join("") || `<span class="muted">Keine Sanktion gefunden.</span>`;
      catalogOptions.classList.toggle("hidden", !forceOpen && !needle);
    };
    renderSanctionCatalogOptions("", false);
    applySanctionFieldState();
    catalogSearch?.addEventListener("focus", () => renderSanctionCatalogOptions(catalogSearch.value, true));
    catalogSearch?.addEventListener("input", () => {
      if (catalogValue) catalogValue.value = "";
      renderSanctionCatalogOptions(catalogSearch.value, true);
    });
    catalogOptions?.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-value]");
      if (button) pickSanctionCatalogValue(button.dataset.value);
    });
    modal.addEventListener("click", (event) => {
      if (!event.target.closest(".sanction-combobox")) catalogOptions?.classList.add("hidden");
    });
    modal.querySelector("#sanctionType")?.addEventListener("change", applySanctionFieldState);
    modal.querySelector("#sanctionAmount")?.addEventListener("input", updateFineRangeHint);
    modal.querySelector("#sanctionNoExpiry")?.addEventListener("change", applySanctionFieldState);
    modal.querySelector("#saveFileEntry").addEventListener("click", async () => {
      try {
        const selectedCatalogValue = $("#sanctionCatalogValue")?.value || "";
        const sanctionType = $("#sanctionType")?.value || "";
        const sanctionAmount = Math.max(0, Number($("#sanctionAmount")?.value || 0));
        const selectedFineRange = sanctionFineRangeFromText(selectedCatalogItem?.fineText);
        const strikeCount = Number($("#sanctionStrikeCount")?.value || 0);
        const isStrike = type === "Sanktion" && sanctionType === "Strike";
        if (type === "Sanktion" && !selectedCatalogValue) throw new Error("Bitte eine Sanktion aus dem Katalog auswählen.");
        if (type === "Sanktion" && selectedCatalogValue === "custom" && !allowCustomSanction) throw new Error("Eigene Sanktionen dürfen nur Perso-Leitung, Direktion oder IT vergeben.");
        if (type === "Sanktion" && !sanctionType) throw new Error("Bitte eine Sanktionsart auswählen.");
        const requiresCatalogFineRange = selectedFineRange && (sanctionType === "Geldstrafe" || Number(selectedCatalogItem?.amount || 0) > 0 || sanctionAmount > 0);
        if (type === "Sanktion" && selectedCatalogValue !== "custom" && requiresCatalogFineRange && !allowFineOverride && (sanctionAmount < selectedFineRange.min || sanctionAmount > selectedFineRange.max)) {
          throw new Error(`Geldstrafe muss im Sanktionsrahmen ${selectedFineRange.text} liegen.`);
        }
        if (isStrike && !strikeCount) throw new Error("Bitte die Anzahl der Strikes auswählen.");
        if (isStrike && !$("#sanctionExpiresAt")?.value && !$("#sanctionNoExpiry")?.checked) throw new Error("Bitte ein Ablaufdatum angeben oder Kein Ablaufdatum auswählen.");
        if (!$("#fileEntryReason").value.trim()) throw new Error("Bitte einen Grund angeben.");
        const data = await api(`/api/users/${user.id}/file`, {
          method: "POST",
          body: JSON.stringify({
            type,
            reason: $("#fileEntryReason").value,
            title: $("#fileEntryTitle")?.value || "",
            sanctionType,
            amount: sanctionAmount,
            strikeCount: strikeCount || 0,
            uprankBlockDays: $("#sanctionUprankBlockDays")?.value || 0,
            internal: Boolean($("#sanctionInternal")?.checked),
            expiresAt: $("#sanctionExpiresAt")?.value || "",
            noExpiry: Boolean($("#sanctionNoExpiry")?.checked),
            customSanction: selectedCatalogValue === "custom",
            catalogId: selectedCatalogValue && selectedCatalogValue !== "custom" ?catalog[Number(selectedCatalogValue)]?.id || "" : ""
          })
        });
        if (Array.isArray(data.disciplinary)) state.disciplinary = data.disciplinary;
        openPersonnelFileModal(findAnyUser(user.id));
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openReasonUserModal(user, title, path, method, extra = {}) {
  openModal(`
    <h3>${escapeHtml(title)}</h3>
    <p class="muted">${escapeHtml(fullName(user))}</p>
    <label>Grund<textarea id="actionReason" required></textarea></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="${title === "Entlassen" ?"red-btn" : "orange-btn"}" id="confirmReasonAction">${escapeHtml(title)}</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmReasonAction").addEventListener("click", async () => {
      try {
        await api(path, { method, body: JSON.stringify({ ...extra, reason: $("#actionReason").value }) });
        closeModal();
        await bootstrap();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openManualDutyModal() {
  openModal(`
    <h3>Dienstzeit hinzufügen</h3>
    <label>Mitglied<select id="manualDutyUser">${state.users.map((user) => `<option value="${user.id}">${escapeHtml(fullName(user))}</option>`).join("")}</select></label>
    <label>Diensttyp<input id="manualDutyStatus" value="Manuelle Korrektur"></label>
    <label>Beginn<input id="manualDutyStart" type="datetime-local"></label>
    <label>Ende<input id="manualDutyEnd" type="datetime-local"></label>
    <label>Grund<textarea id="manualDutyReason"></textarea></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="blue-btn" id="saveManualDuty">Speichern</button>
    </div>
  `, (modal) => {
    modal.querySelector("#saveManualDuty").addEventListener("click", async () => {
      try {
        await api("/api/duty/manual", {
          method: "POST",
          body: JSON.stringify({
            userId: $("#manualDutyUser").value,
            status: $("#manualDutyStatus").value,
            startedAt: $("#manualDutyStart").value,
            endedAt: $("#manualDutyEnd").value,
            reason: $("#manualDutyReason").value
          })
        });
        closeModal();
        await bootstrap();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openDeleteNoteModal(noteId) {
  const note = state.notes.find((item) => item.id === noteId);
  openModal(`
    <h3>Notiz löschen</h3>
    <p class="muted">${escapeHtml(note?.title || "Diese Notiz")} wirklich löschen?</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="red-btn" id="confirmDeleteNote">Notiz löschen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmDeleteNote").addEventListener("click", async () => {
      try {
        await api(`/api/notes/${noteId}`, { method: "DELETE" });
        closeModal();
        await bootstrap();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function formatDepartmentText(text = "") {
  const escaped = escapeHtml(text || "Noch keine Rechte definiert.");
  return escaped
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/^### (.*)$/gm, "<h4>$1</h4>")
    .replace(/^## (.*)$/gm, "<h3>$1</h3>")
    .replace(/\n/g, "<br>");
}

function renderStatusDot(status) {
  const className = status === "Hoch" ?"high" : status === "Mittel" ?"medium" : "normal";
  return `<span class="status-dot ${className}"></span>${escapeHtml(status)}`;
}

function openDepartmentInfoModal(department) {
  const formattedDescription = formatDepartmentInfoText(department.description || "Keine Beschreibung hinterlegt.");
  const formattedRequirements = formatDepartmentInfoText(department.requirements || "Keine Voraussetzungen hinterlegt.", { listDefault: true });
  openModal(`
    <div class="department-info-hero">
      <div class="department-modal-icon">${iconSvg("Einsatzzentrale")}</div>
      <div>
        <span class="eyebrow">Abteilungsinformationen</span>
        <h3>${escapeHtml(department.name)}</h3>
        <p>Beschreibung, Bewerbungsstatus und Voraussetzungen auf einen Blick.</p>
      </div>
      <span class="application-pill ${department.applicationStatus === "Offen" ?"open" : "closed"}">${escapeHtml(department.applicationStatus)}</span>
    </div>
    <div class="department-modal-heading">
      <h4>Informationen</h4>
      ${departmentActionAllowed(department, "departmentInfo") ?`<button class="blue-btn" id="editDepartmentInfo" type="button">${actionIcon("edit")} Bearbeiten</button>` : ""}
    </div>
    <div class="department-info-view">
      <div class="info-box department-description-box">
        <strong>${iconSvg("Informationen")} Beschreibung</strong>
        <div class="department-info-text">${formattedDescription}</div>
      </div>
      <div class="info-box department-requirements-box">
        <strong>${iconSvg("CheckCircle")} Voraussetzungen</strong>
        <div class="department-info-text requirements">${formattedRequirements}</div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Schließen</button>
    </div>
  `, (modal) => {
    modal.classList.add("department-info-modal");
    modal.querySelector("#editDepartmentInfo")?.addEventListener("click", () => openDepartmentInfoEditModal(department));
  });
}

function formatDepartmentInfoText(value, options = {}) {
  const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let list = [];
  const flushList = () => {
    if (!list.length) return;
    blocks.push(`<ul>${list.map((line) => `<li>${formatDepartmentInlineText(line)}</li>`).join("")}</ul>`);
    list = [];
  };
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      return;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet || options.listDefault) {
      list.push(bullet ?bullet[1] : line);
      return;
    }
    flushList();
    blocks.push(`<p>${formatDepartmentInlineText(line)}</p>`);
  });
  flushList();
  return blocks.join("") || `<p class="muted">Keine Angaben hinterlegt.</p>`;
}

function formatDepartmentInlineText(value) {
  return linkifyText(value).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function openDepartmentInfoEditModal(department) {
  openModal(`
    <h3>Abteilungsinformationen bearbeiten</h3>
    <p class="muted">${escapeHtml(department.name)}</p>
    <label>Beschreibung<textarea id="deptDescription" rows="6" placeholder="Kurze Beschreibung der Abteilung">${escapeHtml(department.description)}</textarea></label>
    <label>Bewerbungsstatus
      <select id="deptApplicationStatus">
        <option ${department.applicationStatus === "Offen" ?"selected" : ""}>Offen</option>
        <option ${department.applicationStatus === "Geschlossen" ?"selected" : ""}>Geschlossen</option>
      </select>
    </label>
    <label>Voraussetzungen<textarea id="deptRequirements" rows="9" placeholder="Jede Voraussetzung in eine eigene Zeile schreiben">${escapeHtml(department.requirements)}</textarea><small class="field-hint">Jede Zeile wird später ordentlich untereinander angezeigt.</small></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="blue-btn" id="saveDepartmentInfo">Speichern</button>
    </div>
  `, (modal) => {
    modal.querySelector("#saveDepartmentInfo").addEventListener("click", async () => {
      try {
        await api(`/api/departments/${department.id}/info`, {
          method: "PATCH",
          body: JSON.stringify({ description: $("#deptDescription").value, applicationStatus: $("#deptApplicationStatus").value, requirements: $("#deptRequirements").value })
        });
        closeModal();
        await bootstrap();
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

async function saveDepartmentInfo(department, patch) {
  await api(`/api/departments/${department.id}/info`, {
    method: "PATCH",
    body: JSON.stringify({
      description: department.description,
      applicationStatus: department.applicationStatus,
      requirements: department.requirements,
      rightsText: department.rightsText || "",
      trainingDocsUrl: department.trainingDocsUrl || "",
      links: department.links || [],
      permits: department.permits || [],
      factions: department.factions || [],
      docs: department.docs || [],
      ...patch
    })
  });
  closeModal();
  await bootstrap();
}

function openDepartmentRightsModal(department) {
  openModal(`
    <h3>Rechte Definition bearbeiten</h3>
    <p class="muted">${escapeHtml(department.name)}</p>
    <label>Text<textarea id="rightsText" rows="12">${escapeHtml(department.rightsText || "")}</textarea></label>
    <p class="muted">Überschriften mit ##, dicke Schrift mit **Text**.</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions"><button class="ghost-btn" data-close>Abbrechen</button><button class="blue-btn" id="saveRightsText">Speichern</button></div>
  `, (modal) => {
    modal.querySelector("#saveRightsText").addEventListener("click", async () => {
      try {
        await saveDepartmentInfo(department, { rightsText: $("#rightsText").value });
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function upsertById(items, item) {
  const list = [...(items || [])];
  const nextItem = { ...item, id: item.id || `item_${Date.now()}_${Math.random().toString(16).slice(2)}` };
  const index = list.findIndex((entry) => entry.id === nextItem.id);
  if (index >= 0) list[index] = nextItem;
  else list.push(nextItem);
  return list;
}

function openDepartmentLinkModal(department, link = null) {
  openModal(`
    <h3>${link ?"Weiterleitung bearbeiten" : "Weiterleitung hinzufügen"}</h3>
    <label>Titel<input id="linkTitle" value="${escapeHtml(link?.title || "")}"></label>
    <label>Link<input id="linkUrl" value="${escapeHtml(link?.url || "")}" placeholder="https://..."></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions"><button class="ghost-btn" data-close>Abbrechen</button><button class="blue-btn" id="saveDepartmentLink">Speichern</button></div>
  `, (modal) => {
    modal.querySelector("#saveDepartmentLink").addEventListener("click", async () => {
      try {
        const title = $("#linkTitle").value.trim();
        const url = $("#linkUrl").value.trim();
        if (!title || !url) throw new Error("Titel und Link sind erforderlich.");
        await saveDepartmentInfo(department, { links: upsertById(department.links, { id: link?.id, title, url }) });
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openDepartmentPermitModal(department, permit = null) {
  openModal(`
    <h3>${permit ?"Sondergenehmigung bearbeiten" : "Sondergenehmigung hinzufügen"}</h3>
    <label>Vor- und Nachname<input id="permitName" value="${escapeHtml(permit?.name || "")}"></label>
    <label>Beschreibung<textarea id="permitDescription">${escapeHtml(permit?.description || "")}</textarea></label>
    <label>Gültig Bis<input id="permitValidUntil" type="date" value="${escapeHtml(permit?.validUntil || "")}"></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions"><button class="ghost-btn" data-close>Abbrechen</button><button class="blue-btn" id="saveDepartmentPermit">Speichern</button></div>
  `, (modal) => {
    modal.querySelector("#saveDepartmentPermit").addEventListener("click", async () => {
      try {
        const name = $("#permitName").value.trim();
        const description = $("#permitDescription").value.trim();
        const validUntil = $("#permitValidUntil").value;
        if (!name || !description || !validUntil) throw new Error("Alle Felder sind erforderlich.");
        await saveDepartmentInfo(department, { permits: upsertById(department.permits, { id: permit?.id, name, description, validUntil }) });
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openDepartmentFactionModal(department, faction = null) {
  openModal(`
    <h3>${faction ?"Fraktion bearbeiten" : "Fraktion hinzufügen"}</h3>
    <label>Organisation<input id="factionOrganization" value="${escapeHtml(faction?.organization || "")}"></label>
    <label>Status
      <select id="factionStatus">
        ${["Normal", "Mittel", "Hoch"].map((status) => `<option ${faction?.status === status ?"selected" : ""}>${status}</option>`).join("")}
      </select>
    </label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions"><button class="ghost-btn" data-close>Abbrechen</button><button class="blue-btn" id="saveDepartmentFaction">Speichern</button></div>
  `, (modal) => {
    modal.querySelector("#saveDepartmentFaction").addEventListener("click", async () => {
      try {
        const organization = $("#factionOrganization").value.trim();
        const status = $("#factionStatus").value;
        if (!organization) throw new Error("Organisation ist erforderlich.");
        await saveDepartmentInfo(department, { factions: upsertById(department.factions, { id: faction?.id, organization, status }) });
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

async function deleteDepartmentInfoItem(department, key, id) {
  try {
    await saveDepartmentInfo(department, { [key]: (department[key] || []).filter((item) => item.id !== id) });
  } catch (error) {
    showNotify(error.message, "error");
  }
}

function openDepartmentMemberModal(department, member = null, options = {}) {
  const availableUsers = state.users.filter((user) => member || !department.members.some((item) => item.userId === user.id));
  const myDepartmentPosition = department.members.find((item) => item.userId === state.currentUser.id)?.position;
  const swatTeamManager = isSwatDepartment(department) && isSwatTeamLeaderMember(mySwatMembership(department)) && !hasRole("Direktion") && !hasRole("IT");
  const allowedPositions = (isSwatDepartment(department) && swatTeamManager ?["Mitglied"] : departmentPositionsFor(department)).filter((position) => {
    if (position === "Direktion") return state.currentUser?.role === "Direktion" || state.currentUser?.role === "IT-Leitung";
    if (hasRole("Direktion")) return true;
    return positionPowerFor(department, position) < positionPowerFor(department, myDepartmentPosition);
  });
  const showSwatLeaderCheckbox = isSwatDepartment(department) && !swatTeamManager && member?.swatTeamLeader && member?.position !== "Abteilungsleiter";
  const userOptionLabel = (user) => `${fullName(user)} - DN ${user.dn || "-"} - ${rankLabel(user.rank)}`;
  openModal(`
    <h3>${member ?"Position bearbeiten" : "Person hinzufügen"}</h3>
    <p class="muted">Wählen Sie eine Person aus, die zu ${escapeHtml(department.name)} hinzugefügt werden soll.</p>
    ${member ?`<p><strong>${escapeHtml(fullName(member.user))}</strong></p>` : `<label>Person auswählen
      <input id="departmentUserSearch" list="departmentUserOptions" autocomplete="off" placeholder="Name oder DN eingeben">
      <datalist id="departmentUserOptions">
        ${availableUsers.map((user) => `<option value="${escapeHtml(userOptionLabel(user))}"></option>`).join("")}
      </datalist>
    </label>`}
    <label>Position auswählen
      <select id="departmentPositionSelect">
        <option value="" selected disabled>Position auswählen</option>
        ${(allowedPositions.length ?allowedPositions : ["Mitglied"]).map((position) => `<option value="${escapeHtml(position)}">${escapeHtml(position)}</option>`).join("")}
      </select>
    </label>
    ${isSwatDepartment(department) ?`
      <label>SWAT Team
        <select id="departmentSwatTeamSelect" ${swatTeamManager ?"disabled" : ""}>
          <option value="">Kein Team</option>
          ${SWAT_TEAMS.map((team) => `<option value="${team}" ${normalizeSwatTeam(member?.swatTeam || options.swatTeam || (swatTeamManager ?mySwatMembership(department)?.swatTeam : "")) === team ?"selected" : ""}>Team ${team}</option>`).join("")}
        </select>
      </label>
      ${showSwatLeaderCheckbox ?`<label class="checkbox-line">Teamleiter dieses Teams<input id="departmentSwatTeamLeader" type="checkbox" checked></label>` : ""}
    ` : ""}
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="blue-btn" id="saveDepartmentMember">${member ?"Speichern" : "Person hinzufügen"}</button>
    </div>
  `, (modal) => {
    if (member) modal.querySelector("#departmentPositionSelect").value = member.position || "";
    modal.querySelector("#saveDepartmentMember").addEventListener("click", async () => {
      try {
        const selectedUserValue = modal.querySelector("#departmentUserSearch")?.value.trim() || "";
        const selectedUser = member || availableUsers.find((user) => userOptionLabel(user) === selectedUserValue);
        const selectedPosition = modal.querySelector("#departmentPositionSelect")?.value.trim() || "";
        if (!selectedUser) throw new Error("Bitte eine Person aus der Vorschlagsliste auswählen.");
        if (!(allowedPositions.length ?allowedPositions : ["Mitglied"]).includes(selectedPosition)) throw new Error("Bitte eine Position aus der Vorschlagsliste auswählen.");
        const data = await api(member ?`/api/departments/${department.id}/members/${member.userId}` : `/api/departments/${department.id}/members`, {
          method: member ?"PATCH" : "POST",
          body: JSON.stringify({
            userId: selectedUser.userId || selectedUser.id,
            position: selectedPosition,
            swatTeam: modal.querySelector("#departmentSwatTeamSelect")?.value || (swatTeamManager ?mySwatMembership(department)?.swatTeam : ""),
            swatTeamLeader: !swatTeamManager && (selectedPosition === "Abteilungsleiter" || Boolean(modal.querySelector("#departmentSwatTeamLeader")?.checked))
          })
        });
        const updatedDepartment = updateDepartmentState(data.department) || department;
        closeModal();
        renderDepartmentPage(updatedDepartment);
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function canTouchDepartmentMemberClient(department, member) {
  if (!member) return false;
  if (state.currentUser?.role === "Direktion" || hasRole("IT")) return true;
  if (isSwatDepartment(department)) {
    const myMembership = mySwatMembership(department);
    return Boolean(isSwatTeamLeaderMember(myMembership) && normalizeSwatTeam(myMembership.swatTeam) === normalizeSwatTeam(member.swatTeam) && !isSwatTeamLeaderMember(member) && member.position === "Mitglied");
  }
  if (member.position === "Direktion") return false;
  const myDepartmentPosition = department.members.find((item) => item.userId === state.currentUser.id)?.position;
  return positionPowerFor(department, myDepartmentPosition) > positionPowerFor(department, member.position);
}

function openDepartmentManageModal(department, options = {}) {
  const swatTeamFilter = isSwatDepartment(department) ?normalizeSwatTeam(options.swatTeam) : "";
  const visibleMembers = swatTeamFilter ?department.members.filter((member) => normalizeSwatTeam(member.swatTeam) === swatTeamFilter) : department.members;
  openModal(`
    <h3>${swatTeamFilter ?`Team ${escapeHtml(swatTeamFilter)} verwalten` : "Personal verwalten"}</h3>
    <p class="muted">${escapeHtml(department.name)}</p>
    <button class="blue-btn department-add full" data-department-id="${escapeHtml(department.id)}">${iconSvg("Mitglieder")} Person hinzufügen</button>
    <div class="manage-member-list">
      ${visibleMembers.length ?visibleMembers.map((member) => `
        <div class="manage-member-row">
          <span><strong>${escapeHtml(fullName(member.user))}</strong><small>${isSwatDepartment(department) ?`${escapeHtml(swatTeamLabel(member.swatTeam))}${member.swatTeamLeader ?" · Teamleiter" : ""} · ` : ""}${escapeHtml(member.position)} · ${escapeHtml(rankLabel(member.user.rank))}</small></span>
          ${canTouchDepartmentMemberClient(department, member) ?`<span class="button-row">
            <button class="mini-icon edit-dept-member" data-department-id="${department.id}" data-user-id="${member.userId}" title="Position bearbeiten">${actionIcon("edit")}</button>
            <button class="mini-icon danger remove-dept-member" data-department-id="${department.id}" data-user-id="${member.userId}" title="Entfernen">${actionIcon("delete")}</button>
          </span>` : `<span class="muted">Geschützt</span>`}
        </div>
      `).join("") : `<p class="muted">Noch keine Mitglieder.</p>`}
    </div>
    <div class="modal-actions"><button class="ghost-btn" data-close>Schließen</button></div>
  `, (modal) => {
    modal.querySelector(".department-add")?.addEventListener("click", () => {
      closeModal();
      openDepartmentMemberModal(department, null, { swatTeam: swatTeamFilter });
    });
  });
}

function openRemoveDepartmentMemberModal(department, member) {
  openModal(`
    <h3>Person entfernen</h3>
    <p class="muted">${escapeHtml(fullName(member.user))} aus ${escapeHtml(department.name)} entfernen?</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="red-btn" id="confirmRemoveDepartmentMember">Entfernen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmRemoveDepartmentMember").addEventListener("click", async () => {
      try {
        const data = await api(`/api/departments/${department.id}/members/${member.userId}`, { method: "DELETE" });
        const updatedDepartment = updateDepartmentState(data.department) || department;
        closeModal();
        renderDepartmentPage(updatedDepartment);
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openDepartmentNoteModal(department, note = null) {
  const isEdit = Boolean(note);
  const align = ["left", "center", "right"].includes(note?.align) ?note.align : "left";
  const textColor = note?.textColor || "";
  const highlightColor = note?.highlightColor || "";
  openModal(`
    <h3>${isEdit ?"Notiz bearbeiten" : "Neue Notiz"}</h3>
    <label>Titel<input id="deptNoteTitle" value="${escapeHtml(note?.title || "")}"></label>
    <label>Priorität<select id="deptNotePriority">${["Leitung", "Info", "Mitglied"].map((priority) => `<option ${note?.priority === priority ?"selected" : ""}>${priority}</option>`).join("")}</select></label>
    ${isSwatDepartment(department) ?`
      <label>SWAT Team
        <select id="deptNoteTeam">
          <option value="all" ${!note?.team || note?.team === "all" ?"selected" : ""}>Alle Teams</option>
          ${SWAT_TEAMS.filter((team) => canViewSwatTeam(team, department)).map((team) => `<option value="${team}" ${note?.team === team ?"selected" : ""}>Team ${team}</option>`).join("")}
        </select>
      </label>
    ` : ""}
    <div class="department-note-editor">
      <div class="department-note-toolbar">
        <button class="ghost-btn compact-action" id="deptNoteBold" type="button">Fett</button>
        <label>Ausrichtung
          <select id="deptNoteAlign">
            <option value="left" ${align === "left" ?"selected" : ""}>Links</option>
            <option value="center" ${align === "center" ?"selected" : ""}>Zentriert</option>
            <option value="right" ${align === "right" ?"selected" : ""}>Rechts</option>
          </select>
        </label>
        <label>Textfarbe
          <select id="deptNoteTextColor">
            <option value="" ${!textColor ?"selected" : ""}>Standard</option>
            <option value="#ffffff" ${textColor === "#ffffff" ?"selected" : ""}>Weiß</option>
            <option value="#bfdbfe" ${textColor === "#bfdbfe" ?"selected" : ""}>Blau</option>
            <option value="#fecaca" ${textColor === "#fecaca" ?"selected" : ""}>Rot</option>
            <option value="#fde68a" ${textColor === "#fde68a" ?"selected" : ""}>Gelb</option>
            <option value="#bbf7d0" ${textColor === "#bbf7d0" ?"selected" : ""}>Grün</option>
          </select>
        </label>
        <label>Hervorhebung
          <select id="deptNoteHighlightColor">
            <option value="" ${!highlightColor ?"selected" : ""}>Keine</option>
            <option value="rgba(37,99,235,.22)" ${highlightColor === "rgba(37,99,235,.22)" ?"selected" : ""}>Blau</option>
            <option value="rgba(239,68,68,.22)" ${highlightColor === "rgba(239,68,68,.22)" ?"selected" : ""}>Rot</option>
            <option value="rgba(245,158,11,.22)" ${highlightColor === "rgba(245,158,11,.22)" ?"selected" : ""}>Gelb</option>
            <option value="rgba(34,197,94,.18)" ${highlightColor === "rgba(34,197,94,.18)" ?"selected" : ""}>Grün</option>
          </select>
        </label>
      </div>
      <label>Text<textarea id="deptNoteText" rows="8" placeholder="Zeilenumbrüche bleiben sichtbar. Fett mit **Text** oder über den Button.">${escapeHtml(note?.text || "")}</textarea></label>
      <small class="field-hint">Zeilenumbrüche, Links und **fette Hervorhebungen** werden in der Notiz angezeigt.</small>
    </div>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="blue-btn" id="saveDepartmentNote">${isEdit ?"Notiz aktualisieren" : "Notiz erstellen"}</button>
    </div>
  `, (modal) => {
    modal.querySelector("#deptNoteBold")?.addEventListener("click", () => wrapTextareaSelection(modal.querySelector("#deptNoteText"), "**", "**"));
    modal.querySelector("#saveDepartmentNote").addEventListener("click", async () => {
      try {
        const data = await api(isEdit ?`/api/departments/${department.id}/notes/${note.id}` : `/api/departments/${department.id}/notes`, {
          method: isEdit ?"PATCH" : "POST",
          body: JSON.stringify({
            title: $("#deptNoteTitle").value,
            priority: $("#deptNotePriority").value,
            team: $("#deptNoteTeam")?.value || "all",
            text: $("#deptNoteText").value,
            align: $("#deptNoteAlign")?.value || "left",
            textColor: $("#deptNoteTextColor")?.value || "",
            highlightColor: $("#deptNoteHighlightColor")?.value || ""
          })
        });
        const updatedDepartment = updateDepartmentState(data.department) || department;
        closeModal();
        renderDepartmentPage(updatedDepartment);
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openSwatCallModal(department) {
  openModal(`
    <h3>SWAT ausrufen</h3>
    <p class="muted">Wähle aus, welches Team aktiv ausgerufen werden soll.</p>
    <label>Team
      <select id="swatCallTeam">
        ${SWAT_TEAMS.map((team) => `<option value="${team}">Team ${team}</option>`).join("")}
      </select>
    </label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="orange-btn" id="confirmSwatCall">Team ausrufen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmSwatCall").addEventListener("click", async () => {
      try {
        const updatedDepartment = await setSwatTeamStatus(department, modal.querySelector("#swatCallTeam")?.value || "", true, { keepModalOpen: true });
        closeModal();
        renderDepartmentPage(updatedDepartment);
      } catch (error) {
        modal.querySelector("#modalError").textContent = error.message;
      }
    });
  });
}

async function setSwatTeamStatus(department, team, active, options = {}) {
  const data = await api("/api/departments/swat/call", {
    method: "POST",
    body: JSON.stringify({ team, active })
  });
  const updatedDepartment = updateDepartmentState(data.department) || department;
  if (!options.keepModalOpen) renderDepartmentPage(updatedDepartment);
  const status = updatedDepartment.swatStatus?.[team] || {};
  if (active) {
    if (canReceiveSwatCallAlert(team, updatedDepartment)) {
      if (status.calledAt) localStorage.setItem(`lspd_swat_call_seen_${team}`, status.calledAt);
      const lines = [
        "Das SWAT ist ausgerufen.",
        `Team: ${team}`,
        `Ausgerufen von: ${status.calledByName || fullName(state.currentUser)}`,
        `Zeit: ${formatDateTime(status.calledAt || new Date().toISOString())}`
      ];
      showNotify(`SWAT Team ${team} wurde ausgerufen.`, "info", {
        title: "SWAT AUSGERUFEN",
        className: "swat-call-notify",
        duration: 60000,
        lines
      });
      triggerSwatPageFlash();
      playSwatCallSound();
    } else {
      showNotify(`SWAT Team ${team} wurde ausgerufen.`, "success");
    }
  } else {
    showNotify(`SWAT Team ${team} wurde auf inaktiv gesetzt.`, "success");
  }
  return updatedDepartment;
}

function rookieNoteMeta(note = {}, user = {}) {
  const meta = note.meta && typeof note.meta === "object" ?note.meta : {};
  return {
    reportDate: meta.reportDate || (note.createdAt ?isoDateLocal(new Date(note.createdAt)) : ""),
    supervisingOfficer: meta.supervisingOfficer || "",
    processingOfficer: meta.processingOfficer || note.authorName || "",
    rookieName: meta.rookieName || fullName(user),
    shift: meta.shift || ""
  };
}

function normalNoteMeta(note = {}) {
  const meta = note.meta && typeof note.meta === "object" ?note.meta : {};
  return {
    reportDate: meta.reportDate || (note.createdAt ?isoDateLocal(new Date(note.createdAt)) : ""),
    processingOfficer: meta.processingOfficer || note.authorName || "",
    subject: meta.subject || "",
    category: meta.category || ""
  };
}

function renderInternalNoteArticle(note) {
  const meta = normalNoteMeta(note);
  return `
    <article class="rookie-file-card">
      <div class="rookie-file-grid">
        <span><b>Akten Datum</b>${escapeHtml(meta.reportDate ?formatDate(meta.reportDate) : "-")}</span>
        <span><b>Bearbeitender Beamter</b>${escapeHtml(meta.processingOfficer || "-")}</span>
        <span><b>Betreff</b>${escapeHtml(meta.subject || "-")}</span>
        ${meta.category ?`<span><b>Kategorie</b>${escapeHtml(meta.category)}</span>` : ""}
      </div>
      <p>${escapeHtml(note.text)}</p>
      <small>${escapeHtml(note.authorName || "-")} · ${formatDateTime(note.createdAt)}${note.updatedAt ?` · bearbeitet ${formatDateTime(note.updatedAt)}` : ""}</small>
    </article>
  `;
}

function renderRookieNoteArticle(note, user) {
  const meta = rookieNoteMeta(note, user);
  return `
    <article class="rookie-file-card">
      <div class="rookie-file-grid">
        <span><b>Rookie Berichtsdatum</b>${escapeHtml(meta.reportDate ?formatDate(meta.reportDate) : "-")}</span>
        <span><b>Aufsichtshabender Officer</b>${escapeHtml(meta.supervisingOfficer || "-")}</span>
        <span><b>Bearbeitender Beamter</b>${escapeHtml(meta.processingOfficer || "-")}</span>
        <span><b>Rookie</b>${escapeHtml(meta.rookieName || "-")}</span>
        ${meta.shift ?`<span><b>Dienst / Schicht</b>${escapeHtml(meta.shift)}</span>` : ""}
      </div>
      <p>${escapeHtml(note.text)}</p>
      <small>${escapeHtml(note.authorName || "-")} · ${formatDateTime(note.createdAt)}${note.updatedAt ?` · bearbeitet ${formatDateTime(note.updatedAt)}` : ""}</small>
    </article>
  `;
}

function openDepartmentMemberFileMenu(department, userId) {
  const user = state.users.find((item) => item.id === userId) || department.members.find((item) => item.userId === userId)?.user;
  if (!user) return;
  const notes = (department.memberNotes || []).filter((note) => note.userId === userId);
  const rookieCount = notes.filter((note) => note.type === "Rookie").length;
  const canWriteRookie = Number(user.rank || 0) === 0;
  openModal(`
    <h3>Personalakte</h3>
    <p class="muted">${escapeHtml(fullName(user))} - ${escapeHtml(department.name)}</p>
    <div class="member-file-menu">
      ${canManagePersonnelFiles() ?`<button class="orange-btn open-personnel-file-from-dept" type="button" data-user-id="${escapeHtml(user.id)}">Personalakte / Sanktionen öffnen</button>` : ""}
      ${canWriteRookie ?`<button class="orange-btn dept-member-note-add" type="button" data-user-id="${escapeHtml(user.id)}" data-note-type="Rookie">Rookie Akte schreiben</button>` : ""}
      ${canWriteRookie || rookieCount ?`<button class="ghost-btn dept-member-notes-view" type="button" data-user-id="${escapeHtml(user.id)}" data-note-type="Rookie">Rookie Akten ansehen (${rookieCount})</button>` : ""}
    </div>
    ${!canWriteRookie && rookieCount ?`<p class="muted">Rookie Akten können nach Rang 0 nur noch angesehen werden.</p>` : ""}
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Schließen</button>
    </div>
  `, (modal) => {
    modal.querySelector(".open-personnel-file-from-dept")?.addEventListener("click", () => openPersonnelFileModal(user));
    modal.querySelectorAll(".dept-member-note-add").forEach((button) => button.addEventListener("click", () => openDepartmentMemberNoteModal(department, button.dataset.userId, button.dataset.noteType || "Normal")));
    modal.querySelectorAll(".dept-member-notes-view").forEach((button) => button.addEventListener("click", () => openDepartmentMemberNotesViewModal(department, button.dataset.userId, button.dataset.noteType || "")));
  });
}

function openDepartmentMemberNoteModal(department, userId, type = "Normal", noteId = "") {
  const member = department.members.find((item) => item.userId === userId);
  const user = member?.user || state.users.find((item) => item.id === userId);
  if (!user) return;
  const existingNote = noteId ?(department.memberNotes || []).find((item) => item.id === noteId) : null;
  const noteType = existingNote?.type === "Rookie" || type === "Rookie" ?"Rookie" : "Normal";
  if (noteType === "Rookie" && Number(user.rank || 0) !== 0) {
    showNotify("Rookie Akten können nur bei Rang 0 geschrieben werden.", "error");
    return;
  }
  const today = isoDateLocal(new Date());
  const rookieMeta = rookieNoteMeta(existingNote || {}, user);
  const normalMeta = normalNoteMeta(existingNote || {});
  openModal(`
    <h3>${noteType === "Rookie" ?(existingNote ?"Rookie Akte bearbeiten" : "Rookie Akte schreiben") : existingNote ?"Interne Akte bearbeiten" : "Interne Akte schreiben"}</h3>
    <p class="muted">${escapeHtml(fullName(user))} - ${escapeHtml(department.name)}</p>
    ${noteType === "Rookie" ?`
      <div class="rookie-file-form">
        <label>Rookie Berichtsdatum<input id="rookieReportDate" type="date" value="${escapeHtml(rookieMeta.reportDate || today)}"></label>
        <label>Aufsichtshabender Officer<input id="rookieSupervisingOfficer" value="${escapeHtml(rookieMeta.supervisingOfficer)}" placeholder="Name des Aufsichtshabenden"></label>
        <label>Bearbeitender Beamter<input id="rookieProcessingOfficer" value="${escapeHtml(rookieMeta.processingOfficer || fullName(state.currentUser))}"></label>
        <label>Rookie<input id="rookieName" value="${escapeHtml(rookieMeta.rookieName || fullName(user))}"></label>
        <label class="full">Dienst / Schicht<input id="rookieShift" value="${escapeHtml(rookieMeta.shift)}" placeholder="Optional, z.B. Streife, Ausbildung, Schicht"></label>
      </div>
    ` : `<div class="rookie-file-form">
        <label>Akten Datum<input id="normalReportDate" type="date" value="${escapeHtml(normalMeta.reportDate || today)}"></label>
        <label>Bearbeitender Beamter<input id="normalProcessingOfficer" value="${escapeHtml(normalMeta.processingOfficer || fullName(state.currentUser))}"></label>
        <label>Betreff<input id="normalSubject" value="${escapeHtml(normalMeta.subject)}" placeholder="Kurzer Betreff"></label>
        <label>Kategorie<input id="normalCategory" value="${escapeHtml(normalMeta.category)}" placeholder="Optional"></label>
      </div>`}
    <label>${noteType === "Rookie" ?"Bericht" : "Bericht / Akteneintrag"}<textarea id="deptMemberNoteText" rows="${noteType === "Rookie" ?9 : 8}" placeholder="${noteType === "Rookie" ?"Bericht zur Rookie-Akte schreiben..." : "Interne Akte schreiben..."}">${escapeHtml(existingNote?.text || "")}</textarea></label>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="blue-btn" id="saveDeptMemberNote">Speichern</button>
    </div>
  `, (modal) => {
    modal.querySelector("#saveDeptMemberNote").addEventListener("click", async () => {
      try {
        const meta = noteType === "Rookie" ?{
          reportDate: modal.querySelector("#rookieReportDate")?.value || "",
          supervisingOfficer: modal.querySelector("#rookieSupervisingOfficer")?.value || "",
          processingOfficer: modal.querySelector("#rookieProcessingOfficer")?.value || "",
          rookieName: modal.querySelector("#rookieName")?.value || "",
          shift: modal.querySelector("#rookieShift")?.value || ""
        } : {
          reportDate: modal.querySelector("#normalReportDate")?.value || "",
          processingOfficer: modal.querySelector("#normalProcessingOfficer")?.value || "",
          subject: modal.querySelector("#normalSubject")?.value || "",
          category: modal.querySelector("#normalCategory")?.value || ""
        };
        const data = await api(existingNote ?`/api/departments/${department.id}/member-notes/${existingNote.id}` : `/api/departments/${department.id}/member-notes`, {
          method: existingNote ?"PATCH" : "POST",
          body: JSON.stringify({ userId, text: $("#deptMemberNoteText").value, type: noteType, meta })
        });
        const updatedDepartment = updateDepartmentState(data.department) || department;
        closeModal();
        renderDepartmentPage(updatedDepartment);
      } catch (error) {
        $("#modalError").textContent = error.message;
      }
    });
  });
}

function openDeleteDepartmentNoteModal(department, note) {
  openModal(`
    <h3>Notiz löschen</h3>
    <p class="muted">${escapeHtml(note.title)} wirklich löschen?</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="red-btn" id="confirmDeleteDepartmentNote">Notiz löschen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmDeleteDepartmentNote").addEventListener("click", async () => {
      const button = modal.querySelector("#confirmDeleteDepartmentNote");
      button.disabled = true;
      try {
        const latest = state.departments.find((item) => item.id === department.id) || department;
        pendingDepartmentNoteDeletes.add(note.id);
        updateDepartmentState({ ...latest, notes: (latest.notes || []).filter((item) => item.id !== note.id) });
        closeModal();
        if (state.page && isDepartmentPage(state.page)) renderDepartmentPage(state.departments.find((item) => item.id === department.id) || latest);
        departmentNoteMutationQueue = departmentNoteMutationQueue.catch(() => {}).then(() => api(`/api/departments/${department.id}/notes/${note.id}`, { method: "DELETE" }));
        const data = await departmentNoteMutationQueue;
        pendingDepartmentNoteDeletes.delete(note.id);
        const updatedDepartment = updateDepartmentState(data.department) || department;
        if (state.page && isDepartmentPage(state.page)) renderDepartmentPage(updatedDepartment);
      } catch (error) {
        pendingDepartmentNoteDeletes.delete(note.id);
        showNotify(error.message || "Notiz konnte nicht gelöscht werden.", "error");
        const data = await bootstrap().catch(() => null);
        if (data && state.page && isDepartmentPage(state.page)) renderDepartmentPage(departmentByPage(state.page));
      }
    });
  });
}

function openDeleteDepartmentMemberNoteModal(department, noteId) {
  const note = (department.memberNotes || []).find((item) => item.id === noteId);
  if (!note) return;
  openModal(`
    <h3>Aktennotiz löschen</h3>
    <p class="muted">Diese interne Notiz wirklich löschen?</p>
    <p id="modalError" class="form-error"></p>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Abbrechen</button>
      <button class="red-btn" id="confirmDeleteDeptMemberNote">Löschen</button>
    </div>
  `, (modal) => {
    modal.querySelector("#confirmDeleteDeptMemberNote").addEventListener("click", async () => {
      const button = modal.querySelector("#confirmDeleteDeptMemberNote");
      button.disabled = true;
      try {
        const latest = state.departments.find((item) => item.id === department.id) || department;
        pendingDepartmentNoteDeletes.add(noteId);
        updateDepartmentState({ ...latest, memberNotes: (latest.memberNotes || []).filter((item) => item.id !== noteId) });
        closeModal();
        if (state.page && isDepartmentPage(state.page)) renderDepartmentPage(state.departments.find((item) => item.id === department.id) || latest);
        departmentNoteMutationQueue = departmentNoteMutationQueue.catch(() => {}).then(() => api(`/api/departments/${department.id}/member-notes/${noteId}`, { method: "DELETE" }));
        const data = await departmentNoteMutationQueue;
        pendingDepartmentNoteDeletes.delete(noteId);
        const updatedDepartment = updateDepartmentState(data.department) || department;
        if (state.page && isDepartmentPage(state.page)) renderDepartmentPage(updatedDepartment);
      } catch (error) {
        pendingDepartmentNoteDeletes.delete(noteId);
        showNotify(error.message || "Aktennotiz konnte nicht gelöscht werden.", "error");
        const data = await bootstrap().catch(() => null);
        if (data && state.page && isDepartmentPage(state.page)) renderDepartmentPage(departmentByPage(state.page));
      }
    });
  });
}

function openDepartmentMemberNotesViewModal(department, userId, type = "") {
  const user = state.users.find((item) => item.id === userId) || department.members.find((item) => item.userId === userId)?.user;
  if (!user) return;
  const canDelete = departmentActionAllowed(department, "departmentLeadership");
  const canEdit = (note) => note.type !== "Rookie" || Number(user.rank || 0) === 0;
  const notes = (department.memberNotes || [])
    .filter((note) => note.userId === userId && (!type || (type === "Normal" ?note.type !== "Rookie" : note.type === type)))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  openModal(`
    <h3>${type === "Rookie" ?"Rookie Akte" : "Akteneinträge"}</h3>
    <p class="muted">${escapeHtml(fullName(user))} - ${escapeHtml(department.name)}</p>
    <div class="member-note-view-list">
      ${notes.length ?notes.map((note) => `
        <div class="member-note-entry">
          ${note.type === "Rookie" ?renderRookieNoteArticle(note, user) : renderInternalNoteArticle(note)}
          <div class="member-note-actions">
            ${canEdit(note) ?`<button class="ghost-btn compact-action modal-note-edit" type="button" data-note-id="${escapeHtml(note.id)}">Bearbeiten</button>` : `<span class="muted">Nur Ansicht</span>`}
            ${canDelete ?`<button class="mini-icon danger delete-dept-member-note modal-note-delete" type="button" data-note-id="${escapeHtml(note.id)}" title="Akte löschen">${actionIcon("delete")}</button>` : ""}
          </div>
        </div>
      `).join("") : `<p class="muted">Keine Einträge vorhanden.</p>`}
    </div>
    <div class="modal-actions">
      <button class="ghost-btn" data-close>Schließen</button>
    </div>
  `, (modal) => {
    modal.querySelectorAll(".modal-note-edit").forEach((button) => button.addEventListener("click", () => openDepartmentMemberNoteModal(department, userId, "", button.dataset.noteId)));
    modal.querySelectorAll(".modal-note-delete").forEach((button) => button.addEventListener("click", () => openDeleteDepartmentMemberNoteModal(department, button.dataset.noteId)));
  });
}

document.addEventListener("click", (event) => {
  const departmentInfoButton = event.target.closest(".department-info");
  if (departmentInfoButton) {
    event.preventDefault();
    const department = state.departments.find((item) => item.id === departmentInfoButton.dataset.departmentId);
    if (department) openDepartmentInfoModal(department);
    return;
  }

  const editDeptMember = event.target.closest(".edit-dept-member");
  if (editDeptMember) {
    const department = state.departments.find((item) => item.id === editDeptMember.dataset.departmentId);
    const member = department?.members.find((item) => item.userId === editDeptMember.dataset.userId);
    if (department && member) openDepartmentMemberModal(department, member);
    return;
  }

  const removeDeptMember = event.target.closest(".remove-dept-member");
  if (removeDeptMember) {
    const department = state.departments.find((item) => item.id === removeDeptMember.dataset.departmentId);
    const member = department?.members.find((item) => item.userId === removeDeptMember.dataset.userId);
    if (department && member) openRemoveDepartmentMemberModal(department, member);
    return;
  }

  const editDeptNote = event.target.closest(".edit-dept-note");
  if (editDeptNote) {
    const department = state.departments.find((item) => item.id === editDeptNote.dataset.departmentId);
    const note = department?.notes.find((item) => item.id === editDeptNote.dataset.noteId);
    if (department && note) openDepartmentNoteModal(department, note);
    return;
  }

  const deleteDeptNote = event.target.closest(".delete-dept-note");
  if (deleteDeptNote) {
    const department = state.departments.find((item) => item.id === deleteDeptNote.dataset.departmentId);
    const note = department?.notes.find((item) => item.id === deleteDeptNote.dataset.noteId);
    if (department && note) openDeleteDepartmentNoteModal(department, note);
    return;
  }

  const editNoteButton = event.target.closest(".edit-note");
  if (editNoteButton) {
    const note = state.notes.find((item) => item.id === editNoteButton.dataset.noteId);
    if (note) openNoteModal(note);
    return;
  }

  const deleteNoteButton = event.target.closest(".delete-note");
  if (deleteNoteButton) {
    openDeleteNoteModal(deleteNoteButton.dataset.noteId);
    return;
  }

  const removeButton = event.target.closest(".remove-duty");
  if (removeButton) {
    const entry = state.duty.find((item) => item.userId === removeButton.dataset.userId);
    const user = entry?.user || state.users.find((item) => item.id === removeButton.dataset.userId);
    openModal(`
      <h3>Person austragen</h3>
      <p class="muted">${escapeHtml(fullName(user))} aus dem Dienst austragen?</p>
      <p id="modalError" class="form-error"></p>
      <div class="modal-actions">
        <button class="ghost-btn" data-close>Abbrechen</button>
        <button class="red-btn" id="confirmRemovePerson">Person austragen</button>
      </div>
    `, (modal) => {
      modal.querySelector("#confirmRemovePerson").addEventListener("click", async () => {
        try {
          await api(`/api/duty/stop/${removeButton.dataset.userId}`, { method: "POST", body: "{}" });
          closeModal();
          await bootstrap();
        } catch (error) {
          $("#modalError").textContent = error.message;
        }
      });
    });
  }
});

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#loginError").textContent = "";
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ name: $("#loginName").value, password: $("#loginPassword").value })
    });
    state.token = data.token;
    storeAuthToken(state.token);
    await bootstrap();
  } catch (error) {
    $("#loginError").textContent = error.message;
  }
});

$("#discordLoginBtn")?.addEventListener("click", () => startDiscordOAuth("login"));

async function logout() {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
  } catch (_error) {
  } finally {
    clearAuthToken();
    state.token = null;
    showLogin();
  }
}

$("#logoutBtn")?.addEventListener("click", logout);

installInspectGuard();
installEllipsisTooltips();

document.addEventListener("click", (event) => {
  enableMailboxAudio();
  document.querySelectorAll(".exam-user-picker.open").forEach((picker) => {
    if (!picker.contains(event.target)) picker.classList.remove("open");
  });
});

async function initApp() {
  const handledDiscordRedirect = await handleDiscordOAuthRedirect();
  if (handledDiscordRedirect) return;
  const hasDiscordLinkRequest = consumeDiscordLinkRequest();
  if (state.token) {
    bootstrap().then(() => startQueuedDiscordLink()).catch((error) => {
      clearAuthToken();
      if (error?.status === 401) handleAccessRevoked("Deine gespeicherte Sitzung ist nicht mehr gültig.");
      else showLogin();
    });
  } else {
    showLogin();
    if (hasDiscordLinkRequest) $("#loginError").textContent = "Bitte melde dich zuerst mit deinem Dienstblatt-Account an. Danach wird Discord verknüpft.";
  }
}

initApp();

window.addEventListener("popstate", () => {
  const requestedPage = requestedPageFromUrl();
  state.page = requestedPage || "Dienstblatt";
  applyUrlState({ persist: true });
  if (!requestedPage) localStorage.setItem("lspd_page", state.page);
  lastOpenedDeepLinkDoc = "";
  if (state.currentUser) renderApp();
});
