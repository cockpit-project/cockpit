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

#include <stdio.h>

#include <systemd/sd-journal.h>
#include <glib.h>

#include <gsystem-local-alloc.h>
#include "daemon.h"
#include "journal.h"
#include "auth.h"

typedef struct _JournalClass JournalClass;

struct _Journal
{
  CockpitJournalSkeleton parent_instance;
};

struct _JournalClass
{
  CockpitJournalSkeletonClass parent_class;
};

static void journal_iface_init (CockpitJournalIface *iface);

G_DEFINE_TYPE_WITH_CODE (Journal, journal, COCKPIT_TYPE_JOURNAL_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_JOURNAL, journal_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

static void
journal_finalize (GObject *object)
{
  G_OBJECT_CLASS (journal_parent_class)->finalize (object);
}

static void
journal_init (Journal *self)
{
  g_dbus_interface_skeleton_set_flags (G_DBUS_INTERFACE_SKELETON (self),
                                       G_DBUS_INTERFACE_SKELETON_FLAGS_HANDLE_METHOD_INVOCATIONS_IN_THREAD);
}

static void
journal_class_init (JournalClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize = journal_finalize;
}

CockpitJournal *
journal_new (void)
{
  return COCKPIT_JOURNAL (g_object_new (TYPE_JOURNAL, NULL));
}

static gboolean
fail_with_errno (GDBusMethodInvocation *invocation,
                 const char *message,
                 int code)
{
  g_dbus_method_invocation_return_error (invocation,
                                         COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                         "%s: %s", message, strerror (code));
  return TRUE;
}

static void
cleanup_journal (sd_journal **ptr)
{
  if (*ptr)
    sd_journal_close (*ptr);
}

static int
seek_to_boot_id (sd_journal *j,
                 const char *boot_id)
{
  int ret;
  gs_free char *match_boot_id = NULL;

  if (strcmp (boot_id, "current") == 0)
    {
      sd_id128_t id;
      ret = sd_id128_get_boot (&id);
      if (ret < 0)
        return ret;
      match_boot_id = g_strdup_printf ("_BOOT_ID=" SD_ID128_FORMAT_STR, SD_ID128_FORMAT_VAL(id));
    }
  else
    match_boot_id = g_strdup_printf ("_BOOT_ID=%s", boot_id);

  __attribute__ ((cleanup (cleanup_journal))) sd_journal *jj = NULL;
  ret = sd_journal_open (&jj, 0);
  if (ret < 0)
    return ret;

  ret = sd_journal_add_match (jj, match_boot_id, strlen (match_boot_id));
  if (ret < 0)
    return ret;

  ret = sd_journal_next (jj);
  if (ret < 0)
    return ret;

  gs_free char *cursor = NULL;
  ret = sd_journal_get_cursor (jj, &cursor);
  if (ret < 0)
    return ret;

  return sd_journal_seek_cursor (j, cursor);
}

static void
add_field (GVariantBuilder *fields,
           gint max_field_size,
           const void *data,
           size_t len)
{
  if (len > max_field_size)
    len = max_field_size;

  const gchar *last_valid;
  g_utf8_validate (data, len, &last_valid);
  size_t valid_len = (last_valid - (const gchar *)data);

  // We allow up to 3 extra bytes, which might belong to
  // the next code point.
  if (valid_len + 3 >= len)
    {
      gs_free gchar *zero_terminated_data = g_strndup (data, valid_len);
      g_variant_builder_add (fields, "s", zero_terminated_data);
    }
  else
    g_variant_builder_add (fields, "s", "<binary>");
}

static gboolean
handle_query (CockpitJournal *object,
              GDBusMethodInvocation *invocation,
              GVariant *arg_match,
              const gchar *arg_filter_text,
              const gchar *arg_seek,
              gint arg_skip,
              gint arg_count,
              const gchar *const *arg_fields,
              gint arg_max_field_size,
              gboolean arg_wait)
{
  __attribute__ ((cleanup (cleanup_journal))) sd_journal *j = NULL;
  int ret;
  gboolean eof = FALSE;
  gboolean backwards = FALSE;
  gboolean empty = FALSE;
  int extra_skip = 1;
  int n = 0;

  if (!auth_check_sender_role (invocation, COCKPIT_ROLE_ADMIN))
    return TRUE;

  ret = sd_journal_open (&j, 0);
  if (ret < 0)
    return fail_with_errno (invocation, "Can't open journal", -ret);

  GVariantIter match_iter;
  GVariantIter *clause_iter;
  gboolean need_disjunction = FALSE;
  g_variant_iter_init (&match_iter, arg_match);
  while (g_variant_iter_next (&match_iter, "as", &clause_iter))
    {
      if (need_disjunction)
        {
          ret = sd_journal_add_disjunction (j);
          if (ret < 0)
            return fail_with_errno (invocation, "Can't add disjunction", -ret);
        }

      const gchar *clause;
      while (g_variant_iter_next (clause_iter, "&s", &clause))
        {
          ret = sd_journal_add_match (j, clause, strlen (clause));
          if (ret < 0)
            {
              g_variant_iter_free (clause_iter);
              return fail_with_errno (invocation, "Can't add match", -ret);
            }
        }

      need_disjunction = TRUE;
      g_variant_iter_free (clause_iter);
    }

  ret = sd_journal_set_data_threshold (j, arg_max_field_size);
  if (ret < 0)
    return fail_with_errno (invocation, "Can't set data limit", -ret);

  if (arg_seek == NULL
      || *arg_seek == '\0'
      || strcmp (arg_seek, "head") == 0)
    {
      ret = sd_journal_seek_head (j);
    }
  else if (strcmp (arg_seek, "tail") == 0)
    {
      ret = sd_journal_seek_tail (j);
    }
  else if (g_str_has_prefix (arg_seek, "rel_usecs="))
    {
      uint64_t rel_usecs = strtoll (arg_seek + 10, NULL, 10);
      ret = sd_journal_seek_realtime_usec (j, g_get_real_time () + rel_usecs);
    }
  else if (g_str_has_prefix (arg_seek, "boot_id="))
    {
      const char *arg_boot_id = arg_seek + 8;
      ret = seek_to_boot_id (j, arg_boot_id);
    }
  else if (g_str_has_prefix (arg_seek, "exact_cursor="))
    {
      const char *cursor = arg_seek + 13;
      ret = sd_journal_seek_cursor (j, cursor);
      if (ret >= 0)
        ret = sd_journal_next (j);
      if (ret > 0)
        ret = sd_journal_test_cursor (j, cursor);
      if (ret == 0)
        ret = -ENOENT;
      extra_skip = 0;
    }
  else
    {
      ret = sd_journal_seek_cursor (j, arg_seek);
    }

  if (ret < 0)
    return fail_with_errno (invocation, "Can't seek", -ret);

  /* When skipping backwards, we skip as far as we can and then return
     entries from there while staying within the window that was
     originally requested.  We will never wait for more entries to
     appear.

     When skipping forward, we need to skip by one more than asked
     because of the way the journal API works.  We will also wait if
     necessary.
  */
  if (arg_skip < 0)
    {
      backwards = TRUE;
      arg_skip = -arg_skip;

      ret = sd_journal_previous_skip (j, arg_skip);
      if (ret < 0)
        return fail_with_errno (invocation, "Can't skip", -ret);

      empty = (ret == 0);

      if (ret < arg_skip)
        {
          eof = TRUE;
          if (arg_count > arg_skip)
            arg_count = arg_skip;
          arg_count -= arg_skip - ret;
        }
    }
  else
    {
      arg_skip += extra_skip;
again:
      ret = sd_journal_next_skip (j, arg_skip);
      if (ret < 0)
        return fail_with_errno (invocation, "Can't skip", -ret);

      arg_skip -= ret;
      if (arg_skip > 0)
        {
          if (arg_wait)
            {
              ret = sd_journal_wait (j, 10 * 1000 * 1000);
              if (ret < 0)
                return fail_with_errno (invocation, "Can't wait", -ret);
              if (ret != SD_JOURNAL_NOP)
                goto again;
            }
          eof = TRUE;
          arg_count = 0;
          empty = TRUE;
        }
    }

  gs_free char *first_cursor = NULL;
  if (!empty)
    {
      ret = sd_journal_get_cursor (j, &first_cursor);
      if (ret < 0)
        return fail_with_errno (invocation, "Can't get first cursor", -ret);
    }
  else
    first_cursor = g_strdup ("");

  GVariantBuilder entries;
  g_variant_builder_init (&entries, G_VARIANT_TYPE ("aas"));

  while (n < arg_count)
    {
      gboolean include;

      if (arg_filter_text && *arg_filter_text)
        {
          const void *data;
          size_t len;
          size_t text_len = strlen (arg_filter_text);

          // Skip this entry if none of the fields contain the text.
          include = FALSE;
          while (sd_journal_enumerate_data (j, &data, &len) > 0 && !include)
            if (memmem (data, len, arg_filter_text, text_len))
              include = TRUE;
        }
      else
        include = TRUE;

      if (include)
        {
          GVariantBuilder fields;
          g_variant_builder_init (&fields, G_VARIANT_TYPE ("as"));

          for (int i = 0; arg_fields[i]; i++)
            {
              const void *data;
              size_t len;

              if (strcmp (arg_fields[i], "*") == 0)
                {
                  sd_journal_restart_data (j);
                  while (sd_journal_enumerate_data (j, &data, &len) > 0)
                    add_field (&fields, arg_max_field_size, data, len);
                }
              else
                {
                  gs_free char *cursor_buf = NULL;
                  gs_free char *usec_buf=NULL;

                  if (strcmp (arg_fields[i], "__REALTIME_TIMESTAMP") == 0)
                    {
                      uint64_t usec;
                      ret = sd_journal_get_realtime_usec (j, &usec);
                      if (ret >= 0)
                        {
                          usec_buf = g_strdup_printf ("%" G_GUINT64_FORMAT, usec);
                          data = usec_buf;
                          len = strlen (usec_buf);
                        }
                    }
                  else if (strcmp (arg_fields[i], "__CURSOR") == 0)
                    {
                      ret = sd_journal_get_cursor (j, &cursor_buf);
                      if (ret >= 0)
                        {
                          data = cursor_buf;
                          len = strlen (cursor_buf);
                        }
                    }
                  else
                    {
                      ret = sd_journal_get_data (j, arg_fields[i], &data, &len);
                      if (ret >= 0)
                        {
                          size_t p = strlen (arg_fields[i]) + 1;
                          if (len >= p)
                            {
                              len -= p;
                              data = ((const char *)data) + p;
                            }
                        }
                    }

                  if (ret == -ENOENT)
                    g_variant_builder_add (&fields, "s", "");
                  else if (ret < 0)
                    g_variant_builder_add (&fields, "s", strerror (-ret));
                  else
                    add_field (&fields, arg_max_field_size, data, len);
                }
            }

          g_variant_builder_add (&entries, "as", &fields);
        }

      n += 1;

      if (n >= arg_count)
        break;

      if (sd_journal_next (j) != 1)
        {
          if (!backwards)
            eof = TRUE;
          break;
        }
    }

  gs_free char *last_cursor = NULL;
  if (!empty)
    {
      ret = sd_journal_get_cursor (j, &last_cursor);
      if (ret < 0)
        return fail_with_errno (invocation, "Can't get last cursor", -ret);
    }
  else
    last_cursor = g_strdup ("");

  cockpit_journal_complete_query (object, invocation,
                                  g_variant_builder_end (&entries),
                                  first_cursor,
                                  last_cursor,
                                  eof);
  return TRUE;
}

static gboolean
handle_query_unique (CockpitJournal *object,
                     GDBusMethodInvocation *invocation,
                     const gchar *arg_field,
                     int arg_max_len)
{
  __attribute__ ((cleanup (cleanup_journal))) sd_journal *j = NULL;
  int ret;

  if (!auth_check_sender_role (invocation, COCKPIT_ROLE_ADMIN))
    return TRUE;

  ret = sd_journal_open (&j, 0);
  if (ret < 0)
    return fail_with_errno (invocation, "Can't open journal", -ret);

  ret = sd_journal_set_data_threshold (j, arg_max_len);
  if (ret < 0)
    return fail_with_errno (invocation, "Can't set data limit", -ret);

  ret = sd_journal_query_unique (j, arg_field);
  if (ret < 0)
    return fail_with_errno (invocation, "Can't query unique values", -ret);

  GVariantBuilder values;
  g_variant_builder_init (&values, G_VARIANT_TYPE ("as"));

  const void *data;
  size_t len, prefix_len = strlen (arg_field) + 1;
  while ((ret = sd_journal_enumerate_unique (j, &data, &len)) > 0)
    {
      if (len >= prefix_len)
        {
          len -= prefix_len;
          data = ((const char *)data) + prefix_len;
        }
      if (len <= arg_max_len)
        {
          gs_free gchar *utf8 = g_locale_to_utf8 (data, len, NULL, NULL, NULL);
          if (utf8)
            g_variant_builder_add (&values, "s", utf8);
        }
    }

  cockpit_journal_complete_query_unique (object, invocation, g_variant_builder_end (&values));
  return TRUE;
}

static void
journal_iface_init (CockpitJournalIface *iface)
{
  iface->handle_query = handle_query;
  iface->handle_query_unique = handle_query_unique;
}
