# Materialize plugin

The package OpenAI's plugin directory (shared by ChatGPT and Codex) installs. It bundles:

- `plugin.json`: identity, plus the directory listing copy under `extensions.com.openai.interface`.
- `mcp.json`: the hosted MCP server. Sign-in is OAuth through Clerk (`lib/mcp/oauth.ts`), so the plugin carries no credentials.
- `skills/materialize`: a **copy** of the repo-root `skills/materialize`, which `npx skills install` reads. Edit the root copy, then run `cp -R skills/materialize plugins/materialize/skills/`. `lib/__tests__/agent-plugin.test.ts` fails when they differ.

Local testing: the repo marketplace at `.agents/plugins/marketplace.json` lists this folder, so the ChatGPT desktop app or Codex opened on this repo shows it under the "Materialize" source.

## Testing in ChatGPT before submission

Run this end to end, signed in as the reviewer account, before every submission. Screen-record it: the recording is the demo video.

1. ChatGPT → Plugins (`chatgpt.com/plugins`) → **Add** → **Add custom MCP server**. Name `Materialize`, server URL `https://www.materialize.cc/api/mcp`, authentication OAuth. Open **Advanced OAuth settings** and wait for discovery: registration method should come up as **Client Identifier Metadata Document (CIMD)** and default scopes as `openid` + `email`. Leave both as discovered.
2. **Create as a plugin** → **Continue to Materialize** → the Clerk consent screen should name ChatGPT and the reviewer's email → **Allow**.
3. ChatGPT should land back on Plugins with the tool list loaded. "Authentication succeeded, action discovery failed" means our first MCP request refused the token; check Sentry for `mcp.oauth.*` (that is how the missing-`users`-row bug showed up).
4. In a new chat with the plugin enabled, run the manifest's review cases with the files in `public/review/`: a quote for an attached model, a marketplace search, a cheaper-material comparison. Stop before paying.
5. Remove the custom server afterwards (Plugins → Materialize → remove) so the next run starts from a cold sign-in.

Things that look like requirements and aren't: ChatGPT does **not** use dynamic client registration with us. Clerk's metadata advertises CIMD support, so ChatGPT's client id is the URL `https://chatgpt.com/oauth/client.json` and it requests `openid email offline_access` itself, so Clerk's DCR default scopes don't affect it. Claude and older clients still register through DCR.

## Submitting to the directory

Build the ZIP from inside this folder so `plugin.json` sits at the archive root:

```
cd plugins/materialize && zip -r ../../materialize-plugin.zip . -x README.md
```

then upload it at platform.openai.com/plugins. The manifest already carries the listing copy, the five positive and three negative review cases, the commerce declaration and US-only availability. Still needed:

- `/privacy`, `/terms` and `/support` pages on materialize.cc (the manifest points at them).
- `review.demo_recording_url`: a walkthrough video of the test cases.
- Domain verification: put the portal's token in `OPENAI_APPS_CHALLENGE_TOKEN`; `app/.well-known/openai-apps-challenge/route.ts` serves it.
- Reviewer credentials, entered in the dashboard (never in this package). The account must sign in without MFA or emailed codes. Run the ChatGPT test above with it first: it proves the account can connect, and the first connect creates its `users` row if the Clerk webhook never did.

Review cases attach `public/review/calibration-cube-20mm.stl`. Plugin ZIPs can't contain `.app.json` or hooks, so don't add them.
