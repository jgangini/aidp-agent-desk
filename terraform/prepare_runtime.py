"""Discover the VM public IPv4 before starting either application or TLS proxy."""

import ipaddress
import json
import os
import re
import subprocess
import time
from pathlib import Path


def prepare(root: Path, public_ip: str, ip_file: Path) -> None:
    address = ipaddress.IPv4Address(public_ip)
    if not address.is_global or address.is_multicast or address.is_reserved:
        raise ValueError("Expected a public unicast IPv4 address")
    origin = f"https://{address}"
    settings_path = root / "bootstrap.json"
    settings = json.loads(settings_path.read_text())
    if settings.get("origin") not in (None, "", origin):
        raise ValueError("Public IP changed; review Oracle callback before restarting")
    settings["origin"] = origin
    for name, mode in (("caddy", 0o755), ("acme", 0o755), ("tls", 0o700)):
        (root / name).mkdir(parents=True, mode=mode, exist_ok=True)
    temporary = settings_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(settings))
    temporary.chmod(0o600)
    temporary.replace(settings_path)
    ip_file.write_text(str(address) + "\n")
    ip_file.chmod(0o600)
    caddyfile = root / "caddy/Caddyfile"
    if not caddyfile.exists():
        caddyfile.write_text(
            "{\n auto_https off\n}\n:80 {\n"
            " handle /.well-known/acme-challenge/* {\n root * /srv/acme\n file_server\n }\n"
            ' handle {\n respond "Agent Desk is starting" 503\n }\n}\n'
        )
        caddyfile.chmod(0o644)


def discover_public_ip() -> str:
    for _ in range(12):
        try:
            result = subprocess.run(
                ["oci-public-ip", "-g"], check=True, capture_output=True, text=True, timeout=30
            )
            values = re.findall(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])", result.stdout)
            if values:
                return str(ipaddress.IPv4Address(values[-1]))
        except (OSError, subprocess.SubprocessError, ValueError):
            pass
        time.sleep(5)
    raise RuntimeError("VM public IPv4 is not available")


if __name__ == "__main__":
    os.umask(0o077)
    prepare(Path("/opt/agent-desk"), discover_public_ip(), Path("/etc/agent-desk-public-ip"))
