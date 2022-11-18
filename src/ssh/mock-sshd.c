/* Based on the sample implementation of a libssh based SSH server:

   https://git.libssh.org/projects/libssh.git/plain/examples/ssh_server.c?id=23cebfadea156aea377462eaf5971955c77d2d61

   The main changes are:

    - Command line options and server configuration have been changed
      to match our established mock-sshd conventions.

    - The port is printed on stdout and stdout is closed afterwards.

    - The specific interactive authorization that is expected by the
      tests is implemented by hooking into the message callbacks.
      There doesn't seem to be a dedicated callback for this.

    - If this child exits with a signal, this is also reported back.

    - Dead locks while writing to the child stdin are avoided by
      polling for writability.
*/

/*
Copyright 2014 Audrius Butkevicius

This file is part of the SSH Library

You are free to copy this file, modify it in any way, consider it being public
domain. This does not apply to the rest of the library though, but it is
allowed to cut-and-paste working code from this file to any license of
program.
The goal is to show the API in action.
*/

#include "config.h"
#define HAVE_ARGP_H
#define HAVE_PTY_H
#define HAVE_UTMP_H
#define WITH_FORK

#include <libssh/callbacks.h>
#include <libssh/server.h>

#include <poll.h>
#ifdef HAVE_ARGP_H
#include <argp.h>
#endif
#include <fcntl.h>
#ifdef HAVE_LIBUTIL_H
#include <libutil.h>
#endif
#include <pthread.h>
#ifdef HAVE_PTY_H
#include <pty.h>
#endif
#include <signal.h>
#include <stdlib.h>
#ifdef HAVE_UTMP_H
#include <utmp.h>
#endif
#ifdef HAVE_UTIL_H
#include <util.h>
#endif
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <stdio.h>
#include <stdbool.h>

#ifndef BUF_SIZE
#define BUF_SIZE 1048576
#endif

#ifndef KEYS_FOLDER
#ifdef _WIN32
#define KEYS_FOLDER
#else
#define KEYS_FOLDER "/etc/ssh/"
#endif
#endif

#define SESSION_END (SSH_CLOSED | SSH_CLOSED_ERROR)
#define SFTP_SERVER_PATH "/usr/lib/sftp-server"

#define DEF_STR_SIZE 1024
bool broken_auth = false;
bool multi_step = false;
char authorizedkeys[DEF_STR_SIZE] = {0};
char username[128] = "myuser";
char password[128] = "mypassword";
#ifdef HAVE_ARGP_H
const char *argp_program_version = "libssh server example "
SSH_STRINGIFY(LIBSSH_VERSION);
const char *argp_program_bug_address = "<libssh@libssh.org>";

/* Program documentation. */
static char doc[] = "libssh -- a Secure Shell protocol implementation";

/* The options we understand. */
static struct argp_option options[] = {
    {
        .name  = "port",
        .key   = 'p',
        .arg   = "PORT",
        .flags = 0,
        .doc   = "Set the port to bind.",
        .group = 0
    },
    {
        .name  = "bind",
        .key   = 'b',
        .arg   = "BIND",
        .flags = 0,
        .doc   = "Set the address to bind.",
        .group = 0
    },
    {
        .name  = "hostkey",
        .key   = 'k',
        .arg   = "FILE",
        .flags = 0,
        .doc   = "Set a host key.  Can be used multiple times.  "
                 "Implies no default keys.",
        .group = 0
    },
    {
        .name  = "dsakey",
        .key   = 'd',
        .arg   = "FILE",
        .flags = 0,
        .doc   = "Set the dsa key.",
        .group = 0
    },
    {
        .name  = "rsakey",
        .key   = 'r',
        .arg   = "FILE",
        .flags = 0,
        .doc   = "Set the rsa key.",
        .group = 0
    },
    {
        .name  = "ecdsakey",
        .key   = 'e',
        .arg   = "FILE",
        .flags = 0,
        .doc   = "Set the ecdsa key.",
        .group = 0
    },
    {
        .name  = "import-pubkey",
        .key   = 'a',
        .arg   = "FILE",
        .flags = 0,
        .doc   = "Set the authorized keys file.",
        .group = 0
    },
    {
        .name  = "user",
        .key   = 'u',
        .arg   = "USERNAME",
        .flags = 0,
        .doc   = "Set expected username.",
        .group = 0
    },
    {
        .name  = "password",
        .key   = 'P',
        .arg   = "PASSWORD",
        .flags = 0,
        .doc   = "Set expected password.",
        .group = 0
    },
    {
        .name  = "broken-auth",
        .key   = 't',
        .arg   = NULL,
        .flags = 0,
        .doc   = "Break authentication",
        .group = 0
    },
    {
        .name  = "multi-step",
        .key   = 'm',
        .arg   = NULL,
        .flags = 0,
        .doc   = "Multi Step Auth",
        .group = 0
    },
    {
        .name  = "verbose",
        .key   = 'v',
        .arg   = NULL,
        .flags = 0,
        .doc   = "Get verbose output.",
        .group = 0
    },
    {NULL, 0, NULL, 0, NULL, 0}
};

