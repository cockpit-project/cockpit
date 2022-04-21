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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

/*
 * WARNING: This is a legacy part of cockpit to produce cockpit.css (aka patternfly.css); retained for backwards compatibility
 * Newer code should not include cockpit.css, but let's not break API on RHEL 8
 */
import "../lib/patternfly/patternfly-cockpit.scss";
import "../lib/page.scss";
import "@patternfly/patternfly/components/Button/button.css";
import "../lib/table.css";

// this registers itself as global on window.cockpit
import cockpit from "cockpit"; // eslint-disable-line no-unused-vars
