import json
from urllib import parse, request
from urllib.error import HTTPError, URLError


def cf_api_request(token: str, method: str, path: str, payload: dict | None = None) -> dict:
    body = None
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    req = request.Request(
        f"https://api.cloudflare.com/client/v4{path}",
        data=body,
        headers=headers,
        method=method,
    )
    try:
        with request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
    except HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Cloudflare HTTP {e.code}: {detail}") from e
    except URLError as e:
        raise RuntimeError(f"Cloudflare network error: {e.reason}") from e

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError("Cloudflare returned invalid JSON") from e

    if not data.get("success"):
        errors = data.get("errors") or []
        msg = "; ".join(err.get("message", "unknown error") for err in errors) or "Cloudflare request failed"
        raise RuntimeError(msg)
    return data


def cf_find_zone_id(token: str, hostname: str) -> str:
    parts = hostname.split(".")
    candidates = [".".join(parts[i:]) for i in range(len(parts) - 1)]
    for zone_name in candidates:
        q = parse.urlencode({"name": zone_name, "per_page": 1})
        data = cf_api_request(token, "GET", f"/zones?{q}")
        result = data.get("result") or []
        if result:
            return result[0]["id"]
    raise RuntimeError(f"Nenhuma zona Cloudflare encontrada para '{hostname}'. Verifique token/permissões.")


def cf_upsert_record(token: str, zone_id: str, record: dict) -> dict:
    record_type = record["type"]
    record_name = record["name"]
    q = parse.urlencode({"type": record_type, "name": record_name, "per_page": 1})
    existing = cf_api_request(token, "GET", f"/zones/{zone_id}/dns_records?{q}").get("result") or []
    if existing:
        record_id = existing[0]["id"]
        updated = cf_api_request(token, "PUT", f"/zones/{zone_id}/dns_records/{record_id}", payload=record)
        return {"status": "updated", "id": record_id, "record": updated.get("result")}
    created = cf_api_request(token, "POST", f"/zones/{zone_id}/dns_records", payload=record)
    rec = created.get("result") or {}
    return {"status": "created", "id": rec.get("id"), "record": rec}


def cf_delete_record(token: str, zone_id: str, record_id: str) -> None:
    cf_api_request(token, "DELETE", f"/zones/{zone_id}/dns_records/{record_id}")
