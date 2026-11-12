"""TLS shell orchestration with disposable files and stubbed external commands."""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "terraform/public_ip_tls.sh"


def bash_path(path):
    value = Path(path).resolve().as_posix()
    return "/" + value[0].lower() + value[2:] if os.name == "nt" else value


@pytest.fixture
def bash():
    git_bash = Path("C:/Program Files/Git/bin/bash.exe")
    executable = str(git_bash) if os.name == "nt" and git_bash.is_file() else shutil.which("bash")
    if not executable:
        pytest.skip("An existing Bash runtime is required; no shell is downloaded.")
    probe = subprocess.run([executable, "--noprofile", "--norc", "-c", "exit 0"], capture_output=True, timeout=10)
    if probe.returncode:
        pytest.skip("The installed Bash launcher has no usable runtime.")
    return executable


def test_public_ip_tls_shell_syntax(bash):
    result = subprocess.run([bash, "-n", bash_path(SCRIPT)], capture_output=True, timeout=10)
    assert result.returncode == 0, result.stderr.decode()


def test_public_ip_tls_uses_pinned_ip_certificates_and_safe_proxy_configuration():
    source = SCRIPT.read_text()
    assert "IMAGE=docker.io/certbot/certbot@sha256:1dc5b4a99cce916f154c706569baf062600d7dea13e0711e7d7e1461d6230e39" in source
    assert "--preferred-profile shortlived" in source and '--ip-address "$PUBLIC_IP"' in source
    assert "ipaddress.IPv4Address(sys.argv[1])" in source and "address.is_global and not address.is_multicast" in source
    assert '"$ACME:/var/lib/letsencrypt:z"' in source and '"$STATE:/etc/letsencrypt:Z"' in source
    assert "auto_https off" in source and "tls /certs/tls.crt /certs/tls.key" in source
    http, https = source.split("http://$PUBLIC_IP {", 1)[1].split("https://$PUBLIC_IP {", 1)
    assert "root * /srv/acme" in http and "redir https://$PUBLIC_IP{uri} 308" in http
    assert "reverse_proxy" not in http and "reverse_proxy 127.0.0.1:8000" in https
    assert "flush_interval -1" in https and "max_size 9MB" in https
    assert "--insecure" not in source and "skip_verify" not in source and "req -x509" not in source
    for validation in ("openssl verify", '-checkip "$PUBLIC_IP"', "-checkend 3600", 'test "$certificate_key"'):
        assert source.index(validation) < source.index("activated=1")


@pytest.fixture
def shell_case(tmp_path, bash):
    runtime = tmp_path / "runtime"
    files = {"tls/tls.crt": "previous certificate", "tls/tls.key": "previous private key",
             "caddy/Caddyfile": "previous proxy configuration", "ip": "1.1.1.1\n",
             "letsencrypt/live/agent-desk-ip/fullchain.pem": "new certificate",
             "letsencrypt/live/agent-desk-ip/privkey.pem": "new private key",
             "letsencrypt/live/agent-desk-ip/cert.pem": "new leaf",
             "letsencrypt/live/agent-desk-ip/chain.pem": "new chain"}
    for name, value in files.items():
        target = runtime / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(value)
    source = SCRIPT.read_text().replace("/etc/agent-desk-public-ip", bash_path(runtime / "ip"))
    source = source.replace("/opt/agent-desk", bash_path(runtime))
    script = tmp_path / "tls.sh"
    script.write_text(source)
    commands = {
        "python3": f'#!/bin/bash\nexec "{bash_path(sys.executable)}" "$@"\n',
        "flock": "#!/bin/bash\nexit 0\n",
        "chcon": "#!/bin/bash\nexit 0\n",
        "podman": r'''#!/bin/bash
printf 'podman %s\n' "$*" >>"$FAKE_LOG"
if [[ "$1" == run ]]; then
  image=''
  for argument in "$@"; do
    if [[ "$argument" == *@sha256:* ]]; then image="$argument"; break; fi
  done
  registry="${image%%/*}"
  if [[ -z "$image" || ( "$registry" != *.* && "$registry" != *:* && "$registry" != localhost ) ]]; then
    echo 'short-name resolution enforced but cannot prompt without a TTY' >&2
    exit 125
  fi
fi
fail() { echo "injected $TLS_FAIL" >&2; exit 17; }
if [[ "$1" == run && "$TLS_FAIL" == certbot ]]; then fail; fi
if [[ "$1" == exec && "$4" == validate && "$TLS_FAIL" == config ]]; then fail; fi
if [[ "$1" == exec && "$4" == reload && "$TLS_FAIL" == reload && ! -f "$FAIL_MARKER" ]]; then
  touch "$FAIL_MARKER"
  fail
fi
exit 0
''',
        "openssl": r'''#!/bin/bash
printf 'openssl %s\n' "$*" >>"$FAKE_LOG"
fail() { echo "injected $TLS_FAIL" >&2; exit 20; }
case "$1" in
  verify) if [[ "$TLS_FAIL" == verify ]]; then fail; fi ;;
  x509)
    if [[ "$*" == *-checkip* && "$TLS_FAIL" == checkip ]]; then fail; fi
    if [[ "$*" == *-checkend* && "$TLS_FAIL" == expiry ]]; then fail; fi
    if [[ "$*" == *-pubkey* ]]; then printf public-key; fi ;;
  pkey) if [[ "$TLS_FAIL" == keymatch ]]; then echo 'injected keymatch' >&2; printf another-key; else printf public-key; fi ;;
  sha256) if [[ "$TLS_FAIL" == hash ]]; then fail; else cat; fi ;;
esac
''',
    }
    if os.name == "nt":
        commands.update({
            "install": '#!/bin/bash\nif [[ "$1" == -d ]]; then shift 3; mkdir -p "$@"; else shift 2; /usr/bin/cp "$@"; fi\n',
            "chmod": "#!/bin/bash\nexit 0\n",
            "cp": '#!/bin/bash\nif [[ "$1" == -p ]]; then shift; fi\nexec /usr/bin/cp "$@"\n',
        })
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, content in commands.items():
        file = bin_dir / name
        file.write_text(content)
        file.chmod(0o755)

    def run(failure="", action="issue", *, short_name=False):
        script.write_text(source.replace("IMAGE=docker.io/certbot/", "IMAGE=certbot/") if short_name else source)
        environment = {**os.environ, "TLS_FAIL": failure, "FAKE_LOG": bash_path(tmp_path / "commands.log"),
                       "FAIL_MARKER": bash_path(tmp_path / "reload-failed")}
        command = 'export PATH="$1:$PATH"; exec bash "$2" "$3"'
        return subprocess.run([bash, "--noprofile", "--norc", "-c", command, "tls-test", bash_path(bin_dir),
                               bash_path(script), action], env=environment, capture_output=True, timeout=30)

    return runtime, run, tmp_path / "commands.log"


