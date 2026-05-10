"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addProjectCircuitWokwi } from "@/app/actions/circuits";

interface Props {
  projectId: string;
}

/**
 * Owner-only "+ Wokwi link" action that adds a Wokwi project URL as
 * a circuit tile. No upload — Wokwi sketches live on wokwi.com and
 * embed there; we just stash the canonical URL and let the lightbox
 * iframe it on demand.
 */
export function AddWokwiDialog({ projectId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await addProjectCircuitWokwi({
        projectId,
        url,
        caption: caption || undefined,
      });
      if ("error" in res) {
        setError(res.error ?? "Couldn't add link.");
        return;
      }
      setUrl("");
      setCaption("");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            + Wokwi link
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Embed a Wokwi simulation</DialogTitle>
          <DialogDescription>
            Paste the public URL of your Wokwi project. Builders will be able
            to interact with the simulation directly from this page.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="wokwi-url">Project URL</Label>
            <Input
              id="wokwi-url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://wokwi.com/projects/123456789"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="wokwi-caption">Caption (optional)</Label>
            <Input
              id="wokwi-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Main simulation"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !url.trim()}>
            {pending ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
