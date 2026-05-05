"""URL fetch tool — simple httpx version for Phase 1.

Phase 2 will upgrade to Playwright for JS-rendered sites. For now, plain HTTP GET
works for most rental-company sites we need to audit.

Respects robots.txt is NOT implemented yet; TODO Week 2.
"""
from __future__ import annotations
from datetime import datetime

import httpx
from pydantic import BaseModel, Field, HttpUrl
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from ..settings import settings
from .base import Tool, ToolContext, ToolError


class FetchUrlInput(BaseModel):
    url: HttpUrl
    max_chars: int = Field(20_000, ge=500, le=100_000)


class FetchUrlOutput(BaseModel):
    url: HttpUrl
    status: int
    content_type: str
    text: str
    title: str | None = None
    fetched_at: datetime
    truncated: bool


def _strip_html(html: str) -> str:
    """Very naive HTML → text. Phase 2 uses a proper parser."""
    import re
    # drop script and style blocks
    html = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.IGNORECASE)
    html = re.sub(r"<style[\s\S]*?</style>", " ", html, flags=re.IGNORECASE)
    # strip tags
    text = re.sub(r"<[^>]+>", " ", html)
    # collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _extract_title(html: str) -> str | None:
    import re
    m = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.IGNORECASE | re.DOTALL)
    return m.group(1).strip() if m else None


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException)),
)
async def _fetch(url: str) -> tuple[int, str, str]:
    async with httpx.AsyncClient(
        timeout=30,
        follow_redirects=True,
        headers={"User-Agent": settings.scraper_user_agent},
    ) as client:
        r = await client.get(url)
    return r.status_code, r.headers.get("content-type", ""), r.text


class FetchUrl:
    name = "fetch_url"
    description = "Fetch a URL and return cleaned text content. Follows redirects."
    input_schema = FetchUrlInput
    output_schema = FetchUrlOutput

    async def execute(self, input: FetchUrlInput, context: ToolContext) -> FetchUrlOutput:
        if not settings.enable_scraping:
            raise ToolError("Scraping disabled (ENABLE_SCRAPING=false)")
        try:
            status, content_type, html = await _fetch(str(input.url))
        except Exception as e:
            raise ToolError(f"fetch failed: {type(e).__name__}: {e}") from e

        text = _strip_html(html) if "html" in content_type.lower() else html
        truncated = len(text) > input.max_chars
        if truncated:
            text = text[: input.max_chars]
        return FetchUrlOutput(
            url=input.url,
            status=status,
            content_type=content_type,
            text=text,
            title=_extract_title(html),
            fetched_at=datetime.utcnow(),
            truncated=truncated,
        )


FETCH_URL_TOOL_DEFINITION: dict = {
    "name": "fetch_url",
    "description": (
        "Fetch a web page and return its text content. Use this after web_search to get the "
        "full text of a competitor's homepage or pricing page."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "url": {"type": "string", "format": "uri"},
            "max_chars": {"type": "integer", "minimum": 500, "maximum": 100000, "default": 20000},
        },
        "required": ["url"],
    },
}
