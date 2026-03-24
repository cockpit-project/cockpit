# Copyright (C) 2014 Red Hat, Inc.
# SPDX-License-Identifier: GPL-3.0-or-later

import base64
import logging
import re
import secrets

logger = logging.getLogger(__name__)


def parse_type(challenge: str) -> tuple[str, str]:
    """Extract the auth type from a challenge string.

    Returns (type, remainder) where type is lowercased.
    Raises ValueError if the challenge is invalid.
    """
    logger.debug("parsing type from challenge %r", challenge)

    auth_type, *remainder = re.split(r'[: ] *', challenge, maxsplit=1)
    if not auth_type:
        raise ValueError('invalid "authorize" message')

    logger.debug("parsed type %r, remainder %r", auth_type, remainder)
    return auth_type.lower(), remainder[0] if remainder else ""


def parse_subject(challenge: str) -> tuple[str, str]:
    """Extract the subject from a challenge string (after the type).

    Returns (subject, remainder).
    Raises ValueError if the challenge is invalid.
    """
    logger.debug("parsing subject from challenge %r", challenge)

    _, after_type = parse_type(challenge)

    subject, *remainder = re.split(r"[: ] *", after_type, maxsplit=1)
    if not subject:
        raise ValueError('invalid "authorize" message "challenge": no subject')

    logger.debug("parsed subject %r, remainder %r", subject, remainder)
    return subject, remainder[0] if remainder else ""


def parse_basic(challenge: str) -> tuple[str, str, str]:
    """Parse a Basic auth challenge.

    Returns (user, password, known_hosts).
    The format is: Basic base64(user:password\0known_hosts)
    Raises ValueError if the challenge is invalid.
    """
    logger.debug("parsing basic auth from %r", challenge)

    auth_type, remainder = parse_type(challenge)
    if auth_type != "basic":
        raise ValueError("invalid prefix in Basic header")

    token, _, _ = remainder.partition(" ")
    if not token:
        logger.debug("empty basic auth token")
        return "", "", ""

    try:
        decoded = base64.b64decode(token).decode("utf-8")
    except ValueError as exc:
        raise ValueError("invalid base64 data in Basic header") from exc

    if ":" not in decoded:
        raise ValueError("invalid base64 data in Basic header")

    user_password, _, known_hosts = decoded.partition("\0")
    user, _, password = user_password.partition(":")
    logger.debug("parsed basic auth for user %r", user)
    return user, password, known_hosts


def build_basic(
    user: str | None, password: str | None, known_hosts: str | None = None
) -> str:
    """Build a Basic auth response string.

    Format: Basic base64(user:password\0known_hosts)
    """
    user = user or ""
    password = password or ""
    logger.debug("building basic auth for user %r", user)

    content = f"{user}:{password}"
    if known_hosts:
        content = f"{content}\0{known_hosts}"
    encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")
    return f"Basic {encoded}"


def parse_negotiate(challenge: str) -> bytes:
    """Parse a Negotiate auth challenge.

    Returns the decoded token bytes.
    Raises ValueError if the challenge is invalid.
    """
    logger.debug("parsing negotiate auth from %r", challenge)

    auth_type, remainder = parse_type(challenge)
    if auth_type != "negotiate":
        raise ValueError("invalid prefix in Negotiate header")

    token, _, _ = remainder.partition(" ")

    try:
        data = base64.b64decode(token)
    except ValueError as exc:
        raise ValueError("invalid base64 data in Negotiate header") from exc

    logger.debug("parsed negotiate token of length %r", len(data))
    return data


def build_negotiate(data: bytes | None) -> str:
    """Build a Negotiate auth response string."""
    if not data:
        logger.debug("building empty negotiate response")
        return "Negotiate"

    logger.debug("building negotiate response for %r bytes", len(data))
    encoded = base64.b64encode(data).decode("ascii")
    return f"Negotiate {encoded}"


def parse_x_conversation(challenge: str) -> tuple[str, str]:
    """Parse an X-Conversation challenge.

    Returns (conversation_id, prompt).
    Raises ValueError if the challenge is invalid.
    """
    logger.debug("parsing x-conversation from %r", challenge)

    auth_type, _ = parse_type(challenge)
    if auth_type != "x-conversation":
        raise ValueError("invalid prefix in X-Conversation header")

    conversation, remainder = parse_subject(challenge)

    token, _, _ = remainder.partition(" ")

    try:
        prompt = base64.b64decode(token).decode("utf-8") if token else ""
    except ValueError as exc:
        raise ValueError("invalid base64 data in X-Conversation header") from exc

    logger.debug("parsed x-conversation %r with prompt %r", conversation, prompt)
    return conversation, prompt


def build_x_conversation(
    prompt: str | None, conversation: str | None = None
) -> tuple[str, str]:
    """Build an X-Conversation challenge string.

    If conversation is None, generates a new one.
    Returns (response_string, conversation_id).
    Raises ValueError if conversation is empty string.
    """
    prompt = prompt or ""
    logger.debug(
        "building x-conversation with prompt %r, conversation %r", prompt, conversation
    )

    if conversation is None:
        conversation = secrets.token_urlsafe(16)
        logger.debug("generated new conversation id %r", conversation)

    if not conversation:
        raise ValueError("invalid conversation nonce")

    if prompt:
        encoded = base64.b64encode(prompt.encode("utf-8")).decode("ascii")
        response = f"X-Conversation {conversation} {encoded}"
    else:
        response = f"X-Conversation {conversation}"

    return response, conversation
