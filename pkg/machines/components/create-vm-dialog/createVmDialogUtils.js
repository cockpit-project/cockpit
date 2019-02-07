/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

import {
    getTodayYearShifted,
} from "../../helpers.js";

export const OTHER_OS = "Other OS";
export const OTHER_OS_SHORT_ID = "other-os";
export const NOT_SPECIFIED = "Unspecified";
export const DIVIDER_FAMILY = "Divider";

const LINUX = 'linux';
const WINDOWS = 'windows';
const BSD = 'bsd';

const IGNORE_VENDORS = ['ALTLinux', 'Mandriva', 'GNOME Project'];

const ACCEPT_RELEASE_DATES_AFTER = getTodayYearShifted(-3);
const ACCEPT_EOL_DATES_AFTER = getTodayYearShifted(-1);

export function getOSStringRepresentation(os) {
    let appendix = '';

    if (os.version && !os.name.includes(os.version)) {
        appendix += os.version;
    }
    if (os.codename) {
        appendix += (appendix ? ' ' : '') + os.codename;
    }
    if (appendix) {
        appendix = ` (${appendix})`;
    }

    return `${os.name}${appendix}`;
}

export function prepareVendors(osInfoList) {
    const familyMap = {};
    const vendorMap = {};

    osInfoList = [...osInfoList];
    osInfoList.push({
        'shortId': OTHER_OS_SHORT_ID,
        'name': OTHER_OS,
        'version': null,
        'family': DIVIDER_FAMILY,
        'vendor': NOT_SPECIFIED,
    });

    osInfoList.forEach(os => {
        os.sort_family = os.family;
        os.sort_vendor = os.vendor;

        if (os.version) {
            os.version = os.version.trim();
        }

        correctSpecialCases(os);

        // filter old linux distros
        if (os.sort_family === LINUX &&
            (IGNORE_VENDORS.includes(os.sort_vendor) || filterReleaseEolDates(os))) {
            return;
        }

        if (!familyMap[os.sort_family]) {
            familyMap[os.sort_family] = {};
        }

        if (!(vendorMap[os.sort_vendor] instanceof Array)) {
            vendorMap[os.sort_vendor] = [];
            familyMap[os.sort_family][os.sort_vendor] = null;
        }
        vendorMap[os.sort_vendor].push(os);
    });

    Object.keys(vendorMap)
            .forEach(vendor => {
            // distro sort
                vendorMap[vendor] = vendorMap[vendor].sort((a, b) => {
                    if (!a.sortByVersionOnly) {
                        const result = compareDates(a.releaseDate, b.releaseDate, true); // sort by release date
                        if (result) {
                            return result;
                        }
                    }

                    return (b.version + "").localeCompare(a.version, undefined, { // then sort by version
                        numeric: true,
                        sensitivity: 'base',
                    });
                });
            });

    const familyList = Object.keys(familyMap)
            .sort((a, b) => {
            // families sort
                return customVendorSort(a, b) || a.localeCompare(b);
            })
            .map(family => {
            // vendor sort
                const vendorMap = familyMap[family];
                const vendors = Object.keys(vendorMap).sort(window.localeCompare);
                return { family, vendors };
            });

    return { familyList, familyMap, vendorMap };
}

function filterReleaseEolDates(os) {
    return !(!os.releaseDate && !os.eolDate) && // presume rolling release
        compareDates(ACCEPT_RELEASE_DATES_AFTER, os.releaseDate) < 0 && // if release/eol dates less than accepted dates
        compareDates(ACCEPT_EOL_DATES_AFTER, os.eolDate) < 0; // empty date is also less than accepted date
}

function compareDates(a, b, emptyFirst = false) {
    if (!a) {
        if (!b) {
            return 0;
        }
        return emptyFirst ? -1 : 1;
    }
    if (!b) {
        return emptyFirst ? 1 : -1;
    }

    return new Date(b).getTime() - new Date(a).getTime();
}

function customVendorSort(a, b) {
    if (a === LINUX) {
        return -1;
    }
    if (b === LINUX) {
        return 1;
    }
    if (a === WINDOWS) {
        return -1;
    }
    if (b === WINDOWS) {
        return 1;
    }
    return 0;
}

function correctSpecialCases(os) {
    // windows
    if (os.sort_family.toLowerCase().startsWith('win') || os.sort_family.toLowerCase() === 'msdos') {
        os.sort_family = WINDOWS;
    }

    if (os.sort_vendor.toLowerCase().startsWith('microsoft')) {
        os.sort_vendor = 'Microsoft Corporation';
    }

    if (os.shortId === 'win8') {
        os.releaseDate = '2012-08-01';
    }

    if (os.shortId === 'win8.1') {
        os.releaseDate = '2014-04-08';
    }

    if (os.shortId === 'msdos6.22') {
        os.releaseDate = '1994-06-01';
    }

    // linux
    if (os.shortId.toLowerCase().includes('centos7')) {
        os.eolDate = '2024-06-30';
    }

    if (os.sort_vendor.toLowerCase() === 'centos' || os.sort_vendor.toLowerCase() === 'suse') {
        os.sortByVersionOnly = true;
    }

    // bsd
    if (os.sort_family.toLowerCase().includes(BSD)) {
        os.sort_family = BSD;
    }

    if (os.shortId === 'freebsd2.2.9') {
        os.releaseDate = '2006-04-01'; // april fools prank
    }

    if (os.shortId === 'openbsd4.2') {
        os.releaseDate = '2007-11-01';
    }

    if (os.shortId === 'openbsd4.3') {
        os.releaseDate = '2008-05-01';
    }

    if (os.shortId === 'openbsd4.4') {
        os.releaseDate = '2008-11-01';
    }

    if (os.shortId === 'openbsd4.5') {
        os.releaseDate = '2009-05-01';
    }

    if (os.shortId === 'openbsd4.8') {
        os.releaseDate = '2010-11-01';
    }

    if (os.shortId === 'openbsd4.9') {
        os.releaseDate = '2011-05-01';
    }

    if (os.shortId === 'openbsd5.0') {
        os.releaseDate = '2011-11-01';
    }
}
