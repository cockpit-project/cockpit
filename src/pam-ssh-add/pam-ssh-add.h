/*
 * Copyright (C) 2015 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef PAM_SSH_ADD_H__
#define PAM_SSH_ADD_H__

#include <pwd.h>
#include <security/pam_modules.h>

#define N_ELEMENTS(x) (sizeof(x) / sizeof (x)[0])

extern const char *pam_ssh_agent_program;
extern const char *pam_ssh_agent_arg;
extern const char *pam_ssh_add_program;
extern const char *pam_ssh_add_arg;
extern int pam_ssh_add_verbose_mode;

typedef void (*pam_ssh_add_logger) (int level, const char *data);
extern pam_ssh_add_logger pam_ssh_add_log_handler;

int     pam_ssh_add_start_agent     (pam_handle_t *pamh,
                                     struct passwd *pwd,
                                     const char *xdg_runtime_overide,
                                     char **out_auth_sock_var,
                                     char **out_agent_pid_var);

int     pam_ssh_add_load            (pam_handle_t *pamh,
                                     struct passwd *pwd,
                                     const char *agent_socket,
                                     const char *password);

#endif /* PAM_SSH_ADD_H__ */
