/**
 * Facts the legal and support pages state, in one place so the privacy
 * policy, terms and support page can't disagree with each other.
 *
 * The operator is an individual until the LLC exists. When it does,
 * change OPERATOR here and bump LEGAL_LAST_UPDATED; the plugin's
 * `developerName` (plugins/materialize/plugin.json) must match whoever
 * is verified on the OpenAI platform, which is a separate change.
 */
export const OPERATOR = "Connor White";
export const SUPPORT_EMAIL = "support@materialize.cc";
export const GOVERNING_LAW = "California";
export const MINIMUM_AGE = 13;
export const LEGAL_LAST_UPDATED = "October 1, 2026";
