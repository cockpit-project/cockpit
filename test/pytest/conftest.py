import asyncio
import os
import subprocess
import sys
from typing import Iterable

import pytest

from cockpit import polyfills
from cockpit._vendor.systemd_ctypes import EventLoopPolicy

polyfills.install()


def any_subprocesses() -> bool:
    # Make sure we don't leak subprocesses
    try:
        os.waitid(os.P_ALL, -1, os.WEXITED | os.WNOHANG | os.WNOWAIT)
    except ChildProcessError:
        return False  # good !
    else:
        return True  # at least one process (or zombie) still waitable


if sys.version_info < (3, 7, 0):
    # Polyfills for Python 3.6 (plus compat with pre-event_loop_policy pytest-asyncio versions)

    @pytest.fixture(autouse=True)
    def event_loop(monkeypatch) -> Iterable[asyncio.AbstractEventLoop]:
        loop = EventLoopPolicy().new_event_loop()

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
