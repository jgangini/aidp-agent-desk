import { expect, it } from "vitest";
import { brainGeometry } from "./brainGeometry";

it("builds finite closed membranes around a small connected spherical seed", () => {
  const { points, colors, edges } = brainGeometry();
  expect(points.length).toBe(22940 * 3);
  expect(colors.length).toBe(points.length);
  expect(Array.from(points).every(Number.isFinite)).toBe(true);
  expect(edges.length).toBeGreaterThan(1000);
  const radii = Array.from({ length: points.length / 3 }, (_, i) =>
    Math.hypot(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]),
  );
  expect(radii.filter((r) => r < 0.5)).toHaveLength(1600);
  expect(radii.filter((r) => r > 1.5)).toHaveLength(14400);
  expect(Math.max(...radii)).toBeLessThan(2);
  for (let i = 0; i < edges.length; i += 6) {
    expect(
      Math.hypot(
        edges[i] - edges[i + 3],
        edges[i + 1] - edges[i + 4],
        edges[i + 2] - edges[i + 5],
      ),
    ).toBeLessThan(0.096);
  }
  expect(brainGeometry().points).toEqual(points);
});

it("fills all three spatial axes and both depth hemispheres instead of a stack of planar rings", () => {
  const { points } = brainGeometry();
  const outer = Array.from({ length: 14400 }, (_, index) => [
    ...points.slice((1600 + index) * 3, (1600 + index + 1) * 3),
  ]);
  const variance = [0, 1, 2].map(
    (axis) =>
      outer.reduce((sum, point) => sum + point[axis] ** 2, 0) / outer.length,
  );
  expect(Math.min(...variance) / Math.max(...variance)).toBeGreaterThan(0.7);
  const depth = outer.map((point) => point[2]);
  expect(Math.max(...depth) - Math.min(...depth)).toBeGreaterThan(3.2);
  expect(depth.filter((z) => z > 1).length).toBeGreaterThan(2500);
  expect(depth.filter((z) => z < -1).length).toBeGreaterThan(2500);
  const octants = new Array<number>(8).fill(0);
  for (const [x, y, z] of outer) {
    octants[(x >= 0 ? 1 : 0) | (y >= 0 ? 2 : 0) | (z >= 0 ? 4 : 0)]++;
  }
  expect(octants.every((count) => count > 1500)).toBe(true);
});

it("anchors every filament endpoint to a particle and connects the outer membrane in depth", () => {
  const { points, edges } = brainGeometry();
  const identities = new Set<string>();
  for (let i = 0; i < points.length; i += 3) {
    identities.add(`${points[i]},${points[i + 1]},${points[i + 2]}`);
  }
  let attached = true;
  let outerEdges = 0;
  for (let i = 0; i < edges.length; i += 3) {
    attached &&= identities.has(`${edges[i]},${edges[i + 1]},${edges[i + 2]}`);
    if (i % 6 === 0 && Math.hypot(edges[i], edges[i + 1], edges[i + 2]) > 1.5)
      outerEdges++;
  }
  expect(attached).toBe(true);
  expect(outerEdges).toBeGreaterThan(1000);
});
