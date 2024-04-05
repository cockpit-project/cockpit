# This file is part of Cockpit.
#
# Copyright (C) 2023 Red Hat, Inc.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

from enum import Enum
from typing import Callable, Container, Dict, List, Mapping, Optional, Sequence, Type, TypeVar, Union

JsonLiteral = Union[str, float, bool, None]

# immutable
JsonValue = Union['JsonObject', Sequence['JsonValue'], JsonLiteral]
JsonObject = Mapping[str, JsonValue]

# mutable
JsonDocument = Union['JsonDict', 'JsonList', JsonLiteral]
JsonDict = Dict[str, JsonDocument]
JsonList = List[JsonDocument]


DT = TypeVar('DT')
T = TypeVar('T')


class JsonError(Exception):
    value: object

    def __init__(self, value: object, msg: str):
        super().__init__(msg)
        self.value = value


def typechecked(value: JsonValue, expected_type: Type[T]) -> T:
    """Ensure a JSON value has the expected type, returning it if so."""
    if not isinstance(value, expected_type):
        raise JsonError(value, f'must have type {expected_type.__name__}')
    return value


# We can't use None as a sentinel because it's often the actual default value
# EllipsisType is difficult because it's not available before 3.10.
# See https://peps.python.org/pep-0484/#support-for-singleton-types-in-unions
class _Empty(Enum):
    TOKEN = 0


_empty = _Empty.TOKEN


def _get(obj: JsonObject, cast: Callable[[JsonValue], T], key: str, default: Union[DT, _Empty]) -> Union[T, DT]:
    try:
        return cast(obj[key])
    except KeyError:
        if default is not _empty:
            return default
        raise JsonError(obj, f"attribute '{key}' required") from None
    except JsonError as exc:
        target = f"attribute '{key}'" + (' elements:' if exc.value is not obj[key] else ':')
        raise JsonError(obj, f"{target} {exc!s}") from exc


def get_bool(obj: JsonObject, key: str, default: Union[DT, _Empty] = _empty) -> Union[DT, bool]:
    return _get(obj, lambda v: typechecked(v, bool), key, default)


def get_int(obj: JsonObject, key: str, default: Union[DT, _Empty] = _empty) -> Union[DT, int]:
    return _get(obj, lambda v: typechecked(v, int), key, default)


def get_str(obj: JsonObject, key: str, default: Union[DT, _Empty] = _empty) -> Union[DT, str]:
    return _get(obj, lambda v: typechecked(v, str), key, default)


def get_str_or_none(obj: JsonObject, key: str, default: Optional[str]) -> Optional[str]:
    return _get(obj, lambda v: None if v is None else typechecked(v, str), key, default)


def get_dict(obj: JsonObject, key: str, default: Union[DT, _Empty] = _empty) -> Union[DT, JsonObject]:
    return _get(obj, lambda v: typechecked(v, dict), key, default)


def get_object(
    obj: JsonObject,
    key: str,
    constructor: Callable[[JsonObject], T],
    default: Union[DT, _Empty] = _empty
) -> Union[DT, T]:
    return _get(obj, lambda v: constructor(typechecked(v, dict)), key, default)


def get_strv(obj: JsonObject, key: str, default: Union[DT, _Empty] = _empty) -> Union[DT, Sequence[str]]:
    def as_strv(value: JsonValue) -> Sequence[str]:
        return tuple(typechecked(item, str) for item in typechecked(value, list))
    return _get(obj, as_strv, key, default)


def get_enum(
    obj: JsonObject, key: str, choices: Container[str], default: Union[DT, _Empty] = _empty
) -> Union[DT, str]:
    def as_choice(value: JsonValue) -> str:
        # mypy can't do `__eq__()`-based type narrowing...
        # https://github.com/python/mypy/issues/17101
        if isinstance(value, str) and value in choices:
            return value
        raise JsonError(value, f'invalid value "{value}" not in {choices}')
    return _get(obj, as_choice, key, default)


def get_objv(obj: JsonObject, key: str, constructor: Callable[[JsonObject], T]) -> Union[DT, Sequence[T]]:
    def as_objv(value: JsonValue) -> Sequence[T]:
        return tuple(constructor(typechecked(item, dict)) for item in typechecked(value, list))
    return _get(obj, as_objv, key, ())


def create_object(message: 'JsonObject | None', kwargs: JsonObject) -> JsonObject:
    """Constructs a JSON object based on message and kwargs.

    If only message is given, it is returned, unmodified.  If message is None,
    it is equivalent to an empty dictionary.  A copy is always made.

    If kwargs are present, then any underscore ('_') present in a key name is
    rewritten to a dash ('-').  This is intended to bridge between the required
    Python syntax when providing kwargs and idiomatic JSON (which uses '-' for
    attributes).  These values override values in message.

    The idea is that `message` should be used for passing data along, and
    kwargs used for data originating at a given call site, possibly including
    modifications to an original message.
    """
    result = dict(message or {})

    for key, value in kwargs.items():
        # rewrite '_' (necessary in Python syntax kwargs list) to '-' (idiomatic JSON)
        json_key = key.replace('_', '-')
        result[json_key] = value

    return result


def json_merge_patch(current: JsonObject, patch: JsonObject) -> JsonObject:
    """Perform a JSON merge patch (RFC 7396) using 'current' and 'patch'.
    Neither of the original dictionaries is modified — the result is returned.
    """
    # Always take a copy ('result') — we never modify the input ('current')
    result = dict(current)
    for key, patch_value in patch.items():
        if isinstance(patch_value, Mapping):
            current_value = current.get(key, None)
            if not isinstance(current_value, Mapping):
                current_value = {}
            result[key] = json_merge_patch(current_value, patch_value)
        elif patch_value is not None:
            result[key] = patch_value
        else:
            result.pop(key, None)

    return result


def json_merge_and_filter_patch(current: JsonDict, patch: JsonDict) -> None:
    """Perform a JSON merge patch (RFC 7396) modifying 'current' with 'patch'.
    Also modifies 'patch' to remove redundant operations.
    """
    for key, patch_value in tuple(patch.items()):
        current_value = current.get(key, None)

        if isinstance(patch_value, dict):
            if not isinstance(current_value, dict):
                current[key] = current_value = {}
                json_merge_and_filter_patch(current_value, patch_value)
            else:
                json_merge_and_filter_patch(current_value, patch_value)
                if not patch_value:
                    del patch[key]
        elif current_value == patch_value:
            del patch[key]
        elif patch_value is not None:
            current[key] = patch_value
        else:
            del current[key]
