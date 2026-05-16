"use client";

import { useEffect, useState } from "react";
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
   * Optional fixed default. Defaults to the user's currently active
   * org if any — so a user who switched into an org via the nav
   * automatically creates new content under that org.
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
  // `defaultOrgId` wins; otherwise fall back to whatever org the
  // user has active. Both can be null / undefined, in which case we
  // default to personal.
  const initial =
    defaultOrgId !== undefined
      ? defaultOrgId
      : organization?.id ?? null;
  const [value, setValue] = useState<string>(initial ?? PERSONAL_VALUE);

  // If the user switches their active org elsewhere in the app
  // while this form is mounted, sync the local select state so the
  // visible owner matches the rest of the chrome.
  useEffect(() => {
    if (defaultOrgId !== undefined) return;
    setValue(organization?.id ?? PERSONAL_VALUE);
  }, [organization?.id, defaultOrgId]);

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
    setValue(resolved);
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
