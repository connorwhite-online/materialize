"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCollection } from "@/app/actions/collections";

interface NewCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Controlled "create a collection" dialog. Used by the library
 * AddMenu to pop open the form when the user picks "Collection"
 * from the + Add dropdown. The caller owns the open state.
 */
export function NewCollectionDialog({
  open,
  onOpenChange,
}: NewCollectionDialogProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setName("");
    setDescription("");
    setVisibility("public");
    setError(null);
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const formData = new FormData();
    formData.set("name", name);
    formData.set("description", description);
    formData.set("visibility", visibility);
    startTransition(async () => {
      const result = (await createCollection(formData)) as
        | { collectionId: string; slug: string }
        | { error: Record<string, string[]> | string }
        | undefined;
      if (result && "error" in result) {
        const flat =
          typeof result.error === "string"
            ? result.error
            : Object.values(result.error).flat()[0] || "Failed to create";
        setError(String(flat));
        return;
      }
      reset();
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New collection</DialogTitle>
          <DialogDescription>
            Group related files. You can add files to it from any of your
            uploads.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-collection-name" className="text-xs">
              Name
            </Label>
            <Input
              id="new-collection-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              autoFocus
              placeholder="e.g. Desk accessories"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-collection-description" className="text-xs">
              Description
            </Label>
            <Textarea
              id="new-collection-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-collection-visibility" className="text-xs">
              Visibility
            </Label>
            <Select
              value={visibility}
              onValueChange={(v) => setVisibility(v as "public" | "private")}
            >
              <SelectTrigger id="new-collection-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public</SelectItem>
                <SelectItem value="private">Private</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={close}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
