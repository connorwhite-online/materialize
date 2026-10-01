# Materialize plugin

The package OpenAI's plugin directory (shared by ChatGPT and Codex) installs. It bundles:

- `plugin.json`: identity, plus the directory listing copy under `extensions.com.openai.interface`.
- `mcp.json`: the hosted MCP server. Sign-in is OAuth through Clerk (`lib/mcp/oauth.ts`), so the plugin carries no credentials.
- `skills/materialize`: a **copy** of the repo-root `skills/materialize`, which `npx skills install` reads. Edit the root copy, then run `cp -R skills/materialize plugins/materialize/skills/`. `lib/__tests__/agent-plugin.test.ts` fails when they differ.

Local testing: the repo marketplace at `.agents/plugins/marketplace.json` lists this folder, so the ChatGPT desktop app or Codex opened on this repo shows it under the "Materialize" source.

## Submitting to the directory

Build the ZIP from inside this folder so `plugin.json` sits at the archive root:

```
cd plugins/materialize && zip -r ../../materialize-plugin.zip . -x README.md
```

then upload it at platform.openai.com/plugins. The manifest already carries the listing copy, the five positive and three negative review cases, the commerce declaration and US-only availability. Still needed:

- `/privacy`, `/terms` and `/support` pages on materialize.cc (the manifest points at them).
- `review.demo_recording_url`: a walkthrough video of the test cases.
- Domain verification: put the portal's token in `OPENAI_APPS_CHALLENGE_TOKEN`; `app/.well-known/openai-apps-challenge/route.ts` serves it.
- Reviewer credentials, entered in the dashboard (never in this package). The account must sign in without MFA or emailed codes.

Review cases attach `public/review/calibration-cube-20mm.stl`. Plugin ZIPs can't contain `.app.json` or hooks, so don't add them.
