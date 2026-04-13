"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "@/components/icons/chevron-right";
import { FileUploader } from "@/components/upload/file-uploader";
import { FileMetadataForm } from "@/components/upload/file-metadata-form";
import { SearchResultsPanel } from "./search-results-panel";
import type { SearchResponse } from "@/app/api/search/route";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Mode = "idle" | "searching" | "uploading";
type PickedFile = {
  file: File;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
};

export function HomeBottomBar() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(
    null
  );
  const [searchLoading, setSearchLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isExpanded = mode === "searching" || mode === "uploading";

  // Debounced search fetch. Clears results when the query empties
  // so the panel collapses back to the upload-or-idle layout.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    const controller = new AbortController();
    const id = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error(`search failed ${res.status}`);
        const data = (await res.json()) as SearchResponse;
        setSearchResults(data);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.warn("[search] fetch failed", err);
          setSearchResults({ files: [], users: [], materials: [] });
        }
      } finally {
        setSearchLoading(false);
      }
    }, 180);

    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [query]);

  // Close on outside click
  useEffect(() => {
    if (!isExpanded) return;

    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        if (mode === "uploading") setMode("idle");
        else {
          setMode("idle");
          setQuery("");
        }
      }
    };

    // Small delay so the initial click doesn't fire this
    const id = setTimeout(() => {
      document.addEventListener("pointerdown", handleClick);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("pointerdown", handleClick);
    };
  }, [isExpanded, mode]);

  const handleSearchFocus = () => {
    if (mode === "uploading") setMode("searching");
    else if (mode === "idle") setMode("searching");
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    if (mode !== "searching") setMode("searching");
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/files?q=${encodeURIComponent(query)}`);
    }
  };

  const handleUploadClick = () => {
    if (mode === "uploading") {
      setMode("idle");
    } else {
      setMode("uploading");
      setQuery("");
    }
  };

  const handleFilePicked = (
    file: File,
    format: "stl" | "obj" | "3mf" | "step" | "amf"
  ) => {
    setPicked({ file, format });
  };

  const handleMetadataClose = () => {
    setPicked(null);
    setMode("idle");
  };

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex flex-col items-center px-4 pointer-events-none">
      {/* Explore materials — visible only when bottom bar is idle */}
      <AnimatePresence initial={false}>
        {mode === "idle" && (
          <motion.div
            key="explore"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className="pointer-events-auto mb-6"
          >
            <Link
              href="/materials"
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              Explore materials
              <ChevronRight size={14} />
            </Link>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        ref={containerRef}
        layout
        transition={{ type: "spring", stiffness: 400, damping: 34 }}
        className={cn(
          "depth-sunken pointer-events-auto w-full max-w-2xl rounded-3xl border border-input",
          "bg-muted/70 backdrop-blur-xl dark:bg-input/40",
          "p-1"
        )}
      >
        <AnimatePresence initial={false}>
          {mode === "uploading" && (
            <motion.div
              key="dropbox"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
              className="overflow-hidden"
            >
              <div className="px-2 pt-2 pb-1">
                <FileUploader onFileSelected={handleFilePicked} />
              </div>
            </motion.div>
          )}

          {mode === "searching" && query.trim().length > 0 && (
            <motion.div
              key="search-results"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
              className="overflow-hidden"
            >
              <SearchResultsPanel
                results={searchResults}
                loading={searchLoading}
                query={query}
                onNavigate={() => {
                  setMode("idle");
                  setQuery("");
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main row — always visible. h-10 + outer p-1 = 48px collapsed total. */}
        <form
          onSubmit={handleSearchSubmit}
          className="flex h-10 items-center gap-1 px-1"
        >
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={handleSearchChange}
            onFocus={handleSearchFocus}
            placeholder="Search files, materials, creators..."
            className="flex-1 bg-transparent px-3 py-1 text-base md:text-sm placeholder:text-muted-foreground/60 focus:outline-none"
          />
          <Button type="button" size="sm" onClick={handleUploadClick}>
            {mode === "uploading" ? "Cancel" : "Upload"}
          </Button>
        </form>
      </motion.div>

      {/* Metadata form opens in a dialog after a file is picked. */}
      <Dialog
        open={picked !== null}
        onOpenChange={(next) => {
          if (!next) handleMetadataClose();
        }}
      >
        <DialogContent
          className="max-h-[90vh] w-full max-w-2xl overflow-y-auto sm:max-w-2xl"
          showCloseButton
        >
          <DialogTitle>New file</DialogTitle>
          {picked && (
            <FileMetadataForm
              file={picked.file}
              format={picked.format}
              onCancel={handleMetadataClose}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
