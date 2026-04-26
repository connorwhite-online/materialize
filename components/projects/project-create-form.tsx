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
import { Switch } from "@/components/ui/switch";
import { createProject } from "@/app/actions/projects";

interface OwnedFile {
  id: string;
  name: string;
  thumbnailUrl: string | null;
}

export function ProjectCreateForm({
  ownedFiles,
}: {
  ownedFiles: OwnedFile[];
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [license, setLicense] = useState("free");
  const [sellEnabled, setSellEnabled] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const handleSubmit = (formData: FormData) => {
    if (selected.length === 0) {
      setErrors({ fileIds: ["Pick at least one file."] });
      return;
    }
    for (const id of selected) formData.append("fileIds", id);
    formData.append("license", license);
    startTransition(async () => {
      const result = await createProject(formData);
      if (result && "error" in result) {
        setErrors(result.error);
      }
    });
  };

  return (
    <form action={handleSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required placeholder="Chess Set" />
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
              placeholder="A complete 32-piece chess set for printing."
            />
          </div>
          <div>
            <Label htmlFor="tags">Tags</Label>
            <Input id="tags" name="tags" placeholder="board game, chess" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">List for sale</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Make this project available to purchase publicly.
              </p>
            </div>
            <Switch checked={sellEnabled} onCheckedChange={setSellEnabled} />
          </div>
        </CardHeader>
        {sellEnabled && (
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="price">Price (USD)</Label>
                <Input
                  id="price"
                  name="price"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                />
              </div>
              <div>
                <Label htmlFor="license-trigger">License</Label>
                <Select
                  value={license}
                  onValueChange={(v) => v && setLicense(v)}
                >
                  <SelectTrigger id="license-trigger" className="w-full">
                    <SelectValue>
                      {(value) => {
                        if (value === "personal") return "Personal Use";
                        if (value === "commercial") return "Commercial Use";
                        return "Free";
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="personal">Personal Use</SelectItem>
                    <SelectItem value="commercial">Commercial Use</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Pick files for this project
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {selected.length} selected
          </p>
        </CardHeader>
        <CardContent>
          {ownedFiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You don&apos;t have any files yet. Upload one first.
            </p>
          ) : (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
              {ownedFiles.map((f) => {
                const isSelected = selected.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggle(f.id)}
                    className={`relative aspect-square overflow-hidden rounded-lg border text-left transition-colors ${
                      isSelected
                        ? "border-primary ring-2 ring-primary/40"
                        : "border-border hover:border-primary/30"
                    }`}
                  >
                    {f.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={f.thumbnailUrl}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-muted flex items-center justify-center text-xs text-muted-foreground/60">
                        No preview
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-xs text-white">
                      {f.name}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {errors?.fileIds && (
            <p className="mt-2 text-xs text-destructive">
              {errors.fileIds[0]}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create project"}
        </Button>
      </div>
    </form>
  );
}
