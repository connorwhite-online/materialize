"use client";

import { useState } from "react";
import { useOrganization, useOrganizationList, useUser } from "@clerk/nextjs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

const PERSONAL_VALUE = "__personal__";

interface OwnerPickerProps {
  /**
   * Hidden input name; matches the server-action field. All three
   * create flows (file / project / collection) read `organizationId`,
   * so the default value is fine for all of them.
   */
  name?: string;
  /**
   * Form label. Hidden when the user has no orgs (the picker
   * collapses to a no-op hidden input in that case).
   */
  label?: string;
  /**
   * Optional fixed default. When omitted, the picker defaults to
   * whatever org the viewer has active in Clerk — so a user who
   * switched into an org via the nav automatically creates new
   * content under that org.
   */
  defaultOrgId?: string | null;
}

/**
 * "Create as …" picker that lets the user attribute a new file /
 * project / collection to their personal account OR to one of the
 * organizations they belong to. Renders nothing visible when the
 * viewer has no org memberships — the hidden input still emits an
 * empty string so the server action treats it as personal.
 *
 * The chosen value is round-tripped through Clerk's source of
 * truth: when a non-personal option is picked, we ask Clerk to
 * `setActive` on the matching membership so the rest of the app
 * (nav switcher, scoped queries, etc.) sees the change.
 *
 * The active-org sync is derived rather than effect-driven: when the
 * user hasn't touched the picker yet (override === null), the
 * displayed value tracks `organization` straight from Clerk's hook.
 * Once the user makes a manual selection we lock it in via the
 * `override` state so a downstream `setActive` doesn't fight a fresh
 * user choice on the next render.
 */
export function OwnerPicker({
  name = "organizationId",
  label = "Owner",
  defaultOrgId,
}: OwnerPickerProps) {
  const { user, isLoaded: userLoaded } = useUser();
  const { organization } = useOrganization();
  const { userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: false },
  });

  const memberships = userMemberships?.data ?? [];
  const [override, setOverride] = useState<string | null>(null);

  // Render-time resolution order:
  //   1. Manual selection wins (locks in once the user touches the
  //      picker; survives later changes to Clerk's active org).
  //   2. `defaultOrgId` if the caller supplied one.
  //   3. Whichever org is currently active in Clerk.
  //   4. Personal as the final fallback.
  const value =
    override ??
    (defaultOrgId !== undefined
      ? defaultOrgId ?? PERSONAL_VALUE
      : organization?.id ?? PERSONAL_VALUE);

  if (!userLoaded || !user) {
    // Auth still settling — render the hidden input only so the
    // form submission shape stays stable.
    return <input type="hidden" name={name} value="" />;
  }

  // No orgs: don't show the picker. Saves the user a click on the
  // 99% personal case while preserving the form contract.
  if (memberships.length === 0) {
    return <input type="hidden" name={name} value="" />;
  }

  const handleChange = (next: string | null) => {
    // Base UI's Select can emit null on clear; collapse to personal.
    const resolved = next ?? PERSONAL_VALUE;
    setOverride(resolved);
    // Best-effort sync with the rest of the chrome. We don't await
    // it — the form submission carries the value via the hidden
    // input regardless. Failures here just mean the nav switcher
    // doesn't follow, which is a non-blocking glitch.
    if (setActive) {
      const orgId = resolved === PERSONAL_VALUE ? null : resolved;
      void setActive({ organization: orgId });
    }
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Select value={value} onValueChange={handleChange}>
        <SelectTrigger id={name}>
          <SelectValue placeholder="Choose owner" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PERSONAL_VALUE}>
            {user.username
              ? `Personal — @${user.username}`
              : "Personal account"}
          </SelectItem>
          {memberships.map((m) => (
            <SelectItem
              key={m.organization.id}
              value={m.organization.id}
            >
              {m.organization.name}
              {m.organization.slug ? ` — @${m.organization.slug}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* Native input the surrounding <form> serializes. Select's
          state is local React state; the input is the wire. */}
      <input
        type="hidden"
        name={name}
        value={value === PERSONAL_VALUE ? "" : value}
      />
    </div>
  );
}
