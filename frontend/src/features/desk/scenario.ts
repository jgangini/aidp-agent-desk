import type { Role, Source } from "./types";
export const sourceWork: {
  source: Source;
  role: Role;
  title: string;
  duration: number;
  output: string;
  units: number;
}[] = [
  {
    source: "web",
    role: "research",
    title: "Explorar fuentes públicas",
    duration: 2500,
    units: 24,
    output:
      "Contexto de fuentes públicas. Hallazgo ficticio, sin consultas externas.",
  },
  {
    source: "facebook",
    role: "social",
    title: "Revisar conversaciones",
    duration: 3300,
    units: 18,
    output:
      "Conversaciones agrupadas por interés y recurrencia. Contenido simulado, sin publicaciones reales.",
  },
  {
    source: "instagram",
    role: "social",
    title: "Identificar señales visuales",
    duration: 4200,
    units: 31,
    output:
      "Comparación ilustrativa de formatos y temas. No se han descargado ni analizado imágenes.",
  },
  {
    source: "youtube",
    role: "research",
    title: "Explorar contenido de YouTube",
    duration: 3100,
    units: 16,
    output:
      "Ejemplo de temas en videos y canales. No se han reproducido ni analizado videos reales.",
  },
  {
    source: "x",
    role: "social",
    title: "Contrastar señales en X",
    duration: 2300,
    units: 22,
    output:
      "Ejemplo de señales públicas y temas emergentes. No se ha consultado X.",
  },
  {
    source: "yahoo_finance",
    role: "research",
    title: "Revisar contexto financiero",
    duration: 2700,
    units: 12,
    output:
      "Contexto financiero de demostración. No contiene cotizaciones ni información de mercado real.",
  },
];
