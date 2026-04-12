/**
 * Generic fallback for any route inside the (app) group that doesn't
 * have its own `loading.tsx`. A neutral centered progress bar reads
 * honestly as "something's loading" without pretending to be a
 * specific page layout — pages that need a faithful placeholder
 * should define their own loading.tsx.
 */
export default function AppLoading() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-7xl items-center justify-center px-4 py-8">
      <div className="relative h-0.5 w-40 overflow-hidden rounded-full bg-muted">
        <div className="absolute inset-y-0 left-0 w-1/3 animate-[loading-bar_1.1s_ease-in-out_infinite] rounded-full bg-foreground/60" />
      </div>
      <style>{`
        @keyframes loading-bar {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
}
