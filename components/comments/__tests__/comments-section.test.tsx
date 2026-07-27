// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// MTR-238: the project discussion feed renders `DeletePhotoButton` for
// project-bundled photos with no `targetType`, so the confirm dialog
// always called `deleteFilePhoto` — even for project photos — and the
// action silently no-oped ("Photo not found"). `CommentsSection`
// already receives the `target: "file" | "project"` prop it needs; the
// fix threads that prop straight through to `DeletePhotoButton` instead
// of adding new plumbing.

const { deleteFilePhoto, deleteProjectPhoto } = vi.hoisted(() => ({
  deleteFilePhoto: vi.fn(async () => ({ success: true })),
  deleteProjectPhoto: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/app/actions/photos", () => ({
  deleteFilePhoto,
}));
vi.mock("@/app/actions/project-photos", () => ({
  deleteProjectPhoto,
}));
vi.mock("@/app/actions/comments", () => ({
  deleteComment: vi.fn(async () => ({ success: true })),
  editComment: vi.fn(async () => ({ success: true })),
}));

import { CommentsSection, type PhotoPost } from "../comments-section";

const photo: PhotoPost = {
  id: "photo-1",
  caption: "Cool build",
  downloadUrl: "https://example.com/photo.png",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  author: {
    id: "user-1",
    username: "maker",
    displayName: "Maker One",
    avatarUrl: null,
  },
};

describe("CommentsSection photo delete routing", () => {
  beforeEach(() => {
    deleteFilePhoto.mockClear();
    deleteProjectPhoto.mockClear();
  });

  it("calls deleteProjectPhoto (not deleteFilePhoto) when rendering a project's feed", async () => {
    render(
      <CommentsSection
        target="project"
        targetId="project-1"
        comments={[]}
        photoPosts={[photo]}
        ownerId="user-1"
        viewerId="user-1"
        isSignedIn
        signInRedirect="/projects/demo"
      />
    );

    fireEvent.click(screen.getByLabelText("Delete photo"));
    fireEvent.click(screen.getByText("Delete"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(deleteProjectPhoto).toHaveBeenCalledWith("photo-1");
    expect(deleteFilePhoto).not.toHaveBeenCalled();
  });

  it("still calls deleteFilePhoto for file pages (default target)", async () => {
    render(
      <CommentsSection
        target="file"
        targetId="file-1"
        comments={[]}
        photoPosts={[photo]}
        ownerId="user-1"
        viewerId="user-1"
        isSignedIn
        signInRedirect="/files/demo"
      />
    );

    fireEvent.click(screen.getByLabelText("Delete photo"));
    fireEvent.click(screen.getByText("Delete"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(deleteFilePhoto).toHaveBeenCalledWith("photo-1");
    expect(deleteProjectPhoto).not.toHaveBeenCalled();
  });
});
