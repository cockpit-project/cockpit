import asyncio
import os
import subprocess
import sys
from typing import Iterable

import pytest

from cockpit import polyfills
from cockpit._vendor.systemd_ctypes import EventLoopPolicy

polyfills.install()

try:
    import pytest_asyncio._version
    have_event_loop_policy_fixture = pytest_asyncio._version.__version_tuple__ >= (0, 22)
except (ImportError, AttributeError):
    # old versions don't have __version_tuple__ or event_loop_policy
    have_event_loop_policy_fixture = False


def any_subprocesses() -> bool:
    # Make sure we don't leak subprocesses
    try:
        os.waitid(os.P_ALL, -1, os.WEXITED | os.WNOHANG | os.WNOWAIT)
    except ChildProcessError:
        return False  # good !
    else:
        return True  # at least one process (or zombie) still waitable


# some issues:
#   - even sourcing this will break old python versions in ways we don't care to fix
#   - even sourcing this requires aiohttp, which isn't available everywhere
#   - there are general issues running under tox which need investigation
if 'NO_QUNIT' in os.environ:
    @pytest.hookimpl
    def pytest_ignore_collect(path) -> 'bool | None':
        return path.basename == 'test_browser.py' or None
else:
    pytest_plugins = "js_coverage"


if not have_event_loop_policy_fixture:
    # Compatibility with pre-`event_loop_policy` versions of pytest-asyncio

    @pytest.fixture(autouse=True)
    def event_loop(monkeypatch) -> Iterable[asyncio.AbstractEventLoop]:
        loop = EventLoopPolicy().new_event_loop()

        # Polyfills for Python 3.6
        if sys.version_info < (3, 7, 0):
            def all_tasks(loop=loop):
                return {t for t in asyncio.Task.all_tasks(loop=loop) if not t.done()}

            monkeypatch.setattr(asyncio, 'get_running_loop', lambda: loop, raising=False)
            monkeypatch.setattr(asyncio, 'create_task', loop.create_task, raising=False)
            monkeypatch.setattr(asyncio, 'all_tasks', all_tasks, raising=False)

        yield loop

        loop.close()

else:
    @pytest.fixture
    def event_loop_policy() -> asyncio.AbstractEventLoopPolicy:
        return EventLoopPolicy()


@pytest.fixture(autouse=True)
def _check_settled(event_loop) -> Iterable[None]:
    yield

    # Let all tasks and subprocesses run to completion
    for _ in range(200):
        if not (asyncio.all_tasks(event_loop) or any_subprocesses()):
            break
        event_loop.run_until_complete(asyncio.sleep(0.005))

    # No tasks left
    assert asyncio.all_tasks(loop=event_loop) == set()

    # No subprocesses left
    if any_subprocesses():
        # Bad news.  Show some helpful output.
        subprocess.run(['ps', 'f', f'--pid={os.getpid()}', f'--ppid={os.getpid()}'])
        # clear it out for the sake of the other tests
        subprocess.run(['pkill', '-9', '-P', f'{os.getpid()}'])
        try:
            for _ in range(100):  # zombie vacuum
                os.wait()
        except ChildProcessError:
            pass

        pytest.fail('Some subprocesses still running!')
