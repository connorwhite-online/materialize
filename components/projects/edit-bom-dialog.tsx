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
  /**
   * Optional custom trigger element. Lets the call site swap in a
   * compact button or any other shape; defaults to a full-width
   * outline button labeled "Edit BOM" / "Add a Bill of Materials".
   */
  trigger?: React.ReactNode;
}

/**
 * Owner-only dialog wrapper around the BOM editor. Lives on the
 * project's BOM tab; opens to a 2xl panel that fits the row editor
 * comfortably without cramping. Closes on save.
 */
export function EditBomDialog({ projectId, initial, trigger }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ? (
            (trigger as React.ReactElement)
          ) : (
            <Button variant="outline" className="w-full">
              {initial.length > 0
                ? `Edit BOM (${initial.length})`
                : "Add a Bill of Materials"}
            </Button>
          )
        }
      />
      <DialogContent className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-border pb-4">
          <DialogTitle>Bill of Materials</DialogTitle>
          <DialogDescription>
            List the additional parts a builder needs to complete this
            project — screws, electronics, magnets, anything beyond the
            printed parts.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto pt-4">
          <BomEditor
            projectId={projectId}
            initial={initial}
            onSaved={() => setOpen(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
