import os
import pytest
import subprocess


@pytest.fixture(scope="session", autouse=True)
def dbus_daemon_session():
    """Fixture to start D-Bus message bus session daemon for use in the whole test suite.
    """
    dbus_daemon = subprocess.Popen(['dbus-daemon', '--session', '--print-address'],
                                   stdout=subprocess.PIPE, universal_newlines=True)
    os.environ['DBUS_SESSION_BUS_ADDRESS'] = dbus_daemon.stdout.readline().strip()
    yield
    dbus_daemon.terminate()
    dbus_daemon.wait(timeout=10)
