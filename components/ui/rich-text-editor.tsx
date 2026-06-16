"use client";

import { useRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code2,
  Link2,
  Link2Off,
  ImagePlus,
  Undo2,
  Redo2,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A WYSIWYG rich-text editor (Tiptap/ProseMirror) that reads and writes
 * HTML. Pasting formatted HTML — e.g. a project README — round-trips
 * natively, and the host wires `onUploadImage` to its own storage flow
 * so inline images can be inserted by URL (we never inline base64).
 *
 * Output is owner-authored HTML; it is sanitized again on write
 * (sanitizeRichHtml) and on render (<MarkdownProse allowHtml>), so the
 * editor itself does not need to be the security boundary.
 */
export interface RichTextEditorProps {
  /** Initial HTML to seed the document with. */
  initialHTML: string;
  /** Called with the current HTML on every change. */
  onChange: (html: string) => void;
  /**
   * Upload an inserted image and resolve to the `src` to reference.
   * If omitted, the image button is hidden.
   */
  onUploadImage?: (file: File) => Promise<string>;
  placeholder?: string;
  /** Tailwind max-height class for inline images. */
  imageMaxHeightClass?: string;
  disabled?: boolean;
}

export function RichTextEditor({
  initialHTML,
  onChange,
  onUploadImage,
  placeholder,
  imageMaxHeightClass = "max-h-[36rem]",
  disabled = false,
}: RichTextEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // Match MarkdownProse: links open in a new tab, not on click
        // inside the editor (so the caret can be placed in link text).
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
      Placeholder.configure({
        placeholder: placeholder ?? "Write something…",
      }),
    ],
    content: initialHTML,
    editable: !disabled,
    // Next.js renders Server Components first; deferring the initial
    // ProseMirror render avoids a hydration mismatch.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "rte-content min-h-40 px-3 py-2 focus:outline-none text-sm leading-relaxed text-foreground",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  if (!editor) {
    return (
      <div className="min-h-48 rounded-lg border border-border bg-muted/30" />
    );
  }

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return; // cancelled
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url })
      .run();
  };

  const handleImageFile = async (file: File) => {
    if (!onUploadImage) return;
    try {
      const src = await onUploadImage(file);
      editor.chain().focus().setImage({ src }).run();
    } catch {
      // The host surfaces upload errors; nothing to insert here.
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background focus-within:border-ring">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 px-1.5 py-1">
        <Tool
          label="Bold"
          icon={Bold}
          active={editor.isActive("bold")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <Tool
          label="Italic"
          icon={Italic}
          active={editor.isActive("italic")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <Tool
          label="Underline"
          icon={Underline}
          active={editor.isActive("underline")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <Tool
          label="Strikethrough"
          icon={Strikethrough}
          active={editor.isActive("strike")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
        <Divider />
        <Tool
          label="Heading"
          icon={Heading2}
          active={editor.isActive("heading", { level: 2 })}
          disabled={disabled}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        />
        <Tool
          label="Subheading"
          icon={Heading3}
          active={editor.isActive("heading", { level: 3 })}
          disabled={disabled}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
        />
        <Divider />
        <Tool
          label="Bulleted list"
          icon={List}
          active={editor.isActive("bulletList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <Tool
          label="Numbered list"
          icon={ListOrdered}
          active={editor.isActive("orderedList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <Tool
          label="Quote"
          icon={Quote}
          active={editor.isActive("blockquote")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <Tool
          label="Code block"
          icon={Code2}
          active={editor.isActive("codeBlock")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        />
        <Divider />
        <Tool
          label="Link"
          icon={Link2}
          active={editor.isActive("link")}
          disabled={disabled}
          onClick={setLink}
        />
        {editor.isActive("link") && (
          <Tool
            label="Remove link"
            icon={Link2Off}
            disabled={disabled}
            onClick={() => editor.chain().focus().unsetLink().run()}
          />
        )}
        {onUploadImage && (
          <Tool
            label="Insert image"
            icon={ImagePlus}
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
          />
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <Tool
            label="Undo"
            icon={Undo2}
            disabled={disabled || !editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
          />
          <Tool
            label="Redo"
            icon={Redo2}
            disabled={disabled || !editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}
          />
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleImageFile(f);
          e.target.value = "";
        }}
      />

      <EditorContent editor={editor} />
    </div>
  );
}

function Tool({
  label,
  icon: Icon,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: typeof Bold;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        active && "bg-foreground/10 text-foreground"
      )}
    >
      <Icon size={15} strokeWidth={2} />
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

export type { Editor };
