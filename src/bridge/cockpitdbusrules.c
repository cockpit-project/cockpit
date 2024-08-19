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

#include "cockpitdbusrules.h"

#include "cockpitpaths.h"

#include <gio/gio.h>

#include <string.h>

/*
 * These are rules similar to what a dbus-daemon would use when processing
 * AddMatch based forwarding. These are used to identify which signals a
 * client wanted to subscribe to, and which paths/interfaces a client
 * wanted to watch.
 *
 * We use several speed ups to quickly identify paths that are not matched
 * by the rules ... before then going into matching each rule in turn.
 *
 * An empty rule set forwards nothing. It has a fast bypass flag which
 * disables all the logic.
 */

typedef struct {
  gint refs;
  gchar *path;
  gboolean is_namespace;
  gchar *interface;
  gchar *member;
  gchar *arg0;
} RuleData;

static guint32
rule_hash (gconstpointer data)
{
  const RuleData *rule = data;
  return g_str_hash (rule->path) ^
         g_int_hash (&rule->is_namespace) ^
         (rule->interface ? g_str_hash (rule->interface) : 0) ^
         (rule->member ? g_str_hash (rule->member) : 0) ^
         (rule->arg0 ? g_str_hash (rule->arg0) : 0);
}

static gboolean
rule_equal (gconstpointer one,
             gconstpointer two)
{
  const RuleData *r1 = one;
  const RuleData *r2 = two;
  return r1->is_namespace == r2->is_namespace &&
         g_str_equal (r1->path, r2->path) &&
         g_strcmp0 (r1->interface, r2->interface) == 0;
}

static void
rule_dump (RuleData *rule,
           GString *string)
{
  g_string_append (string, "{ ");
  if (rule->path)
    g_string_append_printf (string, "%s: \"%s\", ", rule->is_namespace ? "path_namespace" : "path", rule->path);
  if (rule->interface)
    g_string_append_printf (string, "interface: \"%s\", ", rule->interface);
  if (rule->arg0)
    g_string_append_printf (string, "arg0: \"%s\", ", rule->arg0);
  if (rule->member)
    g_string_append_printf (string, "member: \"%s\", ", rule->member);
  g_string_append (string, "}");
}

static void
rule_free (gpointer data)
{
  RuleData *rule = data;
  g_free (rule->path);
  g_free (rule->interface);
  g_free (rule->arg0);
  g_free (rule->member);
  g_slice_free (RuleData, rule);
}

struct _CockpitDBusRules {
  GHashTable *all;
  GHashTable *paths;
  GTree *path_namespaces;
  gboolean all_paths;
  gboolean only_paths;
  gboolean nothing;
};

gchar *
cockpit_dbus_rules_to_string (CockpitDBusRules *rules)
{
  GHashTableIter iter;
  GString *string;
  RuleData *rule;

  string = g_string_new ("[ ");
  g_hash_table_iter_init (&iter, rules->all);
  while (g_hash_table_iter_next (&iter, (gpointer *)&rule, NULL))
    {
      rule_dump (rule, string);
      g_string_append (string, ", ");
    }
  g_string_append (string, "]");

  return g_string_free (string, FALSE);
}

static gboolean
rule_match (RuleData *rule,
            const gchar *path,
            const gchar *interface,
            const gchar *member,
            const gchar *arg0)
{
  if (!g_str_equal (rule->path, path))
    {
      if (!rule->is_namespace || !cockpit_path_equal_or_ancestor (path, rule->path))
        return FALSE;
    }
  if (interface && rule->interface && strcmp (interface, rule->interface) != 0)
    return FALSE;
  if (member && rule->member && strcmp (member, rule->member) != 0)
    return FALSE;

  /* Note that if arg0 came in as NULL, it means message doesn't have arg0: no match */
  if (rule->arg0 && g_strcmp0 (arg0, rule->arg0) != 0)
    return FALSE;

  return TRUE;
}

gboolean
cockpit_dbus_rules_match (CockpitDBusRules *rules,
                          const gchar *path,
                          const gchar *interface,
                          const gchar *member,
                          const gchar *arg0)
{
  GHashTableIter iter;
  RuleData *rule;

  g_return_val_if_fail (path != NULL, FALSE);

  if (rules->nothing)
    return FALSE;

  if (!rules->all_paths)
    {
      if (!cockpit_paths_contain_or_ancestor (rules->path_namespaces, path) &&
          !g_hash_table_lookup (rules->paths, path))
        return FALSE;
    }

  if (rules->only_paths)
    return TRUE;

  g_hash_table_iter_init (&iter, rules->all);
  while (g_hash_table_iter_next (&iter, (gpointer *)&rule, NULL))
    {
      if (rule_match (rule, path, interface, member, arg0))
        return TRUE;
    }

  return FALSE;
}

