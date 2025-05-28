import asyncio
import os
import subprocess
import sys
from typing import Any, AsyncGenerator, Iterable

import pytest
import pytest_asyncio

from cockpit import polyfills
from cockpit._vendor.systemd_ctypes import EventLoopPolicy

polyfills.install()

try:
    import pytest_asyncio._version
    have_event_loop_policy_fixture = pytest_asyncio._version.__version_tuple__ >= (0, 22)
except (ImportError, AttributeError):
    # old versions don't have __version_tuple__ or event_loop_policy
    have_event_loop_policy_fixture = False

# pytest fixture polyfill
# pytest_asyncio.fixture() was added in 0.22.0
if not hasattr(pytest_asyncio, 'fixture'):
    # mypy is strict here because of slightly different signatures.
    # On old versions of pytest_asyncio this is fine to do as `pytest.fixture`
    # was always used before `pytest_asyncio.fixture` existed.
    pytest_asyncio.fixture = pytest.fixture  # type: ignore[assignment]


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


def filter_current_task(tasks: 'set[asyncio.Task[Any]]',
                        current_task: 'asyncio.Task[Any]') -> 'set[asyncio.Task[Any]]':
    return {task for task in tasks if task is not current_task}


@pytest_asyncio.fixture(autouse=True)
async def _check_settled() -> AsyncGenerator[None, None]:
    yield

    # python 3.6 asyncio does not have 'current_task' attribute
    if hasattr(asyncio, 'current_task'):
        current_task = asyncio.current_task()
    else:
        current_task = asyncio.Task.current_task()  # type: ignore[attr-defined]
    assert current_task is not None
    event_loop = asyncio.get_running_loop()

    # Let all tasks and subprocesses run to completion
    for _ in range(200):
        all_tasks = filter_current_task(asyncio.all_tasks(loop=event_loop), current_task)
        if not (all_tasks or any_subprocesses()):
            break
        await asyncio.sleep(0.005)

    # No tasks left
    assert filter_current_task(asyncio.all_tasks(loop=event_loop), current_task) == set()

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
