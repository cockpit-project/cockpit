/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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

// --- Provider actions -----------------------------------------
export const ATTACH_DISK = "ATTACH_DISK";
export const CHANGE_NETWORK_STATE = "CHANGE_NETWORK_STATE";
export const CHECK_LIBVIRT_STATUS = "CHECK_LIBVIRT_STATUS";
export const CONSOLE_VM = "CONSOLE_VM";
export const CREATE_AND_ATTACH_VOLUME = "CREATE_AND_ATTACH_VOLUME";
export const CREATE_VM = "CREATE_VM";
export const DELETE_VM = "DELETE_VM";
export const DETACH_DISK = "DETACH_DISK";
export const ENABLE_LIBVIRT = "ENABLE_LIBVIRT";
export const FORCEOFF_VM = "FORCEOFF_VM";
export const FORCEREBOOT_VM = "FORCEREBOOT_VM";
export const GET_ALL_VMS = "GET_ALL_VMS";
export const GET_HYPERVISOR_MAX_VCPU = "GET_HYPERVISOR_MAX_VCPU";
export const GET_OS_INFO_LIST = "GET_OS_INFO_LIST";
export const GET_STORAGE_POOLS = "GET_STORAGE_POOLS";
export const GET_STORAGE_VOLUMES = "GET_STORAGE_VOLUMES";
export const GET_VM = "GET_VM";
export const INIT_DATA_RETRIEVAL = "INIT_DATA_RETRIEVAL";
export const INSTALL_VM = "INSTALL_VM";
export const REBOOT_VM = "REBOOT_VM";
export const SENDNMI_VM = "SENDNMI_VM";
export const SET_VCPU_SETTINGS = "SET_VCPU_SETTINGS";
export const SHUTDOWN_VM = "SHUTDOWN_VM";
export const START_LIBVIRT = "START_LIBVIRT";
export const START_VM = "START_VM";
export const USAGE_START_POLLING = "USAGE_START_POLLING";
export const USAGE_STOP_POLLING = "USAGE_STOP_POLLING";
