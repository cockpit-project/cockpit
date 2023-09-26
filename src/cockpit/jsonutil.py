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
from typing import Callable, Dict, List, Optional, Sequence, Type, TypeVar, Union

JsonList = List['JsonDocument']
JsonObject = Dict[str, 'JsonDocument']
JsonLiteral = Union[str, float, bool, None]
JsonDocument = Union[JsonObject, JsonList, JsonLiteral]


DT = TypeVar('DT')
T = TypeVar('T')


class JsonError(Exception):
    value: object

    def __init__(self, value: object, msg: str):
        super().__init__(msg)
        self.value = value


def typechecked(value: JsonDocument, expected_type: Type[T]) -> T:
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


def _get(obj: JsonObject, cast: Callable[[JsonDocument], T], key: str, default: Union[DT, _Empty]) -> Union[T, DT]:
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
    def as_strv(value: JsonDocument) -> Sequence[str]:
        return tuple(typechecked(item, str) for item in typechecked(value, list))
    return _get(obj, as_strv, key, default)


def get_objv(obj: JsonObject, key: str, constructor: Callable[[JsonObject], T]) -> Union[DT, Sequence[T]]:
    def as_objv(value: JsonDocument) -> Sequence[T]:
        return tuple(constructor(typechecked(item, dict)) for item in typechecked(value, list))
    return _get(obj, as_objv, key, ())
