/*jshint esversion: 6 */

/*
 * Mock "available updates" entries for interactively testing layout changes with large updates
 * To use it, import it in updates.jsx:
 *
 *    import { injectMockUpdates } from "./mock-updates.es6";
 *
 * and call it in loadUpdates()'s Finished: Handler:
 *
 *      Finished: () => {
 *          injectMockUpdates(updates);
 *          let pkg_ids = Object.keys(updates);
 */

export function injectMockUpdates(updates) {
    // some security updates
    updates["security-one;2.3-4"] = {
        name: "security-one",
        version: "2.3-4",
        bug_urls: [],
        cve_urls: ["https://cve.example.com?name=CVE-2014-123456", "https://cve.example.com?name=CVE-2017-9999"],
        vendor_urls: ["https://access.redhat.com/security/updates/classification/#critical", "critical",
                      "https://access.redhat.com/errata/RHSA-2000:0001", "https://access.redhat.com/errata/RHSA-2000:0002"],
        severity: 8,
        description: "This will wreck your data center!",
    };
    updates["security-two;1-2+sec1"] = {
        name: "security-two",
        version: "1-2+sec1",
        bug_urls: [],
        cve_urls: ["https://cve.example.com?name=CVE-2014-54321"],
        vendor_urls: ["https://access.redhat.com/security/updates/classification/#bogus", "bogus",
                      "https://access.redhat.com/security/updates/classification/#low", "low"],
        severity: 8,
        description: "Mostly Harmless",
    };
    updates["security-three;5-2"] = {
        name: "security-three",
        version: "5-2",
        bug_urls: [],
        vendor_urls: ["https://access.redhat.com/security/updates/classification/#low", "low",
                      "https://access.redhat.com/security/updates/classification/#important", "important"],
        severity: 8,
        description: "This update will make you sleep more peacefully.",
    };
    // no vendor URLs, default severity
    updates["security-four;42"] = {
        name: "security-four",
        version: "42",
        cve_urls: ["https://cve.example.com?name=CVE-2014-54321"],
        vendor_urls: [],
        severity: 8,
        description: "Yet another weakness fixed.",
    };

    // source with many binaries
    for (let i = 1; i < 50; ++i) {
        let name = `manypkgs${i}`;
        updates[name + ";1-1"] = {
            name: name,
            version: "1-1",
            bug_urls: [],
            cve_urls: [],
            severity: 4,
            description: "Make [everything](http://everything.example.com) *better*\n\n * more packages\n * more `bugs`\n * more fun!",
            markdown: true,
        };
    }

    // long changelog
    updates["verbose;1-1"] = {
        name: "verbose",
        version: "1-1",
        bug_urls: [],
        cve_urls: [],
        severity: 6,
        description: ("Some longish explanation of some boring technical change. " +
            "This is total technobabble gibberish for layman users.\n\n").repeat(30)
    };

    // many bug fixes
    var bugs = [];
    for (let i = 10000; i < 10025; ++i)
        bugs.push("http://bugzilla.example.com/" + i);
    updates["buggy;1-1"] = {
        name: "buggy",
        version: "1-1",
        bug_urls: bugs,
        cve_urls: [],
        severity: 6,
        description: "This is FUBAR",
    };
}

