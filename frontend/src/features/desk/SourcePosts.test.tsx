import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SourcePosts } from "./SourcePosts";
import { parseReference, type Reference } from "./publicManifest";
import { parseContentItems } from "./contentItems";
import fixture from "./fixtures/content-items-v1.json";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("retains expanded analysis and failed media when the publication list temporarily empties", () => {
  const post = references()[0];
  const reviewed = parseContentItems(fixture.collection)!.items[0];
  const item = {
    ...reviewed,
    primary_evidence_id: post.evidence_id,
    evidence_ids: [post.evidence_id],
    comments_analysis: undefined,
  };
  const { container, rerender } = render(
    <SourcePosts references={[post]} contentItems={[item]} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Resumen de la publicación" }),
  );
  for (const _asset of post.media ?? []) {
    const image = container.querySelector("img");
    if (image) fireEvent.error(image);
  }
  expect(container.querySelector("img")).toBeNull();
  rerender(<SourcePosts references={[]} />);
  expect(container.querySelector(".source-post-stage")).toBeNull();
  rerender(<SourcePosts references={[post]} contentItems={[item]} />);
  expect(
    screen
      .getByRole("button", { name: "Resumen de la publicación" })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  expect(container.querySelector("img")).toBeNull();
  expect(
    container.querySelector("a.source-post-preview")?.getAttribute("href"),
  ).toBe(post.url);
});

it("shows each reviewed publication summary and its own comment sample while keeping a stable selection across captures", () => {
  const collection = parseContentItems(fixture.collection)!;
  const first = collection.items[0];
  const other = {
    ...first,
    item_id: "other",
    primary_evidence_id: "other-evidence",
    evidence_ids: ["other-evidence"],
    text: "## Segundo resumen\n**Otra publicación**.",
    comments_analysis: undefined,
  };
  const refs = [
    ...fixture.references.map(parseReference),
    { evidence_id: "other-evidence", url: "https://example.org/post/2" },
  ];
  const { container, rerender } = render(
    <SourcePosts references={refs} contentItems={[first, other]} />,
  );
  expect(screen.getByText(first.text)).toBeTruthy();
  expect(screen.getByText(first.comments_analysis!.text!)).toBeTruthy();
  expect(
    screen.getByText(/1 comentario analizado.*muestra parcial/),
  ).toBeTruthy();
  expect(container.querySelectorAll(".source-post-dots button")).toHaveLength(
    2,
  );
  fireEvent.click(screen.getByRole("button", { name: "Ver publicación 2" }));
  expect(screen.getByRole("heading", { name: "Segundo resumen" })).toBeTruthy();
  expect(
    container.querySelector(".source-post-analysis strong")?.textContent,
  ).toBe("Otra publicación");
  expect(screen.queryByText(first.comments_analysis!.text!)).toBeNull();
  const recaptured = {
    ...other,
    item_revision: 2,
    primary_evidence_id: "new-capture",
    evidence_ids: ["new-capture"],
  };
  rerender(
    <SourcePosts
      references={[
        { evidence_id: "new-capture", url: "https://example.org/post/2" },
        ...fixture.references.map(parseReference),
      ]}
      contentItems={[first, recaptured]}
    />,
  );
  expect(screen.getByRole("heading", { name: "Segundo resumen" })).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Ver publicación 1" })
      .getAttribute("aria-current"),
  ).toBe("true");
  rerender(
    <SourcePosts
      references={fixture.references.map(parseReference)}
      contentItems={[first]}
    />,
  );
  expect(screen.queryByRole("heading", { name: "Segundo resumen" })).toBeNull();
  expect(screen.getByText(first.text)).toBeTruthy();
});
it("folds publication summaries, removes matching metadata and hides absent comments and scope", () => {
  const first = parseContentItems(fixture.collection)!.items[0];
  const reference = {
    ...parseReference(fixture.references[0]),
    author_name: "Balance",
    published_at: "2026-11-09T00:00:00Z",
  };
  const item = {
    ...first,
    text: "Balance · 9 de noviembre: El video describe los precios.\n\nMás información.",
    comments_analysis: {
      ...first.comments_analysis!,
      status: "not_collected" as const,
      text: null,
      analyzed_count: 0,
      evidence_ids: [],
    },
  };
  const { rerender } = render(
    <SourcePosts references={[reference]} contentItems={[item]} />,
  );
  const summary = screen.getByRole("button", {
    name: "Resumen de la publicación",
  });
  expect(summary.textContent).toContain("El video describe los precios.");
  expect(summary.textContent).not.toContain("Balance");
  expect(summary.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(summary);
  expect(summary.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(summary, { key: "Enter" });
  expect(summary.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("Alcance de la información")).toBeNull();
  expect(
    screen.queryByRole("region", { name: "Comentarios de la publicación" }),
  ).toBeNull();
  expect(
    screen.queryByRole("heading", { name: "Resumen de la publicación" }),
  ).toBeNull();
  rerender(
    <SourcePosts
      references={[reference]}
      contentItems={[
        {
          ...item,
          text: "**Balance · 9 de noviembre:** El video describe los precios.",
        },
      ]}
    />,
  );
  expect(summary.textContent).toBe("El video describe los precios.");
  rerender(
    <SourcePosts
      references={[reference]}
      contentItems={[
        { ...item, text: "Balance explica: El video describe los precios." },
      ]}
      query="precios"
    />,
  );
  expect(summary.textContent).toContain("Balance explica:");
  expect(summary.getAttribute("aria-expanded")).toBe("true");
});

it.each(["facebook", "instagram"])(
  "uses the same publication and reviewed-comment structure for %s",
  (source) => {
    const item = {
      ...parseContentItems(fixture.collection)!.items[0],
      source_key: source,
    };
    const refs = fixture.references.map((ref) =>
      parseReference({ ...ref, source, discovery_channel: source }),
    );
    const { container } = render(
      <SourcePosts references={refs} contentItems={[item]} />,
    );
    expect(
      screen.getByRole("button", { name: "Resumen de la publicación" })
        .textContent,
    ).toContain(item.text);
    expect(
      screen.getByRole("region", { name: "Comentarios de la publicación" })
        .textContent,
    ).toContain(item.comments_analysis!.text!);
    expect(container.querySelectorAll(".source-post-dots button")).toHaveLength(
      1,
    );
  },
);

function references(): Reference[] {
  return [
    {
      evidence_id: "image",
      url: "https://social.example.org/posts/1",
      source_title: "Canonical image post",
      title: "Legacy title",
      author_name: "Canonical author",
      author: "Legacy author",
      published_at: "2026-11-09T12:00:00Z",
      media: [
        {
          kind: "image",
          url: "https://cdn.example.org/large.jpg",
          delivery: "direct",
          role: "attachment",
        },
        {
          kind: "image",
          url: "https://cdn.example.org/thumb.jpg",
          delivery: "direct",
          role: "thumbnail",
          alt: "Preview",
        },
      ],
    },
    {
      evidence_id: "video",
      url: "https://social.example.org/posts/2",
      source_title: "Video post",
      media: [
        {
          kind: "video",
          url: "https://cdn.example.org/video.mp4",
          delivery: "direct",
          role: "attachment",
        },
        {
          kind: "video",
          url: "https://youtube.com/watch?v=example",
          delivery: "page",
          role: "attachment",
        },
      ],
    },
  ];
}

it("links the entire active card to the original public post without mounting a popup or player", () => {
  const { container } = render(<SourcePosts references={references()} />);
  const link = screen.getByRole("link", {
    name: /Canonical author.*Canonical image post.*pestaña nueva/,
  });
  expect(link.getAttribute("href")).toBe("https://social.example.org/posts/1");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  const image = screen.getByAltText("Preview");
  expect(link.contains(image)).toBe(true);
  expect(image.getAttribute("src")).toBe("https://cdn.example.org/thumb.jpg");
  expect(image.getAttribute("loading")).toBe("lazy");
  expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(container.querySelectorAll("img")).toHaveLength(1);
  expect(screen.queryByText("Legacy title")).toBeNull();
  expect(screen.queryByText("Legacy author")).toBeNull();
  expect(screen.queryByText("Ver publicación")).toBeNull();
  fireEvent.click(link);
  expect(container.querySelector("dialog,video,iframe")).toBeNull();
  expect(container.querySelectorAll(".source-post-dots button")).toHaveLength(
    2,
  );
});

it("uses a paused direct video frame when no image was delivered and keeps opening the origin", () => {
  const { container } = render(<SourcePosts references={references()} />);
  fireEvent.click(screen.getByRole("button", { name: "Ver publicación 2" }));
  const link = screen.getByRole("link", { name: /Video post.*pestaña nueva/ });
  expect(link.getAttribute("href")).toBe("https://social.example.org/posts/2");
  expect(link.getAttribute("target")).toBe("_blank");
  fireEvent.click(link);
  expect(container.querySelector("img,dialog,iframe")).toBeNull();
  const preview = container.querySelector("video")!;
  expect(preview.getAttribute("src")).toBe(
    "https://cdn.example.org/video.mp4#t=0.1",
  );
  expect(preview.preload).toBe("metadata");
  expect(preview.controls).toBe(false);
  expect(preview.autoplay).toBe(false);
  expect(preview.tabIndex).toBe(-1);
  fireEvent.error(preview);
  expect(container.querySelector("video")).toBeNull();
  expect(screen.queryByRole("button", { name: "Reproducir video" })).toBeNull();
});

it("navigates by dots and arrow/Home/End keys with focus and without auto advancing", () => {
  vi.useFakeTimers();
  render(
    <SourcePosts
      references={[
        ...references(),
        { evidence_id: "third", url: "https://social.example.org/posts/3" },
      ]}
    />,
  );
  const first = screen.getByRole("button", { name: "Ver publicación 1" });
  fireEvent.keyDown(first, { key: "End" });
  const third = screen.getByRole("button", { name: "Ver publicación 3" });
  expect(document.activeElement).toBe(third);
  expect(third.getAttribute("aria-current")).toBe("true");
  fireEvent.keyDown(third, { key: "ArrowRight" });
  expect(first.getAttribute("aria-current")).toBe("true");
  fireEvent.keyDown(first, { key: "ArrowLeft" });
  expect(third.getAttribute("aria-current")).toBe("true");
  fireEvent.keyDown(third, { key: "Home" });
  expect(first.getAttribute("aria-current")).toBe("true");
  vi.advanceTimersByTime(15000);
  expect(first.getAttribute("aria-current")).toBe("true");
  expect(first.tabIndex).toBe(0);
  expect(third.tabIndex).toBe(-1);
});

it("preserves active evidence on refresh and falls back to the first remaining post", () => {
  const posts = references();
  const { rerender } = render(<SourcePosts references={posts} />);
  fireEvent.click(screen.getByRole("button", { name: "Ver publicación 2" }));
  rerender(
    <SourcePosts
      references={[{ ...posts[1], source_title: "Updated video" }, posts[0]]}
    />,
  );
  expect(
    screen.getByRole("link", { name: /Updated video/ }).getAttribute("href"),
  ).toBe(posts[1].url);
  expect(
    screen
      .getByRole("button", { name: "Ver publicación 1" })
      .getAttribute("aria-current"),
  ).toBe("true");
  rerender(<SourcePosts references={[posts[0]]} />);
  expect(
    screen
      .getByRole("link", { name: /Canonical image post/ })
      .getAttribute("href"),
  ).toBe(posts[0].url);
});

it("tries the next direct image on failure, then retains the original link without an empty preview", () => {
  const { container } = render(<SourcePosts references={references()} />);
  fireEvent.error(screen.getByAltText("Preview"));
  expect(container.querySelector("img")?.getAttribute("src")).toBe(
    "https://cdn.example.org/large.jpg",
  );
  fireEvent.error(container.querySelector("img")!);
  expect(container.querySelector("img,.source-post-placeholder")).toBeNull();
  expect(
    screen
      .getByRole("link", { name: /Canonical image post/ })
      .getAttribute("href"),
  ).toBe(references()[0].url);
  expect(
    screen
      .getByRole("button", { name: "Ver publicación 1" })
      .getAttribute("aria-current"),
  ).toBe("true");
});

it("shows an X username, date and own post text without inventing missing content", () => {
  const { container, rerender } = render(
    <SourcePosts
      references={[
        {
          evidence_id: "post",
          url: "https://x.com/usuario_prueba/status/12345",
          published_at: "2026-11-04T10:00:00Z",
          text: "Primera línea\n\nSegunda línea",
        },
      ]}
    />,
  );
  expect(
    container.querySelector(".source-post-caption > strong")?.textContent,
  ).toBe("@usuario_prueba");
  expect(container.querySelector("time + .source-post-text")?.textContent).toBe(
    "Primera línea\n\nSegunda línea",
  );
  expect(container.querySelector("img,.source-post-placeholder")).toBeNull();
  rerender(
    <SourcePosts
      references={[
        { evidence_id: "unknown", url: "https://x.com/i/status/12345" },
      ]}
    />,
  );
  expect(
    container.querySelector(".source-post-caption > strong")?.textContent,
  ).toBe("Usuario no identificado");
  expect(container.querySelector(".source-post-text")).toBeNull();
});

it("keeps separate carousels independent and deduplicates evidence IDs", () => {
  render(
    <>
      <SourcePosts references={[references()[0], references()[0]]} />
      <SourcePosts references={[references()[1]]} />
    </>,
  );
  expect(
    screen.getAllByRole("region", { name: "Publicaciones de la fuente" }),
  ).toHaveLength(2);
  expect(screen.getAllByRole("link")).toHaveLength(2);
  expect(
    screen.getAllByRole("button", { name: "Ver publicación 1" }),
  ).toHaveLength(2);
  expect(
    screen.queryByRole("button", { name: "Ver publicación 2" }),
  ).toBeNull();
});

it("preserves public source anchors without admitting private destinations or anchored media", () => {
  const url = "https://docs.example.org/guide#section";
  const { container } = render(
    <SourcePosts references={[{ evidence_id: "anchored", url }]} />,
  );
  expect(container.querySelector("a")?.getAttribute("href")).toBe(url);
});

it("rejects unsafe post destinations and malformed or private media before producing links", () => {
  const { container } = render(
    <SourcePosts
      references={[
        { evidence_id: "script", url: "javascript:alert(1)" },
        { evidence_id: "local", url: "https://localhost/post" },
        { evidence_id: "local-anchor", url: "https://localhost/post#section" },
        {
          evidence_id: "anchored-media",
          url: "https://social.example.org/posts/4",
          media: [
            {
              kind: "image",
              url: "https://cdn.example.org/image#fragment",
              delivery: "direct",
              role: "attachment",
            },
          ],
        },
        {
          evidence_id: "credentials",
          url: "https://user:pass@example.org/post",
        },
        {
          evidence_id: "private-media",
          url: "https://social.example.org/posts/3",
          media: [
            {
              kind: "image",
              url: "https://127.0.0.1/private",
              delivery: "direct",
              role: "attachment",
            },
          ],
        },
      ]}
    />,
  );
  expect(
    container.querySelector("button,a,img,dialog,video,iframe"),
  ).toBeNull();
});

it("shows comments beneath an exact parent or its alias and keeps orphans outside publication slides", () => {
  const post = {
    ...references()[0],
    requested_url: "https://social.example.org/posts/original",
  };
  const orphan = "https://social.example.org/comment/orphan";
  const { container } = render(
    <SourcePosts
      references={[
        post,
        {
          evidence_id: "comment-1",
          url: "https://social.example.org/comment/1",
          requested_url: post.url,
          content_basis: "comment_text",
          text: "Comentario directo",
        },
        {
          evidence_id: "comment-2",
          url: "https://social.example.org/comment/2",
          requested_url: post.requested_url,
          content_basis: "comment_text",
        },
        {
          evidence_id: "orphan",
          url: orphan,
          requested_url: "https://social.example.org/posts/other",
          content_basis: "comment_text",
          text: "Otro padre",
        },
      ]}
    />,
  );
  expect(container.querySelectorAll(".source-post-dots button")).toHaveLength(
    1,
  );
  expect(screen.getByText("Comentario directo")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Ver publicación 2" }),
  ).toBeNull();
  expect(
    screen
      .getByRole("region", { name: "Comentarios sin publicación asociada" })
      .querySelector("a")
      ?.getAttribute("href"),
  ).toBe(orphan);
  expect(screen.getByText("Otro padre")).toBeTruthy();
  expect(container.querySelector("dialog,video,iframe")).toBeNull();
});

it("does not turn five orphan comments into publications or borrow their media for a parent", () => {
  const comments = Array.from({ length: 5 }, (_, index) => ({
    evidence_id: `comment-${index}`,
    url: `https://social.example.org/comments/${index}`,
    requested_url: "https://social.example.org/posts/missing",
    content_basis: "comment_text",
    text: `Comentario recuperado ${index}`,
  }));
  const { container } = render(<SourcePosts references={comments} />);
  expect(container.querySelectorAll(".source-post-dots button")).toHaveLength(
    0,
  );
  expect(container.querySelector(".source-post-preview")).toBeNull();
  expect(
    screen.getAllByRole("link", { name: "Autor no disponible" }),
  ).toHaveLength(5);
  expect(screen.queryByText("Usuario no identificado")).toBeNull();
});

it("deduplicates captures of a publication URL and keeps its reviewed primary evidence", () => {
  const item = parseContentItems(fixture.collection)!.items[0];
  const parent = parseReference(fixture.references[0]);
  const earlier = {
    ...parent,
    evidence_id: "earlier",
    author_name: "Captura anterior",
    media: [
      {
        kind: "image" as const,
        delivery: "direct" as const,
        role: "attachment" as const,
        url: "https://cdn.example.org/earlier.jpg",
      },
    ],
  };
  const { container } = render(
    <SourcePosts
      references={[earlier, ...fixture.references.map(parseReference)]}
      contentItems={[item]}
    />,
  );
  expect(container.querySelectorAll(".source-post-dots button")).toHaveLength(
    1,
  );
  expect(screen.getByText(item.text)).toBeTruthy();
  expect(screen.queryByText("Captura anterior")).toBeNull();
  expect(
    container.querySelector(".source-post-preview img")?.getAttribute("src"),
  ).toBe("https://cdn.example.org/earlier.jpg");
});

it("keeps commenter names separate from the post author even when comments share a URL", () => {
  const post = references()[0];
  const comments = ["María", "Pedro"].map((author_name, index) => ({
    evidence_id: `person-${index}`,
    url: post.url,
    requested_url: post.url,
    content_basis: "comment_text",
    author_name,
    text: `Opinión de ${author_name}`,
  }));
  const { container } = render(
    <SourcePosts references={[post, ...comments]} />,
  );
  expect(screen.getByRole("link", { name: "María" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Pedro" })).toBeTruthy();
  expect(screen.getByText("Opinión de María")).toBeTruthy();
  expect(screen.getByText("Opinión de Pedro")).toBeTruthy();
  expect(
    container.querySelector(".source-post-caption strong")?.textContent,
  ).toBe("Canonical author");
  expect(container.querySelectorAll(".source-post-dots button")).toHaveLength(
    1,
  );
});

it("changes only the selected publication's own comments and never groups a similar URL", () => {
  const posts = references();
  const comment = (id: string, parent: string, text: string) => ({
    evidence_id: id,
    url: `https://social.example.org/comments/${id}`,
    requested_url: parent,
    content_basis: "comment_text",
    text,
  });
  const { container } = render(
    <SourcePosts
      references={[
        ...posts,
        comment("one", posts[0].url, "No hay surtido en esta tienda"),
        comment("two", posts[1].url, "El precio de este producto subió"),
        comment("different", `${posts[0].url}?other=1`, "Padre diferente"),
      ]}
    />,
  );
  expect(container.querySelectorAll(".source-post-dots button")).toHaveLength(
    2,
  );
  expect(screen.getByText("No hay surtido en esta tienda")).toBeTruthy();
  expect(screen.queryByText("El precio de este producto subió")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Ver publicación 2" }));
  expect(screen.queryByText("No hay surtido en esta tienda")).toBeNull();
  expect(screen.getByText("El precio de este producto subió")).toBeTruthy();
  expect(
    screen.getByRole("region", { name: "Comentarios sin publicación asociada" })
      .textContent,
  ).toContain("Padre diferente");
});

it("keeps only the latest selection and its safe link after rapid carousel changes", () => {
  const { container } = render(<SourcePosts references={references()} />);
  fireEvent.click(screen.getByRole("button", { name: "Ver publicación 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Ver publicación 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Ver publicación 2" }));
  expect(container.querySelectorAll("a.source-post-preview")).toHaveLength(1);
  expect(
    container.querySelector("a.source-post-preview")?.getAttribute("href"),
  ).toBe("https://social.example.org/posts/2");
  expect(
    screen
      .getByRole("button", { name: "Ver publicación 2" })
      .getAttribute("aria-current"),
  ).toBe("true");
  expect(container.querySelector("dialog,iframe")).toBeNull();
});

it("keeps the active dot visible in a single overflow rail while navigating in either direction", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const rail = this.classList.contains("source-post-dots");
      const index = Number(this.dataset.postIndex);
      const left = rail
        ? 0
        : index * 24 - (this.parentElement?.scrollLeft ?? 0);
      return {
        left,
        right: left + (rail ? 80 : 24),
        width: rail ? 80 : 24,
      } as DOMRect;
    },
  );
  const { container } = render(
    <SourcePosts
      references={Array.from({ length: 20 }, (_, index) => ({
        evidence_id: `post-${index}`,
        url: `https://example.org/post/${index}`,
      }))}
    />,
  );
  const dots = container.querySelector<HTMLElement>(".source-post-dots")!;
  fireEvent.keyDown(screen.getByRole("button", { name: "Ver publicación 1" }), {
    key: "End",
  });
  expect(dots.scrollLeft).toBe(400);
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Ver publicación 20" }),
    { key: "Home" },
  );
  expect(dots.scrollLeft).toBe(0);
});

it("places authored comment bullets and the reviewed summary in one Comments section", () => {
  const item = parseContentItems(fixture.collection)!.items[0];
  const refs = fixture.references.map(parseReference);
  const { container } = render(
    <SourcePosts
      references={[
        refs[0],
        { ...refs[1], author_name: "María", text: "No encontré el producto." },
      ]}
      contentItems={[item]}
    />,
  );
  const section = screen.getByRole("region", {
    name: "Comentarios de la publicación",
  });
  expect(section.textContent).toContain(item.comments_analysis!.text!);
  expect(section.querySelector(".source-comment-entries li")?.textContent).toBe(
    "María: No encontré el producto.",
  );
  expect(screen.queryByText("Comentarios recuperados")).toBeNull();
  expect(container.querySelectorAll(".source-comments")).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Descripción" })).toBeTruthy();
});
