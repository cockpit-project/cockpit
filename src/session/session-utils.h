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

#pragma once

#include "config.h"

#include <assert.h>
#include <stdbool.h>
#include <stddef.h>
#include <err.h>
#include <stdio.h>
#include <stdint.h>
#include <stdnoreturn.h>
#include <string.h>
#include <pwd.h>
#include <grp.h>
#include <errno.h>
#include <unistd.h>
#include <signal.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>

#include "common/cockpitauthorize.h"
#include "common/cockpitmemory.h"

#define DEBUG_SESSION 0

#if DEBUG_SESSION
#define debug(fmt, ...) (fprintf (stderr, "%s: " fmt "\n", program_name, ##__VA_ARGS__))
#else
#define debug(...)
#endif

#define EX 127

extern const char *program_name;
extern struct passwd *pwd;
extern char *last_err_msg;
extern char *last_err_msg;
extern int want_session;
extern pid_t child;

void build_string (char **buf, size_t *size, const char *str, size_t len);
void authorize_logger (const char *data);
void utmp_log (int login, const char *rhost, FILE *messages);
void btmp_log (const char *username, const char *rhost);

char* read_authorize_response (const char *what);
void write_authorize_begin (void);
void write_control_string (const char *field, const char *str);
void write_control_bool (const char *field, bool val);
void write_control_end (void);

int
spawn_and_wait (const char **argv,
                const char **envp,
                const int *remap_fds,
                int n_remap_fds,
                uid_t uid,
                gid_t gid);
