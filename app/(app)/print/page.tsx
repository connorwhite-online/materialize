import Link from "next/link";

export default function PrintPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold">Print a File</h1>
      <p className="mt-2 text-foreground/60">
        Get instant quotes from 150+ professional manufacturers worldwide.
      </p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <Link
          href="/dashboard/uploads/new"
          className="flex flex-col items-center rounded-lg border border-foreground/10 p-8 text-center transition-colors hover:border-foreground/20"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground/5">
            <span className="text-2xl">+</span>
          </div>
          <h2 className="mt-4 font-semibold">Upload a new file</h2>
          <p className="mt-1 text-sm text-foreground/60">
            Upload your STL, OBJ, 3MF, STEP, or AMF file
          </p>
        </Link>

        <Link
          href="/files"
          className="flex flex-col items-center rounded-lg border border-foreground/10 p-8 text-center transition-colors hover:border-foreground/20"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground/5">
            <span className="text-2xl">&#x1F50D;</span>
          </div>
          <h2 className="mt-4 font-semibold">Browse marketplace</h2>
          <p className="mt-1 text-sm text-foreground/60">
            Find a file to print from the community
          </p>
        </Link>
      </div>
    </div>
  );
}
