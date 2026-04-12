"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { FileUploader } from "@/components/upload/file-uploader";
import { cn } from "@/lib/utils";

interface UploadedAsset {
  id: string;
  storageKey: string;
  originalFilename: string;
  format: string;
  fileSize: number;
}

type Mode = "idle" | "searching" | "uploading";

export function HomeBottomBar() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isExpanded = mode === "searching" || mode === "uploading";

  // Close on outside click
  useEffect(() => {
    if (!isExpanded) return;

    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setMode("idle");
        setQuery("");
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
  }, [isExpanded]);

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
      setQuery("");
    } else {
      setMode("uploading");
      setQuery("");
    }
  };

  const handleUploadComplete = (asset: UploadedAsset) => {
    // Encode the asset data and navigate to the full upload page for metadata
    const encoded = encodeURIComponent(JSON.stringify(asset));
    router.push(`/dashboard/uploads/new?asset=${encoded}`);
  };

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 pointer-events-none">
      <motion.div
        ref={containerRef}
        layout
        transition={{ type: "spring", stiffness: 400, damping: 34 }}
        className={cn(
          "pointer-events-auto w-full max-w-2xl rounded-2xl border border-border/60 shadow-[0_8px_32px_rgba(0,0,0,0.08)]",
          "bg-background-translucent backdrop-blur-xl",
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
                <FileUploader onUploadComplete={handleUploadComplete} />
              </div>
            </motion.div>
          )}

          {mode === "searching" && query.length > 0 && (
            <motion.div
              key="suggestions"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
              className="overflow-hidden"
            >
              <div className="px-3 pt-2 pb-2">
                <p className="text-xs text-muted-foreground">
                  Press enter to search for &ldquo;{query}&rdquo;
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main row — always visible */}
        <form
          onSubmit={handleSearchSubmit}
          className="flex items-center gap-1 p-1"
        >
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={handleSearchChange}
            onFocus={handleSearchFocus}
            placeholder="Search files, materials, creators..."
            className="flex-1 bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none"
          />
          <Button
            type="button"
            size="sm"
            onClick={handleUploadClick}
          >
            {mode === "uploading" ? "Cancel" : "Upload file"}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
