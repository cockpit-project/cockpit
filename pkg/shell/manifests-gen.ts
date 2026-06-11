export type ManifestVersion = string;

export type ManifestTools = ManifestMenutype;

export type ManifestRequiresCockpit = string;

export type ManifestRequiresAdditionalProperties = string;

export interface ManifestRequires {
  "cockpit": ManifestRequiresCockpit;
  [key: string]:
    // As a notable limitation, TypeScript requires index signatures
    // to also include the types of all of its properties, so we must
    // match a superset of what JSON Schema allows
    ManifestRequiresCockpit |
    ManifestRequiresAdditionalProperties |
    undefined;
}

export type ManifestPriority = number;

export type ManifestPreloadItems = string;

export type ManifestPreload = ManifestPreloadItems[];

export type ManifestParentDocs = ManifestDocs;

export type ManifestParentComponent = string;

export interface ManifestParent {
  "component"?: ManifestParentComponent;
  "docs"?: ManifestParentDocs;
  [key: string]: unknown | undefined;
}

export type ManifestName = string;

export type ManifestMenu = ManifestMenutype;

export type ManifestDashboard = ManifestMenutype;

export type ManifestContentsecuritypolicy = string;

export type ManifestConditionsItemsPathnotexists = string;

export type ManifestConditionsItemsPathexists = string;

export interface ManifestConditionsItems {
  "path-exists"?: ManifestConditionsItemsPathexists;
  "path-not-exists"?: ManifestConditionsItemsPathnotexists;
  [key: string]: unknown | undefined;
}

export type ManifestConditions = ManifestConditionsItems[];

export type ManifestBridgesItems_1SpawnItems = unknown;

export type ManifestBridgesItems_1Spawn = ManifestBridgesItems_1SpawnItems[];

export type ManifestBridgesItems_1Problem = string;

export type ManifestBridgesItems_1Privileged = boolean;

export type ManifestBridgesItems_1MatchPayload = string;

export interface ManifestBridgesItems_1Match {
  "payload": ManifestBridgesItems_1MatchPayload;
  [key: string]: unknown | undefined;
}

export type ManifestBridgesItems_1Label = string;

export type ManifestBridgesItems_1EnvironItems = string;

export type ManifestBridgesItems_1Environ = ManifestBridgesItems_1EnvironItems[];

export interface ManifestBridgesItems_1 {
  "environ"?: ManifestBridgesItems_1Environ;
  "match"?: ManifestBridgesItems_1Match;
  "privileged"?: ManifestBridgesItems_1Privileged;
  "label"?: ManifestBridgesItems_1Label;
  "problem"?: ManifestBridgesItems_1Problem;
  "spawn": ManifestBridgesItems_1Spawn;
  [key: string]: unknown | undefined;
}

export type ManifestBridgesItems_0ThenMatch = never;

export interface ManifestBridgesItems_0Then {
  "match"?: ManifestBridgesItems_0ThenMatch;
  [key: string]: unknown | undefined;
}

export type ManifestBridgesItems_0IfPrivileged = true;

export interface ManifestBridgesItems_0If {
  "privileged": ManifestBridgesItems_0IfPrivileged;
  [key: string]: unknown | undefined;
}

export type ManifestBridgesItems_0Else = unknown;

// (if & then) | else approximation: the else branch is wider than what
// JSON Schema allows, as TypeScript cannot express type negation
export type ManifestBridgesItems_0 =
  (ManifestBridgesItems_0If & ManifestBridgesItems_0Then) | ManifestBridgesItems_0Else;

export type ManifestBridgesItems =
  ManifestBridgesItems_0 &
  ManifestBridgesItems_1;

export type ManifestBridges = ManifestBridgesItems[];

export type ManifestMenutypeIndexPath = string;

export type ManifestMenutypeIndexOrder = number;

export type ManifestMenutypeIndexLabel = string;

export type ManifestMenutypeIndexKeywordsItemsWeight = number;

export type ManifestMenutypeIndexKeywordsItemsTranslate = boolean;

export type ManifestMenutypeIndexKeywordsItemsMatchesItems = string;

export type ManifestMenutypeIndexKeywordsItemsMatches = ManifestMenutypeIndexKeywordsItemsMatchesItems[];

export type ManifestMenutypeIndexKeywordsItemsGoto = string;

export interface ManifestMenutypeIndexKeywordsItems {
  "matches"?: ManifestMenutypeIndexKeywordsItemsMatches;
  "goto"?: ManifestMenutypeIndexKeywordsItemsGoto;
  "weight"?: ManifestMenutypeIndexKeywordsItemsWeight;
  "translate"?: ManifestMenutypeIndexKeywordsItemsTranslate;
  [key: string]: unknown | undefined;
}

export type ManifestMenutypeIndexKeywords = ManifestMenutypeIndexKeywordsItems[];

export type ManifestMenutypeIndexDocs = ManifestDocs;

export interface ManifestMenutypeIndex {
  "label"?: ManifestMenutypeIndexLabel;
  "order"?: ManifestMenutypeIndexOrder;
  "path"?: ManifestMenutypeIndexPath;
  "docs"?: ManifestMenutypeIndexDocs;
  "keywords"?: ManifestMenutypeIndexKeywords;
  [key: string]: unknown | undefined;
}

export interface ManifestMenutype {
  "index"?: ManifestMenutypeIndex;
  [key: string]: unknown | undefined;
}

export type ManifestDocsItemsUrl = string;

export type ManifestDocsItemsLabel = string;

export interface ManifestDocsItems {
  "label": ManifestDocsItemsLabel;
  "url": ManifestDocsItemsUrl;
  [key: string]: unknown | undefined;
}

export type ManifestDocs = ManifestDocsItems[];

export interface Manifest {
  "content-security-policy"?: ManifestContentsecuritypolicy;
  "name"?: ManifestName;
  "priority"?: ManifestPriority;
  "conditions"?: ManifestConditions;
  "requires"?: ManifestRequires;
  "version"?: ManifestVersion;
  "preload"?: ManifestPreload;
  "parent"?: ManifestParent;
  "dashboard"?: ManifestDashboard;
  "menu"?: ManifestMenu;
  "tools"?: ManifestTools;
  "bridges"?: ManifestBridges;
  [key: string]: unknown | undefined;
}
