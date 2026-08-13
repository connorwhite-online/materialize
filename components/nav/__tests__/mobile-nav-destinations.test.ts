import { describe, expect, it } from "vitest";
import { Bell } from "@/components/icons/bell";
import { Browse } from "@/components/icons/browse";
import { Home } from "@/components/icons/home";
import { Logomark } from "@/components/icons/logomark";
import { Print } from "@/components/icons/print";
import {
  iconSizeProps,
  isDestinationActive,
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
