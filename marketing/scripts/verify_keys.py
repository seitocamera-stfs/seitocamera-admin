"""Smoke test: call each provider with a trivial request to verify API keys work.

Usage:
    python3 scripts/verify_keys.py

Exits 0 on success, 1 if any key fails.
"""
from __future__ import annotations
import os
import sys
import httpx
from anthropic import Anthropic


def _green(s: str) -> str:
    return f"\033[92m{s}\033[0m"


def _red(s: str) -> str:
    return f"\033[91m{s}\033[0m"


def _yellow(s: str) -> str:
    return f"\033[93m{s}\033[0m"


def check_anthropic() -> bool:
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        print(_red("✗ ANTHROPIC_API_KEY not set"))
        return False
    try:
        client = Anthropic(api_key=key)
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=16,
            messages=[{"role": "user", "content": "Say only the word: OK"}],
        )
        text = "".join(b.text for b in resp.content if hasattr(b, "text"))
        print(_green(f"✓ Anthropic OK — model={resp.model}, reply={text!r}, in={resp.usage.input_tokens}, out={resp.usage.output_tokens}"))
        return True
    except Exception as e:
        print(_red(f"✗ Anthropic FAILED: {type(e).__name__}: {e}"))
        return False


def check_exa() -> bool:
    key = os.environ.get("EXA_API_KEY", "").strip()
    if not key:
        print(_yellow("- EXA_API_KEY not set (skipping)"))
        return True  # optional for phase 1 dev
    try:
        r = httpx.post(
            "https://api.exa.ai/search",
            headers={"x-api-key": key, "content-type": "application/json"},
            json={"query": "camera rental Barcelona", "numResults": 3},
            timeout=30,
        )
        r.raise_for_status()
        results = r.json().get("results", [])
        print(_green(f"✓ Exa OK — {len(results)} results for test query"))
        return True
    except Exception as e:
        print(_red(f"✗ Exa FAILED: {type(e).__name__}: {e}"))
        return False


def check_brave() -> bool:
    key = os.environ.get("BRAVE_SEARCH_API_KEY", "").strip()
    if not key:
        print(_yellow("- BRAVE_SEARCH_API_KEY not set (optional, skipping)"))
        return True
    try:
        r = httpx.get(
            "https://api.search.brave.com/res/v1/web/search",
            headers={"X-Subscription-Token": key, "Accept": "application/json"},
            params={"q": "camera rental Barcelona", "count": 3},
            timeout=30,
        )
        r.raise_for_status()
        results = r.json().get("web", {}).get("results", [])
        print(_green(f"✓ Brave OK — {len(results)} results for test query"))
        return True
    except Exception as e:
        print(_red(f"✗ Brave FAILED: {type(e).__name__}: {e}"))
        return False


def main() -> int:
    print("Verifying API keys...\n")
    results = [check_anthropic(), check_exa(), check_brave()]
    print()
    if all(results):
        print(_green("All configured keys work. You can run the Investigator next."))
        return 0
    else:
        print(_red("One or more keys failed. Fix before running the system."))
        return 1


if __name__ == "__main__":
    sys.exit(main())
