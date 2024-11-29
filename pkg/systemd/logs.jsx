/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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

import '../lib/patternfly/patternfly-5-cockpit.scss';
import 'cockpit-dark-theme'; // once per page

import cockpit from "cockpit";
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { ClipboardCopy } from "@patternfly/react-core/dist/esm/components/ClipboardCopy/index.js";
import { Page, PageSection, PageSectionVariants } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { SearchInput } from "@patternfly/react-core/dist/esm/components/SearchInput/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { Toolbar, ToolbarContent, ToolbarGroup, ToolbarItem, ToolbarToggleGroup } from "@patternfly/react-core/dist/esm/components/Toolbar/index.js";
import {
    ExternalLinkSquareAltIcon,
    FilterIcon,
    HelpIcon,
} from '@patternfly/react-icons';

import { SimpleSelect } from "cockpit-components-simple-select";
import { TypeaheadSelect } from "cockpit-components-typeahead-select";

import {
    checkJournalctlGrep,
    getGrepFiltersFromOptions,
    getOptionsFromTextInput,
} from "./logsHelpers.js";
import { JournalBox } from "./logsJournal.jsx";
import { LogEntry } from "./logDetails.jsx";

import { usePageLocation } from "hooks";

import "./logs.scss";

const _ = cockpit.gettext;

const timeFilterOptions = [
    { key: 1, value: { key: "boot", value: 0 }, content: _("Current boot") },
    { key: 2, value: { key: "boot", value: "-1" }, content: _("Previous boot") },
    { key: 3, value: { key: "since", value: "-24hours", default: true }, content: _("Last 24 hours") },
    { key: 4, value: { key: "since", value: "-7days" }, content: _("Last 7 days") },
];

const journalPrioOptions = [
    { value: "emerg", content: _("Only emergency") },
    { value: "alert", content: _("Alert and above") },
    { value: "crit", content: _("Critical and above") },
    { value: "err", content: _("Error and above") },
    { value: "warning", content: _("Warning and above") },
    { value: "notice", content: _("Notice and above") },
    { value: "info", content: _("Info and above") },
    { value: "debug", content: _("Debug and above") },
];

const getPrioFilterOption = options => {
    // `prio` is a legacy name. Accept it, but don't generate it
    return options.priority || options.prio;
};

const getTimeFilterOption = options => {
    function find_key(key, value) {
        return timeFilterOptions.find(o => o.value.key == key && o.value.value == value)?.value;
    }
    if (options.boot)
        return find_key('boot', options.boot);
    else if (options.since)
        return find_key('since', options.since);
    return timeFilterOptions.find(option => 'default' in option.value)?.value; // Use the default key
};

