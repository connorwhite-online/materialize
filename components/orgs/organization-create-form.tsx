"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useOrganizationList } from "@clerk/nextjs";
import { ImagePlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  finishOrganizationCreate,
  suggestOrganizationSlug,
} from "@/app/actions/organizations";

/** Clerk's own cap on organization logos. */
export const MAX_LOGO_BYTES = 10 * 1024 * 1024;
const LOGO_TYPES = "image/jpeg,image/png,image/webp,image/gif";

/**
 * Page-level create form for an organization. Mirrors
 * {@link CollectionCreateForm} (a Card of fields, submit on the right)
 * instead of Clerk's prebuilt <CreateOrganization />, whose own chrome
 * didn't match anything else in the product. Clerk still does the
 * work: `createOrganization` generates the slug, the `organization.*`
 * webhook mirrors the row into our table, and the logo goes up through
 * `setLogo` once the org exists.
 */
export function OrganizationCreateForm() {
  const router = useRouter();
  const { isLoaded, createOrganization, setActive } = useOrganizationList();
  const fileRef = useRef<HTMLInputElement>(null);
  const [logo, setLogo] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Each preview URL is released when it's replaced or the form unmounts.
  useEffect(() => {
    if (!logo) return;
    return () => URL.revokeObjectURL(logo.url);
  }, [logo]);

  const pickLogo = (file: File) => {
    if (file.size > MAX_LOGO_BYTES) {
      setError("That image is over 10 MB. Pick a smaller one.");
      return;
    }
    setError(null);
    setLogo({ file, url: URL.createObjectURL(file) });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // onSubmit, not a form action: React resets a form's fields after
    // its action settles, which wiped the name on every error.
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
    if (!name) {
      setError("Give your organization a name.");
      return;
    }
    if (!isLoaded || !createOrganization) return;
    setError(null);
    startTransition(async () => {
      try {
        const suggested = await suggestOrganizationSlug(name);
        if ("error" in suggested) {
          setError(suggested.error);
          return;
        }
        const org = await createOrganization({ name, slug: suggested.slug }).catch(
          (err: unknown) => {
            // With organization slugs turned off in the Clerk dashboard
            // (the case in prod as of 2026-10), Clerk refuses any slug
            // and invents its own ("name-<19 digits>"). Fall back so
            // creation still works; the URL is clean once slugs are on.
            if (clerkErrorCode(err) !== "organization_slugs_disabled") throw err;
            return createOrganization({ name });
          }
        );
        if (logo) {
          // Best-effort: the org already exists, so a failed upload
          // shouldn't strand the user here. They can add it later from
          // the org's settings.
          // Upload an in-memory copy, not the picker's File: handed the
          // disk-backed File from the input, Clerk rejected it as
          // "'text/plain' images are not supported" (seen on a live
          // create against the dev instance; a copy uploads fine).
          const copy = new File([await logo.file.arrayBuffer()], logo.file.name, {
            type: logo.file.type,
          });
          await org.setLogo({ file: copy }).catch((e: unknown) => {
            console.warn("Organization logo upload failed", e);
          });
        }
        await setActive?.({ organization: org.id });
        // Mirror the row now rather than waiting on the webhook, so the
        // org's page exists when we land on it.
        const finished = await finishOrganizationCreate(org.id);
        router.push(`/${"slug" in finished ? finished.slug : org.slug}`);
      } catch (err) {
        setError(clerkErrorMessage(err));
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Organization details</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            {/* One keyboard stop for the logo: the Upload/Change button.
                The file input is hidden and the tile is a mouse-only
                shortcut to the same picker. */}
            <Label id="org-logo-label">Logo</Label>
            <div className="flex items-center gap-4">
              <input
                ref={fileRef}
                type="file"
                accept={LOGO_TYPES}
                hidden
                data-testid="org-logo-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) pickLogo(file);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={pending}
                tabIndex={-1}
                aria-hidden="true"
                className="group relative flex size-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl bg-muted text-muted-foreground transition-colors hover:text-foreground"
              >
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                  <img
                    src={logo.url}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <ImagePlusIcon className="size-6" aria-hidden="true" />
                )}
              </button>
              <div className="min-w-0 space-y-1">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                    disabled={pending}
                    aria-describedby="org-logo-label org-logo-hint"
                  >
                    {logo ? "Change logo" : "Upload logo"}
                  </Button>
                  {logo && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setLogo(null)}
                      disabled={pending}
                    >
                      Remove logo
                    </Button>
                  )}
                </div>
                <p id="org-logo-hint" className="text-xs text-muted-foreground">
                  Optional. Square works best, up to 10 MB.
                </p>
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="org-name">Name</Label>
            <Input
              id="org-name"
              name="name"
              required
              maxLength={100}
              autoComplete="organization"
              placeholder="e.g. Pneuma Robotics"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "org-error" : undefined}
            />
          </div>

          {error && (
            <p id="org-error" role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !isLoaded}>
          {pending ? "Creating…" : "Create organization"}
        </Button>
      </div>
    </form>
  );
}

function clerkErrorCode(err: unknown): string | undefined {
  return (err as { errors?: { code?: string }[] })?.errors?.[0]?.code;
}

/** Clerk API errors carry `errors[].longMessage`; anything else gets a generic line. */
export function clerkErrorMessage(err: unknown): string {
  const first = (err as { errors?: { longMessage?: string; message?: string }[] })
    ?.errors?.[0];
  return (
    first?.longMessage ??
    first?.message ??
    "Couldn't create the organization. Try again."
  );
}
