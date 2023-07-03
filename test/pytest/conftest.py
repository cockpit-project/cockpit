import asyncio
import os
import subprocess
from typing import Iterable

import pytest

from cockpit._vendor.systemd_ctypes import EventLoopPolicy


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


@pytest.fixture
def event_loop() -> Iterable[asyncio.AbstractEventLoop]:
    loop = EventLoopPolicy().new_event_loop()

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
