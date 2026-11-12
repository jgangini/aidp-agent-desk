import importlib
import json
from pathlib import Path
from unittest.mock import Mock

import pytest


def test_documented_dev_command_matches_proxy_and_stops_only_its_children(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = Path(__file__).resolve().parents[2]
    monkeypatch.syspath_prepend(str(root))
    runtime = importlib.import_module("tools.arko_lib.runtime")
    children = [Mock(), Mock()]
    children[0].poll.return_value = 0
    children[0].returncode = 0
    children[1].poll.return_value = None
    launcher = Mock(side_effect=children)
    cleanup = Mock()
    monkeypatch.setattr(runtime.shutil, "which", lambda command: command)
    monkeypatch.setattr(runtime.subprocess, "Popen", launcher)
    monkeypatch.setattr(runtime, "stop_process", cleanup)

    runtime.dev(root)

    ports = json.loads((root / ".arko/project.json").read_text())["development"]
    backend, frontend = [call.args[0] for call in launcher.call_args_list]
    assert backend[backend.index("--port") + 1] == str(ports["backend_port"])
    assert frontend[frontend.index("--port") + 1] == str(ports["frontend_port"])
    assert f'http://127.0.0.1:{ports["backend_port"]}' in (
        root / "frontend/vite.config.ts"
    ).read_text()
    assert "--strictPort" in frontend
    assert [call.args[0] for call in cleanup.call_args_list] == children
