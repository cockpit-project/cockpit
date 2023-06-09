import importlib.machinery
import importlib.util
import os
import sys
from pathlib import Path
from typing import List, Optional

import pytest

TOPDIR = os.path.realpath(__file__ + '../../../..')
COMMON_PATH = [
    f'{TOPDIR}/bots',
    f'{TOPDIR}/bots/machine',
    f'{TOPDIR}/test/common',
]


@pytest.hookimpl
def pytest_collect_file(file_path: Path, parent: pytest.Collector) -> Optional[pytest.Collector]:
    """Support for loading our check-* scripts as if they were modules

    Also adds our testlib paths to sys.path.  Doesn't check out the bots
    because it's not possible to run tests without first running
    test/image-prepare, and that will check out the bots automatically.
    """
    if file_path.name.startswith('check-'):
        # Pretend that test/verify/check-name is called like test.verify.check_name
        modname = 'test.verify.' + file_path.name.replace('-', '_')
        loader = importlib.machinery.SourceFileLoader(modname, str(file_path))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        assert spec is not None
        module = importlib.util.module_from_spec(spec)

        old_path = sys.path
        try:
            sys.path = [*COMMON_PATH, *sys.path]
            loader.exec_module(module)
        finally:
            sys.path = old_path

        # Return the tree node with our module pre-loaded inside of it
        collector = pytest.Module.from_parent(parent, path=file_path)
        collector._obj = module
        return collector

    return None


@pytest.hookimpl
def pytest_collection_modifyitems(session: pytest.Session, items: List[pytest.Item]) -> None:
    """Sorts the tests to place all non-destructive tests together"""
    assert isinstance(items, list)

    def is_nondestructive(item: pytest.Item) -> bool:
        attr = '_testlib__nondestructive'
        assert isinstance(item, pytest.Function)
        assert isinstance(item.parent, pytest.Class | pytest.Module)
        return getattr(item.obj, attr, getattr(item.parent.obj, attr, False))

    # put the destructive tests last under the assumption that they're slower
    items.sort(key=is_nondestructive, reverse=True)


@pytest.hookimpl
def pytest_configure(config: pytest.Config) -> None:
    """Tweaks test distribution for long-running tasks

    pytest-xdist sends large chunks of tasks to the workers to reduce
    latency, but since our tasks are long, this isn't helpful. It also
    means that we can end up with a large string of very slow tests on
    one worker. Disable it, if possible.

    https://github.com/pytest-dev/pytest-xdist/issues/855
    """
    try:
        # If parallel enabled and maxschedchunk not otherwise given...
        if config.option.numprocesses and config.option.maxschedchunk is None:
            config.option.maxschedchunk = 1
    except AttributeError:
        pass  # no pytest-xdist plugin installed, or plugin is too old