/* Parse a single option. */
static error_t parse_opt (int key, char *arg, struct argp_state *state) {
    /* Get the input argument from argp_parse, which we
     * know is a pointer to our arguments structure. */
    ssh_bind sshbind = state->input;

    switch (key) {
        case 'p':
            ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_BINDPORT_STR, arg);
            break;
         case 'b':
            ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_BINDADDR, arg);
            break;
        case 'd':
            ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_DSAKEY, arg);
            break;
        case 'k':
            ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_HOSTKEY, arg);
            break;
        case 'r':
            ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_RSAKEY, arg);
            break;
        case 'e':
            ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_ECDSAKEY, arg);
            break;
        case 'a':
            strncpy(authorizedkeys, arg, DEF_STR_SIZE-1);
            break;
        case 'u':
            strncpy(username, arg, sizeof(username) - 1);
            break;
        case 'P':
            strncpy(password, arg, sizeof(password) - 1);
            break;
        case 't':
            broken_auth = true;
            break;
        case 'm':
            multi_step = true;
            break;
        case 'v':
            ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_LOG_VERBOSITY_STR,
                                 "3");
            break;
        case ARGP_KEY_ARG:
            /* Too many arguments. */
            argp_usage (state);
            break;
        case ARGP_KEY_END:
            break;
        default:
            return ARGP_ERR_UNKNOWN;
    }
    return 0;
}

/* Our argp parser. */
static struct argp argp = {options, parse_opt, NULL, doc, NULL, NULL, NULL};
#else
static int parse_opt(int argc, char **argv, ssh_bind sshbind) {
    int no_default_keys = 0;
    int rsa_already_set = 0;
    int dsa_already_set = 0;
    int ecdsa_already_set = 0;
    int key;

    while((key = getopt(argc, argv, "a:d:e:k:np:P:r:u:v")) != -1) {
        if (key == 'n') {
            no_default_keys = 1;
        } else if (key == 'p') {
            ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_BINDPORT_STR, optarg);
        } else if (key == 'd') {
            ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_DSAKEY, optarg);
            dsa_already_set = 1;
        } else if (key == 'k') {
            ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_HOSTKEY, optarg);
            /* We can't track the types of keys being added with this
            option, so let's ensure we keep the keys we're adding
            by just not setting the default keys */
            no_default_keys = 1;
        } else if (key == 'r') {
            ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_RSAKEY, optarg);
            rsa_already_set = 1;
        } else if (key == 'e') {
            ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_ECDSAKEY, optarg);
            ecdsa_already_set = 1;
        } else if (key == 'a') {
            strncpy(authorizedkeys, optarg, DEF_STR_SIZE-1);
        } else if (key == 'u') {
            strncpy(username, optarg, sizeof(username) - 1);
        } else if (key == 'P') {
            strncpy(password, optarg, sizeof(password) - 1);
        } else if (key == 'v') {
            ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_LOG_VERBOSITY_STR,
                                 "3");
        } else {
            break;
        }
    }

    if (key != -1) {
        printf("Usage: %s [OPTION...] BINDADDR\n"
               "libssh %s -- a Secure Shell protocol implementation\n"
               "\n"
               "  -a, --authorizedkeys=FILE  Set the authorized keys file.\n"
               "  -d, --dsakey=FILE          Set the dsa key.\n"
               "  -e, --ecdsakey=FILE        Set the ecdsa key.\n"
               "  -k, --hostkey=FILE         Set a host key.  Can be used multiple times.\n"
               "                             Implies no default keys.\n"
               "  -n, --no-default-keys      Do not set default key locations.\n"
               "  -p, --port=PORT            Set the port to bind.\n"
               "  -P, --pass=PASSWORD        Set expected password.\n"
               "  -r, --rsakey=FILE          Set the rsa key.\n"
               "  -u, --user=USERNAME        Set expected username.\n"
               "  -v, --verbose              Get verbose output.\n"
               "  -?, --help                 Give this help list\n"
               "\n"
               "Mandatory or optional arguments to long options are also mandatory or optional\n"
               "for any corresponding short options.\n"
               "\n"
               "Report bugs to <libssh@libssh.org>.\n",
               argv[0], SSH_STRINGIFY(LIBSSH_VERSION));
        return -1;
    }

    if (optind != argc - 1) {
        printf("Usage: %s [OPTION...] BINDADDR\n", argv[0]);
        return -1;
    }

    ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_BINDADDR, argv[optind]);

    if (!no_default_keys) {
        set_default_keys(sshbind,
                         rsa_already_set,
                         dsa_already_set,
                         ecdsa_already_set);
    }

    return 0;
}
#endif /* HAVE_ARGP_H */

