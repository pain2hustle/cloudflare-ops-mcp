// src/index.js
// Public API surface. Host apps import from here; the package needs no host to run.

export { CloudflareClient, CloudflareError, redactToken } from "./client.js";

export { resolveZoneId, resolveZone, scanZone } from "./zone.js";

export {
  listRecords,
  findRecord,
  applyDnsRecord,
  deleteDnsRecord,
} from "./dns.js";

export {
  getRoutingStatus,
  enableRouting,
  listDestinations,
  addDestination,
  listRules,
  getCatchAll,
  setupEmailRouting,
} from "./email.js";

export {
  parseDmarc,
  buildDmarc,
  parseSpf,
  getDmarc,
  setDmarcPolicy,
  quoteTxt,
  unquoteTxt,
} from "./dmarc.js";

export {
  parseBimi,
  buildBimi,
  validateBimiSvgUrl,
  setupBimi,
} from "./bimi.js";

export { planEmailAuth } from "./plan.js";

export { purgeCache, resolveCacheZoneId } from "./cache.js";

export { planPagesCutover } from "./pages.js";

export { createTurnstileWidget } from "./turnstile.js";

export { appendAudit, AUDIT_DEFAULT_PATH } from "./audit.js";

export {
  mintScopedToken,
  listTokens,
  revokeToken,
  listPermissionGroups,
  TOKEN_PRESETS,
} from "./tokens.js";

export { whoServesDomain, accountDoctor, pagesBranchCheck } from "./doctor.js";
