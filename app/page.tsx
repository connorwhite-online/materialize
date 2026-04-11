import Link from "next/link";
import { auth } from "@clerk/nextjs/server";

export default async function HomePage() {
  const { userId } = await auth();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-foreground/10">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <span className="text-lg font-semibold tracking-tight">
            Materialize
          </span>
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/files"
              className="text-foreground/60 transition-colors hover:text-foreground"
            >
              Browse
            </Link>
            {userId ? (
              <Link
                href="/dashboard"
                className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background"
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  className="text-foreground/60 transition-colors hover:text-foreground"
                >
                  Sign In
                </Link>
                <Link
                  href="/sign-up"
                  className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background"
                >
                  Get Started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="max-w-2xl text-center">
          <h1 className="text-5xl font-bold tracking-tight">
            Share, sell, and print
            <br />
            3D files
          </h1>
          <p className="mt-4 text-lg text-foreground/60">
            Upload your 3D designs, sell them to a community of makers, or print
            them on-demand through 150+ professional manufacturers worldwide.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link
              href={userId ? "/dashboard/uploads/new" : "/sign-up"}
              className="rounded-md bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
            >
              Start uploading
            </Link>
            <Link
              href="/files"
              className="rounded-md border border-foreground/20 px-6 py-2.5 text-sm font-medium transition-colors hover:bg-foreground/5"
            >
              Browse files
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
