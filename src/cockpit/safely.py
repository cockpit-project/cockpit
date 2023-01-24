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

import contextlib

from typing import Callable, Dict, Generator, List, Mapping, Type, TypeVar, Union

T = TypeVar('T')
D = TypeVar('D')


@contextlib.contextmanager
def catch(description: str, on_error: Callable) -> Generator[None, None, None]:
    try:
        yield
    except (TypeError, KeyError) as err:
        on_error(f'{description}: {err}')
        raise


def get(mapping: Mapping[str, object], key: str, expected_type: Type[T], *default: D) -> Union[T, D]:
    try:
        value = mapping[key]
    except KeyError:
        if default:
            return default[0]
        raise

    if not isinstance(value, expected_type):
        raise TypeError(f"item '{key}' must have type '{expected_type.__name__}'")

    return value


def get_list(mapping: Mapping[str, object], key: str, expected_item_type: Type[T], *default: D) -> Union[List[T], D]:
    try:
        value = get(mapping, key, list)
    except KeyError:
        if default:
            return default[0]
        raise

    if not all(isinstance(item, expected_item_type) for item in value):
        raise TypeError(f"item '{key}' must have type 'list[{expected_item_type.__name__}]'")

    return value


def get_dict(mapping: Mapping[str, object], key: str, expected_item_type: Type[T], *default: D) -> Union[Dict[str, T], D]:
    try:
        value = get(mapping, key, dict)
    except KeyError:
        if default:
            return default[0]
        raise

    if not all(isinstance(item, expected_item_type) for item in value.values()):
        raise TypeError(f"item '{key}' must have type 'dict[str, {expected_item_type.__name__}]'")

    return value
