"""Desk envelope v1: tenant credentials and runtime settings, never plaintext in storage.

Pattern: jgangini Starter Kits dd032cea1ddecdc46fe4d9c54f05c33d4ecc520b (MIT).
This is a distinct protocol; it does not change or claim compatibility with kits v3.
"""

import base64
import json
import os

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

AAD = b"agent-desk-bootstrap-v1"
READY = "AGENT_DESK_BOOTSTRAP_READY"
OBJECT = ".bootstrap/runtime.json"


def strict_json(raw: bytes) -> dict:
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate bootstrap field")
            result[key] = value
        return result

    if len(raw) > 100000:
        raise ValueError("Bootstrap envelope too large")
    value = json.loads(raw, object_pairs_hook=unique)
    if not isinstance(value, dict):
        raise ValueError("Bootstrap must be an object")
    return value


def encrypt(public_pem: bytes, payload: dict) -> bytes:
    public = serialization.load_pem_public_key(public_pem)
    if not isinstance(public, rsa.RSAPublicKey) or public.key_size != 3072:
        raise ValueError("Expected bootstrap RSA 3072 public key")
    key, nonce = os.urandom(32), os.urandom(12)
    wrapped = public.encrypt(
        key, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
    )
    ciphertext = AESGCM(key).encrypt(nonce, json.dumps(payload).encode(), AAD)
    return json.dumps(
        {
            "schema_version": 1,
            "wrapped_key_b64": base64.b64encode(wrapped).decode(),
            "nonce_b64": base64.b64encode(nonce).decode(),
            "ciphertext_b64": base64.b64encode(ciphertext).decode(),
        }
    ).encode()


def decrypt(private_pem: bytes, raw: bytes) -> dict:
    value = strict_json(raw)
    if (
        set(value) != {"schema_version", "wrapped_key_b64", "nonce_b64", "ciphertext_b64"}
        or type(value["schema_version"]) is not int
        or value["schema_version"] != 1
    ):
        raise ValueError("Unsupported bootstrap envelope")
    wrapped, nonce, ciphertext = (
        base64.b64decode(value[k], validate=True) for k in ("wrapped_key_b64", "nonce_b64", "ciphertext_b64")
    )
    if len(nonce) != 12:
        raise ValueError("Invalid bootstrap nonce")
    private = serialization.load_pem_private_key(private_pem, password=None)
    if not isinstance(private, rsa.RSAPrivateKey) or private.key_size != 3072:
        raise ValueError("Expected bootstrap RSA 3072 key")
    key = private.decrypt(
        wrapped, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
    )
    return strict_json(AESGCM(key).decrypt(nonce, ciphertext, AAD))
