"""Client per consultar el SeitoCamera Admin (Node API).

Punt d'entrada: `fetch_company_context()` retorna el JSON unificat de
`/api/company-context` (perfil empresa + marketing context + KPIs financers
+ top clients/suppliers). Pensat per ser cridat pels agents marketing per
construir un BusinessContext sempre actualitzat amb dades reals.

Auth: header `X-Service-Key`. El nom de la variable d'entorn preferit és
`SERVICE_API_KEY` (alineat amb el backend Node), però per compatibilitat
amb instal·lacions antigues també s'accepta `ADMIN_SERVICE_KEY`.
"""
from __future__ import annotations
import os
import warnings

import httpx

from .schemas.business import BusinessContext


class AdminApiError(Exception):
    pass


def _config() -> tuple[str, str]:
    base = os.environ.get("ADMIN_API_BASE_URL", "http://localhost:4000").rstrip("/")
    # Preferim SERVICE_API_KEY (estàndard, mateix nom que el backend);
    # ADMIN_SERVICE_KEY queda com a alias per compat amb .env antics.
    key = os.environ.get("SERVICE_API_KEY") or os.environ.get("ADMIN_SERVICE_KEY")
    if not key:
        raise AdminApiError(
            "Cap clau de servei configurada. Defineix SERVICE_API_KEY (preferit) "
            "o ADMIN_SERVICE_KEY al .env del marketing, amb el mateix valor que "
            "SERVICE_API_KEY del backend."
        )
    if os.environ.get("ADMIN_SERVICE_KEY") and not os.environ.get("SERVICE_API_KEY"):
        warnings.warn(
            "ADMIN_SERVICE_KEY està obsolet — renomena a SERVICE_API_KEY al .env "
            "per alinear-ho amb el backend.",
            DeprecationWarning,
            stacklevel=2,
        )
    return base, key


def fetch_company_context(year: int | None = None, timeout: float = 30.0) -> dict:
    """GET /api/company-context. Retorna el dict tal qual ve del backend."""
    base, key = _config()
    params = {"year": year} if year else {}
    with httpx.Client(timeout=timeout) as client:
        r = client.get(
            f"{base}/api/company-context",
            params=params,
            headers={"X-Service-Key": key},
        )
        if r.status_code != 200:
            raise AdminApiError(f"GET /api/company-context → {r.status_code}: {r.text[:300]}")
        return r.json()


def context_to_business(ctx: dict) -> BusinessContext:
    """Construeix un BusinessContext (schema marketing) a partir del context unificat.

    Combina:
      - business (marketingContext de la Company): vertical, language, target,
        unique_strengths, known_competitors, excluded_segments, goals
      - company: name, website, location
    """
    biz = ctx.get("business") or {}
    company = ctx.get("company") or {}

    return BusinessContext.model_validate({
        "name": company.get("name") or company.get("legal_name") or "Unknown",
        "description": biz.get("description") or "",
        "vertical": biz.get("vertical") or "",
        "location": company.get("location") or biz.get("location") or "",
        "target_customers": biz.get("target_customers") or [],
        "unique_strengths": biz.get("unique_strengths") or [],
        "known_competitors": biz.get("known_competitors") or [],
        "excluded_segments": biz.get("excluded_segments") or [],
        "language": biz.get("language") or "ca",
        "website": company.get("website"),
        "goals": biz.get("goals") or [],
    })
