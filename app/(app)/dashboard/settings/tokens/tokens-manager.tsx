"use client";

import { useState, useTransition } from "react";
import { CheckIcon, CopyIcon, KeyRoundIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FormActions } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page";
import {
  createPersonalAccessToken,
  revokePersonalAccessToken,
} from "@/app/actions/tokens";
import {
  ALL_SCOPES,
  SCOPE_DESCRIPTIONS,
  type Scope,
} from "@/lib/mcp/scopes";
import type { SpendingPolicy } from "@/lib/billing/policy";
import { cn } from "@/lib/utils";
import { TokenPolicyEditor } from "./token-policy-editor";

interface TokenSummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  spendingPolicy: SpendingPolicy | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

interface Props {
  initialTokens: TokenSummary[];
  hasPaymentMethod: boolean;
}

/** Short, human titles; the full sentence stays as the description. */
const SCOPE_TITLES: Record<Scope, string> = {
  "catalog:read": "View materials",
  "files:read": "View your files",
  "files:write": "Upload and edit files",
  "projects:read": "View your projects",
  "projects:write": "Create and edit projects",
  "quotes:read": "Get print quotes",
  "orders:create": "Draft print orders",
  "orders:read": "View orders",
  "cad:build": "Run CAD builds",
};

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function TokensManager({ initialTokens, hasPaymentMethod }: Props) {
  const [tokens, setTokens] = useState(initialTokens);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<Set<Scope>>(
    () => new Set(ALL_SCOPES)
  );
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ raw: string; id: string } | null>(
    null
  );
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (isPending || !name.trim() || selectedScopes.size === 0) return;
    setError(null);
    startTransition(async () => {
      const result = await createPersonalAccessToken({
        name,
        scopes: [...selectedScopes],
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRevealed({ raw: result.raw, id: result.id });
      setCopied(false);
      setTokens((prev) => [
        {
          id: result.id,
          name,
          prefix: result.prefix,
          scopes: [...selectedScopes],
          spendingPolicy: null,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          expiresAt: null,
          revokedAt: null,
        },
        ...prev,
      ]);
      setName("");
      setSelectedScopes(new Set(ALL_SCOPES));
      setShowCreate(false);
    });
  };

  const onRevoke = (id: string) => {
    if (
      !confirm(
        "Revoke this token? The agent using it will lose access immediately. This cannot be undone."
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await revokePersonalAccessToken(id);
      if (!result.ok) {
        setError(result.error ?? "Failed to revoke");
        return;
      }
      setTokens((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, revokedAt: new Date().toISOString() } : t
        )
      );
    });
  };

  const allSelected = selectedScopes.size === ALL_SCOPES.length;
  const active = tokens.filter((t) => !t.revokedAt);
  const revoked = tokens.filter((t) => t.revokedAt);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base leading-6 font-semibold">Access tokens</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            For agents that don&apos;t sign in themselves.
          </p>
        </div>
        {!showCreate && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setShowCreate(true);
              setError(null);
            }}
          >
            <PlusIcon />
            New token
          </Button>
        )}
      </div>

      {revealed && (
        <div className="mz-enter flex flex-col gap-3 rounded-2xl bg-muted p-4">
          <div>
            <p className="text-sm leading-5 font-medium">
              Copy your new token
            </p>
            <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">
              You won&apos;t be able to see it again.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[10px] bg-background px-3 py-2 font-mono text-[13px] ring-1 ring-border select-all">
              {revealed.raw}
            </code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(revealed.raw);
                setCopied(true);
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="-ml-3 w-fit"
            onClick={() => setRevealed(null)}
          >
            Done
          </Button>
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={onCreate}
          className="mz-enter flex flex-col gap-5 border-y border-border py-5"
        >
          <FieldGroup>
            <Field
              label="Name"
              htmlFor="token-name"
              hint="So you can tell your agents apart later."
            >
              <Input
                id="token-name"
                placeholder="Claude Desktop"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                autoComplete="off"
              />
            </Field>
          </FieldGroup>

          <div className="flex flex-col">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm leading-5 font-medium">Permissions</p>
              <button
                type="button"
                onClick={() =>
                  setSelectedScopes(
                    allSelected ? new Set() : new Set(ALL_SCOPES)
                  )
                }
                className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {allSelected ? "Clear all" : "Select all"}
              </button>
            </div>
            <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">
              Grant only what the agent needs.
            </p>
            <div className="mt-2 flex flex-col divide-y divide-border">
              {ALL_SCOPES.map((scope) => {
                const id = `scope-${scope}`;
                return (
                  <label
                    key={scope}
                    htmlFor={id}
                    className="flex cursor-pointer items-start gap-3 py-2.5 select-none"
                  >
                    <Checkbox
                      id={id}
                      className="mt-0.5"
                      checked={selectedScopes.has(scope)}
                      onCheckedChange={(checked) =>
                        setSelectedScopes((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(scope);
                          else next.delete(scope);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-sm leading-5 font-medium">
                          {SCOPE_TITLES[scope]}
                        </span>
                        <code className="hidden shrink-0 font-mono text-xs text-subtle-foreground sm:inline">
                          {scope}
                        </code>
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-[18px] text-pretty text-muted-foreground">
                        {SCOPE_DESCRIPTIONS[scope]}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {error && (
            <p role="alert" className="text-[13px] leading-[18px] text-destructive">
              {error}
            </p>
          )}

          <FormActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowCreate(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={isPending}
              disabled={!name.trim() || selectedScopes.size === 0}
            >
              Create token
            </Button>
          </FormActions>
        </form>
      )}

      {active.length === 0 && !showCreate && !revealed ? (
        <EmptyState
          bare
          icon={<KeyRoundIcon />}
          title="No tokens yet"
          description="Create one for Claude Desktop, Cursor or your own scripts."
        />
      ) : (
        active.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {active.map((t) => (
              <TokenRow
                key={t.id}
                token={t}
                hasPaymentMethod={hasPaymentMethod}
                onRevoke={() => onRevoke(t.id)}
                onPolicyChange={(policy) =>
                  setTokens((prev) =>
                    prev.map((row) =>
                      row.id === t.id ? { ...row, spendingPolicy: policy } : row
                    )
                  )
                }
              />
            ))}
          </ul>
        )
      )}

      {error && !showCreate && (
        <p role="alert" className="text-[13px] leading-[18px] text-destructive">
          {error}
        </p>
      )}

      {revoked.length > 0 && (
        <details className="group">
          <summary className="w-fit cursor-pointer list-none text-[13px] text-muted-foreground transition-colors hover:text-foreground">
            {revoked.length} revoked{" "}
            {revoked.length === 1 ? "token" : "tokens"}
          </summary>
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {revoked.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5 opacity-60">
                <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
                  Revoked {dateFmt.format(new Date(t.revokedAt!))}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function TokenRow({
  token: t,
  hasPaymentMethod,
  onRevoke,
  onPolicyChange,
}: {
  token: TokenSummary;
  hasPaymentMethod: boolean;
  onRevoke: () => void;
  onPolicyChange: (policy: SpendingPolicy | null) => void;
}) {
  const isOAuth = t.prefix === "oauth";
  const scopeLine =
    t.scopes.length === ALL_SCOPES.length
      ? "All permissions"
      : `${t.scopes.length} ${t.scopes.length === 1 ? "permission" : "permissions"}`;

  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-muted text-foreground"
        >
          <KeyRoundIcon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-5 font-medium">{t.name}</p>
          <p className="truncate text-[13px] leading-[18px] text-muted-foreground">
            {isOAuth ? (
              // OAuth connection row (lib/mcp/oauth.ts): ChatGPT or
              // Claude signed in, so there is no token to recognise.
              "Signed in with Materialize"
            ) : (
              <code className="font-mono text-xs">{t.prefix}…</code>
            )}
            {" · "}
            <span title={t.scopes.join(", ")}>{scopeLine}</span>
            {" · "}
            {t.lastUsedAt
              ? `Used ${dateFmt.format(new Date(t.lastUsedAt))}`
              : "Never used"}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className={cn("shrink-0 text-destructive hover:text-destructive")}
          onClick={onRevoke}
        >
          Revoke
        </Button>
      </div>
      <div className="sm:pl-12">
        <TokenPolicyEditor
          tokenId={t.id}
          initialPolicy={t.spendingPolicy}
          hasPaymentMethod={hasPaymentMethod}
          onChange={onPolicyChange}
        />
      </div>
    </li>
  );
}
