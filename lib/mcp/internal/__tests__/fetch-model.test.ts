import { describe, it, expect } from "vitest";
import { fetchModelBytes, isPublicAddress, ModelFetchError } from "../fetch-model";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "not-an-ip",
  ])("refuses %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(["8.8.8.8", "104.16.0.1", "2606:4700::1111", "::ffff:8.8.8.8"])(
    "allows %s",
    (ip) => {
      expect(isPublicAddress(ip)).toBe(true);
    }
  );
});

describe("fetchModelBytes", () => {
  const reject = (url: string, message: RegExp) =>
    expect(fetchModelBytes(url, 1024)).rejects.toThrow(
      expect.objectContaining({ message: expect.stringMatching(message) })
    );

  it("only fetches https", async () => {
    await reject("http://example.com/part.stl", /Only https/);
    await reject("file:///etc/passwd", /Only https/);
  });

  it("rejects malformed URLs and embedded credentials", async () => {
    await reject("not a url", /valid URL/);
    await reject("https://user:pw@example.com/part.stl", /credentials/);
  });

  it("refuses private IP literals before connecting", async () => {
    await reject("https://169.254.169.254/latest/meta-data", /private address/);
    await reject("https://[::1]/part.stl", /private address/);
  });

  it("refuses a hostname that resolves to loopback", async () => {
    // localhost resolves without network, so this exercises the
    // socket-level lookup hook rather than the literal check.
    await reject("https://localhost/part.stl", /private address/);
  });

  it("throws ModelFetchError, not a raw network error", async () => {
    await expect(fetchModelBytes("https://localhost/x.stl", 1024)).rejects.toBeInstanceOf(
      ModelFetchError
    );
  });
});
