"""Web search tool — wraps Exa (semantic) and Brave (factual/recent).

Routing (auto mode):
- First try Exa. Exa is great for semantic queries ("companies like X", "similar to Y").
- If Exa returns fewer than 3 useful results, fall back to Brave.
- If Brave key is not configured, Exa-only mode is fine for Phase 1.

Errors retry with tenacity exponential backoff (3 attempts, 1-8s).
"""
from __future__ import annotations
from datetime import datetime
from typing import Literal

import httpx
from pydantic import BaseModel, Field, HttpUrl
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from ..settings import settings
from .base import Tool, ToolContext, ToolError


# ------------------------------- Schemas ------------------------------------- #

class WebSearchInput(BaseModel):
    query: str = Field(..., min_length=2, max_length=400)
    num_results: int = Field(5, ge=1, le=20)
    provider: Literal["exa", "brave", "auto"] = "auto"


class WebSearchResult(BaseModel):
    url: HttpUrl
    title: str
    snippet: str
    published_at: datetime | None = None


class WebSearchOutput(BaseModel):
    query: str
    provider_used: str
    results: list[WebSearchResult]


# ------------------------------- Providers ----------------------------------- #

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException)),
)
async def _search_exa(query: str, num_results: int) -> list[WebSearchResult]:
    if not settings.exa_api_key:
        raise ToolError("EXA_API_KEY not configured")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://api.exa.ai/search",
            headers={"x-api-key": settings.exa_api_key, "content-type": "application/json"},
            json={
                "query": query,
                "numResults": num_results,
                "contents": {"text": {"maxCharacters": 500}},
            },
        )
        r.raise_for_status()
        data = r.json()
    out: list[WebSearchResult] = []
    for item in data.get("results", []):
        try:
            out.append(
                WebSearchResult(
                    url=item["url"],
                    title=item.get("title") or item["url"],
                    snippet=(item.get("text") or "")[:500],
                    published_at=None,
                )
            )
        except Exception:
            continue
    return out


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException)),
)
async def _search_brave(query: str, num_results: int) -> list[WebSearchResult]:
    if not settings.brave_search_api_key:
        raise ToolError("BRAVE_SEARCH_API_KEY not configured")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            "https://api.search.brave.com/res/v1/web/search",
            headers={
                "X-Subscription-Token": settings.brave_search_api_key,
                "Accept": "application/json",
            },
            params={"q": query, "count": num_results},
        )
        r.raise_for_status()
        data = r.json()
    out: list[WebSearchResult] = []
    for item in data.get("web", {}).get("results", []):
        try:
            out.append(
                WebSearchResult(
                    url=item["url"],
                    title=item.get("title", ""),
                    snippet=item.get("description", "")[:500],
                    published_at=None,
                )
            )
        except Exception:
            continue
    return out


# ------------------------------- Tool ---------------------------------------- #

class WebSearch:
    name = "web_search"
    description = (
        "Search the web. Returns a list of {url, title, snippet}. Use broad queries to map a "
        "market and narrower queries to verify specific entities."
    )
    input_schema = WebSearchInput
    output_schema = WebSearchOutput

    async def execute(self, input: WebSearchInput, context: ToolContext) -> WebSearchOutput:
        provider = input.provider
        results: list[WebSearchResult] = []
        used = ""

        if provider in ("exa", "auto") and settings.exa_api_key:
            try:
                results = await _search_exa(input.query, input.num_results)
                used = "exa"
            except Exception as e:
                if provider == "exa":
                    raise ToolError(f"Exa failed and no fallback: {e}") from e
                # auto fallback
                results = []

        if len(results) < 3 and provider in ("auto", "brave") and settings.brave_search_api_key:
            try:
                brave_results = await _search_brave(input.query, input.num_results)
                if brave_results:
                    results = brave_results
                    used = "brave" if not used else f"{used}+brave"
            except Exception as e:
                if provider == "brave":
                    raise ToolError(f"Brave failed: {e}") from e

        if not results:
            raise ToolError(f"No results from any provider for query: {input.query!r}")

        return WebSearchOutput(query=input.query, provider_used=used, results=results)


# Anthropic tool-use schema (the JSON the LLM sees)
WEB_SEARCH_TOOL_DEFINITION: dict = {
    "name": "web_search",
    "description": (
        "Search the web using Exa and/or Brave. Returns ranked results with URL, title, and "
        "text snippet. Use multiple queries to triangulate facts."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query"},
            "num_results": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5},
        },
        "required": ["query"],
    },
}
