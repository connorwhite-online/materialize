/**
 * Page title for the project / collection create screens. The
 * primitive's glyph sits in front of the heading — the same Layers /
 * FolderOpen pair used on the home create buttons and library
 * empty-state cards — so the page names what it is the same way the
 * rest of the product does.
 */
export function CreateFormHeader({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2.5">
        <span className="flex shrink-0" aria-hidden="true">
          {icon}
        </span>
        <h1 className="text-2xl font-bold">{title}</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
