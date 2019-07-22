#!/usr/bin/python3

# This file is part of Cockpit.
#
# Copyright (C) 2016 Red Hat, Inc.
#
# Cockpit is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation; either version 2.1 of the License, or
# (at your option) any later version.
#
# Cockpit is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
# Author: Miloš Prchlík (https://gist.github.com/happz/d50897af8a2e90cce8c7)

import signal
import time


class TimeoutError(RuntimeError):
    pass


class Timeout(object):
    def __init__(self, retry, timeout):
        self.retry = retry
        self.timeout = timeout

    def __enter__(self):
        def timeout_handler(signum, frame):
            if __debug__:
                self.retry.timeouts_triggered += 1

            raise TimeoutError("%is timeout reached" % self.timeout)

        self.orig_sighand = signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(self.timeout)

    def __exit__(self, type, value, traceback):
        signal.alarm(0)
        signal.signal(signal.SIGALRM, self.orig_sighand)


class NOPTimeout(object):
    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        pass

    def __exit__(self, *args, **kwargs):
        pass


class Retry(object):
    def __init__(self, attempts=1, timeout=None, exceptions=(), error=None, inverse=False, delay=None):
        """
        Try to run things ATTEMPTS times, at max, each attempt must not exceed TIMEOUT seconds.
        Restart only when one of EXCEPTIONS is raised, all other exceptions will just bubble up.
        When the maximal number of attempts is reached, raise ERROR. Wait DELAY seconds between
        attempts.
        When INVERSE is True, successful return of wrapped code is considered as a failure.
        """

        self.attempts = attempts
        self.timeout = timeout
        self.exceptions = exceptions
        self.error = error or Exception('Too many retries!')
        self.inverse = inverse
        self.timeout_wrapper = Timeout if timeout is not None else NOPTimeout
        self.delay = delay if delay is not None else timeout

        # some accounting, for testing purposes
        if __debug__:
            self.failed_attempts = 0
            self.timeouts_triggered = 0

    def handle_failure(self, start_time):
        if __debug__:
            self.failed_attempts += 1

        self.attempts -= 1
        if self.attempts == 0:
            raise self.error

        # Before the next iteration sleep $delay seconds. It's the
        # remaining time to the $timeout Since it makes not much sense
        # to feed time.sleep() with negative delays, return None.

        if self.delay is None:
            return None

        delay = self.delay - (time.time() - start_time)
        return delay if delay > 0 else None

    def __call__(self, fn):
        def __wrap(*args, **kwargs):
            # This is not an endless loop. It will be broken by
            # 1) first "successful" return of fn() - taking self.inverse into account, of course - or
            # 2) by decrementing self.attempts to zero, or
            # 3) when unexpected exception is raised by fn().

            output = None
            delay = None  # no delay yet

            while True:
                if delay is not None:
                    time.sleep(delay)

                with self.timeout_wrapper(self, self.timeout):
                    start_time = time.time()

                    try:
                        output = fn(*args, **kwargs)
                        if not self.inverse:
                            return output

                    except (self.exceptions + (TimeoutError,)):
                        if self.inverse:
                            return True

                        # Handle exceptions we are expected to catch, by logging a failed
                        # attempt, and checking the number of attempts.
                        delay = self.handle_failure(start_time)
                        continue

                    except Exception as e:
                        # Handle all other exceptions, by logging a failed attempt and
                        # re-raising the exception, effectively killing the loop.
                        if __debug__:
                            self.failed_attempts += 1
                        raise e

                delay = self.handle_failure(start_time)

        return __wrap


def wait(func, msg=None, delay=1, tries=60):
    """
    Wait for FUNC to return something truthy, and return that.

    FUNC is called repeatedly until it returns a true value or until a
    timeout occurs.  In the latter case, a exception is raised that
    describes the situation.  The exception is either the last one
    thrown by FUNC, or includes MSG, or a default message.

    Arguments:
      func: The function to call.
      msg: A error message to use when the timeout occurs.  Defaults
        to a generic message.
      delay: How long to wait between calls to FUNC, in seconds.
        Defaults to 1.
      tries: How often to call FUNC.  Defaults to 60.

    Raises:
      TimeoutError: When a timeout occurs.
    """

    t = 0
    while t < tries:
        try:
            val = func()
            if val:
                return val
        except Exception:
            if t == tries - 1:
                raise
            else:
                pass
        t = t + 1
        time.sleep(delay)
    raise TimeoutError(msg or "Condition did not become true.")


if __name__ == '__main__':
    class IFailedError(Exception):
        pass

    white_horse = []

    # Simple "try so many times, and die" case
    @Retry(attempts=5, exceptions=(IFailedError,), error=IFailedError('Too many retries!'))
    def do_something1(a, b, c, d=79):
        white_horse.append(d)
        raise IFailedError()

    try:
        do_something1(2, 4, 6, d=97)

    except IFailedError:
        retry = do_something1.func_closure[1].cell_contents

        assert len(white_horse) == 5
        assert retry.failed_attempts == 5
        assert retry.timeouts_triggered == 0

    # Now with timeout
    black_horse = []
    brown_horse = []

    @Retry(attempts=2, timeout=5, error=IFailedError('Too many retries!'))
    def do_something2(a, b):
        black_horse.append(b)
        time.sleep(30)
        brown_horse.append(True)

    try:
        do_something2(1, 2)

    except IFailedError:
        retry = do_something2.func_closure[1].cell_contents

        assert not len(brown_horse)
        assert len(black_horse) == 2
        assert retry.timeouts_triggered == 2
        assert retry.failed_attempts == 2

    # And react only to a set of exceptions
    @Retry(attempts=3, exceptions=(ValueError,))
    def do_something3():
        raise IndexError('This one goes right to the top')

    try:
        do_something3()

    except IndexError:
        retry = do_something3.func_closure[1].cell_contents

        assert retry.failed_attempts == 1
        assert retry.timeouts_triggered == 0

    # Use inverted result of wrapped fn
    @Retry(attempts=1, timeout=1, exceptions=(IFailedError,), error=IFailedError('Too many retries!'), inverse=True)
    def do_something4():
        raise IFailedError('No, I did not!')

    assert do_something4() is True

    # Test delay usage
    red_horse = []

    @Retry(attempts=5, timeout=5, error=IFailedError('Too many retries!'), delay=20)
    def do_something5():
        red_horse.append(time.time())
        time.sleep(10)  # should be enough to get killed by watchdog

    try:
        start_time = time.time()

        do_something5()

    except IFailedError:
        end_time = time.time()

        retry = do_something5.func_closure[1].cell_contents

        assert retry.failed_attempts == 5
        assert retry.timeouts_triggered == 5

        for i in range(1, 5):
            assert red_horse[i] - red_horse[i - 1] >= 20.0, 'Interval #%i was shorter than expected: %f' % (i, red_horse[i] - red_horse[i - 1])

        assert (end_time - start_time) >= (4 * 20.0 + 5.0), 'All attempts took shorter time than expected: %f' % (end_time - start_time)

    # Immediately fail on unexpected exceptions
    @Retry(attempts=3)
    def do_something6():
        raise IndexError('This one goes right to the top')

    try:
        do_something6()

    except IndexError:
        retry = do_something6.func_closure[1].cell_contents

        assert retry.failed_attempts == 1
        assert retry.timeouts_triggered == 0
