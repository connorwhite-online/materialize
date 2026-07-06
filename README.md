This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## For AI agents

Materialize is agent-ready in three ways:

- **Skill** — coding agents (Claude Code, Codex, and compatible) can install the print-ordering skill straight from this repo: `npx skills install connorwhite-online/materialize`. It teaches the full upload → quote → order workflow with the human-approval flow built in. Source: [`skills/materialize/`](./skills/materialize/SKILL.md).
- **MCP server** — `https://materialize.cc/api/mcp` (streamable HTTP, personal-access-token auth, `materialize_*` tools for catalog/files/quotes/orders). Mint tokens and spending policies in your dashboard settings.
- **llms.txt** — [`https://materialize.cc/llms.txt`](https://materialize.cc/llms.txt) describes the agent-facing surface; `/llms-full.txt` dumps the material catalog.

Every agent-created order is gated by human approval (email confirmation, or a pre-authorized per-token spending policy) — there is no unattended-purchase mode.
