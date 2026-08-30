"use client";

import { useState } from "react";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UploadDialog } from "@/components/upload/upload-dialog";

interface LibraryAddMenuProps {
  /**
   * False when the user has zero owned files — projects are
   * bundles of existing files, so the entry point doesn't make
   * sense before the first upload. Mirrors the same gate the
   * separate buttons used to apply.
   */
  canAddProject: boolean;
}

/**
 * Single "+ Add" trigger for the profile library that replaces the
 * old [New collection] [New project] [Upload file] cluster. Clicking
 * the button opens a small menu with File / Project / Collection;
 * File opens the upload dialog, Project and Collection navigate to
 * their create pages.
 */
export function LibraryAddMenu({ canAddProject }: LibraryAddMenuProps) {
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm">
              <PlusIcon className="size-4" />
              Add
            </Button>
          }
        />
        <DropdownMenuContent align="end" sideOffset={6} className="min-w-40 p-1.5">
          <DropdownMenuItem
            className="px-3 py-2 text-sm"
            onClick={() => setUploadOpen(true)}
          >
            File
          </DropdownMenuItem>
          {canAddProject && (
            <DropdownMenuItem
              render={<Link href="/projects/new" />}
              className="px-3 py-2 text-sm"
            >
              Project
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            render={<Link href="/collections/new" />}
            className="px-3 py-2 text-sm"
          >
            Collection
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </>
  );
}
