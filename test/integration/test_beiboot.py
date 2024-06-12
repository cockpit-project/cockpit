import argparse
import asyncio
import json
import subprocess
from pathlib import Path
from typing import Iterable

import pytest
import testvm
from lib.constants import BOTS_DIR

from cockpit.beiboot import Destination, ForwarderRouter, parse_destination
from cockpit.jsonutil import JsonDocument, JsonObject, JsonValue, get_dict, get_str

from ..pytest.mocktransport import MockTransport

PRIVATE_KEY_PATH = f'{BOTS_DIR}/machine/identity'
LECTURE = '''
We trust you have received the usual lecture from the local System
Administrator. It usually boils down to these three things:

    #1) Respect the privacy of others.
    #2) Think before you type.
    #3) With great power comes great responsibility.

For security reasons, the password you type will not be visible.

'''


@pytest.fixture(scope='session')
def machine() -> 'Iterable[testvm.Machine]':
    vm = testvm.VirtMachine('fedora-39', verbose=1)
    vm.start()
    vm.wait_boot(timeout_sec=120)
    yield vm
    vm.kill()


@pytest.fixture(scope='session')
def machine_hostname(machine: 'testvm.Machine') -> str:
    return f'[{machine.ssh_address}]:{machine.ssh_port}'


@pytest.fixture(scope='session')
def destination(machine_hostname: str) -> Destination:
    return parse_destination(f'admin@{machine_hostname}')


@pytest.fixture(scope='session')
def machine_hostkeys(machine: 'testvm.Machine', machine_hostname: str) -> 'tuple[str, ...]':
    all_keys = machine.execute('cat /etc/ssh/ssh_host_*_key.pub')
    machine.disconnect()
    return tuple(f'{machine_hostname} {key.strip()}' for key in all_keys.splitlines())


@pytest.fixture
def encrypted_key_path(tmp_path: Path) -> Path:
    # copy the original key
    path = tmp_path / 'identity_encrypted'
    path.write_bytes(Path(PRIVATE_KEY_PATH).read_bytes())
    path.chmod(0o600)  # or else SSH is going to complain
    # add a passphrase
    subprocess.run(['ssh-keygen', '-p', '-N', 's3cr3t', '-f', str(path)], check=True)
    return path


class SshConfig:
    attrs: 'dict[str, JsonValue]'
    path: Path
    config: Path
    known_hosts: Path

    def __init__(self, path: Path) -> None:
        self.attrs = {}

        self.path = path
        self.path.mkdir()
        self.config = path / 'config'
        self.known_hosts = path / 'known-hosts'
        self.set(UserKnownHostsFile=str(self.known_hosts))

    def set_hostkeys(self, hostkeys: 'tuple[str, ...]') -> None:
        self.known_hosts.write_text(''.join(f'{key}\n' for key in hostkeys))

    def set(self, **kwargs: JsonDocument) -> None:
        self.attrs.update(kwargs)
        self.config.write_text(''.join(f'{k} {json.dumps(v)}\n' for k, v in self.attrs.items()))


@pytest.fixture
def ssh_config(machine_hostkeys: 'tuple[str, ...]', tmp_path: Path) -> SshConfig:
    config = SshConfig(tmp_path / 'ssh_config')
    config.set_hostkeys(machine_hostkeys)
    return config


def make_package(pkgdir, dirname: str, **kwargs: object) -> None:
    (pkgdir / dirname).mkdir()
    with (pkgdir / dirname / 'manifest.json').open('w') as file:
        json.dump(kwargs, file, indent=2)


@pytest.fixture
def pkgdir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv('XDG_DATA_DIRS', str(tmp_path))
    monkeypatch.setenv('XDG_DATA_HOME', '/x')

    self = tmp_path / 'cockpit'
    self.mkdir()
    make_package(self, 'basic', description="standard package", requires={"cockpit": "42"})
    return self


@pytest.fixture
def router(
    destination: Destination, pkgdir: Path, monkeypatch: pytest.MonkeyPatch, ssh_config: SshConfig
) -> ForwarderRouter:
    monkeypatch.setenv('SSH_CMD', f'ssh -F {ssh_config.config!s}')

    args = argparse.Namespace(
        never=False,
        always=False,
        destination=destination,
        interactive=False,
    )

    return ForwarderRouter(args)


