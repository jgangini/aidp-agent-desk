declare module "*transitions/ui-generation.js" {
  export function generate(
    element: HTMLElement,
    options: {
      mode: "skeleton";
      variant: "ui";
      duration: number;
      delay?: number;
    },
  ): { cancel(): void; finished: Promise<unknown>; element: HTMLElement };
}
