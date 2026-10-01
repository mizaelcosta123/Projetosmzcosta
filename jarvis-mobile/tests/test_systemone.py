"""The decision model: how its answers are read, and what happens without one.

The second half is the half that matters. A decision model is an optional
extra, so every path through this module has to end somewhere the interface
can use, and "nobody answered" has to be as ordinary as an answer.
"""

from __future__ import annotations

import pytest

from jarvis_mobile import systemone


class _Response:
    def __init__(self, status: int, payload=None, raises: Exception | None = None):
        self.status_code = status
        self._payload = payload
        self._raises = raises

    def json(self):
        if self._raises is not None:
            raise self._raises
        return self._payload


class _Client:
    """Records what was sent, answers with what the test set up."""

    def __init__(self, response=None, error: Exception | None = None):
        self.response = response
        self.error = error
        self.calls: list[dict] = []

    def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append({"url": url, "json": json, "headers": headers, "timeout": timeout})
        if self.error is not None:
            raise self.error
        return self.response

    def get(self, url, headers=None, timeout=None):
        self.calls.append({"url": url, "headers": headers, "timeout": timeout})
        if self.error is not None:
            raise self.error
        return self.response


def _answered(choice="holograma", confidence=0.93):
    """A /v1/systemone response shaped the way the daemon really answers."""
    return _Response(
        200,
        {
            "model": "laya:multilingual",
            "answers": {
                "pedido": {
                    "type": "choice",
                    "choice": choice,
                    "confidence": confidence,
                    "probabilities": {"holograma": 0.93, "imagem": 0.05, "conversa": 0.02},
                }
            },
            "usage": {"input_tokens": 31, "output_tokens": 0},
        },
    )


# -- the request ---------------------------------------------------------------


def test_the_question_is_sent_the_way_the_wire_format_wants_it():
    """`questions` is a map of id -> typed question, not a list.

    The daemon rejects a list outright, and it is the kind of mistake that
    only shows up against a live server.
    """
    client = _Client(_answered())
    systemone.classify("faz um cubo", env={}, client=client)
    sent = client.calls[0]["json"]
    assert sent["state"] == "faz um cubo"
    assert sent["model"] == systemone.DEFAULT_MODEL
    assert isinstance(sent["questions"], dict)
    question = sent["questions"]["pedido"]
    assert question["type"] == "choice"
    assert set(question["criteria"]) == {"holograma", "imagem", "conversa"}


def test_it_asks_the_configured_host_and_model():
    client = _Client(_answered())
    env = {systemone.HOST_ENV: "http://10.0.0.2:9999/", systemone.MODEL_ENV: "decider"}
    systemone.classify("oi", env=env, client=client)
    assert client.calls[0]["url"] == "http://10.0.0.2:9999/v1/systemone"
    assert client.calls[0]["json"]["model"] == "decider"


def test_a_key_is_sent_only_when_there_is_one():
    client = _Client(_answered())
    systemone.classify("oi", env={}, client=client)
    assert "Authorization" not in client.calls[0]["headers"]

    client = _Client(_answered())
    systemone.classify("oi", env={systemone.KEY_ENV: "sk-test"}, client=client)
    assert client.calls[0]["headers"]["Authorization"] == "Bearer sk-test"


def test_the_multilingual_model_is_the_default():
    """Every sentence this decides about is in Portuguese; laya:en is not."""
    assert systemone.DEFAULT_MODEL == "laya:multilingual"


# -- the answer ----------------------------------------------------------------


def test_a_choice_answer_carries_its_confidence_and_spread():
    client = _Client(_answered("holograma", 0.93))
    answer = systemone.classify("faz um cubo grandao pra mim", env={}, client=client)
    assert answer is not None
    assert answer.choice == "holograma"
    assert answer.confidence == pytest.approx(0.93)
    assert answer.probabilities["conversa"] == pytest.approx(0.02)


