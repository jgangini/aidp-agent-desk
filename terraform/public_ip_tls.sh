#!/bin/bash
# Adapted from Starter Kits MIT, dd032cea1ddecdc46fe4d9c54f05c33d4ecc520b.
set -euo pipefail
umask 077

if [[ $# -ne 1 || ( "$1" != issue && "$1" != renew ) ]]; then
  echo 'Expected issue or renew' >&2
  exit 2
fi
PUBLIC_IP=$(cat /etc/agent-desk-public-ip)
python3 -c 'import ipaddress,sys; address=ipaddress.IPv4Address(sys.argv[1]); assert address.is_global and not address.is_multicast' "$PUBLIC_IP"
BASE=/opt/agent-desk
TLS="$BASE/tls"
CONFIG="$BASE/caddy"
ACME="$BASE/acme"
STATE="$BASE/letsencrypt"
IMAGE=docker.io/certbot/certbot@sha256:1dc5b4a99cce916f154c706569baf062600d7dea13e0711e7d7e1461d6230e39
install -d -m 0700 "$TLS" "$CONFIG" "$STATE" "$STATE/log"
install -d -m 0755 "$ACME"
exec 9>"$TLS/.renew.lock"
flock -x 9

case "$1" in
  issue) args=(certonly --webroot --webroot-path /var/lib/letsencrypt --preferred-profile shortlived
               --ip-address "$PUBLIC_IP" --cert-name agent-desk-ip --agree-tos
               --register-unsafely-without-email --non-interactive) ;;
  renew) args=(renew --cert-name agent-desk-ip --non-interactive) ;;
esac
podman run --rm --network host --security-opt no-new-privileges --cap-drop ALL \
  -v "$STATE:/etc/letsencrypt:Z" \
  -v "$ACME:/var/lib/letsencrypt:z" \
  -v "$STATE/log:/var/log/letsencrypt:Z" \
  "$IMAGE" "${args[@]}"

CERT="$STATE/live/agent-desk-ip"
openssl verify -CAfile /etc/pki/tls/certs/ca-bundle.crt -untrusted "$CERT/chain.pem" "$CERT/cert.pem"
openssl x509 -in "$CERT/cert.pem" -noout -checkip "$PUBLIC_IP"
openssl x509 -in "$CERT/cert.pem" -noout -checkend 3600
certificate_key=$(openssl x509 -in "$CERT/cert.pem" -pubkey -noout | openssl sha256)
private_key=$(openssl pkey -in "$CERT/privkey.pem" -pubout | openssl sha256)
test "$certificate_key" = "$private_key"

WORK=$(mktemp -d "$TLS/.rotate.XXXXXX")
activated=0
restore_file() {
  local name="$1" destination="$2"
  if [[ -f "$WORK/$name.old" ]]; then
    cp -p "$WORK/$name.old" "$destination.rollback" && \
      chcon --reference="$(dirname "$destination")" "$destination.rollback" && \
      mv -f "$destination.rollback" "$destination"
  else
    rm -f "$destination"
  fi
}
finish() {
  local status=$? rollback_failed=0
  trap - EXIT INT TERM
  if [[ $status -ne 0 && $activated -eq 1 ]]; then
    restore_file tls.crt "$TLS/tls.crt" || rollback_failed=1
    restore_file tls.key "$TLS/tls.key" || rollback_failed=1
    restore_file Caddyfile "$CONFIG/Caddyfile" || rollback_failed=1
    if [[ $rollback_failed -eq 0 ]]; then
      podman exec agent-desk-proxy caddy reload --config /etc/caddy/Caddyfile || rollback_failed=1
    fi
  fi
  if [[ $rollback_failed -eq 0 ]]; then
    rm -rf -- "$WORK"
  else
    echo "TLS rollback incomplete; protected backup retained at $WORK" >&2
    status=1
  fi
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for name in tls.crt tls.key; do
  if [[ -f "$TLS/$name" ]]; then cp -p "$TLS/$name" "$WORK/$name.old"; fi
done
if [[ -f "$CONFIG/Caddyfile" ]]; then cp -p "$CONFIG/Caddyfile" "$WORK/Caddyfile.old"; fi
install -m 0644 "$CERT/fullchain.pem" "$WORK/tls.crt"
install -m 0600 "$CERT/privkey.pem" "$WORK/tls.key"
cat >"$WORK/Caddyfile" <<EOF
{
  auto_https off
}
http://$PUBLIC_IP {
  handle /.well-known/acme-challenge/* {
    root * /srv/acme
    file_server
  }
  handle {
    redir https://$PUBLIC_IP{uri} 308
  }
}
https://$PUBLIC_IP {
  tls /certs/tls.crt /certs/tls.key
  request_body {
    max_size 9MB
  }
  reverse_proxy 127.0.0.1:8000 {
    flush_interval -1
  }
}
EOF
chmod 0644 "$WORK/Caddyfile"
chcon --reference="$TLS" "$WORK/tls.crt" "$WORK/tls.key"
chcon --reference="$CONFIG" "$WORK/Caddyfile"
activated=1
mv -f "$WORK/tls.crt" "$TLS/tls.crt"
mv -f "$WORK/tls.key" "$TLS/tls.key"
mv -f "$WORK/Caddyfile" "$CONFIG/Caddyfile"
podman exec agent-desk-proxy caddy validate --config /etc/caddy/Caddyfile
podman exec agent-desk-proxy caddy reload --config /etc/caddy/Caddyfile
activated=0
