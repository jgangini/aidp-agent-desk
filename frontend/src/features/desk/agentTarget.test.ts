import { expect, it } from "vitest";
import { agentChoices, profileIdentity } from "./agentTarget";

it("keeps TEST and production choices distinct and supports agents without production", () => {
  const choices = agentChoices([
    {
      id: "one",
      name: "Published",
      instance_id: "platform",
      workspace_id: "ws",
    },
    { id: "two", name: "Developing", surface: "TEST" },
    { id: "legacy", name: "Manual profile" },
  ]);
  expect(choices.map((choice) => choice.id)).toEqual([
    "one",
    "test:one",
    "test:two",
    "legacy",
  ]);
  expect(choices[1].name).toBe("Published (TEST)");
  expect(profileIdentity("test:two")).toBe("two");
  expect(profileIdentity("demo")).toBe("demo");
});