def test_a_yes_no_answer_becomes_the_same_shape_as_a_choice():
    """`noul` answers with act_probability; callers must not have to care."""
    payload = {"answers": {"clima": {"type": "noul", "act_probability": 0.87, "confidence": 0.87}}}
    read = systemone._read(payload)
    assert read is not None
    assert read["clima"].choice == "true"
    assert read["clima"].confidence == pytest.approx(0.87)

    payload = {"answers": {"clima": {"type": "noul", "act_probability": 0.12}}}
    read = systemone._read(payload)
    assert read["clima"].choice == "false"


def test_confidence_falls_back_to_the_chosen_option_probability():
    payload = {
        "answers": {
            "pedido": {"type": "choice", "choice": "imagem", "probabilities": {"imagem": 0.7}}
        }
    }
    read = systemone._read(payload)
    assert read["pedido"].confidence == pytest.approx(0.7)


# -- nobody answered -----------------------------------------------------------


@pytest.mark.parametrize(
    "response",
    [
        _Response(404, {"error": "model not found", "code": "MODEL_NOT_FOUND"}),
        _Response(401, {"error": "missing or invalid API key"}),
        _Response(200, {"answers": {}}),
        _Response(200, {"nothing": "useful"}),
        _Response(200, None, raises=ValueError("not json")),
    ],
)
def test_every_unusable_answer_is_just_none(response):
    assert systemone.classify("oi", env={}, client=_Client(response)) is None


def test_an_unreachable_daemon_is_none_not_an_exception():
    """The common case on a machine with no daemon, so it must be quiet."""
    client = _Client(error=OSError("connection refused"))
    assert systemone.classify("oi", env={}, client=client) is None


def test_an_empty_sentence_never_leaves_the_process():
    client = _Client(_answered())
    assert systemone.classify("   ", env={}, client=client) is None
    assert client.calls == []


def test_reachable_is_false_without_a_model_installed():
    """A daemon with nothing pulled refuses every decision, so it is not ready."""
    assert systemone.reachable(env={}, client=_Client(_Response(200, {"models": []}))) is False
    assert (
        systemone.reachable(env={}, client=_Client(_Response(200, {"models": [{"name": "laya"}]})))
        is True
    )
    assert systemone.reachable(env={}, client=_Client(_Response(500, {}))) is False
    assert systemone.reachable(env={}, client=_Client(error=OSError("down"))) is False


# -- the route -----------------------------------------------------------------


class _FakeDecider:
    """Stands in for the module, so the route is tested without a daemon."""

    def __init__(self, answer=None, ready=False):
        self.answer = answer
        self.ready = ready
        self.asked: list[str] = []

    def reachable(self):
        return self.ready

    def model_name(self):
        return "laya:multilingual"

    def host_url(self):
        return "http://127.0.0.1:11435"

    def classify(self, text):
        self.asked.append(text)
        return self.answer


def _client(decider):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from jarvis_mobile.bridge.routes import create_decide_router

    app = FastAPI()
    app.include_router(create_decide_router(decider))
    return TestClient(app)


def test_the_route_reports_whether_anything_can_decide():
    body = _client(_FakeDecider(ready=True)).get("/v1/decide").json()
    assert body["available"] is True
    assert body["model"] == "laya:multilingual"

    assert _client(_FakeDecider(ready=False)).get("/v1/decide").json()["available"] is False


def test_the_route_answers_with_the_decision():
    decider = _FakeDecider(answer=systemone.Decision("holograma", 0.93, {"holograma": 0.93}))
    body = _client(decider).post("/v1/decide", json={"text": "faz um cubo"}).json()
    assert body["available"] is True
    assert body["pedido"]["choice"] == "holograma"
    assert body["pedido"]["confidence"] == pytest.approx(0.93)
    assert decider.asked == ["faz um cubo"]


def test_no_decision_model_is_a_200_saying_so_not_a_fault():
    """A 503 would put an ordinary configuration in the logs as an error."""
    response = _client(_FakeDecider(answer=None)).post("/v1/decide", json={"text": "oi"})
    assert response.status_code == 200
    assert response.json()["available"] is False


def test_an_empty_body_never_reaches_the_model():
    decider = _FakeDecider(answer=systemone.Decision("conversa", 1.0))
    response = _client(decider).post("/v1/decide", json={"text": "  "})
    assert response.status_code == 200
    assert response.json()["available"] is False
    assert decider.asked == []
