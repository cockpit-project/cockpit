/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include <assert.h>
#include <stddef.h>
#include <err.h>
#include <stdio.h>
#include <string.h>
#include <pwd.h>
#include <grp.h>
#include <errno.h>
#include <unistd.h>
#include <sys/signal.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>

#include <security/pam_appl.h>

#include "common/cockpitauthorize.h"
#include "common/cockpitmemory.h"

#define DEBUG_SESSION 0
#define EX 127
#define DEFAULT_PATH "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

#if     __GNUC__ > 2 || (__GNUC__ == 2 && __GNUC_MINOR__ > 4)
#define GNUC_NORETURN __attribute__((__noreturn__))
#else
#define GNUC_NORETURN
#endif

extern const char *program_name;
extern struct passwd *pwd;
extern char *last_err_msg;
extern char *last_err_msg;
extern char *env_saved[];
extern int want_session;
extern pid_t child;

void build_string (char **buf, size_t *size, const char *str, size_t len);
void authorize_logger (const char *data);
void save_environment (void);
void pass_to_child (int signo);
void utmp_log (int login, const char *rhost);
#ifndef HAVE_FDWALK
int fdwalk (int (*cb)(void *data, int fd), void *data);
#endif
int closefd (void *data, int fd);

char* read_authorize_response (const char *what);
void write_authorize_begin (void);
void write_control_string (const char *field, const char *str);
void write_control_bool (const char *field, int val);
void write_control_end (void);

GNUC_NORETURN void exit_init_problem (int result_code);

#if DEBUG_SESSION
#define debug(fmt, ...) (fprintf (stderr, "%s: " fmt "\n", program_name, ##__VA_ARGS__))
#else
#define debug(...)
#endif

int open_session (pam_handle_t *pamh);
int fork_session (char **env, int (*session)(char**));
