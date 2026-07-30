# Proposal: Expose primary service actions as direct buttons

**Related issue:** fixes #23060

## Problem

When a user opens a service detail page in Cockpit, the primary actions — **Start, Stop, Restart, Reload** — are hidden inside a three-dots (kebab) menu. Users frequently don't find them, as reported in #23060:

> *"I don't see any way to control the service. How come there's no way to start or stop or restart a service through the UI?"*
> — @kaiyoma

The user only discovered the actions after realizing they were tucked away in an overflow menu, concluding: *"hiding things in a three-dots menu is perhaps a bit silly."*

## Proposed solution

Expose **primary actions** as direct `Button` components in the service header, while keeping **secondary actions** (Mask, Pin, Edit, Delete) inside the existing kebab menu.

### Primary actions (direct buttons)
- **Start** — when service is inactive
- **Stop** — when service is active
- **Restart** — when service is active
- **Reload** — when service is active and supports reload

### Secondary actions (kebab menu)
- Mask / Unmask
- Pin / Unpin
- Edit (custom timers)
- Delete (custom timers)
- Clear 'Failed to start'

## UX rationale

This follows the PatternFly design guideline that **primary actions should be immediately visible**, while secondary or destructive actions can live in overflow menus. The service detail page has ample horizontal space on desktop, so there's no layout constraint forcing these actions into a menu.

## Implementation sketch

### `pkg/systemd/service-details.jsx`

1. **Split `ServiceActions` into two components:**
   - `ServicePrimaryActions` — renders Start/Stop/Restart/Reload as `Button` variants
   - `ServiceActions` (renamed/refactored) — keeps Mask/Pin/Edit/Delete in the kebab menu

2. **Update the render site (line ~714):**
   ```jsx
   { showAction && (
       <>
           { !masked && !isStatic && (
               <Switch ... />
           )}
           <ServicePrimaryActions ... />
           <ServiceSecondaryActions ... />
       </>
   )}
   ```

3. **Button variant mapping:**
   - `Start` → `variant="primary"`
   - `Restart` → `variant="secondary"`
   - `Reload` → `variant="secondary"`
   - `Stop` → `variant="danger"` (destructive action)

## Visual mockup (before → after)

### Before (current)
```
[Service Name]  [Enable/Disable Switch]  [⋮]
                                    Start
                                    Restart
                                    Stop
                                    --------
                                    Mask
                                    Pin
```

### After (proposed)
```
[Service Name]  [Enable/Disable Switch]  [Start] [Restart] [Stop]  [⋮]
                                                              Mask
                                                              Pin
```

## Scope & reversibility

- **Files touched:** `pkg/systemd/service-details.jsx`, potentially `service-details.scss`
- **Tests:** Update existing pixel tests and integration tests that look for the kebab menu
- **Risk:** Low — purely UI reorganization, no logic changes to systemd interaction
- **Reversible:** Yes — single commit revert

## Next steps

1. Await maintainer feedback on the approach
2. If approved, implement the split and update tests
3. Request pixel-test update from maintainers (CI-generated)

---
*Author: @<your-github-username>*
*Based on discussion in #23060*
