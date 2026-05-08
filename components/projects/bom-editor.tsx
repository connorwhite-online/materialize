"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash } from "@/components/icons/trash";
import { replaceProjectBom } from "@/app/actions/bom";
import {
  MAX_BOM_ITEMS,
  MAX_BOM_NAME_LENGTH,
  MAX_BOM_UNIT_LENGTH,
  MAX_BOM_NOTES_LENGTH,
  MAX_BOM_URL_LENGTH,
} from "@/lib/validations/bom";

export type BomEditorItem = {
  name: string;
  quantity: string; // raw string while editing; coerced server-side
  unit: string;
  notes: string;
  sourceUrl: string;
};

interface Props {
  projectId: string;
  initial: BomEditorItem[];
  /** Called after a successful save (e.g. to close the dialog). */
  onSaved?: () => void;
}

const emptyRow = (): BomEditorItem => ({
  name: "",
  quantity: "1",
  unit: "",
  notes: "",
  sourceUrl: "",
});

/**
 * In-place BOM editor. Up/down arrow controls instead of drag-and-drop
 * — zero deps, fully accessible, works fine for the 50-item ceiling.
 * Save is bulk-replace (matches the server action) so partial saves
 * aren't a thing; the user either commits the whole list or none of it.
 */
export function BomEditor({ projectId, initial, onSaved }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<BomEditorItem[]>(
    initial.length > 0 ? initial : []
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const addRow = () => {
    if (items.length >= MAX_BOM_ITEMS) {
      setError(`Up to ${MAX_BOM_ITEMS} items.`);
      return;
    }
    setItems((prev) => [...prev, emptyRow()]);
  };

  const updateRow = (i: number, patch: Partial<BomEditorItem>) => {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  };

  const removeRow = (i: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  };

  const move = (i: number, delta: -1 | 1) => {
    setItems((prev) => {
      const j = i + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const save = () => {
    if (pending) return;
    setError(null);
    // Strip empty rows (all-blank trailing rows shouldn't block save).
    const trimmed = items.filter(
      (it) =>
        it.name.trim().length > 0 ||
        it.notes.trim().length > 0 ||
        it.sourceUrl.trim().length > 0
    );
    const payload = trimmed.map((it) => ({
      name: it.name.trim(),
      quantity: Number(it.quantity || 0),
      unit: it.unit.trim(),
      notes: it.notes.trim(),
      sourceUrl: it.sourceUrl.trim(),
    }));

    startTransition(async () => {
      const res = await replaceProjectBom(projectId, payload);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      router.refresh();
      onSaved?.();
    });
  };

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-3 text-center text-sm text-muted-foreground">
          No items yet. Add one to start a Bill of Materials.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-3 space-y-2"
            >
              <div className="grid gap-2 sm:grid-cols-[1fr_5rem_4rem]">
                <Input
                  placeholder="Part name (e.g. M3x10 socket head screw)"
                  value={item.name}
                  maxLength={MAX_BOM_NAME_LENGTH}
                  onChange={(e) => updateRow(i, { name: e.target.value })}
                />
                <Input
                  placeholder="Qty"
                  inputMode="decimal"
                  value={item.quantity}
                  onChange={(e) => updateRow(i, { quantity: e.target.value })}
                />
                <Input
                  placeholder="Unit"
                  value={item.unit}
                  maxLength={MAX_BOM_UNIT_LENGTH}
                  onChange={(e) => updateRow(i, { unit: e.target.value })}
                />
              </div>
              <Input
                placeholder="Notes (optional)"
                value={item.notes}
                maxLength={MAX_BOM_NOTES_LENGTH}
                onChange={(e) => updateRow(i, { notes: e.target.value })}
              />
              <Input
                placeholder="https://… (where to buy, optional)"
                value={item.sourceUrl}
                maxLength={MAX_BOM_URL_LENGTH}
                onChange={(e) => updateRow(i, { sourceUrl: e.target.value })}
              />
              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label="Move up"
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => move(i, 1)}
                    disabled={i === items.length - 1}
                    aria-label="Move down"
                  >
                    ↓
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => removeRow(i)}
                  className="text-destructive hover:text-destructive"
                  aria-label="Remove row"
                >
                  <Trash className="size-3.5" />
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={addRow}
          disabled={items.length >= MAX_BOM_ITEMS}
        >
          + Add item
        </Button>
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save BOM"}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
