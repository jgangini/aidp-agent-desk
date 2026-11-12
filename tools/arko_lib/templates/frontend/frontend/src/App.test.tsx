import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { App } from "./App";

afterEach(cleanup);
it("provides an accessible composition root", () => {
  render(<App />);
  expect(screen.getByRole("main")).toBeTruthy();
});
