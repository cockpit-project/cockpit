/*
 * Copyright (C) 2017 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React from "react";
import { createRoot } from 'react-dom/client';

import { FileAutoComplete } from "cockpit-components-file-autocomplete.jsx";

export function showFileAcDemo(rootElement) {
    const root = createRoot(rootElement);
    root.render(<FileAutoComplete id='file-autocomplete-widget' />);
}

export function showFileAcDemoPreselected(rootElement) {
    const root = createRoot(rootElement);
    root.render(<FileAutoComplete id='file-autocomplete-widget-preselected' value="/home/admin/newdir/file1" />);
}
