"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  addProjectCollaborator,
  removeProjectCollaborator,
} from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/auth/user-avatar";

export interface CollaboratorRow {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface ProjectCollaboratorsProps {
  projectId: string;
  initial: CollaboratorRow[];
  /**
   * True when the viewer is the project owner or an org member of the
   * owning org. Gates the add input and "remove anyone" affordance.
   * Collaborators themselves can still remove THEMSELVES — that's
   * gated separately by the row's `you` flag below.
   */
  canManage: boolean;
  /**
   * Viewer's own user id when authed — drives the "Leave project"
   * affordance on the row that belongs to them.
   */
  viewerId: string | null;
}

/**
 * Sidebar widget on the project detail page that lists per-project
 * collaborators with avatars and (for the project owner) an add /
 * remove control. Read-only for non-managers; collaborators see a
 * "Leave" button on their own row.
 *
 * State is locally optimistic — the server action returns the new
 * row on add and a success flag on remove, so we splice the list in
 * place instead of full-page revalidating, which keeps the rest of
 * the page stable while the user invites teammates.
 */
export function ProjectCollaborators({
  projectId,
  initial,
  canManage,
  viewerId,
}: ProjectCollaboratorsProps) {
  const [collaborators, setCollaborators] = useState(initial);
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await addProjectCollaborator(projectId, username);
      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      if ("collaborator" in result && result.collaborator) {
        setCollaborators((prev) => [...prev, result.collaborator]);
        setUsername("");
      }
    });
  };

  const handleRemove = (collaboratorId: string) => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await removeProjectCollaborator(
        projectId,
        collaboratorId
      );
      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      setCollaborators((prev) =>
        prev.filter((c) => c.id !== collaboratorId)
      );
    });
  };

  // Hide the section entirely when there's nothing to show AND no add
  // control would render. Keeps the sidebar tidy on solo projects.
  if (!canManage && collaborators.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Collaborators</h3>
      {collaborators.length === 0 ? (
        <p className="text-xs text-muted-foreground">No collaborators yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {collaborators.map((c) => {
            const isYou = viewerId === c.id;
            const canRemoveThis = canManage || isYou;
            const profileHref = c.username ? `/${c.username}` : null;
            return (
              <li
                key={c.id}
                className="flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <UserAvatar
                    seed={c.username || c.id}
                    imageUrl={c.avatarUrl}
                    displayName={c.displayName || c.username}
                    className="h-6 w-6 text-xs"
                  />
                  <div className="min-w-0">
                    {profileHref ? (
                      <Link
                        href={profileHref}
                        className="truncate text-sm hover:underline"
                      >
                        {c.displayName || c.username || "Unnamed"}
                      </Link>
                    ) : (
                      <span className="truncate text-sm">
                        {c.displayName || "Unnamed"}
                      </span>
                    )}
                    {c.username && (
                      <p className="truncate text-xs text-muted-foreground">
                        @{c.username}
                      </p>
                    )}
                  </div>
                </div>
                {canRemoveThis && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={pending}
                    onClick={() => handleRemove(c.id)}
                    aria-label={
                      isYou
                        ? "Leave project"
                        : `Remove ${c.displayName || c.username}`
                    }
                  >
                    {isYou ? "Leave" : "Remove"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && (
        <form onSubmit={handleAdd} className="space-y-2 pt-1">
          <div className="flex gap-2">
            <Input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="@username"
              disabled={pending}
              className="h-8 text-sm"
              aria-label="Collaborator username"
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={pending || !username.trim()}
            >
              {pending ? "Adding…" : "Add"}
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </form>
      )}
    </div>
  );
}
