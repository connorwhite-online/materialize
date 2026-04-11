"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { addFileToCollection, removeFileFromCollection } from "@/app/actions/collections";

interface Collection {
  id: string;
  name: string;
  containsFile: boolean;
}

interface AddToCollectionProps {
  fileId: string;
  collections: Collection[];
}

export function AddToCollection({ fileId, collections }: AddToCollectionProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [localState, setLocalState] = useState<Record<string, boolean>>(
    Object.fromEntries(collections.map((c) => [c.id, c.containsFile]))
  );

  const handleToggle = async (collectionId: string, currentlyIn: boolean) => {
    setLoading(collectionId);
    if (currentlyIn) {
      await removeFileFromCollection(collectionId, fileId);
      setLocalState((prev) => ({ ...prev, [collectionId]: false }));
    } else {
      await addFileToCollection(collectionId, fileId);
      setLocalState((prev) => ({ ...prev, [collectionId]: true }));
    }
    setLoading(null);
  };

  if (collections.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost" size="xs" />}
      >
        Add to collection
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add to Collection</DialogTitle>
        </DialogHeader>
        <div className="space-y-1 mt-2">
          {collections.map((col) => {
            const isIn = localState[col.id];
            return (
              <button
                key={col.id}
                onClick={() => handleToggle(col.id, isIn)}
                disabled={loading === col.id}
                className={`w-full flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                  isIn
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted"
                }`}
              >
                <span>{col.name}</span>
                <span className="text-xs">
                  {loading === col.id
                    ? "..."
                    : isIn
                      ? "Remove"
                      : "Add"}
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