/* A userdata struct for channel. */
struct channel_data_struct {
    /* pid of the child process the channel will spawn. */
    pid_t pid;
    /* For PTY allocation */
    socket_t pty_master;
    socket_t pty_slave;
    /* For communication with the child process. */
    socket_t child_stdin;
    socket_t child_stdout;
    /* Only used for subsystem and exec requests. */
    socket_t child_stderr;
    /* Event which is used to poll the above descriptors. */
    ssh_event event;
    /* Terminal size struct. */
    struct winsize *winsize;
    /* Data we want to send */
    uint8_t *stdin_buf;
    uint32_t stdin_len;
};

/* A userdata struct for session. */
struct session_data_struct {
    /* Pointer to the channel the session will allocate. */
    ssh_channel channel;
    int auth_attempts;
    int authenticated;
    int multi_step_state;
};

static int process_child_stdin(socket_t fd, int revents, void *userdata) {
    struct channel_data_struct *cdata = (struct channel_data_struct *) userdata;
    if (cdata->stdin_len == 0)
      return 0;

    fcntl (cdata->child_stdin, F_SETFL, O_NONBLOCK);
    int ret = write(cdata->child_stdin, cdata->stdin_buf, cdata->stdin_len);
    if (ret > 0) {
      memmove (cdata->stdin_buf, cdata->stdin_buf + ret, cdata->stdin_len - ret);
      cdata->stdin_len -= ret;
      if (cdata->stdin_len == 0)
        ssh_event_remove_fd(cdata->event, cdata->child_stdin);
    }

    return 0;
}

static void queue_child_stdin(struct channel_data_struct *cdata, void *data, uint32_t len)
{
  fcntl (cdata->child_stdin, F_SETFL, O_NONBLOCK);
  int ret = write(cdata->child_stdin, data, len);
  if (ret < 0) {
    if (errno == EAGAIN) {
      ret = 0;
    } else {
      perror("write");
      exit(1);
    }
  }
  if (ret >= 0 && ret < len) {
    len -= ret;
    data = (uint8_t *)data + ret;
    cdata->stdin_buf = realloc (cdata->stdin_buf, cdata->stdin_len + len);
    memcpy (cdata->stdin_buf + cdata->stdin_len, data, len);
    if (cdata->stdin_len == 0)
      ssh_event_add_fd(cdata->event, cdata->child_stdin, POLLOUT, process_child_stdin, cdata);
    cdata->stdin_len += len;
  }
}

static int data_function(ssh_session session, ssh_channel channel, void *data,
                         uint32_t len, int is_stderr, void *userdata) {
    struct channel_data_struct *cdata = (struct channel_data_struct *) userdata;

    (void) session;
    (void) channel;
    (void) is_stderr;

    if (len == 0 || cdata->pid < 1 || kill(cdata->pid, 0) < 0) {
        return 0;
    }

    queue_child_stdin (cdata, data, len);
    return len;
}

