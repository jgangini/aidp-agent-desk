"""Conservative compatibility guard; not a complete OpenAPI semantic diff."""


def compatible(old: object, new: object, path: str = "$") -> list[str]:
    errors = []
    if isinstance(old, dict) and isinstance(new, dict):
        named_map = path.endswith(
            (".properties", ".schemas", ".paths", ".responses", ".content", ".securitySchemes")
        )
        for key, value in old.items():
            if not named_map and key in {"description", "summary", "title", "examples", "example"}:
                continue
            if key not in new:
                errors.append(f"{path}.{key}: removed")
            else:
                errors.extend(compatible(value, new[key], f"{path}.{key}"))
        for key in new.keys() - old.keys():
            # New endpoints, schemas and optional object fields are supported.
            if path in {"$.paths", "$.components.schemas"} or path.endswith(".properties"):
                continue
            if not named_map and key in {"description", "summary", "title", "examples", "example"}:
                continue
            errors.append(f"{path}.{key}: new constraint/structure requires review")
    elif old != new:
        errors.append(f"{path}: changed; potentially incompatible")
    return errors
