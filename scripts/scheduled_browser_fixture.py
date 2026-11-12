"""Credential-free browser fixture: never point this launcher at user data."""

import json
import os
import sys
from copy import deepcopy
from pathlib import Path

root = Path(__file__).resolve().parents[1]
data = Path(os.environ.get("AGENT_DESK_DATA_DIR", "")).resolve()
if not data.is_relative_to(root / ".cache"):
    raise RuntimeError("The browser fixture requires an isolated .cache data directory.")
sys.path.insert(0, str(root / "backend"))

from app.core.identity import IdentitySettings  # noqa: E402
from app.core.local_config import LOCAL_ORIGINS  # noqa: E402

if IdentitySettings.load() is not None:
    raise RuntimeError("The browser fixture runs only in local mode.")
LOCAL_ORIGINS.add("http://127.0.0.1:8320")

from app.main import app  # noqa: E402, F401

default_executor = app.state.scheduled.executor


def fixture_executor(task, job, template):
    """Exercise actual report rendering using explicitly synthetic producer output."""
    fixture = {"fixture:market": "market-producer-response.json", "fixture:government": "government.json"}.get(
        task.instructions
    )
    if task.agentId != "demo" or fixture is None:
        return default_executor(task, job, template)
    response = json.loads((root / "contracts/fixtures/reports" / fixture).read_text(encoding="utf-8"))
    report = response["report"]
    report.update(report_id="fixture-" + job["id"], task_id=task.id, task_run_id=job["id"], title=task.name)
    report.pop("source_request_id", None)
    if template is not None:
        report["template"] = deepcopy(template)
        sections = {section["section_id"]: section for section in report["sections"]}
        report["sections"] = [sections[section["section_id"]] for section in template["sections"]
                              if section["section_id"] in sections]
    report["limitations"].append("Fixture sintética del productor; esta ejecución no consultó la nube.")
    return response


app.state.scheduled.executor = fixture_executor
