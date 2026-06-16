"use client";

import { useRef } from "react";
import { type Editor, useEditorState } from "@tiptap/react";
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
  Images,
  Undo2,
  Redo2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  editor: Editor;
  /** Upload one image and resolve to its `src`. Hidden if omitted. */
  onUploadImage?: (file: File) => Promise<string>;
  /** Upload several images and resolve to their `src`s (gallery). */
  onUploadImages?: (files: File[]) => Promise<string[]>;
  /** Disables every control (e.g. while saving). */
  disabled?: boolean;
  className?: string;
}

/**
 * The formatting toolbar for {@link RichTextEditor}. Lives apart from the
 * editor so the focused build-guide page can float it in a sticky header.
 * Reactivity comes from `useEditorState` — it re-renders only when the
 * derived active/disabled flags actually change, not on every keystroke.
 */
export function EditorToolbar({
  editor,
  onUploadImage,
  onUploadImages,
  disabled = false,
  className,
}: Props) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const s = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      h2: editor.isActive("heading", { level: 2 }),
      h3: editor.isActive("heading", { level: 3 }),
      bullet: editor.isActive("bulletList"),
      ordered: editor.isActive("orderedList"),
      quote: editor.isActive("blockquote"),
      code: editor.isActive("codeBlock"),
      link: editor.isActive("link"),
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    }),
  });

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const insertImage = async (file: File) => {
    if (!onUploadImage) return;
    try {
      const src = await onUploadImage(file);
      editor.chain().focus().setImage({ src }).run();
    } catch {
      // Upload errors are surfaced by the host.
    }
  };

  const insertGallery = async (files: File[]) => {
    if (!onUploadImages || files.length === 0) return;
    try {
      const srcs = await onUploadImages(files);
      if (srcs.length === 0) return;
      editor
        .chain()
        .focus()
        .insertContent({
          type: "imageGallery",
          content: srcs.map((src) => ({ type: "image", attrs: { src } })),
        })
        .run();
    } catch {
      // Upload errors are surfaced by the host.
    }
  };

  return (
    <div
      className={cn(
        // Single non-wrapping row: the host pill (build-guide editor) is
        // `overflow-x-auto`, so when the controls outgrow the available
        // width they scroll horizontally instead of wrapping the
        // `ml-auto` undo/redo group onto a ragged second line.
        "flex flex-nowrap items-center gap-0.5",
        disabled && "pointer-events-none opacity-50",
        className
      )}
    >
      <Tool label="Bold" icon={Bold} active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
      <Tool label="Italic" icon={Italic} active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <Tool label="Underline" icon={Underline} active={s.underline} onClick={() => editor.chain().focus().toggleUnderline().run()} />
      <Tool label="Strikethrough" icon={Strikethrough} active={s.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
      <Divider />
      <Tool label="Heading (chapter)" icon={Heading2} active={s.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
      <Tool label="Subheading" icon={Heading3} active={s.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
      <Divider />
      <Tool label="Bulleted list" icon={List} active={s.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <Tool label="Numbered list" icon={ListOrdered} active={s.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
      <Tool label="Quote" icon={Quote} active={s.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
      <Tool label="Code block" icon={Code2} active={s.code} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
      <Divider />
      <Tool label="Link" icon={Link2} active={s.link} onClick={setLink} />
      {s.link && (
        <Tool label="Remove link" icon={Link2Off} onClick={() => editor.chain().focus().unsetLink().run()} />
      )}
      {onUploadImage && (
        <Tool label="Insert image" icon={ImagePlus} onClick={() => imageInputRef.current?.click()} />
      )}
      {onUploadImages && (
        <Tool label="Insert image gallery" icon={Images} onClick={() => galleryInputRef.current?.click()} />
      )}
      <Divider />
      <Tool label="Undo" icon={Undo2} disabled={!s.canUndo} onClick={() => editor.chain().focus().undo().run()} />
      <Tool label="Redo" icon={Redo2} disabled={!s.canRedo} onClick={() => editor.chain().focus().redo().run()} />

      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void insertImage(f);
          e.target.value = "";
        }}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          if (files.length) void insertGallery(files);
          e.target.value = "";
        }}
      />
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
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
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
