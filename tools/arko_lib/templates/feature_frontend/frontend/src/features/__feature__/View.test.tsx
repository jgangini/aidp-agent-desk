import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FeatureView } from "./View";
import { createItem } from "./api";

vi.mock("./api", () => ({ createItem: vi.fn() }));
afterEach(cleanup);
it("submits the validated title and shows the result", async () => {
  vi.mocked(createItem).mockResolvedValue({ id: "1", title: "Task" });
  render(<FeatureView token="test-only" />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Task" } });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(await screen.findByText("Created: Task")).toBeTruthy();
  expect(createItem).toHaveBeenCalledWith("test-only", { title: "Task" });
});

it("keeps user input and exposes a failed request", async () => {
  vi.mocked(createItem).mockRejectedValue(new Error("network"));
  render(<FeatureView token="test-only" />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Retry" } });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(await screen.findByText("Could not create item")).toBeTruthy();
  expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Retry");
});
