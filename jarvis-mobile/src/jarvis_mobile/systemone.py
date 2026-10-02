"""A typed judgement about a sentence, in milliseconds, from a local model.

A decision model is not a small chat model. It never writes a word: it takes a
**state** (here, what somebody said) and a set of **typed questions**, and
answers them all in one forward pass with calibrated probabilities. That is a
different tool from the engine in ``providers.py``, and it does not replace it
-- nothing here can hold a conversation.

Why this app wants one. The interface already decides things about a sentence
before any model sees it, and it does so with hand-written rules, on purpose:
``conjure.js`` draws a cube the frame you ask for it, and the comment there is
blunt about the alternative -- "a second and a half for an endpoint to agree is
not augmented reality, it is a form with a delay". The rules are fast and they
are right about the sentences they were written for. What they cannot do is the
middle: "faz aí um cubo grandão pra mim" has a verb and a shape and two words
no table knows, so the rules decline and the whole sentence goes to the chat
model, which costs seconds.

That middle is exactly the shape of a decision model's job, so that is the only
place this is wired in (``web/app.js``). It never runs ahead of the rules -- it
runs instead of the slow path, which means the worst case is the speed the app
already had.

The wire format is TypeSafe's ``/v1/systemone``, which Ollaya
(https://github.com/ollaya-dev/ollaya, Apache-2.0) serves locally for open
models. Because the format is the same, ``OLLAYA_HOST`` pointed at TypeSafe's
own endpoint works too, with a key -- nothing here is specific to running it
locally except the default.

Nothing in this module raises. A decision model that is absent, slow or
confused must leave the app exactly as it was without it, because that is a
working app.
"""

from __future__ import annotations

import logging
import os
from typing import Any

__all__ = [
    "DEFAULT_HOST",
    "DEFAULT_MODEL",
    "HOST_ENV",
    "INTENTS",
    "KEY_ENV",
    "MODEL_ENV",
    "Decision",
    "classify",
    "decide",
    "host_url",
    "model_name",
    "reachable",
]

logger = logging.getLogger(__name__)

#: Where the decision daemon listens. Ollaya's own default port, and loopback
#: because the daemon has no business being reachable from outside the machine
#: it advises.
HOST_ENV = "OLLAYA_HOST"
DEFAULT_HOST = "http://127.0.0.1:11435"

#: Which model answers. ``laya`` is the fast general one; the multilingual
#: build is the one that matters here, because every sentence this app decides
#: about is in Portuguese and ``laya:en`` is English-only.
MODEL_ENV = "JARVIS_DECIDE_MODEL"
DEFAULT_MODEL = "laya:multilingual"

#: Only needed when OLLAYA_HOST points at something that authenticates -- a
#: shared daemon, or TypeSafe's own endpoint.
KEY_ENV = "OLLAYA_API_KEY"

#: How long to wait. A decision model answers in milliseconds; a second is
#: already far outside that, and past it the slow path we were avoiding is the
#: faster answer.
TIMEOUT = 1.5

#: The one question this app asks.
#:
#: Three options rather than a yes/no per intent, because they are mutually
#: exclusive and a single choice is calibrated across all three -- asking
#: "is it a hologram?" and "is it an image?" separately can answer yes twice.
#:
#: The wording is the criteria, not a prompt: the model reads each option's
#: description and scores the state against them.
INTENTS: dict[str, Any] = {
    "pedido": {
        "type": "choice",
        "instructions": "O que a pessoa está pedindo com esta frase?",
        "criteria": {
            "holograma": (
                "Pedir para criar, mudar, girar, mover ou apagar um objeto 3D "
                "na tela: um cubo, uma esfera, uma pirâmide, um toro."
            ),
            "imagem": (
                "Pedir um desenho, uma foto ou uma ilustração de alguma coisa, "
                "para ser gerada como figura."
            ),
            "conversa": (
                "Qualquer outra coisa: uma pergunta, um pedido de informação, "
                "uma ordem para o assistente, ou conversa comum."
            ),
        },
    }
}


class Decision:
    """One answered question: the option chosen, and how sure the model is.

    ``probabilities`` is kept because a calibrated spread is the whole point of
    these models -- "holograma 0.51, conversa 0.49" and "holograma 0.99" are
    the same ``choice`` and must not be acted on the same way.
    """

    __slots__ = ("choice", "confidence", "probabilities")

    def __init__(
        self,
        choice: str,
        confidence: float,
        probabilities: dict[str, float] | None = None,
    ) -> None:
        self.choice = choice
        self.confidence = confidence
        self.probabilities = probabilities or {}

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Decision({self.choice!r}, {self.confidence:.3f})"

    def as_dict(self) -> dict[str, Any]:
        return {
            "choice": self.choice,
            "confidence": self.confidence,
            "probabilities": self.probabilities,
        }


