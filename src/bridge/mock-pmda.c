/*
 * Trivial, configurable PMDA
 *
 * Copyright (c) 2014 Red Hat.
 * Copyright (c) 1995,2004 Silicon Graphics, Inc.  All Rights Reserved.
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * for more details.
 */

#include <pcp/pmapi.h>
#include <pcp/impl.h>
#include <pcp/pmda.h>

static pmdaInstid inst_values[] = {
    { 1, "red" }, { 2, "green" }, { 3, "blue" }
};

static pmdaIndom indomtab[] = {
#define VALUES_INDOM	0
  { VALUES_INDOM, sizeof(inst_values)/sizeof(inst_values[0]), inst_values },
#define INSTANCES_INDOM	1
  { INSTANCES_INDOM, 0, NULL }
};

static pmdaMetric metrictab[] = {
  /* value */
  { NULL,
    { PMDA_PMID(0,0), PM_TYPE_U32, PM_INDOM_NULL, PM_SEM_INSTANT,
      PMDA_PMUNITS(0, 0, 0, 0, 0, 0) } },
  /* values */
  { NULL,
    { PMDA_PMID(0,1), PM_TYPE_U32, VALUES_INDOM, PM_SEM_INSTANT,
      PMDA_PMUNITS(0, 0, 0, 0, 0, 0) } },
  /* instances */
  { NULL,
    { PMDA_PMID(0,2), PM_TYPE_U32, INSTANCES_INDOM, PM_SEM_INSTANT,
      PMDA_PMUNITS(0, 0, 0, 0, 0, 0) } },
  /* seconds */
  { NULL,
    { PMDA_PMID(0,3), PM_TYPE_U32, PM_INDOM_NULL, PM_SEM_INSTANT,
      PMDA_PMUNITS(0, 1, 0, 0, PM_TIME_SEC, 0) } },
  /* string */
  { NULL,
    { PMDA_PMID(0,4), PM_TYPE_STRING, PM_INDOM_NULL, PM_SEM_INSTANT,
      PMDA_PMUNITS(0, 0, 0, 0, 0, 0) } },
  /* counter */
  { NULL,
    { PMDA_PMID(0,5), PM_TYPE_U32, PM_INDOM_NULL, PM_SEM_COUNTER,
      PMDA_PMUNITS(0, 0, 0, 0, 0, 0) } },
  /* counter64 */
  { NULL,
    { PMDA_PMID(0,6), PM_TYPE_U64, PM_INDOM_NULL, PM_SEM_COUNTER,
      PMDA_PMUNITS(0, 0, 0, 0, 0, 0) } }

};

static unsigned int values[4] = { 0, 0, 0 };

static pmInDom instances_indom;

static const char *string_value = "foobar";

static int counter = 0;
static int64_t counter64 = INT64_MAX - 100;

static int
mock_fetchCallBack(pmdaMetric *mdesc, unsigned int inst, pmAtomValue *atom)
{
  __pmID_int		*idp = (__pmID_int *)&(mdesc->m_desc.pmid);

  if (idp->cluster != 0)
    return PM_ERR_PMID;

  switch (idp->item) {
  case 0:
    if (inst != PM_IN_NULL)
      return PM_ERR_INST;
    atom->ul = values[0];
    break;
  case 1:
    if (inst < 1 || inst > 3)
      return PM_ERR_INST;
    atom->ul = values[inst];
    break;
  case 2: {
    void *val;
    if (pmdaCacheLookup(instances_indom, inst, NULL, &val) != PMDA_CACHE_ACTIVE)
      return PM_ERR_INST;
    atom->ul = (intptr_t)val;
  } break;
  case 3:
    if (inst != PM_IN_NULL)
      return PM_ERR_INST;
    atom->ul = 60;
    break;
  case 4:
    if (inst != PM_IN_NULL)
      return PM_ERR_INST;
    atom->cp = (char *)string_value;
    break;
  case 5:
    if (inst != PM_IN_NULL)
      return PM_ERR_INST;
    atom->ul = counter;
    break;
  case 6:
    if (inst != PM_IN_NULL)
      return PM_ERR_INST;
    atom->ull = counter64;
    break;
  default:
    return PM_ERR_PMID;
  }
  return 0;
}

void mock_control (const char *cmd, ...);

void
mock_control (const char *cmd, ...)
{
  va_list ap;
  va_start (ap, cmd);

  if (strcmp (cmd, "reset") == 0)
    {
      values[0] = values[1] = values[2] = values[3] = 0;
      pmdaCacheOp (instances_indom, PMDA_CACHE_CULL);
      string_value = "foobar";
      counter = 0;
      counter64 = INT64_MAX - 100;
    }
  else if (strcmp (cmd, "set-value") == 0)
    {
      int i = va_arg (ap, int);
      int v = va_arg (ap, int);
      values[i] = v;
    }
  else if (strcmp (cmd, "add-instance") == 0)
    {
      const char *n = va_arg (ap, const char *);
      intptr_t val = va_arg (ap, int);
      pmdaCacheStore (instances_indom, PMDA_CACHE_ADD, n, (void *)val);
    }
  else if (strcmp (cmd, "del-instance") == 0)
    {
      const char *n = va_arg (ap, const char *);
      pmdaCacheStore (instances_indom, PMDA_CACHE_HIDE, n, NULL);
    }
  else if (strcmp (cmd, "set-string") == 0)
    {
      const char *n = va_arg (ap, const char *);
      string_value = n;
    }
  else if (strcmp (cmd, "inc-counter") == 0)
    {
      int val = va_arg (ap, int);
      counter += val;
    }
  else if (strcmp (cmd, "inc-counter64") == 0)
    {
      int val = va_arg (ap, int);
      counter64 += val;
    }
  va_end(ap);
}

void mock_init (pmdaInterface *dp);

void
mock_init (pmdaInterface *dp)
{
  pmdaDSO(dp, PMDA_INTERFACE_2, "mock-pmda", NULL);

  if (dp->status != 0)
    return;

  pmdaSetFetchCallBack(dp, mock_fetchCallBack);
  pmdaInit(dp,
           indomtab, sizeof(indomtab)/sizeof(indomtab[0]),
           metrictab, sizeof(metrictab)/sizeof(metrictab[0]));

  instances_indom = indomtab[INSTANCES_INDOM].it_indom;
}
