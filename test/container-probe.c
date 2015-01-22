#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <errno.h>

void
error(const char *msg)
{
  perror (msg);
  exit (1);
}

const char *message_to_send = "Sending messages";

void
listen_on_port (int port)
{
  int sock_fd, new_sock_fd;
  socklen_t cli_len;
  struct sockaddr_in serv_addr, cli_addr;
  int bytes_written;
  int message_length = strlen(message_to_send);

  sock_fd = socket (AF_INET, SOCK_STREAM, 0);
  if (sock_fd < 0)
    error("ERROR while opening socket");

  bzero ((char *) &serv_addr, sizeof (serv_addr));
  serv_addr.sin_family = AF_INET;
  serv_addr.sin_addr.s_addr = INADDR_ANY;
  serv_addr.sin_port = htons (port);

  if (bind (sock_fd, (struct sockaddr *) &serv_addr, sizeof (serv_addr)) < 0)
    error("ERROR on binding");
  listen (sock_fd,5);

  cli_len = sizeof (cli_addr);

  printf ("Waiting for connection on port %i.\n", port);

  new_sock_fd = accept (sock_fd, (struct sockaddr *) &cli_addr, &cli_len);
  if (new_sock_fd < 0)
    error("ERROR on accept");

  bytes_written = 0;
  while (bytes_written < message_length)
    {
      int ret = write (new_sock_fd, message_to_send + bytes_written, message_length - bytes_written);
      if (ret < 0)
        {
          if (errno == EINTR || errno == EAGAIN)
            continue;
          error("ERROR while writing to socket");
          break;
        }
      bytes_written += ret;
    }

  if (bytes_written < message_length)
    error("ERROR while writing to socket");

  close (new_sock_fd);
  close (sock_fd);
}

/* optional arguments: ports on which to wait for a connection and send a message
 * ports will be served consecutively in the order they are passed
 */

int
main (int argc, char **argv)
{
  int arg_index;
  printf ("Hello from container-probe.\n");
  for (arg_index = 1; arg_index < argc; ++arg_index)
    {
      char *pEnd;
      int port = (int) strtol(argv[arg_index], &pEnd, 10);
      if (port != 0)
        {
          listen_on_port (port);
        }
    }
  return 0;
}

