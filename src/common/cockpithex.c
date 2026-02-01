/*
 * Copyright (C) 2014 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#include "config.h"

#include "cockpithex.h"

#include "cockpitmemory.h"

#include <string.h>

static const char HEX[] = "0123456789abcdef";

char *
cockpit_hex_encode (const void * data,
                    ssize_t length)
{
  const unsigned char *in = data;
  char *out;
  size_t i;

  if (length < 0)
    length = strlen (data);

  out = mallocx (length * 2 + 1);
  for (i = 0; i < length; i++)
    {
      out[i * 2] = HEX[in[i] >> 4];
      out[i * 2 + 1] = HEX[in[i] & 0xf];
    }
  out[i * 2] = '\0';
  return out;
}
