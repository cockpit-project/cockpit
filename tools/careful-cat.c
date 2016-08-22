#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <errno.h>
#include <signal.h>

/* Carefully cat stdin to stdout.
 *
 * This uses small writes and handles EAGAIN from write by waiting a
 * bit and trying again.
 *
 * This program is used in Travis to work around this bug:
 *
 *    https://github.com/travis-ci/travis-ci/issues/4704
 */

void
main (void)
{
  char buffer[1024], *ptr;
  int n, m;

  siginterrupt(SIGALRM, 1);

  while (1)
    {
      alarm(120);
      n = read (0, buffer, sizeof(buffer));
      alarm(0);
      if (n == 0)
        break;

      if (n < 0)
        {
          perror("read");
          exit (1);
        }

      ptr = buffer;
      while (n > 0)
        {
          alarm(120);
          m = write (1, ptr, n);
          alarm(0);
          if (m == 0)
            {
              fprintf(stderr, "write: closed\n");
              exit (1);
            }

          if (m < 0)
            {
              int err = errno;
              perror("write");
              if (err != EAGAIN)
                exit (1);
              sleep(1);
            }
          else
            {
              n -= m;
              ptr += m;
            }
        }
    }
  fprintf(stdout, "\nAll done\n");
  exit (0);
}
