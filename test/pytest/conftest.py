import asyncio
import os
import subprocess
from importlib.metadata import version
from pathlib import Path
from typing import TYPE_CHECKING, AsyncGenerator

import pytest
import pytest_asyncio
from packaging.specifiers import SpecifierSet

from cockpit._vendor.systemd_ctypes import EventLoopPolicy


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
#   - this also requires a bots/ checkout which we don't have in distros
if 'NO_QUNIT' in os.environ:
    @pytest.hookimpl
    def pytest_ignore_collect(collection_path: Path) -> bool:
        return collection_path.name == "test_browser.py"

    # if m.image in ['ubuntu-2204', '🙃']:
    if not TYPE_CHECKING and version("pytest") not in SpecifierSet(">=7.0"):
        @pytest.hookimpl
        def pytest_ignore_collect(path: object) -> bool:
            return Path(str(path)).name == "test_browser.py"


else:
    pytest_plugins = "js_coverage"


@pytest.fixture
def event_loop_policy() -> asyncio.AbstractEventLoopPolicy:
    return EventLoopPolicy()


# if m.image in ['ubuntu-2204', 'ubuntu-2404', '🙃']:
if version("pytest-asyncio") not in SpecifierSet(">=0.22"):
    # Compatibility with pre-`event_loop_policy` versions of pytest-asyncio
    @pytest.fixture(autouse=True)
    def event_loop() -> asyncio.AbstractEventLoop:
        return EventLoopPolicy().new_event_loop()


@pytest_asyncio.fixture(autouse=True)
async def _check_settled() -> AsyncGenerator[None, None]:
    yield

    current_task = asyncio.current_task()
    assert current_task is not None
    event_loop = asyncio.get_running_loop()

    # Let all tasks and subprocesses run to completion
    for _ in range(200):
        all_tasks = asyncio.all_tasks(loop=event_loop) - {current_task}
        if not (all_tasks or any_subprocesses()):
            break
        await asyncio.sleep(0.005)

    # No tasks left
    assert asyncio.all_tasks(loop=event_loop) == {current_task}

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
