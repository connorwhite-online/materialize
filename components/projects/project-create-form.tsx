"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  FormSection,
  LicenseField,
  PriceInput,
  SaleField,
  VisibilityField,
} from "@/components/upload/form-fields";
import { createProject } from "@/app/actions/projects";
import { OwnerPicker } from "@/components/orgs/owner-picker";
import { CategorySelect } from "@/components/categories/category-select";
import { DEFAULT_LICENSE, type LicenseId } from "@/lib/licenses";
import { FileCard } from "@/components/files/file-card";

interface OwnedFile {
  id: string;
  name: string;
  thumbnailUrl: string | null;
}

export function ProjectCreateForm({ ownedFiles }: { ownedFiles: OwnedFile[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [license, setLicense] = useState<LicenseId>(DEFAULT_LICENSE);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [sellEnabled, setSellEnabled] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const handleSubmit = (formData: FormData) => {
    for (const id of selected) formData.append("fileIds", id);
    formData.append("license", license);
    formData.set("category", category);
    formData.set("visibility", visibility);
    // Sale toggle only controls price — license is always submitted.
    if (!sellEnabled) {
      formData.set("price", "0");
    }
    startTransition(async () => {
      const result = await createProject(formData);
      if (result && "error" in result) {
        setErrors(result.error);
      }
    });
  };

  return (
    <form
      action={handleSubmit}
      className="flex w-full max-w-xl min-w-0 flex-col gap-10"
    >
      <FormSection title="Details">
        <FieldGroup className="max-w-none">
          <OwnerPicker label="Create as" />

          <Field label="Name" htmlFor="name" error={errors?.name?.[0]}>
            <Input
              id="name"
              name="name"
              required
              placeholder="Chess set"
              aria-invalid={errors?.name ? true : undefined}
            />
          </Field>
          <Field label="Description" htmlFor="description" optional>
            <Textarea
              id="description"
              name="description"
              rows={3}
              placeholder="A complete 32-piece chess set for printing."
            />
          </Field>
          <div className="grid min-w-0 gap-5 sm:grid-cols-2">
            <Field
              label="Category"
              htmlFor="project-category"
              hint="Where it shows up when people browse."
            >
              <CategorySelect
                id="project-category"
                value={category}
                onValueChange={setCategory}
              />
            </Field>
            <Field
              label="Tags"
              htmlFor="tags"
              optional
              hint="Comma separated. Helps search."
            >
              <Input id="tags" name="tags" placeholder="board game, chess" />
            </Field>
          </div>
          <Field
            label="Code repository"
            htmlFor="repoUrl"
            optional
            hint="Firmware or source for kits with electronics."
            error={errors?.repoUrl?.[0]}
          >
            <Input
              id="repoUrl"
              name="repoUrl"
              type="url"
              inputMode="url"
              placeholder="https://github.com/your/repo"
              aria-invalid={errors?.repoUrl ? true : undefined}
            />
          </Field>
        </FieldGroup>
      </FormSection>

      <FormSection title="Sharing">
        <FieldGroup className="max-w-none">
          <VisibilityField value={visibility} onChange={setVisibility} />
          <LicenseField
            id="license-trigger"
            value={license}
            onChange={setLicense}
          />
          <SaleField
            id="sell-toggle"
            enabled={sellEnabled}
            onEnabledChange={setSellEnabled}
            title="Sell this project"
            description="Buyers pay once for every file in it. Leave off to share it free."
          >
            <Field
              label="Price"
              htmlFor="price"
              hint="USD. Set 0 to make it free."
              className="max-w-[12rem]"
            >
              <PriceInput id="price" name="price" defaultValue="0" />
            </Field>
          </SaleField>
        </FieldGroup>
      </FormSection>

      <FormSection
        title="Files"
        description={
          ownedFiles.length === 0
            ? "Optional. Create the project now and add files to it later."
            : "Optional. Pick files from your library, or add them later."
        }
        action={
          ownedFiles.length > 0 ? (
            <span className="shrink-0 pt-0.5 text-[13px] text-muted-foreground tabular-nums">
              {selected.length} selected
            </span>
          ) : undefined
        }
      >
        {ownedFiles.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {ownedFiles.map((f) => (
              <FileCard
                key={f.id}
                title={f.name}
                thumbnailUrl={f.thumbnailUrl}
                placeholder="No preview"
                selected={selected.includes(f.id)}
                onClick={() => toggle(f.id)}
              />
            ))}
          </div>
        )}
        {errors?.fileIds && (
          <p
            role="alert"
            className="text-[13px] leading-[18px] text-destructive"
          >
            {errors.fileIds[0]}
          </p>
        )}
      </FormSection>

      <FormActions className="border-t border-border pt-5">
        <Button type="button" variant="secondary" render={<Link href="/" />}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          Create project
        </Button>
      </FormActions>
    </form>
  );
}
