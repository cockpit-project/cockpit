/*
 * This file is part of Cockpit.
 *
 * Portions Copyright (C) 2014 Red Hat, Inc.
 *
 * This code is based on code in util-linux.
 *
 * Copyright (c) 1988, 1993, 1994
 * The Regents of the University of California. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 * notice, this list of conditions and the following disclaimer in the
 * documentation and/or other materials provided with the distribution.
 * 3. All advertising materials mentioning features or use of this software
 * must display the following acknowledgment:
 * This product includes software developed by the University of
 * California, Berkeley and its contributors.
 * 4. Neither the name of the University nor the names of its contributors
 * may be used to endorse or promote products derived from this software
 * without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE REGENTS AND CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE REGENTS OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 *
 * Copyright (C) 2014 Sami Kerola <kerolasa@iki.fi>
 * Copyright (C) 2014 Karel Zak <kzak@redhat.com>
 */

#include "config.h"

#include <signal.h>
#include "cockpitunixsignal.h"

struct signv {
  const char *name;
  int val;
} sys_signame[] = {
  /* POSIX signals */
  { "HUP",      SIGHUP },       /* 1 */
  { "INT",      SIGINT },       /* 2 */
  { "QUIT",     SIGQUIT },      /* 3 */
  { "ILL",      SIGILL },       /* 4 */
  { "TRAP",     SIGTRAP },      /* 5 */
  { "ABRT",     SIGABRT },      /* 6 */
  { "IOT",      SIGIOT },       /* 6, same as SIGABRT */
#ifdef SIGEMT
  { "EMT",      SIGEMT },       /* 7 (mips,alpha,sparc*) */
#endif
  { "BUS",      SIGBUS },       /* 7 (arm,i386,m68k,ppc), 10 (mips,alpha,sparc*) */
  { "FPE",      SIGFPE },       /* 8 */
  { "KILL",     SIGKILL },      /* 9 */
  { "USR1",     SIGUSR1 },      /* 10 (arm,i386,m68k,ppc), 30 (alpha,sparc*), 16 (mips) */
  { "SEGV",     SIGSEGV },      /* 11 */
  { "USR2",     SIGUSR2 },      /* 12 (arm,i386,m68k,ppc), 31 (alpha,sparc*), 17 (mips) */
  { "PIPE",     SIGPIPE },      /* 13 */
  { "ALRM",     SIGALRM },      /* 14 */
  { "TERM",     SIGTERM },      /* 15 */
#ifdef SIGSTKFLT
  { "STKFLT",   SIGSTKFLT },    /* 16 (arm,i386,m68k,ppc) */
#endif
  { "CHLD",     SIGCHLD },      /* 17 (arm,i386,m68k,ppc), 20 (alpha,sparc*), 18 (mips) */
#ifdef SIGCLD
  { "CLD",      SIGCLD },       /* same as SIGCHLD (mips, musl libc) */
#endif
  { "CONT",     SIGCONT },      /* 18 (arm,i386,m68k,ppc), 19 (alpha,sparc*), 25 (mips) */
  { "STOP",     SIGSTOP },      /* 19 (arm,i386,m68k,ppc), 17 (alpha,sparc*), 23 (mips) */
  { "TSTP",     SIGTSTP },      /* 20 (arm,i386,m68k,ppc), 18 (alpha,sparc*), 24 (mips) */
  { "TTIN",     SIGTTIN },      /* 21 (arm,i386,m68k,ppc,alpha,sparc*), 26 (mips) */
  { "TTOU",     SIGTTOU },      /* 22 (arm,i386,m68k,ppc,alpha,sparc*), 27 (mips) */
  { "URG",      SIGURG },       /* 23 (arm,i386,m68k,ppc), 16 (alpha,sparc*), 21 (mips) */
  { "XCPU",     SIGXCPU },      /* 24 (arm,i386,m68k,ppc,alpha,sparc*), 30 (mips) */
  { "XFSZ",     SIGXFSZ },      /* 25 (arm,i386,m68k,ppc,alpha,sparc*), 31 (mips) */
  { "VTALRM",   SIGVTALRM },    /* 26 (arm,i386,m68k,ppc,alpha,sparc*), 28 (mips) */
  { "PROF",     SIGPROF },      /* 27 (arm,i386,m68k,ppc,alpha,sparc*), 29 (mips) */
  { "WINCH",    SIGWINCH },     /* 28 (arm,i386,m68k,ppc,alpha,sparc*), 20 (mips) */
  { "IO",       SIGIO },        /* 29 (arm,i386,m68k,ppc), 23 (alpha,sparc*), 22 (mips) */
  { "POLL",     SIGPOLL },      /* same as SIGIO */
#ifdef SIGINFO
  { "INFO",     SIGINFO },      /* 29 (alpha) */
#endif
#ifdef SIGLOST
  { "LOST",     SIGLOST },      /* 29 (arm,i386,m68k,ppc,sparc*) */
#endif
  { "PWR",      SIGPWR },       /* 30 (arm,i386,m68k,ppc), 29 (alpha,sparc*), 19 (mips) */
#ifdef SIGUNUSED
  { "UNUSED",   SIGUNUSED },    /* 31 (arm,i386,m68k,ppc) */
#endif
  { "SYS",      SIGSYS },       /* 31 (mips,alpha,sparc*) */
};

gchar *
cockpit_strsignal (int signum)
{
  size_t n;

  for (n = 0; n < G_N_ELEMENTS (sys_signame); n++)
    if (sys_signame[n].val == signum)
      return g_strdup (sys_signame[n].name);

#ifdef SIGRTMIN
  if (SIGRTMIN <= signum && signum <= SIGRTMAX)
    return g_strdup_printf ("RT%d", signum - SIGRTMIN);
#endif

  return g_strdup ("UNKNOWN");
}
