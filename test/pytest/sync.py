import logging

from .asyncbridge import AwaitableJob, SyncContextManager
from .mockwebserver import mock_webserver
from .webdriver_bidi import WebdriverDriver


def main() -> None:
    logging.basicConfig(level=logging.DEBUG)

    print('start')
    with SyncContextManager(mock_webserver()) as url:
        print('ws up', url)
        with SyncContextManager(WebdriverDriver.connect()) as driver:
            print('driver up', driver)
            with SyncContextManager(driver.start_session()) as session:
                print('session up', session)
                with SyncContextManager(session.create_context()) as context:
                    print('context up', context)
                    AwaitableJob.execute(context.navigate(url))
                    input('Press ENTER to exit')
                print('context down')
            print('session down')
        print('driver down')
    print('ws down, end.')


if __name__ == '__main__':
    main()
