"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserAvatar } from "@/components/auth/user-avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SettingsGroup, SettingsRow } from "@/components/ui/field";
import {
  updateAvatar,
  updateProfile,
  updateSocialLinks,
} from "@/app/actions/profile";
import {
  SocialPlatformIcon,
  platformLabel,
  type SocialPlatform,
} from "@/components/profile/social-platforms";
import { cn } from "@/lib/utils";
import { CameraIcon } from "lucide-react";

const PLATFORMS = [
  { key: "website", placeholder: "yoursite.com" },
  { key: "twitter", placeholder: "username" },
  { key: "github", placeholder: "username" },
  { key: "instagram", placeholder: "username" },
  { key: "youtube", placeholder: "@handle" },
] as const satisfies ReadonlyArray<{
  key: SocialPlatform;
  placeholder: string;
}>;

type PlatformKey = (typeof PLATFORMS)[number]["key"];

function normalizeUrl(platform: PlatformKey, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (trimmed.includes(".")) return `https://${trimmed}`;
  const bases: Record<PlatformKey, string> = {
    website: "https://",
    twitter: "https://x.com/",
    github: "https://github.com/",
    instagram: "https://instagram.com/",
    youtube: "https://youtube.com/@",
  };
  return bases[platform] + trimmed;
}

interface OwnerProfileHeadlineProps {
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
}

/**
 * Own-profile headline as tappable fields. Looks like the public
 * profile until you click a piece — then it becomes the editor.
 *
 * Social rows sit below the avatar + identity row so they flush to
 * the page's left edge on mobile (not indented under the name column).
 */
export function OwnerProfileHeadline({
  username: initialUsername,
  displayName: initialDisplayName,
  bio: initialBio,
  avatarUrl: initialAvatarUrl,
}: OwnerProfileHeadlineProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState(initialUsername);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [bio, setBio] = useState(initialBio);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState<
    "name" | "username" | "bio" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const shownAvatar = previewUrl ?? avatarUrl;
  const shownName = displayName || username;

  const saveProfile = (
    next: { username?: string; displayName?: string; bio?: string }
  ) => {
    const nextUsername = (next.username ?? username).trim();
    const nextDisplayName = next.displayName ?? displayName;
    const nextBio = next.bio ?? bio;
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("username", nextUsername);
      formData.set("displayName", nextDisplayName);
      formData.set("bio", nextBio);
      const result = await updateProfile(formData);
      if (result && "error" in result) {
        const err = result.error;
        const msg =
          err?.username?.[0] ||
          err?.displayName?.[0] ||
          err?.bio?.[0] ||
          "Couldn't save";
        setError(msg);
        return;
      }
      if (result && "username" in result && result.username !== username) {
        router.push(`/${result.username}`);
        return;
      }
      router.refresh();
    });
  };

  const handleAvatar = (file: File) => {
    setError(null);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    const formData = new FormData();
    formData.set("avatar", file);
    startTransition(async () => {
      const result = await updateAvatar(formData);
      URL.revokeObjectURL(objectUrl);
      setPreviewUrl(null);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setAvatarUrl(result.avatarUrl);
    });
  };

  return (
    <header className="flex items-center gap-4 sm:gap-6">
      <div className="relative w-fit shrink-0">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleAvatar(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={pending}
          aria-label="Change photo"
          className="group relative block cursor-pointer rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          <UserAvatar
            seed={username}
            imageUrl={shownAvatar}
            displayName={shownName}
            className="size-16 text-2xl sm:size-20"
          />
          {/* Always-visible camera chip: the old hover-only "Change"
              overlay never showed on touch, so phones had no hint the
              photo was editable. */}
          <span
            aria-hidden="true"
            className="absolute right-0 bottom-0 flex size-7 items-center justify-center rounded-full bg-background text-foreground ring-1 ring-border transition-colors group-hover:bg-muted"
          >
            <CameraIcon className="size-3.5" strokeWidth={2} />
          </span>
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {editing === "name" ? (
          <Input
            autoFocus
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={() => {
              setEditing(null);
              if (displayName !== initialDisplayName) {
                saveProfile({ displayName });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setDisplayName(initialDisplayName);
                setEditing(null);
              }
            }}
            className="-ml-2 h-9 max-w-sm px-2 text-2xl leading-7 font-semibold md:text-2xl"
            aria-label="Display name"
          />
        ) : (
          <h1 className="text-2xl leading-7 font-semibold">
            <button
              type="button"
              onClick={() => setEditing("name")}
              title="Edit name"
              className={cn(
                EDITABLE,
                "truncate py-1",
                !displayName && "text-subtle-foreground"
              )}
            >
              {displayName || "Add your name"}
            </button>
          </h1>
        )}

        {editing === "username" ? (
          <div className="-ml-2 flex w-full max-w-xs items-center rounded-[10px]">
            <Input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onBlur={() => {
                setEditing(null);
                if (username !== initialUsername) {
                  saveProfile({ username });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setUsername(initialUsername);
                  setEditing(null);
                }
              }}
              className="h-8 px-2"
              aria-label="Username"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing("username")}
            title="Edit username"
            className={cn(EDITABLE, "truncate text-sm text-muted-foreground")}
          >
            @{username}
          </button>
        )}

        {editing === "bio" ? (
          <Textarea
            autoFocus
            value={bio}
            rows={3}
            onChange={(e) => setBio(e.target.value)}
            onBlur={() => {
              setEditing(null);
              if (bio !== initialBio) saveProfile({ bio });
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setBio(initialBio);
                setEditing(null);
              }
            }}
            placeholder="A line about what you make"
            className="-ml-2 mt-2 max-w-xl"
            aria-label="Bio"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing("bio")}
            title="Edit bio"
            className={cn(
              EDITABLE,
              "mt-2 max-w-xl text-sm leading-5 text-pretty",
              bio ? "" : "text-subtle-foreground"
            )}
          >
            {bio || "Add a bio"}
          </button>
        )}

        {error && (
          <p role="alert" className="mt-2 text-[13px] leading-[18px] text-destructive">
            {error}
          </p>
        )}
      </div>
    </header>
  );
}

