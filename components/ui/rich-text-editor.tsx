"use client";

import { useEffect } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { ImageGallery } from "@/lib/tiptap/image-gallery";
import { cn } from "@/lib/utils";

/**
 * A WYSIWYG rich-text editor (Tiptap/ProseMirror) that reads and writes
 * HTML. Pasting formatted HTML — e.g. a project README — round-trips
 * natively. It owns only the editable surface; the formatting controls
 * live in {@link EditorToolbar}, which the host positions (the focused
 * build-guide page floats it in a sticky header). The host reaches the
 * editor instance through `onEditorReady`.
 *
 * Output is owner-authored HTML; it is sanitized again on write
 * (sanitizeRichHtml) and on render (<MarkdownProse allowHtml>), so the
 * editor itself is not the security boundary.
 */
export interface RichTextEditorProps {
  /** Initial HTML to seed the document with. */
  initialHTML: string;
  /** Called with the current HTML on every change. */
  onChange: (html: string) => void;
  /** Receives the editor instance (and null on teardown). */
  onEditorReady?: (editor: Editor | null) => void;
  placeholder?: string;
  /** Tailwind max-height class for inline images. */
  imageMaxHeightClass?: string;
  disabled?: boolean;
  className?: string;
}

export function RichTextEditor({
  initialHTML,
  onChange,
  onEditorReady,
  placeholder,
  imageMaxHeightClass = "max-h-[36rem]",
  disabled = false,
  className,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: "noreferrer noopener", target: "_blank" },
        },
      }),
      Image.configure({
        allowBase64: false,
        HTMLAttributes: {
          class: cn(
            "my-3 block max-w-full rounded-xl border border-border object-contain",
            imageMaxHeightClass
          ),
        },
      }),
      ImageGallery,
      Placeholder.configure({ placeholder: placeholder ?? "Write something…" }),
    ],
    content: initialHTML,
    editable: !disabled,
    // Next renders Server Components first; deferring the initial
    // ProseMirror render avoids a hydration mismatch.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "rte-content min-h-40 focus:outline-none text-sm leading-relaxed text-foreground",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  if (!editor) {
    return (
      <div className={cn("min-h-48 rounded-lg bg-muted/30", className)} />
    );
  }

  return <EditorContent editor={editor} className={className} />;
}

export type { Editor };
