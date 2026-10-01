# Materialize plugin

The package OpenAI's plugin directory (shared by ChatGPT and Codex) installs. It bundles:

- `plugin.json`: identity, plus the directory listing copy under `extensions.com.openai.interface`.
- `mcp.json`: the hosted MCP server. Sign-in is OAuth through Clerk (`lib/mcp/oauth.ts`), so the plugin carries no credentials.
- `skills/materialize`: a **copy** of the repo-root `skills/materialize`, which `npx skills install` reads. Edit the root copy, then run `cp -R skills/materialize plugins/materialize/skills/`. `lib/__tests__/agent-plugin.test.ts` fails when they differ.

Local testing: the repo marketplace at `.agents/plugins/marketplace.json` lists this folder, so the ChatGPT desktop app or Codex opened on this repo shows it under the "Materialize" source.

Before public submission, `privacyPolicyURL` and `termsOfServiceURL` must resolve; those pages don't exist yet.
