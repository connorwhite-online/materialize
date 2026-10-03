import Link from "next/link";

import { CompassIcon } from "@/components/icons/oai";
import { Button } from "@/components/ui/button";
import { StatusScreen } from "@/components/ui/page";

export default function NotFound() {
  return (
    <main className="flex min-h-svh items-center">
      <StatusScreen
        code="404"
        icon={<CompassIcon />}
        title="Page not found"
        description="The link may be broken, or the page may have moved."
        actions={
          <>
            <Button render={<Link href="/" />}>Go home</Button>
            <Button variant="outline" render={<Link href="/files" />}>
              Browse files
            </Button>
          </>
        }
      />
    </main>
  );
}
