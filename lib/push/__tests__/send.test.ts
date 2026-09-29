import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let subs: Array<Record<string, string>> = [];
const deleteWhere = vi.fn();
const sendNotification = vi.fn();
const logErrorMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => subs }) }),
    delete: () => ({ where: (...a: unknown[]) => deleteWhere(...a) }),
  },
}));
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...a: unknown[]) => sendNotification(...a),
  },
}));
vi.mock("@/lib/logger", () => ({
  logError: (...a: unknown[]) => logErrorMock(...a),
}));

import { sendPushToUser } from "../send";

const msg = { title: "t", body: "b", url: "/" };

describe("sendPushToUser", () => {
  beforeEach(() => {
    subs = [
      { id: "s1", endpoint: "https://web.push.apple.com/1", p256dh: "k", auth: "a" },
      { id: "s2", endpoint: "https://web.push.apple.com/2", p256dh: "k", auth: "a" },
    ];
    deleteWhere.mockReset();
    sendNotification.mockReset();
    logErrorMock.mockReset();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
    vi.stubEnv("VAPID_SUBJECT", "mailto:x@example.com");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is a no-op without VAPID keys", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect(await sendPushToUser("u1", msg)).toEqual({ sent: 0, removed: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("sends to every device and deletes the ones that are gone", async () => {
    sendNotification
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));

    const result = await sendPushToUser("u1", msg);

    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toEqual(msg);
    expect(result).toEqual({ sent: 1, removed: 1 });
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("keeps a subscription on a transient failure and never throws", async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error("busy"), { statusCode: 503 }));

    const result = await sendPushToUser("u1", msg);

    expect(result).toEqual({ sent: 0, removed: 0 });
    expect(deleteWhere).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalled();
  });
});
