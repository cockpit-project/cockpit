# Copyright (C) 2014 Red Hat, Inc.
# SPDX-License-Identifier: GPL-3.0-or-later
# Author: Stef Walter <stefw@redhat.com>

import pytest

from test.pytest.ws import authorize


@pytest.mark.parametrize(
    ("challenge", "expected_type", "expected_remainder"),
    [
        ("valid", "valid", ""),
        ("Basic more-data", "basic", "more-data"),
        ("Basic   more-data", "basic", "more-data"),
        ("valid:test", "valid", "test"),
        ("valid1:", "valid1", ""),
        ("valid2:test:test", "valid2", "test:test"),
    ],
)
def test_parse_type(
    challenge: str, expected_type: str, expected_remainder: str
) -> None:
    auth_type, remainder = authorize.parse_type(challenge)
    assert auth_type == expected_type
    assert remainder == expected_remainder


@pytest.mark.parametrize(
    "challenge",
    [
        ":invalid",
    ],
)
def test_parse_type_invalid(challenge: str) -> None:
    with pytest.raises(ValueError):
        authorize.parse_type(challenge)


@pytest.mark.parametrize(
    ("challenge", "expected_subject", "expected_remainder"),
    [
        ("valid:73637275666679:", "73637275666679", ""),
        ("valid:73637275666679:more-data", "73637275666679", "more-data"),
        ("valid:scruffy:", "scruffy", ""),
        (
            "X-Conversation conversationtoken more-data",
            "conversationtoken",
            "more-data",
        ),
        (
            "X-Conversation  conversationtoken    more-data",
            "conversationtoken",
            "more-data",
        ),
    ],
)
def test_parse_subject(
    challenge: str, expected_subject: str, expected_remainder: str
) -> None:
    subject, remainder = authorize.parse_subject(challenge)
    assert subject == expected_subject
    assert remainder == expected_remainder


@pytest.mark.parametrize(
    "challenge",
    [
        "invalid:",
        "invalid",
    ],
)
def test_parse_subject_invalid(challenge: str) -> None:
    with pytest.raises(ValueError):
        authorize.parse_subject(challenge)


@pytest.mark.parametrize(
    ("response", "expected_user", "expected_password", "expected_known_hosts"),
    [
        ("Basic c2NydWZmeTp6ZXJvZw==", "scruffy", "zerog", ""),
        ("Basic", "", "", ""),
    ],
)
def test_parse_basic(
    response: str, expected_user: str, expected_password: str, expected_known_hosts: str
) -> None:
    user, password, known_hosts = authorize.parse_basic(response)
    assert user == expected_user
    assert password == expected_password
    assert known_hosts == expected_known_hosts


@pytest.mark.parametrize(
    "response",
    [
        "Basic!c2NydWZmeTp6ZXJvZw==",
        "Basic c2Nyd!!ZmeTp6ZXJvZw==",
        "Basic c2NydWZmeXplcm9n",
    ],
)
def test_parse_basic_invalid(response: str) -> None:
    with pytest.raises(ValueError):
        authorize.parse_basic(response)


def test_build_basic() -> None:
    assert authorize.build_basic("scruffy", "zerog") == "Basic c2NydWZmeTp6ZXJvZw=="


def test_build_basic_roundtrip() -> None:
    result = authorize.build_basic("user", "pass")
    user, password, known_hosts = authorize.parse_basic(result)
    assert user == "user"
    assert password == "pass"
    assert known_hosts == ""


def test_build_basic_none() -> None:
    result = authorize.build_basic(None, None)
    user, password, known_hosts = authorize.parse_basic(result)
    assert user == ""
    assert password == ""
    assert known_hosts == ""


def test_build_basic_with_known_hosts() -> None:
    result = authorize.build_basic("user", "pass", "host1.example.com ssh-rsa AAAA...")
    user, password, known_hosts = authorize.parse_basic(result)
    assert user == "user"
    assert password == "pass"
    assert known_hosts == "host1.example.com ssh-rsa AAAA..."


@pytest.mark.parametrize(
    ("response", "expected"),
    [
        ("Negotiate c2NydWZmeTp6ZXJvZw==", b"scruffy:zerog"),
        ("Negotiate", b""),
    ],
)
def test_parse_negotiate(response: str, expected: bytes) -> None:
    assert authorize.parse_negotiate(response) == expected


@pytest.mark.parametrize(
    "response",
    [
        "Negotiate!c2NydWZmeTp6ZXJvZw==",
        "Negotiate c2Nyd!!ZmeTp6ZXJvZw==",
    ],
)
def test_parse_negotiate_invalid(response: str) -> None:
    with pytest.raises(ValueError):
        authorize.parse_negotiate(response)


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (b"scruffy:zerog", "Negotiate c2NydWZmeTp6ZXJvZw=="),
        (None, "Negotiate"),
        (b"", "Negotiate"),
    ],
)
def test_build_negotiate(data: bytes | None, expected: str) -> None:
    assert authorize.build_negotiate(data) == expected


def test_build_negotiate_roundtrip() -> None:
    data = b"some binary \x00 data"
    result = authorize.build_negotiate(data)
    assert authorize.parse_negotiate(result) == data


@pytest.mark.parametrize(
    ("response", "expected_conversation", "expected_prompt"),
    [
        ("X-Conversation abcdefghi c2NydWZmeTp6ZXJvZw==", "abcdefghi", "scruffy:zerog"),
        ("X-Conversation abcdefghi", "abcdefghi", ""),
    ],
)
def test_parse_x_conversation(
    response: str, expected_conversation: str, expected_prompt: str
) -> None:
    conversation, prompt = authorize.parse_x_conversation(response)
    assert conversation == expected_conversation
    assert prompt == expected_prompt


def test_parse_x_conversation_invalid() -> None:
    with pytest.raises(ValueError):
        authorize.parse_x_conversation("X-Conversation abcdefghi c2NydW!!meTp6ZXJvZw==")


def test_build_x_conversation_with_prompt() -> None:
    result, conv = authorize.build_x_conversation("scruffy:zerog", "abcdefghi")
    assert result == "X-Conversation abcdefghi c2NydWZmeTp6ZXJvZw=="
    assert conv == "abcdefghi"


def test_build_x_conversation_no_prompt() -> None:
    result, conv = authorize.build_x_conversation("", "abcdefghi")
    assert result == "X-Conversation abcdefghi"
    assert conv == "abcdefghi"


def test_build_x_conversation_generate() -> None:
    result, conv = authorize.build_x_conversation("scruffy:zerog", None)
    assert conv
    assert "c2NydWZmeTp6ZXJvZw==" in result
    assert conv in result


def test_build_x_conversation_empty_invalid() -> None:
    with pytest.raises(ValueError):
        authorize.build_x_conversation("scruffy:zerog", "")


def test_build_x_conversation_roundtrip() -> None:
    prompt = "test prompt"
    result, conv = authorize.build_x_conversation(prompt, None)
    parsed_conv, parsed_prompt = authorize.parse_x_conversation(result)
    assert parsed_conv == conv
    assert parsed_prompt == prompt
