"""Validate the verified release descriptor before creating any cloud resources."""

import json
import os
import re
from pathlib import Path

from identity_setup import selected_identity
from operator_credentials import operator_credentials


def validate(context: dict) -> None:
    descriptor = context["release_assets"]["assets"]["agent-desk-image.json"]
    metadata = json.loads(Path(descriptor["path"]).read_text(encoding="utf-8"))
    if (
        metadata.get("schema_version") != 1
        or metadata.get("platform") != "linux/amd64"
        or metadata.get("source_commit_sha") != context["source"]["commit_sha"]
        or not re.fullmatch(r"[a-z0-9./_-]+@sha256:[a-f0-9]{64}", metadata.get("image", ""))
        or metadata["image"] != context["inputs"]["app_image"]
    ):
        raise ValueError("Image descriptor does not match pinned source and selected image")


if __name__ == "__main__":
    try:
        context = json.loads(Path(os.environ["DEPLOY_STUDIO_CONTEXT"]).read_text())
        validate(context)
        config, _ = operator_credentials()
        identity = selected_identity(config, context["inputs"])
        result = {
            "inputs": {
                "operator_user_ocid": config["user"],
                "operator_fingerprint": config["fingerprint"],
                **identity,
            },
            "events": [
                {
                    "name": "image",
                    "status": "passed",
                    "message": "Image descriptor matches pinned release source.",
                }
            ],
        }
    except Exception:
        raise SystemExit(
            "Preflight failed; verify the pinned image, selected domain, administrator and operator permissions."
        ) from None
    Path(os.environ["DEPLOY_STUDIO_RESULT"]).write_text(json.dumps(result))
