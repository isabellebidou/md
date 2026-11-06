import os
from typing import Any

from openai import OpenAI, OpenAIError

DEFAULT_OPENAI_MODEL = "openai/gpt-oss-120b"


class AIConfigurationError(RuntimeError):
    pass


class AIProviderError(RuntimeError):
    pass


def get_openai_client() -> OpenAI:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise AIConfigurationError("OPENAI_API_KEY is not configured.")

    client_kwargs: dict[str, Any] = {"api_key": api_key}
    base_url = os.environ.get("OPENAI_BASE_URL")
    if base_url:
        client_kwargs["base_url"] = base_url

    return OpenAI(**client_kwargs)


def get_ai_response(prompt: str, *, model: str | None = None) -> str:
    resolved_model = model or os.environ.get("OPENAI_MODEL", DEFAULT_OPENAI_MODEL)

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model=resolved_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
        )
        content = response.choices[0].message.content
        if not content or not content.strip():
            raise AIProviderError("OpenAI returned an empty response.")
        return content.strip()
    except AIConfigurationError:
        raise
    except (AttributeError, OpenAIError, TypeError, ValueError) as exc:
        raise AIProviderError(f"OpenAI request failed: {exc}") from exc
