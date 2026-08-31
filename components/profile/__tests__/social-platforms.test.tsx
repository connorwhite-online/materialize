// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  PLATFORM_ORDER,
  SocialPlatformIcon,
  platformLabel,
  sortSocialLinks,
} from "@/components/profile/social-platforms";

describe("social platforms", () => {
  it("labels every known platform", () => {
    for (const platform of PLATFORM_ORDER) {
      expect(platformLabel(platform).length).toBeGreaterThan(0);
      expect(platformLabel(platform)).not.toBe(platform);
    }
  });

  it("falls back to the raw platform key for unknowns", () => {
    expect(platformLabel("mastodon")).toBe("mastodon");
  });

  it("sorts by PLATFORM_ORDER and sinks unknowns", () => {
    const sorted = sortSocialLinks([
      { platform: "youtube", url: "y" },
      { platform: "website", url: "w" },
      { platform: "mastodon", url: "m" },
      { platform: "github", url: "g" },
    ]);
    expect(sorted.map((l) => l.platform)).toEqual([
      "website",
      "github",
      "youtube",
      "mastodon",
    ]);
  });

  it("renders an svg mark for each known platform", () => {
    for (const platform of PLATFORM_ORDER) {
      const { container, unmount } = render(
        <SocialPlatformIcon platform={platform} />
      );
      expect(container.querySelector("svg")).not.toBeNull();
      unmount();
    }
  });

  it("renders a fallback svg for unknown platforms", () => {
    const { container } = render(
      <SocialPlatformIcon platform="mastodon" />
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
