# Claude connector directory submission

Everything the Anthropic directory portal asks for, filled in for Materialize. Submit at **claude.ai/directory/manage → Submit new → MCP connector** from a Pro/Max/Team/Enterprise account (on Team/Enterprise, an Owner). Requirements as of 2026-10-09:

- [Submission guide](https://claude.com/docs/connectors/building/submission)
- [Pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria)
- [Authentication](https://claude.com/docs/connectors/building/authentication)
- [Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)

The connector is the same MCP server the ChatGPT plugin uses (`app/api/[transport]/route.ts`); nothing Claude-specific runs server side.

## Before submitting

1. **Financial transactions.** The directory doesn't accept connectors that "transfer money, cryptocurrency, or other financial assets" without Anthropic's written permission, and the Compliance step has an acknowledgment for it. `materialize_create_order` buys physical goods: by default it only creates a draft the user pays for on materialize.cc. But with a user-created agent spending policy *and* `MATERIALIZE_AGENT_BILLING_ENABLED=true`, it charges the saved card off-session. Email mcp-review@anthropic.com first (draft below) and submit once they reply.
2. **Company name.** List under Materialize Systems LLC once the LLC is approved (`lib/legal.ts` already names it as the operator).
3. **Test account.** Reuse reviewer@materialize.cc, the account OpenAI reviews with (password sign-in, no MFA; don't change either during a review). Otherwise create a dedicated reviewer account that signs in without MFA or emailed codes. It needs to be "fully populated": a few models in the library (the `public/review/*.stl` files), one project with a BOM, and at least one past order so `materialize_list_orders` returns something. Put the credentials only in the portal.
4. **Run every tool** (done 2026-10-10: all 31 ran as the reviewer account in claude.ai; tick the portal's confirmation) as a custom connector in Claude (Customize → Connectors → Add custom connector → `https://www.materialize.cc/api/mcp`) signed in as the reviewer. The portal asks you to confirm this. Then connect from Claude Code too (`claude mcp add --transport http materialize https://www.materialize.cc/api/mcp`), which uses a loopback redirect.
5. **Screenshots** (three taken 2026-10-10: materials card and two quote cards, all over 1000px wide) for the MCP App carousel: 3 to 5 PNGs at least 1000px wide, cropped to the card only (no prompt in the image), each paired with the prompt that produced it. Use the quote card (3D part + price breakdown), the option comparison, and the materials card.

### Draft email to mcp-review@anthropic.com

> Subject: Pre-submission question: connector that creates paid orders for physical goods
>
> Hi, we're about to submit Materialize (materialize.cc, remote MCP at https://www.materialize.cc/api/mcp) to the connector directory. Materialize lets people print and host their 3D models: publish and share them, and get them professionally printed and shipped.
>
> One tool, `materialize_create_order`, creates a print order. By default it never moves money: it returns a draft, and the user reviews and pays on materialize.cc through Stripe Checkout. A user can opt in to an agent spending policy (per-order and per-period limits they set on our site), in which case an order within the limits is charged to their saved card and can be cancelled during a window they choose. The tool is annotated `destructiveHint: true`, so Claude always asks before calling it.
>
> Is this acceptable under the financial-transactions policy as is? If not, would it be acceptable if the tool only ever returned a checkout link for the user to pay?
>
> Thanks, Connor White, Materialize Systems LLC

## Portal fields

### 1. Connection

- **Server URL:** `https://www.materialize.cc/api/mcp` (Universal URL). It must match the `resource` in `/.well-known/oauth-protected-resource` exactly, so use `www.` and no trailing slash.

### 2. Tools

Auto-synced. 31 of the 34 tools show for an ordinary account; the three `materialize_cad_*` tools are owner-only and hidden from everyone else, reviewers included. Every tool has a `title` and explicit `readOnlyHint`/`destructiveHint` from `lib/mcp/tool-annotations.ts`; `lib/mcp/__tests__/tool-annotations.test.ts` pins that and the 64-character name limit.

### 3. Listing

- **Server name:** Materialize
- **One-liner** (≤200): Print and host your 3D models: publish and share them with a link, check printability, compare prices from professional print shops and order prints from the chat.
- **Description** (≤2,000):

  > Materialize is where your 3D models live and get made. Claude can add a model to your library from a file you attach (STL, OBJ, 3MF, STEP) or a link, publish it with a description, license and photos, and share it with a link, or keep it private. Hardware projects get their own pages with the files, a parts list, wiring diagrams and a build guide.
  >
  > When you want a part in hand, Claude can check the model for problems that make prints fail, recommend materials for what the part has to do, and compare all-in prices from professional print shops: FDM, SLS, MJF, resin and metal, with shipping, vendor minimums and our service fee included. Prices and material shortlists appear as interactive cards with a 3D view of your part.
  >
  > Claude prepares the order and Materialize emails you a link to review and pay on materialize.cc. Nothing is charged until you approve it, unless you've set up a spending policy yourself. Claude can then track the order's status.
  >
  > Requires a free Materialize account. Prices are in US dollars.

- **Categories:** Design, Shopping/Commerce, Productivity (pick the closest the portal offers).
- **Documentation URL:** https://www.materialize.cc/support/claude
- **Privacy policy URL:** https://www.materialize.cc/privacy
- **Support contact:** support@materialize.cc
- **Icon:** `app/icon.svg` (the logomark); export a square PNG if the portal wants raster.
- **URL slug:** `materialize` (permanent once published).
- **Allowed link URIs:** `https://www.materialize.cc` (confirmation and order links).

### 4. Use cases

- **Primary use cases:** host, publish and share 3D models and hardware projects from the chat; price and order a 3D print of a model; check a model's printability before ordering; choose a material for a functional part; track print orders.
- **Prerequisites:** a free Materialize account (created during sign-in). Paying for a print needs a card at checkout.
- **Reads, writes or both:** both.

### 5. Company

- **Company name:** Materialize Systems LLC
- **Website:** https://www.materialize.cc
- **Primary contact:** Connor White, support@materialize.cc

### 6. Authentication

**OAuth with CIMD.** Clerk is the authorization server (`https://clerk.materialize.cc`) and advertises `client_id_metadata_document_supported: true` with `none` in `token_endpoint_auth_methods_supported`, so Claude uses its Client ID Metadata Document instead of registering a client per connection. DCR is still on for older clients. S256 PKCE is advertised, `offline_access` is listed so Claude gets refresh tokens, and `/api/mcp` answers unauthenticated requests with `401` + `WWW-Authenticate: Bearer resource_metadata=…`. Not lazy auth: every tool needs the account.

### 7. Data handling

- **API ownership:** our own API. Quotes and orders go through CraftCloud, which we call as a CraftCloud API customer under their terms.
- **Personal health data:** no.
- **Sponsored content:** no.

### 8. Test & launch

- **Test account instructions:** "Connect with the URL above and sign in with the email and password below. The account already has three models, a project and past orders. To try ordering, use `public/review/calibration-cube-20mm.stl` (https://www.materialize.cc/review/calibration-cube-20mm.stl): ask Claude to quote and order it. The order email's link leads to Stripe; you can stop before paying."
- **Confirmation:** tick once step 4 above is done.

### 9. Compliance

Seven acknowledgments: directory guidelines, first-party API usage, financial transactions (see above), AI media generation (no: the generative CAD tools are owner-only and not exposed), prompt injection, conversation data collection (tools receive only their arguments; nothing reads chat history), public documentation (`/support/claude`).

## What changed in the server for this

- Tool descriptions describe the tool instead of directing Claude (the checklist rejects "tell Claude how to behave"): the quote and material tools no longer say "don't repeat them in a table".
- `materialize_create_order` says when an order is charged without the approval step (spending policy), and `materialize_get_order` no longer promises tracking numbers the status sync can't provide.
- Unexpected errors name the tool and the support address instead of a bare "Internal error", which the checklist calls out as a rejection.
- `/support/claude` is the public documentation page.

## After the ChatGPT review closes

The ChatGPT plugin serves the same tool list, and OpenAI's review scans tool metadata, so these description edits from the Claude test run wait until it is approved:

- `materialize_create_project`: describe `fileIds` as fileIds (not fileAssetIds) from `materialize_list_files` / `materialize_import_model`, and `visibility` as defaulting to a private draft.
- `materialize_list_materials`: the `group` filter now matches loosely, so the example can say "e.g. 'Plastics', 'Resins'".
- `materialize_create_order`: note that `materialize_get_order` reports a pending draft as `awaiting_agent_approval`.
