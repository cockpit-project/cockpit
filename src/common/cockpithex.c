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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
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
