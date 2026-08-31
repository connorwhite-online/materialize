"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { updateProfile, updateSocialLinks } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CheckIcon, Trash2Icon } from "lucide-react";
import {
  SocialPlatformIcon,
  platformLabel,
  type SocialPlatform,
} from "@/components/profile/social-platforms";
import { AvatarUploader } from "./avatar-uploader";

// ─── Platform config ──────────────────────────────────────────────────────────

const PLATFORMS = [
  { key: "website" as const, placeholder: "yoursite.com" },
  { key: "twitter" as const, placeholder: "username or x.com/username" },
  { key: "github" as const, placeholder: "username or github.com/username" },
  {
    key: "instagram" as const,
    placeholder: "username or instagram.com/username",
  },
  { key: "youtube" as const, placeholder: "channel URL or @handle" },
] as const satisfies ReadonlyArray<{
  key: SocialPlatform;
  placeholder: string;
}>;

type PlatformKey = (typeof PLATFORMS)[number]["key"];

/** Normalize a raw input into a full https URL for a given platform. */
function normalizeUrl(platform: PlatformKey, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // Already a full URL
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  // Looks like a bare domain/path (has a dot) — just add https://
  if (trimmed.includes(".")) {
    return `https://${trimmed}`;
  }

  // Plain username/handle — expand to the platform URL
  const bases: Record<PlatformKey, string> = {
    website: "https://",
    twitter: "https://x.com/",
    github: "https://github.com/",
    instagram: "https://instagram.com/",
    youtube: "https://youtube.com/@",
  };
  return bases[platform] + trimmed;
}

// ─── Form types ───────────────────────────────────────────────────────────────

interface ProfileFormProps {
  initialData: {
    username: string;
    displayName: string;
    bio: string;
    avatarUrl: string | null;
    socialLinks: Array<{ platform: string; url: string }>;
  };
}

// ─── Per-row component ────────────────────────────────────────────────────────

function SocialLinkRow({
  platformKey,
  label,
  placeholder,
  value,
  savedValue,
  onChange,
  onSave,
  onClear,
  saving,
}: {
  platformKey: PlatformKey;
  label: string;
  placeholder: string;
  value: string;
  savedValue: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onClear: () => void;
  saving: boolean;
}) {
  const isDirty = value !== savedValue;
  const hasValue = value.trim().length > 0;

  return (
    <div className="flex items-center gap-2">
      {/* Platform icon badge */}
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground"
        title={label}
      >
        <SocialPlatformIcon platform={platformKey} size={20} />
      </div>

      {/* URL input */}
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1"
        aria-label={`${label} URL`}
      />

      {/* Save (check) — slides in when dirty; wrapper animates width so no layout snap */}
      <div
        className={[
          "overflow-hidden transition-[width,opacity] duration-200 ease-in-out",
          isDirty ? "w-8 opacity-100" : "w-0 opacity-0 pointer-events-none",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          aria-label={`Save ${label}`}
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-primary transition-colors hover:bg-primary/10"
        >
          <CheckIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Clear (trash) — slides in when a value exists */}
      <div
        className={[
          "overflow-hidden transition-[width,opacity] duration-200 ease-in-out",
          hasValue ? "w-8 opacity-100" : "w-0 opacity-0 pointer-events-none",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={onClear}
          aria-label={`Clear ${label}`}
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-destructive transition-colors hover:bg-destructive/10"
        >
          <Trash2Icon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Main form ────────────────────────────────────────────────────────────────

export function ProfileForm({ initialData }: ProfileFormProps) {
  const [profileState, profileAction, profilePending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      return updateProfile(formData);
    },
    null
  );

  // Build initial URL map from the stored links
  const buildInitialUrls = () => {
    const map: Record<string, string> = {};
    for (const p of PLATFORMS) map[p.key] = "";
    for (const link of initialData.socialLinks) {
      if (link.platform in map) map[link.platform] = link.url;
    }
    return map as Record<PlatformKey, string>;
  };

  const [urls, setUrls] = useState<Record<PlatformKey, string>>(buildInitialUrls);
  const [savedUrls, setSavedUrls] = useState<Record<PlatformKey, string>>(buildInitialUrls);
  const [savingKey, setSavingKey] = useState<PlatformKey | null>(null);

  const [, startTransition] = useTransition();

  const handleChange = (key: PlatformKey, raw: string) => {
    setUrls((prev) => ({ ...prev, [key]: raw }));
  };

  const commitSave = (key: PlatformKey, nextUrls: Record<PlatformKey, string>) => {
    setSavingKey(key);
    const normalized = { ...nextUrls, [key]: normalizeUrl(key, nextUrls[key]) };
    // Update local state to the normalized value immediately
    setUrls(normalized);
    setSavedUrls(normalized);

    const links = PLATFORMS
      .filter((p) => normalized[p.key].trim())
      .map((p) => ({ platform: p.key, url: normalized[p.key].trim() }));

    startTransition(async () => {
      await updateSocialLinks(JSON.stringify(links));
      setSavingKey(null);
    });
  };

  const handleSave = (key: PlatformKey) => {
    commitSave(key, urls);
  };

  const handleClear = (key: PlatformKey) => {
    const next = { ...urls, [key]: "" };
    setUrls(next);
    commitSave(key, next);
  };

  const profileErrors =
    profileState && "error" in profileState ? profileState.error : null;

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-1.5">
            <Label>Avatar</Label>
            <AvatarUploader
              seed={initialData.username || initialData.displayName || "user"}
              displayName={initialData.displayName}
              initialAvatarUrl={initialData.avatarUrl}
            />
          </div>

          <Separator />

          <form action={profileAction} className="space-y-4">
            <div>
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                defaultValue={initialData.username}
                required
              />
              {profileErrors?.username && (
                <p className="mt-1 text-xs text-destructive">
                  {profileErrors.username[0]}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                name="displayName"
                defaultValue={initialData.displayName}
              />
            </div>

            <div>
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                name="bio"
                rows={3}
                defaultValue={initialData.bio}
                placeholder="Tell others about yourself..."
              />
            </div>

            <Button type="submit" disabled={profilePending}>
              {profilePending ? "Saving..." : "Save Profile"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Social Links</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {PLATFORMS.map(({ key, placeholder }) => (
              <SocialLinkRow
                key={key}
                platformKey={key}
                label={platformLabel(key)}
                placeholder={placeholder}
                value={urls[key]}
                savedValue={savedUrls[key]}
                onChange={(v) => handleChange(key, v)}
                onSave={() => handleSave(key)}
                onClear={() => handleClear(key)}
                saving={savingKey === key}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