@pytest.fixture
def transport(router: ForwarderRouter, event_loop: asyncio.AbstractEventLoop) -> Iterable[MockTransport]:
    transport = MockTransport(router, connected=False)
    yield transport
    transport.stop(event_loop)


def test_parse_destination() -> None:
    cases = [
        ('a', (None, 'a', None)),
        ('u@a', ('u', 'a', None)),
        ('a:123', (None, 'a', '123')),
        ('a:bcd', (None, 'a:bcd', None)),
        ('a@b@c', ('a', 'b@c', None)),
        ('1:2', (None, '1', '2')),
        ('1:2:3', (None, '1:2:3', None)),
        ('[2::1]', (None, '[2::1]', None)),
        ('[2::1]:3', (None, '2::1', '3')),
        ('[host]:3', (None, 'host', '3')),
    ]

    for destination, (user, host, port) in cases:
        assert parse_destination(destination) == Destination(user, host, port)


@pytest.mark.asyncio
async def test_unknown_host(ssh_config: SshConfig, transport: MockTransport) -> None:
    ssh_config.set_hostkeys(())  # clear

    transport.connect()
    await transport.auth('*', user='admin', password='foobar')
    init_msg = await transport.assert_msg('', command='init')
    assert get_str(init_msg, 'problem') == 'unknown-host'
    assert 'host-fingerprint' not in init_msg
    assert 'host-key' not in init_msg


@pytest.mark.asyncio
async def test_unknown_hostkey(
        machine_hostkeys: 'tuple[str, ...]',
        monkeypatch: pytest.MonkeyPatch,
        ssh_config: SshConfig,
        transport: MockTransport,
) -> None:
    monkeypatch.setenv('COCKPIT_SSH_CONNECT_TO_UNKNOWN_HOSTS', '1')
    ssh_config.set_hostkeys(())  # clear

    await transport.auth('*', user='admin', password='foobar')

    # Reject the host key interaction
    auth = await transport.assert_msg('', command='authorize')
    assert get_str((auth), 'challenge').startswith('X-Conversation ')
    transport.send_json('', command='authorize', cookie=auth['cookie'], response='')

    init_msg = await transport.assert_msg('', command='init')
    assert get_str(init_msg, 'problem') == 'unknown-hostkey'
    assert get_str(init_msg, 'host-key') in machine_hostkeys
    assert get_str(init_msg, 'host-fingerprint')


@pytest.mark.asyncio
async def test_invalid_hostkey(
        machine_hostname: str,
        ssh_config: SshConfig,
        transport: MockTransport,
) -> None:
    # structurally valid, but incorrect
    bogus_key = 'AAAAC3NzaC1lZDI1NTE5AAAAIL1uBjDc9o9jut1/iKNjuM6c/BI8idqDs32c5W3zdxbx'
    ssh_config.set_hostkeys((f'{machine_hostname} ssh-ed25519 {bogus_key}',))

    await transport.auth('*', user='admin', password='foobar')
    init_msg = await transport.assert_msg('', command='init')
    assert get_str(init_msg, 'problem') == 'invalid-hostkey'
    assert 'host-fingerprint' not in init_msg
    assert 'host-key' not in init_msg


@pytest.mark.asyncio
async def test_invalid_hostkey_query(
        machine_hostname: str,
        machine_hostkeys: 'tuple[str, ...]',
        monkeypatch: pytest.MonkeyPatch,
        ssh_config: SshConfig,
        transport: MockTransport,
) -> None:
    # structurally valid, but incorrect
    bogus_key = 'AAAAC3NzaC1lZDI1NTE5AAAAIL1uBjDc9o9jut1/iKNjuM6c/BI8idqDs32c5W3zdxbx'
    ssh_config.set_hostkeys((f'{machine_hostname} ssh-ed25519 {bogus_key}',))

    monkeypatch.setenv('COCKPIT_SSH_CONNECT_TO_UNKNOWN_HOSTS', '1')

    await transport.auth('*', user='admin', password='foobar')
    init_msg = await transport.assert_msg('', command='init')
    assert get_str(init_msg, 'problem') == 'invalid-hostkey'
    assert get_str(init_msg, 'host-key') in machine_hostkeys
    assert get_str(init_msg, 'host-fingerprint')


