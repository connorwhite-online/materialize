import { vi } from "vitest";

// Mock server-only (throws if imported outside Next.js server context)
vi.mock("server-only", () => ({}));

// Mock Clerk auth — configurable per test via mockUserId
let mockUserId: string | null = "test-user-id";

export function setMockUserId(id: string | null) {
  mockUserId = id;
}

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(() => Promise.resolve({ userId: mockUserId })),
  currentUser: vi.fn(() =>
    Promise.resolve(
      mockUserId
        ? { id: mockUserId, username: "testuser", firstName: "Test" }
        : null
    )
  ),
}));

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn: unknown) => fn),
}));

// Mock next/headers — server actions that derive a base URL from
// the live request (e.g. createStripeSessionForOrder) call headers()
// at module-load or call-time. Default to an empty header bag so the
// callee falls back to NEXT_PUBLIC_APP_URL / "http://localhost:3000".
vi.mock("next/headers", () => ({
  headers: vi.fn(() =>
    Promise.resolve({
      get: (_name: string): string | null => null,
    })
  ),
  cookies: vi.fn(() =>
    Promise.resolve({
      get: vi.fn(),
      getAll: vi.fn(() => []),
      has: vi.fn(() => false),
      set: vi.fn(),
      delete: vi.fn(),
    })
  ),
}));

// Mock next/server's `after` so tests don't need a request context.
// We swallow the callback — deferred work is verified by direct unit
// tests on the helpers, not through the action surface.
vi.mock("next/server", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("next/server");
  return {
    ...actual,
    after: vi.fn((_fn: () => unknown) => undefined),
  };
});

// Mock next/navigation
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  usePathname: vi.fn(() => "/"),
}));