static int pty_request(ssh_session session, ssh_channel channel,
                       const char *term, int cols, int rows, int py, int px,
                       void *userdata) {
    struct channel_data_struct *cdata = (struct channel_data_struct *)userdata;

    (void) session;
    (void) channel;
    (void) term;

    cdata->winsize->ws_row = rows;
    cdata->winsize->ws_col = cols;
    cdata->winsize->ws_xpixel = px;
    cdata->winsize->ws_ypixel = py;

    if (openpty(&cdata->pty_master, &cdata->pty_slave, NULL, NULL,
                cdata->winsize) != 0) {
        fprintf(stderr, "Failed to open pty\n");
        return SSH_ERROR;
    }
    return SSH_OK;
}

static int pty_resize(ssh_session session, ssh_channel channel, int cols,
                      int rows, int py, int px, void *userdata) {
    struct channel_data_struct *cdata = (struct channel_data_struct *)userdata;

    (void) session;
    (void) channel;

    cdata->winsize->ws_row = rows;
    cdata->winsize->ws_col = cols;
    cdata->winsize->ws_xpixel = px;
    cdata->winsize->ws_ypixel = py;

    if (cdata->pty_master != -1) {
        return ioctl(cdata->pty_master, TIOCSWINSZ, cdata->winsize);
    }

    return SSH_ERROR;
}

static int exec_pty(const char *mode, const char *command,
                    struct channel_data_struct *cdata) {
    switch(cdata->pid = fork()) {
        case -1:
            close(cdata->pty_master);
            close(cdata->pty_slave);
            fprintf(stderr, "Failed to fork\n");
            return SSH_ERROR;
        case 0:
            close(cdata->pty_master);
            if (login_tty(cdata->pty_slave) != 0) {
                exit(1);
            }
            execl("/bin/sh", "sh", mode, command, NULL);
            exit(0);
        default:
            close(cdata->pty_slave);
            /* pty fd is bi-directional */
            cdata->child_stdout = cdata->child_stdin = cdata->pty_master;
    }
    return SSH_OK;
}

static int exec_nopty(const char *command, struct channel_data_struct *cdata) {
    int in[2], out[2], err[2];

    /* Do the plumbing to be able to talk with the child process. */
    if (pipe(in) != 0) {
        goto stdin_failed;
    }
    if (pipe(out) != 0) {
        goto stdout_failed;
    }
    if (pipe(err) != 0) {
        goto stderr_failed;
    }

    switch(cdata->pid = fork()) {
        case -1:
            goto fork_failed;
        case 0:
            /* Finish the plumbing in the child process. */
            close(in[1]);
            close(out[0]);
            close(err[0]);
            dup2(in[0], STDIN_FILENO);
            dup2(out[1], STDOUT_FILENO);
            dup2(err[1], STDERR_FILENO);
            close(in[0]);
            close(out[1]);
            close(err[1]);
            /* exec the requested command. */
            execl("/bin/sh", "sh", "-c", command, NULL);
            exit(0);
    }

    close(in[0]);
    close(out[1]);
    close(err[1]);

    cdata->child_stdin = in[1];
    cdata->child_stdout = out[0];
    cdata->child_stderr = err[0];

    return SSH_OK;

fork_failed:
    close(err[0]);
    close(err[1]);
stderr_failed:
    close(out[0]);
    close(out[1]);
stdout_failed:
    close(in[0]);
    close(in[1]);
stdin_failed:
    return SSH_ERROR;
}

static int exec_request(ssh_session session, ssh_channel channel,
                        const char *command, void *userdata) {
    struct channel_data_struct *cdata = (struct channel_data_struct *) userdata;


    (void) session;
    (void) channel;

    if(cdata->pid > 0) {
        return SSH_ERROR;
    }

    if (cdata->pty_master != -1 && cdata->pty_slave != -1) {
        return exec_pty("-c", command, cdata);
    }
    return exec_nopty(command, cdata);
}