export const LogsPage = () => {
    const { path, options } = usePageLocation();
    let follow = !(options.follow && options.follow === "false");

    if (options.boot && options.boot !== "0") // Don't follow if specific boot is picked
        follow = false;

    // If priority not specified use err
    if (!options.priority && !options.prio)
        options.priority = 'err';

    const full_grep = getGrepFiltersFromOptions({ options })[0];

    /* Initial state */
    const [currentIdentifiers, setCurrentIdentifiers] = useState(undefined);
    const [dataFollowing, setDataFollowing] = useState(follow);
    const [filteredQuery, setFilteredQuery] = useState(undefined);
    const [journalPrio, setJournalPrio] = useState(getPrioFilterOption(options));
    const [identifiersFilter, setIdentifiersFilter] = useState(options.tag || "all");
    const [showTextSearch, setShowTextSearch] = useState(false);
    const [textFilter, setTextFilter] = useState(full_grep);
    const [timeFilter, setTimeFilter] = useState(getTimeFilterOption(options));
    const [updateIdentifiersList, setUpdateIdentifiersList] = useState(true);

    useEffect(() => {
        checkJournalctlGrep(setShowTextSearch);

        function onNavigate() {
            const { options, path } = cockpit.location;
            const full_grep = getGrepFiltersFromOptions({ options })[0];

            if (path.length == 1) return;

            setJournalPrio(getPrioFilterOption(options));
            setIdentifiersFilter(options.tag || "all");
            setTextFilter(full_grep);
            setTimeFilter(getTimeFilterOption(options));
        }

        cockpit.addEventListener("locationchanged", onNavigate);
        return () => cockpit.removeEventListener("locationchanged", onNavigate);
    }, []);

    if (path.length == 1) {
        return <LogEntry />;
    } else if (path.length > 1) { /* redirect */
        console.warn("not a journal location: " + path);
        cockpit.location = '';
    }

    const updateUrl = (options) => {
        cockpit.location.go([], options);
    };

    const onJournalPrioChange = (value) => {
        setUpdateIdentifiersList(true);

        updateUrl(Object.assign(options, { priority: value }));
    };

    const onIdentifiersFilterChange = (value) => {
        setUpdateIdentifiersList(false);

        if (value == "all") {
            delete options.tag;
            updateUrl(Object.assign(options));
        } else {
            updateUrl(Object.assign(options, { tag: value }));
        }
    };

    const onTextFilterChange = (value) => {
        setUpdateIdentifiersList(true);

        updateUrl(Object.assign(getOptionsFromTextInput(value)));
    };

    const onTimeFilterChange = (newTimeFilter) => {
        setUpdateIdentifiersList(true);

        if (newTimeFilter.key == 'boot' && newTimeFilter.value !== "0") // Don't follow if specific boot is picked
            setDataFollowing(false);
        else if (options.boot && options.boot !== "0" && newTimeFilter.key !== "boot") // Start following is specific boot is removed
            setDataFollowing(true);

        // Remove all parameters which can be set up using filters
        delete options.boot;
        delete options.since;

        cockpit.location.go([], Object.assign(options, { [newTimeFilter.key]: newTimeFilter.value }));
    };

    return (
        <Page>
            <PageSection id="journal" className="journal-filters" padding={{ default: 'noPadding' }}>
                <Toolbar>
                    <ToolbarContent>
                        <ToolbarToggleGroup className="pf-v5-u-flex-wrap pf-v5-u-flex-grow-1 pf-v5-u-align-items-flex-start" toggleIcon={<><span className="pf-v5-c-button__icon pf-m-start"><FilterIcon /></span>{_("Toggle filters")}</>} breakpoint="lg">
                            <ToolbarGroup>
                                <ToolbarItem>
                                    <SimpleSelect
                                        toggleProps={{ id: "logs-predefined-filters" }}
                                        placeholder={_("Time")}
                                        onSelect={onTimeFilterChange}
                                        options={timeFilterOptions}
                                        selected={timeFilter} />
                                </ToolbarItem>

                                <ToolbarItem variant="label">
                                    {_("Priority")}
                                </ToolbarItem>
                                <ToolbarItem>
                                    <SimpleSelect
                                        toggleProps={{ id: "journal-prio-menu" }}
                                        placeholder={_("Priority")}
                                        onSelect={onJournalPrioChange}
                                        options={journalPrioOptions}
                                        selected={journalPrio} />
                                </ToolbarItem>

                                <ToolbarItem variant="label">
                                    {_("Identifier")}
                                </ToolbarItem>
                                <ToolbarItem id="journal-identifier-menu" className="journal-filters-identifier-menu">
                                    <IdentifiersFilter currentIdentifiers={currentIdentifiers}
                                                    onIdentifiersFilterChange={onIdentifiersFilterChange}
                                                    identifiersFilter={identifiersFilter} />
                                </ToolbarItem>
                            </ToolbarGroup>

                            <ToolbarGroup>
                                {showTextSearch &&
                                <>
                                    <ToolbarItem variant="label">
                                        {_("Filters")}
                                    </ToolbarItem>
                                    <ToolbarItem className="text-search">
                                        <TextFilter id="journal-grep"
                                                    className="journal-filters-grep"
                                                    key={textFilter}
                                                    textFilter={textFilter}
                                                    onTextFilterChange={onTextFilterChange}
                                                    filteredQuery={filteredQuery} />
                                    </ToolbarItem>
                                </>}
                                <ToolbarItem variant="separator" />

                                <ToolbarItem>
                                    <Button id="journal-follow"
                                                variant="secondary"
                                                isDisabled={options.boot && options.boot !== "0"}
                                                onClick={() => {
                                                    // Reset time filter if following mode is now selected but we are on a specific boot
                                                    if (!dataFollowing && timeFilter && timeFilter.key == "boot" && timeFilter.value !== "0") {
                                                        setTimeFilter(undefined);
                                                    }

                                                    setDataFollowing(!dataFollowing);
                                                }
                                                }
                                                data-following={dataFollowing}>
                                        {dataFollowing ? _("Pause") : _("Resume")}
                                    </Button>
                                </ToolbarItem>
                            </ToolbarGroup>
                        </ToolbarToggleGroup>
                    </ToolbarContent>
                </Toolbar>

            </PageSection>
            <PageSection padding={{ default: 'noPadding' }}
                         variant={PageSectionVariants.light}
                         id="journal-box"
                         className="journal-filters-box">
                <JournalBox dataFollowing={dataFollowing}
                            defaultSince={timeFilter ? timeFilter.value : getTimeFilterOption({}).value}
                            currentIdentifiers={currentIdentifiers}
                            setCurrentIdentifiers={setCurrentIdentifiers}
                            setFilteredQuery={setFilteredQuery}
                            updateIdentifiersList={updateIdentifiersList}
                            setUpdateIdentifiersList={setUpdateIdentifiersList} />
            </PageSection>
        </Page>
    );
};

const IdentifiersFilter = ({ identifiersFilter, onIdentifiersFilterChange, currentIdentifiers }) => {
    let identifiersArray;
    if (currentIdentifiers !== undefined) {
        identifiersArray = [
            { value: "all", content: _("All") }
        ];
        if (currentIdentifiers.length > 0) {
            identifiersArray.push({ decorator: "divider", key: "divider" });
        }
        identifiersArray = identifiersArray.concat(
            currentIdentifiers
                    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
                    .map(unit => ({ value: unit, content: unit }))
        );
    } else {
        identifiersArray = [
            { value: identifiersFilter, content: identifiersFilter, isDisabled: true }
        ];
    }

    return (
        <TypeaheadSelect selectOptions={identifiersArray}
                         isScrollable
                         selected={identifiersFilter}
                         selectedIsTrusted
                         onSelect={(e, selection) => { onIdentifiersFilterChange(selection) }}
                         onClearSelection={identifiersFilter != "all" && (() => { onIdentifiersFilterChange("all") })}
        />
    );
};