def _host(host: str | None = None, env: dict[str, str] | None = None) -> str:
    source = os.environ if env is None else env
    return (host or source.get(HOST_ENV) or DEFAULT_HOST).rstrip("/")


def _model(model: str | None = None, env: dict[str, str] | None = None) -> str:
    source = os.environ if env is None else env
    return model or source.get(MODEL_ENV) or DEFAULT_MODEL


def host_url(env: dict[str, str] | None = None) -> str:
    """Where decisions are asked for, as configured right now."""
    return _host(None, env)


def model_name(env: dict[str, str] | None = None) -> str:
    """Which model answers them, as configured right now."""
    return _model(None, env)


def _headers(env: dict[str, str] | None = None) -> dict[str, str]:
    source = os.environ if env is None else env
    key = source.get(KEY_ENV)
    return {"Authorization": f"Bearer {key}"} if key else {}


def reachable(
    *,
    host: str | None = None,
    env: dict[str, str] | None = None,
    client: Any = None,
    timeout: float = TIMEOUT,
) -> bool:
    """Is a decision daemon answering, with at least one model installed?

    A daemon with no model pulled answers every decision with MODEL_NOT_FOUND,
    which from the interface's side is indistinguishable from being wrong. So
    "running" is not the question -- "able to answer" is.
    """
    try:
        import httpx
    except ImportError:  # pragma: no cover - httpx ships with the server
        return False

    get = client.get if client is not None else httpx.get
    try:
        response = get(f"{_host(host, env)}/v1/models", headers=_headers(env), timeout=timeout)
        if response.status_code != 200:
            return False
        payload = response.json()
    except Exception:
        return False
    models = payload.get("models") if isinstance(payload, dict) else None
    return bool(models)


def decide(
    state: str,
    questions: dict[str, Any] | None = None,
    *,
    model: str | None = None,
    host: str | None = None,
    env: dict[str, str] | None = None,
    client: Any = None,
    timeout: float = TIMEOUT,
) -> dict[str, Decision] | None:
    """Answer ``questions`` about ``state``. None when nothing could answer.

    None is not an error path that callers may skip: it is the normal answer on
    a machine with no daemon, and every caller has to already work without one.
    """
    if not state or not state.strip():
        return None
    try:
        import httpx
    except ImportError:  # pragma: no cover - httpx ships with the server
        return None

    body = {
        "model": _model(model, env),
        "state": state,
        "questions": questions if questions is not None else INTENTS,
    }
    post = client.post if client is not None else httpx.post
    try:
        response = post(
            f"{_host(host, env)}/v1/systemone",
            json=body,
            headers=_headers(env),
            timeout=timeout,
        )
    except Exception as exc:
        # Debug, not warning: on a machine without a daemon this is every call,
        # and a log line per message is how a log stops being read.
        logger.debug("no decision model at %s: %s", _host(host, env), exc)
        return None
    if response.status_code != 200:
        logger.debug("decision model refused: %s", response.status_code)
        return None
    try:
        payload = response.json()
    except Exception:
        return None
    return _read(payload)


def _read(payload: Any) -> dict[str, Decision] | None:
    """Pull the answers out of a ``/v1/systemone`` response.

    The answers are an internally tagged union: a ``choice`` question answers
    with ``choice``, a ``noul`` (yes/no) one with ``act_probability``. Both are
    normalised to the same shape here so callers never branch on the question
    type they asked.
    """
    if not isinstance(payload, dict):
        return None
    answers = payload.get("answers")
    if not isinstance(answers, dict) or not answers:
        return None

    out: dict[str, Decision] = {}
    for name, answer in answers.items():
        if not isinstance(answer, dict):
            continue
        probabilities = answer.get("probabilities")
        if not isinstance(probabilities, dict):
            probabilities = {}
        if "choice" in answer:
            choice = str(answer["choice"])
        elif "act_probability" in answer:
            # A yes/no question: "act" is the true side.
            act = _number(answer.get("act_probability"))
            choice = "true" if act >= 0.5 else "false"
            probabilities = probabilities or {"true": act, "false": 1 - act}
        elif "score" in answer:
            choice = str(answer["score"])
        else:
            continue
        confidence = answer.get("confidence")
        out[str(name)] = Decision(
            choice,
            _number(confidence) if confidence is not None else _number(probabilities.get(choice)),
            {str(k): _number(v) for k, v in probabilities.items()},
        )
    return out or None


def _number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def classify(
    text: str,
    *,
    model: str | None = None,
    host: str | None = None,
    env: dict[str, str] | None = None,
    client: Any = None,
    timeout: float = TIMEOUT,
) -> Decision | None:
    """What is this sentence asking for: a hologram, an image, or a reply?

    Returns None when no decision model answered -- the caller then does what
    it did before this file existed.
    """
    answers = decide(
        text,
        INTENTS,
        model=model,
        host=host,
        env=env,
        client=client,
        timeout=timeout,
    )
    return answers.get("pedido") if answers else None
