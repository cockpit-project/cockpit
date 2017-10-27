dnl
dnl virt-arg.m4: Helper macros for adding configure arguments
dnl
dnl Copyright (C) 2012-2014 Red Hat, Inc.
dnl
dnl This library is free software; you can redistribute it and/or
dnl modify it under the terms of the GNU Lesser General Public
dnl License as published by the Free Software Foundation; either
dnl version 2.1 of the License, or (at your option) any later version.
dnl
dnl This library is distributed in the hope that it will be useful,
dnl but WITHOUT ANY WARRANTY; without even the implied warranty of
dnl MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
dnl Lesser General Public License for more details.
dnl
dnl You should have received a copy of the GNU Lesser General Public
dnl License along with this library.  If not, see
dnl <http://www.gnu.org/licenses/>.
dnl


dnl
dnl To be used instead of AC_ARG_WITH
dnl
dnl See LIBVIRT_ARG_WITH_FEATURE if the argument you're adding is going to
dnl be used for switching a feature on and off.
dnl
dnl LIBVIRT_ARG_WITH([CHECK_NAME], [HELP_DESC], [DEFAULT_ACTION])
dnl
dnl      CHECK_NAME: Suffix/prefix used for variables/flags, in uppercase.
dnl       HELP_DESC: Description that will appear in configure --help
dnl  DEFAULT_ACTION: Default configure action
dnl
dnl LIBVIRT_ARG_WITH([PACKAGER], [Extra packager name], [no])
dnl LIBVIRT_ARG_WITH([HTML_DIR], [path to base html directory], [$(datadir)/doc])
dnl
AC_DEFUN([LIBVIRT_ARG_WITH], [
  m4_pushdef([check_name], [$1])
  m4_pushdef([help_desc], [[$2]])
  m4_pushdef([default_action], [$3])

  m4_pushdef([check_name_lc], m4_tolower(check_name))
  m4_pushdef([check_name_dash], m4_translit(check_name_lc, [_], [-]))

  m4_pushdef([arg_var], [with-]check_name_dash)
  m4_pushdef([with_var], [with_]check_name_lc)

  m4_divert_text([DEFAULTS], [with_var][[=]][default_action])
  AC_ARG_WITH([check_name_lc],
              [AS_HELP_STRING([[--]arg_var],
                              ]m4_dquote(help_desc)[[ @<:@default=]]m4_dquote(default_action)[[@:>@])])

  m4_popdef([with_var])
  m4_popdef([arg_var])

  m4_popdef([check_name_dash])
  m4_popdef([check_name_lc])

  m4_popdef([default_action])
  m4_popdef([help_desc])
  m4_popdef([check_name])
])

dnl
dnl To be used instead of AC_ARG_WITH
dnl
dnl The difference between LIBVIRT_ARG_WITH and this macro is that the former
dnl is mostly an enhanced drop-in replacement for AC_ARG_WITH, whereas the
dnl latter is tailored for adding an argument that is going to be used to
dnl switch a feature on and off: as a consequence, it optionally supports
dnl specifying the minimum version for libraries the feature depends on and
dnl automatically builds a suitable description from the feature name.
dnl
dnl LIBVIRT_ARG_WITH_FEATURE([CHECK_NAME], [HELP_NAME], [DEFAULT_ACTION], [MIN_VERSION])
dnl
dnl      CHECK_NAME: Suffix/prefix used for variables/flags, in uppercase.
dnl       HELP_NAME: Name that will appear in configure --help
dnl  DEFAULT_ACTION: Default configure action
dnl     MIN_VERSION: Specify minimal version that will be added to
dnl                  configure --help (optional)
dnl
dnl LIBVIRT_ARG_WITH_FEATURE([SELINUX], [SeLinux], [check])
dnl LIBVIRT_ARG_WITH_FEATURE([GLUSTERFS], [glusterfs], [check], [3.4.1])
dnl
AC_DEFUN([LIBVIRT_ARG_WITH_FEATURE], [
  m4_pushdef([check_name], [$1])
  m4_pushdef([help_name], [[$2]])
  m4_pushdef([default_action], [$3])
  m4_pushdef([min_version], [$4])

  m4_pushdef([check_name_lc], m4_tolower(check_name))
  m4_pushdef([check_name_dash], m4_translit(check_name_lc, [_], [-]))

  m4_pushdef([arg_var], [with-]check_name_dash)
  m4_pushdef([with_var], [with_]check_name_lc)

  m4_pushdef([version_text], m4_ifnblank(min_version, [[ (>= ]]min_version[[)]]))

  m4_divert_text([DEFAULTS], [with_var][[=]][default_action])
  AC_ARG_WITH([check_name_lc],
              [AS_HELP_STRING([[--]arg_var],
                              [with ]]m4_dquote(help_name)m4_dquote(version_text)[[ support @<:@default=]]m4_dquote(default_action)[[@:>@])])

  m4_popdef([version_text])

  m4_popdef([with_var])
  m4_popdef([arg_var])

  m4_popdef([check_name_dash])
  m4_popdef([check_name_lc])

  m4_popdef([min_version])
  m4_popdef([default_action])
  m4_popdef([help_name])
  m4_popdef([check_name])
])

dnl
dnl To be used instead of AC_ARG_ENABLE
dnl
dnl LIBVIRT_ARG_ENABLE([CHECK_NAME], [HELP_DESC], [DEFAULT_ACTION])
dnl
dnl      CHECK_NAME: Suffix/prefix used for variables/flags, in uppercase.
dnl       HELP_DESC: Description that will appear in configure --help
dnl  DEFAULT_ACTION: Default configure action
dnl
dnl LIBVIRT_ARG_ENABLE([DEBUG], [enable debugging output], [yes])
dnl
AC_DEFUN([LIBVIRT_ARG_ENABLE], [
  m4_pushdef([check_name], [$1])
  m4_pushdef([help_desc], [[$2]])
  m4_pushdef([default_action], [$3])

  m4_pushdef([check_name_lc], m4_tolower(check_name))
  m4_pushdef([check_name_dash], m4_translit(check_name_lc, [_], [-]))

  m4_pushdef([arg_var], [enable-]check_name_dash)
  m4_pushdef([enable_var], [enable_]check_name_lc)

  m4_divert_text([DEFAULTS], [enable_var][[=]][default_action])
  AC_ARG_ENABLE([check_name_lc],
                [AS_HELP_STRING([[--]arg_var],
                                ]m4_dquote(help_desc)[[ @<:@default=]]m4_dquote(default_action)[[@:>@])])

  m4_popdef([enable_var])
  m4_popdef([arg_var])

  m4_popdef([check_name_dash])
  m4_popdef([check_name_lc])

  m4_popdef([default_action])
  m4_popdef([help_desc])
  m4_popdef([check_name])
])
