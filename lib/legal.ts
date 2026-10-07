/**
 * Facts the legal and support pages state, in one place so the privacy
 * policy, terms and support page can't disagree with each other.
 *
 * The legal name is exactly "Materialize Systems LLC". If OPERATOR changes,
 * bump LEGAL_LAST_UPDATED; the plugin's `developerName`
 * (plugins/materialize/plugin.json) must match whoever is verified on
 * the OpenAI platform.
 */
export const OPERATOR = "Materialize Systems LLC, a California limited liability company";
export const SUPPORT_EMAIL = "support@materialize.cc";
export const GOVERNING_LAW = "California";
export const MINIMUM_AGE = 13;
export const LEGAL_LAST_UPDATED = "October 7, 2026";
