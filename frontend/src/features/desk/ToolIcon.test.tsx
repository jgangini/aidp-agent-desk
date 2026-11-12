import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { siFacebook, siInstagram, siYoutube, siX } from "simple-icons";
import { ToolIcon } from "./ToolIcon";
import { yahooFinancePaths } from "./brandPaths";
import type { Source } from "./types";

afterEach(cleanup);

const sources: Source[] = [
  "web",
  "facebook",
  "instagram",
  "youtube",
  "x",
  "yahoo_finance",
  "analysis",
  "desk",
];

it.each(sources)("renders %s as a decorative monochrome circular vector", (source) => {
  const { container } = render(<ToolIcon source={source} size={29} />);
  expect(container.children).toHaveLength(1);
  const svg = container.firstElementChild!;
  expect(svg.tagName).toBe("svg");
  expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
  expect(svg.getAttribute("width")).toBe("29");
  expect(svg.getAttribute("height")).toBe("29");
  expect(svg.getAttribute("fill")).toBe("currentColor");
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  expect(svg.getAttribute("focusable")).toBe("false");
  expect(svg.querySelector("image,img,use,foreignObject")).toBeNull();
  if (source === "facebook") {
    expect(svg.querySelector("path")?.getAttribute("d")).toBe(siFacebook.path);
    expect(svg.querySelector("mask")).toBeNull();
  } else {
    const circle = svg.querySelector(":scope > circle")!;
    const mask = svg.querySelector("mask")!;
    expect(circle.getAttribute("cx")).toBe("12");
    expect(circle.getAttribute("cy")).toBe("12");
    expect(circle.getAttribute("r")).toBe("12");
    expect(circle.getAttribute("mask")).toBe(`url(#${mask.id})`);
    expect(mask.getAttribute("maskUnits")).toBe("userSpaceOnUse");
    expect(mask.querySelector("rect")?.getAttribute("fill")).toBe("white");
    expect(mask.querySelector("svg")).not.toBeNull();
    expect(mask.getAttribute("style")).toContain("mask-type: luminance");
  }
});

it("preserves the source glyphs inside their derived circular presentation", () => {
  for (const [source, path] of [
    ["instagram", siInstagram.path],
    ["youtube", siYoutube.path],
    ["x", siX.path],
  ] as const) {
    const { container, unmount } = render(<ToolIcon source={source} />);
    const glyph = container.querySelector("mask svg")!;
    expect(glyph.getAttribute("fill")).toBe("black");
    expect(glyph.querySelector("path")?.getAttribute("d")).toBe(path);
    unmount();
  }
  const { container } = render(<ToolIcon source="yahoo_finance" />);
  const glyph = container.querySelector("mask svg")!;
  expect(glyph.getAttribute("viewBox")).toBe("-270 -15 230 170");
  expect([...glyph.querySelectorAll("path")].map((path) => path.getAttribute("d"))).toEqual(
    [0, 5, 6].map((index) => yahooFinancePaths[index].d),
  );
});

it.each([
  ["web", "lucide-globe-2"],
  ["analysis", "lucide-chart-no-axes-combined"],
  ["desk", "lucide-network"],
] as const)("retains the %s concept glyph as a transparent cutout", (source, className) => {
  const { container } = render(<ToolIcon source={source} />);
  const glyph = container.querySelector(`mask .${className}`)!;
  expect(glyph).not.toBeNull();
  expect(glyph.getAttribute("fill")).toBe("none");
  expect(glyph.getAttribute("stroke")).toBe("black");
});

it("keeps masks independent between repeated sources and stable across rerenders", () => {
  const icons = (
    <>
      <ToolIcon source="instagram" />
      <ToolIcon source="instagram" />
      <ToolIcon source="web" />
    </>
  );
  const { container, rerender } = render(icons);
  const ids = [...container.querySelectorAll("mask")].map((mask) => mask.id);
  expect(new Set(ids).size).toBe(3);
  const circles = [...container.children].map((svg) => svg.querySelector(":scope > circle")!);
  expect(circles.map((circle) => circle.getAttribute("mask"))).toEqual(
    ids.map((id) => `url(#${id})`),
  );
  rerender(icons);
  expect([...container.querySelectorAll("mask")].map((mask) => mask.id)).toEqual(ids);
});