@pytest.mark.parametrize("failure", ["certbot", "verify", "checkip", "expiry", "keymatch", "hash", "config", "reload"])
def test_public_ip_tls_preserves_previous_files_when_issuance_or_activation_fails(shell_case, failure):
    runtime, run, _ = shell_case
    original = {name: (runtime / name).read_bytes() for name in ("tls/tls.crt", "tls/tls.key", "caddy/Caddyfile")}
    result = run(failure)
    assert result.returncode != 0
    assert f"injected {failure}" in result.stderr.decode()
    assert {name: (runtime / name).read_bytes() for name in original} == original


@pytest.mark.parametrize("action", ["issue", "renew"])
def test_public_ip_tls_installs_validated_pair_and_reloads_proxy(shell_case, action):
    runtime, run, log = shell_case
    result = run(action=action)
    assert result.returncode == 0, result.stderr.decode()
    assert (runtime / "tls/tls.crt").read_text() == "new certificate"
    assert (runtime / "tls/tls.key").read_text() == "new private key"
    config = (runtime / "caddy/Caddyfile").read_text()
    assert "https://1.1.1.1" in config and "tls /certs/tls.crt /certs/tls.key" in config
    calls = log.read_text()
    assert "caddy validate --config /etc/caddy/Caddyfile" in calls
    assert calls.index("openssl verify") < calls.index("caddy validate") < calls.index("caddy reload")


@pytest.mark.parametrize("address", ["127.0.0.1", "10.1.2.3", "224.0.0.1", "192.0.2.1", "example.com"])
def test_public_ip_tls_rejects_nonpublic_addresses_before_issuance(shell_case, address):
    runtime, run, log = shell_case
    (runtime / "ip").write_text(address)
    result = run()
    assert result.returncode != 0
    assert not log.exists()
    assert (runtime / "tls/tls.crt").read_text() == "previous certificate"


def test_first_certificate_activation_failure_restores_http_bootstrap_without_fake_tls(shell_case):
    runtime, run, _ = shell_case
    (runtime / "tls/tls.crt").unlink()
    (runtime / "tls/tls.key").unlink()
    result = run("reload")
    assert result.returncode != 0 and "injected reload" in result.stderr.decode()
    assert not (runtime / "tls/tls.crt").exists() and not (runtime / "tls/tls.key").exists()
    assert (runtime / "caddy/Caddyfile").read_text() == "previous proxy configuration"


def test_certbot_image_is_fully_qualified_for_noninteractive_podman(shell_case):
    runtime, run, log = shell_case
    original = {name: (runtime / name).read_bytes() for name in ("tls/tls.crt", "tls/tls.key", "caddy/Caddyfile")}
    failed = run(short_name=True)
    assert failed.returncode == 125
    assert "short-name resolution enforced but cannot prompt without a TTY" in failed.stderr.decode()
    assert {name: (runtime / name).read_bytes() for name in original} == original
    succeeded = run()
    assert succeeded.returncode == 0, succeeded.stderr.decode()
    calls = log.read_text()
    assert "docker.io/certbot/certbot@sha256:" in calls
    assert (runtime / "tls/tls.crt").read_text() == "new certificate"


def test_public_ip_tls_sets_default_sni_for_clients_without_an_ip_server_name(shell_case):
    runtime, run, _ = shell_case
    result = run()
    assert result.returncode == 0, result.stderr.decode()
    config = (runtime / "caddy/Caddyfile").read_text()
    global_options = config.split("}\n", 1)[0]
    assert global_options.startswith("{\n")
    assert "  default_sni 1.1.1.1\n" in global_options
    assert "tls /certs/tls.crt /certs/tls.key" in config
    assert "tls_insecure_skip_verify" not in config
