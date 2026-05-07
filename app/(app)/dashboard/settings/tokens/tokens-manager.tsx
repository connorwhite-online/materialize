"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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

export function TokensManager({ initialTokens, hasPaymentMethod }: Props) {
  const [tokens, setTokens] = useState(initialTokens);
  const [showCreate, setShowCreate] = useState(initialTokens.length === 0);
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<Set<Scope>>(
    () => new Set(ALL_SCOPES)
  );
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ raw: string; id: string } | null>(
    null
  );
  const [isPending, startTransition] = useTransition();

  const onCreate = () => {
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

  return (
    <div className="space-y-6">
      {revealed && (
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <h3 className="text-sm font-semibold">New token</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Copy this token now. You won&apos;t be able to see it again.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-background px-2 py-1.5 font-mono text-xs">
              {revealed.raw}
            </code>
            <Button
              size="sm"
              onClick={() => navigator.clipboard.writeText(revealed.raw)}
            >
              Copy
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-3"
            onClick={() => setRevealed(null)}
          >
            I&apos;ve copied it
          </Button>
        </div>
      )}

      {showCreate ? (
        <div className="rounded-lg border border-border p-4 space-y-4">
          <div>
            <Label htmlFor="token-name">Token name</Label>
            <Input
              id="token-name"
              placeholder="e.g. Claude Desktop, my CAD agent"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-sm">Scopes</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Grant the minimum the agent actually needs.
            </p>
            <div className="mt-2 space-y-2">
              {ALL_SCOPES.map((scope) => (
                <label
                  key={scope}
                  className="flex items-start gap-2 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={selectedScopes.has(scope)}
                    onCheckedChange={(checked) =>
                      setSelectedScopes((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(scope);
                        else next.delete(scope);
                        return next;
                      })
                    }
                    className="mt-0.5"
                  />
                  <div>
                    <code className="text-xs font-mono">{scope}</code>
                    <p className="text-xs text-muted-foreground">
                      {SCOPE_DESCRIPTIONS[scope]}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button
              onClick={onCreate}
              disabled={isPending || !name.trim() || selectedScopes.size === 0}
            >
              Create token
            </Button>
            {tokens.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => {
                  setShowCreate(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Button onClick={() => setShowCreate(true)}>New token</Button>
      )}

      {tokens.length > 0 && (
        <div className="space-y-2">
          {tokens.map((t) => (
            <div
              key={t.id}
              className={`rounded-lg border border-border p-3 ${t.revokedAt ? "opacity-50" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{t.name}</div>
                  <code className="text-xs font-mono text-muted-foreground">
                    {t.prefix}…
                  </code>
                </div>
                {!t.revokedAt && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => onRevoke(t.id)}
                  >
                    Revoke
                  </Button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {t.scopes.map((s) => (
                  <span
                    key={s}
                    className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono"
                  >
                    {s}
                  </span>
                ))}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Created {new Date(t.createdAt).toLocaleDateString()}
                {t.lastUsedAt
                  ? ` · last used ${new Date(t.lastUsedAt).toLocaleString()}`
                  : " · never used"}
                {t.revokedAt
                  ? ` · revoked ${new Date(t.revokedAt).toLocaleDateString()}`
                  : ""}
              </div>
              {!t.revokedAt && (
                <TokenPolicyEditor
                  tokenId={t.id}
                  initialPolicy={t.spendingPolicy}
                  hasPaymentMethod={hasPaymentMethod}
                  onChange={(policy) =>
                    setTokens((prev) =>
                      prev.map((row) =>
                        row.id === t.id
                          ? { ...row, spendingPolicy: policy }
                          : row
                      )
                    )
                  }
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
