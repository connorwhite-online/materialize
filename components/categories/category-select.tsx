"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CATEGORIES, getCategoryLabel } from "@/lib/categories";

const NONE = "none";

interface CategorySelectProps {
  /** Current category slug, or "" for uncategorized. */
  value: string;
  /** Emits the slug, or "" when "Uncategorized" is picked. */
  onValueChange: (value: string) => void;
  /** Trigger id for the associated <Label htmlFor>. */
  id?: string;
}

/**
 * Shared category picker used by the file / project / collection
 * create + edit forms. Controlled — the parent owns the slug in state
 * and appends it to the FormData on submit (these forms build their
 * payload manually, the base-ui Select has no native form value).
 * Empty string is the "Uncategorized" sentinel, surfaced to the user
 * as the leading option.
 */
export function CategorySelect({ value, onValueChange, id }: CategorySelectProps) {
  return (
    <Select
      value={value || NONE}
      onValueChange={(v) => onValueChange(!v || v === NONE ? "" : String(v))}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue>
          {(v) =>
            !v || v === NONE
              ? "Uncategorized"
              : getCategoryLabel(String(v)) ?? "Uncategorized"
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Uncategorized</SelectItem>
        {CATEGORIES.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <div className="flex flex-col gap-0.5">
              <span>{c.label}</span>
              <span className="whitespace-normal text-[11px] leading-tight text-muted-foreground">
                {c.description}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
