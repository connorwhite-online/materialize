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
import { AvatarUploader } from "./avatar-uploader";

// ─── Platform icons ───────────────────────────────────────────────────────────

function WebsiteIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M21 12C21 16.9706 16.9706 21 12 21M21 12C21 7.02944 16.9706 3 12 3M21 12H3M12 21C7.02944 21 3 16.9706 3 12M12 21C9.79086 21 8 16.9706 8 12C8 7.02944 9.79086 3 12 3M12 21C14.2091 21 16 16.9706 16 12C16 7.02944 14.2091 3 12 3M3 12C3 7.02944 7.02944 3 12 3" stroke="currentColor" strokeWidth="2" strokeLinecap="square"/>
    </svg>
  );
}

function TwitterIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M17.4033 3.5H20.2852L13.989 10.701L21.396 20.5H15.5964L11.054 14.557L5.85637 20.5H2.97269L9.70709 12.7977L2.60156 3.5H8.54839L12.6544 8.93215L17.4033 3.5ZM16.3918 18.7738H17.9887L7.68067 5.13549H5.96702L16.3918 18.7738Z" fill="currentColor"/>
    </svg>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 1.95068C17.525 1.95068 22 6.42568 22 11.9507C21.9995 14.0459 21.3419 16.0883 20.1198 17.7902C18.8977 19.4922 17.1727 20.768 15.1875 21.4382C14.6875 21.5382 14.5 21.2257 14.5 20.9632C14.5 20.6257 14.5125 19.5507 14.5125 18.2132C14.5125 17.2757 14.2 16.6757 13.8375 16.3632C16.0625 16.1132 18.4 15.2632 18.4 11.4257C18.4 10.3257 18.0125 9.43818 17.375 8.73818C17.475 8.48818 17.825 7.46318 17.275 6.08818C17.275 6.08818 16.4375 5.81318 14.525 7.11318C13.725 6.88818 12.875 6.77568 12.025 6.77568C11.175 6.77568 10.325 6.88818 9.525 7.11318C7.6125 5.82568 6.775 6.08818 6.775 6.08818C6.225 7.46318 6.575 8.48818 6.675 8.73818C6.0375 9.43818 5.65 10.3382 5.65 11.4257C5.65 15.2507 7.975 16.1132 10.2 16.3632C9.9125 16.6132 9.65 17.0507 9.5625 17.7007C8.9875 17.9632 7.55 18.3882 6.65 16.8757C6.4625 16.5757 5.9 15.8382 5.1125 15.8507C4.275 15.8632 4.775 16.3257 5.125 16.5132C5.55 16.7507 6.0375 17.6382 6.15 17.9257C6.35 18.4882 7 19.5632 9.5125 19.1007C9.5125 19.9382 9.525 20.7257 9.525 20.9632C9.525 21.2257 9.3375 21.5257 8.8375 21.4382C6.8458 20.7752 5.11342 19.502 3.88611 17.799C2.65881 16.096 1.9989 14.0498 2 11.9507C2 6.42568 6.475 1.95068 12 1.95068Z" fill="currentColor"/>
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 4.21173C14.5365 4.21173 14.837 4.22123 15.8389 4.267C16.4411 4.27427 17.0377 4.38499 17.6024 4.59432C18.0151 4.74662 18.3884 4.9895 18.6949 5.30509C19.0105 5.61156 19.2534 5.98488 19.4057 6.39759C19.615 6.96235 19.7257 7.55888 19.733 8.16114C19.7788 9.16295 19.7883 9.4635 19.7883 12C19.7883 14.5365 19.7788 14.837 19.733 15.8389C19.7257 16.4411 19.615 17.0377 19.4057 17.6024C19.2476 18.0122 19.0055 18.3844 18.6949 18.6949C18.3844 19.0055 18.0122 19.2476 17.6024 19.4057C17.0377 19.615 16.4411 19.7257 15.8389 19.733C14.837 19.7788 14.5365 19.7883 12 19.7883C9.4635 19.7883 9.16295 19.7788 8.16114 19.733C7.55859 19.7258 6.96176 19.6151 6.39673 19.4057C5.98433 19.2533 5.61132 19.0104 5.30509 18.6949C4.9895 18.3884 4.74662 18.0151 4.59432 17.6024C4.38499 17.0377 4.27427 16.4411 4.267 15.8389C4.22123 14.837 4.21173 14.5365 4.21173 12C4.21173 9.4635 4.22123 9.16295 4.267 8.16114C4.27427 7.55888 4.38499 6.96235 4.59432 6.39759C4.74662 5.98488 4.9895 5.61156 5.30509 5.30509C5.61156 4.9895 5.98488 4.74662 6.39759 4.59432C6.96235 4.38499 7.55888 4.27427 8.16114 4.267C9.16295 4.22123 9.4635 4.21173 12 4.21173ZM12 2.5C9.42032 2.5 9.09645 2.51123 8.08341 2.557C7.29535 2.57272 6.51567 2.72194 5.7775 2.99832C5.1433 3.2371 4.56886 3.61141 4.09427 4.09514C3.61096 4.56956 3.23695 5.14369 2.99832 5.7775C2.72224 6.51572 2.57331 7.2954 2.55786 8.08341C2.51036 9.09645 2.5 9.42032 2.5 12C2.5 14.5797 2.51123 14.9035 2.557 15.9166C2.57272 16.7046 2.72194 17.4843 2.99832 18.2225C3.2371 18.8567 3.61141 19.4311 4.09514 19.9057C4.56956 20.389 5.14369 20.763 5.7775 21.0017C6.51572 21.2778 7.2954 21.4267 8.08341 21.4421C9.09645 21.4896 9.42032 21.5 12 21.5C14.5797 21.5 14.9035 21.4888 15.9166 21.443C16.7046 21.4273 17.4843 21.2781 18.2225 21.0017C18.8538 20.7576 19.4271 20.3843 19.9057 19.9057C20.3843 19.4271 20.7576 18.8538 21.0017 18.2225C21.2778 17.4843 21.4267 16.7046 21.4421 15.9166C21.4896 14.9035 21.5 14.5797 21.5 12C21.5 9.42032 21.4888 9.09645 21.443 8.08341C21.4273 7.29535 21.2781 6.51567 21.0017 5.7775C20.7629 5.1433 20.3886 4.56886 19.9049 4.09427C19.4304 3.61096 18.8563 3.23695 18.2225 2.99832C17.4843 2.72224 16.7046 2.57331 15.9166 2.55786C14.9035 2.51036 14.5797 2.5 12 2.5ZM12 7.12132C11.0351 7.12132 10.0918 7.40745 9.28955 7.94352C8.48725 8.4796 7.86194 9.24155 7.49269 10.133C7.12343 11.0245 7.02682 12.0054 7.21506 12.9518C7.40331 13.8982 7.86796 14.7675 8.55025 15.4497C9.23255 16.132 10.1018 16.5967 11.0482 16.7849C11.9946 16.9732 12.9755 16.8766 13.867 16.5073C14.7585 16.1381 15.5204 15.5127 16.0565 14.7105C16.5926 13.9082 16.8787 12.9649 16.8787 12C16.8787 10.7061 16.3647 9.46518 15.4497 8.55025C14.5348 7.63532 13.2939 7.12132 12 7.12132ZM12 15.167C11.3736 15.167 10.7613 14.9812 10.2405 14.6332C9.71973 14.2852 9.31382 13.7906 9.07412 13.2119C8.83442 12.6333 8.7717 11.9965 8.8939 11.3822C9.0161 10.7678 9.31772 10.2035 9.76063 9.76063C10.2035 9.31772 10.7678 9.0161 11.3822 8.8939C11.9965 8.7717 12.6333 8.83442 13.2119 9.07412C13.7906 9.31382 14.2852 9.71973 14.6332 10.2405C14.9812 10.7613 15.167 11.3736 15.167 12C15.167 12.8399 14.8333 13.6455 14.2394 14.2394C13.6455 14.8333 12.8399 15.167 12 15.167ZM17.0713 5.78873C16.8458 5.78873 16.6254 5.85559 16.4379 5.98085C16.2505 6.10612 16.1043 6.28416 16.0181 6.49247C15.9318 6.70078 15.9092 6.92999 15.9532 7.15113C15.9972 7.37227 16.1057 7.5754 16.2652 7.73483C16.4246 7.89426 16.6277 8.00284 16.8489 8.04682C17.07 8.09081 17.2992 8.06823 17.5075 7.98195C17.7158 7.89567 17.8939 7.74955 18.0191 7.56208C18.1444 7.37461 18.2113 7.1542 18.2113 6.92873C18.2113 6.62638 18.0912 6.33642 17.8774 6.12263C17.6636 5.90883 17.3736 5.78873 17.0713 5.78873Z" fill="currentColor"/>
    </svg>
  );
}

function YoutubeIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M20.2043 4.00776C21.1084 4.28763 21.8189 5.10925 22.0609 6.15475C22.4982 8.04786 22.5 12 22.5 12C22.5 12 22.5 15.9522 22.0609 17.8453C21.8189 18.8908 21.1084 19.7124 20.2043 19.9922C18.5673 20.5 12 20.5 12 20.5C12 20.5 5.43274 20.5 3.79568 19.9922C2.89159 19.7124 2.1811 18.8908 1.93908 17.8453C1.5 15.9522 1.5 12 1.5 12C1.5 12 1.5 8.04786 1.93908 6.15475C2.1811 5.10925 2.89159 4.28763 3.79568 4.00776C5.43274 3.5 12 3.5 12 3.5C12 3.5 18.5673 3.5 20.2043 4.00776ZM15.5134 12.0003L9.79785 15.2999V8.70065L15.5134 12.0003Z" fill="currentColor"/>
    </svg>
  );
}

// ─── Platform config ──────────────────────────────────────────────────────────

const PLATFORMS = [
  { key: "website" as const, label: "Website", placeholder: "yoursite.com", Icon: WebsiteIcon },
  { key: "twitter" as const, label: "X / Twitter", placeholder: "username or x.com/username", Icon: TwitterIcon },
  { key: "github" as const, label: "GitHub", placeholder: "username or github.com/username", Icon: GithubIcon },
  { key: "instagram" as const, label: "Instagram", placeholder: "username or instagram.com/username", Icon: InstagramIcon },
  { key: "youtube" as const, label: "YouTube", placeholder: "channel URL or @handle", Icon: YoutubeIcon },
];

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
  Icon,
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
  Icon: React.ComponentType<{ className?: string }>;
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
        <Icon className="h-5 w-5" />
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
            {PLATFORMS.map(({ key, label, placeholder, Icon }) => (
              <SocialLinkRow
                key={key}
                platformKey={key}
                label={label}
                placeholder={placeholder}
                Icon={Icon}
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
