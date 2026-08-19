import { describe, expect, it } from "vitest";
import { Bell } from "@/components/icons/bell";
import { Browse } from "@/components/icons/browse";
import { Logomark } from "@/components/brand/logo";
import { Home } from "@/components/icons/home";
import { Print } from "@/components/icons/print";
import {
  backFallbackHref,
  iconSizeProps,
  isDestinationActive,
  isNavReachable,
  navDestinations,
  resolvePageIdentity,
} from "@/components/nav/mobile-nav-destinations";

describe("navDestinations", () => {
  it("hides the auth-only inbox from anon visitors", () => {
    const anon = navDestinations({ signedIn: false }).map((d) => d.href);
    expect(anon).toEqual(["/", "/files", "/print", "/materials"]);
  });

  it("gives signed-in users the notifications destination", () => {
    const authed = navDestinations({ signedIn: true }).map((d) => d.href);
    expect(authed).toContain("/notifications");
  });

  it("labels the Home row with the house glyph, not the brand mark", () => {
    // Inverse of the collapsed pill: the menu row has a "Home" label, so
    // it takes a category icon; the logomark only stands alone.
    const home = navDestinations({ signedIn: true })[0];
    expect(home.href).toBe("/");
    expect(home.Icon).toBe(Home);
    expect(home.Icon).not.toBe(Logomark);
  });

  it("appends Prometheus only for the owner-only flag", () => {
    expect(
      navDestinations({ signedIn: true }).map((d) => d.href)
    ).not.toContain("/prometheus");
    expect(
      navDestinations({ signedIn: true, textToCad: true }).map((d) => d.href)
    ).toContain("/prometheus");
  });
});

describe("isDestinationActive", () => {
  it("matches exactly — a detail page is not the listing", () => {
    expect(isDestinationActive("/files", "/files")).toBe(true);
    expect(isDestinationActive("/files/some-widget", "/files")).toBe(false);
    expect(isDestinationActive(null, "/")).toBe(false);
  });
});

describe("resolvePageIdentity", () => {
  it("shows the logomark alone on home", () => {
    const identity = resolvePageIdentity("/");
    // The pill drops the title on Home — but keeps `label`, which names
    // the button for assistive tech.
    expect(identity.markOnly).toBe(true);
    expect(identity.label).toBe("Home");
    expect(identity.Icon).toBe(Logomark);
  });

  it("keeps every other page titled", () => {
    expect(resolvePageIdentity("/files").markOnly).toBeUndefined();
    expect(resolvePageIdentity("/print").markOnly).toBeUndefined();
    expect(resolvePageIdentity(null).markOnly).toBeUndefined();
  });

  it("names the destination pages", () => {
    expect(resolvePageIdentity("/files").label).toBe("Search");
    expect(resolvePageIdentity("/materials").label).toBe("Materials");
    expect(resolvePageIdentity("/print").label).toBe("Print");
    expect(resolvePageIdentity("/notifications").Icon).toBe(Bell);
  });

  it("resolves section pages to their section, not the fallback", () => {
    const file = resolvePageIdentity("/files/some-widget");
    expect(file.label).toBe("File");
    expect(file.Icon).toBe(Browse);
    expect(resolvePageIdentity("/materials/pla-white").label).toBe("Material");
    expect(resolvePageIdentity("/print/abc123").Icon).toBe(Print);
    expect(resolvePageIdentity("/orders/abc123").label).toBe("Order");
    expect(resolvePageIdentity("/dashboard/library").label).toBe("Dashboard");
  });

  it("recognises the viewer's own profile, which has no path prefix", () => {
    expect(resolvePageIdentity("/connorwhite", "/connorwhite").label).toBe(
      "Profile"
    );
    expect(resolvePageIdentity("/someone-else", "/connorwhite").label).toBe(
      "Menu"
    );
  });

  it("falls back for unknown paths and a null pathname", () => {
    expect(resolvePageIdentity("/an/unmapped/route").label).toBe("Menu");
    expect(resolvePageIdentity(null).label).toBe("Menu");
  });
});

describe("iconSizeProps", () => {
  it("sizes the wide logomark by height and everything else by size", () => {
    expect(iconSizeProps(Logomark, 20)).toEqual({ height: 16 });
    expect(iconSizeProps(Print, 20)).toEqual({ size: 20 });
  });
});

describe("isNavReachable", () => {
  it("counts every menu row the viewer can actually see", () => {
    for (const path of ["/", "/files", "/print", "/materials"]) {
      expect(isNavReachable(path, { signedIn: false })).toBe(true);
    }
    expect(isNavReachable("/notifications", { signedIn: true })).toBe(true);
  });

  it("treats a row the viewer can't see as a dead end", () => {
    // Anon has no inbox row and no owner flag, so both are leaves for
    // them even though they're destinations for someone.
    expect(isNavReachable("/notifications", { signedIn: false })).toBe(false);
    expect(isNavReachable("/prometheus", { signedIn: true })).toBe(false);
    expect(
      isNavReachable("/prometheus", { signedIn: true, textToCad: true })
    ).toBe(true);
  });

  it("counts the viewer's own profile — the identity row links there", () => {
    expect(
      isNavReachable("/connorwhite", {
        signedIn: true,
        ownProfilePath: "/connorwhite",
      })
    ).toBe(true);
    expect(
      isNavReachable("/someone-else", {
        signedIn: true,
        ownProfilePath: "/connorwhite",
      })
    ).toBe(false);
  });

  it("treats section pages as dead ends — /files/<slug> is not Search", () => {
    expect(isNavReachable("/files/some-widget", { signedIn: true })).toBe(false);
    expect(isNavReachable("/orders/abc", { signedIn: true })).toBe(false);
    expect(isNavReachable("/dashboard", { signedIn: true })).toBe(false);
  });

  it("assumes reachable when the pathname hasn't resolved", () => {
    // Better a missing way out for one frame than one that flashes in.
    expect(isNavReachable(null, { signedIn: true })).toBe(true);
  });
});

describe("backFallbackHref", () => {
  it("resolves a section page to the destination that owns it", () => {
    expect(backFallbackHref("/files/some-widget")).toBe("/files");
    expect(backFallbackHref("/materials/pla-white")).toBe("/materials");
    expect(backFallbackHref("/print/asset-1")).toBe("/print");
    expect(backFallbackHref("/prometheus/draft")).toBe("/prometheus");
  });

  it("falls back home for anything no destination owns", () => {
    expect(backFallbackHref("/orders/abc")).toBe("/");
    expect(backFallbackHref("/someone-else")).toBe("/");
    expect(backFallbackHref("/")).toBe("/");
    expect(backFallbackHref(null)).toBe("/");
  });

  it("does not mistake a shared prefix for a section", () => {
    // "/filesomething" is not under "/files".
    expect(backFallbackHref("/filesomething")).toBe("/");
  });
});
