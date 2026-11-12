const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function createFixtures() {
  return {
    qaProfileId: undefined,
    qaProfile: undefined,
    draftReads: 0,
    draftSteps: [],
    qaDraft: {
      profile: "",
      region: "",
      compartment_id: "",
      instance_id: "",
      workspace_id: "",
      agent_ids: [],
      transcription_model: "",
      speech_model: "",
      has_credentials: false,
      profiles: [],
    },
    qaSuggestions: new Map([
      [
        "demo",
        Array.from({ length: 9 }, (_, index) => ({
          title: `Consulta ${index + 1}`,
          query: `Consulta de prueba ${index + 1}`,
        })),
      ],
    ]),
  };
}

async function installSuggestions(page, fixtures) {
  await page.route("**/api/desk/suggestions/*", async (route) => {
    const identity = new URL(route.request().url()).pathname.split("/").pop();
    if (route.request().method() === "PUT")
      fixtures.qaSuggestions.set(
        identity,
        route.request().postDataJSON().items,
      );
    await route.fulfill({
      json: { items: fixtures.qaSuggestions.get(identity) || [] },
    });
  });
}

async function installDraftRoutes(page, fixtures, fixtureDir, multipartField) {
  // Keep the user's private draft untouched, including the initial settings visit.
  await page.route("**/api/desk/discovery/draft/read", async (route) => {
    assert.equal(route.request().method(), "POST");
    fixtures.draftReads++;
    await route.fulfill({ json: fixtures.qaDraft });
  });

  await page.route("**/api/desk/discovery/import", (route) =>
    route.fulfill({
      status: 409,
      json: {
        detail: "Browser QA requiere guardado por pasos en /discovery/draft.",
      },
    }),
  );

  await page.route("**/api/desk/discovery/draft/clear", async (route) => {
    const { step } = route.request().postDataJSON();
    assert.ok(["agents", "audio"].includes(step));
    fixtures.qaDraft =
      step === "agents"
        ? {
            ...fixtures.qaDraft,
            instance_id: "",
            workspace_id: "",
            agent_ids: [],
          }
        : {
            ...fixtures.qaDraft,
            transcription_model: "",
            speech_model: "",
            profiles: fixtures.qaDraft.profiles.map((p) => ({
              ...p,
              transcription_model: "",
              speech_model: "",
            })),
          };
    await route.fulfill({ json: fixtures.qaDraft });
  });

  await page.route("**/api/desk/discovery/draft", async (route) => {
    if (route.request().method() === "DELETE") {
      fixtures.qaDraft = {
        has_credentials: false,
        profile: "",
        region: "",
        compartment_id: "",
        instance_id: "",
        workspace_id: "",
        agent_ids: [],
        transcription_model: "",
        speech_model: "",
        profiles: [],
      };
      await route.fulfill({ status: 204 });
      return;
    }
    assert.equal(route.request().method(), "POST");
    const field = (name) => multipartField(route.request(), name);
    const step = field("step");
    assert.ok(["connection", "agents", "audio"].includes(step));
    if (step === "connection") {
      const unchanged =
        fixtures.qaDraft.profile === field("profile") &&
        fixtures.qaDraft.compartment_id === field("compartment_id");
      fixtures.qaDraft = {
        ...fixtures.qaDraft,
        profile: field("profile"),
        region: "us-ashburn-1",
        compartment_id: field("compartment_id"),
        has_credentials: true,
        ...(unchanged
          ? {}
          : {
              instance_id: "",
              workspace_id: "",
              agent_ids: [],
              profiles: [],
              transcription_model: "",
              speech_model: "",
            }),
      };
    } else if (step === "agents") {
      assert.ok(fixtures.qaDraft.has_credentials);
      const identities = JSON.parse(field("agent_ids"));
      if (!identities.length) {
        const removed = await page.request.delete(
          `http://127.0.0.1:8317/api/desk/profiles/${fixtures.qaProfileId}`,
          {
            headers: {
              Origin: "http://127.0.0.1:8317",
              "X-Agent-Desk": "configure",
            },
          },
        );
        assert.ok(removed.ok());
        fixtures.qaDraft = { ...fixtures.qaDraft, profiles: [], agent_ids: [] };
        fixtures.draftSteps.push(step);
        await route.fulfill({ json: fixtures.qaDraft });
        return;
      }
      assert.deepEqual(identities, ["agent-desk-qa-only"]);
      if (!fixtures.qaProfileId) {
        // Only this synthetic profile reaches the real local vault; never save a real draft.
        const response = await page.request.post(
          "http://127.0.0.1:8317/api/desk/profiles",
          {
            headers: {
              Origin: "http://127.0.0.1:8317",
              "X-Agent-Desk": "configure",
            },
            multipart: {
              name: "Agent Desk QA",
              endpoint: "https://agent.example.org/invoke",
              flow_id: "agent-desk-qa-only",
              profile: "DEFAULT",
              config: {
                name: "config",
                mimeType: "text/plain",
                buffer: fs.readFileSync(path.join(fixtureDir, "config")),
              },
              key: {
                name: "key.pem",
                mimeType: "text/plain",
                buffer: fs.readFileSync(path.join(fixtureDir, "key.pem")),
              },
            },
          },
        );
        assert.equal(response.status(), 201);
        fixtures.qaProfile = await response.json();
        fixtures.qaProfileId = fixtures.qaProfile.id;
      }
      fixtures.qaDraft = {
        ...fixtures.qaDraft,
        instance_id: field("instance_id"),
        workspace_id: field("workspace_id"),
        agent_ids: JSON.parse(field("agent_ids")),
        profiles: [
          {
            ...fixtures.qaProfile,
            compartment_id: fixtures.qaDraft.compartment_id,
            instance_id: field("instance_id"),
            workspace_id: field("workspace_id"),
            transcription_model: fixtures.qaDraft.transcription_model,
            speech_model: fixtures.qaDraft.speech_model,
          },
        ],
      };
    } else {
      assert.equal(fixtures.qaDraft.profiles.length, 1);
      fixtures.qaDraft = {
        ...fixtures.qaDraft,
        transcription_model: field("transcription_model") || "",
        speech_model: field("speech_model") || "",
        profiles: fixtures.qaDraft.profiles.map((profile) => ({
          ...profile,
          transcription_model: field("transcription_model") || "",
          speech_model: field("speech_model") || "",
        })),
      };
    }
    fixtures.draftSteps.push(step);
    await route.fulfill({ json: fixtures.qaDraft });
  });
}
module.exports = { createFixtures, installSuggestions, installDraftRoutes };
