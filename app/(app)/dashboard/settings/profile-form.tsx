"use client";

import { useState } from "react";
import { useActionState } from "react";
import { updateProfile, updateSocialLinks } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent>
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
          <div className="space-y-3">
            {socialLinks.map((link, index) => (
              <div key={index} className="flex gap-2">
                <select
                  value={link.platform}
                  onChange={(e) => updateLink(index, "platform", e.target.value)}
                  className="flex h-9 rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs focus:border-ring focus:ring-2 focus:ring-ring/50"
                >
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <Input
                  type="url"
                  value={link.url}
                  onChange={(e) => updateLink(index, "url", e.target.value)}
                  placeholder="https://..."
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removeLink(index)}
                >
                  Remove
                </Button>
              </div>
            ))}
            {socialLinks.length < 6 && (
              <Button type="button" variant="link" size="sm" onClick={addLink} className="px-0">
                Add social link
              </Button>
            )}
          </div>

          <Separator className="my-4" />

          <Button onClick={saveSocialLinks} disabled={savingLinks}>
            {savingLinks ? "Saving..." : "Save Social Links"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