static int shell_request(ssh_session session, ssh_channel channel,
                         void *userdata) {
    struct channel_data_struct *cdata = (struct channel_data_struct *) userdata;

    (void) session;
    (void) channel;

    if(cdata->pid > 0) {
        return SSH_ERROR;
    }

    if (cdata->pty_master != -1 && cdata->pty_slave != -1) {
        return exec_pty("-l", NULL, cdata);
    }
    /* Client requested a shell without a pty, let's pretend we allow that */
    return SSH_OK;
}

static int subsystem_request(ssh_session session, ssh_channel channel,
                             const char *subsystem, void *userdata) {
    /* subsystem requests behave simillarly to exec requests. */
    if (strcmp(subsystem, "sftp") == 0) {
        return exec_request(session, channel, SFTP_SERVER_PATH, userdata);
    }
    return SSH_ERROR;
}

static int auth_password(ssh_session session, const char *user,
                         const char *pass, void *userdata) {
    struct session_data_struct *sdata = (struct session_data_struct *) userdata;

    (void) session;

    if (strcmp(user, username) == 0 && strcmp(pass, password) == 0) {
        sdata->authenticated = 1;
        return SSH_AUTH_SUCCESS;
    }

    sdata->auth_attempts++;
    return SSH_AUTH_DENIED;
}

static int auth_publickey(ssh_session session,
                          const char *user,
                          struct ssh_key_struct *pubkey,
                          char signature_state,
                          void *userdata)
{
    struct session_data_struct *sdata = (struct session_data_struct *) userdata;

    (void) user;
    (void) session;

    if (signature_state == SSH_PUBLICKEY_STATE_NONE) {
        return SSH_AUTH_SUCCESS;
    }

    if (signature_state != SSH_PUBLICKEY_STATE_VALID) {
        return SSH_AUTH_DENIED;
    }

    // valid so far.  Now look through authorized keys for a match
    if (authorizedkeys[0]) {
        ssh_key key = NULL;
        int result;
        struct stat buf;

        if (stat(authorizedkeys, &buf) == 0) {
            result = ssh_pki_import_pubkey_file( authorizedkeys, &key );
            if ((result != SSH_OK) || (key==NULL)) {
                fprintf(stderr,
                        "Unable to import public key file %s\n",
                        authorizedkeys);
            } else {
                result = ssh_key_cmp( key, pubkey, SSH_KEY_CMP_PUBLIC );
                ssh_key_free(key);
                if (result == 0) {
                    sdata->authenticated = 1;
                    return SSH_AUTH_SUCCESS;
                }
            }
        }
    }

    // no matches
    sdata->authenticated = 0;
    return SSH_AUTH_DENIED;
}

static int
auth_message_callback (ssh_session session,
                       ssh_message message,
                       void *user_data)
{
  static const char *prompts[2] = { "Password", "Token" };
  static char echo[] = { 0, 1 };
  static const char *again[1] = { "So Close" };
  static char again_echo[] = { 0 };

  struct session_data_struct *sdata = (struct session_data_struct *) user_data;

  if (ssh_message_type (message) != SSH_REQUEST_AUTH
      || ssh_message_subtype (message) != SSH_AUTH_METHOD_INTERACTIVE)
    return 1;

  switch (sdata->multi_step_state) {
  case 1:
    if (strcmp (ssh_message_auth_user (message), username) == 0)
      {
        ssh_message_auth_interactive_request (message, "Test Interactive",
                                              "Password and Token",
                                              2, prompts, echo);
        sdata->multi_step_state = 2;
        return 0;
      }
    else
      return 1;
    break;

  case 2:
    if (ssh_userauth_kbdint_getnanswers(session) != 2)
      break;

    if (strcmp (ssh_userauth_kbdint_getanswer(session, 0), password) != 0)
      break;

    if (strcmp (ssh_userauth_kbdint_getanswer(session, 1), "5") == 0) {
      ssh_message_auth_reply_success (message, 0);
      sdata->authenticated = 1;
      return 0;
    } else if (strcmp (ssh_userauth_kbdint_getanswer(session, 1), "6") == 0) {
      ssh_message_auth_interactive_request (message, "Test Interactive",
                                            "Again", 1, again, again_echo);
      sdata->multi_step_state = 3;
      return 0;
    }

    break;

  case 3:
    if (ssh_userauth_kbdint_getnanswers(session) != 1)
      break;

    if (strcmp (ssh_userauth_kbdint_getanswer(session, 0), "5") == 0) {
      ssh_message_auth_reply_success (message, 0);
      sdata->authenticated = 1;
      return 0;
    }

    break;
  }

  return 1;
}

