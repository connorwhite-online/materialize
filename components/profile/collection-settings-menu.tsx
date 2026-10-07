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
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontalIcon } from "lucide-react";
import {
  updateCollection,
  deleteCollection,
} from "@/app/actions/collections";

interface CollectionSettingsMenuProps {
  collectionId: string;
  name: string;
  description: string | null;
  visibility: "public" | "private";
}

type ActiveDialog = "edit" | "delete" | null;

export function CollectionSettingsMenu({
  collectionId,
  name,
  description,
  visibility,
}: CollectionSettingsMenuProps) {
  const router = useRouter();
  const [active, setActive] = useState<ActiveDialog>(null);

  const [editName, setEditName] = useState(name);
  const [editDescription, setEditDescription] = useState(description ?? "");
  const [editVisibility, setEditVisibility] =
    useState<"public" | "private">(visibility);
  const [editError, setEditError] = useState<string | null>(null);
  const [editPending, startEdit] = useTransition();

  const [confirmName, setConfirmName] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, startDelete] = useTransition();

  const resetEdit = () => {
    setEditName(name);
    setEditDescription(description ?? "");
    setEditVisibility(visibility);
    setEditError(null);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editPending) return;
    setEditError(null);
    const formData = new FormData();
    formData.set("name", editName);
    formData.set("description", editDescription);
    formData.set("visibility", editVisibility);
    startEdit(async () => {
      const result = await updateCollection(collectionId, formData);
      if ("error" in result && result.error) {
        const flat =
          typeof result.error === "string"
            ? result.error
            : Object.values(result.error).flat()[0] || "Failed to save";
        setEditError(String(flat));
        return;
      }
      setActive(null);
      router.refresh();
    });
  };

  const handleDeleteConfirm = () => {
    if (confirmName.trim() !== name || deletePending) return;
    setDeleteError(null);
    startDelete(async () => {
      const result = await deleteCollection(collectionId);
      if ("error" in result && result.error) {
        setDeleteError(result.error);
        return;
      }
      setActive(null);
      router.refresh();
    });
  };

  return (
    <>
      {/* One quiet overflow menu instead of an Edit + red Delete pair on
          every shelf header — the destructive action shouldn't sit one
          mis-tap away on a phone. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Collection options for ${name}`}
            >
              <MoreHorizontalIcon />
            </Button>
          }
        />
        <DropdownMenuContent align="end" sideOffset={6} className="min-w-40">
          <DropdownMenuItem
            onClick={() => {
              resetEdit();
              setActive("edit");
            }}
          >
            Edit collection
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              setConfirmName("");
              setDeleteError(null);
              setActive("delete");
            }}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={active === "edit"}
        onOpenChange={(next) => {
          if (!next) setActive(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit collection</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="flex flex-col gap-5">
            <FieldGroup className="max-w-none">
              <Field label="Name" htmlFor="collection-name">
                <Input
                  id="collection-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  maxLength={100}
                  autoFocus
                />
              </Field>
              <Field label="Description" htmlFor="collection-description" optional>
                <Textarea
                  id="collection-description"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={3}
                  maxLength={500}
                />
              </Field>
              <Field
                label="Visibility"
                hint={
                  editVisibility === "public"
                    ? "Shown on your public profile."
                    : "Only you can see it."
                }
              >
                <SegmentedControl
                  value={editVisibility}
                  onValueChange={(v) => setEditVisibility(v)}
                  listClassName="w-fit"
                  items={[
                    { value: "public", label: "Public" },
                    { value: "private", label: "Private" },
                  ]}
                />
              </Field>
            </FieldGroup>
            {editError && (
              <p className="text-sm text-destructive">{editError}</p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setActive(null)}
                disabled={editPending}
              >
                Cancel
              </Button>
              <Button type="submit" loading={editPending}>
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={active === "delete"}
        onOpenChange={(next) => {
          if (!next) setActive(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this collection?</DialogTitle>
            <DialogDescription>
              The files inside will be moved back to your library — only the
              collection itself is removed. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirm-collection-name" className="text-xs">
              Type{" "}
              <span className="font-mono font-medium text-foreground">
                {name}
              </span>{" "}
              to confirm
            </Label>
            <Input
              id="confirm-collection-name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setActive(null)}
              disabled={deletePending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={confirmName.trim() !== name}
              loading={deletePending}
            >
              Delete collection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