def assert_usr_bin_cockpit(init_msg: JsonObject) -> None:
    # make sure it looks like the packages from the remote
    assert 'system' in get_dict(init_msg, 'packages')
    assert 'basic' not in get_dict(init_msg, 'packages')


def assert_beipack_cockpit(init_msg: JsonObject) -> None:
    # make sure it looks like the packages from locally
    assert 'system' not in get_dict(init_msg, 'packages')
    assert 'basic' in get_dict(init_msg, 'packages')


@pytest.mark.asyncio
async def test_private_key(transport: MockTransport, ssh_config: SshConfig) -> None:
    ssh_config.set(IdentityFile=PRIVATE_KEY_PATH)

    await transport.auth('*', user='admin')
    init_msg = await transport.assert_msg('', command='init')
    assert_usr_bin_cockpit(init_msg)


@pytest.mark.asyncio
async def test_locked_key(
        transport: MockTransport, ssh_config: SshConfig, encrypted_key_path: Path
) -> None:
    ssh_config.set(IdentityFile=str(encrypted_key_path))

    await transport.auth('*', user='admin')
    init_msg = await transport.assert_msg('', command='init')
    assert get_str(init_msg, 'problem') == 'authentication-failed'
    assert get_str(init_msg, 'error') == f'locked identity: {encrypted_key_path!s}'


@pytest.mark.asyncio
async def test_conds(
        transport: MockTransport, router: ForwarderRouter, pkgdir: Path, machine: 'testvm.Machine'
) -> None:
    # make sure package conditions work against the remote filesystem
    make_package(pkgdir, 'empty', conditions=[])

    # This file definitely exists locally but not on the remote.
    # This makes sure the checks are done remotely.
    does_not_exist = __file__

    # This file is unlikely to exist locally but will exist in the image
    machine.execute('touch /tmp/unusual-flagfile')
    exists = '/tmp/unusual-flagfile'

    # path-exists only
    make_package(pkgdir, 'exists-1-yes', conditions=[{'path-exists': exists}])
    make_package(pkgdir, 'exists-1-no', conditions=[{'path-exists': does_not_exist}])
    make_package(pkgdir, 'exists-2-yes', conditions=[{"path-exists": exists},
                                                     {"path-exists": "/bin/sh"}])
    make_package(pkgdir, 'exists-2-no', conditions=[{"path-exists": exists},
                                                    {"path-exists": does_not_exist}])

    # path-not-exists only
    make_package(pkgdir, 'notexists-1-yes', conditions=[{"path-not-exists": does_not_exist}])
    make_package(pkgdir, 'notexists-1-no', conditions=[{"path-not-exists": exists}])
    make_package(pkgdir, 'notexists-2-yes', conditions=[{"path-not-exists": does_not_exist},
                                                        {"path-not-exists": "/obscure"}])
    make_package(pkgdir, 'notexists-2-no', conditions=[{"path-not-exists": does_not_exist},
                                                       {"path-not-exists": exists}])

    # mixed
    make_package(pkgdir, 'mixed-yes', conditions=[{"path-exists": exists},
                                                  {"path-not-exists": does_not_exist}])
    make_package(pkgdir, 'mixed-no', conditions=[{"path-exists": does_not_exist},
                                                 {"path-not-exists": "/obscure"}])

    # unknown -- should not get filtered
    make_package(pkgdir, 'unknown', conditions=[{"bzzt": "foo"}])

    router.args.always = True
    await transport.auth('*', user='admin', password='foobar')
    init_msg = await transport.assert_msg('', command='init')
    assert set(get_dict(init_msg, 'packages')) == {
        'basic', 'empty', 'exists-1-yes', 'exists-2-yes', 'notexists-1-yes', 'notexists-2-yes', 'mixed-yes', 'unknown'
    }

    machine.disconnect()


@pytest.mark.asyncio
async def test_interactive_invalid_hostkey(
        ssh_config: SshConfig, transport: MockTransport, router: ForwarderRouter, machine_hostname: str
) -> None:
    # structurally valid, but incorrect
    bogus_key = 'AAAAC3NzaC1lZDI1NTE5AAAAIL1uBjDc9o9jut1/iKNjuM6c/BI8idqDs32c5W3zdxbx'
    ssh_config.set_hostkeys((f'{machine_hostname} ssh-ed25519 {bogus_key}',))
    router.args.interactive = True

    init_msg = await transport.assert_msg('', command='init', problem='invalid-hostkey')
    assert 'host-fingerprint' not in init_msg
    assert 'host-key' not in init_msg