const TextFilter = ({ textFilter, onTextFilterChange, filteredQuery }) => {
    const [unsubmittedTextFilter, setUnsubmittedTextFilter] = useState(textFilter);
    const sinceUntilBody = _("Date specifications should be of the format YYYY-MM-DD hh:mm:ss. Alternatively the strings 'yesterday', 'today', 'tomorrow' are understood. 'now' refers to the current time. Finally, relative times may be specified, prefixed with '-' or '+'");

    const sinceLabel = (
        <>
            {_("Since")}
            <Popover headerContent={_("Start showing entries on or newer than the specified date.")}
                     bodyContent={sinceUntilBody}>
                <Button className="log-text-filter-popover-button" variant="plain">
                    <HelpIcon />
                </Button>
            </Popover>
        </>
    );

    const untilLabel = (
        <>
            {_("Until")}
            <Popover headerContent={_("Start showing entries on or older than the specified date.")}
                     bodyContent={sinceUntilBody}>
                <Button className="log-text-filter-popover-button" variant="plain">
                    <HelpIcon />
                </Button>
            </Popover>
        </>
    );

    const bootLabel = (
        <>
            {_("Boot")}
            <Popover headerContent={_("Show messages from a specific boot.")}
                     bodyContent={_("This will add a match for '_BOOT_ID='. If not specified the logs for the current boot will be shown. If the boot ID is omitted, a positive offset will look up the boots starting from the beginning of the journal, and an equal-or-less-than zero offset will look up boots starting from the end of the journal. Thus, 1 means the first boot found in the journal in chronological order, 2 the second and so on; while -0 is the last boot, -1 the boot before last, and so on.")}>
                <Button className="log-text-filter-popover-button" variant="plain">
                    <HelpIcon />
                </Button>
            </Popover>
        </>
    );

    const serviceLabel = (
        <>
            {_("Unit")}
            <Popover headerContent={_("Show messages for the specified systemd unit.")}
                     bodyContent={_("This will add match for '_SYSTEMD_UNIT=', 'COREDUMP_UNIT=' and 'UNIT=' to find all possible messages for the given unit. Can contain more units separated by comma. ")}>
                <Button className="log-text-filter-popover-button" variant="plain">
                    <HelpIcon />
                </Button>
            </Popover>
        </>
    );

    const freeTextLabel = (
        <>
            {_("Free-form search")}
            <Popover headerContent={_("Show messages containing given string.")}
                     bodyContent={_("Any text string in the logs messages can be filtered. The string can also be in the form of a regular expression. Also supports filtering by message log fields. These are space separated values, in form FIELD=VALUE, where value can be comma separated list of possible values.")}>
                <Button className="log-text-filter-popover-button" variant="plain">
                    <HelpIcon />
                </Button>
            </Popover>
        </>
    );

    const searchInputAttributes = [
        { attr: "since", display: sinceLabel },
        { attr: "until", display: untilLabel },
        { attr: "boot", display: bootLabel },
        { attr: "unit", display: serviceLabel },
        { attr: "priority" }, // Hide this with CSS
        { attr: "tag" }, // Hide this with CSS
    ];

    return (
        <SearchInput attributes={searchInputAttributes}
                     hasWordsAttrLabel={freeTextLabel}
                     advancedSearchDelimiter=":"
                     id="journal-grep"
                     onClear={() => { onTextFilterChange(""); setUnsubmittedTextFilter("") }}
                     placeholder={_("Type to filter")}
                     value={unsubmittedTextFilter}
                     onChange={(_, val) => setUnsubmittedTextFilter(val)}
                     resetButtonLabel={_("Reset")}
                     submitSearchButtonLabel={_("Search")}
                     formAdditionalItems={<Stack hasGutter>
                         <Button variant="link" component="a" isInline
                                     href="https://www.freedesktop.org/software/systemd/man/latest/journalctl.html"
                                     icon={<ExternalLinkSquareAltIcon />} iconPosition="right"
                                     target="blank" rel="noopener noreferrer">
                             {_("journalctl manpage")}
                         </Button>
                         <ClipboardCopy clickTip={_("Successfully copied to clipboard")}
                                            isReadOnly
                                            hoverTip={_("Copy to clipboard")}
                                            id="journal-cmd-copy"
                                            isCode>
                             {filteredQuery}
                         </ClipboardCopy>
                     </Stack>}
                     onSearch={() => onTextFilterChange(unsubmittedTextFilter)} />
    );
};

function init() {
    const root = createRoot(document.getElementById('logs'));
    root.render(<LogsPage />);
}

document.addEventListener("DOMContentLoaded", init);
