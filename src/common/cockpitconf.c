/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

#include "cockpitconf.h"
#include "cockpitmemory.h"

#include <ctype.h>
#include <err.h>
#include <errno.h>
#include <libgen.h>
#include <limits.h>
#include <regex.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* #define DEBUG 1 */
#if DEBUG
#define debug(fmt, ...) (fprintf (stderr, "cockpitconf: " fmt "\n", ##__VA_ARGS__))
#else
#define debug(...)
#endif


typedef struct Entry {
  char *section;
  char *key;
  char *value;
  char *strv_value; /* copy of value with all strv_delimiters replaced with \0 */
  char strv_delimiter;
  const char **strv_cache; /* value split by strv_delimiter; points into strv_value */
  struct Entry *next;
} Entry;

static bool cockpit_conf_loaded = false;
static Entry *cockpit_conf = NULL;

const char *cockpit_config_file = "cockpit.conf";
const char *cockpit_config_dirs[] = { PACKAGE_SYSCONF_DIR, NULL };

/*
 * some helper functions for safe memory allocation
 */

static void
regcompx (regex_t *preg, const char *regex, int cflags)
{
  int ret = regcomp (preg, regex, cflags);
  if (ret != 0)
    {
      char err[1024];
      regerror (ret, preg, err, sizeof (err));
      fprintf (stderr, "failed to compile regular expression: %s\n", err);
      abort ();
    }
}

/* For optimization, this modifies string; the returned array has pointers into string
 * The array itself gets allocated and must be freed after use. */
static const char **
strsplit (char *string, char delimiter)
{
  const char ** parts = reallocarrayx (NULL, 2, sizeof (char*));
  char *cur = string;
  bool done = false;
  unsigned len = 0;

  /* backwards compatible special case: a totally empty string gives [], while ":" splits into ["", ""] */
  if (string && *string)
    {
      while (!done)
        {
          char *next_delim = strchr (cur, delimiter);

          if (next_delim)
            *next_delim = '\0';
          else
            done = true;

          parts = reallocarrayx (parts, len + 2, sizeof (char*));
          parts[len++] = cur;

          if (next_delim)
            cur = next_delim + 1;
        }
    }

  parts[len] = NULL;
  return parts;
}

/*
 * internal logic/helpers
 */

/* See https://developer.gnome.org/glib/stable/glib-Key-value-file-parser.html for the spec */
static bool
load_key_file (const char *file_path)
{
  FILE *f = NULL;
  char *cur_section = NULL;
  regex_t re_section, re_keyval, re_ignore;
  char *line = NULL;
  bool ret = true;
  size_t line_size = 0;

  cockpit_conf_loaded = true;

  f = fopen (file_path, "r");
  if (!f)
    {
      if (errno != ENOENT)
        warnx ("couldn't load configuration file: %s: %m\n", file_path);
      return false;
    }

  regcompx (&re_section, "^[[:space:]]*\\[([^][[:cntrl:]]+)\\][[:space:]]*$", REG_EXTENDED|REG_NEWLINE);
  regcompx (&re_keyval, "^[[:space:]]*([[:alnum:]-]+)[[:space:]]*=[[:space:]]*(.*)$", REG_EXTENDED|REG_NEWLINE);
  regcompx (&re_ignore, "^[[:space:]]*(#.*)?$", REG_EXTENDED|REG_NOSUB);

  for (;;)
    {
      /* getline returns with -1 and not setting errno on EOL */
      errno = 0;
      if (getline (&line, &line_size, f) < 0)
        {
          if (errno != 0)
            {
              perror ("failed to read line from config file");
              abort ();
            }
          else
            {
              break; /* EOL */
            }
        }

      /* maximum number of () matches that we want to capture from the above REs, + 1 for the entire string (group 0) */
      const int MAX_MATCH = 3;
      regmatch_t matches[MAX_MATCH];

      if (regexec (&re_section, line, MAX_MATCH, matches, 0) == 0)
        {
          free (cur_section);
          cur_section = strndupx (line + matches[1].rm_so, matches[1].rm_eo - matches[1].rm_so);
        }

      else if (regexec (&re_keyval, line, 3, matches, 0) == 0)
        {
          Entry *e;

          if (!cur_section)
            {
              warnx ("%s: key=val line not in any section: %s", file_path, line);
              ret = false;
              break;
            }

          e = mallocx (sizeof (Entry));
          e->section = strdupx (cur_section);
          e->key = strndupx (line + matches[1].rm_so, matches[1].rm_eo - matches[1].rm_so);
          e->value = strndupx (line + matches[2].rm_so, matches[2].rm_eo - matches[2].rm_so);
          e->strv_value = NULL;
          e->strv_cache = NULL;
          /* prepend new Entry to cockpit_conf; that way, later values win over earlier ones in a forward search */
          e->next = cockpit_conf;
          cockpit_conf = e;
        }

      else if (regexec (&re_ignore, line, 0, NULL, 0) == 0)
        {
          /* comment or empty line */
        }
      else
        {
          warnx ("%s: invalid line: %s", file_path, line);
          ret = false;
          break;
        }
    }

  free (line);
  regfree (&re_section);
  regfree (&re_keyval);
  regfree (&re_ignore);
  fclose (f);
  free (cur_section);

  if (ret)
    debug ("Loaded configuration from: %s\n", file_path);
  else
    cockpit_conf_cleanup ();

  return ret;
}

