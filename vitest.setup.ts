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