/**
 * Tap-to-edit text: reads as plain profile text, gains a soft fill on
 * hover so it's discoverable without drawing input boxes around
 * everything. Negative margin keeps the text flush with the column.
 */
const EDITABLE =
  "-ml-2 block w-fit max-w-[calc(100%+0.5rem)] cursor-text rounded-lg px-2 py-0.5 text-left transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/**
 * Profile links as settings rows: platform on the left, handle field on
 * the right, saved on blur. Lives in the Settings tab (not under the
 * headline) so the header reads as a profile, not a form.
 */
export function SocialLinksEditor({
  initial,
}: {
  initial: Array<{ platform: string; url: string }>;
}) {
  const [urls, setUrls] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const p of PLATFORMS) map[p.key] = "";
    for (const link of initial) {
      if (link.platform in map) map[link.platform] = link.url;
    }
    return map;
  });
  const lastSaved = useRef(JSON.stringify(urls));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [, startTransition] = useTransition();

  const commit = (next: Record<string, string>) => {
    const snapshot = JSON.stringify(next);
    // Blur without a change shouldn't round-trip (or flash "Saved").
    if (snapshot === lastSaved.current) return;
    const links = PLATFORMS.filter((p) => next[p.key].trim()).map((p) => ({
      platform: p.key,
      url: normalizeUrl(p.key, next[p.key]),
    }));
    setStatus("saving");
    startTransition(async () => {
      try {
        const result: unknown = await updateSocialLinks(JSON.stringify(links));
        if (result && typeof result === "object" && "error" in result) {
          setStatus("error");
          return;
        }
      } catch {
        setStatus("error");
        return;
      }
      lastSaved.current = snapshot;
      setStatus("saved");
    });
  };

  return (
    <SettingsGroup
      title={
        <span className="flex items-baseline justify-between gap-3">
          Links
          <span
            aria-live="polite"
            className={cn(
              "text-xs font-normal",
              status === "error" ? "text-destructive" : "text-subtle-foreground"
            )}
          >
            {status === "saving"
              ? "Saving…"
              : status === "saved"
                ? "Saved"
                : status === "error"
                  ? "Couldn't save"
                  : null}
          </span>
        </span>
      }
      description="Shown on your public profile."
    >
      {PLATFORMS.map((p) => {
        const label = platformLabel(p.key);
        const id = `social-${p.key}`;
        return (
          <SettingsRow
            key={p.key}
            htmlFor={id}
            title={
              <span className="flex items-center gap-2.5">
                <SocialPlatformIcon
                  platform={p.key}
                  size={16}
                  className="shrink-0 text-muted-foreground"
                />
                {label}
              </span>
            }
            control={
              <Input
                id={id}
                value={urls[p.key]}
                placeholder={p.placeholder}
                onChange={(e) =>
                  setUrls((prev) => ({ ...prev, [p.key]: e.target.value }))
                }
                onBlur={() => commit(urls)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="w-44 sm:w-64"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
              />
            }
          />
        );
      })}
    </SettingsGroup>
  );
}
