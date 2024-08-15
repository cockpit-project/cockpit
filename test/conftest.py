import os
import subprocess
from typing import Iterator

import pytest

from cockpit._vendor import systemd_ctypes


# run tests on a private user bus
@pytest.fixture(scope='session', autouse=True)
def mock_session_bus(tmp_path_factory: pytest.TempPathFactory) -> Iterator[None]:
    # make sure nobody opened the user bus yet...
    assert systemd_ctypes.Bus._default_user_instance is None

    tmpdir = tmp_path_factory.getbasetemp()
    dbus_config = tmpdir / 'dbus-config'
    dbus_addr = f'unix:path={tmpdir / "dbus_socket"}'

    dbus_config.write_text(fr"""
      <busconfig>
        <fork/>
        <type>session</type>
        <listen>{dbus_addr}</listen>
        <policy context="default">
          <!-- Allow everything to be sent -->
          <allow send_destination="*" eavesdrop="true"/>
          <!-- Allow everything to be received -->
          <allow eavesdrop="true"/>
          <!-- Allow anyone to own anything -->
          <allow own="*"/>
        </policy>
      </busconfig>
    """)
    try:
        dbus_daemon = subprocess.run(
            ['dbus-daemon', f'--config-file={dbus_config}', '--print-pid'], stdout=subprocess.PIPE
        )
    except FileNotFoundError:
        yield None  # no dbus-daemon?  Don't patch.
        return

    pid = int(dbus_daemon.stdout)
    os.environ['DBUS_SESSION_BUS_ADDRESS'] = dbus_addr

    try:
        yield None
    finally:
        os.kill(pid, 9)