static ssh_channel channel_open(ssh_session session, void *userdata) {
    struct session_data_struct *sdata = (struct session_data_struct *) userdata;

    sdata->channel = ssh_channel_new(session);
    return sdata->channel;
}

static int process_stdout(socket_t fd, int revents, void *userdata) {
    char buf[BUF_SIZE];
    int n = -1;
    ssh_channel channel = (ssh_channel) userdata;

    if (channel != NULL && (revents & POLLIN) != 0) {
        n = read(fd, buf, BUF_SIZE);
        if (n > 0) {
            ssh_channel_write(channel, buf, n);
        }
    }

    return n;
}

static int process_stderr(socket_t fd, int revents, void *userdata) {
    char buf[BUF_SIZE];
    int n = -1;
    ssh_channel channel = (ssh_channel) userdata;

    if (channel != NULL && (revents & POLLIN) != 0) {
        n = read(fd, buf, BUF_SIZE);
        if (n > 0) {
            ssh_channel_write_stderr(channel, buf, n);
        }
    }

    return n;
}

static void handle_session(ssh_event event, ssh_session session) {
    int n;
    int rc = 0;

    /* Structure for storing the pty size. */
    struct winsize wsize = {
        .ws_row = 0,
        .ws_col = 0,
        .ws_xpixel = 0,
        .ws_ypixel = 0
    };

    /* Our struct holding information about the channel. */
    struct channel_data_struct cdata = {
        .pid = 0,
        .pty_master = -1,
        .pty_slave = -1,
        .child_stdin = -1,
        .child_stdout = -1,
        .child_stderr = -1,
        .event = NULL,
        .winsize = &wsize,
        .stdin_buf = NULL,
        .stdin_len = 0,
    };

    /* Our struct holding information about the session. */
    struct session_data_struct sdata = {
        .channel = NULL,
        .auth_attempts = 0,
        .authenticated = 0,
        .multi_step_state = 1,
    };

    struct ssh_channel_callbacks_struct channel_cb = {
        .userdata = &cdata,
        .channel_pty_request_function = pty_request,
        .channel_pty_window_change_function = pty_resize,
        .channel_shell_request_function = shell_request,
        .channel_exec_request_function = exec_request,
        .channel_data_function = data_function,
        .channel_subsystem_request_function = subsystem_request
    };

    struct ssh_server_callbacks_struct server_cb = {
        .userdata = &sdata,
        .auth_password_function = auth_password,
        .channel_open_request_session_function = channel_open,
    };

    int auth_methods = SSH_AUTH_METHOD_PASSWORD;
    if (broken_auth) {
      auth_methods = SSH_AUTH_METHOD_HOSTBASED;
    } else {
      if (authorizedkeys[0]) {
        server_cb.auth_pubkey_function = auth_publickey;
        auth_methods |= SSH_AUTH_METHOD_PUBLICKEY;
      }
      if (multi_step)
        auth_methods |= SSH_AUTH_METHOD_INTERACTIVE;
    }

    ssh_set_auth_methods (session, auth_methods);

    ssh_callbacks_init(&server_cb);
    ssh_callbacks_init(&channel_cb);

    /* The server callbacks handle password and publickey
       authentication, the message callback handles interactive
       authentication.
    */
    ssh_set_server_callbacks(session, &server_cb);
    ssh_set_message_callback (session, auth_message_callback, &sdata);

    if (ssh_handle_key_exchange(session) != SSH_OK) {
        fprintf(stderr, "%s\n", ssh_get_error(session));
        return;
    }

    ssh_event_add_session(event, session);

    n = 0;
    while (sdata.authenticated == 0 || sdata.channel == NULL) {
        /* If the user has used up all attempts, or if he hasn't been able to
         * authenticate in 10 seconds (n * 100ms), disconnect. */
        if (sdata.auth_attempts >= 3 || n >= 100) {
            return;
        }

        if (ssh_event_dopoll(event, 100) == SSH_ERROR) {
            fprintf(stderr, "%s\n", ssh_get_error(session));
            return;
        }
        n++;
    }

    ssh_set_channel_callbacks(sdata.channel, &channel_cb);
    ssh_set_message_callback (session, NULL, NULL);

    do {
        /* Poll the main event which takes care of the session, the channel and
         * even our child process's stdout/stderr (once it's started). */
        if (ssh_event_dopoll(event, -1) == SSH_ERROR) {
          ssh_channel_close(sdata.channel);
        }

        /* If child process's stdout/stderr has been registered with the event,
         * or the child process hasn't started yet, continue. */
        if (cdata.event != NULL || cdata.pid == 0) {
            continue;
        }
        /* Executed only once, once the child process starts. */
        cdata.event = event;
        /* If stdout valid, add stdout to be monitored by the poll event. */
        if (cdata.child_stdout != -1) {
            if (ssh_event_add_fd(event, cdata.child_stdout, POLLIN, process_stdout,
                                 sdata.channel) != SSH_OK) {
                fprintf(stderr, "Failed to register stdout to poll context\n");
                ssh_channel_close(sdata.channel);
            }
        }

        /* If stderr valid, add stderr to be monitored by the poll event. */
        if (cdata.child_stderr != -1){
            if (ssh_event_add_fd(event, cdata.child_stderr, POLLIN, process_stderr,
                                 sdata.channel) != SSH_OK) {
                fprintf(stderr, "Failed to register stderr to poll context\n");
                ssh_channel_close(sdata.channel);
            }
        }
    } while(ssh_channel_is_open(sdata.channel) &&
            (cdata.pid == 0 || waitpid(cdata.pid, &rc, WNOHANG) == 0));

    close(cdata.pty_master);
    close(cdata.child_stdin);
    close(cdata.child_stdout);
    close(cdata.child_stderr);

    /* Remove the descriptors from the polling context, since they are now
     * closed, they will always trigger during the poll calls. */
    ssh_event_remove_fd(event, cdata.child_stdout);
    ssh_event_remove_fd(event, cdata.child_stderr);

    /* If the child process exited. */
    if (kill(cdata.pid, 0) < 0 && (WIFEXITED(rc) || WIFSIGNALED(rc))) {
      if (WIFSIGNALED (rc))
        ssh_channel_request_send_exit_signal (sdata.channel, strsignal (WTERMSIG (rc)), 0, "", "");
      else
        ssh_channel_request_send_exit_status (sdata.channel, WEXITSTATUS (rc));
    /* If client terminated the channel or the process did not exit nicely,
     * but only if something has been forked. */
    } else if (cdata.pid > 0) {
        kill(cdata.pid, SIGKILL);
    }

    ssh_channel_send_eof(sdata.channel);
    ssh_channel_close(sdata.channel);

    /* Wait up to 5 seconds for the client to terminate the session. */
    for (n = 0; n < 50 && (ssh_get_status(session) & SESSION_END) == 0; n++) {
        ssh_event_dopoll(event, 100);
    }
}

