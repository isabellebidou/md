import os

from openai import OpenAI, OpenAIError

DEFAULT_OPENAI_MODEL = "gpt-4o-mini"


class AIConfigurationError(RuntimeError):
    pass


class AIProviderError(RuntimeError):
    pass


def get_model() -> str:
    return os.environ.get("OPENAI_MODEL") or DEFAULT_OPENAI_MODEL


def get_ai_response(messages: list[dict[str, str]], *, json_mode: bool = False) -> str:
    if not os.environ.get("OPENAI_API_KEY"):
        raise AIConfigurationError("OPENAI_API_KEY is not configured.")

    try:
        response = OpenAI().chat.completions.create(
            model=get_model(),
            messages=messages,
            temperature=0.0,
            response_format={"type": "json_object"} if json_mode else {"type": "text"},
        )
    except OpenAIError as exc:
        raise AIProviderError(f"OpenAI request failed: {exc}") from exc

    content = response.choices[0].message.content
    if not content or not content.strip():
        raise AIProviderError("OpenAI returned an empty response.")
    return content.strip()
