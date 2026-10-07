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
import { Field } from "@/components/ui/field";
import { Plus } from "@/components/icons/plus";
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
          <Button variant="secondary" size="sm">
            <Plus size={14} />
            Wokwi link
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Embed a Wokwi simulation</DialogTitle>
          <DialogDescription>
            Paste the public URL of your Wokwi project. Builders will be able
            to interact with the simulation directly from this page.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <Field label="Project URL" htmlFor="wokwi-url">
            <Input
              id="wokwi-url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://wokwi.com/projects/123456789"
              autoFocus
            />
          </Field>
          <Field label="Caption" htmlFor="wokwi-caption" optional>
            <Input
              id="wokwi-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Main simulation"
            />
          </Field>
          {error && (
            <p role="alert" className="text-[13px] leading-[18px] text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={submit} loading={pending} disabled={!url.trim()}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
