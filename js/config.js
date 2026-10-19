// ===== config.js =====
// EVERY external link lives in this one file.
//
// Right now the site reads the official toolmaker files straight from
// release.botc.app. When you download your own copy, put the files in your
// repo and swap the base URLs for local paths, e.g.
//
//   dataBase:    "data/",
//   iconBase:    "assets/characters/",
//   editionBase: "assets/editions/",
//   cccLogo:     "assets/community/ccc-parchment.png",
//
// Nothing else in the code needs to change.

export const CONFIG = {
  // Folder holding roles.json, nightsheet.json and jinxes.json
  dataBase: "https://release.botc.app/resources/data/",

  // Folder holding character icons, laid out as {edition}/{id}_g.webp etc.
  iconBase: "https://release.botc.app/resources/characters/",

  // Folder holding edition logos, laid out as {edition}/logo.webp
  editionBase: "https://release.botc.app/resources/editions/",

  // Community Created Content badge (required by the TPI policy)
  cccLogo: "https://release.botc.app/resources/community/ccc-parchment.png",

  // File names inside dataBase
  files: {
    roles: "roles.json",
    nightsheet: "nightsheet.json",
    jinxes: "jinxes.json",
  },

  // Icon file extension
  iconExt: ".webp",

  // Browser storage key (change it to start everything fresh)
  storageKey: "botc-storyteller-v1",
};

/** Full URL of a data file, by key ("roles", "nightsheet", "jinxes"). */
export const dataUrl = (key) => CONFIG.dataBase + CONFIG.files[key];

/** Full URL of an edition logo ("tb", "bmr", "snv"). */
export const editionLogoUrl = (edition) => `${CONFIG.editionBase}${edition}/logo${CONFIG.iconExt}`;

/**
 * Full URL of a character icon.
 * @param {string} edition  folder name from roles.json ("tb", "bmr", "snv", "carousel", "fabled", "loric")
 * @param {string} id       character id ("washerwoman")
 * @param {"g"|"e"|""} side "g" good, "e" evil, "" unaligned
 */
export const iconUrl = (edition, id, side) =>
  `${CONFIG.iconBase}${edition}/${id}${side ? "_" + side : ""}${CONFIG.iconExt}`;

/** Generic fallback icon for a team ("townsfolk", "demon"...) */
export const genericIconUrl = (team, side) =>
  `${CONFIG.iconBase}generic/${team || "custom"}${side ? "_" + side : ""}${CONFIG.iconExt}`;
