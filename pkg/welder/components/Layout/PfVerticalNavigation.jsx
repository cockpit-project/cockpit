/* global jQuery */

// Util: PatternFly Vertical Navigation broken apart and converted to ES6 :)
// Must have navbar-toggle in navbar-pf-vertical for expand/collapse
(($ => {
  $.fn.setupVerticalNavigation = handleItemSelections => { // eslint-disable-line no-param-reassign
    let navElement = $('.nav-pf-vertical');
    const bodyContentElement = $('.container-pf-nav-pf-vertical');
    const toggleNavBarButton = $('.navbar-toggle');
    let explicitCollapse = false;
    let subDesktop = false;
    const hoverDelay = 500;
    const hideDelay = hoverDelay + 200;
    const inMobileState = () => bodyContentElement.hasClass('hidden-nav');

    const forceResize = delay => {
      setTimeout(() => {
        if (window.dispatchEvent) {
          window.dispatchEvent(new Event('resize'));
        }
        // Special case for IE
        if ($(document).fireEvent) {
          $(document).fireEvent('onresize');
        }
      }, delay);
    };

    const showSecondaryMenu = () => {
      if (inMobileState() || !subDesktop) {
        navElement.addClass('secondary-visible-pf');
        bodyContentElement.addClass('secondary-visible-pf');
      }

      // Dispatch a resize event when showing the secondary menu in non-subdesktop state to
      // allow content to adjust to the secondary menu sizing
      if (!subDesktop) {
        forceResize(100);
      }
    };

    const hideSecondaryMenu = () => {
      navElement.removeClass('secondary-visible-pf');
      bodyContentElement.removeClass('secondary-visible-pf');
      navElement.find('.mobile-nav-item-pf').each((index, item) => {
        $(item).removeClass('mobile-nav-item-pf');
      });
    };

    const updateSecondaryMenuDisplayAfterSelection = () => {
      if (inMobileState()) {
        navElement.removeClass('show-mobile-nav');
        hideSecondaryMenu();
        navElement.find('.mobile-nav-item-pf').each((index, item) => {
          $(item).removeClass('mobile-nav-item-pf');
        });
      } else {
        showSecondaryMenu();
      }
    };

    const updateSecondaryCollapsedState = (setCollapsed, collapsedItem) => {
      if (setCollapsed) {
        collapsedItem.addClass('collapsed');
        navElement.addClass('collapsed-secondary-nav-pf');
        bodyContentElement.addClass('collapsed-secondary-nav-pf');
      } else {
        if (collapsedItem) {
          collapsedItem.removeClass('collapsed');
        } else {
          // Remove any collapsed secondary menus
          navElement.find('[data-toggle="collapse-secondary-nav"]').each((index, element) => {
            const $e = $(element);
            $e.removeClass('collapsed');
          });
        }
        navElement.removeClass('collapsed-secondary-nav-pf');
        bodyContentElement.removeClass('collapsed-secondary-nav-pf');
      }
    };

    const updateTertiaryCollapsedState = (setCollapsed, collapsedItem) => {
      if (setCollapsed) {
        collapsedItem.addClass('collapsed');
        navElement.addClass('collapsed-tertiary-nav-pf');
        bodyContentElement.addClass('collapsed-tertiary-nav-pf');
        updateSecondaryCollapsedState(false);
      } else {
        if (collapsedItem) {
          collapsedItem.removeClass('collapsed');
        } else {
          // Remove any collapsed tertiary menus
          navElement.find('[data-toggle="collapse-tertiary-nav"]').each((index, element) => {
            const $e = $(element);
            $e.removeClass('collapsed');
          });
        }
        navElement.removeClass('collapsed-tertiary-nav-pf');
        bodyContentElement.removeClass('collapsed-tertiary-nav-pf');
      }
    };

    const updateMobileMenu = (selected, secondaryItem) => {
      $(document).find('.list-group-item.mobile-nav-item-pf').each((index, item) => {
        $(item).removeClass('mobile-nav-item-pf');
      });
      $(document).find('.list-group-item.mobile-secondary-item-pf').each((index, item) => {
        $(item).removeClass('mobile-secondary-item-pf');
      });
      if (selected) {
        selected.addClass('mobile-nav-item-pf');
        if (secondaryItem) {
          secondaryItem.addClass('mobile-secondary-item-pf');
          navElement.removeClass('show-mobile-secondary');
          navElement.addClass('show-mobile-tertiary');
        } else {
          navElement.addClass('show-mobile-secondary');
          navElement.removeClass('show-mobile-tertiary');
        }
      } else {
        navElement.removeClass('show-mobile-secondary');
        navElement.removeClass('show-mobile-tertiary');
      }
    };

    const checkNavState = () => {
      const width = $(window).width();
      let makeSecondaryVisible;

      // Check to see if we need to enter/exit the mobile state
      if (width < $.pfBreakpoints.tablet) {
        if (!navElement.hasClass('hidden')) {
          // Set the nav to being hidden
          navElement.addClass('hidden');
          navElement.removeClass('collapsed');

          // Set the body class to the correct state
          bodyContentElement.removeClass('collapsed-nav');
          bodyContentElement.addClass('hidden-nav');

          // Reset the collapsed states
          updateSecondaryCollapsedState(false);
          updateTertiaryCollapsedState(false);

          explicitCollapse = false;
        }
      } else if (navElement.hasClass('hidden')) {
        // Always remove the hidden & peek class
        navElement.removeClass('hidden show-mobile-nav');

        // Set the body class back to the default
        bodyContentElement.removeClass('hidden-nav');
      }

      // Check to see if we need to enter/exit the sub desktop state
      if (width < $.pfBreakpoints.desktop) {
        if (!subDesktop) {
          // Collapse the navigation bars when entering sub desktop mode
          navElement.addClass('collapsed');
          bodyContentElement.addClass('collapsed-nav');
        }
        if (width >= $.pfBreakpoints.tablet) {
          hideSecondaryMenu();
        }
        subDesktop = true;
      } else {
        makeSecondaryVisible = subDesktop &&
            (navElement.find('.secondary-nav-item-pf.active').length > 0);
        subDesktop = false;
        if (makeSecondaryVisible) {
          showSecondaryMenu();
        }
      }

      if (explicitCollapse) {
        navElement.addClass('collapsed');
        bodyContentElement.addClass('collapsed-nav');
      } else {
        navElement.removeClass('collapsed');
        bodyContentElement.removeClass('collapsed-nav');
      }
    };

    const collapseMenu = () => {
      // Make sure this is expanded
      navElement.addClass('collapsed');
      // Set the body class to the correct state
      bodyContentElement.addClass('collapsed-nav');

      if (subDesktop) {
        hideSecondaryMenu();
      }

      explicitCollapse = true;
    };

    const enableTransitions = () => {
      // enable transitions only when toggleNavBarButton is clicked or window is resized
      $('html').addClass('transitions');
    };

    const expandMenu = () => {
      // Make sure this is expanded
      navElement.removeClass('collapsed');
      // Set the body class to the correct state
      bodyContentElement.removeClass('collapsed-nav');

      explicitCollapse = false;

      // Dispatch a resize event when showing the expanding then menu to
      // allow content to adjust to the menu sizing
      if (!subDesktop) {
        forceResize(100);
      }
    };

    const bindMenuBehavior = () => {
      toggleNavBarButton.on('click', () => {
        enableTransitions();

        if (inMobileState()) {
          // Toggle the mobile nav
          if (navElement.hasClass('show-mobile-nav')) {
            navElement.removeClass('show-mobile-nav');
          } else {
            // Always start at the primary menu
            updateMobileMenu();
            navElement.addClass('show-mobile-nav');
          }
        } else if (navElement.hasClass('collapsed')) {
          window.localStorage.setItem('patternfly-navigation-primary', 'expanded');
          expandMenu();
        } else {
          window.localStorage.setItem('patternfly-navigation-primary', 'collapsed');
          collapseMenu();
        }
      });
    };

    const forceHideSecondaryMenu = () => {
      navElement.addClass('force-hide-secondary-nav-pf');
      setTimeout(() => {
        navElement.removeClass('force-hide-secondary-nav-pf');
      }, 500);
    };


    const bindMenuItemsBehavior = handleSelection => {
      $(document).find(
        '.nav-pf-vertical > .list-group > .list-group-item'
      ).each((index, primaryItem) => {
        const $primaryItem = $(primaryItem);

        // Set main nav active item on click or show secondary nav if it has a secondary nav bar
        // and we are in the mobile state
        $primaryItem.on('click.pf.secondarynav.data-api', () => {
          const $this = $(this);
          // let $secondaryItem;
          // let tertiaryItem;

          if (!$this.hasClass('secondary-nav-item-pf')) {
            hideSecondaryMenu();
            if (inMobileState()) {
              updateMobileMenu();
              navElement.removeClass('show-mobile-nav');
            }
            if (handleSelection) {
              // PF Core modified: if we have no secondary nav, allow the event to propogate
              // event.stopImmediatePropagation();
            }
          } else if (inMobileState()) {
            updateMobileMenu($this);
          } else if (handleSelection) {
            // $secondaryItem = $($primaryItem.find(
            //    '.nav-pf-secondary-nav > .list-group > .list-group-item')[0]);
            // if ($secondaryItem.hasClass('tertiary-nav-item-pf')) {
            //  tertiaryItem = $secondaryItem.find(
            //    '.nav-pf-tertiary-nav > .list-group > .list-group-item')[0];
            // }
            // PF Core modified: display the secondary menu if a primary was clicked and
            // halt the event
            updateSecondaryMenuDisplayAfterSelection();
            // allow the event to propogate if secondary nav item clicked
            // event.stopImmediatePropagation();
          }
        });

        $primaryItem.find(
          '.nav-pf-secondary-nav > .list-group > .list-group-item'
        ).each((idx, secondaryItem) => {
          const $secondaryItem = $(secondaryItem);
          // Set secondary nav active item on click or show tertiary nav
          // if it has a tertiary nav bar and we are in the mobile state
          $secondaryItem.on('click.pf.secondarynav.data-api', (event) => {
            const $this = $(this);
            // let tertiaryItem;
            if (!$this.hasClass('tertiary-nav-item-pf')) {
              if (inMobileState()) {
                updateMobileMenu();
                navElement.removeClass('show-mobile-nav');
              }
              updateSecondaryMenuDisplayAfterSelection();
              if (handleSelection) {
                // PF Modified: If we click a secondary item and there's no tertiary,
                // let the event bubble
                // event.stopImmediatePropagation();
              }
            } else if (inMobileState()) {
              updateMobileMenu($this, $primaryItem);
              event.stopImmediatePropagation();
            } else if (handleSelection) {
              // tertiaryItem = $secondaryItem.find(
              //   '.nav-pf-tertiary-nav > .list-group > .list-group-item')[0];
              event.stopImmediatePropagation();
            }
          });

          $secondaryItem.find(
            '.nav-pf-tertiary-nav > .list-group > .list-group-item'
          ).each((ind, tertiaryItem) => {
            const $tertiaryItem = $(tertiaryItem);
            // Set tertiary nav active item on click
            $tertiaryItem.on('click.pf.secondarynav.data-api', event => {
              if (inMobileState()) {
                updateMobileMenu();
                navElement.removeClass('show-mobile-nav');
              }
              updateSecondaryMenuDisplayAfterSelection();
              if (handleSelection) {
                // Don't process the click on the item
                event.stopImmediatePropagation();
              }
            });
          });
        });
      });

      $(document).find('.secondary-nav-item-pf').each((index, secondaryItem) => {
        const $secondaryItem = $(secondaryItem);

        // Collapse the secondary nav bar when the toggle is clicked
        $secondaryItem.on(
          'click.pf.secondarynav.data-api',
          '[data-toggle="collapse-secondary-nav"]',
          (e) => {
            const $this = $(this);
            if (inMobileState()) {
              updateMobileMenu();
              e.stopImmediatePropagation();
            } else {
              if ($this.hasClass('collapsed')) {
                window.localStorage.setItem('patternfly-navigation-secondary', 'expanded');
                window.localStorage.setItem('patternfly-navigation-tertiary', 'expanded');
                updateSecondaryCollapsedState(false, $this);
                forceHideSecondaryMenu();
              } else {
                window.localStorage.setItem('patternfly-navigation-secondary', 'collapsed');
                updateSecondaryCollapsedState(true, $this);
              }
            }
            navElement.removeClass('hover-secondary-nav-pf');
            if (handleSelection) {
              // Don't process the click on the parent item
              e.stopImmediatePropagation();
            }
          }
        );

        $secondaryItem.find('.tertiary-nav-item-pf').each((idx, primaryItem) => {
          const $primaryItem = $(primaryItem);
          // Collapse the tertiary nav bar when the toggle is clicked
          $primaryItem.on(
            'click.pf.tertiarynav.data-api',
            '[data-toggle="collapse-tertiary-nav"]',
            (e) => {
              const $this = $(this);
              if (inMobileState()) {
                updateMobileMenu($secondaryItem);
                e.stopImmediatePropagation();
              } else {
                if ($this.hasClass('collapsed')) {
                  window.localStorage.setItem('patternfly-navigation-secondary', 'expanded');
                  window.localStorage.setItem('patternfly-navigation-tertiary', 'expanded');
                  updateTertiaryCollapsedState(false, $this);
                  forceHideSecondaryMenu();
                } else {
                  window.localStorage.setItem('patternfly-navigation-tertiary', 'collapsed');
                  updateTertiaryCollapsedState(true, $this);
                }
              }
              navElement.removeClass('hover-secondary-nav-pf');
              navElement.removeClass('hover-tertiary-nav-pf');
              if (handleSelection) {
                // Don't process the click on the parent item
                e.stopImmediatePropagation();
              }
            }
          );
        });
      });

      // Show secondary nav bar on hover of secondary nav items
      $(document).on('mouseenter.pf.tertiarynav.data-api', '.secondary-nav-item-pf', () => {
        const $this = $(this);
        if (!inMobileState()) {
          if ($this[0].navUnHoverTimeout !== undefined) {
            clearTimeout($this[0].navUnHoverTimeout);
            $this[0].navUnHoverTimeout = undefined;
          } else if ($this[0].navHoverTimeout === undefined) {
            $this[0].navHoverTimeout = setTimeout(() => {
              // PF modified: ensure we get a new reference after a rerender
              navElement = $('.nav-pf-vertical');
              navElement.addClass('hover-secondary-nav-pf');
              $this.addClass('is-hover');
              $this[0].navHoverTimeout = undefined;
            }, hoverDelay);
          }
        }
      });

      $(document).on('mouseleave.pf.tertiarynav.data-api', '.secondary-nav-item-pf', () => {
        const $this = $(this);
        if ($this[0].navHoverTimeout !== undefined) {
          clearTimeout($this[0].navHoverTimeout);
          $this[0].navHoverTimeout = undefined;
        } else if ($this[0].navUnHoverTimeout === undefined) {
          $this[0].navUnHoverTimeout = setTimeout(() => {
            // PF modified: ensure we get a new reference after a rerender
            navElement = $('.nav-pf-vertical');
            if (navElement.find('.secondary-nav-item-pf.is-hover').length <= 1) {
              navElement.removeClass('hover-secondary-nav-pf');
            }
            $this.removeClass('is-hover');
            $this[0].navUnHoverTimeout = undefined;
          }, hideDelay);
        }
      });

      // Show tertiary nav bar on hover of secondary nav items
      $(document).on('mouseover.pf.tertiarynav.data-api', '.tertiary-nav-item-pf', () => {
        const $this = $(this);
        if (!inMobileState()) {
          if ($this[0].navUnHoverTimeout !== undefined) {
            clearTimeout($this[0].navUnHoverTimeout);
            $this[0].navUnHoverTimeout = undefined;
          } else if ($this[0].navHoverTimeout === undefined) {
            $this[0].navHoverTimeout = setTimeout(() => {
              // PF modified: ensure we get a new reference after a rerender
              navElement = $('.nav-pf-vertical');
              navElement.addClass('hover-tertiary-nav-pf');
              $this.addClass('is-hover');
              $this[0].navHoverTimeout = undefined;
            }, hoverDelay);
          }
        }
      });
      $(document).on('mouseout.pf.tertiarynav.data-api', '.tertiary-nav-item-pf', () => {
        const $this = $(this);
        if ($this[0].navHoverTimeout !== undefined) {
          clearTimeout($this[0].navHoverTimeout);
          $this[0].navHoverTimeout = undefined;
        } else if ($this[0].navUnHoverTimeout === undefined) {
          $this[0].navUnHoverTimeout = setTimeout(() => {
            // PF modified: ensure we get a new reference after a rerender
            navElement = $('.nav-pf-vertical');
            if (navElement.find('.tertiary-nav-item-pf.is-hover').length <= 1) {
              navElement.removeClass('hover-tertiary-nav-pf');
            }
            $this.removeClass('is-hover');
            $this[0].navUnHoverTimeout = undefined;
          }, hideDelay);
        }
      });
    };

    const loadFromLocalStorage = () => {
      if (inMobileState()) {
        return;
      }

      if (window.localStorage.getItem('patternfly-navigation-primary') === 'collapsed') {
        collapseMenu();
      }

      if ($('.nav-pf-vertical.nav-pf-vertical-collapsible-menus').length > 0) {
        if (window.localStorage.getItem('patternfly-navigation-secondary') === 'collapsed') {
          updateSecondaryCollapsedState(
            true,
            $('.secondary-nav-item-pf.active [data-toggle=collapse-secondary-nav]')
          );
        }

        if (window.localStorage.getItem('patternfly-navigation-tertiary') === 'collapsed') {
          updateTertiaryCollapsedState(
            true,
            $('.tertiary-nav-item-pf.active [data-toggle=collapse-tertiary-nav]')
          );
        }
      }
    };

    const setTooltips = () => {
      const tooltipOptions = {
        container: 'body',
        placement: 'bottom',
        delay: { show: '500', hide: '200' },
        template: `<div class="nav-pf-vertical-tooltip tooltip" role="tooltip">
                     <div class="tooltip-arrow"></div>
                     <div class="tooltip-inner"></div>
                   </div>`,
      };
      $('.nav-pf-vertical [data-toggle="tooltip"]').tooltip(tooltipOptions);

      $('.nav-pf-vertical').on('show.bs.tooltip', () => $(this).hasClass('collapsed'));
    };

    const init = () => {
      // Set correct state on load
      checkNavState();

      // Bind Top level hamburger menu with menu behavior;
      bindMenuBehavior();

      // Bind menu items
      bindMenuItemsBehavior(handleItemSelections);

      // Set tooltips
      setTooltips();

      loadFromLocalStorage();

      // Show the nav menus
      navElement.removeClass('hide-nav-pf');
      bodyContentElement.removeClass('hide-nav-pf');
      forceResize(250);
    };

    // Listen for the window resize event and collapse/hide as needed
    $(window).on('resize', () => {
      checkNavState();
      enableTransitions();
    });

    init(handleItemSelections);
  };
})(jQuery));
