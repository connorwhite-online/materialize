import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

export default function PrintPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold">Print a File</h1>
      <p className="mt-2 text-muted-foreground">
        Get instant quotes from professional manufacturers worldwide.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link href="/dashboard/uploads/new">
          <Card className="h-full transition-colors hover:border-primary/30">
            <CardContent className="flex flex-col items-center p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <span className="text-xl text-muted-foreground">+</span>
              </div>
              <h2 className="mt-4 font-semibold">Upload a new file</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload your STL, OBJ, 3MF, STEP, or AMF file
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/files">
          <Card className="h-full transition-colors hover:border-primary/30">
            <CardContent className="flex flex-col items-center p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <span className="text-xl text-muted-foreground">&#x2315;</span>
              </div>
              <h2 className="mt-4 font-semibold">Browse marketplace</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Find a file to print from the community
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