#ifdef WITH_FORK
/* SIGCHLD handler for cleaning up dead children. */
static void sigchld_handler(int signo) {
    (void) signo;
    while (waitpid(-1, NULL, WNOHANG) > 0);
}
#else
static void *session_thread(void *arg) {
    ssh_session session = arg;
    ssh_event event;

    event = ssh_event_new();
    if (event != NULL) {
        /* Blocks until the SSH session ends by either
         * child thread exiting, or client disconnecting. */
        handle_session(event, session);
        ssh_event_free(event);
    } else {
        fprintf(stderr, "Could not create polling context\n");
    }
    ssh_disconnect(session);
    ssh_free(session);
    return NULL;
}
#endif

int main(int argc, char **argv) {
    ssh_bind sshbind;
    ssh_session session;
    int rc;
#ifdef WITH_FORK
    struct sigaction sa;

    /* Set up SIGCHLD handler. */
    sa.sa_handler = sigchld_handler;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = SA_RESTART | SA_NOCLDSTOP;
    if (sigaction(SIGCHLD, &sa, NULL) != 0) {
        fprintf(stderr, "Failed to register SIGCHLD handler\n");
        return 1;
    }
#endif

    rc = ssh_init();
    if (rc < 0) {
        fprintf(stderr, "ssh_init failed\n");
        return 1;
    }

    sshbind = ssh_bind_new();
    if (sshbind == NULL) {
        fprintf(stderr, "ssh_bind_new failed\n");
        ssh_finalize();
        return 1;
    }

    {
      // Set mock defaults
      int port = 0;
      ssh_bind_options_set (sshbind, SSH_BIND_OPTIONS_BINDPORT, &port);
      ssh_bind_options_set(sshbind, SSH_BIND_OPTIONS_RSAKEY, SRCDIR "/src/ssh/mock_rsa_key");
      strncpy(authorizedkeys, SRCDIR "/src/ssh/test_rsa.pub", DEF_STR_SIZE-1);
    }

#ifdef HAVE_ARGP_H
    argp_parse(&argp, argc, argv, 0, 0, sshbind);
#else
    if (parse_opt(argc, argv, sshbind) < 0) {
        ssh_bind_free(sshbind);
        ssh_finalize();
        return 1;
    }
#endif /* HAVE_ARGP_H */

    if(ssh_bind_listen(sshbind) < 0) {
        fprintf(stderr, "%s\n", ssh_get_error(sshbind));
        ssh_bind_free(sshbind);
        ssh_finalize();
        return 1;
    }

  /* Print out the port */
    {
      int bind_fd;
      int r;
      char portname[16];
      char addrname[16];
      struct sockaddr_storage addr;
      socklen_t addrlen;

      bind_fd = ssh_bind_get_fd (sshbind);

      addrlen = sizeof (addr);
      if (getsockname (bind_fd, (struct sockaddr *)&addr, &addrlen) < 0)
        {
          fprintf (stderr, "couldn't get local address: %s\n", strerror (errno));
          return 1;
        }
      r = getnameinfo ((struct sockaddr *)&addr, addrlen, addrname, sizeof (addrname),
                       portname, sizeof (portname), NI_NUMERICHOST | NI_NUMERICSERV);
      if (r != 0)
        {
          fprintf (stderr, "couldn't get local port: %s\n", gai_strerror (r));
          return 1;
        }

      /* Caller wants to know the port */
      printf ("%s\n", portname);
    }

    /* Close stdout to signal startup is complete (once above info is printed) */
    fflush(stdout);
    close (1);

    while (1) {
        session = ssh_new();
        if (session == NULL) {
            fprintf(stderr, "Failed to allocate session\n");
            continue;
        }

        /* Blocks until there is a new incoming connection. */
        if(ssh_bind_accept(sshbind, session) != SSH_ERROR) {
#ifdef WITH_FORK
            ssh_event event;

            switch(fork()) {
                case 0:
                    /* Remove the SIGCHLD handler inherited from parent. */
                    sa.sa_handler = SIG_DFL;
                    sigaction(SIGCHLD, &sa, NULL);
                    /* Remove socket binding, which allows us to restart the
                     * parent process, without terminating existing sessions. */
                    ssh_bind_free(sshbind);

                    event = ssh_event_new();
                    if (event != NULL) {
                        /* Blocks until the SSH session ends by either
                         * child process exiting, or client disconnecting. */
                        handle_session(event, session);
                        ssh_event_free(event);
                    } else {
                        fprintf(stderr, "Could not create polling context\n");
                    }
                    ssh_disconnect(session);
                    ssh_free(session);

                    exit(0);
                case -1:
                    fprintf(stderr, "Failed to fork\n");
            }
#else
            pthread_t tid;

            rc = pthread_create(&tid, NULL, session_thread, session);
            if (rc == 0) {
                pthread_detach(tid);
                continue;
            }
            fprintf(stderr, "Failed to pthread_create\n");
#endif
        } else {
            fprintf(stderr, "%s\n", ssh_get_error(sshbind));
        }
        /* Since the session has been passed to a child fork, do some cleaning
         * up at the parent process. */
        ssh_disconnect(session);
        ssh_free(session);
    }

    ssh_bind_free(sshbind);
    ssh_finalize();
    return 0;
}
