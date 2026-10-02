import Link from "next/link";

import { Oops } from "@/components/icons/oops";
import { Button } from "@/components/ui/button";
import { StatusScreen } from "@/components/ui/page";

export default function NotFound() {
  return (
    <main className="flex min-h-svh items-center">
      <StatusScreen
        code="404"
        icon={<Oops size={28} />}
        title="Nothing printed here"
        description="This page doesn't exist, or it was moved. The good stuff is a tap away."
        actions={
          <>
            <Button size="lg" render={<Link href="/" />}>
              Go home
            </Button>
            <Button size="lg" variant="outline" render={<Link href="/files" />}>
              Browse files
            </Button>
          </>
        }
      />
    </main>
  );
}
