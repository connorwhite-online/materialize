"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { OwnerPicker } from "@/components/orgs/owner-picker";
import { CategorySelect } from "@/components/categories/category-select";

/**
 * Page-level create form for a collection. Mirrors
 * {@link ProjectCreateForm}: a Card of fields, owner picker, and a
 * submit that lets `createCollection` redirect to the new row.
 */
export function CollectionCreateForm() {
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [category, setCategory] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (formData: FormData) => {
    formData.set("visibility", visibility);
    formData.set("category", category);
    startTransition(async () => {
      const result = await createCollection(formData);
      if (result && "error" in result) {
        setErrors(
          typeof result.error === "string"
            ? { name: [result.error] }
            : result.error
        );
      }
    });
  };

  return (
    <form action={handleSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Collection details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <OwnerPicker label="Create as" />

          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              required
              maxLength={100}
              placeholder="e.g. Desk accessories"
            />
            {errors?.name && (
              <p className="mt-1 text-xs text-destructive">{errors.name[0]}</p>
            )}
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              rows={3}
              maxLength={500}
              placeholder="Optional"
            />
            {errors?.description && (
              <p className="mt-1 text-xs text-destructive">
                {errors.description[0]}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="visibility-trigger">Visibility</Label>
            <Select
              value={visibility}
              onValueChange={(v) =>
                v && setVisibility(v as "public" | "private")
              }
            >
              <SelectTrigger id="visibility-trigger" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public</SelectItem>
                <SelectItem value="private">Private</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="collection-category">Category</Label>
            <CategorySelect
              id="collection-category"
              value={category}
              onValueChange={setCategory}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Pick the closest shelf so this shows up when people browse.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create collection"}
        </Button>
      </div>
    </form>
  );
}
