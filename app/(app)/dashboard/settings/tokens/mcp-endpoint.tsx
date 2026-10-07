"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The MCP server URL as a copyable field — the one thing ChatGPT and
 * Claude need. It used to be a select-all pill inside the header copy,
 * which on a phone meant a long-press-and-drag to grab it.
 */
export function McpEndpoint({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="flex h-9 min-w-0 flex-1 items-center truncate rounded-[10px] bg-muted px-3 font-mono text-[13px] select-all">
        {url}
      </code>
      <Button
        variant="secondary"
        onClick={() => {
          void navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
