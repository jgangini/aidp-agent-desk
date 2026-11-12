import { useId } from "react";
import { Globe2, ChartNoAxesCombined, Network } from "lucide-react";
import { siFacebook, siInstagram, siYoutube, siX } from "simple-icons";
import type { Source } from "./types";
import { yahooFinancePaths } from "./brandPaths";

export function ToolIcon({
  source,
  size = 18,
}: {
  source: Source;
  size?: number;
}) {
  const maskId = `tool-icon-${useId().replace(/:/g, "")}`;
  const brand = {
    facebook: siFacebook,
    instagram: siInstagram,
    youtube: siYoutube,
    x: siX,
  }[source as "facebook" | "instagram" | "youtube" | "x"];
  if (source === "facebook")
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <path d={siFacebook.path} />
      </svg>
    );
  const Icon = { web: Globe2, analysis: ChartNoAxesCombined, desk: Network }[
    source as "web" | "analysis" | "desk"
  ];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="24"
          height="24"
          style={{ maskType: "luminance" }}
        >
          <rect width="24" height="24" fill="white" />
          {source === "yahoo_finance" ? (
            <svg
              x="4.25"
              y="4.25"
              width="15.5"
              height="15.5"
              viewBox="-270 -15 230 170"
              fill="black"
            >
              <path d={yahooFinancePaths[0].d} />
              <g transform="translate(-450 32)">
                <path d={yahooFinancePaths[5].d} />
                <path d={yahooFinancePaths[6].d} />
              </g>
            </svg>
          ) : brand ? (
            <svg
              x="4.25"
              y="4.25"
              width="15.5"
              height="15.5"
              viewBox="0 0 24 24"
              fill="black"
            >
              <path d={brand.path} />
            </svg>
          ) : (
            <Icon
              x="4.25"
              y="4.25"
              size={15.5}
              color="black"
              strokeWidth={1.8}
            />
          )}
        </mask>
      </defs>
      <circle cx="12" cy="12" r="12" mask={`url(#${maskId})`} />
    </svg>
  );
}
