/** Closed particle membranes and a connected seed; all layers occupy real 3D volume. */
export function brainGeometry() {
  const points: number[] = [],
    colors: number[] = [],
    edges: number[] = [];
  const connect = (
    start: number,
    count: number,
    offsets: number[],
    stride = 1,
  ) => {
    for (let i = 0; i < count; i += stride) {
      for (const offset of offsets) {
        const j = i + offset;
        if (j >= count) continue;
        const a = (start + i) * 3;
        const b = (start + j) * 3;
        if (
          Math.hypot(
            points[a] - points[b],
            points[a + 1] - points[b + 1],
            points[a + 2] - points[b + 2],
          ) < 0.095
        )
          edges.push(...points.slice(a, a + 3), ...points.slice(b, b + 3));
      }
    }
  };
  const count = 1600;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const radial = Math.sqrt(1 - y * y);
    const angle = i * goldenAngle;
    points.push(
      Math.cos(angle) * radial * 0.43,
      y * 0.43,
      Math.sin(angle) * radial * 0.43,
    );
    colors.push(0.8, 0.8, 0.8);
  }
  connect(0, count, [21, 34, 55]);
  for (const [radius, width, samples] of [
    [1.82, 0.13, 14400],
    [1.38, 0.05, 3500],
    [1.02, 0.035, 2000],
    [0.7, 0.025, 1440],
  ]) {
    const start = points.length / 3;
    for (let i = 0; i < samples; i++) {
      const y = 1 - (2 * (i + 0.5)) / samples;
      const radial = Math.sqrt(1 - y * y);
      const angle = i * goldenAngle;
      const noise = Math.sin(i * 127.1 + radius * 311.7) * 43758.5453;
      const grain = noise - Math.floor(noise) - 0.5;
      const fold =
        Math.sin(angle * 3 + y * 6 + radius * 2) * 0.022 * radial * radial;
      const r = radius + width * grain + fold;
      points.push(
        Math.cos(angle) * radial * r,
        y * r * 0.94,
        Math.sin(angle) * radial * r * 0.9,
      );
      const light = radius > 1.5 ? 0.62 : 0.34;
      colors.push(light, light, light);
    }
    connect(start, samples, [55, 89, 144], 4);
  }
  return {
    points: new Float32Array(points),
    colors: new Float32Array(colors),
    edges: new Float32Array(edges),
  };
}
