/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

#define _GNU_SOURCE 1

#include "reauthutil.h"

#include <assert.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>

int _reauthorize_drain = 0;

void
_reauthorize_secfree (void *data,
                      ssize_t len)
{
  volatile char *vp;

  if (!data)
    return;

  if (len < 0)
    len = strlen (data);

  /* Defeats some optimizations */
  memset (data, 0xAA, len);
  memset (data, 0xBB, len);

  /* Defeats others */
  vp = (volatile char*)data;
  while (len--)
    {
      _reauthorize_drain |= *vp;
      *(vp++) = 0xAA;
    }

  free (data);
}

void *
_reauthorize_xrealloc (void *data,
                       size_t len)
{
  void *mem = realloc (data, len);
  if (!mem)
    free (data);
  return mem;
}

static const char HEX[] = "0123456789abcdef";

int
_reauthorize_hex (const void *data,
                  ssize_t len,
                  char **hex)
{
  const unsigned char *in = data;
  char *out;
  size_t i;

  if (len < 0)
    len = strlen (data);

  out = malloc (len * 2 + 1);
  if (out == NULL)
    return -ENOMEM;

  for (i = 0; i < len; i++)
    {
      out[i * 2] = HEX[in[i] >> 4];
      out[i * 2 + 1] = HEX[in[i] & 0xf];
    }
  out[i * 2] = '\0';
  *hex = out;
  return 0;
}

int
_reauthorize_unhex (const char *hex,
                    ssize_t len,
                    void **data,
                    size_t *data_len)
{
  const char *hpos;
  const char *lpos;
  char *out;
  int i;

  if (len < 0)
    len = strlen (hex);

  out = malloc (len * 2 + 1);
  if (out == NULL)
    return -ENOMEM;

  if (len % 2 != 0)
    return -EINVAL;
  for (i = 0; i < len / 2; i++)
    {
      hpos = strchr (HEX, hex[i * 2]);
      lpos = strchr (HEX, hex[i * 2 + 1]);
      if (hpos == NULL || lpos == NULL)
        {
          free (out);
          return -EINVAL;
        }
      out[i] = ((hpos - HEX) << 4) | ((lpos - HEX) & 0xf);
    }

  /* A convenience null termination */
  out[i] = '\0';

  *data = out;
  *data_len = i;
  return 0;
}

ssize_t
_reauthorize_parse_salt (const char *input)
{
  const char *pos;
  const char *end;

  /*
   * Parse a encrypted secret produced by crypt() using one
   * of the additional algorithms. Return the length of
   * the salt or -1.
   */

  if (input[0] != '$')
    return -1;
  pos = strchr (input + 1, '$');
  if (pos == NULL || pos == input + 1)
    return -1;
  end = strchr (pos + 1, '$');
  if (end == NULL || end != pos + 17)
    return -1;

  /* Full length of the salt */
  return (end - input) + 1;
}
