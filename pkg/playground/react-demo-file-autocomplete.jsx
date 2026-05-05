/*
 * Copyright (C) 2017 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React from "react";

import { FileAutoComplete } from "cockpit-components-file-autocomplete.jsx";

export const FileAcDemo = () => {
    return <FileAutoComplete id='file-autocomplete-widget' />;
};

export const FileAcDemoPreselected = () => {
    return <FileAutoComplete id='file-autocomplete-widget-preselected' value="/home/admin/newdir/file1" />;
};
