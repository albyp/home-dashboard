#!/usr/bin/env python3
"""Fetch Claude subscription usage for the dashboard; run by claude-usage.timer (host-agent/).

Reads the Claude Code login in ~/.claude/.credentials.json, renews it when it is
about to expire (Claude Code's own OAuth refresh, values taken from the installed
binary), reads the usage endpoint behind Claude Code's /usage, and writes only the
usage numbers to ~/.local/state/claude-usage/usage.json for the dashboard.

Neither endpoint is a published API, so failures are recorded in the output file
(the last good reading is kept) instead of crashing. Tokens are never printed.
"""
import fcntl
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request

HOME = os.path.expanduser("~")
CREDS = os.path.join(HOME, ".claude", ".credentials.json")
OUT_DIR = os.path.join(HOME, ".local", "state", "claude-usage")
OUT = os.path.join(OUT_DIR, "usage.json")
LOCK = os.path.join(OUT_DIR, ".lock")

TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"   # Claude Code's public OAuth client
RENEW_WITHIN_S = 15 * 60                              # renew when under 15 minutes remain
UA = "home-dashboard"


def http_json(url, *, data=None, headers=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method="POST" if body else "GET",
                                 headers={"User-Agent": UA, **({"Content-Type": "application/json"} if body else {}), **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read()[:200].decode(errors="replace")
        raise RuntimeError(f"{url.split('/')[2]} HTTP {e.code}: {detail}") from None


def write_atomic(path, obj, mode):
    d = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-")
    with os.fdopen(fd, "w") as f:
        json.dump(obj, f, indent=1)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def renew_if_needed(creds):
    oauth = creds["claudeAiOauth"]
    force = os.environ.get("CLAUDE_USAGE_FORCE_RENEW") == "1"   # for testing a renewal by hand
    if not force and oauth.get("expiresAt", 0) / 1000 - time.time() > RENEW_WITHIN_S:
        return False
    resp = http_json(TOKEN_URL, data={
        "grant_type": "refresh_token",
        "refresh_token": oauth["refreshToken"],
        "client_id": CLIENT_ID,
        "scope": " ".join(oauth.get("scopes") or []),
    })
    oauth["accessToken"] = resp["access_token"]
    if resp.get("refresh_token"):            # refresh tokens rotate: keep the new one
        oauth["refreshToken"] = resp["refresh_token"]
    oauth["expiresAt"] = int((time.time() + int(resp.get("expires_in", 3600))) * 1000)
    if resp.get("scope"):
        oauth["scopes"] = resp["scope"].split()
    write_atomic(CREDS, creds, 0o600)
    return True


def window(raw, key):
    w = raw.get(key)
    if not isinstance(w, dict) or not isinstance(w.get("utilization"), (int, float)):
        return None
    return {"utilization": w["utilization"], "resets_at": w.get("resets_at")}


def main():
    os.makedirs(OUT_DIR, mode=0o755, exist_ok=True)
    with open(LOCK, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)          # one run at a time
        try:
            prev = json.load(open(OUT))
        except Exception:
            prev = {}
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        try:
            if not os.path.exists(CREDS):
                raise RuntimeError("not logged in: run `claude` and /login on tiny")
            creds = json.load(open(CREDS))
            renewed = renew_if_needed(creds)
            raw = http_json(USAGE_URL, headers={
                "Authorization": "Bearer " + creds["claudeAiOauth"]["accessToken"],
                "anthropic-beta": "oauth-2025-04-20"})
            out = {"ok": True, "fetched_at": now, "renewed": renewed,
                   "five_hour": window(raw, "five_hour"),
                   "seven_day": window(raw, "seven_day"),
                   "seven_day_opus": window(raw, "seven_day_opus")}
            print(f"claude-usage: ok{' (login renewed)' if renewed else ''}")
        except Exception as e:
            out = {**{k: v for k, v in prev.items() if k not in ("ok", "error", "error_at")},
                   "ok": False, "error": str(e), "error_at": now}
            print(f"claude-usage: {e}", file=sys.stderr)
        write_atomic(OUT, out, 0o644)
        return 0 if out["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
