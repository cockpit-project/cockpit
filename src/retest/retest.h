/*
 * Copyright (c) 2013, Red Hat Inc.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 *     * Redistributions of source code must retain the above
 *       copyright notice, this list of conditions and the
 *       following disclaimer.
 *     * Redistributions in binary form must reproduce the
 *       above copyright notice, this list of conditions and
 *       the following disclaimer in the documentation and/or
 *       other materials provided with the distribution.
 *     * The names of contributors to this software may not be
 *       used to endorse or promote products derived from this
 *       software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
 * FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
 * COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
 * BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS
 * OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED
 * AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
 * THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH
 * DAMAGE.
 *
 * Author: Stef Walter <stefw@redhat.com>
 */

#ifndef RE_TEST_H_
#define RE_TEST_H_

#ifndef GNUC_PRINTF
#if __GNUC__ > 2
#define GNUC_PRINTF(x, y) __attribute__((__format__(__printf__, x, y)))
#else
#define GNUC_PRINTF(x, y)
#endif
#endif

#include <string.h>

#ifdef assert_not_reached
#undef assert_not_reached
#endif

#ifdef assert
#undef assert
#endif

#define assert(expr) \
  assert_true(expr)
#define assert_true(expr) \
  do { if (expr) ; else \
    re_test_fail (__FILE__, __LINE__, __FUNCTION__, "assertion failed (%s)", #expr); \
  } while (0)
#define assert_false(expr) \
  do { if (expr) \
    re_test_fail (__FILE__, __LINE__, __FUNCTION__, "assertion failed (!(%s))", #expr); \
  } while (0)
#define assert_fail(msg, detail) \
  do { const char *__s = (detail); \
    re_test_fail (__FILE__, __LINE__, __FUNCTION__, "%s%s%s", (msg), __s ? ": ": "", __s ? __s : ""); \
  } while (0)
#define assert_not_reached(msg) \
  do { \
    re_test_fail (__FILE__, __LINE__, __FUNCTION__, "code should not be reached"); \
  } while (0)
#define assert_ptr_not_null(ptr) \
  do { if ((ptr) != NULL) ; else \
    re_test_fail (__FILE__, __LINE__, __FUNCTION__, "assertion failed (%s != NULL)", #ptr); \
  } while (0)
#define assert_num_cmp(a1, cmp, a2) \
  do { long long __n1 = (long long)(a1); \
    long long __n2 = (long long)(a2); \
    if (__n1 cmp __n2) ; else \
      re_test_fail (__FILE__, __LINE__, __FUNCTION__, "assertion failed (%s %s %s): (%lld %s %lld)", \
                    #a1, #cmp, #a2, __n1, #cmp, __n2); \
  } while (0)
#define assert_num_eq(a1, a2) \
  assert_num_cmp(a1, ==, a2)
#define assert_str_cmp(a1, cmp, a2) \
  do { const char *__s1 = (a1); \
    const char *__s2 = (a2); \
    if (__s1 && __s2 && strcmp (__s1, __s2) cmp 0) ; else \
      re_test_fail (__FILE__, __LINE__, __FUNCTION__, "assertion failed (%s %s %s): (%s %s %s)", \
                    #a1, #cmp, #a2, __s1 ? __s1 : "(null)", #cmp, __s2 ? __s2 : "(null)"); \
  } while (0)
#define assert_str_eq(a1, a2) \
  assert_str_cmp(a1, ==, a2)
#define assert_ptr_eq(a1, a2) \
  do { const void *__p1 = (a1); \
    const void *__p2 = (a2); \
    if (__p1 == __p2) ; else \
         re_test_fail (__FILE__, __LINE__, __FUNCTION__, "assertion failed (%s == %s): (0x%08lx == 0x%08lx)", \
                       #a1, #a2, (unsigned long)(size_t)__p1, (unsigned long)(size_t)__p2); \
  } while (0)

#define assert_str_contains(expr, needle) \
  do { const char *__str = (expr); \
    if (__str && strstr (__str, needle)) ; else \
      re_test_fail (__FILE__, __LINE__, __FUNCTION__, "assertion failed (%s): '%s' does not contain '%s'", \
                    #expr, __str, needle); \
  } while (0)


void        re_test_fail            (const char *filename,
                                     int line,
                                     const char *function,
                                     const char *message,
                                     ...) GNUC_PRINTF(4, 5);

void        re_test_skip            (const char *reason);

void        re_test                 (void (* function) (void),
                                     const char *name,
                                     ...) GNUC_PRINTF(2, 3);

void        re_testx                (void (* function) (void *),
                                     void *argument,
                                     const char *name,
                                     ...) GNUC_PRINTF(3, 4);

void        re_fixture              (void (* setup) (void *),
                                     void (* teardown) (void *));

int         re_test_run             (int argc,
                                     char **argv);

int         re_test_fork            (void);

char *      re_test_directory       (const char *prefix);

#endif /* RE_TEST_H_ */