CockpitDBusRules *
cockpit_dbus_rules_new (void)
{
  CockpitDBusRules *rules = g_new0 (CockpitDBusRules, 1);
  rules->nothing = TRUE;
  return rules;
}

static RuleData *
rule_lookup (CockpitDBusRules *rules,
              const gchar *path,
              gboolean is_namespace,
              const gchar *interface,
              const gchar *member,
              const gchar *arg0)
{
  RuleData key = {
      .refs = 0,
      .path = (gchar *)path,
      .is_namespace = is_namespace,
      .interface = (gchar *)interface,
      .member = (gchar *)member,
      .arg0 = (gchar *)arg0
  };

  return g_hash_table_lookup (rules->all, &key);
}

static void
recompile_rules (CockpitDBusRules *rules)
{
  GHashTableIter iter;
  RuleData *rule;

  if (rules->paths)
    g_hash_table_remove_all (rules->paths);
  else
    rules->paths = g_hash_table_new (g_str_hash, g_str_equal);
  if (rules->path_namespaces)
    g_tree_destroy (rules->path_namespaces);
  rules->path_namespaces = cockpit_paths_new ();

  rules->all_paths = FALSE;
  rules->nothing = TRUE;
  rules->only_paths = TRUE;

  g_hash_table_iter_init (&iter, rules->all);
  while (g_hash_table_iter_next (&iter, (gpointer *)&rule, NULL))
    {
      rules->nothing = FALSE;

      if (rule->is_namespace)
        {
          if (g_str_equal (rule->path, "/"))
            rules->all_paths = TRUE;
          cockpit_paths_add (rules->path_namespaces, rule->path);
        }
      else
        {
          g_hash_table_add (rules->paths, rule->path);
        }

      if (rule->interface || rule->member || rule->arg0)
        rules->only_paths = FALSE;
    }
}

gboolean
cockpit_dbus_rules_add (CockpitDBusRules *rules,
                        const gchar *path,
                        gboolean is_namespace,
                        const gchar *interface,
                        const gchar *member,
                        const gchar *arg0)
{
  RuleData *rule = NULL;

  if (!path)
    {
      path = "/";
      is_namespace = TRUE;
    }

  if (!rules->nothing)
    rule = rule_lookup (rules, path, is_namespace, interface, member, arg0);

  if (rules->all == NULL)
    rules->all = g_hash_table_new_full (rule_hash, rule_equal, rule_free, NULL);

  if (rule == NULL)
    {
      rule = g_slice_new0 (RuleData);
      rule->refs = 1;
      rule->path = g_strdup (path);
      rule->is_namespace = is_namespace;
      rule->interface = g_strdup (interface);
      rule->member = g_strdup (member);
      rule->arg0 = g_strdup (arg0);
      g_hash_table_add (rules->all, rule);
      recompile_rules (rules);
      return TRUE;
    }
  else
    {
      rule->refs++;
      return FALSE;
    }
}

gboolean
cockpit_dbus_rules_remove (CockpitDBusRules *rules,
                           const gchar *path,
                           gboolean is_namespace,
                           const gchar *interface,
                           const gchar *member,
                           const gchar *arg0)
{
  RuleData *rule = NULL;

  if (!path)
    {
      path = "/";
      is_namespace = TRUE;
    }

  if (rules->nothing)
    return FALSE;

  rule = rule_lookup (rules, path, is_namespace, interface, member, arg0);
  if (rule == NULL)
    return FALSE;

  rule->refs--;
  if (rule->refs == 0)
    {
      g_hash_table_remove (rules->all, rule);
      recompile_rules (rules);
      return TRUE;
    }

  return FALSE;
}

void
cockpit_dbus_rules_free (CockpitDBusRules *rules)
{
  if (rules->all)
    g_hash_table_destroy (rules->all);
  if (rules->paths)
    g_hash_table_destroy (rules->paths);
  if (rules->path_namespaces)
    g_tree_destroy (rules->path_namespaces);
  g_free (rules);
}
