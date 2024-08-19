import contextlib
import glob
import os
import re
import subprocess
from collections.abc import AsyncIterator

import lcov
import pytest
from js_coverage import CoverageReport
from webdriver_bidi import ChromiumBidi
from yarl import URL

SRCDIR = os.path.realpath(f'{__file__}/../../..')
BUILDDIR = os.environ.get('abs_builddir', SRCDIR)

SKIP = {
    'base1/test-dbus-address.html',
}

XFAIL = {
    'base1/test-websocket.html',
}


@contextlib.asynccontextmanager
async def spawn_test_server() -> AsyncIterator[URL]:  # noqa:RUF029
    if 'COVERAGE_RCFILE' in os.environ:
        coverage = ['coverage', 'run', '--parallel-mode', '--module']
    else:
        coverage = []

    # pass the address through a separate fd, so that we can see g_debug() messages (which go to stdout)
    addr_r, addr_w = os.pipe()
    try:
        server = subprocess.Popen(
            [f'{BUILDDIR}/test-server', 'python3', '-m', *coverage, 'cockpit.bridge'],
            env={**os.environ, 'TEST_SERVER_ADDRESS_FD': f'{addr_w}'},
            stdin=subprocess.DEVNULL, pass_fds=(addr_w,), close_fds=True
        )
    except FileNotFoundError:
        pytest.skip('No test-server')
    os.close(addr_w)
    address = os.read(addr_r, 1000).decode()
    os.close(addr_r)

    try:
        yield URL(address)
    finally:
        server.kill()
        server.wait()


@pytest.mark.asyncio
@pytest.mark.parametrize('html', glob.glob('**/test-*.html', root_dir=f'{SRCDIR}/qunit', recursive=True))
async def test_browser(coverage_report: CoverageReport, html: str) -> None:
    if html in SKIP:
        pytest.skip()
    elif html in XFAIL:
        pytest.xfail()

    async with (
        spawn_test_server() as base_url,
        ChromiumBidi(headless=os.environ.get('TEST_SHOW_BROWSER', '0') == '0') as browser
    ):
        await browser.cdp("Profiler.enable")
        await browser.cdp("Profiler.startPreciseCoverage", callCount=False, detailed=True)

        await browser.bidi(
            'browsingContext.navigate',
            context=browser.context,
            url=str(base_url / 'qunit' / html),
            wait='complete'
        )

        ignore_resource_errors = False
        error_message = None

        async for message in browser.logs:
            if message.type == 'console':
                if message.text == 'cockpittest-tap-done':
                    break
                elif message.text == 'cockpittest-tap-error':
                    error_message = message.text
                    break
                elif message.text == 'cockpittest-tap-expect-resource-error':
                    ignore_resource_errors = True
                    continue
                elif message.text.startswith('not ok'):
                    error_message = message.text

            elif message.type == 'warning':
                print('WARNING', message.text)

            else:
                print('OTHER', message.type, message.args, message.text)

                # fail on browser level errors
                if ignore_resource_errors and "Failed to load resource" in message.text:
                    continue

                error_message = message.text
                break
        else:
            pytest.fail("Didn't receive qunit end message")

        if error_message is not None:
            pytest.fail(f'Test failed: {error_message}')

        coverage = await browser.cdp("Profiler.takePreciseCoverage")
        lcov.write_lcov(coverage['result']['result'], outlabel=re.sub(r'[^A-Za-z0-9]+', '-', html))
        coverage_report(coverage['result'])


# run test-timeformat.ts in different time zones: west/UTC/east
@pytest.mark.asyncio
@pytest.mark.parametrize('tz', ['America/Toronto', 'Europe/London', 'UTC', 'Europe/Berlin', 'Australia/Sydney'])
async def test_timeformat_timezones(
    coverage_report: CoverageReport, tz: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv('TZ', tz)
    await test_browser(coverage_report, 'base1/test-timeformat.html')
