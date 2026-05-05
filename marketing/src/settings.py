"""Centralized configuration loaded from environment variables via pydantic-settings."""
from __future__ import annotations
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- LLM provider ---
    # "anthropic" → Claude API (production-grade tool use, paid)
    # "ollama"    → Local models via Ollama (development, free, slower, less reliable tool use)
    llm_provider: str = "ollama"
    ollama_base_url: str = "http://localhost:11434"

    # API keys
    anthropic_api_key: str = ""  # Required only if llm_provider=anthropic
    exa_api_key: str | None = None
    brave_search_api_key: str | None = None

    # --- Database ---
    database_url: str = "postgresql+psycopg://seito:pass@localhost:5432/marketing"

    # --- Models ---
    # When llm_provider=anthropic: e.g. "claude-sonnet-4-6", "claude-opus-4-7"
    # When llm_provider=ollama:    e.g. "qwen3:14b", "qwen3:32b", "llama3.3:70b", "deepseek-r1:32b"
    model_manager: str = "qwen3:14b"
    model_investigator: str = "qwen3:14b"
    model_strategist: str = "qwen3:14b"
    model_lead_hunter: str = "qwen3:14b"
    model_fact_checker: str = "qwen3:14b"

    # --- Budget caps (only meaningful for paid providers; informative for local) ---
    max_usd_per_run: float = Field(3.00, ge=0.0, le=20.0)
    max_tokens_per_run: int = Field(400_000, ge=10_000)
    max_tool_calls_per_run: int = Field(150, ge=10)

    # --- Feature flags ---
    autonomous_mode: bool = False
    enable_scraping: bool = True
    scraping_rps_per_domain: float = 0.5
    scraper_user_agent: str = "SeitoMarketingBot/0.1"

    # --- Observability ---
    log_level: str = "INFO"
    log_dir: str = "./logs"

    # --- Pricing (USD per million tokens). Local providers cost 0. ---
    price_sonnet_input_per_mtok: float = 3.00
    price_sonnet_output_per_mtok: float = 15.00
    price_opus_input_per_mtok: float = 15.00
    price_opus_output_per_mtok: float = 75.00


settings = Settings()  # type: ignore[call-arg]
