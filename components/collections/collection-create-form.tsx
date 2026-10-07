"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { VisibilityField } from "@/components/upload/form-fields";
import { createCollection } from "@/app/actions/collections";
import { OwnerPicker } from "@/components/orgs/owner-picker";
import { CategorySelect } from "@/components/categories/category-select";

/**
 * Page-level create form for a collection. Mirrors
 * {@link ProjectCreateForm}: one column of fields, owner picker, and a
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
            : result.error,
        );
      }
    });
  };

  return (
    <form action={handleSubmit} className="flex min-w-0 flex-col gap-8">
      <FieldGroup className="max-w-xl">
        <OwnerPicker label="Create as" />

        <Field label="Name" htmlFor="name" error={errors?.name?.[0]}>
          <Input
            id="name"
            name="name"
            required
            maxLength={100}
            placeholder="Desk accessories"
            aria-invalid={errors?.name ? true : undefined}
          />
        </Field>
        <Field
          label="Description"
          htmlFor="description"
          optional
          error={errors?.description?.[0]}
        >
          <Textarea
            id="description"
            name="description"
            rows={3}
            maxLength={500}
            placeholder="What ties these files together."
          />
        </Field>
        <Field
          label="Category"
          htmlFor="collection-category"
          hint="Where it shows up when people browse."
        >
          <CategorySelect
            id="collection-category"
            value={category}
            onValueChange={setCategory}
          />
        </Field>
        <VisibilityField value={visibility} onChange={setVisibility} />
      </FieldGroup>

      <FormActions className="max-w-xl border-t border-border pt-5">
        <Button type="button" variant="secondary" render={<Link href="/" />}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          Create collection
        </Button>
      </FormActions>
    </form>
  );
}
