"use client";

import { useState } from "react";
import { useActionState } from "react";
import { updateProfile, updateSocialLinks } from "@/app/actions/profile";

interface ProfileFormProps {
  initialData: {
    username: string;
    displayName: string;
    bio: string;
    socialLinks: Array<{ platform: string; url: string }>;
  };
}

const PLATFORMS = [
  "website",
  "twitter",
  "github",
  "instagram",
  "youtube",
  "linkedin",
];

export function ProfileForm({ initialData }: ProfileFormProps) {
  const [profileState, profileAction, profilePending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      return updateProfile(formData);
    },
    null
  );

  const [socialLinks, setSocialLinks] = useState(initialData.socialLinks);
  const [savingLinks, setSavingLinks] = useState(false);

  const addLink = () => {
    if (socialLinks.length >= 6) return;
    setSocialLinks([...socialLinks, { platform: "website", url: "" }]);
  };

  const removeLink = (index: number) => {
    setSocialLinks(socialLinks.filter((_, i) => i !== index));
  };

  const updateLink = (
    index: number,
    field: "platform" | "url",
    value: string
  ) => {
    const updated = [...socialLinks];
    updated[index] = { ...updated[index], [field]: value };
    setSocialLinks(updated);
  };

  const saveSocialLinks = async () => {
    setSavingLinks(true);
    await updateSocialLinks(JSON.stringify(socialLinks));
    setSavingLinks(false);
  };

  const profileErrors =
    profileState && "error" in profileState ? profileState.error : null;

  return (
    <div className="space-y-8">
      <form action={profileAction} className="space-y-4">
        <div>
          <label htmlFor="username" className="block text-sm font-medium">
            Username
          </label>
          <input
            id="username"
            name="username"
            type="text"
            defaultValue={initialData.username}
            required
            className="mt-1 block w-full rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm"
          />
          {profileErrors?.username && (
            <p className="mt-1 text-xs text-red-500">
              {profileErrors.username[0]}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="displayName" className="block text-sm font-medium">
            Display Name
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            defaultValue={initialData.displayName}
            className="mt-1 block w-full rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="bio" className="block text-sm font-medium">
            Bio
          </label>
          <textarea
            id="bio"
            name="bio"
            rows={3}
            defaultValue={initialData.bio}
            className="mt-1 block w-full rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm"
            placeholder="Tell others about yourself..."
          />
        </div>

        <button
          type="submit"
          disabled={profilePending}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
        >
          {profilePending ? "Saving..." : "Save Profile"}
        </button>
      </form>

      <div className="border-t border-foreground/10 pt-6">
        <h2 className="text-lg font-semibold">Social Links</h2>
        <div className="mt-4 space-y-3">
          {socialLinks.map((link, index) => (
            <div key={index} className="flex gap-2">
              <select
                value={link.platform}
                onChange={(e) => updateLink(index, "platform", e.target.value)}
                className="rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm"
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <input
                type="url"
                value={link.url}
                onChange={(e) => updateLink(index, "url", e.target.value)}
                placeholder="https://..."
                className="flex-1 rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => removeLink(index)}
                className="rounded-md border border-foreground/20 px-3 py-2 text-sm hover:bg-foreground/5"
              >
                Remove
              </button>
            </div>
          ))}
          {socialLinks.length < 6 && (
            <button
              type="button"
              onClick={addLink}
              className="text-sm underline"
            >
              Add social link
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={saveSocialLinks}
          disabled={savingLinks}
          className="mt-4 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
        >
          {savingLinks ? "Saving..." : "Save Social Links"}
        </button>
      </div>
    </div>
  );
}
