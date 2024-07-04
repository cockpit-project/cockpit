import glob
import os
from typing import AsyncIterator, Iterable

import pytest
import pytest_asyncio

from .mockwebserver import mock_webserver
from .webdriver_bidi import BrowsingContext, WebdriverDriver, WebdriverSession

SRCDIR = os.path.realpath(f'{__file__}/../../..')
BUILDDIR = os.environ.get('abs_builddir', SRCDIR)

SKIP = {
    'base1/test-dbus-address.html',
}

XFAIL = {
    'base1/test-websocket.html',
}


# Changed in version 3.10: Added the root_dir and dir_fd parameters.
def glob_py310(fnmatch: str, *, root_dir: str, recursive: bool = False) -> Iterable[str]:
    prefix = f'{root_dir}/'
    prefixlen = len(prefix)

    for result in glob.glob(f'{prefix}{fnmatch}', recursive=recursive):
        assert result.startswith(prefix)
        yield result[prefixlen:]


@pytest_asyncio.fixture
async def browsing_session() -> AsyncIterator[WebdriverSession]:
    async with WebdriverDriver.connect() as driver:
        print('driver', driver)
        async with driver.start_session() as session:
            print('session', session)
            yield session
            print('session down', session)
        print('driver down', driver)


@pytest_asyncio.fixture
async def tab(browsing_session: WebdriverSession) -> AsyncIterator[BrowsingContext]:
    async with browsing_session.create_context() as context:
        print('context', context)
        yield context
        print('context down', context)


@pytest.mark.asyncio
@pytest.mark.parametrize('html', glob_py310('**/test-*.html', root_dir=f'{SRCDIR}/qunit', recursive=True))
async def test_browser(tab: BrowsingContext, html: str) -> None:
    if html in SKIP:
        pytest.skip()
    elif html in XFAIL:
        pytest.xfail()

    async with mock_webserver() as url:
        log = await tab.session.subscribe_console()
        await tab.navigate(f'{url}qunit/{html}')

        ignore_resource_errors = False
        error_message = None

        async for message in log:
            if message.type == 'console':
                print('LOG', message.text)

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

        print('test done')

    print('webserver down')


# run test-timeformat.ts in different time zones: west/UTC/east
@pytest.mark.asyncio
@pytest.mark.parametrize('tz', ['America/Toronto', 'Europe/London', 'UTC', 'Europe/Berlin', 'Australia/Sydney'])
async def test_timeformat_timezones(tz: str, monkeypatch: pytest.MonkeyPatch) -> None:
    # this doesn't get built in rpm/deb package build environments, similar to test_browser()
    built_test = './qunit/base1/test-timeformat.html'
    if not os.path.exists(built_test):
        pytest.skip(f'{built_test} not found')

    monkeypatch.setenv('TZ', tz)
    await test_browser('base1/test-timeformat.html')
