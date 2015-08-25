#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>

void
main (void)
{
  int i, n;
  char buffer[10240];

  for (i = 0; i < sizeof(buffer); i++)
    buffer[i] = 'x';

  buffer[0] = '[';
  buffer[sizeof(buffer)-1] = ']';

  for (i = 0; i < 50; i++)
    {
      n = write (1, buffer, sizeof(buffer));
      if (n < 0)
        exit(1);
      if (n != sizeof(buffer))
        exit(2);
    }
  printf ("\ndone\n");

  exit(0);
}