@pytest.mark.asyncio
async def test_interactive_tofu_no(
        ssh_config: SshConfig, transport: MockTransport, router: ForwarderRouter
) -> None:
    ssh_config.set_hostkeys(())  # clear
    router.args.interactive = True

    await transport.ferny_auth('SshHostKeyPrompt', response='no')
    await transport.assert_msg('', command='init', problem='unknown-host')


@pytest.mark.asyncio
async def test_interactive_tofu_yes(
        ssh_config: SshConfig, transport: MockTransport, router: ForwarderRouter
) -> None:
    ssh_config.set_hostkeys(())  # clear
    router.args.interactive = True

    await transport.ferny_auth('SshHostKeyPrompt', response='yes')

    await transport.ferny_auth('SshPasswordPrompt', response='foobar')

    init_msg = await transport.assert_msg('', command='init')
    assert 'problem' not in init_msg


@pytest.mark.asyncio
async def test_locked_key_interactive(
        router: ForwarderRouter, transport: MockTransport, ssh_config: SshConfig, encrypted_key_path: Path
) -> None:
    ssh_config.set(IdentityFile=str(encrypted_key_path))
    router.args.interactive = True

    # 3 times
    await transport.ferny_auth('SshPassphrasePrompt', response='wrong passphrase')
    await transport.ferny_auth('SshPassphrasePrompt', response='wrong passphrase')
    await transport.ferny_auth('SshPassphrasePrompt', response='wrong passphrase')

    # now it will fall back to this
    await transport.ferny_auth('SshPasswordPrompt', response='foobar')

    init_msg = await transport.assert_msg('', command='init')
    assert 'problem' not in init_msg


@pytest.mark.asyncio
async def test_unlocked_key_interactive(
        router: ForwarderRouter, transport: MockTransport, ssh_config: SshConfig, encrypted_key_path: Path
) -> None:
    ssh_config.set(IdentityFile=str(encrypted_key_path))
    router.args.interactive = True

    await transport.ferny_auth('SshPassphrasePrompt', 's3cr3t')
    init_msg = await transport.assert_msg('', command='init')
    assert 'problem' not in init_msg


@pytest.mark.asyncio
async def test_always(router: ForwarderRouter, transport: MockTransport, ssh_config: SshConfig) -> None:
    ssh_config.set(IdentityFile=PRIVATE_KEY_PATH)
    router.args.always = True

    await transport.auth('*', user='admin', password='foobar')
    init_msg = await transport.assert_msg('', command='init')
    assert_beipack_cockpit(init_msg)


@pytest.mark.asyncio
async def test_sudo_dbus(router: ForwarderRouter, transport: MockTransport, ssh_config: SshConfig) -> None:
    router.args.always = True
    await transport.auth('*', user='admin', password='foobar')
    init_msg = await transport.assert_msg('', command='init')
    assert_beipack_cockpit(init_msg)
    transport.send_init()

    await transport.assert_bus_props('/superuser', 'cockpit.Superuser',
                                     {'Bridges': ['sudo'], 'Current': 'none'})
    await transport.check_open('null', superuser=True, problem='access-denied')

    # start the bridge.  with a password this is more complicated
    await transport.add_bus_match('/superuser', 'cockpit.Superuser')
    await transport.ensure_internal_bus()
    start = transport.send_bus_call(transport.internal_bus, '/superuser',
                                    'cockpit.Superuser', 'Start', ['sudo'])
    # we'll be asked for a password
    await transport.assert_bus_signal('/superuser', 'cockpit.Superuser', 'Prompt',
                                      ['', '[sudo] password for admin: ', '', False, LECTURE])
    # give it
    await transport.check_bus_call('/superuser', 'cockpit.Superuser', 'Answer', ['foobar'])
    # Start call is now done
    await transport.assert_bus_reply(start, [])

    # XXX why don't those get sent
    """
    # first, init state
    await transport.assert_bus_notify('/superuser', 'cockpit.Superuser', {'Current': 'init'})
    # and now the bridge should be running
    await transport.assert_bus_notify('/superuser', 'cockpit.Superuser', {'Current': 'sudo'})
    """
