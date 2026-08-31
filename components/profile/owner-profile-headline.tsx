"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserAvatar } from "@/components/auth/user-avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

const PLATFORMS = [
  { key: "website", placeholder: "yoursite.com" },
  { key: "twitter", placeholder: "username" },
  { key: "github", placeholder: "username" },
  { key: "instagram", placeholder: "username" },
  { key: "youtube", placeholder: "channel or @handle" },
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
  socialLinks: Array<{ platform: string; url: string }>;
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
  socialLinks,
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
    <div className="space-y-3">
      <div className="flex items-start gap-6">
        <div className="relative shrink-0">
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
            className="group relative cursor-pointer rounded-full"
          >
            <UserAvatar
              seed={username}
              imageUrl={shownAvatar}
              displayName={shownName}
              className="h-20 w-20 text-2xl"
            />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
              Change
            </span>
          </button>
        </div>

        <div className="min-w-0 flex-1 space-y-1">
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
              className="h-auto px-1 py-0.5 text-2xl font-bold"
              aria-label="Display name"
            />
          ) : (
            <h1 className="text-2xl font-bold">
              <button
                type="button"
                onClick={() => setEditing("name")}
                className={cn(
                  "block w-full cursor-text rounded-md px-1 py-0.5 text-left hover:bg-muted/50",
                  !displayName && "text-muted-foreground"
                )}
              >
                {displayName || "Add a display name"}
              </button>
            </h1>
          )}

          {editing === "username" ? (
            <div className="flex items-center gap-0.5 px-1">
              <span className="text-muted-foreground">@</span>
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
                className="h-auto px-1 py-0.5"
                aria-label="Username"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing("username")}
              className="block w-full cursor-text rounded-md px-1 py-0.5 text-left text-muted-foreground hover:bg-muted/50"
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
              placeholder="Tell others about yourself…"
              className="mt-2"
              aria-label="Bio"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing("bio")}
              className={cn(
                "mt-2 block w-full max-w-xl cursor-text rounded-md px-1 py-1 text-left text-sm leading-relaxed hover:bg-muted/50",
                bio ? "" : "text-muted-foreground"
              )}
            >
              {bio || "Add a bio"}
            </button>
          )}
        </div>
      </div>

      <SocialLinksEditor initial={socialLinks} />

      {error && <p className="pt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function SocialLinksEditor({
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
  const [, startTransition] = useTransition();

  const commit = (next: Record<string, string>) => {
    const links = PLATFORMS.filter((p) => next[p.key].trim()).map((p) => ({
      platform: p.key,
      url: normalizeUrl(p.key, next[p.key]),
    }));
    startTransition(async () => {
      await updateSocialLinks(JSON.stringify(links));
    });
  };

  return (
    <div className="max-w-md space-y-2">
      {PLATFORMS.map((p) => {
        const label = platformLabel(p.key);
        return (
          <div key={p.key} className="flex items-center gap-2">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground"
              title={label}
              aria-hidden="true"
            >
              <SocialPlatformIcon platform={p.key} size={16} />
            </span>
            <Input
              value={urls[p.key]}
              placeholder={p.placeholder}
              onChange={(e) =>
                setUrls((prev) => ({ ...prev, [p.key]: e.target.value }))
              }
              onBlur={() => commit(urls)}
              className="h-8"
              aria-label={label}
            />
          </div>
        );
      })}
    </div>
  );
}
