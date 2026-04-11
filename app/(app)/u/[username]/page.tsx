import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { users, files, printOrders } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getMaterialById } from "@/lib/materials";
import { formatOrderNumber } from "@/lib/utils/order-number";

const PLATFORM_LABELS: Record<string, string> = {
  twitter: "X / Twitter",
  github: "GitHub",
  instagram: "Instagram",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  website: "Website",
};

const STATUS_LABELS: Record<string, string> = {
  quoting: "Quoting",
  cart_created: "Pending",
  ordered: "Confirmed",
  in_production: "In Production",
  shipped: "Shipped",
  received: "Delivered",
  blocked: "Needs Attention",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

export default async function UserProfilePage(props: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await props.params;
  const { userId } = await auth();

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username));

  if (!user) notFound();

  const isOwner = userId === user.id;

  const userFiles = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.userId, user.id),
        eq(files.status, "published"),
        eq(files.visibility, "public")
      )
    )
    .orderBy(desc(files.createdAt));

  // Show print orders only to the profile owner
  let userOrders: Array<{
    id: string;
    material: string | null;
    status: string;
    totalPrice: number;
    serviceFee: number;
    createdAt: Date;
  }> = [];

  if (isOwner) {
    userOrders = await db
      .select({
        id: printOrders.id,
        material: printOrders.material,
        status: printOrders.status,
        totalPrice: printOrders.totalPrice,
        serviceFee: printOrders.serviceFee,
        createdAt: printOrders.createdAt,
      })
      .from(printOrders)
      .where(eq(printOrders.userId, user.id))
      .orderBy(desc(printOrders.createdAt))
      .limit(5);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Profile header */}
      <div className="flex items-start gap-6">
        {user.avatarUrl && (
          <img
            src={user.avatarUrl}
            alt=""
            className="h-20 w-20 rounded-full"
          />
        )}
        <div>
          <h1 className="text-2xl font-bold">
            {user.displayName || user.username}
          </h1>
          {user.username && (
            <p className="text-muted-foreground">@{user.username}</p>
          )}
          {user.bio && (
            <p className="mt-2 max-w-xl text-sm leading-relaxed">{user.bio}</p>
          )}
          {user.socialLinks && user.socialLinks.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3">
              {user.socialLinks.map((link) => (
                <a
                  key={link.platform}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {PLATFORM_LABELS[link.platform] || link.platform}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Print orders — owner only */}
      {isOwner && userOrders.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent Print Orders</h2>
            <Link
              href="/dashboard/orders"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              View all &rarr;
            </Link>
          </div>
          <div className="mt-3 space-y-2">
            {userOrders.map((order) => {
              const materialMeta = order.material
                ? getMaterialById(order.material)
                : null;
              return (
                <Link key={order.id} href={`/dashboard/orders/${order.id}`}>
                  <Card className="transition-colors hover:border-primary/30">
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {materialMeta && (
                          <div
                            className="h-6 w-6 rounded border border-border shrink-0"
                            style={{ backgroundColor: materialMeta.color }}
                          />
                        )}
                        <div>
                          <p className="text-sm font-medium">
                            {materialMeta?.name || order.material || "Print"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatOrderNumber(order.id)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="text-[10px]">
                          {STATUS_LABELS[order.status] || order.status}
                        </Badge>
                        <span className="text-sm font-medium tabular-nums">
                          ${((order.totalPrice + order.serviceFee) / 100).toFixed(2)}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <Separator className="my-8" />

      {/* Published files */}
      <div>
        <h2 className="text-lg font-semibold">
          Files ({userFiles.length})
        </h2>
        {userFiles.length === 0 ? (
          <p className="mt-4 text-muted-foreground">No published files yet.</p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {userFiles.map((file) => (
              <Link key={file.id} href={`/files/${file.slug}`}>
                <Card className="overflow-hidden group transition-colors hover:border-primary/30">
                  <div className="aspect-square bg-gradient-to-br from-muted to-muted/50" />
                  <CardContent className="p-4">
                    <h3 className="font-medium text-sm group-hover:text-primary transition-colors">
                      {file.name}
                    </h3>
                    <div className="mt-1 text-sm">
                      {file.price > 0 ? (
                        <span className="font-medium tabular-nums">
                          ${(file.price / 100).toFixed(2)}
                        </span>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">
                          Free
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
