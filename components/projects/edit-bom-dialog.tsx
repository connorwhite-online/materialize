"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BomEditor, type BomEditorItem } from "./bom-editor";

interface Props {
  projectId: string;
  initial: BomEditorItem[];
}

/**
 * Owner-only dialog wrapper around the BOM editor. Lives on the
 * project sidebar; opens to a 2xl panel that fits the row editor
 * comfortably without cramping. Closes on save.
 */
export function EditBomDialog({ projectId, initial }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" className="w-full">
            {initial.length > 0
              ? `Edit BOM (${initial.length})`
              : "Add a Bill of Materials"}
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bill of Materials</DialogTitle>
          <DialogDescription>
            List the additional parts a builder needs to complete this
            project — screws, electronics, magnets, anything beyond the
            printed parts. Casual creators can skip this entirely.
          </DialogDescription>
        </DialogHeader>
        <BomEditor
          projectId={projectId}
          initial={initial}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
