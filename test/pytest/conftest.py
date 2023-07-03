import asyncio
import os
import subprocess
import sys
from typing import Iterable

import pytest

from cockpit import polyfills
from cockpit._vendor.systemd_ctypes import EventLoopPolicy

polyfills.install()


def my_subprocesses():
    try:
        return subprocess.check_output(['pgrep', '-a', '-P', f'{os.getpid()}'], universal_newlines=True).splitlines()
    except subprocess.CalledProcessError:
        # no processes found?  good!
        return []


def assert_no_subprocesses():
    running = my_subprocesses()
    if not running:
        return

    print('Some subprocesses still running', running)

    # Clear it out for the sake of the other tests
    subprocess.call(['pkill', '-9', '-P', f'{os.getpid()}'])
    try:
        for _ in range(100):  # zombie vacuum
            os.waitpid(-1, os.WNOHANG)
    except OSError:
        pass
    pytest.fail('failed to reap all children')


@pytest.fixture(autouse=True)
def event_loop(monkeypatch) -> Iterable[asyncio.AbstractEventLoop]:
    loop = EventLoopPolicy().new_event_loop()

    if sys.version_info < (3, 7, 0):
        # Polyfills for Python 3.6:
        def all_tasks(loop=loop):
            return {t for t in asyncio.Task.all_tasks(loop=loop) if not t.done()}

        monkeypatch.setattr(asyncio, 'get_running_loop', lambda: loop, raising=False)
        monkeypatch.setattr(asyncio, 'create_task', loop.create_task, raising=False)
        monkeypatch.setattr(asyncio, 'all_tasks', all_tasks, raising=False)

    yield loop

    # Let things settle for a bit
    for _ in range(200):
        # We expect at least one task: ourselves!
        if not asyncio.all_tasks(loop=loop) and not my_subprocesses():
            break
        loop.run_until_complete(asyncio.sleep(0.005))

    assert asyncio.all_tasks(loop=loop) == set()
    assert_no_subprocesses()

    loop.close()
