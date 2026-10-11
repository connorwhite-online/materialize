"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { BookmarkIcon, CheckIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  createCollectionWithItem,
  listSaveOptions,
  setCollectionSaved,
  type SaveOption,
} from "@/app/actions/collection-saves";
import type { SaveTarget } from "@/lib/collections/saved";

interface SaveToCollectionProps {
  target: SaveTarget;
  /** Whether the item already sits in one of the viewer's collections. */
  initiallySaved: boolean;
  /** Signed-out viewers get a sign-in link instead. */
  signedIn: boolean;
  /** Where sign-in should return to (this page). */
  returnTo: string;
}

/**
 * Save button for file and project pages: the way collections get
 * filled. Opens the viewer's collections with a check on each one that
 * holds this item, plus an inline field to start a new one, so the
 * first save is also how someone makes their first collection.
 */
export function SaveToCollection({
  target,
  initiallySaved,
  signedIn,
  returnTo,
}: SaveToCollectionProps) {
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const [options, setOptions] = useState<SaveOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, startCreate] = useTransition();
  const [, startToggle] = useTransition();

  // Before the list loads, trust the server's answer; after, the list is
  // the truth.
  const saved = options ? options.some((o) => o.saved) : initiallySaved;

  if (!signedIn) {
    return (
      <Button
        variant="outline"
        size="sm"
        render={
          <Link href={`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`} />
        }
      >
        <BookmarkIcon className="size-4" aria-hidden="true" />
        Save
      </Button>
    );
  }

  const load = async () => {
    setError(null);
    const res = await listSaveOptions(target);
    if ("error" in res) setError(res.error);
    else setOptions(res.collections);
  };

  const toggle = (option: SaveOption) => {
    const next = !option.saved;
    setBusyId(option.id);
    setError(null);
    startToggle(async () => {
      const res = await setCollectionSaved(option.id, target, next);
      if ("error" in res) setError(res.error);
      else
        setOptions((prev) =>
          prev?.map((o) => (o.id === option.id ? { ...o, saved: next } : o)) ??
          prev
        );
      setBusyId(null);
    });
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setError(null);
    startCreate(async () => {
      const res = await createCollectionWithItem(name, target);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setOptions((prev) => [res.collection, ...(prev ?? [])]);
      setNewName("");
    });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" aria-pressed={saved}>
            <BookmarkIcon
              className="size-4"
              aria-hidden="true"
              fill={saved ? "currentColor" : "none"}
            />
            {saved ? "Saved" : "Save"}
          </Button>
        }
      />
      {/* Focus the panel itself, not its first field: the list is still
          loading on open, so the default lands on the name input and
          pops the keyboard on phones. */}
      <PopoverContent
        ref={popupRef}
        initialFocus={popupRef}
        align="end"
        className="w-72 p-2"
      >
        <PopoverTitle className="px-2 pt-1 pb-2">Save to collection</PopoverTitle>

        {options === null && !error ? (
          <div className="flex justify-center py-4 text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" aria-label="Loading" />
          </div>
        ) : options && options.length > 0 ? (
          <ul className="max-h-64 overflow-y-auto">
            {options.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={o.saved}
                  disabled={busyId === o.id}
                  onClick={() => toggle(o)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  {busyId === o.id ? (
                    <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
                  ) : o.saved ? (
                    <CheckIcon className="size-4" aria-hidden="true" />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : options ? (
          <p className="px-2 pb-2 text-sm text-muted-foreground">
            No collections yet. Name one to start it with this.
          </p>
        ) : null}

        <form onSubmit={create} className="mt-1 flex gap-1.5 border-t border-border/60 px-1 pt-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New collection"
            aria-label="New collection name"
            maxLength={100}
            disabled={creating}
            className="h-8"
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={creating || !newName.trim()}
            aria-label="Create collection"
          >
            {creating ? (
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <PlusIcon className="size-4" aria-hidden="true" />
            )}
          </Button>
        </form>

        {error && (
          <p role="alert" className="px-2 pt-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
