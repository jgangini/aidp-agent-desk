import { expect, it } from "vitest";
import { groupPublications } from "./publications";
import type { Reference } from "./publicManifest";

const post = (id: string, url: string, alias?: string): Reference => ({
  evidence_id: id,
  url,
  requested_url: alias,
  content_basis: "post_text",
});
const comment = (id: string, parent: string): Reference => ({
  evidence_id: id,
  url: `https://social.example.org/comments/${id}`,
  requested_url: parent,
  content_basis: "comment_text",
});

it("preserves captured parent aliases when duplicate captures collapse into one publication", () => {
  const parent = post(
    "first",
    "https://social.example.org/post/1",
    "https://social.example.org/alias/1",
  );
  const next = post("second", parent.url);
  const child = comment("child", String(parent.requested_url));
  const result = groupPublications([parent, next, child], []);
  expect(result.groups).toHaveLength(1);
  expect(result.groups[0].comments).toEqual([child]);
  expect(result.orphanComments).toEqual([]);
});

it("never assigns an ambiguous alias or an unsafe link to a publication", () => {
  const alias = "https://social.example.org/alias/shared";
  const child = comment("child", alias);
  const result = groupPublications(
    [
      post("first", "https://social.example.org/post/1", alias),
      post("second", "https://social.example.org/post/2", alias),
      child,
      { ...comment("unsafe", alias), url: "javascript:alert(1)" },
    ],
    [],
  );
  expect(result.groups.every((group) => !group.comments.length)).toBe(true);
  expect(result.orphanComments).toEqual([child]);
});
