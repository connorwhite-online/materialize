import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface LibraryProjectCardItem {
  id: string;
  name: string;
  slug: string;
  price: number;
  visibility: string;
  source: "owned" | "purchased";
  thumbnailUrl: string | null;
  fileCount: number;
}

interface LibraryProjectCardProps {
  item: LibraryProjectCardItem;
}

export function LibraryProjectCard({ item }: LibraryProjectCardProps) {
  return (
    <Link href={`/projects/${item.slug}`} className="block">
      <Card className="overflow-hidden transition-colors hover:border-primary/30">
        <div className="aspect-square bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
          {item.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.thumbnailUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-xs text-muted-foreground/50">Project</span>
          )}
        </div>
        <CardContent className="p-3 space-y-1">
          <p className="text-sm font-medium line-clamp-1">{item.name}</p>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              {item.fileCount} {item.fileCount === 1 ? "file" : "files"}
            </Badge>
            {item.source === "purchased" && (
              <Badge variant="secondary" className="text-[10px]">
                Purchased
              </Badge>
            )}
            {item.visibility === "private" && item.source === "owned" && (
              <Badge variant="outline" className="text-[10px]">
                Private
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {item.price > 0
              ? `$${(item.price / 100).toFixed(2)}`
              : "Free"}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