static Entry*
cockpit_conf_lookup (const char *section,
                     const char *field)
{
  Entry *e;

  if (section == NULL || field == NULL)
    return NULL;

  if (!cockpit_conf_loaded)
    cockpit_conf_init ();

  for (e = cockpit_conf; e; e = e->next)
    {
      /* that cockpit.conf has traditionally been case insensitive for section and key names */
      if (strcasecmp (e->section, section) == 0 && strcasecmp (e->key, field) == 0)
        break;
    }

  return e;
}

/*
 * external API
 */

void
cockpit_conf_init (void)
{
  if (!cockpit_config_file)
    {
      debug ("No configuration to load");
      return;
    }

  if (strchr (cockpit_config_file, '/'))
    {
      load_key_file (cockpit_config_file);
    }
  else
    {
      const char *const *dirs;

      for (dirs = cockpit_conf_get_dirs (); *dirs; ++dirs)
        {
          char *file = NULL;
          asprintfx (&file, "%s/cockpit/%s", *dirs, cockpit_config_file);
          load_key_file (file);
          free (file);
        }
    }
}

void
cockpit_conf_cleanup (void)
{
  Entry *e, *enext = NULL;

  for (e = cockpit_conf; e; e = enext)
    {
      free (e->section);
      free (e->key);
      free (e->value);
      free (e->strv_value);
      free (e->strv_cache);
      enext = e->next;
      free (e);
    }

  cockpit_conf = NULL;
  cockpit_conf_loaded = false;
}

const char * const *
cockpit_conf_get_dirs (void)
{
  static const char ** system_config_dirs = NULL;
  static bool initialized = false;

  if (!initialized)
    {
      static char *env;

      initialized = true;
      env = getenv ("XDG_CONFIG_DIRS");
      if (env && env[0])
        {
          /* strsplit() modifies the string inline, so copy and keep a ref */
          env = strdup (env);
          system_config_dirs = strsplit (env, ':');
        }
    }

  return (const char * const *) system_config_dirs ?: cockpit_config_dirs;
}

const char *
cockpit_conf_string (const char *section,
                     const char *field)
{
  const Entry *entry = cockpit_conf_lookup (section, field);
  return entry ? entry->value : NULL;
}

bool
cockpit_conf_bool (const char *section,
                   const char *field,
                   bool defawlt)
{
  const char *value = cockpit_conf_string (section, field);
  if (value)
    return strcasecmp (value, "yes") == 0 || strcasecmp (value, "true") == 0 || strcmp (value, "1") == 0;
  return defawlt;
}

const char * const *
cockpit_conf_strv (const char *section,
                   const char *field,
                   char delimiter)
{
  Entry *entry = cockpit_conf_lookup (section, field);

  if (!entry || !entry->value)
    return NULL;

  if (entry->strv_cache)
    {
      if (delimiter != entry->strv_delimiter)
        errx (1, "cockpitconf: Looking up strv with different delimiters is not supported");
    }
  else
    {
      /* strip off trailing whitespace (leading whitespace is already stripped by regexp) */
      entry->strv_value = strdupx (entry->value);
      for (char *c = entry->strv_value + strlen (entry->strv_value) - 1; c >= entry->strv_value && isspace (*c); --c)
        *c = '\0';
      entry->strv_cache = strsplit (entry->strv_value, delimiter);
      entry->strv_delimiter = delimiter;
    }

  return entry->strv_cache;
}

unsigned
cockpit_conf_uint (const char *section,
                   const char *field,
                   unsigned default_value,
                   unsigned max,
                   unsigned min)
{
  unsigned val = default_value;
  long long conf_val;
  char *endptr = NULL;

  const char* conf = cockpit_conf_string (section, field);
  if (conf)
    {
      errno = 0;
      conf_val = strtoll (conf, &endptr, 10);
      if ((conf_val == LLONG_MIN || conf_val == LLONG_MAX || conf_val == 0) &&
          (errno == ERANGE || errno == EINVAL))
        val = default_value;
      else if (endptr && endptr[0] != '\0')
        val = default_value;
      else if (conf_val > max)
        val = max;
      else if (conf_val < min)
        val = min;
      else
        val = (unsigned)conf_val;

      if (conf_val != val)
        warnx ("Invalid %s %s value '%s', setting to %u", section, field, conf, val);
    }

  return val;
}
