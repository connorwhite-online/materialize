"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  createCollection,
  toggleCollectionVisibility,
  deleteCollection,
} from "@/app/actions/collections";

interface Collection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: string;
  fileCount: number;
}

interface CollectionManagerProps {
  collections: Collection[];
}

export function CollectionManager({ collections }: CollectionManagerProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const formData = new FormData();
    formData.set("name", name);
    formData.set("description", description);
    formData.set("tags", tags);
    await createCollection(formData);
    setName("");
    setDescription("");
    setTags("");
    setCreating(false);
    setSubmitting(false);
  };

  const handleToggleVisibility = async (id: string) => {
    await toggleCollectionVisibility(id);
  };

  const handleDelete = async (id: string) => {
    await deleteCollection(id);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Collections</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCreating(!creating)}
        >
          {creating ? "Cancel" : "New Collection"}
        </Button>
      </div>

      {creating && (
        <Card>
          <CardContent className="p-4">
            <form onSubmit={handleCreate} className="space-y-3">
              <Input
                placeholder="Collection name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <Input
                placeholder="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <Input
                placeholder="Tags (comma separated)"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
              <Button type="submit" size="sm" disabled={submitting || !name}>
                {submitting ? "Creating..." : "Create"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {collections.length === 0 && !creating ? (
        <p className="text-sm text-muted-foreground">
          No collections yet. Group your files into collections to organize them.
        </p>
      ) : (
        <div className="space-y-2">
          {collections.map((col) => (
            <Card key={col.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{col.name}</span>
                    <Badge
                      variant={col.visibility === "public" ? "secondary" : "outline"}
                      className="text-[10px]"
                    >
                      {col.visibility}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {col.fileCount} {col.fileCount === 1 ? "file" : "files"}
                    </span>
                  </div>
                  {col.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {col.description}
                    </p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => handleToggleVisibility(col.id)}
                  >
                    {col.visibility === "public" ? "Hide" : "Show"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-destructive"
                    onClick={() => handleDelete(col.id)}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
